use std::{
    fs::{self, OpenOptions},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use tauri::{Emitter, Manager, WindowEvent};

const BACKEND_PORT: &str = "8091";

struct BackendProcess(Mutex<Option<Child>>);

/// sidecar 启动失败信息暂存：setup 阶段早于 webview 就绪，emit 的事件可能
/// 无人接收，前端挂载后可通过 backend_launch_failure 命令补查一次。
struct BackendLaunchFailure(Mutex<Option<String>>);

impl BackendProcess {
    fn stop(&self) {
        let mut child = self.0.lock().expect("backend process mutex poisoned");
        if let Some(mut child) = child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 前端启动门查询：sidecar spawn 是否已失败（None = 未失败）
#[tauri::command]
fn backend_launch_failure(state: tauri::State<'_, BackendLaunchFailure>) -> Option<String> {
    state
        .0
        .lock()
        .expect("backend launch failure mutex poisoned")
        .clone()
}

/// 后端日志目录（backend.out.log / backend.err.log 所在），供失败页展示排障线索
#[tauri::command]
fn backend_log_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("resolve app data dir failed: {e}"))
}

fn start_backend(app: &tauri::App) -> Result<Child, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve resource dir failed: {e}"))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir failed: {e}"))?;

    fs::create_dir_all(&data_dir).map_err(|e| format!("create backend log dir failed: {e}"))?;

    let backend_jar = normalize_windows_path(
        first_existing_path([
            resource_dir.join("backend").join("ssh-server-app.jar"),
            resource_dir
                .join("resources")
                .join("backend")
                .join("ssh-server-app.jar"),
        ])
        .ok_or_else(|| format!("backend jar not found under {}", resource_dir.display()))?,
    );

    let java_name = if cfg!(windows) { "java.exe" } else { "java" };
    let java_bin = normalize_windows_path(
        first_existing_path([
            resource_dir.join("runtime").join("bin").join(java_name),
            resource_dir
                .join("resources")
                .join("runtime")
                .join("bin")
                .join(java_name),
        ])
        .ok_or_else(|| format!("embedded java not found under {}", resource_dir.display()))?,
    );

    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("backend.out.log"))
        .map_err(|e| format!("open backend stdout log failed: {e}"))?;
    let stderr = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("backend.err.log"))
        .map_err(|e| format!("open backend stderr log failed: {e}"))?;

    let jar_size = fs::metadata(&backend_jar).map(|m| m.len()).unwrap_or(0);
    let java_size = fs::metadata(&java_bin).map(|m| m.len()).unwrap_or(0);
    let launch_log = format!(
        "java={}\njava_size={}\njar={}\njar_size={}\n",
        java_bin.display(),
        java_size,
        backend_jar.display(),
        jar_size
    );
    let _ = fs::write(data_dir.join("backend-launch.log"), launch_log);

    let mut command = Command::new(java_bin);
    command
        .arg("-Dspring.profiles.active=single")
        .arg(format!("-Dserver.port={BACKEND_PORT}"))
        .arg("-jar")
        .arg(backend_jar)
        .arg(format!("--server.port={BACKEND_PORT}"))
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .stdin(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|e| format!("start backend failed: {e}"))
}

fn first_existing_path<const N: usize>(candidates: [PathBuf; N]) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.exists())
}

fn normalize_windows_path(path: PathBuf) -> PathBuf {
    if !cfg!(windows) {
        return path;
    }

    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .manage(BackendLaunchFailure(Mutex::new(None)))
        .setup(|app| {
            match start_backend(app) {
                Ok(child) => {
                    let backend = app.state::<BackendProcess>();
                    *backend.0.lock().expect("backend process mutex poisoned") = Some(child);
                }
                Err(e) => {
                    eprintln!("failed to start backend: {e}");
                    // dev（debug 构建）下 resources 无 jar、后端由开发者手动外置启动，
                    // spawn 失败是常态，不快报——否则会把活着的手动后端误判成故障。
                    // release 打包版 sidecar 必须成功：失败即暂存 + 广播，
                    // 让启动遮罩立即转失败态而不是傻等 60s ping 超时
                    if !cfg!(debug_assertions) {
                        let message =
                            format!("本地服务进程启动失败：{e}（请修复后重启应用）");
                        *app.state::<BackendLaunchFailure>()
                            .0
                            .lock()
                            .expect("backend launch failure mutex poisoned") =
                            Some(message.clone());
                        let _ = app.emit("backend-launch-failed", message);
                    }
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            backend_launch_failure,
            backend_log_dir
        ])
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                window.state::<BackendProcess>().stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
