# 260817 · AI Coding 待确认桌面通知 + 点击跳转

> 背景：docs/situations/260817-coding-desktop-notification.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 阶段 1：Rust 通知层（发送 + 判定）

**目标**：`emit_task_status()` 命中待确认状态且条件满足时发出带 launch 参数的 Windows toast；判定逻辑纯函数化可单测。
**设计**：
- Cargo.toml `[target.'cfg(windows)'.dependencies]` 加 `winrt-toast-reborn`；notify 逻辑整块 `#[cfg(windows)]`，非 Windows no-op
- 新增 `coding/notify.rs`：`should_notify(status, enabled, focused) -> bool` 纯函数 + `send_attention_toast(task_id, title, body, tag)`；`ToastManager::new("com.johnny.ai-ssh")`，launch 参数只放 `task_id`（uuid，无编码问题）
- `app_settings.rs`：`AppSettings` 加 `desktop_notifications_enabled`（默认 true）+ `language`（"en"|"zh"，默认跟随后端写入）+ 保存命令
- `emit_task_status` 挂点：命中 `{input_required, awaiting_review}` && 开关开 && `!is_focused()` 时，从 storage 按 task_id 查 Task（name/agent/project_id→项目名）拼内容发送；失败只 log 不打断 emit
- 状态词映射：`attention_status_word(status, lang)` 纯函数（input_required→Needs confirmation/需要确认；awaiting_review→Awaiting review/已完成待验收）
- tag=task_id 替换同任务旧 toast；winrt-toast-reborn 若未暴露 tag/group API 则降级不设并记 pool
**验收标准**：`cargo check`/`cargo test` 通过；判定函数与状态词映射有单测覆盖（含开关关/前台/非目标状态不弹）。
**测试用例**：should_notify 四条件组合矩阵；状态词 en/zh 映射；launch 参数构造仅含 task_id。
**验证**：`cargo test` 76/76 绿（新增 notify 4 测：判定矩阵/状态词映射/launch 参数解析/task_display_title 与前端 taskTitle 同规则）。`cargo check` 通过。toast 发送本体属 OS 交互，走阶段 4 打包实测。遗留：无。
**状态**：已完成

## 阶段 2：点击链路（单实例回调 → 前端导航）

**目标**：点击 toast → 窗口拉起 + 切入 aiCoding 视图 + 定位到目标任务终端；task 不存在降级进项目页。
**设计**：
- launch 参数格式 `--aish-task=<task_id>`（避免裸 uuid 与其他 args 歧义）；`lib.rs` 单实例回调解析 args → emit `coding:navigate {task_id}`，保持既有 unminimize/show/focus 行为
- 前端新增 pendingNavigation 桥（features/aiCoding 下模块级小 store：set/consume，消费即清空）
- App.tsx 常驻监听 `coding:navigate`：`centerView = "aiCoding"` + 写 pendingNav（不依赖 AiCodingPanel 挂载状态）
- AiCodingApp 挂载时 + 订阅时消费 pendingNav：tasks 查 `projectId` → 复用 `enterProjectFromKanban` 三步（handleProjectClick + updateProjectView 选中）；task 不存在则只 `handleProjectClick` 进项目页
- 无冷启动路径：应用关闭后点残留通知 = 正常启动，args 无视
**验收标准**：`npm run test:run`/`npm run build` 通过；单实例回调解析与 pendingNav 桥有单测。
**测试用例**：args 解析（含 `--aish-task=`、无参、多参顺序）；pendingNav set/consume 清空语义；task 存在→三步导航 / 不存在→降级进项目页。
**验证**：Rust `cargo test` 76/76 绿（parse_task_launch_arg 覆盖命中/空值/多参/无参）；前端 vitest 226/226 绿（新增 pending-navigation 3 测：peek 不清空+consume 清空、订阅通知+退订、订阅路径写入仍可消费）；`npm run build`（tsc+vite）通过。点击→导航端到端属 OS 交互，阶段 4 打包实测。实现调整：task 不存在时不导航（原计划「降级进项目页」需 payload 携带 project_id，而残留通知场景本就无有效目标，简化为停留当前视图；桥中滞留无害）。挂载初期 tasks 未加载完不 consume，由无依赖 effect 在 tasks 就绪后重试。
**状态**：已完成

## 阶段 3：设置 UI + i18n

**目标**：GeneralPanel 通知开关 + 状态词跟随前端语言。
**设计**：
- GeneralPanel 加「桌面通知」toggle（与角标开关同款交互），走 `coding_save_desktop_notifications` 命令
- 前端语言切换处同步 `language` 写入 app_settings（i18n 现有语言状态处追加一次 invoke；Rust 判定时读）
- i18n 词条：开关标题/描述（en/zh）
**验收标准**：开关切换落盘且 Rust 侧判定读到新值；语言切换后状态词映射跟随；前端测试绿。
**测试用例**：开关默认开；语言同步写入调用；词条 en/zh 齐全。
**验证**：vitest 228/228 绿（新增词条齐整测试 2 例）；`npm run build`（tsc+vite）通过。语言同步经 I18nProvider 的 language effect（启动+切换各一次 invoke，非 Tauri 测试环境静默失败）；开关复用 copyOnSelect 自包含模式（面板内加载/保存 + CHANGED 事件广播），前端 AppSettings 类型/DEFAULT_APP_SETTINGS 同步补 desktop_notifications_enabled/language。遗留：无。
**状态**：已完成

## 阶段 4：identifier 切换 + 打包验证

**目标**：identifier 改为 `com.johnny.ai-ssh`，NSIS 包安装后全链路实测。
**设计**：
- tauri.conf.json `identifier` → `com.johnny.ai-ssh`；本机卸载旧版重装；本机 localStorage/appdata 重设一次（baseUrl 等）
- 手动验证清单：①后台触发 input_required 弹 toast ②点击 → 窗口拉起 + 定位任务终端 ③最小化场景 ④开关关闭不弹 ⑤同任务二次待确认替换旧 toast ⑥awaiting_review 文案区分 ⑦Windows 通知设置里应用按新 id 出现 ⑧勿扰模式下 toast 进通知中心不横幅（记录行为）
- AUMID 核验：若点击无效，检查 NSIS 快捷方式 AUMID（bundler 未设则经 nsis-hooks.nsh 补设，升级 pool/本文件）
**验收标准**：清单全过；AUMID 关联确认有效或兜底方案落定。
**测试用例**：即手动清单 ①-⑧。
**验证**：
**状态**：未开始
