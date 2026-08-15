# 260815 · AI Coding 面板迁移（nezha → ssh-client）

> 背景：docs/situations/260815-ai-coding-panel.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 阶段 1：Rust coding/ 模块迁移

**目标**：nezha Rust 侧（拆 git/skills/usage/notification/analytics 后）整体迁入 `ssh-client/src-tauri/src/coding/`，命令加 `coding_` 前缀、事件加 `coding:` 前缀，数据根改为 `~/.ai-ssh/coding/`，`cargo check` 通过。
**设计**：
- 迁入文件：`pty.rs`（PTY + agent 启动 + ConPTY 屏障）、`session.rs`（claude/codex 会话 NDJSON 解析）、`hooks.rs` + `ai-coding-hook.mjs`（hook 注入/回传）、`event_watcher.rs`、`storage.rs`（原子写）、`app_settings.rs`（agent 路径探测 + Windows npm shim 解析）、`config.rs`（仅 `[agent]` 段，`[git]` 段拆除）、`fs.rs` + `fs_watcher.rs`、`agent_assist.rs`、`analytics.rs`（本地 session 指标解析，RunningView 依赖，无外部网络）、`codex_rpc.rs`（自 usage.rs 抽出的 codex app-server JSON-RPC 客户端，模型目录自动发现所需）、`platform/`（unix/windows）；`mod.rs` 定义 TaskManager（含 kill_all_children，关窗防孤儿）
- 排除：`git.rs`、`skills.rs`、`usage.rs`（用量快照）、`notification.rs`；hook 的 Claude 旧版注入清理段一并删除（本应用从未写过用户 settings.json）
- Task 结构：拆 6 个 worktree 字段与 additions/deletions（session.rs 的 ExportTaskMeta 同步拆）；前端 types.ts 与 storage.rs 同步删
- 品牌/隔离换名：数据根 `~/.ai-ssh/coding/`；项目内目录 `.nezha` → `.ai-coding`；hook 脚本 `ai-coding-hook.mjs`；守卫环境变量 `NEZHA_*` → `AISH_TASK_ID/AISH_EVENT_DIR/AISH_AGENT`；Codex 注入标记块 `ai-ssh-managed-begin/end`（与 nezha 本体的标记块不同名，两应用可共存）
- Cargo.toml 新增：portable-pty 0.8、tokio、once_cell、chrono、base64、notify 6、ignore、toml、libc、parking_lot、uuid、trash =5.2.6、font-kit =0.14.3；reqwest 不引入
- ConPTY 侧载资源（conpty/ x64/arm64 dll + OpenConsole.exe）进 src-tauri/resources/，tauri.conf.json resources 追加；windows.rs 预加载改双路径探测（dev 与 NSIS 布局兼容）
- lib.rs：`mod coding;` + setup 五项初始化（ConPTY 预热/login shell 预热/hook 安装/event_watcher/fs_watcher）+ manage(TaskManager) + 59 个 coding_ 命令注册 + 关窗先 kill_all_children 再停后端
**验收标准**：`cargo check` 零错误；所有 coding_ 命令可被 invoke_handler 解析；无对已删模块的悬空引用。
**测试用例**：storage 原子写单测（tmp+rename 路径）；config.toml `[agent]` 段解析；命令前缀无遗漏（grep 全量 invoke 名单）。
**验证**：`cargo check` 一次通过；`cargo test` 67/67 绿（含 nezha 迁来的 hooks/session/pty/fs/agent_assist/app_settings 单测；修复 1 个 nezha 原有测试在 Windows 上的平台性 bug——无盘符路径 `is_absolute()` 为 false 导致断言空转，改为 temp_dir 构造跨平台绝对路径）。grep 确认无 `~/.nezha`、`NEZHA_` 环境变量残留（注释与测试夹具中的无害字样除外）。遗留：unencrypted `Path` 未用警告如有在下次编译时清；ConPTY 资源在 dev（tauri dev）下是否随包待阶段 3 真机验证。
**状态**：已完成

## 阶段 2：前端骨架 + 整窗接管接入

**目标**：ActivityBar 新增「AI Coding」按钮，`centerView === "aiCoding"` 时整窗接管（隐藏左侧栏 + ChatPanel + Header 面板开关区），AiCodingPanel 挂载空壳可编译运行。
**设计**：
- `layoutStore`：CenterView 加 `"aiCoding"`；App.tsx 布局分支——aiCoding 时渲染 `<AiCodingPanel />` 全幅（不含 LeftSidebar/Splitter/ChatPanel）
- `ActivityBar.tsx`：NAV_ITEMS 加条目 + onItemClick + isActive 分支
- `Icon.tsx`：新增 aiCoding 图标（lucide 风格 stroke 内联 SVG）
- `src/features/aiCoding/` 目录：AiCodingPanel.tsx（由 nezha App.tsx 改造）+ 组件/hook/样式/i18n 原样落位
- vite/tsconfig alias 无需改（相对导入）
**验收标准**：`npm run build` 通过；点击按钮整窗切换、切回 SSH 布局状态不丢（layoutStore persist 兼容）。
**测试用例**：ActivityBar 点击切换 centerView；layoutStore 旧持久化值（"terminal"|"sftp"）回退正常。
**验证**：
**状态**：未开始

## 阶段 3：任务管理 + PTY 核心链路

**目标**：项目/任务 CRUD、本地持久化（~/.ai-ssh/coding/）、创建任务 → spawn claude/codex PTY → 终端渲染 → 状态跟踪（hook+轮询双路径）→ 恢复/中断/fork，端到端可用。
**设计**：
- 前端核心链路照搬：WelcomePage/ProjectPage/TaskPanel/NewTaskView/RunningView/TerminalView/SessionView + useTerminalManager（RAF 批量 + 10MB buffer + serialize snapshot）
- props 钻透保持，AiCodingPanel 持状态（不引 zustand）
- 持久化 key 与事件名对齐 Rust 侧（coding: 前缀）
- Windows 实机验证 ConPTY：全屏 TUI（claude）可滚回 scrollback
**验收标准**：真机 `npm run tauri dev` 下创建项目→创建任务（ask 模式）→claude 启动→任务状态流转 running→awaiting_review→done 正确；任务切换终端恢复；重启应用任务列表不丢。
**测试用例**：useTerminalManager 的 RAF drain 与 snapshot 恢复单测；任务状态事件映射（task-status/task-session）单测。
**验证**：
**状态**：未开始

## 阶段 4：周边功能迁移 + 排除项拆除

**目标**：文件浏览器/查看器、本地 Shell 终端、看板浮层、智能命名、会话导出、项目级/应用级设置（裁剪后）全部可用；git/timeline/skills/用量残留引用清零。
**设计**：
- 新增前端依赖：@uiw/react-codemirror + lang 包、shiki、marked、dompurify、lucide-react、@radix-ui 三原语（仅 aiCoding 目录使用）
- 拆除：BranchBar/RepoSelector/LaunchMode/worktree 按钮与字段、TimelineView、skill-hub 全家、hub-as-project 过滤逻辑、UsagePopover
- 主题：删 4 主题选择器，固定深色；终端主题映射电路霓虹 token
- 样式色板映射文件一份（nezha CSS 变量 → 电路霓虹 token）
**验收标准**：`npm run build` 通过；grep 无 worktree/timeline/skill-hub/usage 残留引用；各周边功能真机可用。
**测试用例**：样式映射完整性（token 全覆盖）；组件冒烟（FileExplorer 渲染、KanbanView 三列聚合）。
**验证**：
**状态**：未开始

## 阶段 5：测试补齐 + 文档收尾

**目标**：vitest 测试补齐，CLAUDE.md 红线重定义 + 简史追加，DESIGN.md 若有新 token 补记。
**设计**：
- CLAUDE.md：红线章节标注适用范围限 SSH 运维链路；新增「AI Coding 面板」段（独立功能域、不经 server、GPL-3.0 来源、权限模式沿用 agent CLI 原生交互）；简史加一行
- 测试基线：全量 `npm run test:run` + `cargo test`（如适用）绿
**验收标准**：全部测试绿；CLAUDE.md 更新完成；action 归档进 done/。
**测试用例**：既有测试回归；新增模块的核心单测（见各阶段）。
**验证**：
**状态**：未开始
