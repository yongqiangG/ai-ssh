//! 本地 agent（claude/codex）可执行文件解析。
//!
//! ## 为什么不能直接 spawn `claude` / `codex`？
//! Windows 上 npm 全局安装的 claude 是 `claude.cmd`（batch shim）、codex 是
//! `codex` 无扩展名 shim。把 batch shim 直接交给 portable-pty 进 ConPTY 会出问题
//! （踩坑实证来自 Nezha）：正确做法是解析 npm 包内的真实 `.exe`——
//! - claude → `@anthropic-ai/claude-code/bin/claude.exe`
//! - codex → `@openai/codex` 包内 vendor 平台的 `codex.exe`，并把其 `path/` 目录
//!   前置进子进程 PATH、注入 `CODEX_MANAGED_BY_NPM=1`（codex 依赖该变量定位自身）
//! 找不到 vendor 产物时回退 PATH 原样解析，保证「没装好也能给出可读错误」。

use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub(crate) struct AgentLaunchSpec {
    pub(crate) program: String,
    pub(crate) extra_env: Vec<(String, String)>,
}

/// 解析 agent 启动目标。`configured_path` 为空时从 PATH 解析。
pub(crate) fn resolve_agent_launch_spec(
    agent: &str,
    configured_path: Option<&str>,
) -> AgentLaunchSpec {
    let configured = configured_path.unwrap_or("").trim();
    let input = if configured.is_empty() {
        agent.to_string()
    } else {
        configured.to_string()
    };
    let resolved = resolve_input_path(&input, agent);

    #[cfg(windows)]
    {
        resolve_agent_launch_spec_windows(agent, &resolved)
    }
    #[cfg(not(windows))]
    {
        AgentLaunchSpec {
            program: resolved,
            extra_env: Vec::new(),
        }
    }
}

/// PATH / 显式路径解析：返回可执行文件的绝对路径，找不到时原样返回输入
/// （让 spawn 报出原生的「程序未找到」错误）。
fn resolve_input_path(path: &str, binary: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        let detected = detect_path(binary);
        return if detected.is_empty() {
            binary.to_string()
        } else {
            detected
        };
    }
    let detected = detect_path(trimmed);
    if detected.is_empty() {
        trimmed.to_string()
    } else {
        detected
    }
}

/// 按 PATH 查找可执行文件（含 PATHEXT 扩展名试探），找不到返回空串。
pub(crate) fn detect_path(binary: &str) -> String {
    if binary.contains('\\') || binary.contains('/') {
        let candidate = PathBuf::from(binary);
        return if candidate.is_file() {
            candidate.to_string_lossy().into_owned()
        } else {
            String::new()
        };
    }

    let path_value = login_shell_path();
    if path_value.is_empty() {
        return String::new();
    }

    let has_extension = Path::new(binary).extension().is_some();
    find_on_path(binary, &path_value, has_extension).unwrap_or_default()
}

fn find_on_path(binary: &str, path_value: &str, has_extension: bool) -> Option<String> {
    let path_exts = if has_extension {
        vec![String::new()]
    } else {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
            .split(';')
            .filter(|ext| !ext.is_empty())
            .map(|ext| ext.to_string())
            .collect::<Vec<_>>()
    };

    for dir in path_value.split(';').filter(|segment| !segment.is_empty()) {
        if has_extension {
            let candidate = Path::new(dir).join(binary);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
            continue;
        }

        for ext in &path_exts {
            let candidate = Path::new(dir).join(format!("{binary}{ext}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }

    None
}

/// 当前进程环境的 PATH（懒加载）。
fn login_shell_path() -> String {
    std::env::var("PATH").unwrap_or_default()
}

// ── Windows：npm 包内真实 exe 解析 ──────────────────────────────────────────
// 直接 spawn batch shim（claude.cmd / codex）进 ConPTY 有踩坑，须解析出 npm
// 包内的真实可执行文件。非 Windows 平台走 PATH 原样解析（上面非 cfg 分支）。

#[cfg(windows)]
fn resolve_agent_launch_spec_windows(agent: &str, resolved: &str) -> AgentLaunchSpec {
    let resolved_path = Path::new(resolved);

    match agent {
        "claude" => {
            let program = if let Some(exe) = candidate_from_ancestors(
                resolved_path,
                "@anthropic-ai",
                "claude-code",
                &["bin", "claude.exe"],
            ) {
                exe.to_string_lossy().into_owned()
            } else {
                resolved.to_string()
            };
            AgentLaunchSpec {
                program,
                extra_env: Vec::new(),
            }
        }
        "codex" => {
            if let Some((program, path_dir)) = resolve_codex_vendor_artifact(resolved_path) {
                let mut extra_env = Vec::new();
                if let Some(path_value) = path_dir
                    .as_ref()
                    .filter(|d| d.is_dir())
                    .and_then(|d| prepend_to_path(std::slice::from_ref(d)))
                {
                    extra_env.push(("PATH".to_string(), path_value));
                }
                extra_env.push(("CODEX_MANAGED_BY_NPM".to_string(), "1".to_string()));
                AgentLaunchSpec {
                    program: program.to_string_lossy().into_owned(),
                    extra_env,
                }
            } else {
                AgentLaunchSpec {
                    program: resolved.to_string(),
                    extra_env: Vec::new(),
                }
            }
        }
        _ => AgentLaunchSpec {
            program: resolved.to_string(),
            extra_env: Vec::new(),
        },
    }
}

#[cfg(windows)]
fn path_file_name_eq(path: &Path, expected: &str) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(expected))
}

#[cfg(windows)]
fn find_scoped_package_root(path: &Path, scope: &str, package: &str) -> Option<PathBuf> {
    let mut current = if path.is_dir() {
        Some(path)
    } else {
        path.parent()
    };
    while let Some(dir) = current {
        let parent = dir.parent()?;
        if path_file_name_eq(dir, package) && path_file_name_eq(parent, scope) {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}

#[cfg(windows)]
fn npm_package_root_from_shim(path: &Path, scope: &str, package: &str) -> Option<PathBuf> {
    let shim_dir = path.parent()?;
    let candidate = shim_dir.join("node_modules").join(scope).join(package);
    candidate.is_dir().then_some(candidate)
}

#[cfg(windows)]
fn candidate_from_ancestors(
    path: &Path,
    scope: &str,
    package: &str,
    relative: &[&str],
) -> Option<PathBuf> {
    let package_root = find_scoped_package_root(path, scope, package)
        .or_else(|| npm_package_root_from_shim(path, scope, package))?;
    let mut candidate = package_root;
    for segment in relative {
        candidate.push(segment);
    }
    candidate.is_file().then_some(candidate)
}

#[cfg(windows)]
fn codex_vendor_artifact_from_vendor_root(
    vendor_root: &Path,
) -> Option<(PathBuf, Option<PathBuf>)> {
    if !vendor_root.is_dir() {
        return None;
    }

    let mut arch_roots = fs::read_dir(vendor_root)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    arch_roots.sort();

    for arch_root in arch_roots {
        let exe = arch_root.join("codex").join("codex.exe");
        if exe.is_file() {
            let path_dir = arch_root.join("path");
            return Some((exe, path_dir.is_dir().then_some(path_dir)));
        }
    }

    None
}

#[cfg(windows)]
fn resolve_codex_vendor_artifact(path: &Path) -> Option<(PathBuf, Option<PathBuf>)> {
    if path_file_name_eq(path, "codex.exe")
        && path
            .parent()
            .is_some_and(|parent| path_file_name_eq(parent, "codex"))
    {
        let arch_root = path.parent()?.parent()?;
        let path_dir = arch_root.join("path");
        return Some((path.to_path_buf(), path_dir.is_dir().then_some(path_dir)));
    }

    let package_root = find_scoped_package_root(path, "@openai", "codex")
        .or_else(|| npm_package_root_from_shim(path, "@openai", "codex"))?;

    if let Some(found) = codex_vendor_artifact_from_vendor_root(&package_root.join("vendor")) {
        return Some(found);
    }

    // Some npm releases keep the platform package nested under the main
    // @openai/codex package. Search only the expected scoped directory and
    // only codex-win32-* packages; do not recursively scan arbitrary paths.
    let nested_scope = package_root.join("node_modules").join("@openai");
    let mut platform_packages = fs::read_dir(nested_scope)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|candidate| {
            candidate.is_dir()
                && candidate
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("codex-win32-"))
        })
        .collect::<Vec<_>>();
    platform_packages.sort();

    platform_packages
        .into_iter()
        .find_map(|package| codex_vendor_artifact_from_vendor_root(&package.join("vendor")))
}

#[cfg(windows)]
fn prepend_to_path(entries: &[PathBuf]) -> Option<String> {
    let prefixes = entries
        .iter()
        .filter(|path| path.is_dir())
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    if prefixes.is_empty() {
        return None;
    }

    let existing = std::env::var("PATH").unwrap_or_default();
    let mut combined = prefixes.join(";");
    if !existing.is_empty() {
        combined.push(';');
        combined.push_str(&existing);
    }
    Some(combined)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    struct TestRoot(PathBuf);

    impl TestRoot {
        fn new() -> Self {
            let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "ai-ssh-agent-bin-{}-{}",
                std::process::id(),
                id
            ));
            fs::create_dir_all(&path).expect("create test root");
            Self(path)
        }

        fn touch(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().expect("test file parent")).expect("create parent");
            fs::write(&path, b"test").expect("write test file");
            path
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn preserves_an_unresolved_explicit_agent_path_for_spawn_error_context() {
        let configured = if cfg!(windows) {
            r"C:\does-not-exist\local-agent.exe"
        } else {
            "/does-not-exist/local-agent"
        };
        assert_eq!(resolve_input_path(configured, "claude"), configured);
    }

    #[cfg(windows)]
    #[test]
    fn resolves_claude_npm_shim_to_real_executable() {
        let root = TestRoot::new();
        let shim = root.touch(r"npm\claude.cmd");
        let executable = root.touch(r"npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe");

        let spec =
            resolve_agent_launch_spec("claude", Some(shim.to_str().expect("utf-8 test path")));

        assert_eq!(Path::new(&spec.program), executable);
        assert!(spec.extra_env.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn resolves_codex_vendor_executable_and_runtime_path() {
        let root = TestRoot::new();
        let shim = root.touch(r"npm\codex.cmd");
        let executable = root
            .touch(r"npm\node_modules\@openai\codex\vendor\x86_64-pc-windows-msvc\codex\codex.exe");
        let vendor_path = root
            .touch(r"npm\node_modules\@openai\codex\vendor\x86_64-pc-windows-msvc\path\helper.dll");
        let path_dir = vendor_path.parent().expect("vendor path parent");

        let spec =
            resolve_agent_launch_spec("codex", Some(shim.to_str().expect("utf-8 test path")));

        assert_eq!(Path::new(&spec.program), executable);
        let path_value = spec
            .extra_env
            .iter()
            .find(|(key, _)| key == "PATH")
            .map(|(_, value)| value)
            .expect("vendor path environment");
        assert!(path_value
            .split(';')
            .next()
            .is_some_and(|prefix| Path::new(prefix) == path_dir));
        assert_eq!(
            spec.extra_env
                .iter()
                .find(|(key, _)| key == "CODEX_MANAGED_BY_NPM")
                .map(|(_, value)| value.as_str()),
            Some("1")
        );
    }
}
