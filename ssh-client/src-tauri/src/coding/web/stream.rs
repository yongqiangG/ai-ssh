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
//!
//! 误判防御（docs/situations/260824-mobile-terminal-ux.md Q6，0824 夜）：
//! `alternate_screen()` 判据存在可复发的竞态失败（实测一晚 Claude 任务被
//! 误判 alt=false → 256KB 重放 ~10s）。防御 = 普通屏快照截断兜底
//! （48KB 上限 + ESC 边界对齐）+ 1049 首见诊断日志（下次复发即锁定根因）。

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
/// 普通屏快照体积上限（260824 terminal-ux Q6 截断兜底）：alt 误判或真普通屏
/// 任务的尾窗重放超此值时从最老端截断，钳住手机端建连耗时（DERP 实测吞吐
/// ~25-30KB/s → ≤2s）。只作用于发送出去的快照副本，尾窗缓冲本身不动，
/// alt=true 状态序列路径不受影响。
const NORMAL_SNAPSHOT_CAP: usize = 48 * 1024;
/// 截断点向后扫描 ESC 序列边界的窗口：找不到 ESC（极端纯文本）时退回原始
/// 截点、推进到 UTF-8 字符边界截。
const ESC_SCAN_WINDOW: usize = 256;
/// alt 屏进入/退出序列（260824 Q6 诊断扫描目标）：真实流里它们是否/何时
/// 到达 record 是昨晚 alt 误判悬案的关键取证点。
const ALT_ENTER_SEQ: &[u8] = b"\x1b[?1049h";
const ALT_EXIT_SEQ: &[u8] = b"\x1b[?1049l";

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
    /// 1049 首见诊断记账（260824 Q6）：已打日志的任务集合，此后不再扫描。
    /// 纯取证不参与快照判定（判定仍走仿真器 alternate_screen）。
    alt_seq_seen: HashSet<String>,
    /// 1049 扫描的跨块 carry：上一块尾部残余（序列被 read 边界劈开时拼接判定）。
    alt_scan_carry: HashMap<String, Vec<u8>>,
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
        alt_seq_seen: HashSet::new(),
        alt_scan_carry: HashMap::new(),
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
    let alt_log = {
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
        let log = note_alt_seq(id, data, &mut state);
        evict_over_budget(&mut state);
        log
    };
    // 诊断日志锁外打印（stderr 锁不与 TAPS 锁嵌套）
    if let Some(msg) = alt_log {
        eprintln!("{msg}");
    }
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
            // 仿真器与尺寸记账随尾窗同路回收（260824 常驻生命周期的终点）；
            // 1049 诊断记账同路回收（Q6）
            state.web_created.remove(&id);
            state.emulators.remove(&id);
            state.pty_sizes.remove(&id);
            state.alt_seq_seen.remove(&id);
            state.alt_scan_carry.remove(&id);
        }
    }
}

/// 同一临界段内：引导仿真器（不存在则建格灌尾窗）+ 按终端模式二选一产出
/// 快照 + 注册实时订阅者。返回 (快照全文, 是否 alt-screen, 接收端)。此后
/// 接收端收到的块严格晚于快照内容。
///
/// 快照按 `alternate_screen()` 分流（260824 terminal-ux Q1）：
/// - **alt 屏**（Claude 型 TUI，历史在应用内部）：仿真器最终屏幕状态重编码
///   的 VT 序列——百字节级，xterm 原样 write 即恢复；
/// - **普通屏**（Codex 型，历史在终端 scrollback）：**原始尾窗全量重放**——
///   恢复手机端 xterm 本地 scrollback（状态序列只含可见屏，会把历史丢掉，
///   260824 上午状态同步引入的回归，此分支修复）。普通屏输出线性追加，
///   重放解析远快于 alt 屏帧流。
///
/// 引导/序列化硬失败（vt100 bug 级 panic，Q5 决议）→ catch_unwind 回退
/// 原始尾窗，退化到全量重放，不会更糟。仿真器对两种模式照常常驻（后续
/// 建连免重解析；Claude 任务结束退回普通屏的场景自动切到尾窗路径）。
///
/// Q6 截断兜底：普通屏路径的尾窗重放超 `NORMAL_SNAPSHOT_CAP` 时从最老端
/// 截断（对齐 ESC 序列边界）——昨晚 alt 误判致 256KB 全量重放 ~10s 的钳制。
pub(crate) fn subscribe_with_snapshot(
    id: &str,
) -> (String, bool, tokio::sync::mpsc::UnboundedReceiver<String>) {
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
    // 引导诊断（Q6）：首次建仿真器时记录窗内是否含 1049——与 record 首见
    // 日志、mod.rs 快照日志三行拼出完整因果链（序列到没到流里 / 引导时在
    // 不在窗内 / 最终判了什么）。
    let mut bootstrap_note: Option<(usize, bool)> = None;
    let state_sync = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if !state.emulators.contains_key(id) {
            // 惰性引导（Q2）：按 PTY 当前真实尺寸建格（无记账则用 openpty
            // 同款兜底），灌完整尾窗后才入 map——常驻自此开始
            let (rows, cols) = state.pty_sizes.get(id).copied().unwrap_or(FALLBACK_SIZE);
            let mut parser = vt100::Parser::new(rows, cols, 0);
            parser.process(tail.as_bytes());
            state.emulators.insert(id.to_string(), parser);
            bootstrap_note = Some((tail.len(), tail.contains("\x1b[?1049")));
        }
        let screen = state.emulators.get(id)?.screen();
        if !screen.alternate_screen() {
            // 普通屏：尾窗重放才是正路（scrollback 恢复），序列化反而丢历史
            return None;
        }
        let mut out = Vec::new();
        // alt-screen 进入序列 crate 不序列化（PoC 实证），按查询自补——
        // Claude/Codex 型 TUI 全程 alt，缺它后续实时流的光标语义会错位
        out.extend_from_slice(b"\x1b[?1049h");
        // state_formatted = 内容+SGR+光标定位+输入模式（keypad/bracketed-paste）
        out.extend_from_slice(&screen.state_formatted());
        Some(String::from_utf8_lossy(&out).into_owned())
    }))
    .unwrap_or(None);
    let (snapshot, alt) = match state_sync {
        Some(s) => (s, true),
        // None 覆盖三种情况：普通屏（正路）/ 引导或序列化 panic（回退）/
        // 仿真器缺失（防御）——统一走尾窗（Q6 超限截断），alt=false
        None => (truncate_normal_snapshot(tail), false),
    };
    state
        .subscribers
        .entry(id.to_string())
        .or_default()
        .push(tx);
    drop(state);
    // 引导日志锁外打印（stderr 锁不与 TAPS 锁嵌套）
    if let Some((n, has)) = bootstrap_note {
        eprintln!(
            "[web-companion] bootstrap task={} tail-bytes={n} contains-1049={has} (引导时窗内 alt 进入序列有无)",
            id
        );
    }
    (snapshot, alt, rx)
}

/// 1049 序列首见检测（260824 Q6 诊断）：真实流里 `?1049h/l` 是否到达、何时
/// 到达——昨晚 alt 误判悬案的取证点（根因三候选：ConPTY 初始化期消化 /
/// 首连引导错过 / 其他）。找到即记日志并停止扫描；尾部 carry 保证序列被
/// read 边界劈开时不漏检。**纯取证，不参与快照判定。**
fn note_alt_seq(id: &str, data: &str, state: &mut TapState) -> Option<String> {
    if state.alt_seq_seen.contains(id) {
        return None;
    }
    let mut buf = state.alt_scan_carry.remove(id).unwrap_or_default();
    buf.extend_from_slice(data.as_bytes());
    // 扫描整个拼接缓冲（carry 是拼接材料不是扫描边界——序列可横跨任意块界）
    let hit = if buf.windows(ALT_ENTER_SEQ.len()).any(|w| w == ALT_ENTER_SEQ) {
        Some("enter")
    } else if buf.windows(ALT_EXIT_SEQ.len()).any(|w| w == ALT_EXIT_SEQ) {
        Some("exit")
    } else {
        None
    };
    match hit {
        Some(kind) => {
            state.alt_seq_seen.insert(id.to_string());
            Some(format!(
                "[web-companion] alt-seq task={} first-seen={kind} (1049 已到达 record 流)",
                id
            ))
        }
        None => {
            // 未命中：尾部保留（序列长 - 1）字节，序列劈在本块边界时拼入下一块再判
            let keep = ALT_ENTER_SEQ.len().saturating_sub(1);
            let split = buf.len().saturating_sub(keep);
            state
                .alt_scan_carry
                .insert(id.to_string(), buf[split..].to_vec());
            None
        }
    }
}

/// 普通屏快照截断（260824 Q6 兜底）：超 `NORMAL_SNAPSHOT_CAP` 时从最老端
/// 截断，截断点向后对齐到下一个 ESC（VT 序列边界）——避免把转义序列劈成
/// 两半导致手机端首行渲染错乱；窗口内找不到 ESC（极端纯文本）时退回原始
/// 截点、推进到 UTF-8 字符边界。快照长度因此 ≤ cap + 一个多字节字符宽。
fn truncate_normal_snapshot(tail: String) -> String {
    if tail.len() <= NORMAL_SNAPSHOT_CAP {
        return tail;
    }
    let bytes = tail.as_bytes();
    let min_start = bytes.len() - NORMAL_SNAPSHOT_CAP;
    let limit = (min_start + ESC_SCAN_WINDOW).min(bytes.len());
    let mut start = min_start;
    while start < limit && bytes[start] != 0x1b {
        start += 1;
    }
    if start >= limit {
        // 窗口内无 ESC：回退原始截点，仅做字符边界对齐
        start = min_start;
    }
    // ESC 是 ASCII 字节必在字符边界上；纯文本路径则推进到最近的 UTF-8 边界
    while start < bytes.len() && !tail.is_char_boundary(start) {
        start += 1;
    }
    tail[start..].to_string()
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
    state.alt_seq_seen.clear();
    state.alt_scan_carry.clear();
}

/// 测试探针：仿真器是否存在及其网格尺寸。
#[cfg(test)]
pub(crate) fn emulator_probe(id: &str) -> Option<(u16, u16)> {
    TAPS.lock()
        .emulators
        .get(id)
        .map(|p| p.screen().size())
}

/// 测试探针：1049 首见诊断是否已触发（Q6）。
#[cfg(test)]
pub(crate) fn alt_seq_seen_probe(id: &str) -> bool {
    TAPS.lock().alt_seq_seen.contains(id)
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
        let (snapshot, _alt, mut rx) = subscribe_with_snapshot("t1");
        // 260824 起快照是状态序列（清屏/复位头 + 内容），不再等于原始尾窗
        assert!(snapshot.contains("hello world"), "snapshot={snapshot:?}");
        // 订阅后新块实时到达（原始流原样转发，不走仿真器编码）
        touch("t1", "!");
        assert_eq!(rx.try_recv().unwrap(), "!");
    }

    #[test]
    fn snapshot_of_silent_task_is_empty_normal_screen() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        let (snapshot, alt_silent, mut rx) = subscribe_with_snapshot("nobody");
        // 空任务：无任何输出 → 普通屏路径（alt=false），快照为空串（手机端
        // term.reset 后无内容可写）；实时流照常
        assert!(snapshot.is_empty());
        assert!(!alt_silent);
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
        let (_snapshot, _alt, _rx) = subscribe_with_snapshot("t2");
    }

    #[test]
    fn multiple_subscribers_each_get_output() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        let (_s1, _a1, mut r1) = subscribe_with_snapshot("t3");
        let (_s2, _a2, mut r2) = subscribe_with_snapshot("t3");
        touch("t3", "fanout");
        assert_eq!(r1.try_recv().unwrap(), "fanout");
        assert_eq!(r2.try_recv().unwrap(), "fanout");
    }

    #[test]
    fn dropping_receiver_prunes_subscriber_on_next_record() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        let (_snapshot, _alt, rx) = subscribe_with_snapshot("t4");
        drop(rx);
        touch("t4", "after-drop");
        let (_, _alt2, mut late) = subscribe_with_snapshot("t4");
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
        let (snapshot, alt10, _rx) = subscribe_with_snapshot("t10");
        // 状态同步断言：百字节级（全量重放是 2000×80B≈160KB）
        assert!(snapshot.len() < 2048, "snapshot len={}", snapshot.len());
        assert!(alt10, "alt-screen stream must report alt=true");
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
        let (snap1, alt11, _rx1) = subscribe_with_snapshot("t11");
        assert!(snap1.contains("AI Coding"));
        assert!(alt11);
        // 引导后新增输出 → 常驻增量喂入 → 第二个连接看到的状态包含它
        touch("t11", "\x1b[10;1HLATER_CONTENT");
        let (snap2, _alt12, _rx2) = subscribe_with_snapshot("t11");
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
        let (_s, _alt, _rx) = subscribe_with_snapshot("t13");
        drop_emulator_for_test("t13"); // 模拟硬失败丢仿真器后的下一次建连
        let (snap2, _alt, _rx2) = subscribe_with_snapshot("t13");
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

    // ── 260824 terminal-ux：快照按终端模式分流 ──────────────────────────

    #[test]
    fn normal_screen_task_replays_raw_tail_with_alt_false() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        // Codex 型普通屏流：线性追加、无 1049——历史归终端 scrollback
        let chunks: Vec<String> = (0..300).map(|i| format!("line {i}\r\n")).collect();
        for c in &chunks {
            touch("codex-like", c);
        }
        let (snapshot, alt, _rx) = subscribe_with_snapshot("codex-like");
        // 普通屏正路 = 原始尾窗全量重放（恢复手机端 scrollback）
        let expect: String = chunks.concat();
        assert_eq!(snapshot, expect, "normal screen must replay raw tail");
        assert!(!alt);
        // 仿真器仍常驻（模式判定与后续免重解析）
        assert!(emulator_probe("codex-like").is_some());
    }

    #[test]
    fn alt_task_returning_to_normal_screen_switches_to_tail_replay() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        // Claude 任务结束场景：进 alt 干活 → 退出 alt（TUI 收尾）回普通屏
        touch("done-task", &tui_stream());
        touch("done-task", "\x1b[?1049l\r\nfinal summary line\r\n");
        let (snapshot, alt, _rx) = subscribe_with_snapshot("done-task");
        // 退屏后是普通屏 → 尾窗重放，alt=false（完整历史含 TUI 阶段可恢复）
        assert!(!alt);
        assert!(snapshot.contains("final summary line"));
        assert!(snapshot.contains("\x1b[?1049h"), "tail keeps TUI phase");
    }

    // ── 260824 Q6：截断兜底 + 1049 首见诊断 ─────────────────────────────

    #[test]
    fn normal_screen_snapshot_truncated_to_cap() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        // 100KB 普通屏线性流（远超 48KB cap），末尾放最新标记
        let mut stream = String::new();
        while stream.len() < 100 * 1024 {
            stream.push_str("plain line 0123456789 abcdefghij\r\n");
        }
        stream.push_str("LATEST-MARKER\r\n");
        touch("big-normal", &stream);
        let (snapshot, alt, _rx) = subscribe_with_snapshot("big-normal");
        assert!(!alt);
        // 截断到 ≤ cap + 一个多字节字符宽（字符边界对齐的余量）
        assert!(
            snapshot.len() <= NORMAL_SNAPSHOT_CAP + 3,
            "len={}",
            snapshot.len()
        );
        // 最新端必须保留（截断只丢最老历史）
        assert!(snapshot.contains("LATEST-MARKER"));
    }

    #[test]
    fn truncation_aligns_to_esc_boundary() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        // ESC 密集流（每 ~40 字节一个转义序列）：截断点必须落在序列边界上
        let mut stream = String::new();
        while stream.len() < 60 * 1024 {
            stream.push_str("\x1b[32mCOLOR\x1b[m 中文本段 padding text 0123456789\r\n");
        }
        touch("esc-flow", &stream);
        let (snapshot, alt, _rx) = subscribe_with_snapshot("esc-flow");
        assert!(!alt);
        assert!(snapshot.len() <= NORMAL_SNAPSHOT_CAP + 3);
        // 快照从 ESC 开始 = 没有把转义序列劈成两半
        assert!(
            snapshot.starts_with('\x1b'),
            "snapshot must start at ESC boundary"
        );
        assert!(snapshot.contains("padding text"));
    }

    #[test]
    fn truncation_falls_back_to_char_boundary_in_plain_cjk() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        // 纯 CJK 无转义流：ESC 窗口扫描落空 → 退回原始截点，推进到 UTF-8 边界
        let mut stream = String::new();
        while stream.len() < 50 * 1024 {
            stream.push_str("汉字段落无转义序列纯文本测试");
        }
        touch("cjk-plain", &stream);
        let (snapshot, alt, _rx) = subscribe_with_snapshot("cjk-plain");
        assert!(!alt);
        assert!(snapshot.len() <= NORMAL_SNAPSHOT_CAP + 3);
        assert!(!snapshot.contains('\u{FFFD}'), "UTF-8 边界劈开会产生替换符");
        // 截断结果是原流的尾部后缀
        assert!(stream.ends_with(&snapshot));
    }

    #[test]
    fn alt_seq_detected_across_chunk_boundary() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        // 序列劈在块边界：前块尾部 "\x1b[?10"，后块头部 "49h..."——carry 必须拼上
        touch("split", "before \x1b[?10");
        assert!(!alt_seq_seen_probe("split"));
        touch("split", "49h after");
        assert!(alt_seq_seen_probe("split"), "劈开的 1049h 必须检出");
    }

    #[test]
    fn alt_seq_not_detected_in_plain_stream_until_real_seq() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        for i in 0..10 {
            touch("plain", &format!("line {i} no escape\r\n"));
        }
        assert!(!alt_seq_seen_probe("plain"), "普通流不得误报");
        // 退出序列同样算首见（诊断的是 1049 双向到达与否）
        touch("plain", "\x1b[?1049l");
        assert!(alt_seq_seen_probe("plain"));
    }

    #[test]
    fn alt_seq_state_evicted_with_task() {
        let _g = TEST_LOCK.lock();
        reset_for_test();
        touch("old", "\x1b[?1049h");
        assert!(alt_seq_seen_probe("old"));
        // 灌满全局预算触发逐出（最久未活跃先走）——诊断记账同路回收
        let big = "z".repeat(64 * 1024);
        for i in 0..200 {
            touch(&format!("bulk{i}"), &big);
        }
        assert!(!alt_seq_seen_probe("old"), "alt-seq state not reclaimed");
    }
}
