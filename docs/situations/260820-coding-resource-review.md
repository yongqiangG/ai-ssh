# AI Coding 板块资源评审（内存/存储/性能）

## 原始需求

> 整体评审一下当前的ai coding板块的设计，有没有内存泄漏，或者随着任务的增加存储空间占用上涨，或者可能导致性能下降的问题。核实后如有需要调整 grillme

（后续 grill 中用户对 P1-2/P1-3/P1-4 逐项要求先完整讲解再决策，并补充开工约束：）

> 可以开工 注意所有的修复需要建立在充分的代码核实之上，确认不会对现有功能造成破坏

## 背景

- 三路并行扫查（前端清理纪律 / Rust 泄漏 / 存储与轮询）+ 主会话对每条重量级发现逐行亲核。前端无典型泄漏（无悬挂 listener/timer/observer/Tauri 订阅）；Rust 主干健康（有界通道+反压、offset 增量读、集中式 event_watcher、finalize 正常路径全链清理）；存储核心正确（不拷贝 transcript、PTY 不落盘、localStorage 全小标量）。
- 评审中撤销 1 条误报：cancel 路径漏删 events 目录——核实 `coding_cancel_task`（pty.rs:1070）在命令内部已直接清理，finalize 提前 return 是安全的。
- 机器现状：`~/.ai-ssh/coding/` 共 162K，尚无实际膨胀，属前瞻性修复。
- 本机同时开着 tauri dev（见记忆 no-checkout-under-running-dev），全程不动工作区 git 状态基线。

## 决议

| # | 问题（核实位置） | 结论 |
|---|---|---|
| P1-1 | PTY reader `leftover` 毒字节永久卡死+无界增长（pty.rs:347,400-429；本地 shell `cat` 二进制必触发） | 修：`valid_len==0` 且积压超 UTF-8 阈值时丢头部坏字节继续转发——三处会话共享同一条 reader 路径，一处中毒全中 |
| P1-2 | metrics 每 3s 全文件重解析（RunningView.tsx:300 + analytics.rs:180-225；活跃 session mtime 恒变→缓存恒 miss→O(N²)） | 修：缓存改 offset 增量（Claude 累加器 / Codex 读尾部），对齐 event_watcher 范式——根治且顺带解决 METRICS_CACHE 无淘汰 |
| P1-3 | register/finalize 竞态→watch 线程被自己插入的 session entry 自锁永活（session.rs:1265-1320 + pty.rs:64-72） | 修：watch 循环加 `child_handles` 死亡信号兜底退出（持续 N 秒退出，退出时若 entry 是自己那代则摘除）——不拖慢正常路径 |
| P1-4 | `coding_reset_task_process` 漏清 codex/claude_sessions、claimed_session_paths、LAST_STATUS、events 目录（pty.rs:1128-1152；唯一没对齐 finalize 的杀进程路径，兼两个功能边角） | 修：补全四项清理，对齐 finalize——三条同语义路径一条没对齐，非权衡问题 |
| P2-5 | 删项目只删 projects.json 索引，`projects/<pid>/` 目录永久残留（AiCodingApp.tsx:1031-1054） | 修：删项目时同步删目录——目录内容随索引删除即失效，agent jsonl 在 `~/.claude` 原位不受影响 |
| P2-6 | 崩溃孤儿附件无启动清理（event_watcher.rs:71-75 只清 events；`<project>/.ai-coding/attachments/<taskId>/` 永久残留） | 修：启动时清空各项目 attachments/——与 events 启动清理同语义，启动期无任务在跑全删安全 |
| P2-7 | notify-debug.log 无轮转无上限（notify.rs:87-104） | 修：启动时截断——它是当次排障现场用的（Win10 toast 排障先例），保留当次会话足够 |
| P3-a | `coding_read_session_messages` 无大小上限（session.rs:645；同文件 summary 限 50MB、导出限 200MB，唯独查看器不限） | 修：对齐限值模式超限拒绝——漏配防线，补齐即回归一致 |
| P3-b | shell 重开竞态：旧 reader 的 `on_finish` 不认代次，错删新 shell 的 PTY 表项→新 shell 秒死（pty.rs:1519-1538） | 修：`on_finish` 比对句柄代次——功能 bug 顺手修 |
| P3-c | useProjectPanels 拖拽 document mousemove/mouseup 无 unmount/窗外释放兜底（hooks/useProjectPanels.ts:129-150） | 修：补 pointerup+pointercancel+blur+unmount 四重兜底——对齐域内 ProjectRail/FileExplorer 标准 |

**明确不动（记录在案）：**
- 多项目保活 = 每项目 1 xterm + 1 WebGL context 线性增长：有意设计，WebGL 上限触发时有 DOM renderer 降级兜底（terminalShared.ts:794-798）。
- tasks.json 含完整 prompt + 状态变更全量重写：有「删任务」用户出口不算无界，写放大可接受。
- fire-and-forget 2s timer（React 19 无害）、ProjectRail 两 Map 微小残留、attention banners overflow 条目（前面的过期后浮上来获得定时器，平时自愈）、codex_rpc 空闲期无界 mpsc（实际低风险）。

## 影响范围

- Rust：`src-tauri/src/coding/{pty,analytics,session,storage,notify,mod}.rs`（新增启动清理挂点）。
- 前端：`src/features/aiCoding/AiCodingApp.tsx`（删项目调用）、`src/features/aiCoding/hooks/useProjectPanels.ts`。
- 不触碰：SSH 运维链路、三条信任红线、agent hook 注入机制、保活/终端架构。
- 行动档：`docs/actions/260820-coding-resource-fixes.md`。
