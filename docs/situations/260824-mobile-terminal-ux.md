# 260824 · 手机伴侣终端体验优化——滚动/按钮/输入工具条

## 原始需求（用户原话）

> 现在继续优化手机端的终端体验
> 1. 现在手机端终端有4个按钮 我感觉作用不是很大 可以被滑动翻页的方式取代 可以移除掉4个按钮 或者保留一个回到会话顶部就好 现在的回到顶部按钮实现有问题 实际点击无法回到顶部 只会上移一点点
> 2. 现在滑动的体验不是很顺滑 现在调整了手机端终端的加载方式 这个滑动上下滑的体验是不是可以跟着进行优化 现在有延迟
> 3. 然后现在终端输入部分功能不是很完善，如何实现类似桌面端通过ctrl+c可以打断会话或者清空终端输入
> 核实当前情况后，结合tmux方案，是否也有对这些问题的成熟的优化方案，核实后grill me。
> 另外如果有你认为手机端终端值得优化的部分也提出来

> （grill 中补充）你这个方案是通用方案 终端有可能是claude或者codex——要求双 agent 通用。
> （grill 中补充）需要确认不会对现有的终端对话流程造成影响，导致桌面端或者手机端核心的对话功能不可用。
> （grill 中补充）转写视图先不实现、也不落池——核心场景是实时终端对话/选项驱动任务往下走，后续有需要主动提出。

## 背景（决策时事实，2026-08-24 核实）

- **回顶失效根因**：`TaskView.tsx` toTop = `wheel(64, 14)` = 14 个 wheel-up 事件 ×~3 行 ≈ 42 行/次——固定步进无直达手段，长会话杯水车薪。
- **滑动延迟根因**：每 32px 滑步 → 1 个 SGR wheel 事件 → WS→PTY→TUI 全屏重绘→回传，每步感知延迟 = RTT 60-160ms，零本地预测。
- **双 agent 终端模式矩阵（源码级实证）**：
  - **Claude Code（Windows）**：alt-screen（`?1049` 探针实证，build_claude_cmd 注释），全套鼠标上报 1000/1002/1003/1006 开启，wheel 由 Claude 虚拟滚动处理——现有滑动在 Claude 上有效；键盘 PageUp/PageDown 半页、Home/End 顶底（官方键位文档）；已知风险 anthropics/claude-code#12953（个别版本 PageUp 轮换输入历史）。
  - **Codex CLI**：**普通屏**（codex-rs/tui scrollback.rs 两策略均无 1049，FullScreen 策略只是 scroll region workaround）+ **终端本地 scrollback 承载历史**（history_pagination.rs 明言 terminal-native scrollback）；**全 TUI 源码零鼠标捕获**——现有滑动手势/四按钮在 Codex 任务上是死键（今日现状即如此）；键盘翻页键位（PageUp/Down/Home/End/Ctrl+u/d）绑定在 transcript overlay（Ctrl+T）上下文，主视图 Home/End 是输入框行首/行尾。
- **tmux 类比结论**：tmux copy-mode 丝滑的本质是 scrollback 浏览本地化；对 alt-screen 应用（Claude）tmux 同样只能转发 wheel——远程序列是 Claude 的天花板；Codex 的历史物理上就在终端 scrollback 里，本地滚动即 tmux copy-mode 等价物，零 RTT。
- **状态同步回归（自首）**：260824 上午的快照状态同步只恢复可见屏——Codex 普通屏任务的 scrollback 历史**重连后丢失**（旧尾窗重放可恢复 256KB）。修法：快照按仿真器 `alternate_screen()` 分流。
- 输入通道现状：`term.onData → ws.sendInput → write_pty_input` 原始字符串通道现成，缺的只是手机软键盘没有 Ctrl/Esc/Tab；成熟范式 = Blink/Termius 辅助键工具条。

## 决议

- **Q1 滚动架构 → 按终端模式分流（非按 agent 品牌）**：分流判据 = 仿真器探测的 alt-screen 状态（随快照消息下发 `alt` 字段），前端不认 agent 名、未来 agent 自动正确。alt 屏（Claude）= 远程序列（慢滑 wheel / fling PgUp/PgDn / 顶底 Home/End）；普通屏（Codex）= **xterm 本地 API**（scrollLines/scrollPages/scrollToTop/scrollToBottom，零字节进 PTY）。转写视图（session JSONL 独立读面）**不实现不落池**——用户核心场景是实时对话/选项驱动，后续有需要主动提出。
- **Q2 按钮 → 删 ↑/↓，留「顶/底」两枚，per 模式映射**：Claude 发 `\x1b[H`/`\x1b[F`（Home/End，真机验证，备胎 `\x1bOH`/`\x1bOF`）；Codex 本地 scrollToTop/Bottom。曾议 Codex overlay 宏舞步（Ctrl+T→跳→q）——普通屏事实披露后**作废**。
- **Q3 手势参数**：慢滑 32px/步（Claude 1 wheel≈3 行；Codex scrollLines(±3)）；fling 阈值 0.5px/ms，按速度 1-3 档（Claude PgUp/PgDn ×N；Codex scrollPages ±N）。初值进真机调优，验收写体感不写数字。
- **Q4 输入工具条 → 常驻 28px 细条五键**：Esc（`\x1b`，Claude 打断生成）、Ctrl+C（`\x03`，清空输入；空输入时 Claude 出退出确认需再按一次，单点安全）、Tab（`\x09`）、↑/↓（`\x1b[A/B`）。拒绝「键盘弹出才显示」形态——Esc 打断是键盘收起时的高频动作，藏了最重要的键。Ctrl+C 不做连击宏，退出确认由 agent 原生交互把关。
- **Q5 范围与安全 → 核心对话流程零影响为硬约束**：输入通道一行不动；触摸无位移透传（选项点选不受干扰）；桌面前端/`pty.rs`/事件总线零改动；Codex 本地滚动物理上无法影响任务（零字节）；最坏失败模式全部是「功能不生效」而非「对话不可用」。改动白名单：`TaskView.tsx`、`mobile.css`、`ws.ts(+test)`、`stream.rs`（快照分流，含 Codex 回归修复）、`web/mod.rs`（alt 字段）。

## 影响范围

- ssh-client 前端：`src/mobile/`（TaskView/ws/css/test）——桌面零改动。
- ssh-client Rust：`coding/web/stream.rs`（快照二选一分流 + 返回 alt 标志）、`coding/web/mod.rs`（快照消息 `alt` 字段）——`pty.rs` 零改动。
- 修复：Codex 普通屏任务重连 scrollback 丢失回归（260824 上午状态同步引入）。
- 不动：输入通道、resize 仲裁、桌面一切、SSH 运维链路。
- 验收（真机）：双 agent 滚动/顶底/打断/清输入/Tab/选项点选；CJK IME 组合输入验证；桌面核心对话回归；stream 单测（分流分支）+ 三件套全绿。
