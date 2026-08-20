use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

// ── Data types (mirror TypeScript interfaces) ────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub branch: Option<String>,
    #[serde(rename = "lastOpenedAt")]
    pub last_opened_at: i64,
    // 缺省=常驻；旧数据无此字段时默认 false，序列化时省略 false 以保持文件简洁。
    #[serde(
        rename = "hiddenFromRail",
        default,
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub hidden_from_rail: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Task {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub prompt: String,
    pub agent: String,
    #[serde(rename = "permissionMode")]
    pub permission_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(
        rename = "reasoningEffort",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_effort: Option<String>,
    pub status: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(rename = "attentionRequestedAt", skip_serializing_if = "Option::is_none")]
    pub attention_requested_at: Option<i64>,
    #[serde(rename = "claudeSessionId", skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    #[serde(rename = "claudeSessionPath", skip_serializing_if = "Option::is_none")]
    pub claude_session_path: Option<String>,
    #[serde(rename = "codexSessionId", skip_serializing_if = "Option::is_none")]
    pub codex_session_id: Option<String>,
    #[serde(rename = "codexSessionPath", skip_serializing_if = "Option::is_none")]
    pub codex_session_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,
    #[serde(rename = "failureReason", skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

// ── Path helpers ─────────────────────────────────────────────────────────────

pub(crate) fn coding_dir() -> Result<std::path::PathBuf, String> {
    let home =
        crate::coding::platform::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    Ok(home.join(".ai-ssh").join("coding"))
}

fn projects_path() -> Result<PathBuf, String> {
    Ok(coding_dir()?.join("projects.json"))
}

fn tasks_path(project_id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(project_id)?.join("tasks.json"))
}

fn project_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(coding_dir()?.join("projects").join(project_id))
}

pub(crate) fn ensure_coding_dirs() -> Result<(), String> {
    fs::create_dir_all(coding_dir()?).map_err(|e| e.to_string())
}

fn ensure_project_dir(project_id: &str) -> Result<(), String> {
    fs::create_dir_all(project_dir(project_id)?).map_err(|e| e.to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn coding_load_projects() -> Result<Vec<Project>, String> {
    let path = projects_path()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn coding_save_projects(projects: Vec<Project>) -> Result<(), String> {
    ensure_coding_dirs()?;
    let raw = serde_json::to_string_pretty(&projects).map_err(|e| e.to_string())?;
    atomic_write(&projects_path()?, &raw)
}

#[tauri::command]
pub fn coding_load_project_tasks(project_id: String) -> Result<Vec<Task>, String> {
    let path = tasks_path(&project_id)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|parse_err| {
        // 系统崩溃(掉电/蓝屏)可能留下空或截断的 tasks.json。把损坏文件挪走
        // 保留人工恢复现场,下次启动即回到正常空列表,不会永久卡死在解析报错上。
        let secs = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let backup = path.with_file_name(format!("tasks.json.corrupt-{secs}"));
        match fs::rename(&path, &backup) {
            Ok(()) => format!(
                "tasks.json is corrupted ({parse_err}); moved to {} for manual recovery",
                backup.display()
            ),
            Err(mv_err) => {
                format!("tasks.json is corrupted ({parse_err}); failed to move it aside: {mv_err}")
            }
        }
    })
}

#[tauri::command]
pub fn coding_save_project_tasks(project_id: String, tasks: Vec<Task>) -> Result<(), String> {
    ensure_project_dir(&project_id)?;
    // 空列表也照常写 "[]",不删文件:删除路径曾放大过崩溃后的数据丢失
    // (加载失败 → 前端空 state → 空列表保存把磁盘上仅存的原始文件删掉)。
    let raw = serde_json::to_string_pretty(&tasks).map_err(|e| e.to_string())?;
    atomic_write(&tasks_path(&project_id)?, &raw)
}

/// 删除项目时同步删除其数据目录（tasks.json + 可能残留的 corrupt 备份）。
/// 260820 评审 P2-5：此前只删 projects.json 索引，目录永久残留。agent 会话
/// jsonl 在 ~/.claude / ~/.codex 原位、本就不归本目录管，不受影响。
/// 目录不存在视为成功（重复删除幂等）。
#[tauri::command]
pub fn coding_delete_project_data(project_id: String) -> Result<(), String> {
    remove_dir_if_exists(&project_dir(&project_id)?)
}

/// `coding_delete_project_data` 的内核（测试可注入任意目录）。
fn remove_dir_if_exists(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(dir).map_err(|e| format!("failed to remove {}: {}", dir.display(), e))
}

// ── 启动期残留清理 ────────────────────────────────────────────────────────────

/// 启动时清理崩溃孤儿附件（260820 评审 P2-6）：app 被强杀时 finalize 不会
/// 执行，`<project>/.ai-coding/attachments/<taskId>/` 永久残留。启动此刻
/// 无任何任务在跑，各项目 attachments 目录下的内容必然全是孤儿，整目录
/// 清空是安全的（与 event_watcher 启动清空 events 根同语义）；目录由
/// `coding_init_project_config` 在项目打开时重建。
/// 返回成功删除的目录数（仅供测试/诊断）。
pub(crate) fn cleanup_orphan_attachments() -> usize {
    let Ok(projects) = coding_load_projects() else {
        return 0;
    };
    let paths: Vec<String> = projects.into_iter().map(|p| p.path).collect();
    cleanup_orphan_attachments_for_paths(&paths)
}

fn cleanup_orphan_attachments_for_paths(project_paths: &[String]) -> usize {
    let mut removed = 0;
    for path in project_paths {
        let attachments = Path::new(path).join(".ai-coding").join("attachments");
        if attachments.is_dir() && fs::remove_dir_all(&attachments).is_ok() {
            removed += 1;
        }
    }
    removed
}

// ── Atomic write (write to tmp then rename) ───────────────────────────────────

/// 原子写入：先写入唯一临时文件，fsync 落盘后再 rename 到目标路径。
/// 临时文件名包含 pid + 纳秒时间戳，避免并发写入时临时文件相互覆盖。
///
/// rename 只保证元数据原子性,不保证数据先于 rename 落盘——NTFS/APFS 都只
/// journal 元数据,掉电/系统崩溃时会留下 0 字节或截断的目标文件(Windows 用户
/// 实际踩过:突然重启后 tasks.json 清空)。rename 前必须 sync_all
/// (Windows=FlushFileBuffers,macOS=F_FULLFSYNC)强制数据先持久化。
pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let uid = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{file_name}.{uid}.tmp"));
    let write_and_sync = || -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()
    };
    if let Err(e) = write_and_sync() {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("nezha-storage-{}-{}", tag, uuid::Uuid::new_v4()))
    }

    /// 删项目数据目录：存在 → 删除成功；不存在 → 幂等 Ok
    #[test]
    fn remove_dir_if_exists_deletes_and_is_idempotent() {
        let dir = temp_dir("del");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("tasks.json"), "[]").unwrap();
        fs::write(dir.join("sub").join("tasks.json.corrupt-123"), "x").unwrap();

        remove_dir_if_exists(&dir).unwrap();
        assert!(!dir.exists());
        // 不存在时再删：Ok（幂等）
        remove_dir_if_exists(&dir).unwrap();
    }

    /// 孤儿附件启动清理：只清各项目的 attachments 目录，不动项目内其他内容，
    /// 项目路径不存在时跳过
    #[test]
    fn cleanup_orphan_attachments_removes_only_attachments() {
        let proj1 = temp_dir("p1");
        let proj2 = temp_dir("p2");
        fs::create_dir_all(proj1.join(".ai-coding").join("attachments").join("t1")).unwrap();
        fs::create_dir_all(proj1.join(".ai-coding")).unwrap();
        fs::write(proj1.join(".ai-coding").join("config.toml"), "x").unwrap();
        fs::create_dir_all(proj2.join(".ai-coding").join("attachments")).unwrap();

        let removed = cleanup_orphan_attachments_for_paths(&[
            proj1.to_string_lossy().into_owned(),
            proj2.to_string_lossy().into_owned(),
            // 不存在的项目路径：跳过不 panic
            temp_dir("missing").to_string_lossy().into_owned(),
        ]);

        assert_eq!(removed, 2);
        assert!(!proj1.join(".ai-coding").join("attachments").exists());
        // config.toml 保留（只清 attachments，不清整个 .ai-coding）
        assert!(proj1.join(".ai-coding").join("config.toml").exists());
        assert!(!proj2.join(".ai-coding").join("attachments").exists());

        let _ = fs::remove_dir_all(&proj1);
        let _ = fs::remove_dir_all(&proj2);
    }
}
