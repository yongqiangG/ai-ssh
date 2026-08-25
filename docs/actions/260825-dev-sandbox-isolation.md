# 260825 · dev 沙盒隔离

> 背景：docs/situations/260825-dev-sandbox-isolation.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 阶段 1：Rust 沙盒根 + web 端口默认 + tauri.cmd 注入

**目标**：dev 进程的 coding 域数据根切到 `AI_SSH_HOME`（tauri.cmd 注入 `.ai-ssh-dev`），web-companion debug 默认 18081。

**设计**：
- `storage.rs` 新增 `ai_ssh_root()`：`AI_SSH_HOME` env 非空则用之，否则 `~/.ai-ssh`；`coding_dir()` 改基于它
- `app_settings.rs` / `hooks.rs` 的三处重复 `home.join(".ai-ssh").join("coding")` 收敛到 `storage::coding_dir()`
- `web/mod.rs::default_port()`：`cfg!(debug_assertions)` → 18081，release 18080；`config_defaults_and_partial_parse` 测试适配
- `scripts/tauri.cmd` 注入 `AI_SSH_HOME=%USERPROFILE%\.ai-ssh-dev`

**验收标准**：`cargo test --lib` 全绿；env 生效/回退两分支有单测。

**测试用例**：`ai_ssh_root` 无 env → 默认路径；有 env → 覆盖（env 参数化为纯函数，免进程级 env 操控）；web 默认端口随构建形态。

**验证**：`cargo test --lib` 140/140（新增 `ai_ssh_root_env_override_and_fallback`：env 有效值覆盖/空串视为未设置/home 缺失报错三分支；`web/mod.rs` 默认端口断言适配 debug 18081）。收敛实证：`app_settings.rs`/`hooks.rs` 三处重复 `home.join(".ai-ssh")` 全部改走 `storage::coding_dir()`，`hooks.rs` 的 `~/.codex` 用户全局配置保留独立 `home_dir()`（不参与沙盒分流）。

**状态**：已完成

## 阶段 2：Java 占位符 + dev-backend 脚本 + vite 8092

**目标**：dev 后端落沙盒（H2/secret）+ 8092；一条命令起 dev 后端。

**设计**：
- `application-single.yml`：H2 URL 与 `local-key-file` 改 `${AI_SSH_HOME:${user.home}/.ai-ssh}` 前缀
- 新增 `ssh-server/scripts/dev-backend.cmd`：set AI_SSH_HOME/SERVER_PORT=8092 → `mvn spring-boot:run`
- `vite.config.ts` proxy 目标 `http://localhost:8092`

**验收标准**：脚本起后端，`~/.ai-ssh-dev/ai-ssh.mv.db` 出现且端口 8092；不注入 env 时路径/端口与旧版完全一致（安装版零变化）。

**测试用例**：无 env 起 single（旧路径不变）；dev-backend.cmd 起（沙盒路径 + 8092）；vite 代理连通。

**验证**：`dev-backend.cmd` 实跑（26-08-25 10:10）——Tomcat 起在 **8092**、`~/.ai-ssh-dev/` 生成 `ai-ssh.mv.db` + `secret.key`、`curl 127.0.0.1:8092/api/ping` 返回 `"0000" pong`；测后按端口精确补杀 8092 JVM（安装版 8091 未动）。不注入 env 时 yml 占位符回落 `${user.home}/.ai-ssh`，与旧路径逐字节一致（安装版零变化）。vite proxy 已改 8092（`vite.config.ts` 注释说明分流语义）。

**状态**：已完成

## 阶段 3：双开验收 + 文档 + 封档

**目标**：安装版与 dev 桌面双开互不干扰实证；CLAUDE.md 常用命令更新；归档。

**设计**：用户真机双开（安装版常驻 + `npm run tauri dev` + `dev-backend`）；核对端口/数据根/手机伴侣 18081。CLAUDE.md 已随代码 commit 更新（tauri.cmd 注入说明 + dev-backend 命令 + Codex hook 边界）。

**验收标准**：双开无端口冲突；dev 沙盒空库冷启动自愈；手机连 dev（tailnet-ip:18081 + 新 token）；安装版（手机 18080 / 数据 / 任务）零变化。

**测试用例**：见上。

**验证**：
**状态**：未开始（待用户真机双开验收）
