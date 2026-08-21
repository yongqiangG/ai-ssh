//! 任务运行时防睡眠守卫（docs/actions/260821-mobile-companion.md 阶段 3）。
//!
//! 场景：人在外面用手机盯任务，PC 自动睡眠会杀掉一切。挂点选在
//! TaskManager 的 `register_pty_handles` / `remove_pty_handles(_if_same)`——
//! 所有 spawn（run/resume/fork/shell）与终结路径的唯一汇合点，任务与本地
//! Shell 活跃会话都计入。屏幕熄灭/锁屏不受影响（只挡系统睡眠）。
//!
//! 实现：计数 0→N 时起专职线程持有 `SetThreadExecutionState(
//! ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`；N→0 时线程收到信号退出（标志随
//! 线程销毁自动释放）。最坏故障=标志忘释放 → app 开着时不睡（与手动设
//! 永不睡眠等价，可见日志），失败方向安全。

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::sync::mpsc::Sender;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Action {
    None,
    Acquire,
    Release,
}

/// 决策纯函数（可测）：计数变化映射为获取/释放动作。
/// 仅 0→正 触发获取、正→0 触发释放。
pub(crate) fn next_action(count: usize, delta: i32) -> (usize, Action) {
    let new = (count as i64 + delta as i64).max(0) as usize;
    let action = match (count == 0, new == 0) {
        (true, false) => Action::Acquire,
        (false, true) => Action::Release,
        _ => Action::None,
    };
    (new, action)
}

struct State {
    count: usize,
    #[allow(dead_code)] // 非 windows 平台不持有
    cancel: Option<Sender<()>>,
}

static STATE: Lazy<Mutex<State>> = Lazy::new(|| {
    Mutex::new(State {
        count: 0,
        cancel: None,
    })
});

/// 活跃会话 +1（spawn 路径调用）。
pub(crate) fn session_added() {
    apply(1);
}

/// 活跃会话 -1（终结路径调用）。
pub(crate) fn session_removed() {
    apply(-1);
}

fn apply(delta: i32) {
    let action = {
        let mut s = STATE.lock();
        let (new_count, action) = next_action(s.count, delta);
        s.count = new_count;
        action
    };
    #[cfg(windows)]
    match action {
        Action::None => {}
        Action::Acquire => acquire(),
        Action::Release => release(),
    }
    #[cfg(not(windows))]
    let _ = action;
}

#[cfg(windows)]
fn acquire() {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        // ES_CONTINUOUS 绑定调用线程：线程存活期间持续生效，退出即自动释放
        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
        log_alive();
        // 阻塞至释放信号；发送端 drop（进程退出）也视为结束
        let _ = rx.recv();
        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
    });
    STATE.lock().cancel = Some(tx);
}

#[cfg(windows)]
fn release() {
    let mut s = STATE.lock();
    if let Some(cancel) = s.cancel.take() {
        let _ = cancel.send(());
    }
}

#[cfg(windows)]
fn log_alive() {
    eprintln!("[keepawake] active sessions > 0: holding system awake");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_edges() {
        assert_eq!(next_action(0, 1), (1, Action::Acquire));
        assert_eq!(next_action(1, 1), (2, Action::None));
        assert_eq!(next_action(2, -1), (1, Action::None));
        assert_eq!(next_action(1, -1), (0, Action::Release));
        // 计数下限 0：多余减不产生二次释放
        assert_eq!(next_action(0, -1), (0, Action::None));
        assert_eq!(next_action(0, 3), (3, Action::Acquire));
        assert_eq!(next_action(3, -3), (0, Action::Release));
    }
}
