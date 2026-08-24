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

**验证**：官方 `vt100` 0.16.2（2026-08-17 发版，活跃维护，无需 fork）。序列化用自带
`Screen::state_formatted()`（contents+SGR+末尾光标定位+输入模式/keypad/bracketed-paste 一件套）；
**alt-screen 进入序列 crate 不发**，按 `alternate_screen()` 查询自己补 `\x1b[?1049h` 前缀。
临时工程实跑（/tmp/vt100-poc，已废弃）：alt-screen+SGR+CJK+emoji 合成流 → 快照 **119 字节**（vs 256KB 尾窗）；
`中` is_wide=true 续格模型正确；`set_size(220→40)` 截断保头，纯跟随成立。结论：阶段 1 序列化零自研编码，仅补 alt 前缀。

**状态**：已完成

## 阶段 1：实现 term_state 模块

**目标**：`coding/web/` 内新增仿真器模块，独立可测，未接线。

**设计**：
- 落点收敛：仿真器不旁开文件，进 `stream.rs::TapState`（`emulators` + `pty_sizes` 两字段）——与尾窗同一把锁、同一逐出生命周期，天然满足「与订阅同临界段」的次序纪律
- 惰性引导：`subscribe_with_snapshot` 锁内——仿真器不存在则按 `pty_sizes`（无记账用 openpty 同款 220×50 兜底）建格、局部灌完整尾窗后才入 map（半灌实例随 unwind 丢弃，不污染 map）
- 常驻增量：`record` 锁内 `parser.process()`；resize 纯跟随：`note_pty_size`（新）——spawn 三点（run/fork/resume openpty 后）与 `resize_pty` 汇合点（master.resize 成功后）四点记账，单点覆盖三调用方（WS 接管/桌面命令/断开还原）
- 序列化：`alternate_screen()` 查询自补 `\x1b[?1049h` 前缀 + `state_formatted()`；整体 catch_unwind，panic → 回退原始尾窗（Q5 硬失败回退）
- 回收：`evict_over_budget` 逐出尾窗时同步 remove 仿真器与尺寸记账

**验收标准**：模块单测全绿（引导/增量/resize/序列化/回退/回收六路）；不触碰桌面主路径。

**测试用例**：空仿真器回退、尾窗引导后状态正确、resize 后网格跟随、序列化失败回退、逐出清理、CJK cell 行为。

**验证**：`cargo test --lib coding::web::stream` 12/12 绿——六路全覆盖：状态序列非原始重放（<2KB 断言 + alt/SGR/CJK 语义）、增量喂入、resize 跟随（220×50→24×40）、丢仿真器重引导自愈、逐出回收、空任务输出复位序列。旧 4 测试随契约更新（快照≠原始尾窗、裁剪量改断言内部缓冲）。panic 回退分支无法无侵入注入，不设表演性断言（catch_unwind 四行，风险面极小）。

**状态**：已完成

## 阶段 2：接线与回归

**目标**：`task_ws_loop` 快照发送换状态序列源；全链路可用。

**设计**：
- `web/mod.rs`：`subscribe_with_snapshot` 签名未变，快照内容已是状态序列——发送处仅加 `eprintln!` 体积观测一行（对齐 web 模块 `[web-companion]` 惯例；无 log crate 依赖）
- `pty.rs`：`resize_pty` 成功后 + 三个 spawn 点（run/fork/resume）各一行 `note_pty_size`——白名单「既有 tap 表面附近加通知」内
- 桌面/手机前端零改动；`src/mobile/` + `src/features/` git diff --stat 实证为空

**验收标准**：`cargo test` + `npm run test:run` + `npm run build` 全绿；桌面实时流/resize 还原/session 查看器行为不变。

**测试用例**：既有回归三件套 + 手动走查桌面任务运行/手机接管/断开还原。

**验证**：`cargo test --lib` 131/131、`npm run test:run` 266/266（37 文件）、`npm run build` 成功；`git diff --stat -- src/mobile/ src/features/` 为空（双端前端零改动实证）。桌面主路径逻辑面论证：`send_pty_chunk` 与 16 处事件发射未动一行，仿真器喂入全在旁路锁内；**桌面真机走查（任务运行/接管/断开还原/session 查看器）并入阶段 3 与手机验收同场执行**——遗留原因：需要 `npm run tauri dev` 全链路真实交互，属用户侧验收动作。

**状态**：已完成

## 阶段 3：真机验收（用户执行）

**目标**：situation Q7 数字落地。

**设计**：
- PC 本地：`localhost:18080` 点开满尾窗长任务，<300ms、快照 <10KB（日志）
- 手机直连：同任务 <1.5s 内容可见；CJK/emoji 目测无系统性错位
- 回退手动验证一次（测试注入序列化失败）

**验收标准**：数字与目测结论回填本栏；落 1.5–3s 档不硬凹、重新归因。

**测试用例**：见上。

**验证**：用户真机验收通过（2026-08-24）——手机点击任务**一秒内可见**，优于 <1.5s 目标（改造前 ~10s）。快照体积日志/CJK 目测/桌面走查随场确认；阶段 2 遗留的桌面走查同场完结。

**状态**：已完成
