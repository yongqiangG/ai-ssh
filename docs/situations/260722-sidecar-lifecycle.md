# 260722 · sidecar 后端生命周期同步与自愈

## 原始需求（用户原话）

> 当前项目的单体构建，依赖于将后端java应用作为sidecar一起打包。具体可以看github文件夹下的workflow，这样是不是容易发生应用关闭了，但是作为sidecar的后端服务时间没有关闭。然后下一次重启的时候，会发生端口占用，或者内嵌数据库h2 db文件被锁的问题。核实下会不会这样，然后看下是否有成熟的方案可以管理这个后端服务和应用的生命周期同步，或者可以自愈。

## 背景（决策时事实）

- 后端不是 Tauri shell 插件 sidecar，是 `lib.rs` 裸 `std::process::Command` spawn 的 JVM（`start_backend`），唯一清理钩子是 `WindowEvent::CloseRequested` → `child.kill()`（Windows 上即 `TerminateProcess` 硬杀）。
- 孤儿核实结论：**会发生**。应用崩溃 / WebView 崩掉 / taskkill 等任何非正常关窗路径都不触发 `CloseRequested`，Windows 不级联杀子进程 → JVM 孤儿，持续占 8091 端口和 `~/.ai-ssh/ai-ssh.mv.db` 文件锁。
- 症状比报错更隐蔽：下次启动新 JVM 绑端口/拿 H2 锁失败自灭，但 BootSplash 靠 ping 8091 判就绪，**孤儿会替答 pong**——应用「看似正常」实连上一代后端；升级后即新客户端 + 旧后端的静默版本错配。
- 正常关窗路径也有暗伤：硬杀使 H2 每次非干净关闭，赌 MVStore 恢复机制，下启可能走 recovery 拖慢启动。
- 无 single-instance 保护：Windows 双击双开 = 第二实例 JVM 静默挂到第一实例后端，谁先关窗杀谁的后端。
- CDS 训练进程短命自灭（`spawn_cds_training` 注释已论证），不构成风险。
- 平台矩阵即 `.github/workflows/` 两条 validation 流水线：Windows + macOS arm。macOS 无 Job Object 等价物（kqueue `EVFILT_PROC` 需第三方监视进程，本身又可能孤儿）。
- dev（debug 构建）下 resources 无 jar，spawn 必失败，后端由开发者手动起——已有 `cfg!(debug_assertions)` 分界线（spawn 失败不快报）。

## 决议（问题 + 结论）

1. **保证级别**：预防 + 自愈两层都要。单靠预防漏一次就是用户报不出来的静默版本错配，必须有启动期兜底；单靠自愈则孤儿在应用不运行期间一直活着占资源。
2. **平台覆盖**：Windows + macOS 双平台同等对待。
3. **预防机制**：组合方案——Windows 上 Job Object（`KILL_ON_JOB_CLOSE`，内核级、连僵死 JVM 都杀得掉）+ 双平台 stdin 哨兵（后端守护线程读 stdin，EOF 即 `System.exit()`）。哨兵是 macOS 上唯一不引入额外进程的可靠手段，Windows 顺带启用作双保险；Job Object 补哨兵「JVM 僵死杀不动」的盲区。哨兵做成 opt-in 启动参数（如 `-Dlifecycle.stdin-watch=true`），仅 Tauri spawn 时传，避免脚本 `< /dev/null` 起后端秒退。Rust 侧 stdin 改管道后必须持有写端与 Child 同生命周期。
4. **自愈识别**：PID 文件为主证据（spawn 后写 `app_data_dir/backend.pid`；下启若 8091 被占：校验 PID 存活 + 可执行路径指向我们打包的 java → 确认孤儿才杀）；查无实据但端口被占 → **绝不自动杀**，进失败分支，把占用者 PID/进程名写进 BootSplash 失败页交用户处置。杀进程必须进程级证据，与「高危操作强制防呆」同一价值观；顺带天然覆盖升级清旧版场景。
5. **优雅关闭**：复用哨兵管道——关窗时 `window.hide()` → drop 管道写端 → 后端 EOF → shutdown hook → Spring/H2 干净落盘，Rust 轮询等最多 3s，超时硬杀兜底。零新增攻击面（否掉 HTTP shutdown 端点：后端无鉴权，等于裸自杀接口）；「父死 EOF」与「主动关闭写端 EOF」在后端是同一条代码路径。
6. **双开**：上 `tauri-plugin-single-instance`（注册在 Builder 插件链最前）。不是为双开体验，是保住决议 4 的公理——「探测到 8091 被占时本应用必无其他活实例，PID 校验通过的占用者必是孤儿」；否则双开即触发误杀另一实例后端。
7. **dev/release 边界**：自愈仅 release 启用（`!cfg!(debug_assertions)`，与现有快报同一道门）。dev 契约是后端生命周期归开发者，壳不插手；哨兵与 Job Object 在 dev 下因 spawn 不出后端天然不生效。不影响既有 dev 工作流的 8091 补杀习惯。
8. **验收**：双平台真机杀伤矩阵（六场景，见 action）+ 两处纯逻辑单测（Java 哨兵线程喂 EOF、Rust PID 文件解析/校验函数），锁未来重构的回归风险。

## 影响范围

- `ssh-client/src-tauri/`：lib.rs（spawn/关窗/自愈）、Cargo.toml（`win32job`、`tauri-plugin-single-instance`）。
- `ssh-server/`：ssh-server-app 侧 opt-in 哨兵守护线程 + JUnit 单测。
- 前端 BootSplash 失败页：新增「端口被占」占用者信息展示。
- 执行计划：`docs/actions/260722-sidecar-lifecycle.md`。
