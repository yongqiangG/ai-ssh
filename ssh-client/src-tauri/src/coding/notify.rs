//! AI Coding 待确认桌面通知（Windows toast）。
//!
//! 决策全在 Rust 侧收口（docs/situations/260817-coding-desktop-notification.md）：
//! `emit_task_status` 命中待确认状态 && 开关开 && 窗口失焦时发 toast。前台不弹，
//! 靠应用内角标。点击回跳不走 COM 激活回调（不稳定），靠 launch 参数 +
//! 单实例回调（lib.rs）→ 事件 `coding:navigate` → 前端 pendingNavigation 桥。
//! dev 模式无 AUMID 快捷方式，toast 不显示/点击无效属预期（决议 Q7），
//! 正式验证走本机 NSIS 打包安装。

use tauri::{AppHandle, Manager};

/// toast launch 参数前缀：`--aish-task=<task_id>`，单实例回调按此前缀解析。
/// 只放 task_id（uuid），不含中文/空格，规避参数编码截断问题。
pub(crate) const TASK_ARG_PREFIX: &str = "--aish-task=";

/// AUMID 必须与 tauri.conf.json 的 bundle.identifier 完全一致：Windows 按
/// AUMID 匹配开始菜单快捷方式来激活应用（docs/actions/260817 阶段 4 核验）。
#[cfg(windows)]
const APP_USER_MODEL_ID: &str = "com.johnny.ai-ssh";

/// 同任务新通知替换通知中心旧条目（tag=task_id + 固定 group）。
#[cfg(windows)]
const TOAST_GROUP: &str = "aish-attention";

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

    let app = app.clone();
    let task_id = task_id.to_string();
    let status = status.to_string();
    std::thread::spawn(move || notify_attention_blocking(&app, &task_id, &status));
}

fn notify_attention_blocking(app: &AppHandle, task_id: &str, status: &str) {
    let settings = crate::coding::app_settings::load_settings_internal();
    // is_focused 出错时按失焦处理（宁可多弹，不可漏弹）。
    let focused = app
        .get_webview_window("main")
        .is_some_and(|w| w.is_focused().unwrap_or(false));
    if !should_notify(status, settings.desktop_notifications_enabled, focused) {
        return;
    }

    // 任务按 id 遍历项目任务文件查询；查不到（已删除/持久化缺失）则不通知。
    let Some((project_name, task)) = find_task_context(task_id) else {
        eprintln!("[coding-notify] task not found, skip toast: {task_id}");
        return;
    };

    let title = task_display_title(&task);
    let agent = if task.agent == "codex" { "Codex" } else { "Claude" };
    let word = attention_status_word(status, &settings.language);
    let body = format!("{project_name} · {agent} · {word}");

    if let Err(e) = send_attention_toast(task_id, &title, &body) {
        eprintln!("[coding-notify] toast failed: {e}");
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
fn send_attention_toast(task_id: &str, title: &str, body: &str) -> Result<(), String> {
    use winrt_toast_reborn::{Toast, ToastManager};

    let manager = ToastManager::new(APP_USER_MODEL_ID);
    let mut toast = Toast::new();
    toast
        .text1(title)
        .text2(body)
        .launch(format!("{TASK_ARG_PREFIX}{task_id}"))
        .tag(task_id)
        .group(TOAST_GROUP);
    manager.show(&toast).map_err(|e| e.to_string())
}

/// 非 Windows：应用事实上只发 Windows 包，编译期保住可检查性即可。
#[cfg(not(windows))]
fn send_attention_toast(_task_id: &str, _title: &str, _body: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
