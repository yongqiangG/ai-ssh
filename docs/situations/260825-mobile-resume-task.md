# 260825 手机伴侣·恢复已结束任务

## 原始需求（用户原话）

> 当前ai coding板块的任务对话终端，在任务标记为完成或者异常中断时，会展示会话视图，而不是终端视图，点击恢复，可以恢复成终端视图。这个是怎么实现的，这个恢复会话功能可以增加到手机端吗。核实下 grill me

grill 过程中的追加表态：

> 如果只实现恢复按钮 不需要做会话视图 只用来想要还原已经完成的任务然后继续对话
> 手机端是通过web+tailscale实现的 这个你知道吧
> 针对所有允许恢复的逻辑提供这个按钮，和桌面端的恢复按钮逻辑一致。
> （风险）我的理解是手机端点击恢复，类似于给桌面端一个点击恢复的信号，之后恢复的逻辑都是已经验证复用的。然后手机端类似刷新一下页面……所以我觉得零风险。
> 我觉得当前的实现就是手机终端打开，电脑是同步打开的状态，当前已经是这个产品逻辑。所以从直觉上来说，恢复终端跟打开终端的逻辑应该是一致的，所以电脑端应该是一个跟随打开终端的状态
> 选a 通过软打断不就可以 不需要取消任务
> （开工约束）尽量复用原有恢复终端会话链路的代码 尽量保证桌面端功能不受任何影响

## 背景（决策时事实）

- 桌面「结束→会话视图、恢复→终端视图」是纯前端 status 驱动（RunningView 四分支）；「恢复」本质 = agent CLI 原生会话续跑（Codex `resume <id>` / Claude `--resume <id>`），起全新 PTY 新进程，恢复的是对话上下文而非旧终端画面（`coding_resume_task`，pty.rs）。
- 手机伴侣已有「新建任务」全链路先例（260821 阶段 3）：axum handler → 纯数据 job 队列 → worker 线程持 AppHandle 直调 `coding_run_task`（AppHandle 链接陷阱规避）；web 发起的任务输出经 `mark_web_created` → `coding:task-output` 事件供桌面回退消费。
- 桌面状态同步链路已存在：`coding:task-status` 事件 → AiCodingApp `updateTaskStatus`，done/failed/cancelled → running 正常翻转（`shouldIgnoreTaskStatusTransition` 只拦 detached），视图随之切回终端。
- 手机打开任务终端（WS `nav=1`）→ publish `coding:navigate`（`App.tsx` 顶层常驻监听 + pendingNavigation 留货待取）——「PC 跟随打开」是既有产品逻辑。
- 手机端 Task 类型未声明 sessionId 字段（Rust REST 已返回 camelCase）；`STATUS_LABEL` 缺 interrupted。
- 用户「零风险」心智模型有一处偏差被纠正：实际执行是 Rust worker 直调而非「给桌面前端发信号」；「桌面自然而然跟着恢复」需要三件配套（`mark_web_created` 保桌面实时流、桌面 buffer 清场/remount、tasks.json 状态落盘），均有 create 先例同构物，但 resume 场景未验证过——**验收必含「恢复后桌面终端有输出」**。

## 决议

1. **范围：只做恢复按钮，不做会话视图**——尾窗快照已近似覆盖「看结论」，resume 是「人在外面让任务继续跑」的闭环刚需，Rust 侧 `coding_resume_task` 可全量复用。
2. **适用状态：done / failed / cancelled / interrupted**，与桌面恢复按钮一致；有 sessionId 才可用（与桌面 `resumeUnavailable` 同语义）。
3. **detached 一期不做**——重连语义是先杀孤儿进程再 resume，误触代价高且属全新路径；回桌面处理。
4. **桌面联动 = 跟随导航**——复用 `coding:navigate`，与「手机打开终端 PC 跟随」的产品逻辑自洽（用户决策，推翻 Claude 的静默推荐）。
5. **交互 = 横幅单击直达、无确认层**；手机端不加取消按钮——Esc 软打断即封住烧 token/动文件的主要风险（打断后 agent 等输入，进程存活无害）。
6. **执行架构 = create 先例同构**：`POST /api/tasks/{id}/resume` → 落盘翻 pending → ResumeJob 纯数据队列 → 独立 worker 直调 `coding_resume_task` → 成功后 `mark_web_created` + publish `coding:task-resumed`（桌面清 buffer + bump runCount）+ `coding:navigate`；失败回滚原状态。create 路径零改动。
7. **机械默认项**：body 带 cols/rows（手机 fit 值，PTY 初始尺寸以手机为准，WS 断开还原桌面尺寸的既有机制兜底）；端点对 active/detached 状态 409 守卫（sessionId 缺失同 409）；服务端清 tap buffer + 手机端 POST 成功 `term.reset()` 防旧尾屏与新会话画面拼接；双端同秒并发 resume 的亚秒残余窗口接受为已知边界（单用户产品）。

## 影响范围

- `ssh-client/src-tauri/src/coding/web/mod.rs`：resume 端点 / job / worker / 纯函数与测试（增量，create 路径不碰）
- `ssh-client/src-tauri/src/coding/web/stream.rs`：新增 `reset_task_stream`（清旧尾窗 + 仿真器）
- `ssh-client/src/features/aiCoding/AiCodingApp.tsx`：新增 `coding:task-resumed` 监听（增量，不动既有监听）
- `ssh-client/src/mobile/`：api.ts、resume.ts（新增纯逻辑 + 测试）、TaskView.tsx
- 已知边界登记：手机端无硬取消（Esc 软打断兜底）；双端并发 resume 亚秒窗口；dev/安装版 hook 互踩边界沿用 260825 现状。
