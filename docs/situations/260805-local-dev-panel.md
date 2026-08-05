# 本地开发面板：PTY 集成 Claude Code / Codex

## 原始需求

> 当前想要新开一个导航按钮和对应的面板，实现 pty 连接本地的 claude 和 codex，实现在 client 端直接操作终端结合 claude/codex 进行代码开发，并且可以管理项目和会话。
> 现在有一个项目可以参考，可以考虑引入这个项目的核心功能。参考项目：D:\project\nezha
> 补充说明：这个功能的代码尽量独立，不与原来的 ssh 相关功能耦合；机制照搬，代码重写适配。

## 背景

- 参考项目 Nezha（hanshuaikang/nezha v0.4.7）是 Tauri v2 + React 19 + xterm 6 + portable-pty 0.8 的「Agent-First 编程 IDE」，核心价值 = 多项目 × 多会话并发 × 本地 claude/codex PTY。技术栈与 ai-ssh client 几乎同构。
- 已核实 Nezha 核心机制：`pty.rs`（run/resume/fork/cancel/send_input/resize + Channel 直投 + 有界反压 + UTF-8 leftover 处理）、`session.rs`（jsonl 增量发现 + input_required 状态）、`platform/windows.rs`（ConPTY 侧载预加载）、`app_settings.rs` 的 Windows agent 解析（claude→npm 包内 claude.exe、codex→vendor artifact + PATH 前置，避免 batch shim 进 ConPTY 的坑）。
- ai-ssh 是双进程：Tauri 壳（纯壳，无业务 invoke）+ Java sidecar:8091。现有 SSH 终端走「前端 HTTP 轮询 ↔ Java JSch ↔ 远程」。本地 claude/codex 是本地进程，与远程 SSH 是两套世界。
- 本机 claude/codex 为原生 Windows（PATH 可调），Rust 直接 spawn 可行。

## 决议

1. **问题：本地 agent PTY 放哪一层？** 结论：Rust 侧移植（前端 `Channel` ↔ Rust `portable-pty` ↔ 本地进程）。理由：移植成本最低（Nezha 核心近乎现成）、与 Rust 壳已有进程生命周期（win32job）语义一致、Java 无成熟跨平台 PTY 方案、本地面板可完全脱离 Java 后端运行。
2. **问题：布局形态？** 结论：复用三栏骨架——ActivityBar 新加「本地开发」按钮，`centerView` 增加 `"local"` 值，左栏切项目/会话列表面板，右栏 ChatPanel 在本地视图下隐藏。理由：与现有 terminal⇄sftp 切换模式一致，layout 系统零新增。
3. **问题：会话管理深度？** 结论：纯 jsonl 发现，不含 hook，不做会话内容时间线回放。理由：hook 链路（hooks.rs + settings 注入 + 版本探测 + 可信链）体量爆炸且依赖用户 node 环境；jsonl 已覆盖 v1 全部诉求。
4. **问题：项目列表数据源？** 结论：手动添加 + 最近使用（zustand persist）。理由：与「手动添加 SSH 连接」心智一致、任意本地路径、零扫描成本。
5. **问题：本地环境？** 结论：原生 Windows，Rust 直接 spawn。理由：本机 claude/codex 是 npm 全局装、PATH 可调；spawn 需解析 npm 包内真实 exe（见下）。
6. **问题：会话启动交互？** 结论：对齐 Nezha——项目 rail → 选项目 → 新建任务页 → 配置 → 启动。理由：用户明确要求对齐 Nezha 工作区项目功能。
7. **问题：NewTaskView 字段面？** 结论：核心三件（prompt 编辑器 + agent 类型 + 权限模式）+ @文件引用 + 附件粘贴；模型/思考深度 v1 不做（终端内 /model 可切）。理由：@引用与附件是贴 Nezha 的常用能力，模型选择非必需。
8. **问题：会话管理操作？** 结论：resume（`claude --resume` / `codex resume`）+ fork（`--fork-session` / `codex fork <sid>`），不做置顶。理由：续聊与分叉是核心诉求，成本低。
9. **问题：并发模型？** 结论：多会话并发（对齐 Nezha）。理由：这是 Nezha 区别于单终端的核心价值。
10. **问题：代码独立性？** 结论：前端新增 `src/local-dev/` 独立目录（store/useTerminalManager 本地版/面板组件自洽一整套），Rust 新增独立模块，不碰 SSH/Java 业务代码；唯一触碰共享边界是 `layoutStore`（加 `"local"` 枚举值）。理由：避免与 SSH 功能耦合，本地面板不依赖 Java 后端启动。
11. **问题：移植方式？** 结论：机制照搬、代码重写适配；Nezha 只作设计参考，核心 PTY 代码（含 Windows agent 解析踩坑）小心复刻，与当前项目风格不冲突的地方直接复刻。理由：规避许可证混入、与现有代码库风格一致。
12. **问题：Windows agent spawn 目标？** 结论：不直接 spawn `claude.cmd`/`codex` 进 PTY，而是解析 npm 包 vendor artifact 找真实 `.exe`（claude→`@anthropic-ai/claude-code/bin/claude.exe`、codex→vendor 内 `codex.exe` + PATH 前置 + `CODEX_MANAGED_BY_NPM=1`）。理由：这是 Nezha 实测踩过的坑——batch shim 进 ConPTY 会出问题。
13. **问题：ConPTY 侧载预加载是否移植？** 结论：v1 回退系统内置 ConPTY，侧载（随包分发 conpty.dll + OpenConsole.exe + crash-loop 防护）列为后续增强。理由：侧载涉及打包 resources，体量大；系统 ConPTY 能工作，仅全屏 TUI 滚轮回滚受限。

## 影响范围

- **Rust（ssh-client/src-tauri）**：新增独立模块（如 `local_agent/`）——`portable-pty` 依赖、run/resume/fork/cancel/send_input/resize 命令、jsonl 会话发现（codex 扫 `~/.codex/sessions` + 项目 `.codex/sessions` 的 rollout-*.jsonl；claude 扫 `~/.claude/projects/<encoded-path>/`）、附件存 `.nezha/attachments/<task_id>/`、Windows agent bin 解析。不动 `lib.rs` sidecar 生命周期。
- **前端（ssh-client/src）**：`layoutStore` 加 `"local"`；ActivityBar 加按钮 + 新图标；新增 `src/local-dev/`（项目 store、会话 store、useTerminalManager 本地版、项目 rail、NewTaskView、会话列表、xterm 面板）。右栏 ChatPanel 在 local 视图下隐藏。
- **Java 后端**：零改动。本地面板启动不依赖后端就绪。
- **安全**：权限模式默认 ask（对齐三信任红线）；auto_edit/full_access 需用户主动选。
- **范围外**：git 集成（worktree/branch）、hook 链路、会话内容时间线回放、置顶、模型/思考深度选择、ConPTY 侧载、WSL 支持。
