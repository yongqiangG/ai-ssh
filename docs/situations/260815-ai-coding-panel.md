# 260815 · AI Coding 面板（复刻 nezha）

## 原始需求（用户原话）

> 当前希望在client端的左侧功能条新增一个按钮ai coding功能，然后独立一个功能面板。功能设计复刻nezha项目，对应文件夹：D:\project\nezha。复刻核心的项目任务管理和claude/codex的pty功能，其中git功能和时间线和技能库这三个功能可以先不复刻。其他大部分功能最好直接复刻，避免重复踩坑。nezha项目的技术栈应该和client的技术栈相似度很高，直接将新功能迁移到client端即可，server端不需要修改。尽可能保持ai coding的功能独立和代码独立。不需要考虑原来的ssh运维功能。原来的claude.md文档中有列了红线，这个功能独立在红线之外，同步更新下claude.md文档。整体核实后grill me 确定方案。

## 背景（决策时事实）

- nezha（github.com/hanshuaikang/nezha，v0.4.7，**GPL-3.0**）与本仓库 ssh-client 技术栈高度同源：Tauri 2 + React 19 + TS + xterm.js 6 + Vite + Vitest。
- nezha 是纯本地应用（无自有 server）：任务管理走 Tauri command + 本地文件（`~/.nezha/` 原子写）；PTY 用 portable-pty 0.8 + Windows ConPTY 侧载资源；状态跟踪双路径 = hook 注入（改用户 `~/.claude/settings.json`、`~/.codex/config.toml`）+ agent session NDJSON 轮询。
- nezha 前端无状态库（App.tsx 1642 行 props 钻透）、CSS-in-JS + 4 主题；client 用 zustand + CSS Modules + 电路霓虹单一深色主题。
- 排除项耦合点：worktree 耦合最深（Task 6 字段 + BranchBar/RepoSelector/LaunchMode + App.tsx 提交流程分支）；timeline 仅 WelcomePage 一个 view 枚举；skills 污染 projects 数据流（hub-as-project）。
- client 侧 `CenterView` 多分支天然支持功能隔离；Rust 侧已有进程 spawn/防孤儿基建可参照；capabilities 对 `$HOME/.ai-ssh/**` 的 fs deny 只约束前端 plugin，不影响 Rust command 读写。

## 决议

- **Q1 布局形态 → 整窗接管**：`centerView === "aiCoding"` 时隐藏 SSH 左侧栏与右侧 ChatPanel，AI Coding 内部自带 nezha 式完整布局（ProjectRail + TaskPanel + 运行视图）。理由：隔离最彻底，UI 迁移改动最小。
- **Q2 状态管理 → 照搬 props 钻透**：App.tsx 改造为自包含的 AiCodingPanel，不引入 zustand 重构。理由：迁移成本最低、组件契约不变。
- **Q3 样式 → 结构照搬 + 电路霓虹色板映射**：CSS-in-JS 组件样式结构原样迁，主题变量值替换为 client 设计 token（plasma/circuit/volt/void），固定深色、删 4 主题选择器。理由：布局零重写的同时视觉融入 client。
- **Q4 状态跟踪 → hook + 轮询双路径全带**：含版本门槛检测、信任检查、卸载清理，保持 nezha 原行为（会改写用户全局 agent 配置文件）。理由：复刻就复刻完整，避免状态不准再补课。
- **Q5 模块裁剪 → 只排除用量展示**：文件浏览器/查看器、本地 Shell 终端、看板浮层均迁移；用量展示（api.anthropic.com + codex app-server 子进程）排除。通知铃（拉 nezha 官方域名）、Windows 托盘等平台壳功能默认排除；智能命名、会话查看/导出、多项目挂载、项目级/应用级设置默认全带。
- **Q6 i18n → 照搬模块默认中文**：保留 t() 调用与 i18n.tsx，默认 zh。理由：迁移成本接近零，后续可切英文。
- **Q7 Rust 组织 → coding/ 子模块 + 前缀**：`src-tauri/src/coding/` 整体迁移，命令 `coding_` 前缀、事件 `coding:` 前缀；数据落 `~/.ai-ssh/coding/`（原子写保留）。理由：物理隔离、防与 SSH 侧未来撞名。
- **GPL-3.0 知悉**：自用无义务；将来若公开发布 ai-ssh，整仓需以 GPL-3.0 发布。CLAUDE.md 记录 aiCoding 模块来源。
- **红线重定义**：三条信任红线适用范围限定为 SSH 运维链路；AI Coding 面板为独立功能域（不经 server、不复用 SSH 信任链），权限模式（ask/auto_edit/full_access）沿用 agent CLI 原生交互，由用户创建任务时显式选择，不受 SSH 红线约束。
- **server 端零改动**；开发调试 AI Coding 需 `npm run tauri dev`（Rust command 参与编译）。

## 影响范围

- ssh-client：新增 `src/features/aiCoding/`（前端整目录）+ `src-tauri/src/coding/`（Rust 整目录）+ ConPTY resources；改动 `layoutStore` / `ActivityBar` / `Icon` / `App.tsx` 四文件接入；新增前端依赖（CodeMirror 全家桶、Shiki、marked、dompurify、lucide-react、radix 原语）与 Rust 依赖（portable-pty、notify、toml、ignore、trash、font-kit 等）。
- ssh-server：零改动。
- 文档：CLAUDE.md 红线重定义 + 已交付简史追加。
