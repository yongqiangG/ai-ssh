# 260824 · 手机伴侣终端体验优化

> 背景：docs/situations/260824-mobile-terminal-ux.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 阶段 1：服务端快照分流——alt 屏走状态序列，普通屏走尾窗重放

**目标**：快照按终端模式二选一，附带 `alt` 标志；修复 Codex 普通屏重连 scrollback 丢失回归。

**设计**：
- `stream.rs::subscribe_with_snapshot` 返回 `(快照, alt: bool, rx)`：仿真器照常惰性引导（需解析才能知道模式）；引导后查 `screen.alternate_screen()`——alt → `?1049h + state_formatted()`（现状），普通屏 → **原始尾窗**（260821 行为，恢复 scrollback；亦即既有回退分支转正为普通屏正路）
- 仿真器对普通屏任务照常常驻（后续建连免重解析，且 Claude 任务结束后退回普通屏的场景自动切到尾窗路径）
- `web/mod.rs`：快照消息 `{"type":"snapshot","data":...,"alt":...}`

**验收标准**：普通屏任务快照=原始尾窗（含 scrollback 恢复语义）；alt 屏任务快照=状态序列；alt 标志正确；既有测试语义对齐更新。

**测试用例**：alt 流（含 `?1049h`）→ 状态序列 + alt=true；无 1049 普通流 → 快照等于原始尾窗 + alt=false；空任务 → 复位序列 + alt=false（空网格非 alt）。

**验证**：

**状态**：未开始

## 阶段 2：手机端交互重构——双模式手势 + 顶底按钮 + 输入工具条

**目标**：滑动顺滑（Codex 本地瞬时 / Claude fling 摊薄 RTT）、顶底一击即达、Ctrl+C/Esc/Tab/方向键可达。

**设计**：
- `ws.ts`：ServerMsg snapshot 加 `alt`；回调 `onSnapshot(data, alt)`；`ws.test.ts` 同步
- `TaskView.tsx`：altRef 记模式。慢滑 32px/步（alt：wheel×1；普通：`scrollLines(±3)`）；fling >0.5px/ms 速度分档 1-3（alt：PgUp/PgDn `\x1b[5~/6~` ×N；普通：`scrollPages`）。顶/底按钮（alt：`\x1b[H`/`\x1b[F`，真机验证备胎 `\x1bOH/OF`；普通：`scrollToTop/Bottom`）。删四键区；常驻 28px 工具条 Esc/`^C`/Tab/↑/↓ 直发序列
- `mobile.css`：工具条样式，删 `.term-scroll-pad`/`.scroll-btn`
- 输入通道 `onData→sendInput` 一行不动；无位移触摸透传

**验收标准**：双模式手势/按钮/工具条行为正确；选项点选不受手势干扰；桌面零改动实证。

**测试用例**：ws 消息解析（alt 字段透传）；手势层逻辑（模块内可测的纯函数抽离则测，交互手感真机验）。

**验证**：

**状态**：未开始

## 阶段 3：回归 + 真机验收

**目标**：三件套全绿；真机清单交付用户。

**设计**：`cargo test` + `npm run test:run` + `npm run build`；`git diff --stat` 实证桌面零改动。

**验收标准**：全绿 + 清单交付。真机清单：①Claude：顶/底一击即达、fling 半页、慢滑细滚、Esc 打断、^C 清输入、Tab 补全、选项点选；②Codex：滑动瞬时滚、顶/底零延迟、**重连后历史仍在**（回归修复实证）、工具条同上；③双 agent CJK IME 输入验证；④桌面核心对话回归。

**测试用例**：见上。

**验证**：

**状态**：未开始
