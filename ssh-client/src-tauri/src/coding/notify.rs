//! AI Coding 待确认桌面通知（Windows toast）。
//!
//! 决策全在 Rust 侧收口（docs/situations/260817-coding-desktop-notification.md）：
//! `emit_task_status` 命中待确认状态 && 开关开 && 窗口失焦时发 toast。前台不弹
//! OS toast——前台且待确认任务「当前不可见」的场景由前端应用内横幅负责
//! （features/aiCoding/attention.ts，260818 决议），两路判定天然互斥。
//!
//! 发送：windows-rs 系统模板（GetTemplateContent）——手拼 ToastGeneric XML 会被
//! shell 静默拒收（Show Ok 但不渲染，真机实测见 docs/actions/done/260817 阶段4）。
//! 点击回跳：进程内 `ToastNotification::Activated` 回调（应用存活期间触发，
//! launch 参数经 `Arguments()` 取回）→ emit `coding:navigate` → 前端
//! pendingNavigation 桥。原计划依赖的「launch 属性 + 快捷方式兜底启动」在
//! 无 COM 激活器注册的 Win10 上不触发，单实例回调解析（lib.rs）仅作备用保留。
//! dev 模式无 AUMID 快捷方式，toast 不显示属预期（决议 Q7）。

use tauri::{AppHandle, Manager};

/// toast launch 参数前缀：`--aish-task=<task_id>`，Activated 回调与单实例
/// 回调（lib.rs，备用路径）都按此前缀解析。只放 task_id（uuid），不含
/// 中文/空格，规避编码截断问题。
pub(crate) const TASK_ARG_PREFIX: &str = "--aish-task=";

/// AUMID 必须与 tauri.conf.json 的 bundle.identifier 完全一致：Windows 按
/// AUMID 匹配开始菜单快捷方式来激活应用（docs/actions/260817 阶段 4 核验）。
#[cfg(windows)]
const APP_USER_MODEL_ID: &str = "com.johnny.ai-ssh";

/// 同任务新通知替换通知中心旧条目（tag=task_id + 固定 group）。
#[cfg(windows)]
const TOAST_GROUP: &str = "aish-attention";

/// toast 音效（260818 决议）：IM 双音比默认 Notification.Default 更有存在感。
/// src 只能取系统预置 ms-winsoundevent 白名单值——乱写会让整条 toast 不弹。
#[cfg(windows)]
const TOAST_AUDIO_SRC: &str = "ms-winsoundevent:Notification.IM";

/// 仅待确认状态通知：input_required=工具审批/问询（agent 卡住）；
/// awaiting_review=Stop 一轮结束待验收。done/failed 无时效，不通知。
pub(crate) fn is_attention_status(status: &str) -> bool {
    matches!(status, "input_required" | "awaiting_review")
}

/// 通知判定（纯函数）：目标状态 && 开关开 && 窗口失焦。
pub(crate) fn should_notify(status: &str, enabled: bool, window_focused: bool) -> bool {
    is_attention_status(status) && enabled && !window_focused
}

/// toast 状态词，跟随前端语言（app_settings.language 由前端启动/切换时同步）。
pub(crate) fn attention_status_word(status: &str, language: &str) -> &'static str {
    match (status, language) {
        ("input_required", "zh") => "需要确认",
        ("input_required", _) => "Needs confirmation",
        ("awaiting_review", "zh") => "已完成待验收",
        (_, _) => "Awaiting review",
    }
}

/// 从进程启动参数中解析 toast launch 参数（`--aish-task=<task_id>`）。
/// 取首个命中；前缀命中但值为空视为无效——解析失败=不导航（正常拉起窗口）。
pub(crate) fn parse_task_launch_arg<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().find_map(|arg| {
        let id = arg.as_ref().strip_prefix(TASK_ARG_PREFIX)?;
        (!id.is_empty()).then(|| id.to_string())
    })
}

/// `emit_task_status` 的通知挂点。设置读取（磁盘）+ 任务上下文查询（磁盘）
/// + COM 调用整体放后台线程，失败只 log，绝不打断状态事件本身。
pub(crate) fn maybe_notify_attention(app: &AppHandle, task_id: &str, status: &str) {
    if !is_attention_status(status) {
        return;
    }
    debug_log(&format!("attention: task={task_id} status={status}"));

    let app = app.clone();
    let task_id = task_id.to_string();
    let status = status.to_string();
    std::thread::spawn(move || notify_attention_blocking(&app, &task_id, &status));
}

/// 诊断日志：release 构建无控制台，eprintln 不可见——通知链路的关键决策
/// 落 `~/.ai-ssh/coding/notify-debug.log`，每行一条，现场排障用。
pub(crate) fn debug_log(line: &str) {
    use std::io::Write;
    let Some(dir) = crate::coding::storage::coding_dir().ok() else {
        return;
    };
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("notify-debug.log"))
    else {
        return;
    };
    let _ = writeln!(
        file,
        "{} {line}",
        chrono::Local::now().format("%m-%d %H:%M:%S")
    );
}

/// 启动时截断 debug 日志（260820 评审 P2-7）。该日志无轮转、无上限，若不
/// 截断会随每次待确认事件无限追加。保留当次会话的日志即可满足排障需求
/// （Win10 toast 排障先例都是现场看当次记录）；无文件时静默跳过。
pub(crate) fn truncate_debug_log() {
    let Some(dir) = crate::coding::storage::coding_dir().ok() else {
        return;
    };
    truncate_log_file(&dir.join("notify-debug.log"));
}

/// `truncate_debug_log` 的内核（测试可注入任意路径）：把已存在的文件截断为
/// 空文件；不存在则跳过。
fn truncate_log_file(path: &std::path::Path) {
    if !path.exists() {
        return;
    }
    if let Ok(file) = std::fs::File::create(path) {
        drop(file);
    }
}

fn notify_attention_blocking(app: &AppHandle, task_id: &str, status: &str) {
    let settings = crate::coding::app_settings::load_settings_internal();
    // is_focused 出错时按失焦处理（宁可多弹，不可漏弹）。
    let focused = app
        .get_webview_window("main")
        .is_some_and(|w| w.is_focused().unwrap_or(false));
    if !should_notify(status, settings.desktop_notifications_enabled, focused) {
        debug_log(&format!(
            "skip: status={status} enabled={} focused={focused}",
            settings.desktop_notifications_enabled
        ));
        return;
    }

    // 任务按 id 遍历项目任务文件查询；查不到（已删除/持久化缺失）则不通知。
    let Some((project_name, task)) = find_task_context(task_id) else {
        debug_log(&format!("skip: task not found {task_id}"));
        return;
    };

    let title = task_display_title(&task);
    let agent = if task.agent == "codex" { "Codex" } else { "Claude" };
    let word = attention_status_word(status, &settings.language);
    let body = format!("{project_name} · {agent} · {word}");
    debug_log(&format!(
        "send: task={task_id} status={status} focused={focused} title={title}"
    ));

    match send_attention_toast(app, task_id, &title, &body) {
        Ok(()) => debug_log("toast: ok"),
        Err(e) => debug_log(&format!("toast: FAILED {e}")),
    }
}

fn find_task_context(task_id: &str) -> Option<(String, crate::coding::storage::Task)> {
    let projects = crate::coding::storage::coding_load_projects().ok()?;
    for project in projects {
        let tasks = crate::coding::storage::coding_load_project_tasks(project.id.clone()).ok()?;
        if let Some(task) = tasks.into_iter().find(|t| t.id == task_id) {
            return Some((project.name, task));
        }
    }
    None
}

/// 与前端 KanbanView::taskTitle 同规则：任务名优先，否则取 prompt 首行。
fn task_display_title(task: &crate::coding::storage::Task) -> String {
    if let Some(name) = task.name.as_deref() {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    task.prompt
        .trim()
        .split('\n')
        .next()
        .filter(|line| !line.is_empty())
        .unwrap_or("(untitled)")
        .to_string()
}

#[cfg(windows)]
fn send_attention_toast(app: &AppHandle, task_id: &str, title: &str, body: &str) -> Result<(), String> {
    // 走系统模板（GetTemplateContent）而非手拼 XML：探针差分实测
    // （260817 阶段 4），手拼 ToastGeneric 文档被 shell 静默拒收
    // （Show 返回 Ok 但不显示、无 Failed/Dismissed 事件），模板路径稳定弹。
    //
    // 点击回跳走进程内 Activated 事件：launch 属性 + 快捷方式兜底启动在
    // 本机 Win10 19045（无 COM 激活器注册）不触发——点击不拉起应用。
    // Activated 回调在应用存活期间于进程内触发（探针 v4 实测），
    // 恰好匹配「只支持热点击」的决议；冷点击（应用已关）无行为，符合设计。
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::OnceLock;

    use parking_lot::Mutex;
    use windows::{
        core::{HSTRING, Interface},
        Data::Xml::Dom::IXmlNode,
        Foundation::TypedEventHandler,
        UI::Notifications::{
            ToastActivatedEventArgs, ToastNotification, ToastNotificationManager,
            ToastTemplateType,
        },
    };

    /// 保活注册表：Activated 事件接线随 ToastNotification 对象销毁而断。
    /// 同任务新 toast 替换旧条目（与 tag/group 语义一致）；跨任务只增不减，
    /// 设容量上限按插入序 FIFO 逐出最老——被逐出的旧 toast 若还躺在通知中心，
    /// 点击无反应（可接受：距其待确认已隔 ≥64 个任务事件）。
    static LIVE_TOASTS: OnceLock<Mutex<HashMap<String, (u64, ToastNotification)>>> =
        OnceLock::new();
    static LIVE_TOASTS_SEQ: AtomicU64 = AtomicU64::new(0);
    const LIVE_TOASTS_CAP: usize = 64;
    let live_toasts = LIVE_TOASTS.get_or_init(|| Mutex::new(HashMap::new()));

    let doc = ToastNotificationManager::GetTemplateContent(ToastTemplateType::ToastText02)
        .map_err(|e| format!("template: {e}"))?;
    let texts = doc
        .GetElementsByTagName(&HSTRING::from("text"))
        .map_err(|e| format!("texts: {e}"))?;
    let fill = |idx: u32, text: &str| -> Result<(), String> {
        let node = texts.Item(idx).map_err(|e| format!("item: {e}"))?;
        let text_node = doc
            .CreateTextNode(&HSTRING::from(text))
            .map_err(|e| format!("text node: {e}"))?;
        node.AppendChild(&text_node.cast::<IXmlNode>().map_err(|e| format!("cast: {e}"))?)
            .map_err(|e| format!("append: {e}"))?;
        Ok(())
    };
    fill(0, title)?;
    fill(1, body)?;

    // launch 属性挂在 toast 根元素上——Activated 回调经 Arguments() 取回
    let root = doc
        .DocumentElement()
        .map_err(|e| format!("root: {e}"))?;
    root.SetAttribute(&HSTRING::from("launch"), &HSTRING::from(format!("{TASK_ARG_PREFIX}{task_id}")))
        .map_err(|e| format!("launch: {e}"))?;

    // 音效：模板 DOM 追加 <audio> 子元素（与 launch 属性同类改写，不走手拼
    // XML 雷区）。注意用户侧 Windows 通知设置关闭横幅声音/专注助手会吞掉
    // 声音——系统管制，属预期行为。
    let audio = doc
        .CreateElement(&HSTRING::from("audio"))
        .map_err(|e| format!("audio: {e}"))?;
    audio
        .SetAttribute(&HSTRING::from("src"), &HSTRING::from(TOAST_AUDIO_SRC))
        .map_err(|e| format!("audio src: {e}"))?;
    root.AppendChild(&audio.cast::<IXmlNode>().map_err(|e| format!("audio cast: {e}"))?)
        .map_err(|e| format!("audio append: {e}"))?;

    let notification = ToastNotification::CreateToastNotification(&doc)
        .map_err(|e| format!("create: {e}"))?;
    // tag/group：同任务新通知替换通知中心旧条目
    notification
        .SetTag(&HSTRING::from(task_id))
        .map_err(|e| format!("tag: {e}"))?;
    notification
        .SetGroup(&HSTRING::from(TOAST_GROUP))
        .map_err(|e| format!("group: {e}"))?;

    // 点击回调：拉窗口 + emit coding:navigate（与单实例回调同一前端链路）
    let app = app.clone();
    let handler = TypedEventHandler::<ToastNotification, windows::core::IInspectable>::new(
        move |_sender, args| {
            let arg = args
                .as_ref()
                .and_then(|a| a.cast::<ToastActivatedEventArgs>().ok())
                .and_then(|e| e.Arguments().ok())
                .map(|s| s.to_string())
                .unwrap_or_default();
            debug_log(&format!("toast activated: arg={arg}"));
            if let Some(nav_task_id) = parse_task_launch_arg([arg]) {
                focus_main_window(&app);
                let _ = crate::coding::events::publish(&app,
                    "coding:navigate",
                    serde_json::json!({ "task_id": nav_task_id }),
                );
            }
            Ok(())
        },
    );
    notification
        .Activated(&handler)
        .map_err(|e| format!("activated: {e}"))?;

    {
        let mut guard = live_toasts.lock();
        if guard.len() >= LIVE_TOASTS_CAP {
            if let Some(oldest) = guard
                .iter()
                .min_by_key(|(_, (seq, _))| *seq)
                .map(|(k, _)| k.clone())
            {
                guard.remove(&oldest);
            }
        }
        let seq = LIVE_TOASTS_SEQ.fetch_add(1, Ordering::Relaxed);
        guard.insert(task_id.to_string(), (seq, notification.clone()));
    }

    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_USER_MODEL_ID))
        .map_err(|e| format!("notifier: {e}"))?;
    notifier
        .Show(&notification)
        .map_err(|e| format!("show: {e}"))
}

/// 与单实例回调同款拉窗逻辑（lib.rs）：点击 toast 后窗口必须到前台。
#[cfg(windows)]
fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 非 Windows：应用事实上只发 Windows 包，编译期保住可检查性即可（决议 Q10）。
#[cfg(not(windows))]
fn send_attention_toast(_app: &AppHandle, _task_id: &str, _title: &str, _body: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 日志截断（P2-7）：已有内容的文件被清空；不存在的文件不创建
    #[test]
    fn truncate_log_file_empties_existing_and_skips_missing() {
        let dir = std::env::temp_dir().join(format!("nezha-notify-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("notify-debug.log");
        std::fs::write(&log, "line1
line2
").unwrap();

        truncate_log_file(&log);
        assert_eq!(std::fs::read_to_string(&log).unwrap(), "");

        let missing = dir.join("no-such.log");
        truncate_log_file(&missing);
        assert!(!missing.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn should_notify_requires_attention_status_toggle_and_unfocused() {
        // 目标状态 + 开关开 + 失焦 → 弹
        assert!(should_notify("input_required", true, false));
        assert!(should_notify("awaiting_review", true, false));
        // 开关关 / 前台 / 非目标状态 → 不弹
        assert!(!should_notify("input_required", false, false));
        assert!(!should_notify("input_required", true, true));
        assert!(!should_notify("awaiting_review", true, true));
        assert!(!should_notify("running", true, false));
        assert!(!should_notify("done", true, false));
        assert!(!should_notify("failed", true, false));
    }

    #[test]
    fn status_word_follows_language() {
        assert_eq!(attention_status_word("input_required", "zh"), "需要确认");
        assert_eq!(
            attention_status_word("input_required", "en"),
            "Needs confirmation"
        );
        assert_eq!(
            attention_status_word("awaiting_review", "zh"),
            "已完成待验收"
        );
        assert_eq!(
            attention_status_word("awaiting_review", "en"),
            "Awaiting review"
        );
        // 未知语言回退英文；未知状态回退 awaiting_review 的英文文案
        assert_eq!(
            attention_status_word("input_required", "fr"),
            "Needs confirmation"
        );
        assert_eq!(attention_status_word("weird", "zh"), "Awaiting review");
    }

    #[test]
    fn parse_task_launch_arg_cases() {
        let hit = ["--aish-task=abc-123"];
        assert_eq!(
            parse_task_launch_arg(hit),
            Some("abc-123".to_string()),
            "单个命中参数应解析出 task_id"
        );

        let among_others = ["--flag", "--aish-task=xyz", "positional"];
        assert_eq!(parse_task_launch_arg(among_others), Some("xyz".to_string()));

        let empty = ["--aish-task="];
        assert_eq!(parse_task_launch_arg(empty), None, "空值视为无效");

        let none = ["--flag", "positional"];
        assert_eq!(parse_task_launch_arg(none), None, "无命中不导航");

        let empty_iter: [&str; 0] = [];
        assert_eq!(parse_task_launch_arg(empty_iter), None);
    }

    #[test]
    fn task_display_title_mirrors_frontend_task_title() {
        use crate::coding::storage::Task;
        let mut task = Task {
            id: "t".into(),
            project_id: "p".into(),
            name: None,
            prompt: "first line\nsecond line".into(),
            agent: "claude".into(),
            permission_mode: "ask".into(),
            model: None,
            reasoning_effort: None,
            status: "running".into(),
            created_at: 0,
            updated_at: None,
            attention_requested_at: None,
            claude_session_id: None,
            claude_session_path: None,
            codex_session_id: None,
            codex_session_path: None,
            starred: None,
            failure_reason: None,
        };
        assert_eq!(task_display_title(&task), "first line");
        task.name = Some("  named  ".into());
        assert_eq!(task_display_title(&task), "named");
        task.name = Some("   ".into());
        task.prompt = "\n  ".into();
        assert_eq!(task_display_title(&task), "(untitled)");
    }
}
