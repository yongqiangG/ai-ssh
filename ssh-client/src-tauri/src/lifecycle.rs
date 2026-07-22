//! 启动自愈：识别并清理孤儿后端 JVM。
//!
//! 预防层（stdin 哨兵 + Windows Job Object）漏网时的启动期兜底。核心纪律：
//! **杀进程必须有进程级证据**——PID 文件记录「我们 spawn 过谁、用哪个 java」，
//! 校验通过（存活 + 可执行路径吻合）才杀；查无实据的端口占用绝不动手，
//! 转为失败快报把占用者信息交给用户处置。
//! single-instance 插件保证探测时本应用无其他活实例，占用者不可能是兄弟实例。

use std::{
    fs,
    net::{Ipv4Addr, SocketAddrV4, TcpStream},
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use sysinfo::{Pid, ProcessesToUpdate, System};

const PID_FILE_NAME: &str = "backend.pid";
/// 杀掉孤儿后等待端口/H2 文件锁释放的上限
const ORPHAN_RELEASE_TIMEOUT_MS: u64 = 5000;

/// spawn 成功后立即落档：PID + 所用 java 的绝对路径（各一行）。
/// 这是下次启动识别孤儿的唯一合法证据。
pub fn write_pid_file(data_dir: &Path, pid: u32, java_bin: &Path) {
    let content = format!("{pid}\n{}\n", java_bin.display());
    let _ = fs::write(data_dir.join(PID_FILE_NAME), content);
}

/// 优雅退出 / 孤儿清理成功后删档，避免陈旧 PID 被复用误判
pub fn remove_pid_file(data_dir: &Path) {
    let _ = fs::remove_file(data_dir.join(PID_FILE_NAME));
}

/// 解析 PID 文件内容 → (pid, 当时的 java 路径)。格式不符即无证据。
fn parse_pid_file(content: &str) -> Option<(u32, PathBuf)> {
    let mut lines = content.lines();
    let pid = lines.next()?.trim().parse::<u32>().ok()?;
    let java = lines.next()?.trim();
    if java.is_empty() {
        return None;
    }
    Some((pid, PathBuf::from(java)))
}

/// 路径等同性：canonicalize 消 \\?\ 前缀与符号差异后比较；
/// Windows 文件系统大小写不敏感，统一小写再比。任一侧 canonicalize
/// 失败（如文件已删）按原样路径退化比较。
fn same_executable(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let canon = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        let s = canon.to_string_lossy().to_string();
        if cfg!(windows) {
            s.to_lowercase()
        } else {
            s
        }
    };
    norm(a) == norm(b)
}

fn backend_port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(),
        Duration::from_millis(300),
    )
    .is_ok()
}

/// 端口被占时的占用者线索（尽力而为）：netstat/lsof 查监听 PID，
/// 再用 sysinfo 反查进程名，拼进失败信息帮用户定位。
fn describe_port_owner(port: u16) -> String {
    let Some(pid) = find_listener_pid(port) else {
        return format!("端口 {port} 被未知进程占用");
    };
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    match system.process(Pid::from_u32(pid)) {
        Some(process) => format!(
            "端口 {port} 被进程 {} (PID {pid}) 占用",
            process.name().to_string_lossy()
        ),
        None => format!("端口 {port} 被 PID {pid} 占用"),
    }
}

#[cfg(windows)]
fn find_listener_pid(port: u16) -> Option<u32> {
    let output = std::process::Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
        .ok()?;
    parse_netstat_listener_pid(&String::from_utf8_lossy(&output.stdout), port)
}

#[cfg(not(windows))]
fn find_listener_pid(port: u16) -> Option<u32> {
    let output = std::process::Command::new("lsof")
        .args([
            "-nP",
            &format!("-iTCP:{port}"),
            "-sTCP:LISTEN",
            "-Fp",
        ])
        .output()
        .ok()?;
    parse_lsof_listener_pid(&String::from_utf8_lossy(&output.stdout))
}

/// netstat -ano 输出中找 «本地地址以 :port 结尾 且 LISTENING» 行的 PID 列
fn parse_netstat_listener_pid(output: &str, port: u16) -> Option<u32> {
    let suffix = format!(":{port}");
    output.lines().find_map(|line| {
        let cols: Vec<&str> = line.split_whitespace().collect();
        match cols.as_slice() {
            ["TCP", local, _, "LISTENING", pid] if local.ends_with(&suffix) => {
                pid.parse::<u32>().ok()
            }
            _ => None,
        }
    })
}

/// lsof -Fp 输出形如 "p1234"，取第一个 p 记录
#[cfg_attr(windows, allow(dead_code))]
fn parse_lsof_listener_pid(output: &str) -> Option<u32> {
    output
        .lines()
        .find_map(|line| line.strip_prefix('p')?.parse::<u32>().ok())
}

/// 启动自愈主流程（仅 release 调用）。返回 Err 即「端口被占且不敢处置」，
/// 错误串是纯事实陈述，由调用侧统一包上「启动失败/请处理后重启」外壳。
pub fn heal_orphan_backend(data_dir: &Path, port: u16) -> Result<(), String> {
    if !backend_port_in_use(port) {
        return Ok(());
    }

    let pid_path = data_dir.join(PID_FILE_NAME);
    let evidence = fs::read_to_string(&pid_path)
        .ok()
        .and_then(|content| parse_pid_file(&content));

    let Some((pid, recorded_java)) = evidence else {
        return Err(format!(
            "{}，查无本应用残留档案，不予自动清理",
            describe_port_owner(port)
        ));
    };

    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    let Some(process) = system.process(Pid::from_u32(pid)) else {
        // 档案在但进程已死：端口另有其主，档案是陈旧残留
        remove_pid_file(data_dir);
        return Err(format!(
            "{}，残留档案已过期，不予自动清理",
            describe_port_owner(port)
        ));
    };

    // PID 复用防误杀：可执行路径必须与档案记录的 java 完全吻合
    let exe_matches = process
        .exe()
        .map(|exe| same_executable(exe, &recorded_java))
        .unwrap_or(false);
    if !exe_matches {
        return Err(format!(
            "{}，进程与残留档案不符，不予自动清理",
            describe_port_owner(port)
        ));
    }

    process.kill();
    let deadline = std::time::Instant::now() + Duration::from_millis(ORPHAN_RELEASE_TIMEOUT_MS);
    while backend_port_in_use(port) {
        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "已清理上次残留的本地服务（PID {pid}），但端口 {port} 未及时释放"
            ));
        }
        thread::sleep(Duration::from_millis(200));
    }
    remove_pid_file(data_dir);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pid_file_accepts_pid_and_java_path() {
        let parsed = parse_pid_file("4242\nC:\\app\\runtime\\bin\\java.exe\n");
        assert_eq!(
            parsed,
            Some((4242, PathBuf::from("C:\\app\\runtime\\bin\\java.exe")))
        );
    }

    #[test]
    fn parse_pid_file_rejects_garbage() {
        assert_eq!(parse_pid_file(""), None);
        assert_eq!(parse_pid_file("not-a-pid\n/usr/bin/java\n"), None);
        assert_eq!(parse_pid_file("1234\n\n"), None);
        assert_eq!(parse_pid_file("1234"), None);
    }

    #[test]
    fn parse_pid_file_tolerates_surrounding_whitespace() {
        let parsed = parse_pid_file(" 99 \n  /opt/app/java  \n");
        assert_eq!(parsed, Some((99, PathBuf::from("/opt/app/java"))));
    }

    #[test]
    fn same_executable_is_case_insensitive_on_windows() {
        // 不存在的路径走退化比较分支，正好覆盖大小写归一逻辑
        let matches = same_executable(
            Path::new("C:\\App\\Runtime\\Bin\\JAVA.EXE"),
            Path::new("c:\\app\\runtime\\bin\\java.exe"),
        );
        assert_eq!(matches, cfg!(windows));
    }

    #[test]
    fn same_executable_rejects_different_paths() {
        assert!(!same_executable(
            Path::new("C:\\a\\java.exe"),
            Path::new("C:\\b\\java.exe"),
        ));
    }

    #[test]
    fn netstat_parser_finds_listening_pid() {
        let sample = "\n  协议  本地地址          外部地址        状态           PID\n\
                      TCP    0.0.0.0:8091           0.0.0.0:0              LISTENING       31337\n\
                      TCP    127.0.0.1:8091         127.0.0.1:5000         ESTABLISHED     999\n";
        assert_eq!(parse_netstat_listener_pid(sample, 8091), Some(31337));
    }

    #[test]
    fn netstat_parser_ignores_other_ports_and_states() {
        let sample = "TCP    0.0.0.0:80911          0.0.0.0:0              LISTENING       1\n\
                      TCP    0.0.0.0:8091           0.0.0.0:0              ESTABLISHED     2\n";
        assert_eq!(parse_netstat_listener_pid(sample, 8091), None);
    }

    #[test]
    fn lsof_parser_takes_first_pid_record() {
        assert_eq!(parse_lsof_listener_pid("p4321\nf12\np8888\n"), Some(4321));
        assert_eq!(parse_lsof_listener_pid(""), None);
    }
}
