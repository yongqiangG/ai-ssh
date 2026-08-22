//! Agent CLI 参数适配层（决议 docs/situations/260816-agent-cli-compat.md）。
//!
//! 权限三档（ask/auto_edit/full_access）经「版本号 → flag 组合」映射表适配：
//! - 每个 agent 一组条目，按 min_version 降序，取首个 `version >= min` 命中；
//! - 版本未知 / 低于全部门槛 → 安全侧回退：所有档位一律不带权限 flag
//!   （full_access 因此降为 ask 档语义），并标记 degraded 供上层告警——
//!   映射过期不得静默放行危险档，也不阻断任务启动；
//! - UI 侧经 `coding_get_permission_catalog` 读取同一张表渲染差异副标题与
//!   tooltip（实际下发的 flag 原文），适配层对错一眼可验。
//!
//! 语义事实（2026-08-16 实测 + 官方文档核实）：
//! - claude `--permission-mode default` 是 Manual 模式的 config 值（只读外
//!   全部手动确认），CLI choices 里的 `manual` 为别名；
//! - codex ask 档显式传 `-s read-only -a untrusted`，不再裸奔吃 CLI 默认值
//!   （TUI 默认 + 项目 trust_level=trusted 会静默放行工作区写入）。

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionTier {
    Ask,
    AutoEdit,
    FullAccess,
}

impl PermissionTier {
    pub fn from_mode(mode: &str) -> Option<Self> {
        match mode {
            "ask" => Some(Self::Ask),
            "auto_edit" => Some(Self::AutoEdit),
            "full_access" => Some(Self::FullAccess),
            _ => None,
        }
    }
}

/// 单个档位在某版本区间的 flag 组合。args 即实际下发参数原文（tooltip 透出）。
pub struct TierSpec {
    pub args: &'static [&'static str],
    /// 前端差异副标题 i18n key（perm.subtitle.<agent>.<suffix>）
    pub subtitle_key: &'static str,
}

/// 一个 agent 的适配条目。entries 按 min_version 降序，取首个命中。
struct AgentCompat {
    entries: &'static [CompatEntry],
}

struct CompatEntry {
    min_version: &'static str,
    tiers: [TierSpec; 3],
}

const CLAUDE_TIERS: [TierSpec; 3] = [
    TierSpec {
        args: &["--permission-mode", "default"],
        subtitle_key: "perm.subtitle.claude.ask",
    },
    TierSpec {
        args: &["--permission-mode", "acceptEdits"],
        subtitle_key: "perm.subtitle.claude.auto_edit",
    },
    TierSpec {
        args: &["--dangerously-skip-permissions"],
        subtitle_key: "perm.subtitle.claude.full_access",
    },
];

const CODEX_TIERS: [TierSpec; 3] = [
    TierSpec {
        args: &["-s", "read-only", "-a", "untrusted"],
        subtitle_key: "perm.subtitle.codex.ask",
    },
    TierSpec {
        args: &["--sandbox", "workspace-write", "-a", "on-request"],
        subtitle_key: "perm.subtitle.codex.auto_edit",
    },
    TierSpec {
        args: &["--dangerously-bypass-approvals-and-sandbox"],
        subtitle_key: "perm.subtitle.codex.full_access",
    },
];

const CLAUDE_COMPAT: AgentCompat = AgentCompat {
    entries: &[CompatEntry {
        // --session-id/--settings 依赖的同族版本线；default/acceptEdits 在更早
        // 版本同样合法，保守取与 hook 链路一致的门槛。
        min_version: "2.1.87",
        tiers: CLAUDE_TIERS,
    }],
};

const CODEX_COMPAT: AgentCompat = AgentCompat {
    entries: &[CompatEntry {
        // -a untrusted 档位与 hook 相关 flag 的同族版本线。
        min_version: "0.131.0",
        tiers: CODEX_TIERS,
    }],
};

fn compat_for(agent: &str) -> Option<&'static AgentCompat> {
    match agent {
        "claude" => Some(&CLAUDE_COMPAT),
        "codex" => Some(&CODEX_COMPAT),
        _ => None,
    }
}

fn parse_semver(v: &str) -> (u64, u64, u64) {
    let parts: Vec<&str> = v.split('.').collect();
    (
        parts.first().and_then(|s| s.parse().ok()).unwrap_or(0),
        parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
        parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0),
    )
}

/// 解析结果：args 为应下发的权限参数（degraded 时空 = 不带权限 flag），
/// degraded 表示映射表未覆盖当前版本、已安全侧回退，上层需告警。
#[derive(Debug, PartialEq, Eq)]
pub struct ResolvedTier {
    pub args: Vec<&'static str>,
    pub subtitle_key: &'static str,
    pub degraded: bool,
}

/// 按已知版本字符串解析（纯函数，可单测）。
pub fn resolve_tier_with_version(agent: &str, mode: &str, version: Option<&str>) -> ResolvedTier {
    let Some(compat) = compat_for(agent) else {
        return ResolvedTier { args: vec![], subtitle_key: "", degraded: true };
    };
    let Some(tier) = PermissionTier::from_mode(mode) else {
        return ResolvedTier { args: vec![], subtitle_key: "", degraded: true };
    };

    let hit = version
        .and_then(|v| {
            let pv = parse_semver(v);
            compat
                .entries
                .iter()
                .find(|e| pv >= parse_semver(e.min_version))
        })
        .map(|e| &e.tiers[tier as usize]);

    match hit {
        Some(spec) => ResolvedTier {
            args: spec.args.to_vec(),
            subtitle_key: spec.subtitle_key,
            degraded: false,
        },
        // 版本未知或低于全部门槛：一律不带权限 flag（full_access 随之降为
        // ask 档语义），交由上层提示用户当前 CLI 版本未经适配。
        None => ResolvedTier {
            args: vec![],
            // 副标题退回通用回退文案 key
            subtitle_key: "perm.subtitle.fallback",
            degraded: true,
        },
    }
}

/// 运行时解析：探测 agent 版本（带缓存，首次可能起子进程，须在 blocking
/// 线程调用），再走纯函数映射。args 以 String 返回便于直接拼命令。
pub fn resolve_tier(agent: &str, mode: &str) -> ResolvedTier {
    let version = if agent == "codex" {
        crate::coding::app_settings::detect_codex_version()
    } else {
        crate::coding::app_settings::detect_claude_version()
    };
    let resolved = resolve_tier_with_version(agent, mode, version.as_deref());
    ResolvedTier {
        args: resolved.args.to_vec(),
        subtitle_key: resolved.subtitle_key,
        degraded: resolved.degraded,
    }
}

// ── 权限目录（前端差异副标题 + tooltip 数据源）──────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TierCatalogItem {
    pub key: String,
    pub args: Vec<String>,
    pub subtitle_key: String,
    pub degraded: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalog {
    pub agent: String,
    pub version: String,
    pub tiers: Vec<TierCatalogItem>,
    /// effort 传参方式（"flag" = --effort <v>；"config" = -c model_reasoning_effort）
    pub effort_style: String,
    /// 仅 codex：当前项目是否命中 ~/.codex/config.toml 的 trust_level=trusted
    /// （trusted 项目下工作区写入免审批，ask 档副标题需追加警示）
    pub trusted_project: bool,
}

/// codex 项目信任判定：projects 表里 trust_level=trusted 且路径为本项目或其
/// 祖先（用户常把盘根标 trusted，语义上覆盖全部子目录）。
fn codex_project_trusted(project_path: Option<&str>) -> bool {
    let Some(project) = project_path else { return false };
    let Ok(home) = crate::coding::platform::home_dir()
        .ok_or_else(|| "no home".to_string())
        .map(|h| h.join(".codex").join("config.toml"))
    else {
        return false;
    };
    let Ok(raw) = std::fs::read_to_string(&home) else {
        return false;
    };
    let Ok(value) = raw.parse::<toml::Value>() else {
        return false;
    };
    let Some(projects) = value.get("projects").and_then(|v| v.as_table()) else {
        return false;
    };
    let normalize =
        |p: &str| p.to_ascii_lowercase().replace('/', "\\").trim_end_matches('\\').to_string();
    let target = normalize(project);
    projects.iter().any(|(path, v)| {
        if v.get("trust_level").and_then(|t| t.as_str()) != Some("trusted") {
            return false;
        }
        let key = normalize(path);
        key == target || target.starts_with(&format!("{key}\\"))
    })
}

#[tauri::command]
pub async fn coding_get_permission_catalog(
    project_path: Option<String>,
) -> Result<Vec<AgentCatalog>, String> {
    tokio::task::spawn_blocking(move || {
        ["claude", "codex"]
            .iter()
            .map(|&agent| {
                let version = if agent == "codex" {
                    crate::coding::app_settings::detect_codex_version()
                } else {
                    crate::coding::app_settings::detect_claude_version()
                };
                let version_str = version.clone().unwrap_or_default();
                let tiers = ["ask", "auto_edit", "full_access"]
                    .iter()
                    .map(|&mode| {
                        let r = resolve_tier_with_version(agent, mode, version.as_deref());
                        TierCatalogItem {
                            key: mode.to_string(),
                            args: r.args.iter().map(|a| a.to_string()).collect(),
                            subtitle_key: r.subtitle_key.to_string(),
                            degraded: r.degraded,
                        }
                    })
                    .collect();
                AgentCatalog {
                    agent: agent.to_string(),
                    version: version_str,
                    tiers,
                    effort_style: if agent == "codex" {
                        "config".to_string()
                    } else {
                        "flag".to_string()
                    },
                    trusted_project: agent == "codex" && codex_project_trusted(project_path.as_deref()),
                }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

// ── 单元测试 ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_ask_maps_to_documented_manual_mode() {
        let r = resolve_tier_with_version("claude", "ask", Some("2.1.233"));
        assert_eq!(r.args, vec!["--permission-mode", "default"]);
        assert!(!r.degraded);
    }

    #[test]
    fn claude_tier_boundaries() {
        assert!(!resolve_tier_with_version("claude", "auto_edit", Some("2.1.87")).degraded);
        let old = resolve_tier_with_version("claude", "auto_edit", Some("2.1.86"));
        assert!(old.degraded);
        assert!(old.args.is_empty());
    }

    #[test]
    fn codex_ask_passes_explicit_manual_confirm_flags() {
        let r = resolve_tier_with_version("codex", "ask", Some("0.144.6"));
        assert_eq!(r.args, vec!["-s", "read-only", "-a", "untrusted"]);
        assert!(!r.degraded);
    }

    #[test]
    fn unknown_version_degrades_safely_on_every_tier() {
        for mode in ["ask", "auto_edit", "full_access"] {
            let r = resolve_tier_with_version("codex", mode, None);
            assert!(r.degraded, "{mode} should degrade");
            // full_access 同样收敛为无权限 flag（降为 ask 档语义）
            assert!(r.args.is_empty(), "{mode} args should be empty");
            assert_eq!(r.subtitle_key, "perm.subtitle.fallback");
        }
    }

    #[test]
    fn unknown_agent_or_mode_degrades() {
        assert!(resolve_tier_with_version("gemini", "ask", Some("1.0.0")).degraded);
        assert!(resolve_tier_with_version("claude", "yolo", Some("2.1.233")).degraded);
    }
}
