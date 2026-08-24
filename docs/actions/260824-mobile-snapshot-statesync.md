# 260824 · 手机伴侣快照状态同步

> 背景：docs/situations/260824-mobile-snapshot-statesync.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 阶段 0：PoC——vt100 crate 选型与序列化验证

**目标**：三大未定项全部定案，产出可写进阶段 1 设计的结论。

**设计**：
- crate 选型：官方 `vt100` vs 维护 fork（vt100-omny / term-wm-vt100 / vt100-ctt），判据 = 维护状态 + API 完整度（cell 属性、scrollback、alt-screen、resize）
- 序列化形态：crate 自带 contents 系 API 是否带 SGR 属性；没有则逐格 `cell(row,col)` 重发 SGR（约百行级）
- alt-screen 语义：进 alt 序列 + 全屏内容 + 光标定位的编码顺序跑通；scrollback（normal screen 场景）一并验
- 宽字符：CJK/emoji 喂入后 cell 宽度行为确认（目测抽检级，不建对照表——situation Q5）

**验收标准**：选型结论 + 序列化 API 形态写入本阶段「验证」栏；最小 PoC 代码（可废弃）实跑过一次完整 encode。

**测试用例**：含 SGR 彩色文本 + CJK + alt-screen 切换的合成 VT 流灌入 → 序列化输出 → 目测/断言覆盖属性保留。

**验证**：

**状态**：进行中

## 阶段 1：实现 term_state 模块

**目标**：`coding/web/` 内新增仿真器模块，独立可测，未接线。

**设计**：
- 惰性引导：`subscribe_with_snapshot` 临界段内触发——仿真器不存在则按 PTY 当前尺寸建格并灌尾窗，存在则直接序列化
- 常驻增量：`stream::record` 同点喂仿真器（同 tap 纪律：失败静默）
- resize 纯跟随：`note_desktop_size` 与 WS resize 两写入点通知仿真器
- 序列化：网格 → VT 序列（阶段 0 定案形态）；Err 即回退原始尾窗
- 回收：仿真器随尾窗预算逐出/任务终结一并清理

**验收标准**：模块单测全绿（引导/增量/resize/序列化/回退/回收六路）；不触碰桌面主路径。

**测试用例**：空仿真器回退、尾窗引导后状态正确、resize 后网格跟随、序列化失败回退、逐出清理、CJK cell 行为。

**验证**：

**状态**：未开始

## 阶段 2：接线与回归

**目标**：`task_ws_loop` 快照发送换状态序列源；全链路可用。

**设计**：
- `web/mod.rs`：snapshot 帧内容 = 序列化结果（回退原始尾窗）；快照字节数 debug 日志一条
- `pty.rs`：note_desktop_size 调用点附近加仿真器 resize 通知（既有白名单表面内）
- 桌面/手机前端零改动；`src/mobile/` git 实证零 diff

**验收标准**：`cargo test` + `npm run test:run` + `npm run build` 全绿；桌面实时流/resize 还原/session 查看器走查不变。

**测试用例**：既有回归三件套 + 手动走查桌面任务运行/手机接管/断开还原。

**验证**：

**状态**：未开始

## 阶段 3：真机验收（用户执行）

**目标**：situation Q7 数字落地。

**设计**：
- PC 本地：`localhost:18080` 点开满尾窗长任务，<300ms、快照 <10KB（日志）
- 手机直连：同任务 <1.5s 内容可见；CJK/emoji 目测无系统性错位
- 回退手动验证一次（测试注入序列化失败）

**验收标准**：数字与目测结论回填本栏；落 1.5–3s 档不硬凹、重新归因。

**测试用例**：见上。

**验证**：

**状态**：未开始
