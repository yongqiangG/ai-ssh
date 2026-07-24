# 260724-llm-error-humanize：LLM 调用失败的友好提示与手动重试

## 原始需求（用户原话）

> 有时候可能是由于 ai 回复的调用 llm 失败，会出现类似的回复
> 调用失败：Unknown error: WebClientRequestException - EOF reached while reading
> 给出一个优化方案，可以有更友好的提示
> （方案确认）都做，但是尽量完整考虑再动手，控制改动范围，不要影响到当前已经测试通过的正常功能。

## 背景（决策时事实）

- 错误链路：vendored `SpringAIErrorMapper` 已做分类（AUTH/RATE_LIMITED/NETWORK/…）但输出英文技术串，且 `EOF reached`/`WebClientRequestException` 不匹配任何关键词漏进 UNKNOWN 兜底；`AiCallNode` 将 `e.getMessage()` 原样发 error 事件，前端加「调用失败：」前缀直出。
- `ReActEventDTO.code` 通道已存在（AI_SESSION_EXPIRED 铺路）；前端 onError 已收 code。
- `sendMessage` 是 90+ 用例覆盖的主路径，重构风险高。

## 决议

1. **后端人话化（P1）**——domain 新建 `LlmErrorHumanizer`（AiCallNode 同包、包私有），不信任 vendored mapper 前缀，自己遍历 cause 链（≤8 层）按类型/关键词分类 → 机器码 + 中文指引：CONNECTION_LOST（含 EOF/reset/WebClientRequestException）/ AUTH_FAILED / RATE_LIMITED / TIMEOUT / BAD_CONFIG / SERVER_ERROR / UNKNOWN。原始异常串只进后端日志不进 UI——用户拿着技术串做不了任何事，指引动作（重试/查设置）才有价值。
2. **接入点最小**——只改 AiCallNode 非 sessionExpired 错误分支（AI_SESSION_EXPIRED 路径、`completeWithError` 语义均不动）。
3. **错误不占用 content**——`ChatMessage` 加 `errorText`/`errorCode`（errorText 存在即失败态），流中途断掉的半截回复保留展示，错误条独立渲染在气泡底部；`??` 幂等保证流断的第二次 onError 不覆盖首个错误。旧持久化消息无字段天然兼容。
4. **前端 fetch 层兜底**——code 缺失（连不上后端/HTTP 状态错）时 `humanizeClientError` 翻译常见浏览器错误，未识别原样透传。
5. **手动重试（P2）**——错误条对可重试 code（CONNECTION_LOST/TIMEOUT/RATE_LIMITED/SERVER_ERROR/UNKNOWN/无 code）且非历史会话显示「重试」按钮；AUTH/BAD_CONFIG 只给指引（该去改设置），AI_SESSION_EXPIRED 不重试（会话已归档）。手动触发不违反「不自动重发」决议。
6. **重试实现选最小侵入**——`retryMessage` = 删除失败消息对 + 复原引用块（quote 文本恢复，source 统一按 selection）+ 走标准 `sendMessage` 全流程；**主发送路径零改动**。接受的语义差异：重试时终端上下文按当前 F3 开关重取，不复刻失败时快照。
7. **【2026-07-24 评审收紧】仅末条消息可重试**——中间轮次重发会把消息对挪到末尾，阅读顺序与后端 session 上下文顺序都被打乱；且消掉「重试误消费当前待发引用块」的大部分场景。旧失败留错误条做记录。错误条追加高度纳入自动滚动触发（errorText 进 deps），避免露一半在视野外。

## 影响范围

- ssh-server：新增 `react/node/LlmErrorHumanizer.java`（+8 例单测）；`AiCallNode` 错误分支 ~5 行。
- ssh-client：`types`（ChatMessage 2 字段）、新增 `utils/llmError.ts`（可重试判定+兜底翻译，+6 例）、`chatStore`（failMsg 增强 + retryMessage，+3 例）、`MessageBubble`（ErrorBar 组件）+ CSS。
