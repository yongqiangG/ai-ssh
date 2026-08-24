//! 手机伴侣 web 门面（docs/situations/260821-mobile-companion.md）。
//!
//! Tauri 进程内嵌 axum，监听 `0.0.0.0:<port>`（默认 18080），把 coding 域
//! 只读数据以 REST 暴露给 tailnet 内的手机浏览器。与桌面端共存纪律：
//! - 只调用 storage/TaskManager 现有函数，不复制业务逻辑；
//! - 配置独立落 `~/.ai-ssh/coding/web.json`——不进 app_settings（桌面设置
//!   面板整结构体回存会把不认识的字段抹回默认，token 会被重置）；
//! - 响应码沿用全仓约定：成功 `"0000"`。
//!
//! 通道无关：本模块不感知 Tailscale/frp，只认到达端口的 HTTP。
//! 阶段 2/3 需要触达 TaskManager（WS 输入/新建任务）时，给 `start()` 传
//! AppHandle 并入 WebState——tauri 2.x 的 `State::inner()` 只给
//! `&TaskManager` 拿不到内部 Arc，AppHandle 是 Clone 廉价的进程级句柄，
//! `app.state::<TaskManager>()` 就地取用（State 对 TaskManager Deref）。

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, Request, State,
    },
    http::{header, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::coding::storage::{self, Project, Task};
use crate::coding::TaskManager;

pub(crate) mod stream;

/// 进程内 AppHandle 单例（start() 注入）。
/// 注意：axum handler 的泛型单态化代码里只要出现 AppHandle 类型，测试 exe
/// 即加载失败（STATUS_ENTRYPOINT_NOT_FOUND，260821 阶段 3 二分实证——
/// Extension extractor 与普通 clone 两种形态都触发）。因此创建任务走
/// 「纯数据 job → 专用 worker 线程」隔离，handler 内零 AppHandle 痕迹。
static APP_HANDLE: once_cell::sync::OnceCell<AppHandle> = once_cell::sync::OnceCell::new();

/// 创建任务 job：handler → worker 的纯数据通道。
struct CreateTaskJob {
    project_path: String,
    task: Task,
    body: CreateTaskBody,
    reply: tokio::sync::oneshot::Sender<Result<Task, String>>,
}

static CREATE_QUEUE: once_cell::sync::OnceCell<std::sync::mpsc::Sender<CreateTaskJob>> =
    once_cell::sync::OnceCell::new();

/// worker 线程：持有 AppHandle 消费 job，进程内直调 coding_run_task。
/// 不被任何测试路径引用（start() 才 spawn），不进测试 exe。
fn create_task_worker(app: AppHandle, rx: std::sync::mpsc::Receiver<CreateTaskJob>) {
    while let Ok(job) = rx.recv() {
        let CreateTaskJob {
            project_path,
            task,
            body,
            reply,
        } = job;
        let tm = app.state::<TaskManager>();
        // Channel 丢弃输出（旁路 tap 已全量记录，手机经 WS 消费；桌面实时流
        // 缺失为已知限制，见 backlog 260821）
        let sink = tauri::ipc::Channel::new(|_resp: tauri::ipc::InvokeResponseBody| Ok(()));
        let run = tauri::async_runtime::block_on(crate::coding::pty::coding_run_task(
            app.clone(),
            tm,
            task.id.clone(),
            project_path,
            body.prompt.clone(),
            body.agent.clone(),
            body.permission_mode.clone(),
            body.model.clone(),
            None, // reasoning_effort：用 agent 默认
            None, // images
            None, // texts
            body.cols,
            body.rows,
            sink,
        ));
        match run {
            Ok(()) => {
                // web 创建标记：输出在 send_pty_chunk 同步 publish 成
                // coding:task-output 事件（桌面终端实时流回退）
                stream::mark_web_created(&task.id);
                // 通知桌面：新任务诞生（若该项目已打开则实时入列）
                crate::coding::events::publish(
                    &app,
                    "coding:task-created",
                    serde_json::to_value(&task).unwrap_or(serde_json::Value::Null),
                );
                let _ = reply.send(Ok(task));
            }
            Err(e) => {
                let _ = reply.send(Err(e));
            }
        }
    }
}

// ── 配置（~/.ai-ssh/coding/web.json）────────────────────────────────────────

fn default_enabled() -> bool {
    true
}

fn default_port() -> u16 {
    18080
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WebConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_port")]
    pub port: u16,
    /// 手机首连输入的访问令牌。空则在加载时自动生成并回写。
    #[serde(default)]
    pub token: String,
}

static CONFIG_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

fn web_config_path() -> Result<std::path::PathBuf, String> {
    Ok(storage::coding_dir()?.join("web.json"))
}

/// 读取配置；token 为空时自动生成 uuid 并回写（首次启用即有完整凭据）。
fn load_or_init_config() -> WebConfig {
    let _guard = CONFIG_LOCK.lock();
    let default = || WebConfig {
        enabled: default_enabled(),
        port: default_port(),
        token: String::new(),
    };
    let mut config = match &web_config_path() {
        Ok(path) => match std::fs::read_to_string(path) {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|_| default()),
            Err(_) => default(),
        },
        Err(_) => default(),
    };
    if config.token.is_empty() {
        config.token = uuid::Uuid::new_v4().to_string();
        if let Ok(path) = web_config_path() {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(json) = serde_json::to_string_pretty(&config) {
                let _ = std::fs::write(&path, json);
            }
        }
    }
    config
}

// ── 响应封皮（全仓统一：成功码字符串 "0000"）───────────────────────────────

#[derive(Serialize)]
pub struct Envelope<T: Serialize> {
    pub code: &'static str,
    pub info: &'static str,
    pub data: T,
}

impl<T: Serialize> Envelope<T> {
    pub fn ok(data: T) -> Self {
        Envelope {
            code: "0000",
            info: "success",
            data,
        }
    }
}

fn err(status: StatusCode, code: &'static str, info: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "code": code, "info": info, "data": null })),
    )
        .into_response()
}

// ── Handler 逻辑（注入 loader，纯函数可测，不碰真实 ~/.ai-ssh）──────────────

type LoadProjects = fn() -> Result<Vec<Project>, String>;
type LoadProjectTasks = fn(&str) -> Result<Vec<Task>, String>;

pub fn projects_response(load: LoadProjects) -> Response {
    match load() {
        Ok(list) => Json(Envelope::ok(list)).into_response(),
        Err(e) => err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "0500",
            &format!("load projects failed: {e}"),
        ),
    }
}

pub fn project_tasks_response(load: LoadProjectTasks, project_id: &str) -> Response {
    match load(project_id) {
        Ok(list) => Json(Envelope::ok(list)).into_response(),
        Err(e) => err(
            StatusCode::NOT_FOUND,
            "0404",
            &format!("load tasks failed: {e}"),
        ),
    }
}

/// 跨项目按 id 找单个任务（tasks 按 project 分文件存储）。
pub fn task_response(
    load_projects: LoadProjects,
    load_tasks: LoadProjectTasks,
    task_id: &str,
) -> Response {
    let projects = match load_projects() {
        Ok(p) => p,
        Err(e) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "0500",
                &format!("load projects failed: {e}"),
            )
        }
    };
    for project in &projects {
        if let Ok(tasks) = load_tasks(&project.id) {
            if let Some(task) = tasks.into_iter().find(|t| t.id == task_id) {
                return Json(Envelope::ok(task)).into_response();
            }
        }
    }
    err(
        StatusCode::NOT_FOUND,
        "0404",
        &format!("task not found: {task_id}"),
    )
}

// ── App state 与路由 ─────────────────────────────────────────────────────────

#[derive(Clone)]
struct WebState {
    token: Arc<String>,
    load_projects: LoadProjects,
    load_tasks: LoadProjectTasks,
}

fn load_project_tasks_shim(project_id: &str) -> Result<Vec<Task>, String> {
    storage::coding_load_project_tasks(project_id.to_string())
}

async fn api_health() -> Response {
    Json(Envelope::ok(Value::Bool(true))).into_response()
}

async fn api_projects(State(state): State<WebState>) -> Response {
    projects_response(state.load_projects)
}

async fn api_project_tasks(
    State(state): State<WebState>,
    Path(project_id): Path<String>,
) -> Response {
    project_tasks_response(state.load_tasks, &project_id)
}

async fn api_task(State(state): State<WebState>, Path(task_id): Path<String>) -> Response {
    task_response(state.load_projects, state.load_tasks, &task_id)
}

/// API 组鉴权：`X-Companion-Token` 头或 `Authorization: Bearer`。
/// tailnet 内明文传输（WireGuard 隧道加密），简单等值比较够用。
async fn auth_middleware(State(state): State<WebState>, req: Request, next: Next) -> Response {
    let provided = req
        .headers()
        .get("x-companion-token")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .or_else(|| {
            req.headers()
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(str::to_owned)
        });
    match provided {
        Some(t) if t == *state.token => next.run(req).await,
        _ => err(
            StatusCode::UNAUTHORIZED,
            "0401",
            "unauthorized: missing or invalid companion token",
        ),
    }
}

// ── 静态资源（dist-mobile，debug 从磁盘实时读，release 内嵌）────────────────

// 路径相对 src-tauri/（CARGO_MANIFEST_DIR）：../dist-mobile = ssh-client/dist-mobile
#[derive(RustEmbed)]
#[folder = "../dist-mobile"]
struct MobileAssets;

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("json") => "application/json",
        Some("webmanifest") => "application/manifest+json",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match MobileAssets::get(path) {
        Some(file) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type(path)),
                // html 不缓存（发版即生效）；带 hash 的构建产物可久存
                (
                    header::CACHE_CONTROL,
                    if path.ends_with(".html") {
                        "no-cache"
                    } else {
                        "max-age=31536000, immutable"
                    },
                ),
            ],
            file.data.into_owned(),
        )
            .into_response(),
        // SPA 兜底：未知路径回 index.html（由前端路由接管）
        None => match MobileAssets::get("index.html") {
            Some(file) => (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                file.data.into_owned(),
            )
                .into_response(),
            None => (
                StatusCode::NOT_FOUND,
                "mobile assets missing: run `npm run build:mobile`",
            )
                .into_response(),
        },
    }
}

/// 基座路由（可测）：auth 组 + health + 静态兜底。
fn build_api_router(state: WebState) -> Router {
    let api = Router::new()
        .route("/projects", get(api_projects))
        .route(
            "/projects/{project_id}/tasks",
            get(api_project_tasks).post(api_create_task),
        )
        .route("/tasks/{task_id}", get(api_task))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    Router::new()
        .route("/api/health", get(api_health))
        .nest("/api", api)
        .fallback(static_handler)
        .with_state(state)
}

// ── WS：PTY 流 + 状态事件（阶段 2）───────────────────────────────────────────
//
// 协议（JSON 文本帧）：
//   服务端→手机：{"type":"snapshot","data":...}（建连尾窗回放，空也发——
//                手机端据此 reset 终端）→ {"type":"output","data":...} 实时流
//                → {"type":"status","task_id":...,"status":...}（总线 task-status）
//   手机→服务端：{"type":"input","data":...}（写 PTY，桌面/手机双端无锁自由交错，Q7）
//                {"type":"resize","cols":...,"rows":...}（手机接管排版尺寸；
//                最后一个 WS 断开时还原桌面最近 resize 留底——260821 修订 Q10）
// token 走 query 参数（浏览器 WebSocket 设不了自定义 header）。

#[derive(Clone)]
struct WsState {
    app: AppHandle,
    token: Arc<String>,
}

/// query 里的 token 校验（纯函数可测）。
fn ws_query_token_ok(params: &HashMap<String, String>, token: &str) -> bool {
    params.get("token").map(String::as_str) == Some(token)
}

/// 客户端→服务端消息解析：input 帧返回输入文本，resize 帧返回目标尺寸，
/// 其余（未知类型/畸形 JSON）忽略。
enum ClientFrame {
    Input(String),
    Resize(u16, u16),
}

fn parse_client_frame(text: &str) -> Option<ClientFrame> {
    let v: Value = serde_json::from_str(text).ok()?;
    match v.get("type")?.as_str()? {
        "input" => v.get("data")?.as_str().map(|d| ClientFrame::Input(d.to_owned())),
        "resize" => {
            let cols = v.get("cols")?.as_u64()?;
            let rows = v.get("rows")?.as_u64()?;
            Some(ClientFrame::Resize(cols as u16, rows as u16))
        }
        _ => None,
    }
}

/// 总线事件 → 本任务 WS status 帧；与任务无关（其他事件名/其他 task_id）→ None。
fn bus_event_to_ws_msg(ev: &crate::coding::events::BusEvent, task_id: &str) -> Option<String> {
    if ev.name != "coding:task-status" {
        return None;
    }
    if ev.payload.get("task_id").and_then(Value::as_str) != Some(task_id) {
        return None;
    }
    Some(
        serde_json::json!({
            "type": "status",
            "task_id": task_id,
            "status": ev.payload.get("status").cloned().unwrap_or(Value::Null),
        })
        .to_string(),
    )
}

async fn ws_task(
    State(state): State<WsState>,
    Path(task_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Response {
    if !ws_query_token_ok(&params, &state.token) {
        return err(
            StatusCode::UNAUTHORIZED,
            "0401",
            "unauthorized: missing or invalid companion token",
        );
    }
    // nav=1（首连）才拽 PC 视图跟随：重连不重复导航（260821 阶段 3）
    let navigate = params.get("nav").map(String::as_str) == Some("1");
    let nav_state = state.clone();
    let nav_task = task_id.clone();
    ws.on_upgrade(move |socket| {
        if navigate {
            // 复用 260817 桌面通知跳转通路（App.tsx 常驻监听）
            crate::coding::events::publish(
                &nav_state.app,
                "coding:navigate",
                serde_json::json!({ "task_id": nav_task }),
            );
        }
        task_ws_loop(socket, state, task_id)
    })
}

async fn task_ws_loop(mut socket: WebSocket, state: WsState, task_id: String) {
    // 手机 WS 生命周期登记（最后一个断开时还原桌面尺寸）
    stream::ws_connected(&task_id);
    // 快照 + 订阅在同一临界段内注册（stream.rs 保证无丢帧窗口）。
    // 260824 起快照内容 = 无头仿真器状态序列（百字节级），引导硬失败时
    // 由 stream.rs 内部回退原始尾窗，此处无感知
    let (snapshot, mut output_rx) = stream::subscribe_with_snapshot(&task_id);
    // 快照体积观测（260824 验收项：状态序列 <10KB vs 原始尾窗 256KB）
    eprintln!(
        "[web-companion] snapshot task={} bytes={} (state-sync or tail fallback)",
        task_id,
        snapshot.len()
    );
    if socket
        .send(Message::Text(
            serde_json::json!({ "type": "snapshot", "data": snapshot }).to_string().into(),
        ))
        .await
        .is_err()
    {
        // 半开连接：同样走断开登记路径，保持计数一致
        if let Some((cols, rows)) = stream::ws_disconnected(&task_id) {
            let tm = state.app.state::<TaskManager>();
            let _ = crate::coding::pty::resize_pty(&tm, &task_id, cols, rows);
        }
        return; // 死订阅者由 stream::record 的 retain 自然清理
    }
    let mut bus_rx = crate::coding::events::subscribe();
    loop {
        tokio::select! {
            chunk = output_rx.recv() => {
                match chunk {
                    Some(chunk) => {
                        let msg = serde_json::json!({ "type": "output", "data": chunk }).to_string();
                        if socket.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            ev = bus_rx.recv() => {
                // Lagged 容忍：状态事件幂等快照，丢中间态无害（events.rs 语义）
                if let Ok(ev) = ev {
                    if let Some(msg) = bus_event_to_ws_msg(&ev, &task_id) {
                        if socket.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let tm = state.app.state::<TaskManager>();
                        match parse_client_frame(text.as_str()) {
                            Some(ClientFrame::Input(data)) => {
                                // 写失败（任务未运行）静默：与桌面命令行为一致
                                let _ = crate::coding::pty::write_pty_input(&tm, &task_id, &data);
                            }
                            Some(ClientFrame::Resize(cols, rows)) => {
                                // 手机接管排版尺寸（260821 修订 Q10：不 resize 实测
                                // 不可用——220 列 TUI 压进 40 列屏完全散架）
                                let _ = crate::coding::pty::resize_pty(&tm, &task_id, cols, rows);
                            }
                            None => {}
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    // ping 由 axum 自动回 pong；binary 等不支持，忽略
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
    // 最后一个手机连接离开 → PTY 还原桌面最近尺寸（有留底才还原）
    if let Some((cols, rows)) = stream::ws_disconnected(&task_id) {
        let tm = state.app.state::<TaskManager>();
        let _ = crate::coding::pty::resize_pty(&tm, &task_id, cols, rows);
    }
}

/// 生产路由：API + WS 合并（WS 独立 state；单测只测 `build_api_router`
/// 与纯函数，全链路靠 dev 实例真机验证）。
fn build_router(state: WebState, app: AppHandle) -> Router {
    let ws = Router::new()
        .route("/api/ws/task/{task_id}", get(ws_task))
        .with_state(WsState {
            app: app.clone(),
            token: state.token.clone(),
        });
    build_api_router(state).merge(ws)
}

// ── 新建任务（阶段 3）────────────────────────────────────────────────────────

fn default_agent() -> String {
    "claude".to_string()
}

fn default_permission_mode() -> String {
    "ask".to_string()
}

/// POST /api/projects/{id}/tasks 请求体。字段 camelCase 对齐 Task 结构风格。
#[derive(Deserialize, Clone, Debug)]
pub struct CreateTaskBody {
    pub prompt: String,
    #[serde(default = "default_agent")]
    pub agent: String,
    #[serde(rename = "permissionMode", default = "default_permission_mode")]
    pub permission_mode: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub cols: Option<u16>,
    #[serde(default)]
    pub rows: Option<u16>,
}

/// 生成不撞车的任务 id（桌面风格：毫秒时间戳字符串；同毫秒顺序 +1）。
fn next_task_id(existing: &[Task], now_ms: u128) -> String {
    let mut n = now_ms;
    loop {
        let id = n.to_string();
        if !existing.iter().any(|t| t.id == id) {
            return id;
        }
        n += 1;
    }
}

/// 构造 Task 记录并落盘（loader 注入，纯函数可测）。复刻桌面 NewTaskView
/// 流程：immediate 任务初始 status=pending，running 态由 run_task 的
/// task-status 事件驱动。
type SaveTasks = fn(&str, Vec<Task>) -> Result<(), String>;

pub fn create_task_in_store(
    load_tasks: LoadProjectTasks,
    save_tasks: SaveTasks,
    project_id: &str,
    body: &CreateTaskBody,
    now_ms: u128,
) -> Result<Task, String> {
    let mut tasks = load_tasks(project_id)?;
    let task = Task {
        id: next_task_id(&tasks, now_ms),
        project_id: project_id.to_string(),
        name: if body.prompt.is_empty() {
            None
        } else {
            Some(body.prompt.chars().take(40).collect())
        },
        prompt: body.prompt.clone(),
        agent: body.agent.clone(),
        permission_mode: body.permission_mode.clone(),
        model: body.model.clone(),
        reasoning_effort: None,
        status: "pending".to_string(),
        created_at: now_ms as i64,
        updated_at: Some(now_ms as i64),
        attention_requested_at: None,
        claude_session_id: None,
        claude_session_path: None,
        codex_session_id: None,
        codex_session_path: None,
        starred: None,
        failure_reason: None,
    };
    tasks.insert(0, task.clone());
    save_tasks(project_id, tasks)?;
    Ok(task)
}

async fn api_create_task(
    State(state): State<WebState>,
    Path(project_id): Path<String>,
    axum::Json(body): axum::Json<CreateTaskBody>,
) -> Response {
    // 项目必须存在（拿 path 作 agent cwd）
    let project_path = match (state.load_projects)() {
        Ok(list) => list
            .into_iter()
            .find(|p| p.id == project_id)
            .map(|p| p.path),
        Err(_) => None,
    };
    let Some(project_path) = project_path else {
        return err(
            StatusCode::NOT_FOUND,
            "0404",
            &format!("project not found: {project_id}"),
        );
    };

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();

    // 落盘；失败即 500，不留半态
    let task = match create_task_in_store(state.load_tasks, save_tasks_shim, &project_id, &body, now_ms)
    {
        Ok(t) => t,
        Err(e) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "0500",
                &format!("persist task failed: {e}"),
            )
        }
    };

    // 进程内直调桌面同款命令：Channel 丢弃输出（旁路 tap 已全量记录，
    // 手机经 WS 消费；桌面实时流缺失为已知限制，见 backlog 260821）
    // 经 job 队列交给持 AppHandle 的 worker（handler 内零 AppHandle 痕迹，
    // 见模块头注释）；worker 回滚由本函数收到 Err 后执行
    let (tx_reply, rx_reply) = tokio::sync::oneshot::channel();
    let queued = CREATE_QUEUE.get().map(|tx| {
        tx.send(CreateTaskJob {
            project_path,
            task: task.clone(),
            body: body.clone(),
            reply: tx_reply,
        })
    });
    let run = match queued {
        Some(Ok(())) => rx_reply.await.map_err(|_| "worker dropped".to_string()).and_then(|r| r),
        _ => Err("create worker unavailable".to_string()),
    };

    match run {
        Ok(task) => Json(Envelope::ok(task)).into_response(),
        Err(e) => {
            // 运行失败回滚任务记录，不留僵尸 pending
            if let Ok(mut tasks) = (state.load_tasks)(&project_id) {
                tasks.retain(|t| t.id != task.id);
                let _ = save_tasks_shim(&project_id, tasks);
            }
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "0500",
                &format!("run task failed: {e}"),
            )
        }
    }
}

fn save_tasks_shim(project_id: &str, tasks: Vec<Task>) -> Result<(), String> {
    storage::coding_save_project_tasks(project_id.to_string(), tasks)
}

// ── 启动入口（lib.rs setup 调用）────────────────────────────────────────────

pub fn start(app: AppHandle) {
    let config = load_or_init_config();
    if !config.enabled {
        eprintln!("[web-companion] disabled by web.json, skipping");
        return;
    }
    let _ = APP_HANDLE.set(app.clone());
    // 创建任务 worker：持 AppHandle 消费纯数据 job（与 handler 隔离）
    let (job_tx, job_rx) = std::sync::mpsc::channel::<CreateTaskJob>();
    let _ = CREATE_QUEUE.set(job_tx);
    let worker_app = app.clone();
    std::thread::spawn(move || create_task_worker(worker_app, job_rx));
    let state = WebState {
        token: Arc::new(config.token),
        load_projects: storage::coding_load_projects,
        load_tasks: load_project_tasks_shim,
    };
    let ws_app = app.clone();
    let port = config.port;
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => {
                eprintln!("[web-companion] listening on 0.0.0.0:{port}");
                if let Err(e) = axum::serve(listener, build_router(state, ws_app)).await {
                    eprintln!("[web-companion] server error: {e}");
                }
            }
            Err(e) => {
                eprintln!(
                    "[web-companion] bind 0.0.0.0:{port} failed: {e}（端口被占？手机伴侣不可用）"
                );
            }
        }
    });
}

// ── 测试 ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt;

    fn fixture_projects() -> Result<Vec<Project>, String> {
        Ok(vec![Project {
            id: "p1".into(),
            name: "ai-ssh".into(),
            path: "D:/x".into(),
            branch: None,
            last_opened_at: 1,
            hidden_from_rail: false,
        }])
    }

    fn fixture_tasks(project_id: &str) -> Result<Vec<Task>, String> {
        if project_id == "p1" {
            Ok(vec![Task {
                id: "t1".into(),
                project_id: "p1".into(),
                name: Some("demo".into()),
                prompt: "hi".into(),
                agent: "claude".into(),
                permission_mode: "default".into(),
                model: None,
                reasoning_effort: None,
                status: "done".into(),
                created_at: 1,
                updated_at: None,
                attention_requested_at: None,
                claude_session_id: None,
                claude_session_path: None,
                codex_session_id: None,
                codex_session_path: None,
                starred: None,
                failure_reason: None,
            }])
        } else {
            Err("no such project dir".into())
        }
    }

    async fn envelope_code(resp: Response) -> String {
        let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
            .await
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .map(|v| v["code"].as_str().unwrap_or("?").to_string())
            .unwrap_or_default();
        body
    }

    fn get(uri: &str, token: Option<&str>) -> Request {
        let mut builder = Request::builder().uri(uri);
        if let Some(t) = token {
            builder = builder.header("x-companion-token", t);
        }
        builder.body(Body::empty()).unwrap()
    }

    fn test_state() -> WebState {
        WebState {
            token: Arc::new("secret-token".into()),
            load_projects: fixture_projects,
            load_tasks: fixture_tasks,
        }
    }

    #[tokio::test]
    async fn projects_response_ok() {
        let resp = projects_response(fixture_projects);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(envelope_code(resp).await, "0000");
    }

    #[tokio::test]
    async fn project_tasks_response_ok_and_missing() {
        let resp = project_tasks_response(fixture_tasks, "p1");
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(envelope_code(resp).await, "0000");
        // 项目不存在：loader 报错映射 0404
        let resp = project_tasks_response(fixture_tasks, "p0");
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert_eq!(envelope_code(resp).await, "0404");
    }

    #[tokio::test]
    async fn task_response_found_and_not_found() {
        let resp = task_response(fixture_projects, fixture_tasks, "t1");
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(envelope_code(resp).await, "0000");
        let resp = task_response(fixture_projects, fixture_tasks, "nope");
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert_eq!(envelope_code(resp).await, "0404");
    }

    #[tokio::test]
    async fn auth_middleware_rejects_and_accepts() {
        let app = build_api_router(test_state());

        // 无 token / 错 token → 401；对 token → 200 + 0000；health 免鉴权
        let resp = app
            .clone()
            .oneshot(get("/api/projects", None))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(envelope_code(resp).await, "0401");

        let resp = app
            .clone()
            .oneshot(get("/api/projects", Some("wrong")))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

        let resp = app
            .clone()
            .oneshot(get("/api/projects", Some("secret-token")))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(envelope_code(resp).await, "0000");

        let resp = app.oneshot(get("/api/health", None)).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[test]
    fn config_defaults_and_partial_parse() {
        let cfg: WebConfig = serde_json::from_str("{}").unwrap();
        assert!(cfg.enabled);
        assert_eq!(cfg.port, 18080);
        assert!(cfg.token.is_empty());
        let cfg: WebConfig = serde_json::from_str("{\"port\": 19000}").unwrap();
        assert_eq!(cfg.port, 19000);
    }

    // ── 新建任务 ──

    // fn 指针 loader 无法捕获闭包——经全局 store 桥接（测试串行保证互不干扰）
    static STORE_A: once_cell::sync::Lazy<Mutex<Vec<Task>>> =
        once_cell::sync::Lazy::new(|| Mutex::new(vec![]));
    static STORE_B: once_cell::sync::Lazy<Mutex<Vec<Task>>> =
        once_cell::sync::Lazy::new(|| Mutex::new(vec![]));

    fn empty_tasks_with_store(
        project_id: &str,
        store: &Mutex<Vec<Task>>,
    ) -> Result<Vec<Task>, String> {
        if project_id == "p1" {
            Ok(store.lock().clone())
        } else {
            Err("no such project dir".into())
        }
    }

    #[test]
    fn create_task_in_store_assigns_fresh_id_and_persists() {
        STORE_A.lock().clear();
        // 内存 store：load 返回上次 save 的内容
        let load: LoadProjectTasks = |id: &str| empty_tasks_with_store(id, &STORE_A);
        let save: SaveTasks = |_id, tasks| {
            *STORE_A.lock() = tasks;
            Ok(())
        };
        let body = CreateTaskBody {
            prompt: "在项目根目录写入一个md文档".into(),
            agent: "claude".into(),
            permission_mode: "ask".into(),
            model: None,
            cols: Some(44),
            rows: Some(30),
        };
        let task = create_task_in_store(load, save, "p1", &body, 1787300000000).unwrap();
        assert_eq!(task.id, "1787300000000");
        assert_eq!(task.status, "pending");
        assert_eq!(task.name.as_deref(), Some("在项目根目录写入一个md文档"));
        // 已落盘且置于列表头
        assert_eq!(STORE_A.lock().len(), 1);
    }

    #[test]
    fn create_task_in_store_id_collision_bumps() {
        STORE_B.lock().clear();
        // 预置同 id 任务，新任务应 +1 错开
        *STORE_B.lock() = vec![Task {
            id: "1787300000000".into(),
            project_id: "p1".into(),
            name: None,
            prompt: "old".into(),
            agent: "claude".into(),
            permission_mode: "ask".into(),
            model: None,
            reasoning_effort: None,
            status: "done".into(),
            created_at: 1,
            updated_at: None,
            attention_requested_at: None,
            claude_session_id: None,
            claude_session_path: None,
            codex_session_id: None,
            codex_session_path: None,
            starred: None,
            failure_reason: None,
        }];
        let load: LoadProjectTasks = |id: &str| empty_tasks_with_store(id, &STORE_B);
        let save: SaveTasks = |_id, tasks| {
            *STORE_B.lock() = tasks;
            Ok(())
        };
        let body = CreateTaskBody {
            prompt: "新任务".into(),
            agent: "codex".into(),
            permission_mode: "full_access".into(),
            model: None,
            cols: None,
            rows: None,
        };
        let task = create_task_in_store(load, save, "p1", &body, 1787300000000).unwrap();
        assert_eq!(task.id, "1787300000001");
        // 新任务在头部
        assert_eq!(STORE_B.lock()[0].id, "1787300000001");
    }

    #[test]
    fn create_task_body_parsing() {
        let body: CreateTaskBody = serde_json::from_str(
            r#"{"prompt":"hi","agent":"codex","permissionMode":"full_access"}"#,
        )
        .unwrap();
        assert_eq!(body.agent, "codex");
        assert_eq!(body.permission_mode, "full_access");
        // 缺省：claude + ask
        let body: CreateTaskBody = serde_json::from_str(r#"{"prompt":"hi"}"#).unwrap();
        assert_eq!(body.agent, "claude");
        assert_eq!(body.permission_mode, "ask");
        assert_eq!(body.cols, None);
    }

    // ── WS 纯函数 ──

    #[test]
    fn ws_query_token_check() {
        let mut params = HashMap::new();
        assert!(!ws_query_token_ok(&params, "secret"));
        params.insert("token".to_string(), "wrong".to_string());
        assert!(!ws_query_token_ok(&params, "secret"));
        params.insert("token".to_string(), "secret".to_string());
        assert!(ws_query_token_ok(&params, "secret"));
    }

    #[test]
    fn ws_client_frame_parsing() {
        use super::ClientFrame;
        assert!(matches!(
            parse_client_frame(r#"{"type":"input","data":"y\n"}"#),
            Some(ClientFrame::Input(ref d)) if d == "y\n"
        ));
        assert!(matches!(
            parse_client_frame(r#"{"type":"resize","cols":44,"rows":30}"#),
            Some(ClientFrame::Resize(44, 30))
        ));
        // 非法/未知帧全部忽略
        assert!(parse_client_frame(r#"{"type":"status"}"#).is_none());
        assert!(parse_client_frame("not json").is_none());
        assert!(parse_client_frame(r#"{"type":"input"}"#).is_none());
        assert!(parse_client_frame(r#"{"type":"input","data":42}"#).is_none());
        assert!(parse_client_frame(r#"{"type":"resize","cols":"x","rows":30}"#).is_none());
        assert!(parse_client_frame(r#"{"type":"resize","cols":44}"#).is_none());
    }

    #[test]
    fn ws_bus_event_filtering() {
        use crate::coding::events::BusEvent;


        let hit = BusEvent {
            name: "coding:task-status".into(),
            payload: serde_json::json!({"task_id": "t1", "status": "input_required"}),
        };
        let msg = bus_event_to_ws_msg(&hit, "t1").unwrap();
        let parsed: Value = serde_json::from_str(&msg).unwrap();
        assert_eq!(parsed["type"], "status");
        assert_eq!(parsed["status"], "input_required");

        // 其他任务 / 其他事件名 → 过滤
        assert_eq!(bus_event_to_ws_msg(&hit, "t2"), None);
        let other = BusEvent {
            name: "coding:fs-changed".into(),
            payload: serde_json::json!({"task_id": "t1"}),
        };
        assert_eq!(bus_event_to_ws_msg(&other, "t1"), None);
    }
}
