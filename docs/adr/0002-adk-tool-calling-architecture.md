# ADR 0002：Agent 工具调用架构（ADK 亲自编排 + vendored 桥接）

> 2026-07-13 grill 会话定稿（Q1-Q13），已落地。原实现级设计文档（TOOL-CALLING-DESIGN.md）随实现完成退役，本 ADR 保留其中长期有效的架构决策与维护约定；实现细节以代码为准。

## 背景

在「AI 面板 + 流式对话」闭环之上引入 Tool 调用：基于 Google ADK（1.2.0）+ Spring AI（1.1.5）桥接 OpenAI 兼容端点（GLM 等），让模型多轮「执行命令 → 观察结果 → 继续推理」。

## 决策

### 1. 工具走独立 exec 通道，不碰用户终端

`ISshSessionPort.exec(connectionId, command, timeoutMs)` 在同一 SSH 连接上开一次性 JSch `ChannelExec`：干净的 stdout/stderr 分流 + 真实退出码。**否掉**共用终端 shell 通道的方案——终端输出走「后台缓冲 + 前端轮询取走即清空」，工具抢缓冲会与前端竞争，且交互式 shell 拿不到退出码。

### 2. ADK 亲自编排工具循环（关键取舍）

官方 `google-adk-spring-ai` 桥接默认让 Spring AI 内部执行工具，导致 ADK 事件流 `functionCalls()` 为空、插件回调全哑。选择关闭内部执行、由 ADK 原生 flow 编排，代价是 **vendor 整套桥接**（`domain/agent/bridge/springai/`，类名 `MySpringAI`），改动两处：

1. `MessageConverter.toLlmPrompt`：`internalToolExecutionEnabled(false)`；
2. `MessageConverter.handleUserContent`：补上官方缺失的 functionResponse → `ToolResponseMessage`（role=tool）转换——严格的 OpenAI 兼容端点（GLM）要求 assistant.tool_calls 后必须跟 role=tool 消息，否则 400。

**维护约定**：升级 google-adk / google-adk-spring-ai 版本时，必须人工比对官方新版与 vendored 副本，同步以上两个改动点（vendored 文件类头有标注）。

### 3. 装配走 armory 责任树 + 容器动态注册

`ArmoryRootNode → AiApiNode → ChatModelNode → AgentNode → AgentWorkflowNode → RunnerNode`，产物包成 `AiAgentRegisterVO` 经 `beanFactory.registerSingleton("aiAgentRunner_<agentId>", vo)` 注册；消费方经 `AgentRunnerRegistry` 门面查询（bean 命名约定只存在这一处）。

⚠️ `registerSingleton` 在 refresh 后不走 Bean 生命周期（无代理/无 @PostConstruct/无注入）——VO 只允许放纯数据。

single 模式下 `DefaultArmoryFactory.applySingleLlmConfig` 用 DB 里的 LlmConfig 覆盖 `ssh-agent.yml` 的端点配置；保存模型设置后 `AgentRunnerRegistry.rebuild()` 热重建。

### 4. 三层超时与熔断预算

| 层 | 值 | 管什么 |
|---|---|---|
| 单命令 exec 超时 | 30s（stdout/stderr 各截断 8KB） | 交互式命令不挂死，模型看到 `timedOut` 自我纠正 |
| `RunConfig.maxLlmCalls` | 10 | ADK 循环不失控 |
| emitter 总超时 | 10 分钟 | 整条 NDJSON 流硬上限 |

### 5. 工具永不抛异常（ReAct 哲学）

一切失败（黑名单拦截/未绑定终端/连接断开/超时）返回 `success:false` 错误 Map（可附 `analysis` 规则建议），让模型把失败当观察结果转述给用户。

### 6. 危险命令黑名单的定位

工具内置约 8 条正则（rm -rf 打根/mkfs/dd 写设备/关机重启/fork 炸弹等），命中即不执行。**它挡的是模型手滑，不是恶意**；「写操作需用户确认」是另一套独立机制（已随迭代 B1 交付：ConfirmGate 确认门，决议见 `docs/situations/260721-three-iterations.md` Q9），挂载点已备好——ADK Plugin 的 `beforeToolCallback` 返回非空 Map 即可跳过工具执行。

### 7. NDJSON 事件协议

`POST /api/v1/chat_stream` 每行一个 `ReActEventDTO`：`text / tool_call / tool_result / round_end / done / error`（非 SSE，前端 fetch + ReadableStream 按行解析）。终端绑定是请求级的：前端每次携带活跃终端 `terminalSessionId`，后端按 ADK sessionId 注册表传递给工具（初版 InheritableThreadLocal 方案在联调中确认池化线程串值风险后改为注册表）。

## 已知约束

- 根 pom 的 compiler 插件无 `-parameters`：工具方法参数必须显式 `@Annotations.Schema(name = "...")`。
- `ssh-agent.yml` 仅 dev/single 挂载；配置为空时 armory 跳过装配，不得影响启动。
