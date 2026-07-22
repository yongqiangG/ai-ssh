# 260722 · sidecar 后端生命周期同步与自愈

> 背景：docs/situations/260722-sidecar-lifecycle.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 阶段 1：stdin 哨兵 + 优雅关闭

**目标**：后端具备「父进程死亡即自灭」能力（macOS 预防层主力），正常关窗从硬杀改为 EOF 优雅关闭 + 3s 硬杀兜底。

**设计**：
- Java 侧：ssh-server-app 增加 opt-in 守护线程（启动参数 `-Dlifecycle.stdin-watch=true` 才启用），阻塞读 `System.in`，读到 EOF 调 `System.exit(0)`，走 JVM shutdown hook → Spring context close → H2 干净落盘
- Rust 侧：`start_backend` 的 stdin 由 `Stdio::null()` 改为管道，写端存入 `BackendProcess` 与 Child 同生命周期；spawn 参数追加 `-Dlifecycle.stdin-watch=true`
- 关窗流程改造：`CloseRequested` → `window.hide()`（观感秒关）→ drop 写端 → 轮询 `try_wait` 最多 3s → 未退则 `kill()` 兜底
- 「父死 EOF」与「主动 drop 写端 EOF」是后端同一条代码路径，一套实现两个语义

**验收标准**：正常关窗后端 3s 内退出且 H2 日志无 recovery；kill -9 杀壳（mac）后端跟随退出；不带 opt-in 参数手动起后端 `< /dev/null` 不受影响。

**测试用例**：JUnit——哨兵线程喂 EOF 断言退出回调被调、不开 opt-in 时线程不启动；真机场景归阶段 4 矩阵。

**验证**：JUnit `StdinWatchdogTest` 5/5 绿（EOF/数据后EOF/流异常/守护线程/开关门禁）；`mvn clean install` 全模块编译过；`cargo check` 过；domain+infrastructure 既有测试无回归。真机杀伤场景（关窗 3s 内退、kill 壳跟随退）归阶段 4 矩阵实证。
**状态**：已完成

## 阶段 2：Windows Job Object

**目标**：Windows 上内核级保证父死子亡，覆盖壳崩溃/taskkill/JVM 僵死全场景。

**设计**：
- `win32job` crate，`cfg(windows)` 隔离，不污染 mac 构建
- spawn 成功后创建 job（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）并 assign 子进程，job 句柄挂入 `BackendProcess` 保活
- 不依赖阶段 1，可并行

**验收标准**：release 包 taskkill /F 杀壳进程，JVM 立即消失（任务管理器 + 8091 探测双确认）。

**测试用例**：真机场景归阶段 4 矩阵（Windows ②）。

**验证**：`cargo check` 过（win32job v2，cfg(windows) 隔离不污染 mac 构建）；job 句柄 mem::forget 保活到进程终结，assign 失败仅记 backend-job.log 不阻断启动（哨兵/自愈兜底）。内核级杀伤实证归阶段 4 矩阵。
**状态**：已完成

## 阶段 3：启动自愈 + single-instance

**目标**：启动期兜底——漏网孤儿被识别清理；查无实据的端口占用快报不误杀；双开归一。

**设计**：
- 先挂 `tauri-plugin-single-instance`（Builder 插件链最前，第二实例拉起已有窗口），立公理：8091 占用者若 PID 校验通过必是孤儿
- PID 文件 `app_data_dir/backend.pid`：spawn 返回即写（PID + 我们 java 的可执行路径）；优雅退出 `stop()` 与自愈 kill 成功后删除
- 自愈流程（release-only，`!cfg!(debug_assertions)` 与快报同门）：spawn 前探测 8091 → 被占则读 PID 文件校验「存活 + 可执行路径匹配打包 runtime java」→ 通过即杀并等端口释放再 spawn；PID 文件缺失/校验不过 → 不杀，查占用者 PID/进程名（netstat/lsof）注入 BootSplash 失败页
- 前端失败页新增占用者信息展示分支

**验收标准**：人为孤儿下次启动被自动清理且新后端就绪；用无关进程占 8091 时失败页展示占用者且该进程未被杀；双开只拉前台不起第二 JVM。

**测试用例**：Rust 单测——PID 文件解析/存活校验/路径匹配纯逻辑函数；真机场景归阶段 4 矩阵（③④⑤⑥）。

**验证**：
**状态**：未开始

## 阶段 4：双平台真机杀伤矩阵

**目标**：Windows + macOS 各跑一遍全场景实证，验证栏留证据。

**设计**：走 `.github/workflows/` 两条 validation 流水线产物装真机；矩阵六场景：
1. 正常关窗 → 后端 3s 内退、H2 无 recovery 日志
2. taskkill/kill -9 杀壳 → 后端跟随死（Windows 验 Job Object，mac 验哨兵）
3. 人为制造孤儿 → 下次启动自愈清理、PID 文件更新、新后端就绪
4. 8091 被无关程序占 → 失败页展示占用者信息、不误杀
5. 双开 → 第二次启动仅拉前台
6. 模拟升级（换新 jar）→ 旧孤儿被清、新后端起来

**验收标准**：6 场景 × 2 平台全通过，逐项打勾留实证。

**测试用例**：即上述矩阵本身。

**验证**：
**状态**：未开始
