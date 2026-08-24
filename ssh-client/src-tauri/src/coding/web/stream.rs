//! PTY 输出旁路分流（docs/actions/260821-mobile-companion.md 阶段 2）。
//!
//! 桌面端输出路径保持原样（agent 任务 ipc::Channel 直投 / shell 走事件），
//! 本模块在唯一汇合点 `pty.rs::send_pty_chunk` 加一行旁路记录：
//! 每 id 一个尾部环形缓冲（供 WS 建连回放尾窗）+ 活订阅者列表（实时扇出）。
//! 旁路纪律：任何失败静默忽略，绝不影响主路径。
//!
//! 丢帧窗口消除：快照读取与订阅注册在同一临界段内完成——`record` 也在
//! 同一把锁内追加，快照与实时流之间不可能漏块。
//!
//! 快照状态同步（docs/situations/260824-mobile-snapshot-statesync.md）：
//! 每 id 一个惰性引导后常驻的 vt100 无头仿真器，与尾窗同一把锁、同一
//! 逐出生命周期。WS 建连快照 = 仿真器最终屏幕状态（O(屏幕)，百字节级），
//! 替代原始尾窗全量重放（O(历史)，256KB 级）；引导/序列化硬失败回退
//! 原始尾窗，行为退化到 260821 之前、不会更糟。

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Instant;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tokio::sync::mpsc::UnboundedSender;

/// 单 id 尾窗容量（回放上限，与行动档一致 256KB）。
const TAIL_BYTES: usize = 256 * 1024;
/// 全局内存预算：超预算按最久未活跃逐出整条缓冲。
const TOTAL_BUDGET_BYTES: usize = 8 * 1024 * 1024;
/// 仿真器建格兜底尺寸：与 coding_run_task 的 openpty 缺省一致（220×50）。
const FALLBACK_SIZE: (u16, u16) = (50, 220);

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
    /// 经 web 创建的任务集合：此类任务无桌面 IPC channel，输出需同步
    /// publish 成 `coding:task-output` 事件供桌面终端消费（去重开关——
    /// channel 任务的事件直投与事件流不得并存）。
    web_created: HashSet<String>,
    /// 惰性引导后常驻的无头仿真器（260824）：首个手机 WS 建连时按 PTY
    /// 当前尺寸建格并灌尾窗，此后随 record 增量喂；随尾窗逐出一并回收。
    emulators: HashMap<String, vt100::Parser>,
    /// PTY 当前真实尺寸：spawn（coding_run_task）与 resize 汇合点
    /// （resize_pty）两处记账——仿真器建格与纯跟随（Q4）的数据源。
    pty_sizes: HashMap<String, (u16, u16)>,
}

static TAPS: Lazy<Mutex<TapState>> = Lazy::new(|| {
    Mutex::new(TapState {
        buffers: HashMap::new(),
        subscribers: HashMap::new(),
        desktop_sizes: HashMap::new(),
        live_ws: HashMap::new(),
        web_created: HashSet::new(),
        emulators: HashMap::new(),
        pty_sizes: HashMap::new(),
    })
});

/// 标记任务由 web 创建（create_task_worker 调用）。
pub(crate) fn mark_web_created(id: &str) {
    TAPS.lock().web_created.insert(id.to_string());
}

/// 是否 web 创建（send_pty_chunk 的 tap 据此决定是否发 task-output 事件）。
pub(crate) fn is_web_created(id: &str) -> bool {
    TAPS.lock().web_created.contains(id)
}

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
    // 常驻仿真器增量喂入（260824）：与尾窗追加同把锁，次序天然正确。
    // vt100 纯内存解析不返回 Result，无失败分支；持锁增量微秒级。
    if let Some(parser) = state.emulators.get_mut(id) {
        parser.process(data.as_bytes());
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
            // 缓冲都没了说明任务早已终结，web_created 标记一并回收；
            // 仿真器与尺寸记账随尾窗同路回收（260824 常驻生命周期的终点）
            state.web_created.remove(&id);
            state.emulators.remove(&id);
            state.pty_sizes.remove(&id);
        }
    }
}

/// 同一临界段内：引导仿真器（不存在则建格灌尾窗）+ 序列化状态快照 +
/// 注册实时订阅者。返回 (快照全文, 接收端)。此后接收端收到的块严格晚于
/// 快照内容。
///
/// 快照 = 仿真器最终屏幕状态重编码的 VT 序列（260824）：百字节级，手机端
/// xterm 原样 write 即恢复，管线与 260821 完全一致。引导/序列化硬失败
/// （vt100 bug 级 panic，Q5 决议）→ catch_unwind 回退原始尾窗，退化到
/// 全量重放，不会更糟。panic 时仿真器可能未入 map（局部建、灌完才 insert，
/// 半灌实例随 unwind 丢弃），下次建连重新引导。
pub(crate) fn subscribe_with_snapshot(
    id: &str,
) -> (String, tokio::sync::mpsc::UnboundedReceiver<String>) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let mut state = TAPS.lock();
    let tail = state
        .buffers
        .get(id)
        .map(|b| b.chunks.iter().fold(String::new(), |mut acc, c| {
            acc.push_str(c);
            acc
        }))
        .unwrap_or_default();
    let state_sync = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if !state.emulators.contains_key(id) {
            // 惰性引导（Q2）：按 PTY 当前真实尺寸建格（无记账则用 openpty
            // 同款兜底），灌完整尾窗后才入 map——常驻自此开始
            let (rows, cols) = state.pty_sizes.get(id).copied().unwrap_or(FALLBACK_SIZE);
            let mut parser = vt100::Parser::new(rows, cols, 0);
            parser.process(tail.as_bytes());
            state.emulators.insert(id.to_string(), parser);
        }
        let screen = state.emulators.get(id)?.screen();
        let mut out = Vec::new();
        // alt-screen 进入序列 crate 不序列化（PoC 实证），按查询自补——
        // Claude/Codex 全程 TUI，缺它后续实时流的光标语义会错位
        if screen.alternate_screen() {
            out.extend_from_slice(b"\x1b[?1049h");
        }
        // state_formatted = 内容+SGR+光标定位+输入模式（keypad/bracketed-paste）
        out.extend_from_slice(&screen.state_formatted());
        Some(String::from_utf8_lossy(&out).into_owned())
    }))
    .unwrap_or(None);
    let snapshot = state_sync.unwrap_or_else(|| tail.clone());
    state
        .subscribers
        .entry(id.to_string())
        .or_default()
        .push(tx);
    (snapshot, rx)
}

/// PTY 尺寸记账 + 仿真器纯跟随（Q4）。spawn（coding_run_task openpty 后）
/// 与 resize 汇合点（resize_pty 成功后）各调一次——两写入点全覆盖，
/// 仿真器网格形状永远与 PTY 真值一致。
pub(crate) fn note_pty_size(id: &str, cols: u16, rows: u16) {
    let mut state = TAPS.lock();
    // 统一存 (rows, cols)——与 Parser::new/set_size 参数序一致
    // （区别于 desktop_sizes 的 (cols, rows)，那是对外还原协议的既有序）
    state.pty_sizes.insert(id.to_string(), (rows, cols));
    if let Some(parser) = state.emulators.get_mut(id) {
        parser.screen_mut().set_size(rows, cols);
    }
}

/// 桌面侧 resize 留底（coding_resize_pty 每次成功调用时记一笔）。
pub(crate) fn note_desktop_size(id: &str, cols: u16, rows: u16) {
    TAPS.lock().desktop_sizes.insert(id.to_string(), (cols, rows));
}

/// 手机 WS 建连登记。返回应还原前是否首个连接等不需要——由 disconnect 判定。
pub(crate) fn ws_connected(id: &str) {
    *TAPS.lock().live_ws.entry(id.to_string()).or_insert(0) += 1;
}

/// 该任务是否有手机 WS 在线（PTY 尺寸仲裁：在线期间 PTY 归手机）。
pub(crate) fn has_live_ws(id: &str) -> bool {
    TAPS.lock().live_ws.get(id).is_some_and(|n| *n > 0)
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
    state.web_created.clear();
    state.emulators.clear();
    state.pty_sizes.clear();
}

/// 测试探针：仿真器是否存在及其网格尺寸。
#[cfg(test)]
pub(crate) fn emulator_probe(id: &str) -> Option<(u16, u16)> {
    TAPS.lock()
        .emulators
        .get(id)
        .map(|p| p.screen().size())
}

/// 测试探针：强制丢弃仿真器（模拟硬失败后的回退路径）。
#[cfg(test)]
pub(crate) fn drop_emulator_for_test(id: &str) {
    TAPS.lock().emulators.remove(id);
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
        // 260824 起快照是状态序列（清屏/复位头 + 内容），不再等于原始尾窗
        assert!(snapshot.contains("hello world"), "snapshot={snapshot:?}");
        // 订阅后新块实时到达（原始流原样转发，不走仿真器编码）
        touch("t1", "!");
        assert_eq!(rx.try_recv().unwrap(), "!");
    }

    #[test]
    fn snapshot_of_silent_task_is_reset_sequence_not_empty() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        let (snapshot, mut rx) = subscribe_with_snapshot("nobody");
        // 空网格也输出清屏复位序列（引导出的仿真器状态），实时流照常
        assert!(!snapshot.is_empty());
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
        // 10×64KB 中尾窗只保留最近 4 块（256KB 上限）。260824 起快照是屏幕
        // 状态（≈可见区 11KB），裁剪量改为直接断言内部缓冲
        {
            let state = TAPS.lock();
            let buf = state.buffers.get("t2").unwrap();
            assert_eq!(buf.bytes, 4 * 64 * 1024);
        }
        // 引导照常可用（无 panic）
        let (_snapshot, _rx) = subscribe_with_snapshot("t2");
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
        let (_snapshot, rx) = subscribe_with_snapshot("t4");
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

    // ── 260824 快照状态同步 ──────────────────────────────────────────────

    /// 合成一段 alt-screen TUI 流：进 alt + 定位 + SGR 彩色 + CJK。
    fn tui_stream() -> String {
        let mut s = String::from("\x1b[?1049h\x1b[H\x1b[J");
        s.push_str("\x1b[1;1H\x1b[7m AI Coding \x1b[m\r\n");
        s.push_str("中文宽字符 ✅\r\n");
        s.push_str("\x1b[33;1mYELLOW\x1b[m");
        s
    }

    #[test]
    fn snapshot_is_state_sync_not_raw_replay() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        // 前置大量冗余帧（模拟 TUI 反复重绘），尾窗远大于最终状态
        for _ in 0..2000 {
            touch("t10", &tui_stream());
        }
        let (snapshot, _rx) = subscribe_with_snapshot("t10");
        // 状态同步断言：百字节级（全量重放是 2000×80B≈160KB）
        assert!(snapshot.len() < 2048, "snapshot len={}", snapshot.len());
        // 内容语义：含最终屏文本、alt 进入序列、SGR；不含原始流的重复帧
        assert!(snapshot.contains("\x1b[?1049h"), "alt enter missing");
        assert!(snapshot.contains("AI Coding"));
        assert!(snapshot.contains("中文宽字符 ✅"));
        assert!(!snapshot.contains("YELLOW\x1b[m\x1b[?1049h"), "raw replay leaked");
        // 仿真器已常驻
        assert_eq!(emulator_probe("t10"), Some((50, 220)), "fallback size");
    }

    #[test]
    fn emulator_is_incrementally_fed_after_bootstrap() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        touch("t11", &tui_stream());
        let (snap1, _rx1) = subscribe_with_snapshot("t11");
        assert!(snap1.contains("AI Coding"));
        // 引导后新增输出 → 常驻增量喂入 → 第二个连接看到的状态包含它
        touch("t11", "\x1b[10;1HLATER_CONTENT");
        let (snap2, _rx2) = subscribe_with_snapshot("t11");
        assert!(snap2.contains("LATER_CONTENT"), "incremental feed missing");
    }

    #[test]
    fn emulator_follows_pty_resize() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        note_pty_size("t12", 220, 50); // spawn 记账（cols, rows）
        touch("t12", &tui_stream());
        let _ = subscribe_with_snapshot("t12");
        assert_eq!(emulator_probe("t12"), Some((50, 220)));
        // 手机接管 resize 40 列（note_pty_size 参数序 (cols, rows)）
        note_pty_size("t12", 40, 24);
        assert_eq!(emulator_probe("t12"), Some((24, 40)), "follow failed");
    }

    #[test]
    fn rebootstrap_after_emulator_drop() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        touch("t13", &tui_stream());
        let (_s, _rx) = subscribe_with_snapshot("t13");
        drop_emulator_for_test("t13"); // 模拟硬失败丢仿真器后的下一次建连
        let (snap2, _rx2) = subscribe_with_snapshot("t13");
        // 重新引导：状态同步路径自愈（panic 回退分支本身由 catch_unwind
        // 兜底，无法无侵入注入 panic，不做表演性断言）
        assert!(snap2.contains("AI Coding"));
    }

    #[test]
    fn eviction_reclaims_emulator_too() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        note_pty_size("old-task", 220, 50);
        touch("old-task", &tui_stream());
        let _ = subscribe_with_snapshot("old-task");
        assert!(emulator_probe("old-task").is_some());
        // 灌满全局预算触发逐出（最久未活跃先走）
        let big = "z".repeat(64 * 1024);
        for i in 0..200 {
            touch(&format!("bulk{i}"), &big);
        }
        assert!(emulator_probe("old-task").is_none(), "emulator not reclaimed");
    }
}
