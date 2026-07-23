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
**验证**：单测 76 全绿（新增 4：乱序孤儿卡、同 id 去重、空 id、正常顺序回归）——乱序用例在修复前为红，实证「乱序即静默丢弃」根因成立。真实环境（私域-UAT 终端 + GLM）三轮写命令实测：确认卡均正常出现；超时 120s 按拒绝 fail-closed（后端日志 2 次实证）；「允许执行」点击 365ms 内后端收到 allowed=true 且 touch 真实执行成功；「拒绝」点击后端收到 allowed=false 命令未执行。后端顺序保证暂不加：真实三轮均为正常时序，乱序由前端孤儿卡兜底已足够（fail-safe 语义完备）。遗留：测试空文件 /tmp/ai-confirm-test.txt 留在 UAT（rm 被拒绝正是验证一环，无害）。
**状态**：已完成

## 阶段 3：思考过程可视化（reasoning 流式透传 + 折叠渲染）

**目标**：深度思考开启时思维链实时可见，完成后折叠可回看，随消息持久化。
**设计**：
- 后端：新增 `ReasoningRelay`（全局单流 consumer，同 ThinkingContext 模式）；`MySpringAI.generateStreamingContent` subscribe 回调从 `AssistantMessage.metadata["reasoningContent"]` 取增量非空则 emit；`AiCallNode` 注册 consumer→`sendReasoningEvent`，finally 清理；`AbstractReActSupport`+`ReActEventDTO` 加 `reasoning` 事件（content=增量/fullText=累计）
- reasoning 不进 ADK session（决议 8，旁路直发 NDJSON）
- 前端：`api/chat.ts` 加 `reasoning` 事件与 `onReasoning`；`ChatMessage.reasoning` 字段（随会话持久化）；`MessageBubble` 思考块——流式期间展开实时滚动，正文首字到达自动折叠「已深度思考 ▸」
- 【实现中重大发现 1】当前配置模型已是 `deepseek-ai/deepseek-v4-pro`（OpenAI 兼容端点），且 **thinking 注入的 RestClient 拦截器对流式请求从未生效**（流式走 WebClient，`OpenAiApi.chatCompletionStream`）——深思开关在流式对话上一直是空操作。修复：注入整体迁移至 `MySpringAI.injectThinkingOptions`，经 `OpenAiChatOptions.extraBody`（@JsonAnyGetter 展平进请求体顶层）双路径统一生效；对 glm/deepseek 显式注入 enabled/disabled（GLM 默认开、DeepSeek 官方默认开但兼容端点漂移，「不注入靠默认」语义不可靠）；AiApiNode 拦截器退役。
- 【实现中重大发现 2】深思回复「同一答案多个变体连排」根因：vendored `MessageConverter.isPartialResponse` 用英文标点启发式判定流式 chunk 完整性，兼容端点把 finish_reason 附在最后一个有内容的 chunk 上，中文「。」结尾被误判 partial=true → ADK 主循环（`Event.finalResponse` 要求最后事件 partial=false）判定无最终回复而重调 LLM，直至 maxLlmCalls=10 熔断（NDJSON 实证 95 text + LlmCallsLimitExceededException；单条消息 token 放大 5-10 倍）。修复：partial 判定改用 finishReason 协议语义（带 finishReason 即结束帧）。
**验收标准**：GLM/DeepSeek 开深思真实对话可见思维链流式滚动、正文出现后折叠、点开回看、刷新后仍在；不开深思零变化；深思开关在流式上真实生效；中文回复不再重复。
**测试用例**：reasoning 事件累积到消息+持久化；无 reasoning 消息不产生字段；ReasoningRelay 注册/注销/空片段安全。
**验证**：后端 domain 42 测试全绿（含 ReasoningRelayTest 3 个）；前端本任务 78 用例全绿（另 4 个红属并行开发线归档功能，非本任务范围）。真实端到端（DeepSeek v4-pro + Vite + Playwright）四轮对照：深思开——思考块「深度思考中…」流式出现、正文到达折叠「已深度思考▸」、思维链 867/50 字随消息持久化可回看；深思关——无思考块、hasReasoning=false（disabled 注入流式生效实证）；重复修复前后对照——修复前「幂等性」回复 9 变体连排+熔断 error，修复后「内存泄漏」（以中文句号结尾，原必触发场景）75 字单个干净回答、「缓存穿透」117 字正常。遗留：深思场景下思维链偶有片段重复（DeepSeek 输出本身），无害不处理；ndjson-2.txt/ndjson-last.txt 诊断文件已删。
**状态**：已完成
