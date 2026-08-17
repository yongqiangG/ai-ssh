# 260817 · AI Coding 待确认桌面通知 + 点击跳转终端

## 原始需求（用户原话）

> 当前在client中实现了pty对接使用claude、codex，然后通过hook实现了任务的状态管理。现在需要在待确认的状态提供桌面通知，使用tauri的通知插件，这个应该是比较成熟的方案，并且点击通知后可以跳转到对应的终端。整体核实后grill me确认方案

> （grill 中补充）1. AiCodingPanel 的卸载是不是没有必要，是不是和其他activitybar的功能面板表现不一致，是否可以考虑切换到这个面板隐藏其他面板就好。2. 现在看板功能可以点击任务实现跳转，和这个回调逻辑类似，这块的功能是否可以复用。3. 目前只需要应用没有关闭的情况下可以回调，如果应用已经关闭了，不需要支持点击残留的通知回调，这个看下是否可以简化方案。

## 背景（决策时事实，2026-08-17 核实）

- 状态机：三路状态源（event_watcher.rs hook 路径 / session.rs Codex RPC / session.rs Claude 会话轮询）全部经 `session.rs::emit_task_status()` 单点 emit `coding:task-status`，且各有边沿防抖（`last_status` guard / `sync_waiting_for_user` 边沿触发）。`input_required`=工具审批/问询（agent 卡住），`awaiting_review`=Stop 一轮结束待验收。
- 官方 tauri-plugin-notification **无点击回调**（plugins-workspace #2150 仍为 open feature request）——只发通知可用，点击路由必须另做。
- `tauri-plugin-single-instance` 已在用（lib.rs:351 双开归一），回调目前忽略 `_args` 只拉起窗口——是 toast 点击路由的现成落点。
- Windows toast 点击机制（无 COM activator 的 unpackaged 应用）：Windows 经 **AUMID 匹配的开始菜单快捷方式**拉起第二实例并携带 launch 参数 → 单实例回调拿到 args。快捷方式 AUMID == toast app_id 是硬前提。
- `AiCodingPanel` 在 SSH 视图下**卸载**（App.tsx:58）——与 TerminalPanel/SftpPanel 条件渲染模式一致，非异类；用户在 SSH 视图时（最需要通知的场景）AiCodingApp 的事件监听不存在。
- 看板跳转已有现成函数 `enterProjectFromKanban(project, taskId)`（AiCodingApp.tsx:1161）：关浮层 + handleProjectClick + updateProjectView 选中任务，注释明示三步必须一起做。
- 260815 迁移时 nezha 的 `notification.rs` 被有意排除，本功能为新设计非补迁移。
- `bundle.identifier` 当前为占位符 `com.example.sshclient`——AUMID/快捷方式/Windows 通知设置记忆/appdata 目录全绑它。
- dev 模式无快捷方式且 AUMID 未注册，toast 可能不显示、点击必无效。
- 应用关闭则任务子进程即死（关窗确认公理），残留 toast 点击无有效目标。

## 决议

- **Q1 触发状态 → input_required + awaiting_review 都通知**；done/failed 不通知；GeneralPanel 加总开关默认开（两种等待语义不同，文案区分；终态无时效）。
- **Q2 决策层级 → Rust 收口**：挂在 `emit_task_status()` 单点——三路状态源天然归一且自带防抖；前端在 SSH 视图无监听器，前端决策需跨层取任务上下文，绕一圈。
- **Q3 抑制规则 → `window.is_focused() == false` 才弹**（覆盖后台+最小化）；前台靠已有角标。「盯着任务 A 时任务 B 待确认」的精确判断需前端可见性上报，为边界场景付复杂度不值。
- **Q4/5 点击通道 → 单实例回调 + pendingNavigation 桥，不做冷启动**：回调解析 launch 参数中 `task_id` → emit `coding:navigate {task_id}` → App.tsx 常驻监听置 `centerView="aiCoding"` + 写 pendingNav → AiCodingApp 挂载时/订阅时消费，从 tasks 查 projectId 后复用 `enterProjectFromKanban` 三步；task 不存在降级只进项目页；消费即清空。应用关闭后点残留通知 = 正常启动无视 args（砍掉 env::args 读取、就绪握手、延迟发送整条冷启动路径）。不动 AiCodingPanel 挂载架构（保持全应用统一模式，pendingNav 桥更便宜）。
- **Q6 identifier → 改为 `com.johnny.ai-ssh`**：通知上线正是把 identifier 烧死进系统（AUMID/通知设置记忆）的时刻，自用阶段一次性付清（本机重设一次设置）几乎零成本，公开发布分支留着就必须改。
- **Q7 验证 → dev 不验证**：统一代码路径，dev 下 toast 不显示属预期（日志辅助诊断）；正式验证 = 本机 `npm run tauri build` 出 NSIS 包安装实测。纯逻辑（参数解析/判定/pendingNav/降级）照常单测。
- **Q8 crate → winrt-toast-reborn**：维护中的 fork，`ToastManager::new(aum_id)` 显式 AUMID、launch/actions/激活路径齐全；仅用 display + launch 参数层，不用其 on_activated 回调。
- **Q9 内容/语言/堆叠 → 标题=任务标题，正文=`项目名 · agent · 状态词`，无按钮**（点整个 toast 即跳转）；状态词跟随前端语言（语言偏好写入 app_settings 由 Rust 读，避免破坏双语体系）；tag=task_id 让同任务新 toast 替换通知中心旧条目（crate 未暴露则接受堆叠记 pool）。
- **Q10 开关/平台 → 开关存 `app_settings.rs` 实时读**（GeneralPanel toggle，判定时读改完即生效）；toast 发送 `#[cfg(windows)]`，导航链路（Tauri event + 前端逻辑）保持跨平台。

## 影响范围

- ssh-client Rust：Cargo.toml 加 winrt-toast-reborn（windows only）；新增 `coding/notify.rs`（判定 + toast 发送，纯判定函数可测）；`session.rs::emit_task_status` 挂点；`app_settings.rs` 加 `desktop_notifications_enabled` + `language` 字段；`lib.rs` 单实例回调解析 args + emit `coding:navigate`；tauri.conf.json identifier → `com.johnny.ai-ssh`。
- ssh-client 前端：pendingNavigation 模块（features/aiCoding 内或共用层）；App.tsx 常驻监听 `coding:navigate`；AiCodingApp 消费 pendingNav 复用 enterProjectFromKanban；GeneralPanel 开关；语言偏好同步写入 app_settings；i18n 词条。
- 测试：Rust 单测（launch 参数解析、判定条件、语言映射）+ 前端单测（pendingNav 桥、降级）；NSIS 安装后手动清单。
- 风险：Tauri bundler 是否给 NSIS 快捷方式设 AUMID 未证实——安装实测验证，不生效用现成 nsis-hooks.nsh 挂点补设。
