# 260825 · dev 沙盒隔离——安装版与 dev 双开互不干扰

## 原始需求（用户原话）

> 现在有一个比较大的开发痛点，因为我本身安装了这个项目在做ai coding。但是我又要开发这个项目，因此开发调试的时候很容易有端口的冲突，我本地已经安装启动了这个项目，占用了端口。然后又想dev启动就容易冲突。是不是应该拆分成两套端口 还是有更好的方式

> （grill 中补充）我理解一下 你的方案是端口做两套 配置也是做两套 然后dev启动默认走另一套配置文件和端口 我桌面上相当于可以同时运行安装版和dev版
> （grill 中确认）现在默认应该都是跑的 single（H2） 当前不依赖MySQL
> （grill 中拍板）后端启动方式按推荐（固化脚本）。

## 背景（决策时事实，2026-08-25 核实）

- **冲突矩阵（dev 实例 vs 常驻安装版）**：
  - **18080 web-companion 必冲突**：两边都监听；`web.json` 虽可配端口（`web/mod.rs` default_port），但它本身落在共享的 `~/.ai-ssh/coding/` 里——改配置两边一起改，无法分流。当前开发焦点（手机伴侣）正压在这个端口上。
  - **8091 后端冲突 + 隐蔽数据混淆**：安装版 sidecar 常驻 8091；dev 构建不拉 sidecar（`lib.rs` `!cfg!(debug_assertions)`），后端手动 `mvn spring-boot:run`（single/dev profile 均 8091）起不来；若不起后端，vite 代理（写死 8091）直接打到安装版后端——**dev 前端悄悄读写安装版的 H2 真数据**。
  - **H2 文件锁**：single 的库 `${user.home}/.ai-ssh/ai-ssh.mv.db`，两个 JVM 锁同一文件（有 H2 锁死前科）。
  - **任务数据混合**：`storage.rs` / `app_settings.rs` / `hooks.rs` 四处硬编码 `~/.ai-ssh/coding`——dev 任务与日常任务同列表同目录。
  - 1420 vite 不冲突（安装版不用）；appdata（同 identifier `com.johnny.ai-ssh`）共享，暂无实痛。
- 用户 dev 后端习惯：默认 single（H2），不依赖 MySQL。
- **已知边界（本次不修）**：Codex 状态跟踪的 hook 注入改写全局 `~/.codex/config.toml`，dev 与安装版**同时各跑 Codex 任务**时上报路径互踩（后改写者生效）；Claude 走 `--settings` 任务级注入不受影响，用户主场景为 Claude。

## 决议

- **Q1 隔离策略 → dev 沙盒（`AI_SSH_HOME` 数据根覆盖），非纯端口拆分**：痛点表面是端口，根子是安装版与 dev 共享同一套 `~/.ai-ssh` 状态；数据根分开后端口/库/token/任务数据天然各一套（不是人工维护两套配置，是沙盒冷启动自动生成）。纯端口拆分被否——数据混淆与 H2 锁仍在，治标。
- **Q2 注入方式 → 启动脚本注入 env**：`scripts/tauri.cmd`（只有 dev 走它，安装版零感知）注入 `AI_SSH_HOME=%USERPROFILE%\.ai-ssh-dev`；Rust 侧 `storage.rs` 收敛单点 `ai_ssh_root()`（env 覆盖，默认 `~/.ai-ssh`），`app_settings.rs`/`hooks.rs` 的重复实现改走它；Java `application-single.yml` 的 H2 URL 与 secret key 占位符化 `${AI_SSH_HOME:${user.home}/.ai-ssh}`。web-companion **debug 构建默认 18081**（release 18080 不变；`web.json` 显式配置仍优先于默认值）。
- **Q3 后端启动 → 固化脚本**：新增 `ssh-server/scripts/dev-backend.cmd`（注入同款 `AI_SSH_HOME` + `SERVER_PORT=8092` 后 `mvn spring-boot:run`），与 tauri.cmd 对称、免记命令；vite proxy 目标改 8092（dev 前端永远连 dev 后端）。
- **不做**：appdata（identifier）不隔离（无实痛，动了要动打包身份）；dev profile（MySQL）不涉及；Codex hook 互踩边界留 pool 观察；1420 不动。

## 影响范围

- ssh-client Rust：`coding/storage.rs`（`ai_ssh_root` 单点）、`coding/app_settings.rs` + `coding/hooks.rs`（重复实现收敛）、`coding/web/mod.rs`（default_port debug 18081 + 测试适配）、`scripts/tauri.cmd`（注入 env）。
- ssh-server：`ssh-server-app/src/main/resources/application-single.yml`（两处占位符）、`scripts/dev-backend.cmd`（新增）。
- ssh-client 前端：`vite.config.ts`（proxy 8092）。
- 文档：根 `CLAUDE.md` 常用命令段。
- 验收：桌面双开并存（安装版 18080/8091/`~/.ai-ssh` + dev 18081/8092/`~/.ai-ssh-dev` 互不干扰）；dev 沙盒空库冷启动自愈（H2 自动建库、web token 自动生成）；手机连 dev 地址 18081 + 新 token；安装版行为零变化（release 默认值与数据根均不动）。
