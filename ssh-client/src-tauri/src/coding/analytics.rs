// ── Session metrics ───────────────────────────────────────────────────────────

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::SystemTime;

#[derive(serde::Serialize, Clone, Default)]
pub(crate) struct SessionMetrics {
    pub(crate) tool_calls: u64,
    pub(crate) duration_secs: f64,
    pub(crate) session_file_bytes: u64,
    /// 任务累计 token 消耗（包含缓存命中 / reasoning），用于 UI"总消耗"。
    pub(crate) total_tokens: u64,
    /// 当前上下文占用（最后一轮 prompt 大小）。Codex 直读，Claude 由最后一条 assistant 推导。
    pub(crate) context_tokens: u64,
    /// 模型上下文窗口大小。仅 Codex 自带；Claude session 不暴露此值，留 0 让前端隐藏。
    pub(crate) context_window: u64,
}

fn parse_rfc3339_secs(ts: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp() as f64 + dt.timestamp_subsec_millis() as f64 / 1000.0)
}

fn track_timestamp(val: &Value, first: &mut Option<f64>, last: &mut Option<f64>) {
    if let Some(ts_str) = val.get("timestamp").and_then(|v| v.as_str()) {
        if let Some(ts) = parse_rfc3339_secs(ts_str) {
            if first.is_none() {
                *first = Some(ts);
            }
            *last = Some(ts);
        }
    }
}

fn duration_from(first: Option<f64>, last: Option<f64>) -> f64 {
    match (first, last) {
        (Some(a), Some(b)) => (b - a).max(0.0),
        _ => 0.0,
    }
}

// ── 增量累加器 ───────────────────────────────────────────────────────────────
// Claude/Codex 的 metrics 都是「逐行可累加」的（token/tool_calls 求和、
// last_context/last_token_info 取最后一条、时间戳取首尾），因此 session jsonl
// 的 append-only 特性可以被利用：缓存里存 offset + 累加器，每次只解析新增行。
// 旧实现按 mtime 失效缓存，而活跃会话文件持续追加 → mtime 恒变 → 每 3s 全量
// read_to_string + 逐行解析，长会话（几十 MB）下累计 O(N²)（260820 评审 P1-2）。

#[derive(Default, Clone)]
struct ClaudeMetricsAccum {
    input_tokens: u64,
    output_tokens: u64,
    cache_creation: u64,
    cache_read: u64,
    tool_calls: u64,
    last_context: u64,
    first_ts: Option<f64>,
    last_ts: Option<f64>,
}

impl ClaudeMetricsAccum {
    fn feed_line(&mut self, line: &str) {
        let Ok(val) = serde_json::from_str::<Value>(line) else { return };
        track_timestamp(&val, &mut self.first_ts, &mut self.last_ts);

        if val.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            return;
        }
        let Some(message) = val.get("message") else { return };

        if let Some(usage) = message.get("usage") {
            let inp = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
            let cc = usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let cr = usage
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            self.input_tokens += inp;
            self.output_tokens += usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
            self.cache_creation += cc;
            self.cache_read += cr;
            // 最后一条 assistant 的 prompt 总大小 ≈ 当前上下文占用
            self.last_context = inp + cc + cr;
        }

        if let Some(arr) = message.get("content").and_then(|v| v.as_array()) {
            for item in arr {
                if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                    self.tool_calls += 1;
                }
            }
        }
    }

    fn metrics(&self) -> SessionMetrics {
        SessionMetrics {
            tool_calls: self.tool_calls,
            duration_secs: duration_from(self.first_ts, self.last_ts),
            session_file_bytes: 0,
            total_tokens: self.input_tokens
                + self.output_tokens
                + self.cache_creation
                + self.cache_read,
            context_tokens: self.last_context,
            context_window: 0, // Claude session 不带窗口大小
        }
    }
}

#[derive(Default, Clone)]
struct CodexMetricsAccum {
    tool_calls: u64,
    last_token_info: Option<Value>,
    first_ts: Option<f64>,
    last_ts: Option<f64>,
}

impl CodexMetricsAccum {
    fn feed_line(&mut self, line: &str) {
        let Ok(val) = serde_json::from_str::<Value>(line) else { return };
        track_timestamp(&val, &mut self.first_ts, &mut self.last_ts);

        let t = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let payload = val.get("payload");
        let pt = payload
            .and_then(|p| p.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match (t, pt) {
            ("event_msg", "token_count") => {
                if let Some(info) = payload.and_then(|p| p.get("info")) {
                    if !info.is_null() {
                        self.last_token_info = Some(info.clone());
                    }
                }
            }
            ("response_item", "function_call") | ("response_item", "custom_tool_call") => {
                self.tool_calls += 1;
            }
            _ => {}
        }
    }

    fn metrics(&self) -> SessionMetrics {
        let (total_tokens, context_tokens, context_window) =
            if let Some(info) = self.last_token_info.as_ref() {
                let total = info.get("total_token_usage");
                let last = info.get("last_token_usage");
                let tot = total
                    .and_then(|t| t.get("total_tokens"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let ctx = last
                    .and_then(|l| l.get("total_tokens"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let win = info
                    .get("model_context_window")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                (tot, ctx, win)
            } else {
                (0, 0, 0)
            };

        SessionMetrics {
            tool_calls: self.tool_calls,
            duration_secs: duration_from(self.first_ts, self.last_ts),
            session_file_bytes: 0,
            total_tokens,
            context_tokens,
            context_window,
        }
    }
}

// ── 增量缓存 ─────────────────────────────────────────────────────────────────

/// 单个 session 文件的增量解析状态。
///
/// `offset` 只会落在完整行的行尾（`\n` 之后）—— torn line（写入中途被读到半行）
/// 留待下次拼接，保证任何一行要么完整解析一次、要么完全不解析，不会被半行喂两次。
#[derive(Clone)]
struct IncrementalMetricsState {
    modified: SystemTime,
    offset: u64,
    is_codex: bool,
    claude: ClaudeMetricsAccum,
    codex: CodexMetricsAccum,
}

impl IncrementalMetricsState {
    fn feed_line(&mut self, line: &str) {
        if self.is_codex {
            self.codex.feed_line(line);
        } else {
            self.claude.feed_line(line);
        }
    }

    fn metrics(&self, session_file_bytes: u64) -> SessionMetrics {
        let mut m = if self.is_codex {
            self.codex.metrics()
        } else {
            self.claude.metrics()
        };
        m.session_file_bytes = session_file_bytes;
        m
    }
}

/// 缓存条目上限。超限时整体清空——metrics 轮询同一时刻只盯一个任务，
/// 工作集极小，清空比逐条淘汰简单且无正确性影响（丢了就全量重解析一次）。
const METRICS_CACHE_MAX_ENTRIES: usize = 64;

static METRICS_CACHE: Lazy<Mutex<HashMap<String, IncrementalMetricsState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// 探测格式：与 `session.rs::is_codex_format` 保持一致——前 10 行内出现
/// `type=session_meta` 或 `type=event_msg` 即视为 Codex。
/// Why: Codex 各版本 `payload.originator` 取值漂移（codex_cli_rs / codex-tui / ...），
/// 仅靠 originator 前缀判定会让部分可正常回放的 Codex session 被错走 Claude 解析，
/// token/tool_calls 全部归零；判定标准必须与会话查看器保持一致。
fn is_codex_session(content: &str) -> bool {
    for line in content.lines().take(10) {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("session_meta") | Some("event_msg") => return true,
            _ => {}
        }
    }
    false
}

/// 全量解析：读整个文件、喂所有完整行。offset 停在最后一个 `\n` 之后，
/// 文件尾部若有 torn line（无换行结尾）不消费、不计入 offset。
fn full_parse_state(path: &Path, modified: SystemTime) -> IncrementalMetricsState {
    let Ok(content) = fs::read_to_string(path) else {
        return IncrementalMetricsState {
            modified,
            offset: 0,
            is_codex: false,
            claude: ClaudeMetricsAccum::default(),
            codex: CodexMetricsAccum::default(),
        };
    };
    let is_codex = is_codex_session(&content);
    let mut state = IncrementalMetricsState {
        modified,
        offset: 0,
        is_codex,
        claude: ClaudeMetricsAccum::default(),
        codex: CodexMetricsAccum::default(),
    };
    // 只喂完整行：以最后一个 \n 为界，其后可能是写入中途的半行
    match content.rfind('\n') {
        Some(last_nl) => {
            for line in content[..last_nl].lines() {
                state.feed_line(line);
            }
            state.offset = last_nl as u64 + 1;
        }
        None => {}
    }
    state
}

/// 从 offset 起读取新增字节，只消费完整行。返回 (本次消费的字节数, 新增完整行文本)。
/// 返回 None 表示 IO 失败（文件被移走等），调用方应回退全量。
fn read_new_complete_lines(path: &Path, offset: u64) -> Option<(u64, String)> {
    let mut file = fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    if size <= offset {
        return Some((0, String::new()));
    }
    // offset 恒为完整行行尾（\n 之后，ASCII 单字节），UTF-8 安全边界
    file.seek(SeekFrom::Start(offset)).ok()?;
    let mut buf = String::new();
    file.read_to_string(&mut buf).ok()?;
    match buf.rfind('\n') {
        Some(last_nl) => Some((last_nl as u64 + 1, buf[..last_nl].to_string())),
        // 新增部分尚无完整行（半行）：本轮不消费
        None => Some((0, String::new())),
    }
}

/// 带增量缓存的 session 指标解析。
///
/// 路径：mtime 未变 → 直接返回（快路径）；文件在 offset 基础上追加 → 只解析
/// 新增完整行；无缓存 / 文件被截断重写（size < offset）/ IO 失败 → 全量重解析。
pub(crate) fn parse_session_metrics_cached(path: &Path) -> SessionMetrics {
    let path_str = path.to_string_lossy().to_string();

    let Ok(metadata) = fs::metadata(path) else {
        return SessionMetrics::default();
    };
    let size = metadata.len();
    let Ok(modified) = metadata.modified() else {
        return SessionMetrics::default();
    };

    let snapshot = { METRICS_CACHE.lock().get(&path_str).cloned() };

    let (state, metrics) = match snapshot {
        // 快路径：mtime 未变，文件没动过
        Some(st) if st.modified == modified => {
            let m = st.metrics(size);
            (st, m)
        }
        // 增量：文件增长（或原地变化但 size 未缩小），只解析新增完整行
        Some(st) if size >= st.offset => {
            let mut st = st;
            st.modified = modified;
            match read_new_complete_lines(path, st.offset) {
                Some((consumed, new_lines)) if consumed > 0 => {
                    for line in new_lines.lines() {
                        st.feed_line(line);
                    }
                    st.offset += consumed;
                }
                Some(_) => {}
                // IO 失败：回退全量
                None => st = full_parse_state(path, modified),
            }
            let m = st.metrics(size);
            (st, m)
        }
        // 无缓存 / 文件被截断或重写：全量重解析
        _ => {
            let st = full_parse_state(path, modified);
            let m = st.metrics(size);
            (st, m)
        }
    };

    let mut cache = METRICS_CACHE.lock();
    if cache.len() >= METRICS_CACHE_MAX_ENTRIES {
        cache.clear();
    }
    cache.insert(path_str, state);
    metrics
}

#[tauri::command]
pub async fn coding_read_session_metrics(session_path: String) -> Result<SessionMetrics, String> {
    tokio::task::spawn_blocking(move || {
        let path = std::path::Path::new(&session_path);
        if !path.exists() {
            return Err(format!("Session file not found: {}", session_path));
        }
        Ok(parse_session_metrics_cached(path))
    })
    .await
    .map_err(|e| format!("read_session_metrics join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_session_path(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "nezha-analytics-{}-{}",
            tag,
            uuid::Uuid::new_v4()
        ))
    }

    /// 把 mtime 拨快 1s+，保证跨调用的 mtime 比较必然不同（连续两次写入
    /// 可能落在同一时间戳粒度内，测试需要确定性）。set_modified 需要
    /// Rust 1.75+（项目 stable 工具链满足）。
    fn touch_mtime(path: &Path) {
        if let Ok(f) = fs::OpenOptions::new().write(true).open(path) {
            let _ = f.set_modified(SystemTime::now() + std::time::Duration::from_secs(1));
        }
    }

    fn claude_line(input: u64, output: u64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"2026-08-20T01:00:0{}Z","message":{{"usage":{{"input_tokens":{},"output_tokens":{}}},"content":[{{"type":"tool_use"}}]}}}}"#,
            input, input, output
        )
    }

    /// 增量 == 全量：分两次追加喂入的结果与一次性全量解析一致
    #[test]
    fn incremental_matches_full_parse() {
        let path = temp_session_path("incr");
        let first = format!("{}\n{}\n", claude_line(1, 10), claude_line(2, 20));
        fs::write(&path, &first).unwrap();
        touch_mtime(&path);

        let m1 = parse_session_metrics_cached(&path);
        assert_eq!(m1.tool_calls, 2);
        assert_eq!(m1.total_tokens, 33);
        // last_context = 最后一条的 input + 0 + 0
        assert_eq!(m1.context_tokens, 2);

        // 追加两行，mtime 拨动
        let mut content = first;
        content.push_str(&format!("{}\n{}\n", claude_line(3, 30), claude_line(4, 40)));
        fs::write(&path, &content).unwrap();
        touch_mtime(&path);

        let m2 = parse_session_metrics_cached(&path);
        assert_eq!(m2.tool_calls, 4);
        assert_eq!(m2.total_tokens, 1 + 10 + 2 + 20 + 3 + 30 + 4 + 40);
        assert_eq!(m2.context_tokens, 4);

        // 与全量解析对照：换一个未缓存的路径写同样内容
        let full_path = temp_session_path("full");
        fs::write(&full_path, &content).unwrap();
        touch_mtime(&full_path);
        let m_full = parse_session_metrics_cached(&full_path);
        assert_eq!(m2.tool_calls, m_full.tool_calls);
        assert_eq!(m2.total_tokens, m_full.total_tokens);
        assert_eq!(m2.context_tokens, m_full.context_tokens);
        assert_eq!(m2.duration_secs, m_full.duration_secs);

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(&full_path);
    }

    /// mtime 未变 → 快路径：内容变了但 mtime 相同也必须返回缓存结果
    #[test]
    fn mtime_fast_path_serves_cache_without_reparse() {
        let path = temp_session_path("fastpath");
        fs::write(&path, format!("{}\n", claude_line(5, 50))).unwrap();
        touch_mtime(&path);
        let mtime = fs::metadata(&path).unwrap().modified().unwrap();
        let m1 = parse_session_metrics_cached(&path);
        assert_eq!(m1.tool_calls, 1);

        // 换成不同内容，但把 mtime 精确还原成上次缓存的值
        fs::write(&path, format!("{}\n{}\n", claude_line(6, 60), claude_line(7, 70))).unwrap();
        if let Ok(f) = fs::OpenOptions::new().write(true).open(&path) {
            let _ = f.set_modified(mtime);
        }
        let m2 = parse_session_metrics_cached(&path);
        assert_eq!(m2.tool_calls, 1, "mtime 未变应命中缓存而非重新解析");
        assert_eq!(m2.total_tokens, m1.total_tokens);
        let _ = fs::remove_file(&path);
    }

    /// 文件被截断重写（size < offset）→ 回退全量重解析
    #[test]
    fn truncated_file_falls_back_to_full_parse() {
        let path = temp_session_path("trunc");
        fs::write(&path, format!("{}\n{}\n{}\n", claude_line(1, 10), claude_line(2, 20), claude_line(3, 30))).unwrap();
        touch_mtime(&path);
        let m1 = parse_session_metrics_cached(&path);
        assert_eq!(m1.tool_calls, 3);

        // 截断成一行
        fs::write(&path, format!("{}\n", claude_line(7, 70))).unwrap();
        touch_mtime(&path);
        let m2 = parse_session_metrics_cached(&path);
        assert_eq!(m2.tool_calls, 1);
        assert_eq!(m2.total_tokens, 77);
        let _ = fs::remove_file(&path);
    }

    /// torn line（文件尾部半行）不消费：下次行写完整后才解析一次
    #[test]
    fn torn_line_is_reassembled_not_double_counted() {
        let path = temp_session_path("torn");
        let line = claude_line(9, 90);
        // 先写半行（截在任意字节处，不含换行）
        let half = &line[..line.len() / 2];
        fs::write(&path, half).unwrap();
        touch_mtime(&path);
        let m1 = parse_session_metrics_cached(&path);
        assert_eq!(m1.tool_calls, 0); // 半行不解析

        // 补完整行 + 换行
        fs::write(&path, format!("{}\n", line)).unwrap();
        touch_mtime(&path);
        let m2 = parse_session_metrics_cached(&path);
        assert_eq!(m2.tool_calls, 1); // 完整后恰好解析一次，无重复计数
        assert_eq!(m2.total_tokens, 99);
        let _ = fs::remove_file(&path);
    }

    /// Codex 行：token_info 取最后一条，tool_calls 累加
    #[test]
    fn codex_incremental_tracks_last_token_info() {
        let path = temp_session_path("codex");
        fs::write(
            &path,
            concat!(
                r#"{"type":"session_meta","timestamp":"2026-08-20T01:00:00Z"}"#,
                "\n",
                r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":100},"last_token_usage":{"total_tokens":30},"model_context_window":200000}},"timestamp":"2026-08-20T01:00:01Z"}"#,
                "\n",
            ),
        )
        .unwrap();
        touch_mtime(&path);
        let m1 = parse_session_metrics_cached(&path);
        assert_eq!(m1.total_tokens, 100);
        assert_eq!(m1.context_tokens, 30);
        assert_eq!(m1.context_window, 200000);

        // 追加一条 function_call + 新 token_count
        let mut content = fs::read_to_string(&path).unwrap();
        content.push_str(concat!(
            r#"{"type":"response_item","payload":{"type":"function_call"},"timestamp":"2026-08-20T01:00:02Z"}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":250},"last_token_usage":{"total_tokens":80},"model_context_window":200000}},"timestamp":"2026-08-20T01:00:03Z"}"#,
            "\n",
        ));
        fs::write(&path, &content).unwrap();
        touch_mtime(&path);
        let m2 = parse_session_metrics_cached(&path);
        assert_eq!(m2.tool_calls, 1);
        assert_eq!(m2.total_tokens, 250);
        assert_eq!(m2.context_tokens, 80);
        let _ = fs::remove_file(&path);
    }

    /// 缓存条目数超上限整体清空（不 panic、后续可重建）
    #[test]
    fn cache_evicts_when_full() {
        let paths: Vec<_> = (0..METRICS_CACHE_MAX_ENTRIES + 1)
            .map(|i| {
                let p = temp_session_path("evict");
                let p = p.with_extension(format!("{}", i));
                fs::write(&p, format!("{}\n", claude_line(i as u64, 1))).unwrap();
                touch_mtime(&p);
                p
            })
            .collect();
        for p in &paths {
            let _ = parse_session_metrics_cached(p);
        }
        assert!(METRICS_CACHE.lock().len() <= METRICS_CACHE_MAX_ENTRIES);
        // 重建路径仍工作
        let m = parse_session_metrics_cached(&paths[0]);
        assert_eq!(m.tool_calls, 1);
        for p in &paths {
            let _ = fs::remove_file(p);
        }
    }
}
