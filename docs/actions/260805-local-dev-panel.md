# 260805 · 本地开发面板（claude/codex PTY）

> 背景：docs/situations/260805-local-dev-panel.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 阶段 1：Rust PTY 内核 + 命令面

**目标**：Rust 侧可 spawn 本地 claude/codex 进 ConPTY，双向流 + resize + 生命周期控制，前端可 invoke 全套命令。

**设计**：
- `Cargo.toml` 加 `portable-pty = "0.8"`（ConPTY 走系统内置，v1 不侧载）
- 新模块 `src/local_agent/`（`mod.rs` + `pty.rs` + `agent_bin.rs` + `session_discovery.rs`），机制照搬 Nezha、代码重写适配：
  - `agent_bin.rs`：Windows 解析 npm vendor artifact——claude 找 `@anthropic-ai/claude-code/bin/claude.exe`、codex 找 vendor 内 `codex.exe` + PATH 前置 + `CODEX_MANAGED_BY_NPM=1`；找不到回退 PATH 原样。这是核心踩坑，小心复刻。
  - `pty.rs`：`run_task`/`resume_task`/`fork_task`/`cancel_task`/`complete_task`/`send_input`/`resize_pty` 命令；`Channel<String>` 直投 + batched emit（16ms/64KB）+ 有界 channel 反压；UTF-8 leftover 处理；exit monitor → `task-status` 事件；空 prompt 进 REPL、非空带 positional prompt。
  - 命令构建：claude 用 `--permission-mode default/acceptEdits` / `--dangerously-skip-permissions`、`--resume`/`--fork-session`；codex 用 `--sandbox workspace-write -a on-request` / `--dangerously-bypass-approvals-and-sandbox`、`resume`/`fork <sid>`。
  - `session_discovery.rs`：jsonl 增量发现——codex 扫 `~/.codex/sessions` + 项目 `.codex/sessions` 的 `rollout-*.jsonl`、claude 扫 `~/.claude/projects/<encoded-path>/`；活跃任务 id → session id 映射；resume/fork 直接以已知 session id 启动。
- 附件：`save_task_images/texts` 存 `.nezha/attachments/<task_id>/`（对齐 Nezha）
- 生命周期挂接：child/pty/writer 句柄用 `State<TaskManager>`（并发多会话）；**不碰** `BackendProcess`/`win32job`
- `TaskManager` State 在 `setup` 注册

**验收标准**：`cargo check`/`cargo test` 过；`run_task` 起 claude REPL 输出能经 Channel 送达；`send_input`/`resize_pty` 生效；`cancel_task` 杀进程；两个会话并发互不干扰。

**测试用例**：Rust 单测——agent_bin 解析（claude shim→exe、codex vendor→exe+PATH）、命令参数构建（claude/codex × permission_mode × resume/fork）、UTF-8 leftover、resize 畸形尺寸拒绝、normalize CLI option 防控制字符。

**验证**：（完成时填：怎么验的 + 关键实证 + 遗留处置）
**状态**：未开始

## 阶段 2：前端布局挂载 + 项目/会话 store

**目标**：ActivityBar 加按钮、`centerView:"local"` 切换、右栏隐藏，左栏项目 rail + 会话列表有数据。

**设计**：
- `layoutStore`：`CenterView` 加 `"local"`；`SidebarView` 加 `"local"`；local 视图下 `showAiPanel` 强制 off（切回 terminal/sftp 恢复）——用 local 视图派生而非持久化 showAiPanel
- `ActivityBar`：NAV_ITEMS 加 `{ id:"local", icon, label:"本地开发" }`；onItemClick 切 centerView local + activeSidebarView local；`Icon.tsx` 加新图标（如 robot/bot 变体或 code）
- `App.tsx`：`centerView === "local" ? <LocalDevPanel/>`（先于 sftp/terminal 判断）；`showAiPanel` 在 local 下不渲染右栏
- 新增 `src/local-dev/`：
  - `projectStore.ts`：手动添加项目（目录选择 via tauri dialog）+ 最近使用排序，persist
  - `localSessionStore.ts`：活跃会话（task_id/session_id/agent/status）+ 历史会话列表（jsonl 发现结果），非 persist 或轻 persist
- 目录选择用 `@tauri-apps/plugin-dialog`（前端依赖，Rust 侧已有 dialog 插件）

**验收标准**：点按钮切到本地视图、右栏消失；添加项目、项目列表显示；切回 sftp/terminal 布局复原。

**测试用例**：layoutStore 加 local 枚举的 zustand 测试；projectStore persist 测试；ActivityBar 渲染测试。
**验证**：（完成时填）
**状态**：未开始

## 阶段 3：NewTaskView + 终端会话面板

**目标**：选项目 → 新建任务页（prompt + agent + 权限 + @引用 + 附件）→ 启动后 xterm 渲染 agent 会话，多会话并发切换。

**设计**：
- `NewTaskView.tsx`（local-dev 内）：核心三件 + @文件引用（项目内文件索引，读目录树）+ 附件粘贴（图片/文本 → dataURL → 启动时传 Rust 存盘）。对齐 Nezha 交互但按 ai-ssh 风格重写。
- `useTerminalManager.ts`（local-dev 本地版）：移植 Nezha 前端机制——每任务独立 buffer（10MB 上限/256 chunks）+ RAF 每帧 128KB 预算 + Channel 单订阅者 + xterm serialize 快照恢复 + register/ready 写态。
- `LocalDevPanel.tsx` 编排：左栏（项目 rail + 会话列表，resume/fork 入口）+ 中部（NewTaskView ⇄ xterm 会话）。
- xterm 配置读 CSS 变量主题（复用现有 `readXtermTheme` 思路，但放 local-dev 自洽副本）。
- 会话列表 jsonl 发现结果：标题取首条 user 消息文本（截断）、时间排序、resume/fork 按钮。

**验收标准**：新建任务→启动 claude/codex→终端交互可用；多会话并发切换各自独立；resume/fork 续聊成功；附件/@引用进 prompt。

**测试用例**：NewTaskView 表单 state 测试；useTerminalManager buffer 压缩/恢复纯逻辑测试；session 发现解析单测（可回 Rust 侧）。
**验证**：（完成时填）
**状态**：未开始

## 阶段 4：联调 + 收尾

**目标**：真实 claude/codex 会话端到端可用，补测试，归档。

**设计**：真机联调矩阵——claude REPL 裸启动、codex REPL 裸启动、带 prompt 启动、resume、fork、cancel、多会话并发、@引用、附件、切走切回布局复原、后端未启动时本地面板照常。

**验收标准**：矩阵全通过；`cargo test` + `npm run test:run` 全绿；无回归（SSH/终端/SFTP/chat 功能不受影响）。

**测试用例**：即上述矩阵本身。
**验证**：（完成时填）
**状态**：未开始
