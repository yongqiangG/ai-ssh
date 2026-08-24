# 260824 · 手机伴侣快照状态同步——终端加载体验

## 原始需求（用户原话）

> 当前实现了通过web+tailscale方案 实现了手机端远程接入ai coding面板功能
> 但是当前ai coding的终端面板加载的体验效果不佳，手机端点进一个长会话需要可能10秒，可能是因为手机端终端界面的逐帧解析
> 核实下当前的实现方案
> 针对这种手机端web的终端展示 有什么更成熟体验更好的方案吗
> 完整核实后grill me

## 背景（决策时事实，2026-08-24 核实）

- **加载链路（代码实证）**：手机 WS 建连 → `web/stream.rs::subscribe_with_snapshot` 取 256KB 尾窗 → 单条 JSON 文本帧 `{"type":"snapshot","data":<原始VT字节流>}`（`web/mod.rs::task_ws_loop`）→ 手机端 `TaskView.tsx` `term.reset()+term.write(data)` **全量重放**历史帧 → 之后 `onOutput` 增量写。
- **10 秒两嫌疑**：① DERP 传输 ② 手机 CPU 解析。**①已排除**——用户已在 Clash Verge TUN 排除 tailscale，直连建立（顺带了结 260821 Q5 运维项，自建 DERP 失去动机）。**②为主犯**：Claude/Codex 是全屏 TUI + spinner 每 ~100ms 重绘，尾窗里 99% 字节是被后续帧覆盖的中间态，全部白解析。
- **架构根源**：重放「事件历史」而非同步「最终状态」，负载 O(历史字节数)；调参（缩尾窗/分块/压缩）都是线性缓解，长会话依旧慢。
- **成熟方案扫描**：tmux/sshx 的服务端无头仿真器 + 状态同步模型（Rust `vt100` crate，支持 scrollback/alt-screen/单元格属性）；xterm.js 官方 issue #2975 指向同模式（headless 实例 + 序列化）；ttyd/gotty 干脆不恢复历史（陪伴模式不可接受）；tungstenite 无 permessage-deflate（压缩路线不通）；mosh SSP 需 UDP 与 WS 不匹配。
- **既有资产**：tap 旁路纪律（失败静默不影响主路径）、尾窗环形缓冲 + 8MB 预算逐出、resize 仲裁（260821 Q10：手机在线归手机、断开还原桌面留底）、手机端 onSnapshot→term.write 管线。
- xterm.js write buffer 异步分块不卡 UI，但解析总量不减。

## 决议

- **Q1 方案 → A 服务端状态同步**：Rust `vt100` 无头仿真器，建连时序列化最终屏幕状态（scrollback 行 + 当前屏 + SGR + 光标，重编码为 VT 序列）替代 256KB 原始重放。O(历史字节)→O(最终屏幕)，传输与解析两个嫌疑一次全治。（B 缩尾窗/C 压缩治标；D 不恢复历史不可接受；E mosh 不匹配。）
- **Q2 仿真器生命周期 → 惰性引导 + 常驻**：首个手机 WS 建连时把现有尾窗一次性灌进仿真器（PC CPU 毫秒级），此后常驻增量喂；无手机会话的任务零开销；随尾窗逐出策略一起回收。（语义与现状完全对齐——今天手机看到的也就是尾窗内容，不引入信息损失。）
- **Q3 线上格式 → 重编码 VT 序列**：协议与手机端**零改动**（onSnapshot→term.write 原样吃进）；服务端编码失败时回退发原始尾窗，手机端无感知。拒绝结构化 JSON（多一套渲染路径，两套长期维护）。
- **Q4 尺寸 → 纯跟随 PTY**：`note_desktop_size` 与 WS resize 两个写入点各加一行仿真器 resize；引导按 PTY 当前尺寸建格。建连瞬间旧尺寸历史帧的短暂错排靠 TUI 收 SIGWINCH 全屏重绘自愈（与现状下限一致，不引入新退化）。
- **Q5 回退 → 仅硬失败回退**：序列化报错 / 仿真器不存在 → 发原始尾窗。宽字符宽度表差异（vt100 wcwidth vs xterm Unicode11）**不检测不设防**——只影响 TUI 首次重绘前一帧过渡（~100ms 量级），为不可见瞬时态维护跨仿真器对照表违背简洁性。PoC 做 CJK/emoji 目测抽检，系统性错位再升级讨论。
- **Q6 范围 → 白名单**：Rust 限 `web/`（stream.rs / 新 term_state 模块 / mod.rs 快照发送处）+ `pty.rs` 既有 tap 表面（note_desktop_size 调用点附近）+ Cargo.toml 依赖；**桌面前端零改动、手机前端零改动**（验收 git 实证）。session 查看器（50MB 桌面重放）列为非目标。backlog `260821-derp-selfhost.md` 整条移除（直连已成，历史考古交 git）。
- **Q7 验收 → 数字与测法**：快照 <10KB（服务端日志记字节数）；PC 本地 <300ms；手机直连 <1.5s 内容可见（含 WS 握手+resize+TUI 重绘，用户真机验证）；`src/mobile/` 零 diff；回退路径单测+手动一次；`cargo test`+`npm run test:run`+`npm run build` 全绿；CJK/emoji 真机目测。数字为工程预期非实测基线，若落 1.5–3s 档不硬凹、回场景重新归因。
- **PoC 先行**（action 阶段 0，通过才进实现）：① vt100 官方 crate vs 维护 fork 选型；② 带属性序列化用 crate 自带 API 还是逐格重编码；③ alt-screen 序列化语义跑通（进 alt + 全屏 + 光标定位）。

## 影响范围

- ssh-client Rust：`coding/web/` 快照路径改造（stream.rs + 新 term_state 模块 + mod.rs）；`pty.rs` 既有 tap/resize 表面加通知；Cargo.toml 加 vt100 系依赖。
- 前端：桌面与手机**均零改动**。
- 不动：SSH 运维链路、桌面实时输出主路径、session 查看器（非目标）。
- backlog：移除 `260821-derp-selfhost.md`。
- 归档：`docs/actions/260824-mobile-snapshot-statesync.md`。
