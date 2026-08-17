use std::{
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

use tauri::{Emitter, Manager, WindowEvent};

mod coding;
mod lifecycle;

const BACKEND_PORT: u16 = 8091;
const BACKEND_JAR_NAME: &str = "ssh-server-app.jar";
/// 首启训练的延迟：错开主后端冷启动的 CPU 峰值窗口
const CDS_TRAINING_DELAY_SECS: u64 = 30;
/// 关窗后等待后端优雅退出的上限，超时硬杀兜底
const GRACEFUL_EXIT_TIMEOUT_MS: u64 = 3000;

struct BackendProcess(Mutex<Option<Child>>);

/// sidecar 启动失败信息暂存：setup 阶段早于 webview 就绪，emit 的事件可能
/// 无人接收，前端挂载后可通过 backend_launch_failure 命令补查一次。
struct BackendLaunchFailure(Mutex<Option<String>>);

impl BackendProcess {
    /// 优雅停机：drop stdin 写端让后端哨兵读到 EOF 自行退出（走 JVM
    /// shutdown hook，H2 干净落盘），限时未退再硬杀兜底。
    fn stop(&self) {
        let mut child = self.0.lock().expect("backend process mutex poisoned");
        if let Some(mut child) = child.take() {
            drop(child.stdin.take());
            let deadline = std::time::Instant::now()
                + Duration::from_millis(GRACEFUL_EXIT_TIMEOUT_MS);
            while std::time::Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    Ok(None) => thread::sleep(Duration::from_millis(100)),
                    Err(_) => break,
                }
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 前端启动门查询：sidecar spawn 是否已失败（None = 未失败）
#[tauri::command]
fn backend_launch_failure(state: tauri::State<'_, BackendLaunchFailure>) -> Option<String> {
    state
        .0
        .lock()
        .expect("backend launch failure mutex poisoned")
        .clone()
}

/// 后端日志目录（backend.out.log / backend.err.log 所在），供失败页展示排障线索
#[tauri::command]
fn backend_log_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("resolve app data dir failed: {e}"))
}

/// 返回当前 Windows 会话中可读取的逻辑盘根；非 Windows 返回 POSIX 根。
#[tauri::command]
fn list_local_roots() -> Vec<String> {
    #[cfg(windows)]
    {
        ('A'..='Z')
            .map(|letter| format!(r"{letter}:\"))
            .filter(|root| Path::new(root).is_dir() && fs::read_dir(root).is_ok())
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec!["/".to_string()]
    }
}

/// 定位 extracted 布局的后端目录（ssh-server-app.jar + lib/，由
/// build-personal.sh 的 jarmode=tools extract 产出）
fn find_backend_dir(resource_dir: &Path) -> Option<PathBuf> {
    [
        resource_dir.join("backend"),
        resource_dir.join("resources").join("backend"),
    ]
    .into_iter()
    .find(|dir| dir.join(BACKEND_JAR_NAME).exists())
}

/// 可用的 CDS 归档路径。归档由用户机首启后台训练生成（构建期生成无效：
/// CDS 校验绑定 jar mtime，安装器解包会改动 mtime 导致随包归档失配回退）。
/// jar 比归档新（应用升级）时删除过期归档，等待本次启动后重训。
fn usable_cds_archive(data_dir: &Path, backend_jar: &Path) -> Option<PathBuf> {
    let archive = data_dir.join("cds").join("app.jsa");
    if !archive.exists() {
        return None;
    }
    let jar_mtime = fs::metadata(backend_jar).and_then(|m| m.modified()).ok();
    let archive_mtime = fs::metadata(&archive).and_then(|m| m.modified()).ok();
    if let (Some(jar), Some(arc)) = (jar_mtime, archive_mtime) {
        if jar > arc {
            let _ = fs::remove_file(&archive);
            return None;
        }
    }
    Some(archive)
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

/// Windows 内核级父死子亡：把后端 JVM 挂进 KILL_ON_JOB_CLOSE 的 Job Object。
/// 壳进程无论如何消亡（崩溃/taskkill/正常退出），OS 关闭 job 句柄即杀后端，
/// 连 stdin 哨兵杀不动的僵死 JVM 也能兜住。job 句柄有意 forget 保活到进程终结
/// ——提前 drop 会立即误杀后端。失败仅记日志不阻断启动：还有哨兵与启动自愈兜底。
#[cfg(windows)]
fn confine_backend_to_job(child: &Child, data_dir: &Path) {
    use std::os::windows::io::AsRawHandle;

    let confined = win32job::Job::create()
        .and_then(|job| {
            let mut info = job.query_extended_limit_info()?;
            info.limit_kill_on_job_close();
            job.set_extended_limit_info(&mut info)?;
            job.assign_process(child.as_raw_handle() as _)?;
            std::mem::forget(job);
            Ok(())
        });
    if let Err(e) = confined {
        let _ = fs::write(
            data_dir.join("backend-job.log"),
            format!("assign backend to job object failed: {e}\n"),
        );
    }
}

#[cfg(not(windows))]
fn confine_backend_to_job(_child: &Child, _data_dir: &Path) {}

/// 后台训练 CDS 归档：起一个短命 JVM（context refresh 完即退），全量隔离
/// （随机端口 / 内存 H2 / 独立密钥与日志），产物先写 .tmp 成功后原子换名。
/// 训练进程生命周期只有几秒且自然退出，不纳入 BackendProcess 管理；
/// 应用在训练期间退出最多残留一个数秒后自灭的进程。
fn spawn_cds_training(java_bin: PathBuf, backend_dir: PathBuf, data_dir: PathBuf) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(CDS_TRAINING_DELAY_SECS));

        let cds_dir = data_dir.join("cds");
        let archive = cds_dir.join("app.jsa");
        if archive.exists() || fs::create_dir_all(&cds_dir).is_err() {
            return;
        }
        let tmp = cds_dir.join("app.jsa.tmp");
        let _ = fs::remove_file(&tmp);

        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(cds_dir.join("training.log"));
        let Ok(log) = log else { return };
        let Ok(log_err) = log.try_clone() else { return };

        let mut command = Command::new(java_bin);
        command
            .current_dir(&backend_dir)
            .arg(format!("-XX:ArchiveClassesAtExit={}", tmp.display()))
            .arg("-Dspring.context.exit=onRefresh")
            .arg("-Dspring.profiles.active=single")
            .arg("-Dserver.port=0")
            .arg("-Dspring.datasource.url=jdbc:h2:mem:cds-training;MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE")
            .arg(format!(
                "-Dssh.crypto.local-key-file={}",
                cds_dir.join("training-secret.key").display()
            ))
            .arg(format!("-DLOG_DIR={}", cds_dir.join("log").display()))
            .arg("-Xms128m")
            .arg("-Xmx512m")
            .arg("-jar")
            .arg(BACKEND_JAR_NAME)
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err))
            .stdin(Stdio::null());
        hide_console(&mut command);

        if let Ok(mut child) = command.spawn() {
            match child.wait() {
                Ok(status) if status.success() && tmp.exists() => {
                    let _ = fs::rename(&tmp, &archive);
                }
                _ => {
                    let _ = fs::remove_file(&tmp);
                }
            }
        }
        let _ = fs::remove_file(cds_dir.join("training-secret.key"));
    });
}

fn start_backend(app: &tauri::App) -> Result<Child, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve resource dir failed: {e}"))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir failed: {e}"))?;

    fs::create_dir_all(&data_dir).map_err(|e| format!("create backend log dir failed: {e}"))?;

    // 启动自愈（仅 release）：8091 被占时按 PID 档案识别孤儿——证据确凿才杀，
    // 查无实据即失败快报。dev 下 8091 是开发者手动后端，壳不插手。
    if !cfg!(debug_assertions) {
        lifecycle::heal_orphan_backend(&data_dir, BACKEND_PORT)?;
    }

    let backend_dir = normalize_windows_path(find_backend_dir(&resource_dir).ok_or_else(
        || {
            format!(
                "backend dir with {BACKEND_JAR_NAME} not found under {}",
                resource_dir.display()
            )
        },
    )?);
    let backend_jar = backend_dir.join(BACKEND_JAR_NAME);

    let java_name = if cfg!(windows) { "java.exe" } else { "java" };
    let java_bin = normalize_windows_path(
        first_existing_path([
            resource_dir.join("runtime").join("bin").join(java_name),
            resource_dir
                .join("resources")
                .join("runtime")
                .join("bin")
                .join(java_name),
        ])
        .ok_or_else(|| format!("embedded java not found under {}", resource_dir.display()))?,
    );

    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("backend.out.log"))
        .map_err(|e| format!("open backend stdout log failed: {e}"))?;
    let stderr = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("backend.err.log"))
        .map_err(|e| format!("open backend stderr log failed: {e}"))?;

    let cds_archive = usable_cds_archive(&data_dir, &backend_jar);

    let jar_size = fs::metadata(&backend_jar).map(|m| m.len()).unwrap_or(0);
    let java_size = fs::metadata(&java_bin).map(|m| m.len()).unwrap_or(0);
    let launch_log = format!(
        "java={}\njava_size={}\nbackend_dir={}\njar_size={}\ncds={}\n",
        java_bin.display(),
        java_size,
        backend_dir.display(),
        jar_size,
        cds_archive
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "none (training pending)".to_string())
    );
    let _ = fs::write(data_dir.join("backend-launch.log"), launch_log);

    // CDS classpath 校验要求与训练时一致的工作目录 + 相对 jar 路径
    let mut command = Command::new(&java_bin);
    command
        .current_dir(&backend_dir)
        .arg("-Dspring.profiles.active=single")
        .arg(format!("-Dserver.port={BACKEND_PORT}"))
        // stdin 哨兵 opt-in：仅壳拉起时启用，管道 EOF（壳退出/关闭写端）即优雅停机
        .arg("-Dlifecycle.stdin-watch=true")
        .arg("-Xms128m")
        .arg("-Xmx512m")
        .arg(format!("-DLOG_DIR={}", data_dir.join("log").display()));
    if let Some(archive) = &cds_archive {
        // 归档失配时 -Xshare:auto 默认静默回退常规加载，不会启动失败
        command.arg(format!("-XX:SharedArchiveFile={}", archive.display()));
    }
    command
        .arg("-jar")
        .arg(BACKEND_JAR_NAME)
        .arg(format!("--server.port={BACKEND_PORT}"))
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        // 管道写端由 Child 持有，随 BackendProcess 存活；stop() drop 之即发 EOF
        .stdin(Stdio::piped());
    hide_console(&mut command);

    let child = command
        .spawn()
        .map_err(|e| format!("start backend failed: {e}"))?;

    confine_backend_to_job(&child, &data_dir);
    // 落档进程证据：下次启动若发现孤儿，凭此识别与清理
    lifecycle::write_pid_file(&data_dir, child.id(), &java_bin);

    // 无可用归档（首启或升级后过期）：错峰后台训练，下次启动开始加速
    if cds_archive.is_none() {
        spawn_cds_training(java_bin, backend_dir, data_dir);
    }

    Ok(child)
}

fn first_existing_path<const N: usize>(candidates: [PathBuf; N]) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.exists())
}

fn normalize_windows_path(path: PathBuf) -> PathBuf {
    if !cfg!(windows) {
        return path;
    }

    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 双开归一必须最先注册：第二实例不落地，只拉起已有窗口。
        // 由此立住自愈公理——探测到 8091 被占时本应用必无其他活实例。
        // toast 点击回跳也走这里：Windows 经 AUMID 快捷方式拉起第二实例并
        // 携带 launch 参数（--aish-task=<task_id>），解析成功则通知前端定位
        // 到对应任务终端（App.tsx 常驻监听 + pendingNavigation 桥，
        // docs/actions/260817 阶段 2）。
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            if let Some(task_id) = coding::notify::parse_task_launch_arg(&args) {
                let _ = app.emit("coding:navigate", serde_json::json!({ "task_id": task_id }));
            }
        }))
        .manage(BackendProcess(Mutex::new(None)))
        .manage(BackendLaunchFailure(Mutex::new(None)))
        .manage(coding::TaskManager::new())
        .setup(|app| {
            // ── AI Coding 功能域初始化（迁移自 nezha）──
            // Windows：后台线程预加载随包侧载的新版 ConPTY（修复部分系统全屏 TUI
            // 输出不进 scrollback）。失败自动回退系统版，见 coding/platform/windows.rs。
            #[cfg(windows)]
            if let Ok(resource_dir) = app.path().resource_dir() {
                coding::platform::spawn_conpty_preload(resource_dir);
            }
            // 后台预热登录 shell 环境，避免第一次启动任务时阻塞
            std::thread::spawn(|| {
                coding::app_settings::get_login_shell_path();
            });
            // 安装 hook 脚本与用户级配置注入（失败不阻塞启动，前端可查询状态）。
            std::thread::spawn(|| {
                coding::hooks::cache_status(coding::hooks::ensure_installed());
                let _ = coding::hooks::regenerate_claude_settings();
            });
            // hook 事件文件 watcher
            coding::event_watcher::start(app.handle().clone());
            // 文件树 fs 事件监听（coding_watch_dir/coding_unwatch_dir 的托管状态与防抖线程）
            coding::fs_watcher::init(app);

            match start_backend(app) {
                Ok(child) => {
                    let backend = app.state::<BackendProcess>();
                    *backend.0.lock().expect("backend process mutex poisoned") = Some(child);
                }
                Err(e) => {
                    eprintln!("failed to start backend: {e}");
                    // dev（debug 构建）下 resources 无 jar、后端由开发者手动外置启动，
                    // spawn 失败是常态，不快报——否则会把活着的手动后端误判成故障。
                    // release 打包版 sidecar 必须成功：失败即暂存 + 广播，
                    // 让启动遮罩立即转失败态而不是傻等 60s ping 超时
                    if !cfg!(debug_assertions) {
                        let message =
                            format!("本地服务进程启动失败：{e}（请修复后重启应用）");
                        *app.state::<BackendLaunchFailure>()
                            .0
                            .lock()
                            .expect("backend launch failure mutex poisoned") =
                            Some(message.clone());
                        let _ = app.emit("backend-launch-failed", message);
                    }
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            backend_launch_failure,
            backend_log_dir,
            list_local_roots,
            // ── AI Coding 功能域命令（统一 coding_ 前缀）──
            coding::pty::coding_run_task,
            coding::pty::coding_resume_task,
            coding::pty::coding_fork_task,
            coding::pty::coding_cancel_task,
            coding::pty::coding_complete_task,
            coding::pty::coding_get_active_task_ids,
            coding::pty::coding_reset_task_process,
            coding::pty::coding_send_input,
            coding::pty::coding_resize_pty,
            coding::pty::coding_open_shell,
            coding::pty::coding_kill_shell,
            coding::fs::coding_read_dir_entries,
            coding::fs::coding_read_compact_dir_entries,
            coding::fs_watcher::coding_watch_dir,
            coding::fs_watcher::coding_unwatch_dir,
            coding::fs::coding_open_in_system_file_manager,
            coding::fs::coding_read_file_content,
            coding::fs::coding_read_image_preview,
            coding::fs::coding_write_file_content,
            coding::fs::coding_create_file,
            coding::fs::coding_create_directory,
            coding::fs::coding_delete_path,
            coding::fs::coding_list_project_files,
            coding::fs::coding_search_project_files,
            coding::agent_assist::coding_generate_task_name,
            coding::analytics::coding_read_session_metrics,
            coding::session::coding_read_session_messages,
            coding::session::coding_export_session_markdown,
            coding::config::coding_init_project_config,
            coding::config::coding_read_project_config,
            coding::config::coding_write_project_config,
            coding::config::coding_get_agent_config_file_path,
            coding::config::coding_read_agent_config_file,
            coding::config::coding_write_agent_config_file,
            coding::storage::coding_load_projects,
            coding::storage::coding_save_projects,
            coding::storage::coding_load_project_tasks,
            coding::storage::coding_save_project_tasks,
            coding::app_settings::coding_load_app_settings,
            coding::app_settings::coding_save_app_settings,
            coding::app_settings::coding_save_agent_paths,
            coding::app_settings::coding_save_agent_model_catalog,
            coding::app_settings::coding_initialize_agent_model_catalog,
            coding::app_settings::coding_save_send_shortcut,
            coding::app_settings::coding_save_shift_enter_newline,
            coding::app_settings::coding_save_claude_force_default_tui,
            coding::app_settings::coding_save_use_sideloaded_conpty,
            coding::app_settings::coding_save_terminal_scrollback,
            coding::app_settings::coding_save_terminal_copy_on_select,
            coding::app_settings::coding_save_desktop_notifications,
            coding::app_settings::coding_save_app_language,
            coding::app_settings::coding_detect_agent_paths,
            coding::app_settings::coding_detect_agent_versions_for_settings,
            coding::app_settings::coding_get_system_fonts,
            coding::hooks::coding_get_hook_status,
            coding::hooks::coding_get_hook_readiness,
            coding::hooks::coding_install_hooks,
            coding::hooks::coding_uninstall_hooks,
            coding::agent_compat::coding_get_permission_catalog,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 有任务/终端在跑时先确认：挂起本次关闭，子线程弹原生对话框
                // ——事件回调跑在主线程，同步等待对话框会死锁。确认后走统一
                // 退出清理并 destroy（prevent_close 已取消默认关闭，必须显式
                // 销毁窗口）；取消则原样留在应用。
                let live = window.state::<coding::TaskManager>().live_session_count();
                if live > 0 {
                    api.prevent_close();
                    let app = window.app_handle().clone();
                    std::thread::spawn(move || {
                        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
                        let confirmed = app
                            .dialog()
                            .message(format!(
                                "还有 {live} 个运行中的任务或终端，退出将终止它们。确定退出吗？"
                            ))
                            .title("仍有任务在运行")
                            .kind(MessageDialogKind::Warning)
                            .buttons(MessageDialogButtons::OkCancelCustom(
                                "退出".to_string(),
                                "取消".to_string(),
                            ))
                            .blocking_show();
                        if confirmed {
                            if let Some(main) = app.get_webview_window("main") {
                                let _ = main.hide();
                            }
                            app.state::<coding::TaskManager>().kill_all_children();
                            app.state::<BackendProcess>().stop();
                            if let Ok(data_dir) = app.path().app_data_dir() {
                                lifecycle::remove_pid_file(&data_dir);
                            }
                            if let Some(main) = app.get_webview_window("main") {
                                let _ = main.destroy();
                            }
                        }
                    });
                    return;
                }
                // 无活跃会话：直接走原有退出链
                // 先藏窗口再同步等待优雅退出（≤3s），用户观感是秒关
                let _ = window.hide();
                // 终止所有仍在运行的 AI Coding 任务/Shell 子进程，防孤儿
                window
                    .state::<coding::TaskManager>()
                    .kill_all_children();
                window.state::<BackendProcess>().stop();
                // 后端已确认终结，进程证据随之销档
                if let Ok(data_dir) = window.app_handle().path().app_data_dir() {
                    lifecycle::remove_pid_file(&data_dir);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
