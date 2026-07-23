# 细节体验优化 + 思考可视化 + Confirm 卡死修复

## 原始需求（用户原话）

> 当前项目有一些细节体验问题需要优化
> 1. 终端面板右上角有一个报错提示按钮，当前我看默认是开启状态，我需要是关闭状态，由用户自己打开，另外这个按钮语义我感觉不是很清晰，是不是可以调整为自动检测错误信息。
> 2. chat面板的深度思考按钮，当前打开后，发送消息会变回关闭状态，我觉得在一个会话中状态应该不变。
> 3. chat面板的终端上下文按钮含义好像也不是很清晰，不能一眼看出用法

Grill 过程中追加：

> （深度思考）需要关注这个功能是否真的和开关状态保持完全一致，会不会开关开了实际没开，开关关了实际没关。
> （思考过程可视化）顺手做掉。
> 现在就要考虑接入deepseek模型，应该是兼容openai协议。
> 之前在chat面板如果遇到写命令，应该需要一个用户确认的动作。功能应该是开发了，可能有缺陷，实际效果是遇到写命令执行会卡住，用户也没有地方可以点击确认或者取消执行。

## 背景（决策时事实）

- `errorDetectEnabled` 旧默认开且持久化——localStorage 里的 `true` 无法区分「用户意愿」与「默认值快照」。
- 深度思考链路核实：前端每条消息显式传值 → `AiCallNode` 逐请求置位/finally 复位 `ThinkingContext` → `AiApiNode` 拦截器对 GLM 注入 `thinking.type=disabled`（关）或跳过注入（开）。已知边界（既有，非本次引入）：`ThinkingContext` 全局单例，并发对话可能串（前端 sending 锁保护，失效后果良性）；仅对 GLM 生效（非 GLM 跳过注入防 400）。
- 思考过程当前不可见：后端只累积 content，`reasoning_content` 被丢弃；前端无渲染。「开了没开」只能靠首 token 延迟感知。
- reasoning 链路核实（2026-07-23）：SpringAI 1.1.5 `ChatCompletionMessage` 已有 `reasoningContent()`，流式每 chunk 增量进 `Generation.metadata["reasoningContent"]`；MySpringAI/MessageConverter 为 vendored 反编译源码可自由改；genai `Part` 有 `thought()` 通道但 ADK session 写入/拼接会污染上下文；NDJSON 协议自定义可扩展；跨线程 `emitter.send` 有 ConfirmGate 先例。
- DeepSeek 文档核对：`reasoning_content` 字段同名同层级（读取侧天然兼容）；`thinking.type` 控制结构与 GLM 相同；思考模式下 temperature 等参数静默不生效；**工具调用轮的 reasoning_content 要求「必须回传」**，而 SpringAI 发送侧 `AssistantMessage` 无该字段。
- Confirm 卡死静态核实：与本次改动无关（确认链路一行未动），是既有缺陷。根因嫌疑：前端 `onConfirmRequest` 按 toolCallId 匹配失败且无 running 块兜底时**静默丢弃**（`targetIdx < 0 → return m`），而 `confirm_request`（工具线程直写 NDJSON）与 `tool_call`（AiCallNode 主循环）来自不同线程，confirm_request 可能先到；`functionCallId().orElse("")` 为空串时精确匹配也失效。后端 `ConfirmGate` 挂 120s 后按拒绝收场——表现即「卡住且无处可点」。

## 决议

1. **报错检测默认关，不加发现性引导**——用户要的就是不打扰、主动开启；按钮常驻标题栏可见性够用。
2. **v0 旧持久化值一律迁移重置为关**——旧值无法区分意愿与快照，当前用户面≈0，语义干净优先；v1 起用户手动值永不再被重置。
3. **文案「自动检测报错·开/关」**——比「自动检测错误信息」短且在终端语境更准确，保留「自动检测」关键语义。
4. **深度思考全局粘滞**——只听手动开关，不随发送/切会话变化；心智最简，且与「让 AI 看终端」行为一致。
5. **深度思考不持久化**——重启回默认关，作为「更慢更贵」模式的最后防护栏。
   - 5b. **思考过程可视化本次顺手做掉**——补上「开了」的正向视觉确认。
6. **终端上下文按钮改名「让 AI 看终端」**——动宾直白，与产品卖点同语言。
7. **保持默认关**——终端内容外发须显式授权（信任红线基调）；有 F1/F5 精准喂上下文兜底；改名后先观察使用率再议翻默认。
8. **可视化后端走旁路 relay**——`ReasoningRelay`（同 ThinkingContext/ConfirmGate 全局单流模式），桥接层流式回调取 metadata 增量 → AiCallNode 注册的 consumer → NDJSON `reasoning` 事件；**不进 ADK session**，避免拼接污染与聚合逻辑风险。
9. **前端流式展开 + 完成自动折叠**——思考期间实时滚动（填补首 token 慢的等待），正文到达折叠为「已深度思考 ▸」可点开。
10. **思考内容随消息持久化**——运维复盘场景思维链是证据；localStorage 量级远够。
11. **DeepSeek 接入单独立项紧接着做**——本次可视化读取侧天然兼容；回传坑降级为「实测后定」（只影响深思+工具调用组合，暴露面小；软退化 vs 硬报错未实测不能断言，Anthropic 同类机制是硬 400 的先例）。分析记入 backlog，接入第一步是实验。
12. **Confirm 卡死并入本次修复**——功能正确性缺陷优先于体验增强；修法 = 前端 fail-safe（匹配不到不丢弃，渲染孤儿确认卡保证永远有地方点）+ 真实复现定位时序后按需补后端顺序保证。

## 影响范围

- ssh-client：`chatStore`（默认值/migrate/粘滞/reasoning 字段/confirm 兜底）、`ChatInputBar`、`TerminalPanel`、`api/chat.ts`（reasoning 事件）、`MessageBubble`（思考块）。
- ssh-server：`MySpringAI`（流式回调取 reasoning）、新增 `ReasoningRelay`、`AiCallNode`（注册/清理）、`AbstractReActSupport`/`ReActEventDTO`（reasoning 事件）；confirm 时序视复现结果定。
- 后续任务：DeepSeek 接入（backlog `260723-deepseek-integration.md`）。
