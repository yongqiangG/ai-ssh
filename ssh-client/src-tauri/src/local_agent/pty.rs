use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, SystemTime};

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};

use super::agent_bin::{resolve_agent_launch_spec, AgentLaunchSpec};
use super::{TaskHandle, TaskManager};

const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 40;
const MIN_PTY_DIMENSION: u16 = 2;
const MAX_PTY_DIMENSION: u16 = 10_000;
const PTY_READ_BUFFER_SIZE: usize = 32 * 1024;
const PTY_EMIT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const PTY_EMIT_MAX_BATCH_BYTES: usize = 64 * 1024;
const PTY_EMIT_CHANNEL_CAPACITY: usize = 32;
const MAX_TASK_ID_BYTES: usize = 128;
const MAX_SESSION_ID_BYTES: usize = 256;
const MAX_ATTACHMENT_COUNT: usize = 32;
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 5 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgentKind {
    Claude,
    Codex,
}

impl AgentKind {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "claude" => Ok(Self::Claude),
            "codex" => Ok(Self::Codex),
            other => Err(format!("unsupported local agent: {other}")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PermissionMode {
    Ask,
    AutoEdit,
    FullAccess,
}

impl PermissionMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "" | "ask" => Ok(Self::Ask),
            "auto_edit" => Ok(Self::AutoEdit),
            "full_access" => Ok(Self::FullAccess),
            other => Err(format!("unsupported permission mode: {other}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum LaunchOperation {
    Run(String),
    Resume(String),
    Fork(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CommandSpec {
    program: String,
    args: Vec<String>,
    extra_env: Vec<(String, String)>,
}

fn normalize_cli_option(
    value: Option<&str>,
    field: &str,
    max_bytes: usize,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.chars().any(char::is_control) {
        return Err(format!("{field} cannot contain control characters"));
    }
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > max_bytes {
        return Err(format!("{field} is too long (maximum {max_bytes} bytes)"));
    }
    Ok(Some(trimmed.to_string()))
}

fn normalize_task_id(value: &str) -> Result<String, String> {
    let normalized = normalize_cli_option(Some(value), "Task id", MAX_TASK_ID_BYTES)?
        .ok_or_else(|| "Task id is required".to_string())?;
    if normalized
        .chars()
        .any(|character| matches!(character, '/' | '\\' | ':'))
    {
        return Err("Task id cannot contain path separators".to_string());
    }
    Ok(normalized)
}

fn normalize_session_id(value: &str, field: &str) -> Result<String, String> {
    normalize_cli_option(Some(value), field, MAX_SESSION_ID_BYTES)?
        .ok_or_else(|| format!("{field} is required"))
}

fn validate_project_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
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

fn validate_pty_size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(MIN_PTY_DIMENSION..=MAX_PTY_DIMENSION).contains(&cols)
        || !(MIN_PTY_DIMENSION..=MAX_PTY_DIMENSION).contains(&rows)
    {
        return Err(format!(
            "PTY size must be between {MIN_PTY_DIMENSION} and {MAX_PTY_DIMENSION} columns/rows"
        ));
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn resolve_pty_size(cols: Option<u16>, rows: Option<u16>) -> Result<PtySize, String> {
    validate_pty_size(
        cols.unwrap_or(DEFAULT_PTY_COLS),
        rows.unwrap_or(DEFAULT_PTY_ROWS),
    )
}

fn build_command_spec(
    agent: &str,
    launch: &AgentLaunchSpec,
    permission_mode: &str,
    operation: LaunchOperation,
) -> Result<CommandSpec, String> {
    let agent = AgentKind::parse(agent)?;
    let permission = PermissionMode::parse(permission_mode)?;
    if launch.program.trim().is_empty() {
        return Err(format!(
            "{} executable was not found on PATH; install the agent or configure its path",
            agent.as_str()
        ));
    }

    let mut args = Vec::new();
    match (agent, permission) {
        (AgentKind::Claude, PermissionMode::Ask) => {
            args.extend(["--permission-mode", "default"].map(str::to_string));
        }
        (AgentKind::Claude, PermissionMode::AutoEdit) => {
            args.extend(["--permission-mode", "acceptEdits"].map(str::to_string));
        }
        (AgentKind::Claude, PermissionMode::FullAccess) => {
            args.push("--dangerously-skip-permissions".to_string());
        }
        (AgentKind::Codex, PermissionMode::Ask) => {}
        (AgentKind::Codex, PermissionMode::AutoEdit) => {
            args.extend(["--sandbox", "workspace-write", "-a", "on-request"].map(str::to_string));
        }
        (AgentKind::Codex, PermissionMode::FullAccess) => {
            args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        }
    }

    match (agent, operation) {
        (AgentKind::Claude, LaunchOperation::Run(prompt)) => {
            if !prompt.is_empty() {
                args.push(prompt);
            }
        }
        (AgentKind::Claude, LaunchOperation::Resume(session_id)) => {
            args.extend(["--resume".to_string(), session_id]);
        }
        (AgentKind::Claude, LaunchOperation::Fork(session_id)) => {
            args.extend([
                "--resume".to_string(),
                session_id,
                "--fork-session".to_string(),
            ]);
        }
        (AgentKind::Codex, LaunchOperation::Run(prompt)) => {
            if !prompt.is_empty() {
                args.extend(["--".to_string(), prompt]);
            }
        }
        (AgentKind::Codex, LaunchOperation::Resume(session_id)) => {
            args.extend(["resume".to_string(), session_id]);
        }
        (AgentKind::Codex, LaunchOperation::Fork(session_id)) => {
            args.extend(["fork".to_string(), session_id]);
        }
    }

    Ok(CommandSpec {
        program: launch.program.clone(),
        args,
        extra_env: launch.extra_env.clone(),
    })
}

fn spawn_process(
    command: &CommandSpec,
    project_path: &Path,
    size: PtySize,
) -> Result<(Arc<TaskHandle>, Box<dyn Read + Send>), String> {
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| format!("open local PTY failed: {error}"))?;

    let mut builder = CommandBuilder::new(&command.program);
    for argument in &command.args {
        builder.arg(argument);
    }
    builder.cwd(project_path);
    builder.env("TERM", "xterm-256color");
    builder.env("COLORTERM", "truecolor");
    for (key, value) in &command.extra_env {
        builder.env(key, value);
    }

    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(|error| format!("start local agent failed: {error}"))?;
    drop(pair.slave);

    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            let _ = child.kill();
            return Err(format!("clone local PTY reader failed: {error}"));
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            let _ = child.kill();
            return Err(format!("open local PTY writer failed: {error}"));
        }
    };

    let handle = Arc::new(TaskHandle {
        master: std::sync::Mutex::new(pair.master),
        writer: std::sync::Mutex::new(writer),
        child: std::sync::Mutex::new(child),
    });
    Ok((handle, reader))
}

fn launch_task(
    task_manager: &TaskManager,
    task_id: &str,
    project_path: &Path,
    agent: &str,
    permission_mode: &str,
    operation: LaunchOperation,
    size: PtySize,
) -> Result<(Arc<TaskHandle>, Box<dyn Read + Send>), String> {
    let launch = resolve_agent_launch_spec(agent, None);
    let command = build_command_spec(agent, &launch, permission_mode, operation)?;
    let (handle, reader) = spawn_process(&command, project_path, size)?;
    if let Err(error) = task_manager.insert_task(task_id.to_string(), handle.clone()) {
        handle.kill();
        return Err(error);
    }
    Ok((handle, reader))
}

fn emit_task_status(app: &AppHandle, task_id: &str, status: &str) {
    let _ = app.emit(
        "task-status",
        serde_json::json!({ "task_id": task_id, "status": status }),
    );
}

fn task_attachments_dir(project_path: &Path, task_id: &str) -> PathBuf {
    project_path
        .join(".nezha")
        .join("attachments")
        .join(task_id)
}

fn save_task_images(
    project_path: &Path,
    task_id: &str,
    images: &[String],
) -> Result<Vec<String>, String> {
    if images.len() > MAX_ATTACHMENT_COUNT {
        return Err(format!(
            "too many image attachments (maximum {MAX_ATTACHMENT_COUNT})"
        ));
    }
    if images.is_empty() {
        return Ok(Vec::new());
    }

    let directory = task_attachments_dir(project_path, task_id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("create attachments directory failed: {error}"))?;
    let mut paths = Vec::with_capacity(images.len());
    for (index, data_url) in images.iter().enumerate() {
        let (header, encoded) = data_url
            .split_once(',')
            .ok_or_else(|| "invalid image data URL".to_string())?;
        let header_lower = header.to_ascii_lowercase();
        if !header_lower.starts_with("data:image/") || !header_lower.contains(";base64") {
            return Err("image attachments must be base64 data URLs".to_string());
        }
        let extension = match header_lower
            .strip_prefix("data:image/")
            .and_then(|mime| mime.split(';').next())
        {
            Some("jpeg") | Some("jpg") => "jpg",
            Some("gif") => "gif",
            Some("webp") => "webp",
            Some("png") => "png",
            _ => return Err("unsupported image attachment type".to_string()),
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .map_err(|error| format!("decode image attachment failed: {error}"))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(format!(
                "image attachment is too large (maximum {MAX_IMAGE_BYTES} bytes)"
            ));
        }
        let path = directory.join(format!("{index}.{extension}"));
        fs::write(&path, bytes)
            .map_err(|error| format!("write image attachment failed: {error}"))?;
        paths.push(path.to_string_lossy().into_owned());
    }
    Ok(paths)
}

fn save_task_texts(
    project_path: &Path,
    task_id: &str,
    texts: &[String],
) -> Result<Vec<String>, String> {
    if texts.len() > MAX_ATTACHMENT_COUNT {
        return Err(format!(
            "too many text attachments (maximum {MAX_ATTACHMENT_COUNT})"
        ));
    }
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let directory = task_attachments_dir(project_path, task_id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("create attachments directory failed: {error}"))?;
    let mut paths = Vec::with_capacity(texts.len());
    for (index, text) in texts.iter().enumerate() {
        if text.len() > MAX_TEXT_BYTES {
            return Err(format!(
                "text attachment is too large (maximum {MAX_TEXT_BYTES} bytes)"
            ));
        }
        let path = directory.join(format!("paste_{index}.txt"));
        fs::write(&path, text.as_bytes())
            .map_err(|error| format!("write text attachment failed: {error}"))?;
        paths.push(path.to_string_lossy().into_owned());
    }
    Ok(paths)
}

fn prompt_with_attachments(
    prompt: String,
    image_paths: &[String],
    text_paths: &[String],
) -> String {
    let mut result = prompt;
    if !image_paths.is_empty() {
        result.push_str("\n\n[Attached images]\n");
        result.push_str(&image_paths.join("\n"));
    }
    if !text_paths.is_empty() {
        result.push_str("\n\n[Attached text files — read these for full context]\n");
        result.push_str(&text_paths.join("\n"));
    }
    result
}

fn cleanup_task_attachments(project_path: Option<&Path>, task_id: &str) {
    if let Some(project_path) = project_path {
        let _ = fs::remove_dir_all(task_attachments_dir(project_path, task_id));
    }
}

fn flush_batch(channel: &Channel<String>, batch: &mut String) -> bool {
    if batch.is_empty() {
        return true;
    }
    channel.send(std::mem::take(batch)).is_ok()
}

/// Decode a PTY read without splitting a valid multi-byte UTF-8 sequence.
/// Incomplete suffixes are carried to the next read; malformed bytes are
/// replaced immediately so one bad byte cannot block the whole session.
fn decode_pty_chunk(leftover: &mut Vec<u8>, bytes: &[u8]) -> String {
    let mut combined = std::mem::take(leftover);
    combined.extend_from_slice(bytes);
    match std::str::from_utf8(&combined) {
        Ok(text) => text.to_string(),
        Err(error) if error.error_len().is_none() => {
            let valid_end = error.valid_up_to();
            leftover.extend_from_slice(&combined[valid_end..]);
            String::from_utf8_lossy(&combined[..valid_end]).into_owned()
        }
        Err(_) => String::from_utf8_lossy(&combined).into_owned(),
    }
}

fn spawn_output_reader(reader: Box<dyn Read + Send>, channel: Channel<String>) {
    thread::spawn(move || {
        let (tx, rx) = mpsc::sync_channel::<String>(PTY_EMIT_CHANNEL_CAPACITY);
        let worker = thread::spawn(move || {
            let mut batch = String::new();
            loop {
                match rx.recv_timeout(PTY_EMIT_FLUSH_INTERVAL) {
                    Ok(chunk) => {
                        batch.push_str(&chunk);
                        if batch.len() >= PTY_EMIT_MAX_BATCH_BYTES
                            && !flush_batch(&channel, &mut batch)
                        {
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if !flush_batch(&channel, &mut batch) {
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        let _ = flush_batch(&channel, &mut batch);
                        break;
                    }
                }
            }
        });

        let mut reader = reader;
        let mut buffer = [0u8; PTY_READ_BUFFER_SIZE];
        let mut leftover = Vec::new();
        loop {
            let read = match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            let text = decode_pty_chunk(&mut leftover, &buffer[..read]);
            if !text.is_empty() && tx.send(text).is_err() {
                break;
            }
        }
        if !leftover.is_empty() {
            let _ = tx.send(String::from_utf8_lossy(&leftover).into_owned());
        }
        drop(tx);
        let _ = worker.join();
    });
}

fn spawn_exit_monitor(
    app: AppHandle,
    task_id: String,
    handle: Arc<TaskHandle>,
    project_path: PathBuf,
) {
    let monitor_app = app.clone();
    thread::spawn(move || loop {
        let status = handle
            .child
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok().flatten());
        let task_manager = monitor_app.state::<TaskManager>();
        if let Some(status) = status {
            if task_manager.remove_task_if(&task_id, &handle) {
                task_manager.remove_session(&task_id);
                cleanup_task_attachments(Some(&project_path), &task_id);
                emit_task_status(
                    &monitor_app,
                    &task_id,
                    if status.success() { "done" } else { "failed" },
                );
            }
            break;
        }
        if !task_manager.is_active(&task_id) {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    });
}

#[tauri::command]
pub async fn run_task(
    app: AppHandle,
    task_manager: State<'_, TaskManager>,
    task_id: String,
    project_path: String,
    prompt: String,
    agent: String,
    permission_mode: String,
    images: Option<Vec<String>>,
    texts: Option<Vec<String>>,
    cols: Option<u16>,
    rows: Option<u16>,
    on_output: Channel<String>,
) -> Result<(), String> {
    let task_id = normalize_task_id(&task_id)?;
    let project_path = validate_project_path(&project_path)?;
    let size = resolve_pty_size(cols, rows)?;
    let image_paths = match save_task_images(&project_path, &task_id, &images.unwrap_or_default()) {
        Ok(paths) => paths,
        Err(error) => {
            cleanup_task_attachments(Some(&project_path), &task_id);
            return Err(error);
        }
    };
    let text_paths = match save_task_texts(&project_path, &task_id, &texts.unwrap_or_default()) {
        Ok(paths) => paths,
        Err(error) => {
            cleanup_task_attachments(Some(&project_path), &task_id);
            return Err(error);
        }
    };
    let prompt = prompt_with_attachments(prompt, &image_paths, &text_paths);
    let started_at = SystemTime::now();
    let (handle, reader) = match launch_task(
        &task_manager,
        &task_id,
        &project_path,
        &agent,
        &permission_mode,
        LaunchOperation::Run(prompt),
        size,
    ) {
        Ok(value) => value,
        Err(error) => {
            cleanup_task_attachments(Some(&project_path), &task_id);
            return Err(error);
        }
    };

    emit_task_status(&app, &task_id, "running");
    spawn_output_reader(reader, on_output);
    spawn_exit_monitor(app.clone(), task_id.clone(), handle, project_path.clone());
    super::session_discovery::spawn_task_session_watcher(
        app,
        task_id,
        project_path,
        agent,
        started_at,
        None,
    );
    Ok(())
}

#[tauri::command]
pub async fn resume_task(
    app: AppHandle,
    task_manager: State<'_, TaskManager>,
    task_id: String,
    project_path: String,
    agent: String,
    session_id: String,
    permission_mode: String,
    cols: Option<u16>,
    rows: Option<u16>,
    on_output: Channel<String>,
) -> Result<(), String> {
    let task_id = normalize_task_id(&task_id)?;
    let session_id = normalize_session_id(&session_id, "Session id")?;
    let project_path = validate_project_path(&project_path)?;
    let size = resolve_pty_size(cols, rows)?;
    let started_at = SystemTime::now();
    let (handle, reader) = launch_task(
        &task_manager,
        &task_id,
        &project_path,
        &agent,
        &permission_mode,
        LaunchOperation::Resume(session_id.clone()),
        size,
    )?;

    emit_task_status(&app, &task_id, "running");
    spawn_output_reader(reader, on_output);
    spawn_exit_monitor(app.clone(), task_id.clone(), handle, project_path.clone());
    super::session_discovery::spawn_task_session_watcher(
        app,
        task_id,
        project_path,
        agent,
        started_at,
        Some(session_id),
    );
    Ok(())
}

#[tauri::command]
pub async fn fork_task(
    app: AppHandle,
    task_manager: State<'_, TaskManager>,
    task_id: String,
    project_path: String,
    agent: String,
    source_session_id: String,
    permission_mode: String,
    cols: Option<u16>,
    rows: Option<u16>,
    on_output: Channel<String>,
) -> Result<(), String> {
    let task_id = normalize_task_id(&task_id)?;
    let source_session_id = normalize_session_id(&source_session_id, "Source session id")?;
    let project_path = validate_project_path(&project_path)?;
    let size = resolve_pty_size(cols, rows)?;
    let started_at = SystemTime::now();
    let (handle, reader) = launch_task(
        &task_manager,
        &task_id,
        &project_path,
        &agent,
        &permission_mode,
        LaunchOperation::Fork(source_session_id),
        size,
    )?;

    emit_task_status(&app, &task_id, "running");
    spawn_output_reader(reader, on_output);
    spawn_exit_monitor(app.clone(), task_id.clone(), handle, project_path.clone());
    super::session_discovery::spawn_task_session_watcher(
        app,
        task_id,
        project_path,
        agent,
        started_at,
        None,
    );
    Ok(())
}

#[tauri::command]
pub async fn cancel_task(
    app: AppHandle,
    task_manager: State<'_, TaskManager>,
    task_id: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let task_id = normalize_task_id(&task_id)?;
    if let Some(handle) = task_manager.remove_task(&task_id) {
        handle.kill();
        task_manager.remove_session(&task_id);
        let project = project_path
            .as_deref()
            .and_then(|path| validate_project_path(path).ok());
        cleanup_task_attachments(project.as_deref(), &task_id);
        emit_task_status(&app, &task_id, "cancelled");
    }
    Ok(())
}

#[tauri::command]
pub async fn complete_task(
    app: AppHandle,
    task_manager: State<'_, TaskManager>,
    task_id: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let task_id = normalize_task_id(&task_id)?;
    if let Some(handle) = task_manager.remove_task(&task_id) {
        handle.kill();
        task_manager.remove_session(&task_id);
        let project = project_path
            .as_deref()
            .and_then(|path| validate_project_path(path).ok());
        cleanup_task_attachments(project.as_deref(), &task_id);
        emit_task_status(&app, &task_id, "done");
    }
    Ok(())
}

#[tauri::command]
pub async fn send_input(
    task_manager: State<'_, TaskManager>,
    task_id: String,
    data: String,
) -> Result<(), String> {
    let task_id = normalize_task_id(&task_id)?;
    if data.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "input is too large (maximum {MAX_INPUT_BYTES} bytes)"
        ));
    }
    let handle = task_manager
        .task(&task_id)
        .ok_or_else(|| format!("task is not running: {task_id}"))?;
    let mut writer = handle
        .writer
        .lock()
        .map_err(|_| "PTY writer mutex poisoned".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("write PTY input failed: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("flush PTY input failed: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn resize_pty(
    task_manager: State<'_, TaskManager>,
    task_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let task_id = normalize_task_id(&task_id)?;
    let size = validate_pty_size(cols, rows)?;
    let handle = task_manager
        .task(&task_id)
        .ok_or_else(|| format!("task is not running: {task_id}"))?;
    let master = handle
        .master
        .lock()
        .map_err(|_| "PTY master mutex poisoned".to_string())?;
    master
        .resize(size)
        .map_err(|error| format!("resize PTY failed: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch(program: &str) -> AgentLaunchSpec {
        AgentLaunchSpec {
            program: program.to_string(),
            extra_env: Vec::new(),
        }
    }

    #[test]
    fn builds_claude_run_arguments_for_each_permission_mode() {
        let ask = build_command_spec(
            "claude",
            &launch("claude.exe"),
            "ask",
            LaunchOperation::Run("hello".to_string()),
        )
        .expect("ask command");
        assert_eq!(ask.args, vec!["--permission-mode", "default", "hello"]);

        let auto_edit = build_command_spec(
            "claude",
            &launch("claude.exe"),
            "auto_edit",
            LaunchOperation::Run("hello".to_string()),
        )
        .expect("auto edit command");
        assert_eq!(
            auto_edit.args,
            vec!["--permission-mode", "acceptEdits", "hello"]
        );

        let full_access = build_command_spec(
            "claude",
            &launch("claude.exe"),
            "full_access",
            LaunchOperation::Run("hello".to_string()),
        )
        .expect("full access command");
        assert_eq!(
            full_access.args,
            vec!["--dangerously-skip-permissions", "hello"]
        );
    }

    #[test]
    fn builds_codex_resume_and_fork_arguments_without_shell_parsing() {
        let resume = build_command_spec(
            "codex",
            &launch("codex.exe"),
            "auto_edit",
            LaunchOperation::Resume("session-id".to_string()),
        )
        .expect("resume command");
        assert_eq!(
            resume.args,
            vec![
                "--sandbox",
                "workspace-write",
                "-a",
                "on-request",
                "resume",
                "session-id"
            ]
        );

        let fork = build_command_spec(
            "codex",
            &launch("codex.exe"),
            "ask",
            LaunchOperation::Fork("session-id".to_string()),
        )
        .expect("fork command");
        assert_eq!(fork.args, vec!["fork", "session-id"]);
    }

    #[test]
    fn rejects_invalid_cli_options_and_pty_sizes() {
        assert!(normalize_cli_option(Some("model\n--dangerous"), "model", 1024).is_err());
        assert!(normalize_session_id("session\r\n", "session").is_err());
        assert!(validate_pty_size(1, 24).is_err());
        assert!(validate_pty_size(120, 10_001).is_err());
        assert!(validate_pty_size(120, 40).is_ok());
    }

    #[test]
    fn preserves_utf8_sequences_split_across_pty_reads() {
        let mut leftover = Vec::new();
        assert_eq!(decode_pty_chunk(&mut leftover, &[0xe4]), "");
        assert_eq!(leftover, vec![0xe4]);
        assert_eq!(decode_pty_chunk(&mut leftover, &[0xb8, 0xad]), "中");
        assert!(leftover.is_empty());
    }

    #[test]
    fn malformed_utf8_is_replaced_without_blocking_following_output() {
        let mut leftover = Vec::new();
        assert_eq!(decode_pty_chunk(&mut leftover, &[0xff, b'o', b'k']), "�ok");
        assert!(leftover.is_empty());
    }
}
