use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use super::{TaskManager, TaskSession};

const MAX_DISCOVERED_SESSIONS: usize = 200;
const MAX_SESSION_SCAN_LINES: usize = 256;
const MAX_TITLE_CHARS: usize = 160;
const SESSION_WATCH_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSummary {
    pub(crate) agent: String,
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) session_path: Option<String>,
    pub(crate) title: String,
    pub(crate) modified_at: u64,
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .or_else(|| {
                let drive = std::env::var_os("HOMEDRIVE")?;
                let path = std::env::var_os("HOMEPATH")?;
                let mut home = PathBuf::from(drive);
                home.push(path);
                Some(home)
            })
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn validate_project_path(project_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(project_path);
    if !path.is_absolute() {
        return Err("Project path must be absolute".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Cannot resolve project path: {error}"))?;
    if !canonical.is_dir() {
        return Err("Project path is not a directory".to_string());
    }
    Ok(canonical)
}

fn encode_claude_project_path(project_path: &str) -> String {
    project_path
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn codex_sessions_roots(project_path: &Path) -> Vec<PathBuf> {
    let mut roots = vec![project_path.join(".codex").join("sessions")];
    if let Some(home) = home_dir() {
        let home_root = home.join(".codex").join("sessions");
        if !roots.iter().any(|root| root == &home_root) {
            roots.push(home_root);
        }
    }
    roots
}

fn claude_sessions_root(project_path: &Path) -> Option<PathBuf> {
    let home = home_dir()?;
    let encoded = encode_claude_project_path(&project_path.to_string_lossy());
    Some(home.join(".claude").join("projects").join(encoded))
}

fn collect_session_files(dir: &Path, agent: &str, output: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_session_files(&path, agent, output);
            continue;
        }
        let is_jsonl = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"));
        if !is_jsonl {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if agent == "codex" && !file_name.starts_with("rollout-") {
            continue;
        }
        output.push(path);
    }
}

fn session_files(project_path: &Path, agent: &str) -> Vec<PathBuf> {
    let roots = if agent == "codex" {
        codex_sessions_roots(project_path)
    } else {
        claude_sessions_root(project_path)
            .into_iter()
            .collect::<Vec<_>>()
    };
    let mut files = Vec::new();
    for root in roots {
        collect_session_files(&root, agent, &mut files);
    }
    files
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn object_string(value: &Value, key: &str) -> Option<String> {
    value
        .as_object()
        .and_then(|object| non_empty_string(object.get(key)))
}

fn extract_session_id(value: &Value, agent: &str) -> Option<String> {
    let id = if agent == "codex" {
        if value.get("type").and_then(Value::as_str) == Some("session_meta") {
            value
                .get("payload")
                .and_then(|payload| object_string(payload, "id"))
                .or_else(|| {
                    value
                        .get("payload")
                        .and_then(|payload| object_string(payload, "session_id"))
                })
        } else {
            object_string(value, "session_id")
                .or_else(|| object_string(value, "sessionId"))
                .or_else(|| {
                    value
                        .get("payload")
                        .and_then(|payload| object_string(payload, "id"))
                })
                .or_else(|| {
                    value
                        .get("payload")
                        .and_then(|payload| object_string(payload, "session_id"))
                })
        }
    } else {
        object_string(value, "sessionId")
            .or_else(|| object_string(value, "session_id"))
            .or_else(|| {
                value
                    .get("message")
                    .and_then(|message| object_string(message, "sessionId"))
            })
            .or_else(|| {
                value
                    .get("message")
                    .and_then(|message| object_string(message, "session_id"))
            })
    }?;

    if id.len() <= 256 && !id.chars().any(char::is_control) {
        Some(id)
    } else {
        None
    }
}

fn content_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(|item| {
                    item.get("text")
                        .or_else(|| item.get("input_text"))
                        .and_then(Value::as_str)
                })
                .collect::<Vec<_>>()
                .join("");
            (!text.trim().is_empty()).then_some(text)
        }
        Value::Object(object) => object
            .get("text")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        _ => None,
    }
}

fn extract_user_title(value: &Value, agent: &str) -> Option<String> {
    let event_type = value.get("type").and_then(Value::as_str);
    if agent == "claude" && event_type == Some("user") {
        return content_text(
            value
                .get("message")
                .and_then(|message| message.get("content"))
                .or_else(|| value.get("content")),
        );
    }
    if agent == "codex"
        && event_type == Some("response_item")
        && value
            .get("payload")
            .and_then(|payload| payload.get("role"))
            .and_then(Value::as_str)
            == Some("user")
    {
        return content_text(
            value
                .get("payload")
                .and_then(|payload| payload.get("content")),
        );
    }
    None
}

fn compact_title(text: Option<String>) -> String {
    let compact = text
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut chars = compact.chars();
    let shortened = chars.by_ref().take(MAX_TITLE_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{shortened}…")
    } else if shortened.is_empty() {
        "(untitled session)".to_string()
    } else {
        shortened
    }
}

fn modified_at(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn summarize_file(path: &Path, agent: &str) -> Option<SessionSummary> {
    let file = File::open(path).ok()?;
    let mut session_id = None;
    let mut title = None;
    for line in BufReader::new(file)
        .lines()
        .take(MAX_SESSION_SCAN_LINES)
        .map_while(Result::ok)
    {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if session_id.is_none() {
            session_id = extract_session_id(&value, agent);
        }
        if title.is_none() {
            title = extract_user_title(&value, agent);
        }
        if session_id.is_some() && title.is_some() {
            break;
        }
    }
    let session_id = session_id?;
    Some(SessionSummary {
        agent: agent.to_string(),
        session_id,
        session_path: Some(path.to_string_lossy().into_owned()),
        title: compact_title(title),
        modified_at: modified_at(path),
    })
}

fn discover_sessions_inner(project_path: &str, agent: &str) -> Result<Vec<SessionSummary>, String> {
    if !matches!(agent, "claude" | "codex") {
        return Err(format!("unsupported local agent: {agent}"));
    }
    let project_path = validate_project_path(project_path)?;
    let mut paths = session_files(&project_path, agent);
    paths.sort();
    paths.dedup();

    let mut seen = HashSet::new();
    let mut sessions = paths
        .iter()
        .filter_map(|path| summarize_file(path, agent))
        .filter(|session| seen.insert(session.session_path.clone()))
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    sessions.truncate(MAX_DISCOVERED_SESSIONS);
    Ok(sessions)
}

fn emit_task_session(app: &AppHandle, task_id: &str, session: &SessionSummary) {
    let _ = app.emit(
        "task-session",
        serde_json::json!({
            "task_id": task_id,
            "agent": session.agent,
            "session_id": session.session_id,
            "session_path": session.session_path,
            "title": session.title,
            "modified_at": session.modified_at,
        }),
    );
}

fn remember_session(app: &AppHandle, task_id: &str, session: SessionSummary) {
    let task_manager = app.state::<TaskManager>();
    let changed = task_manager.set_session(
        task_id.to_string(),
        TaskSession {
            session_id: session.session_id.clone(),
            session_path: session.session_path.clone(),
        },
    );
    if changed {
        emit_task_session(app, task_id, &session);
    }
}

fn watcher_roots(project_path: &Path, agent: &str) -> Vec<PathBuf> {
    if agent == "codex" {
        codex_sessions_roots(project_path)
    } else {
        claude_sessions_root(project_path)
            .into_iter()
            .collect::<Vec<_>>()
    }
}

fn millis_since_epoch(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn spawn_task_session_watcher(
    app: AppHandle,
    task_id: String,
    project_path: PathBuf,
    agent: String,
    started_at: SystemTime,
    known_session_id: Option<String>,
) {
    thread::spawn(move || {
        if let Some(session_id) = known_session_id {
            remember_session(
                &app,
                &task_id,
                SessionSummary {
                    agent: agent.clone(),
                    session_id,
                    session_path: None,
                    title: "(resumed session)".to_string(),
                    modified_at: millis_since_epoch(SystemTime::now()),
                },
            );
            return;
        }

        let (event_tx, event_rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let _ = event_tx.send(event);
            })
            .ok();
        if let Some(watcher_ref) = watcher.as_mut() {
            for root in watcher_roots(&project_path, &agent) {
                if root.is_dir() {
                    let _ = watcher_ref.watch(&root, RecursiveMode::Recursive);
                }
            }
        }

        let deadline = std::time::Instant::now() + SESSION_WATCH_TIMEOUT;
        let started_at = millis_since_epoch(started_at).saturating_sub(2_000);
        while std::time::Instant::now() < deadline {
            if !app.state::<TaskManager>().is_active(&task_id) {
                return;
            }
            if let Ok(sessions) = discover_sessions_inner(&project_path.to_string_lossy(), &agent) {
                if let Some(session) = sessions
                    .into_iter()
                    .find(|session| session.modified_at >= started_at)
                {
                    remember_session(&app, &task_id, session);
                    return;
                }
            }
            let _ = event_rx.recv_timeout(Duration::from_millis(250));
        }
    });
}

#[tauri::command]
pub async fn discover_sessions(
    project_path: String,
    agent: String,
) -> Result<Vec<SessionSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || discover_sessions_inner(&project_path, &agent))
        .await
        .map_err(|error| format!("discover sessions failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_claude_project_path_like_the_cli_storage_directory() {
        assert_eq!(
            encode_claude_project_path(r"D:\project\ai-ssh"),
            "D--project-ai-ssh"
        );
        assert_eq!(encode_claude_project_path("/tmp/a-b"), "-tmp-a-b");
    }

    #[test]
    fn extracts_claude_session_id_and_first_user_title() {
        let value: Value = serde_json::from_str(
            r#"{"type":"user","sessionId":"claude-session","message":{"content":[{"type":"text","text":"  Fix the PTY bug  "}]}}"#,
        )
        .expect("valid Claude jsonl");
        assert_eq!(
            extract_session_id(&value, "claude"),
            Some("claude-session".to_string())
        );
        assert_eq!(
            extract_user_title(&value, "claude"),
            Some("  Fix the PTY bug  ".to_string())
        );
        assert_eq!(
            compact_title(extract_user_title(&value, "claude")),
            "Fix the PTY bug"
        );
    }

    #[test]
    fn extracts_codex_session_meta_and_user_title() {
        let meta: Value = serde_json::from_str(
            r#"{"type":"session_meta","payload":{"id":"codex-session","cwd":"D:\\project"}}"#,
        )
        .expect("valid Codex metadata");
        assert_eq!(
            extract_session_id(&meta, "codex"),
            Some("codex-session".to_string())
        );

        let user: Value = serde_json::from_str(
            r#"{"type":"response_item","payload":{"role":"user","content":[{"type":"input_text","text":"Inspect the session store"}]}}"#,
        )
        .expect("valid Codex response item");
        assert_eq!(
            extract_user_title(&user, "codex"),
            Some("Inspect the session store".to_string())
        );
    }
}
