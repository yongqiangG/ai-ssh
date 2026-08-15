//! 持久复用的 `codex app-server` JSON-RPC 客户端。
//!
//! 抽取自 nezha 的 usage.rs(用量展示已按决议排除,模型目录自动发现仍需要
//! 这条 RPC 通道)。进程 spawn 一次跨调用复用,死亡时下次调用透明重建。

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{json, Value};

use crate::coding::app_settings::{get_agent_launch_spec, get_login_shell_path};

const CODEX_ATTEMPT_TIMEOUT_SECS: u64 = 10;

/// Holds a live `codex app-server` process.  The process is spawned once and
/// reused across multiple calls.  If the process dies it is transparently
/// replaced on the next call.
pub(crate) struct CodexRpcClient {
    stdin: ChildStdin,
    rx: mpsc::Receiver<Result<Value, String>>,
    child: std::process::Child,
    next_id: i64,
}

impl CodexRpcClient {
    /// Spawn a fresh `codex app-server` and complete the JSON-RPC handshake
    /// (`initialize` / `initialized`).
    pub(crate) fn spawn() -> Result<Self, String> {
        let shell_path = get_login_shell_path();
        let launch = get_agent_launch_spec("codex");

        let mut cmd = Command::new(&launch.program);
        crate::coding::subprocess::configure_background_command(&mut cmd);
        cmd.arg("app-server")
            .env("PATH", &shell_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (key, value) in &launch.extra_env {
            cmd.env(key, value);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start Codex app-server: {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex app-server stdout unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Codex app-server stderr unavailable".to_string())?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex app-server stdin unavailable".to_string())?;

        // Background thread: forward stdout lines to the mpsc channel.
        let (tx, rx) = mpsc::channel::<Result<Value, String>>();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let msg = match line {
                    Ok(line) => {
                        let trimmed = line.trim().to_string();
                        if trimmed.is_empty() {
                            continue;
                        }
                        serde_json::from_str::<Value>(&trimmed)
                            .map_err(|e| format!("Invalid Codex app-server JSON: {e}"))
                    }
                    Err(e) => Err(format!("Failed reading Codex app-server output: {e}")),
                };
                if tx.send(msg).is_err() {
                    break;
                }
            }
        });

        // Drain stderr so the child never blocks waiting for it to be consumed.
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = BufReader::new(stderr).read_to_string(&mut buf);
        });

        // JSON-RPC handshake: initialize → wait → initialized notification.
        //
        // IMPORTANT: perform the handshake before moving `child` into the
        // struct.  If any step fails we must kill the child explicitly —
        // std::process::Child::drop() does *not* kill the process, so a plain
        // `?` would leave an orphan process and two threads blocked on its
        // stdout/stderr pipes.
        let deadline = Instant::now() + Duration::from_secs(CODEX_ATTEMPT_TIMEOUT_SECS);
        let handshake = (|| -> Result<(), String> {
            write_json_line(
                &mut stdin,
                &json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "clientInfo": { "name": "ai-ssh", "version": env!("CARGO_PKG_VERSION") },
                        "capabilities": {}
                    }
                }),
            )?;
            wait_for_result(&rx, 1, deadline)?;
            write_json_line(
                &mut stdin,
                &json!({ "jsonrpc": "2.0", "method": "initialized" }),
            )
        })();

        if let Err(e) = handshake {
            // Kill the child so the two background threads (stdout reader and
            // stderr drainer) receive EOF and exit cleanly.
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }

        Ok(CodexRpcClient {
            stdin,
            rx,
            child,
            next_id: 2,
        })
    }

    /// `true` while the child process is still running.
    pub(crate) fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn alloc_id(&mut self) -> i64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Send a JSON-RPC request and return the `result` field of the response.
    pub(crate) fn call(
        &mut self,
        method: &str,
        params: Value,
        deadline: Instant,
    ) -> Result<Value, String> {
        let id = self.alloc_id();
        write_json_line(
            &mut self.stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params
            }),
        )?;
        wait_for_result(&self.rx, id, deadline)
    }
}

impl Drop for CodexRpcClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(crate) fn call_codex_rpc_with_client(
    codex_rpc: Arc<Mutex<Option<CodexRpcClient>>>,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let mut guard = codex_rpc.lock();
    if guard.as_mut().is_some_and(|client| !client.is_alive()) {
        let dead_client = guard.take();
        drop(guard);
        drop(dead_client);
        guard = codex_rpc.lock();
    }
    if guard.is_none() {
        *guard = Some(CodexRpcClient::spawn()?);
    }

    let result = match guard.as_mut() {
        Some(client) => client.call(method, params, Instant::now() + timeout),
        None => Err("Codex RPC client was not initialized.".to_string()),
    };
    let failed_client = result.is_err().then(|| guard.take()).flatten();
    drop(guard);
    drop(failed_client);
    result
}

fn write_json_line(stdin: &mut dyn Write, value: &Value) -> Result<(), String> {
    let payload = serde_json::to_string(value)
        .map_err(|e| format!("Failed to serialize Codex request: {e}"))?;
    stdin
        .write_all(payload.as_bytes())
        .map_err(|e| format!("Failed writing Codex request: {e}"))?;
    stdin
        .write_all(b"\n")
        .map_err(|e| format!("Failed writing Codex request terminator: {e}"))?;
    stdin
        .flush()
        .map_err(|e| format!("Failed flushing Codex request: {e}"))?;
    Ok(())
}

fn wait_for_result(
    rx: &mpsc::Receiver<Result<Value, String>>,
    expected_id: i64,
    deadline: Instant,
) -> Result<Value, String> {
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(format!(
                "Timed out waiting for Codex response {expected_id}."
            ));
        }

        let remaining = deadline.saturating_duration_since(now);
        let message = rx
            .recv_timeout(remaining)
            .map_err(|_| format!("Codex app-server closed before response {expected_id}."))??;

        let matches_id = message
            .get("id")
            .and_then(Value::as_i64)
            .map_or(false, |id| id == expected_id);
        if !matches_id {
            continue;
        }

        if let Some(result) = message.get("result") {
            return Ok(result.clone());
        }

        if let Some(error) = message.get("error") {
            let msg = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Unknown Codex app-server error");
            return Err(msg.to_string());
        }

        return Err(format!(
            "Codex response {expected_id} did not include result or error."
        ));
    }
}
