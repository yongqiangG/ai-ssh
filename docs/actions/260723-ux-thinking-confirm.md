# 细节体验优化 + 思考可视化 + Confirm 卡死修复

> 背景：docs/situations/260723-ux-thinking-confirm.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 阶段 1：三个开关优化（报错检测默认关 / 深度思考粘滞 / 按钮改名）

**目标**：报错检测默认关 + v0 迁移 + 文案「自动检测报错」；深度思考全局粘滞不持久化；终端上下文改名「让 AI 看终端」；title 全部动态化。
**设计**：
- `chatStore`：`errorDetectEnabled` 默认 false；persist version 1 + migrate 删 v0 旧值；`sendMessage` 移除思考回落；`PersistedChatState` 类型统一 partialize/migrate 形状
- `TerminalPanel`/`ChatInputBar`：文案与动态 title
**验收标准**：默认关且旧数据迁移；发送后思考开关保持；三按钮文案/悬浮提示语义清晰。
**测试用例**：思考粘滞（发送后仍开 + streamChat 收到 true）；v0 迁移重置；v1 用户值保留。
**验证**：单测 72 全绿（新增 4：粘滞、streamChat 参数、v0 迁移、v1 保留）；`npm run build` 类型检查通过。真实 UI（Vite dev + 后端 + Playwright）实证：三按钮新文案与动态 title 就位；用户真实 v0 数据被迁移为 version 1 + errorDetectEnabled=false 且 3 个历史会话完好；手动开启后刷新保留（v1 意愿不被重复迁移）；开深思真实发送一条消息，回复完成后按钮仍「深度思考·开」（粘滞实证），验证后已恢复默认关。遗留：验证中发现深思模式下回复正文重复段落（nginx/TCP 两条深思回复均现，非深思回复正常）——疑似流式聚合/reasoning 混流既有缺陷，归入阶段 3 一并排查。
**状态**：已完成

## 阶段 2：Confirm 卡死修复（写命令确认无处可点）

**目标**：写命令确认卡在任何事件时序下都可见可点，杜绝「后端挂 120s 前端无卡」。
**设计**：
- 前端 fail-safe：`onConfirmRequest` 匹配不到命令块时不丢弃——按 confirm_request 自带的 command/toolCallId 直接创建孤儿命令块（pending_confirm 态）挂到当前 assistant 消息；后续 tool_call/tool_result 按 toolCallId 与之合并去重
- 真实复现：连终端诱导写命令，观察 NDJSON 事件到达顺序，确认竞态假设；视结果决定是否需后端顺序保证
**验收标准**：复现场景下确认卡必然出现，允许/拒绝均正常闭环。
**测试用例**：confirm_request 先于 tool_call 到达（单测模拟乱序）；toolCallId 为空串；正常顺序不回归。
**验证**：
**状态**：未开始

## 阶段 3：思考过程可视化（reasoning 流式透传 + 折叠渲染）

**目标**：深度思考开启时思维链实时可见，完成后折叠可回看，随消息持久化。
**设计**：
- 后端：新增 `ReasoningRelay`（全局单流 consumer，同 ThinkingContext 模式）；`MySpringAI.generateStreamingContent` subscribe 回调从 `Generation.metadata["reasoningContent"]` 取增量非空则 emit；`AiCallNode` 注册 consumer→`sendReasoningEvent`，finally 清理；`AbstractReActSupport`+`ReActEventDTO` 加 `reasoning` 事件（复用 content=增量/fullText=累计）
- reasoning 不进 ADK session（决议 8，旁路直发 NDJSON）
- 前端：`api/chat.ts` 加 `reasoning` 事件与 `onReasoning`；`ChatMessage.reasoning` 字段（随会话持久化）；`MessageBubble` 思考块——流式期间展开实时滚动，正文首字到达自动折叠「已深度思考 ▸」
**验收标准**：GLM 开深思真实对话可见思维链流式滚动、正文出现后折叠、点开回看、刷新后仍在；不开深思零变化。
**测试用例**：reasoning 事件累积到消息；无 reasoning 消息不渲染思考块；折叠态切换。
**验证**：
**状态**：未开始
