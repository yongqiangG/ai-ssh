//! AI Coding 功能域（迁移自 nezha，GPL-3.0，见 docs/situations/260815-ai-coding-panel.md）。
//!
//! 与 SSH 运维链路完全隔离：数据落 `~/.ai-ssh/coding/`，Tauri 命令统一
//! `coding_` 前缀，前端事件统一 `coding:` 前缀。git 面板 / 技能库 / 用量
//! 展示 / 远程通知未迁移。

pub mod agent_assist;
pub mod agent_compat;
pub mod analytics;
pub mod app_settings;
pub mod codex_rpc;
pub mod config;
pub mod event_watcher;
pub mod fs;
pub mod fs_watcher;
pub mod hooks;
pub mod platform;
pub mod pty;
pub mod session;
pub mod storage;
pub mod subprocess;

use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::sync::Arc;

use session::{ClaudeSessionInfo, CodexSessionInfo};

pub struct TaskManager {
    pub(crate) pty_masters: Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>,
    pub(crate) pty_writers: Mutex<HashMap<String, Box<dyn Write + Send>>>,
    pub(crate) child_handles:
        Mutex<HashMap<String, Arc<std::sync::Mutex<Box<dyn portable_pty::Child + Send + Sync>>>>>,
    pub(crate) cancelled_tasks: Mutex<HashSet<String>>,
    pub(crate) manually_completed_tasks: Mutex<HashSet<String>>,
    pub(crate) codex_sessions: Mutex<HashMap<String, CodexSessionInfo>>,
    pub(crate) claude_sessions: Mutex<HashMap<String, ClaudeSessionInfo>>,
    pub(crate) claimed_session_paths: Mutex<HashSet<String>>,
    /// 持久复用的 `codex app-server` 进程（模型目录自动发现使用）。
    pub(crate) codex_rpc: Arc<Mutex<Option<codex_rpc::CodexRpcClient>>>,
}

impl Default for TaskManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskManager {
    pub fn new() -> Self {
        TaskManager {
            pty_masters: Mutex::new(HashMap::new()),
            pty_writers: Mutex::new(HashMap::new()),
            child_handles: Mutex::new(HashMap::new()),
            cancelled_tasks: Mutex::new(HashSet::new()),
            manually_completed_tasks: Mutex::new(HashSet::new()),
            codex_sessions: Mutex::new(HashMap::new()),
            claude_sessions: Mutex::new(HashMap::new()),
            claimed_session_paths: Mutex::new(HashSet::new()),
            codex_rpc: Arc::new(Mutex::new(None)),
        }
    }

    /// Atomically remove a task/shell from all PTY maps (masters, writers, children).
    /// Locks are acquired in a fixed order to prevent deadlocks.
    pub(crate) fn remove_pty_handles(&self, id: &str) {
        let mut masters = self.pty_masters.lock();
        let mut writers = self.pty_writers.lock();
        let mut children = self.child_handles.lock();
        masters.remove(id);
        writers.remove(id);
        children.remove(id);
    }

    /// 退出前终止所有仍在运行的任务/Shell 子进程。
    /// 先 clone 出 Arc 再逐个 kill,避免持有 `child_handles` 锁期间做阻塞调用。
    /// 主窗口关闭即应用退出,必须在退出路径调用,否则正在跑的 claude/codex
    /// 子进程会留成孤儿,继续占用 CPU / API 额度。
    pub(crate) fn kill_all_children(&self) {
        let children: Vec<_> = self.child_handles.lock().values().cloned().collect();
        for arc in children {
            if let Ok(mut child) = arc.lock() {
                let _ = child.kill();
            }
        }
    }
}
