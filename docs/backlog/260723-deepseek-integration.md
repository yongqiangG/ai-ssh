# DeepSeek 模型接入

> 来源：docs/situations/260723-ux-thinking-confirm.md 决议 11

接入 DeepSeek（OpenAI 协议兼容）作为可选模型。2026-07-23 grill 核实的关键情报：

## 已核实的兼容性

- **reasoning_content**：字段名/层级与 GLM 一致（`delta.reasoning_content`），思考可视化的 relay 链路（SpringAI `Generation.metadata["reasoningContent"]` → `ReasoningRelay` → NDJSON）**天然兼容，零返工**。
- **thinking 控制**：请求体 `thinking: {type: "enabled"|"disabled"}` 结构与 GLM 相同 → `AiApiNode.buildDisableThinkingInterceptor` 的 `isGlm` 判断扩为 `isGlm || isDeepseek` 即可。
- **参数注意**：思考模式下 temperature/top_p/presence_penalty/frequency_penalty 静默不生效（不报错）。

## 关键坑：工具调用轮 reasoning_content 回传

DeepSeek 文档要求：两个 user 消息之间若有工具调用，中间 assistant 的 reasoning_content 在**后续所有轮次必须回传**。而 SpringAI 发送侧 `AssistantMessage` 无该字段，桥接层 `handleAssistantContent` 构建的消息不可能携带。

**影响面**：仅「深度思考开启 + 工具调用」组合（深思默认关，暴露面小）；不开深思无 reasoning 无此事；深思+纯问答官方明说不需要回传。

**接入第一步是实验而非写代码**：拿真实 API 测「thinking + 工具调用 + 不回传」——
- 软退化（不报错但多轮思维链失忆、工具决策变差）→ 可先接受，观察后定；
- 硬报错（Anthropic interleaved thinking 同类机制是强制 400 的先例）→ 需实现回传：候选 = `ReasoningRelay` 按轮次缓存 + `AiApiNode` 请求拦截器把 reasoning_content 按消息位置回填进请求体（拦截器改写 body 有 thinking 注入先例）；或该组合下降级（禁思考+提示）。

## 其余接入工作

- LlmConfig/模型设置支持 DeepSeek base-url + model（配置层现状待核）。
- 深度思考开关目前「仅 GLM 生效」的边界随拦截器扩展消除。
