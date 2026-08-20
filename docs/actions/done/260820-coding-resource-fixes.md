# AI Coding 资源评审修复（P1×4 + P2×3 + P3×3）

> 背景：docs/situations/260820-coding-resource-review.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 复审补丁（交付后二次评审，随最后 commit）

对三个交付 commit 做对抗性复审后发现并修复三处：① P3-b 代次守卫的 check 与 remove 原为两个临界段，同 id 重新注册可插入其间（TOCTOU）——`register_pty_handles` 与 `remove_pty_handles_if_same` 均改为同锁序（masters→writers→children）三锁单临界段，注册与代次删除互斥；② analytics 测试共享全局 METRICS_CACHE 而 cargo 默认并行——eviction 的 `cache.clear()` 可能插进 mtime 快路径用例的两次调用之间造成 flaky，加 TEST_LOCK 全用例串行；③ 注释笔误 U+FFRD→U+FFFD。复审同时核了锁序全图（三锁路径均同序，无死锁面）与 Utf8Chunker/feed 终止性（每轮 start 严格前进）。

## 阶段 1：Rust P1 修复

**目标**：毒字节、metrics O(N²)、竞态线程永活、reset 漏清四项性能/稳定性缺陷全部修复且带测试。
**设计**：
- P1-1（pty.rs）：把 UTF-8 分片逻辑从 `spawn_pty_reader` 抽成可测的纯函数/结构体（feed 字节 → 有效前缀 + leftover），`valid_len==0` 且 leftover 超过 `MAX_UTF8_LEFTOVER`（按 UTF-8 最大序列 4 字节 + 余量）时丢弃头部坏字节；正常跨读截断行为不变。
- P1-2（analytics.rs）：`METRICS_CACHE` 值改为 `(offset, 累加器)`；Claude 用累加器（token/tool_calls/timestamps 逐行累加，last_context 取最后一条），Codex 同理（last_token_info 只留最后一条）；文件 size < offset（被截断/重写）时回退全量重解析；缓存条目数超上限（64）时整体清空。
- P1-3（session.rs）：两个 watch 循环加兜底——`child_handles` 不含本任务连续超时（10s）即退出；退出前若 session entry 的 session_id 仍是自己那代注入的则移除（防删新一代）。需在锁外读 child 状态避免锁序问题。
- P1-4（pty.rs）：`coding_reset_task_process` 在 kill 后补 `remove_pty_handles` 之外的四项：sessions 两表、`release_claimed_session_paths`（复用现有函数）、`event_watcher::cleanup_task_events`。清理逻辑抽成可测 helper。
**验收标准**：`cargo test`（coding 模块）全绿；新增测试覆盖毒字节丢头、UTF-8 跨读正常拼接、metrics 增量=全量、metrics 文件截断回退、watch 兜底退出状态机、reset 清理后表全空。
**测试用例**：
1. 喂 `[0x61, 0xF0, 0x9F]`（合法前缀+截断 emoji）→ leftover 存 0xF0,0x9F，下轮补 0x98,0x8A 拼回完整 emoji。
2. 喂 `[0xFF, ...]` 毒字节头 → 超阈值后丢头部坏字节，后续正常输出不再冻结。
3. Claude metrics：先喂 3 行再喂 2 行增量，结果 == 一次性喂 5 行。
4. metrics：文件被重写变小（size < offset）→ 回退全量。
5. watch 兜底：child 死亡信号持续超时 → 退出判定为真；child 复活 → 计数清零。
6. reset：表中有 entry 时执行清理 helper → sessions/claimed/事件目录全清。
**验证**：`cargo test --lib coding::` 90/90 绿（新增 17 个：Utf8Chunker 7 + analytics 增量 6 + ChildDeathGuard 3 + clear_task_registration 1）。实现与设计的偏差两点、均更优：① 毒字节修复未用「阈值丢头」而用 `error_len` 区分「尾部截断（保留拼接）」与「确定性非法字节（立即跳过）」——语义精确且永不积压，torn line 不会被半行喂两次；② metrics 增量对 torn line 同样只消费完整行、offset 只落在 `\n` 之后，并把 mtime 快路径保留（未变文件零 IO）。无遗留。
**状态**：已完成

## 阶段 2：Rust P2/P3 修复

**目标**：存储增长三项 + session 上限 + shell 代次全部落地。
**设计**：
- P2-5（storage.rs + AiCodingApp.tsx）：新增命令 `coding_delete_project_data(projectId)` 删 `projects/<pid>/` 目录；`handleDeleteProject` 在确认后调用（失败仅 toast 不阻断索引删除）。
- P2-6：启动清理——读 projects.json 得项目路径列表，逐个 `remove_dir_all(<project>/.ai-coding/attachments)`（目录不存在则跳过；attachments 由 `coding_init_project_config` 在打开项目时重建）。挂在 event_watcher::start 同期的 setup 路径，抽成可测函数。
- P2-7（notify.rs）：新增 `truncate_debug_log()` 启动时调用——存在且非空则截断为 0（保留当次会话日志语义）。
- P3-a（session.rs）：`coding_read_session_messages` 前置 size 检查，超 `MAX_SESSION_BYTES_FOR_VIEW`（50MB，对齐 summary）返回描述性错误；前端 SessionView 已有 error 展示路径，无需改。
- P3-b（pty.rs）：shell 的 `on_finish` 闭包捕获自己注册时的 child Arc；执行时仅在 `Arc::ptr_eq` 命中当前表内 entry 才 `remove_pty_handles`。
**验收标准**：`cargo test` 全绿；删项目后目录不存在；启动清理对临时目录生效；超大 session 查看返回错误而非整读。
**测试用例**：
1. `coding_delete_project_data`：临时目录建假 project → 调用 → 目录消失；不存在时 Ok。
2. 附件清理：临时项目含 attachments/孤儿 → 清理函数 → 目录消失。
3. session 上限：临时文件 > 阈值（阈值可注入）→ Err 且不读内容。
4. shell 代次：表内同 id 换新 Arc 后，旧 on_finish 判定不删除；Arc 未变 → 删除。
**验证**：`cargo test --lib coding::` 96/96 绿（阶段 2 新增 6 个）；`npx tsc --noEmit` 干净；前端 vitest 256/256 绿。设计偏差与补充：① P2-5/P2-6/P2-7/P3-a 全部抽了「内核函数 + 薄命令壳」结构（remove_dir_if_exists / cleanup_orphan_attachments_for_paths / truncate_log_file / read_session_messages_with_limit），测试注入临时路径不触真实 `~/.ai-ssh`；② P3-b 补充了同 id 重开的真实触发场景核实：`ShellTerminalInstance` 的 init effect 依赖含 `projectPath`，切换 shell 项目路径会以同 shellId 重开（非理论场景）；③ P3-a 顺带把整读从 async fn 挪进 `spawn_blocking`（原实现直接阻塞 tokio worker，对齐 metrics 命令的既有写法）。无遗留。
**状态**：已完成

## 阶段 3：前端拖拽兜底 + 全量验证

**目标**：useProjectPanels 拖拽监听对齐域内四重兜底标准；全项目回归绿。
**设计**：
- P3-c（useProjectPanels.ts）：两处拖拽（右栏宽度、终端高度）的 document mousemove/mouseup 改 pointermove/pointerup + pointercancel + window blur 兜底 + effect cleanup 兜底；对齐 ProjectRail.tsx:203-211 现有范式。setPointerCapture 不引入（手柄 capture 与现有全局监听模式冲突，保持最小改动）。
**验收标准**：`npm run test:run` + `npm run build`（tsc）全绿；拖拽行为不变（窗口内拖拽、释放生效）。
**测试用例**：
1. 单元测试（若可行）：pointerup 在 document 派发 → 监听移除；unmount → 监听移除。
2. 手动：拖拽中拖出窗外松开 → 回到窗口后无需点击即可正常交互（无残留拖拽态）。
**验证**：新增 test/project-panels-drag.test.tsx 5 个用例（pointerup/pointercancel/blur/卸载/buttons=0 回窗各一路终止断言）全绿；全量回归：前端 vitest 261/261、`npx tsc --noEmit` 干净、Rust `cargo test --lib` 104/104。实现比设计多两处自觉加固：① 起点基值捕获（delta 是绝对偏移，加实时 ref 在同帧多次 move 会重复叠加——原实现即此语义，重构时一度引入又修回）；② `ev.buttons === 0` 回窗检测，窗外释放后指针回窗即终止，不需补一次点击。手动用例（窗外拖拽）未执行，属 jsdom 无法覆盖的 OS 级行为，接受单元级覆盖。无遗留。
**状态**：已完成
