//! PTY 输出旁路分流（docs/actions/260821-mobile-companion.md 阶段 2）。
//!
//! 桌面端输出路径保持原样（agent 任务 ipc::Channel 直投 / shell 走事件），
//! 本模块在唯一汇合点 `pty.rs::send_pty_chunk` 加一行旁路记录：
//! 每 id 一个尾部环形缓冲（供 WS 建连回放尾窗）+ 活订阅者列表（实时扇出）。
//! 旁路纪律：任何失败静默忽略，绝不影响主路径。
//!
//! 丢帧窗口消除：快照读取与订阅注册在同一临界段内完成——`record` 也在
//! 同一把锁内追加，快照与实时流之间不可能漏块。

use std::collections::{HashMap, VecDeque};
use std::time::Instant;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tokio::sync::mpsc::UnboundedSender;

/// 单 id 尾窗容量（回放上限，与行动档一致 256KB）。
const TAIL_BYTES: usize = 256 * 1024;
/// 全局内存预算：超预算按最久未活跃逐出整条缓冲。
const TOTAL_BUDGET_BYTES: usize = 8 * 1024 * 1024;

struct TapBuffer {
    chunks: VecDeque<String>,
    bytes: usize,
    last_touch: Instant,
}

struct TapState {
    buffers: HashMap<String, TapBuffer>,
    subscribers: HashMap<String, Vec<UnboundedSender<String>>>,
    /// 桌面侧最近一次 resize 的尺寸（coding_resize_pty 留底）——手机 WS
    /// 断开时用它还原，避免桌面回来看见手机尺寸的排版。
    desktop_sizes: HashMap<String, (u16, u16)>,
    /// 每个任务当前挂着的手机 WS 连接数（归零才触发桌面尺寸还原）。
    live_ws: HashMap<String, usize>,
}

static TAPS: Lazy<Mutex<TapState>> = Lazy::new(|| {
    Mutex::new(TapState {
        buffers: HashMap::new(),
        subscribers: HashMap::new(),
        desktop_sizes: HashMap::new(),
        live_ws: HashMap::new(),
    })
});

/// 记录一个输出块并扇出给活订阅者。`send_pty_chunk` 每块调用一次。
pub(crate) fn record(id: &str, data: &str) {
    if data.is_empty() {
        return;
    }
    let mut state = TAPS.lock();
    let buf = state.buffers.entry(id.to_string()).or_insert_with(|| TapBuffer {
        chunks: VecDeque::new(),
        bytes: 0,
        last_touch: Instant::now(),
    });
    buf.chunks.push_back(data.to_string());
    buf.bytes += data.len();
    buf.last_touch = Instant::now();
    while buf.bytes > TAIL_BYTES {
        match buf.chunks.pop_front() {
            Some(front) => buf.bytes -= front.len(),
            None => break,
        }
    }
    if let Some(subs) = state.subscribers.get_mut(id) {
        subs.retain(|tx| tx.send(data.to_string()).is_ok());
    }
    evict_over_budget(&mut state);
}

/// 预算逐出：按最久未活跃整条移除（订阅者不逐出——WS 断开时自行清理）。
fn evict_over_budget(state: &mut TapState) {
    let total: usize = state.buffers.values().map(|b| b.bytes).sum();
    if total <= TOTAL_BUDGET_BYTES {
        return;
    }
    // 先取走 id 再逐出，避免借用冲突
    let mut ids_by_age: Vec<(Instant, String)> = state
        .buffers
        .iter()
        .map(|(id, b)| (b.last_touch, id.clone()))
        .collect();
    ids_by_age.sort_by_key(|(t, _)| *t);
    let mut to_free = total - TOTAL_BUDGET_BYTES;
    for (_, id) in ids_by_age {
        if to_free == 0 {
            break;
        }
        if let Some(buf) = state.buffers.remove(&id) {
            to_free = to_free.saturating_sub(buf.bytes);
        }
    }
}

/// 同一临界段内：取尾窗快照 + 注册实时订阅者。
/// 返回 (快照全文, 接收端)。此后接收端收到的块严格晚于快照内容。
pub(crate) fn subscribe_with_snapshot(id: &str) -> (String, tokio::sync::mpsc::UnboundedReceiver<String>) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let mut state = TAPS.lock();
    let snapshot = state
        .buffers
        .get(id)
        .map(|b| b.chunks.iter().fold(String::new(), |mut acc, c| {
            acc.push_str(c);
            acc
        }))
        .unwrap_or_default();
    state
        .subscribers
        .entry(id.to_string())
        .or_default()
        .push(tx);
    (snapshot, rx)
}

/// 桌面侧 resize 留底（coding_resize_pty 每次成功调用时记一笔）。
pub(crate) fn note_desktop_size(id: &str, cols: u16, rows: u16) {
    TAPS.lock().desktop_sizes.insert(id.to_string(), (cols, rows));
}

/// 手机 WS 建连登记。返回应还原前是否首个连接等不需要——由 disconnect 判定。
pub(crate) fn ws_connected(id: &str) {
    *TAPS.lock().live_ws.entry(id.to_string()).or_insert(0) += 1;
}

/// 手机 WS 断开注销。若归零且桌面尺寸有留底，返回该尺寸供调用方还原 PTY。
pub(crate) fn ws_disconnected(id: &str) -> Option<(u16, u16)> {
    let mut state = TAPS.lock();
    if let Some(count) = state.live_ws.get_mut(id) {
        *count = count.saturating_sub(1);
        if *count == 0 {
            state.live_ws.remove(id);
            return state.desktop_sizes.get(id).copied();
        }
    }
    None
}

/// 测试辅助：清空全部状态。
#[cfg(test)]
pub(crate) fn reset_for_test() {
    let mut state = TAPS.lock();
    state.buffers.clear();
    state.subscribers.clear();
    state.desktop_sizes.clear();
    state.live_ws.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy as Lazy2;
    use parking_lot::Mutex as Mutex2;

    // 全局单例，测试串行（同 events.rs 纪律）
    static TEST_LOCK: Lazy2<Mutex2<()>> = Lazy2::new(|| Mutex2::new(()));

    fn touch(id: &str, s: &str) {
        record(id, s);
    }

    #[test]
    fn snapshot_replays_tail_and_live_follows() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        touch("t1", "hello ");
        touch("t1", "world");
        let (snapshot, mut rx) = subscribe_with_snapshot("t1");
        assert_eq!(snapshot, "hello world");
        // 订阅后新块实时到达
        touch("t1", "!");
        assert_eq!(rx.try_recv().unwrap(), "!");
    }

    #[test]
    fn snapshot_before_any_output_is_empty() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        let (snapshot, mut rx) = subscribe_with_snapshot("nobody");
        assert!(snapshot.is_empty());
        touch("nobody", "x");
        assert_eq!(rx.try_recv().unwrap(), "x");
    }

    #[test]
    fn tail_trims_to_budget() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        let big = "x".repeat(64 * 1024);
        for _ in 0..10 {
            touch("t2", &big);
        }
        let (snapshot, _rx) = subscribe_with_snapshot("t2");
        // 10×64KB 中只保留最近 4 块（256KB 上限）
        assert_eq!(snapshot.len(), 4 * 64 * 1024);
    }

    #[test]
    fn multiple_subscribers_each_get_output() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        let (_s1, mut r1) = subscribe_with_snapshot("t3");
        let (_s2, mut r2) = subscribe_with_snapshot("t3");
        touch("t3", "fanout");
        assert_eq!(r1.try_recv().unwrap(), "fanout");
        assert_eq!(r2.try_recv().unwrap(), "fanout");
    }

    #[test]
    fn dropping_receiver_prunes_subscriber_on_next_record() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        let (snapshot, rx) = subscribe_with_snapshot("t4");
        assert!(snapshot.is_empty());
        drop(rx);
        touch("t4", "after-drop");
        let (_, mut late) = subscribe_with_snapshot("t4");
        // 死订阅者已被清掉，活着的照常收
        touch("t4", "second");
        assert_eq!(late.try_recv().unwrap(), "second");
    }

    #[test]
    fn budget_eviction_drops_oldest_id_first() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        let big = "y".repeat(64 * 1024);
        touch("old", &big);
        // 推进 last_touch 差异（Instant 粒度够用，多 touch 一次）
        touch("old", "tail");
        for _ in 0..10 {
            touch("new", &big);
        }
        // 总量 >8MB 阈值未到，此处验证逐出逻辑本身：直接灌满
        for i in 0..200 {
            touch(&format!("bulk{i}"), &big);
        }
        let state = TAPS.lock();
        // 最老的 old 应已被逐出
        assert!(!state.buffers.contains_key("old"));
        let total: usize = state.buffers.values().map(|b| b.bytes).sum();
        assert!(total <= TOTAL_BUDGET_BYTES + 64 * 1024, "total={total}");
    }

    #[test]
    fn ws_lifecycle_restores_desktop_size_when_last_ws_leaves() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        note_desktop_size("t9", 220, 50);

        ws_connected("t9");
        // 第一个连接断开但还有第二个：不还原
        ws_connected("t9");
        assert_eq!(ws_disconnected("t9"), None);
        // 最后一个断开：返回桌面留底尺寸
        assert_eq!(ws_disconnected("t9"), Some((220, 50)));
        // 桌面从没 resize 过（无留底）：归零也无从还原
        ws_connected("t-no-note");
        assert_eq!(ws_disconnected("t-no-note"), None);
    }
}
