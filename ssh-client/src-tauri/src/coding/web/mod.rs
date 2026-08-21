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

use std::sync::Arc;

use axum::{
    extract::{Path, Request, State},
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

use crate::coding::storage::{self, Project, Task};

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

fn build_router(state: WebState) -> Router {
    let api = Router::new()
        .route("/projects", get(api_projects))
        .route("/projects/{project_id}/tasks", get(api_project_tasks))
        .route("/tasks/{task_id}", get(api_task))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    Router::new()
        .route("/api/health", get(api_health))
        .nest("/api", api)
        .fallback(static_handler)
        .with_state(state)
}

// ── 启动入口（lib.rs setup 调用）────────────────────────────────────────────

pub fn start() {
    let config = load_or_init_config();
    if !config.enabled {
        eprintln!("[web-companion] disabled by web.json, skipping");
        return;
    }
    let state = WebState {
        token: Arc::new(config.token),
        load_projects: storage::coding_load_projects,
        load_tasks: load_project_tasks_shim,
    };
    let port = config.port;
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => {
                eprintln!("[web-companion] listening on 0.0.0.0:{port}");
                if let Err(e) = axum::serve(listener, build_router(state)).await {
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
        let app = build_router(test_state());

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
}
