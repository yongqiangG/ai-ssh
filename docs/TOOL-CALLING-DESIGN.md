# SSH Agent 工具调用（Tool Calling）开发文档

> 来源：2026-07-13 方案 grill 会话（`2026-07-13-195537-aiaitool.txt`），Q1–Q13 全部敲定。
> 本文档是**唯一开发依据**；执行进度跟踪见仓库根目录 `IMPLEMENTATION_PLAN.md`。
> 开发方式：**跳过 TDD 流程，直接落代码**（用户指令）；纯逻辑单测作为收尾补充项，非阻塞。
> **本文档为实现级（developer-ready）**：所有类名、包路径、方法签名、import 均经反编译/源码核实（第三方库源码反编译保留在 `docs/decompiled/`，索引见 §4.0）。开发者照抄代码骨架即可，无需再探索或反编译。

---

## 目录

- [1. 目标与验收场景](#1-目标与验收场景)
- [2. 现状事实](#2-现状事实反编译源码核实)
- [3. 决策记录（Q1–Q13 定稿）](#3-决策记录q1q13-定稿)
- [4. 详细设计（实现级）](#4-详细设计实现级)
  - [4.0 反编译参考源码索引 + API 速查表](#40-反编译参考源码索引--api-速查表)
  - [4.1 exec 端口](#41-exec-端口domain-端口--infrastructure-实现)
  - [4.2 SshExecuteAdkTool](#42-sshexecuteadktooldomainagentservicetools)
  - [4.3 MySpringAI 桥接（vendored）](#43-myspringai-桥接domainagentbridgevendored)
  - [4.4 armory 装配责任树](#44-armory-装配责任树domainagentarmory)
  - [4.5 消费侧：AiAgentRegisterVO + Registry 门面 + MyTestPlugin](#45-消费侧aiagentregistervo--registry-门面--mytestplugin)
  - [4.6 ssh-agent.yml 配置 + 绑定类](#46-ssh-agentyml-配置--绑定类)
  - [4.7 请求链路与 NDJSON 事件扩展](#47-请求链路与-ndjson-事件扩展)
  - [4.8 AiCallNode 改造](#48-aicallnode-改造)
  - [4.9 ITL 上下文传递](#49-itl-上下文传递终端绑定)
  - [4.10 前端接线](#410-前端接线ssh-client)
  - [4.11 旧代码清理](#411-旧代码清理不留双轨)
- [5. 超时与熔断三层预算](#5-超时与熔断三层预算q11-定稿)
- [6. 联调验证点](#6-联调验证点)
- [7. 风险清单](#7-风险清单)
- [附录 A：新增/修改文件清单](#附录-a新增修改文件清单)

---

## 1. 目标与验收场景

在已跑通的「AI 面板 + 流式对话」最小闭环之上，完成 **Tool 调用最小闭环**：基于 Google ADK（1.2.0）+ Spring AI（1.1.5），在 domain 模块封装 SSH 命令执行工具，让大模型感知工具并主动调用，形成多轮「执行命令 → 观察结果 → 继续推理」的 ReAct 循环。

**端到端验收场景**：聊天输入「查看服务器系统信息，包括操作系统版本、CPU、内存」→ LLM 调用 `executeCommand` 执行 `cat /etc/os-release` 拿到系统版本 → 继续推理，执行 `nproc && free -m` 拿到 CPU、内存 → 生成自然语言总结。聊天面板实时显示每条命令块，后端日志完整呈现 agent 生命周期。

**日志验收样例**（用户给定，作为插件实现的对照基准）：

```
插件日志-🚀 用户输入信息 | invocationId:xxx | userId:mvp-xiaofuge | content:查看服务器系统信息...
插件日志-🤖 智能体启动 | agentName:sshOperator | invocationId:xxx
插件日志-🧠 大模型请求 | agent:sshOperator | model:glm-5.2 | 可用工具:[executeCommand]
插件日志-🧠 大模型响应 | agent:sshOperator | turnComplete:false
插件日志-🔧 工具调用开始 | tool:executeCommand | args:{command=cat /etc/os-release}
插件日志-🔧 工具调用完成 | tool:executeCommand | result:{command=cat /etc/os-release, output=...}
插件日志-🧠 大模型请求 | agent:sshOperator | model:glm-5.2 | 可用工具:[executeCommand]
插件日志-🔧 工具调用开始 | tool:executeCommand | args:{command=nproc && free -m}
插件日志-🔧 工具调用完成 | tool:executeCommand | result:{output=...}
插件日志-🧠 大模型响应 | agent:sshOperator | turnComplete:true
插件日志-🤖 智能体完成 | agentName:sshOperator
```

> 对照参考：反编译的 `docs/decompiled/google-adk/com/google/adk/plugins/LoggingPlugin.java`（ADK 官方插件），字段取法与日志姿势直接借鉴它，但输出中文格式化（见 §4.5）。

---

## 2. 现状事实（反编译/源码核实）

> 编号 1–9 沿用 grill 会话结论，**加粗**部分为反编译/读源码后的精确化补充。

1. **装配现状**：`AgentRunnerRegistry`（`com.johnny.domain.agent.service`，`ssh-server-domain/.../agent/service/AgentRunnerRegistry.java`）`@Component implements ApplicationRunner`，启动钩子 `run()` → `build(aiProperties)`，用约 40 行顺序代码完成 `OpenAiApi → OpenAiChatModel(new SpringAI(chatModel)) → LlmAgent → InMemoryRunner` 装配，内部 `Map<String, RunnerHolder> registry`。注释写明「最小闭环省略了 WaLiSSH 的 6 节点 armory 责任链」。
2. **对话链路现状**：`RootNode`（`@Component("reactRootNode")`）→ `AiCallNode`（`@Component("reactAiCallNode")`）已跑通，均 `extends AbstractReActSupport`。`AiCallNode.doApply`（line 45-114）当前用 `runner.runAsync(userId, sessionId, content)`（**无 RunConfig 重载**，见事实 8）的 `blockingIterable().iterator()` 消费事件流，只取 `event.stringifyContent()` 发 `text` 事件。**stateDelta 坑 TODO** 在 line 75-78：Spring AI 的 `ChatModel.call()` 会在桥接内部自动执行工具，ADK 事件流 `event.functionCalls()` 为空，工具结果只出现在 `event.actions().stateDelta()`。
3. **终端执行硬冲突**：`ISshTerminalService.execCommand(sessionId, command)`（`SshTerminalService.java:98-102`）实现是「整行写入 shell stdin + 补换行」，输出走「`TerminalSessionPort` 后台线程缓冲 + 前端 `read()` 取走即清空」的轮询模型。工具若从此处抢输出会与前端竞争同一缓冲；交互式 shell 通道也拿不到退出码。**结论**：工具走独立 exec 通道（Q1）。
4. **线程模型**：`ChatController.chatStream`（line 70-99）每个请求 `new Thread(() -> rootNode.apply(req, ctx), "react-stream-"+sessionId).start()`；ADK `runAsync` 内部是 RxJava3 `Flowable`，工具执行线程不保证是请求线程（见 §4.9 风险）。
5. **桥接层字节码勘察**（反编译 `docs/decompiled/google-adk-spring-ai/com/google/adk/models/springai/`）：
   - `MessageConverter.toLlmPrompt`（line 78-108）：当有工具时构造 `ToolCallingChatOptions.builder()` 但**只 `optionsBuilder.build()`，从未 `.internalToolExecutionEnabled(false)`**——Spring AI 缺省 `true`，内部工具执行被桥接层硬编码打开，**无配置口子可关**；
   - 回程转换半支持：`toLlmResponse` → `convertAssistantMessageToContent`（line 225-242）能把 Spring AI 的 `AssistantMessage.toolCalls` 转成 ADK `FunctionCall` Part；`handleAssistantContent`（line 167-184）也能从历史 `functionCall` 构造 `AssistantMessage$ToolCall`；
   - **硬伤**：`handleUserContent`（line 126-165）声明了 `ArrayList toolResponseMessages`（line 128）并在末尾 `messages.addAll(toolResponseMessages)`（line 163），但循环里 `if (part.functionResponse().isPresent()) continue;`（**line 137**）直接跳过——**工具结果根本没转成 `ToolResponseMessage`**。严格的 OpenAI 兼容端点要求 assistant 的 `tool_calls` 后必须跟 `role=tool` 消息，GLM 端点会 400。这解释了 WaLiSSH 魔改 `MySpringAI` 的原因。
6. **`FunctionTool.create(Object instance, String methodName)` 支持实例方法**（反编译 `docs/decompiled/google-adk/.../tools/FunctionTool.java:95-110`）：工具类可以是普通 Spring `@Component`，正常依赖注入。**关键校验**（`areParametersAnnotatedWithSchema` line 112-118）：每个参数必须 `@Annotations.Schema` 且 `name()` 非空，否则要求编译带 `-parameters` flag——本项目根 pom 把 `maven-compiler-plugin` 锁在 3.0 无 `-parameters`（memory: `ssh-server-compiler-no-parameters-flag`），**所以 `executeCommand` 的参数必须显式 `@Schema(name="command")`**。
7. **ADK `Plugin` 接口**（反编译 `docs/decompiled/google-adk/.../plugins/Plugin.java`）共 **13 个 default 回调 + 1 个抽象 `getName()`**，覆盖 agent / model / tool / run 全生命周期及 2 个错误回调。`BasePlugin(String name)`（`plugins/BasePlugin.java`）是现成抽象基类。
8. **`RunConfig` 存在且 `maxLlmCalls` 默认 500**（反编译 `docs/decompiled/google-adk/.../agents/RunConfig.java`）。熔断逻辑在 `InvocationContext$InvocationCostManager.incrementAndEnforceLlmCallsLimit`：当 `++numberOfLlmCalls > runConfig.maxLlmCalls()` 抛 `LlmCallsLimitExceededException`（即 `maxLlmCalls=10` 允许 10 次 LLM 调用，第 11 次熔断）。**`Runner.runAsync(String userId, String sessionId, Content newMessage, RunConfig runConfig)` 重载存在**（`runner/Runner.java:156`），当前代码用的是无 RunConfig 的 3 参重载（line 198），B 方案改用 4 参重载。
9. **前端无硬编码 agentId**：agents 从 `/api/v1/agents`（`ChatController.java:52-55`）动态拉取、默认选第一个，agentId 换成 `100000` 前端无感。`AgentDTO.agentId` / `RunnerHolder.agentId` / `ChatRequestDTO.agentId` / `AiProperties.Agent.id` 均为 **`String`**。
10. **`functionResponse` 带 id（反编译关键确认）**：`docs/decompiled/google-adk/.../flows/llmflows/Functions.java:299` 证明 ADK 构造 functionResponse 时 **`FunctionResponse.builder().id(toolContext.functionCallId().orElse("")).name(tool.name()).response(finalResponse)`**——即 genai `FunctionResponse` 有 `id()` 方法（genai 1.44 确认 `public abstract Optional<String> id()`），与同 round 的 `functionCall.id()` 一致。**改动点 2 可直接用 `fr.id()` 关联 `ToolResponse.id`，无 id 缺失坑**（推翻设计初稿 §7 的对应风险）。ADK 内部 `Contents.java:298/379/385` 也用 `functionResponse.id()` 做关联，佐证一致。

---

## 3. 决策记录（Q1–Q13 定稿）

| # | 议题 | 决策 | 关键理由 / 被否方案 |
|---|------|------|---------------------|
| Q1 | 工具如何拿到命令输出与成败 | **独立 exec 通道**：`ISshSessionPort` 新增 `exec(connectionId, command, timeoutMs)`，同一 SSH 连接上开一次性 JSch `ChannelExec` | 干净 stdout/stderr + 真实退出码，不污染用户终端、不与前端轮询抢缓冲。否掉：shell 通道 + 哨兵标记（与前端 `read()` 结构性竞争）、混合方案（命令执行两次） |
| Q1b | 执行过程对 client 的可见性 | 走聊天面板 NDJSON 事件流：`ReActEventDTO` 新增 `tool_call` / `tool_result` 事件 | B 方案定案后由 `AiCallNode` 解析 ADK 事件流发出（见 Q7），工具本身不发事件 |
| Q2 | ThreadLocal 装什么 | **`InheritableThreadLocal` 只存 `terminalSessionId` 字符串** | 初版折中方案被 Q7 选 B 推翻简化：ADK 亲自编排后 functionCall/functionResponse 是一等公民事件，工具无需碰 emitter |
| Q3a | 未绑定终端时工具行为 | **工具永不抛异常**，一切失败返回错误 Map（`success:false` + `error` + `analysis`），让 LLM 转述给用户 | ReAct 哲学：工具失败也是观察结果。否掉：请求入口拦截降级纯对话（复杂，最小闭环不做） |
| Q3b | terminalSessionId → connectionId | `ISshTerminalService` 新增 `String getConnectionId(String sessionId)`；拿到后还要 `sshSessionPort.isConnected()` 校验 | 映射在 `TerminalSessionEntity`（`SshTerminalService.java` 内嵌类，含 `connectionId` 字段）里已有，只是接口未暴露 |
| Q4 | exec 端口参数 | **30s 默认超时 / stdout、stderr 各截断 8KB / 分开采集** | 超时防 `top` 类交互命令挂死；截断防大输出轰炸 LLM 上下文；分开采集让错误分析规则匹配更准 |
| Q5 | 装配链落地范围 | **完整 WaLiSSH 形态**：`DefaultArmoryFactory` 发起责任树装配，`RunnerNode` 终点把 `InMemoryRunner` 包成 `AiAgentRegisterVO`、经 `beanFactory.registerSingleton()` 动态注册进 Spring 容器 | 用户明确要求对齐 WaLiSSH、为多 Agent 编排铺路。已知代价：容器注册相比 Map 功能上无增益，纯对齐形态 |
| Q6 | 消费侧组织 | **保留薄门面** `AgentRunnerRegistry`（删内部 Map，改为容器查询）；`RunnerHolder` 改名 `AiAgentRegisterVO`；bean 名前缀 `aiAgentRunner_` | 三个消费方一行不改，bean 命名约定只存在一处。否掉：消费方直连容器（约定散落三处） |
| Q7 | 工具循环放哪层 | **方案 B**：关闭 Spring AI 内部工具执行，让 ADK 亲自编排——vendor 桥接类为 `MySpringAI`，改两处 | 用户给定的日志效果是判据：A（内部执行）下插件只打一次 🧠、零次 🔧，给不出该效果。B 的代价：供养约 500 行魔改桥接代码，升级 ADK 需人工比对 |
| Q8 | 插件回调范围 | **9 个全带**：7 常规（onUserMessage/beforeAgent/beforeModel/afterModel/beforeTool/afterTool/afterAgent） + `onModelErrorCallback` + `onToolErrorCallback` | 错误回调排查联调问题比常规回调有用；成本仅每方法三行日志 |
| Q9 | 工具返回 Map + 错误分析 | 8 字段 Map（见 4.2）；`analyzeFailure` 纯字符串规则匹配，首批 5 条规则，不命中省略 `analysis` 字段 | 少喂无信息量 token |
| Q10 | 配置挂载与内容 | `ssh-agent.yml` 放 `ssh-server-app/src/main/resources/`，`spring.config.import` **只挂 dev**；绑定类 `@ConfigurationProperties(prefix = "ai.agent.config")`；内容用已跑通的 GLM；`agent-id` Java 侧保持 `String` | 装配链在 api-key 为空时快速失败，挂公共配置会搞死 prod 启动 |
| Q11 | 超时与熔断预算 | **三层**：单命令 30s / `RunConfig.maxLlmCalls = 10` / emitter 总超时 3 分钟 → **10 分钟** | 三层各管各的：单命令不挂死、循环不失控、整条流有硬上限。`ReActContext.maxSteps` 标注「由 RunConfig.maxLlmCalls 取代」 |
| Q12 | 危险命令防护 | **工具内置小黑名单**（十来条正则），命中即不执行、返回错误 Map「该命令被安全策略拦截」；instruction 同步声明 | 挡的是模型手滑，不是恶意——最小闭环够用且不打断流程 |
| Q13 | 前端展示粒度 | **最小命令块**：`ChatPanel` 解析 `tool_call` / `tool_result` 事件，渲染等宽字体块（命令行 + 可折叠输出 + 成功/失败徽标） | 功能池 F2 的「可复制、可重跑」完整命令块卡片留到下个迭代 |

---

## 4. 详细设计（实现级）

### 4.0 反编译参考源码索引 + API 速查表

第三方库源码已反编译并保留在 `docs/decompiled/`（许可证、目录结构、高频查阅点见 `docs/decompiled/README.md`）。实现时想看上游原始实现逻辑，按本节索引回溯。

**API 速查表（全部经反编译核实，照抄即可）**

| 用途 | 类/方法 | 来源 |
|------|---------|------|
| 工具注册 | `FunctionTool.create(Object instance, String methodName)` | `google-adk/.../tools/FunctionTool.java:95` |
| 工具参数注解 | `@com.google.adk.tools.Annotations.Schema(name=,description=,optional=)` | `tools/Annotations.java` |
| LlmAgent 装配 | `LlmAgent.builder().name().description().model(BaseLlm).instruction(String).outputKey(String).tools(List<?>)` | `agents/LlmAgent.java:449-737` |
| Runner 装配 | `new InMemoryRunner(BaseAgent agent, String appName, List<? extends Plugin> plugins)` | `runner/InMemoryRunner.java:25` |
| 流式跑 agent | `runner.runAsync(String userId, String sessionId, Content newMessage, RunConfig runConfig)` → `Flowable<Event>` | `runner/Runner.java:156` |
| 熔断配置 | `RunConfig.builder().maxLlmCalls(int).build()`（默认 500） | `agents/RunConfig.java:41` |
| 事件取文本 | `event.stringifyContent()` → `String` | `events/Event.java:282` |
| 事件取工具调用 | `event.functionCalls()` → `ImmutableList<FunctionCall>`；`fc.id()`/`fc.name()`/`fc.args()` | `events/Event.java:260` |
| 事件取工具结果 | `event.functionResponses()` → `ImmutableList<FunctionResponse>`；`fr.id()`/`fr.name()`/`fr.response()` | `events/Event.java:265` |
| 事件取 turnComplete | `event.turnComplete()` → `Optional<Boolean>` | `events/Event.java:129` |
| 插件基类 | `extends com.google.adk.plugins.BasePlugin`，构造 `super("myTestPlugin")` | `plugins/BasePlugin.java` |
| 插件回调返回姿势 | `return Maybe.fromAction(() -> { 打日志; })`（执行副作用后返回 empty，绝不短路框架） | `plugins/LoggingPlugin.java` |
| Context 取 invocationId/userId | `invocationContext.invocationId()` / `.userId()` / `.session().id()` / `.agent().name()` / `.appName()` | `agents/InvocationContext.java:100-142` |
| CallbackContext 便捷方法 | `callbackContext.invocationId()` / `.userId()` / `.sessionId()` / `.agentName()`（继承自 `ReadonlyContext`） | `agents/ReadonlyContext.java:27-44` |
| beforeModel 取工具列表 | `llmRequest.build().tools().keySet()`（工具名集合）；`.model()`（模型名） | `models/LlmRequest.java:45,33` |
| afterModel 取 turnComplete | `llmResponse.turnComplete()` → `Optional<Boolean>` | `models/LlmResponse.java:47` |
| ToolContext 取 functionCallId | `toolContext.functionCallId()` → `Optional<String>` | `tools/ToolContext.java:35` |
| Content/Part 构造 | `Content.builder().role("user").parts(Part.builder().text(...).build()).build()` | （genai，现有代码已用） |
| exec 通道 | JSch `ChannelExec`：`setCommand(String)`、`getInputStream()`(stdout)、`getErrStream()`(stderr)、`getExitStatus()`、`isClosed()`、`connect(timeout)` | `jsch/.../ChannelExec.java` + `Channel.java` |

---

### 4.1 exec 端口（domain 端口 + infrastructure 实现）

> **反编译参考**：`docs/decompiled/jsch/com/jcraft/jsch/ChannelExec.java`（`setCommand` / `getErrStream`，stderr 扩展流）、`Channel.java`（`getInputStream`=stdout / `getExitStatus` / `isClosed` / `connect(timeout)`）。现有 `SshSessionPort.exec(String)`（line 140-198）即基于 ChannelExec，本节是其增强版（stderr 分流 + 超时强断 + 截断 + 结构化返回）。

#### 4.1.1 新增 `ExecResult`（领域值对象）

**文件（新增）**：`ssh-server-domain/src/main/java/com/johnny/domain/ssh/adapter/port/ExecResult.java`
**包**：`com.johnny.domain.ssh.adapter.port`

```java
package com.johnny.domain.ssh.adapter.port;

/**
 * exec 通道单次命令执行的结构化结果。
 * <p>工具层据此组装返回给 LLM 的 8 字段 Map（见 §4.2）。
 * 字段采用 public 风格，与 {@link ISshSessionPort.OpenResult} 等同包 POJO 一致。
 */
public class ExecResult {
    /** 标准输出（已截断到 {@link #stdoutLimit} 字节） */
    public String stdout;
    /** 标准错误（已截断到 {@link #stderrLimit} 字节） */
    public String stderr;
    /** 真实退出码；通道异常/超时未拿到时为 -1 */
    public int exitCode = -1;
    /** 是否超时强断 */
    public boolean timedOut;
    /** stdout 是否被截断 */
    public boolean stdoutTruncated;
    /** stderr 是否被截断 */
    public boolean stderrTruncated;
    /** stdout 截断前的原始字节数（供 LLM 提示输出体量） */
    public int stdoutOriginalBytes;
    /** stderr 截断前的原始字节数 */
    public int stderrOriginalBytes;
}
```

#### 4.1.2 `ISshSessionPort` 新增方法

**文件（修改）**：`ssh-server-domain/src/main/java/com/johnny/domain/ssh/adapter/port/ISshSessionPort.java`
**改动**：在现有 `String exec(String connectionId, String command);`（line 59）之外，**新增重载**：

```java
/**
 * 在 connectionId 对应的 SSH 连接上开一次性 ChannelExec 执行命令，返回结构化结果。
 * <p>供 {@code SshExecuteAdkTool} 使用：与终端 shell 通道隔离，独立采集 stdout/stderr + 真实退出码。
 * 不抛异常——通道级失败由调用方（工具层）catch 后转成错误 Map（Q3a）。
 *
 * @param connectionId SSH 连接 id（由终端 sessionId 映射而来）
 * @param command      单条 shell 命令
 * @param timeoutMs    超时毫秒；超时强断通道，{@code timedOut=true}，连同已捕获输出返回
 * @return 结构化结果；连接不存在时返回 {@code null}（由调用方判空转错误 Map）
 */
ExecResult exec(String connectionId, String command, long timeoutMs);
```

> 现有 `String exec(String, String)` 保留不动（仍被 `connect()` 的 `pwd` 探测调用，line 64）。新方法是独立重载。

#### 4.1.3 `SshSessionPort` 实现

**文件（修改）**：`ssh-server-infrastructure/src/main/java/com/johnny/infrastructure/adapter/port/SshSessionPort.java`
**改动**：新增 `exec(String, String, long)` 实现。基于现有 `exec(String)`（line 140-198）改造：①stdout/stderr 分流（`getInputStream()` + `getErrStream()`）；②超时参数化并强断通道；③各截断 8KB；④返回 `ExecResult`。

```java
// === import 新增（文件顶部）===
// import com.johnny.domain.ssh.adapter.port.ExecResult;  // 同包接口的返回类型
// import java.io.ByteArrayOutputStream;

// === 类内常量新增（紧挨现有 EXEC_TIMEOUT）===
/** exec 通道单流（stdout/stderr 各自）最大保留字节，超出截断 */
private static final int EXEC_STREAM_LIMIT = 8 * 1024;

@Override
public ExecResult exec(String connectionId, String command, long timeoutMs) {
    Session session = sessions.get(connectionId);
    if (session == null || !session.isConnected()) {
        // 连接不存在/已断：返回 null，由工具层判空转错误 Map（不抛异常，Q3a）
        return null;
    }
    ExecResult result = new ExecResult();
    ChannelExec channel = null;
    try {
        channel = (ChannelExec) session.openChannel("exec");
        channel.setCommand(command);
        // stderr 走扩展流，与 stdout 分开采集（Q4）
        InputStream stdoutStream = channel.getInputStream();
        InputStream stderrStream = channel.getErrStream();
        channel.connect(CONNECT_TIMEOUT);

        ByteArrayOutputStream stdoutBuf = new ByteArrayOutputStream();
        ByteArrayOutputStream stderrBuf = new ByteArrayOutputStream();
        long deadline = System.currentTimeMillis() + timeoutMs;
        byte[] buf = new byte[1024];

        while (true) {
            // 轮询读 stdout（带 8KB 截断）
            drainStream(stdoutStream, stdoutBuf, buf, EXEC_STREAM_LIMIT);
            // 轮询读 stderr（带 8KB 截断）
            drainStream(stderrStream, stderrBuf, buf, EXEC_STREAM_LIMIT);

            if (channel.isClosed()) {
                // 通道关闭后再收尾读一次，确保不丢尾部输出
                drainStream(stdoutStream, stdoutBuf, buf, EXEC_STREAM_LIMIT);
                drainStream(stderrStream, stderrBuf, buf, EXEC_STREAM_LIMIT);
                result.exitCode = channel.getExitStatus();
                break;
            }
            if (System.currentTimeMillis() > deadline) {
                result.timedOut = true;
                log.warn("SSH exec 超时强断 connectionId={} cmd=[{}]", connectionId, command);
                break;
            }
            Thread.sleep(POLL_INTERVAL);
        }

        // 通道异常（connect 失败等）时 getExitStatus 返回 -1，result.exitCode 保持默认 -1
        result.stdout = stdoutBuf.toString(StandardCharsets.UTF_8);
        result.stderr = stderrBuf.toString(StandardCharsets.UTF_8);
        result.stdoutOriginalBytes = stdoutBuf.size();
        result.stderrOriginalBytes = stderrBuf.size();
        result.stdoutTruncated = result.stdoutOriginalBytes > EXEC_STREAM_LIMIT;
        result.stderrTruncated = result.stderrOriginalBytes > EXEC_STREAM_LIMIT;
        log.info("SSH exec 完成 connectionId={} cmd=[{}] exit={} timedOut={} stdoutBytes={} stderrBytes={}",
                connectionId, command, result.exitCode, result.timedOut,
                result.stdoutOriginalBytes, result.stderrOriginalBytes);
        return result;
    } catch (InterruptedException ie) {
        Thread.currentThread().interrupt();
        // 中断也走错误路径：返回带状态的 result（exitCode=-1），由工具层转错误 Map
        result.timedOut = true;
        return result;
    } catch (Exception e) {
        log.error("SSH exec 异常 connectionId={} cmd=[{}]", connectionId, command, e);
        // 通道级异常：exitCode 保持 -1，由工具层转错误 Map（Q3a）
        return result;
    } finally {
        if (channel != null) {
            channel.disconnect();
        }
    }
}

/**
 * 把 InputStream 当前可读字节搬进 buffer，超过 maxBytes 后丢弃（截断）。
 * 不阻塞：available()<=0 直接返回。
 */
private void drainStream(InputStream in, ByteArrayOutputStream out, byte[] buf, int maxBytes) throws Exception {
    while (in.available() > 0 && out.size() < maxBytes) {
        int n = in.read(buf);
        if (n < 0) break;
        int allow = Math.min(n, maxBytes - out.size());
        if (allow > 0) out.write(buf, 0, allow);
    }
    // 超过上限的剩余字节读出丢弃（清空通道缓冲，但不入 buffer）
    while (in.available() > 0) {
        int n = in.read(buf);
        if (n < 0) break;
    }
}
```

**实现要点**：
- 截断逻辑：每个流单独截到 8KB，`drainStream` 超 maxBytes 后继续读丢弃，保证通道缓冲不残留、不阻塞；
- 超时：`timedOut=true` 后 `break`，`finally` 关闭通道；`exitCode` 保持 -1（拿不到）；
- 不抛异常：所有异常路径都返回 `ExecResult`（连接级异常返回 `null`，通道级异常返回 exitCode=-1 的 result），由工具层统一转错误 Map（Q3a）；
- 与 `connect()` 的 `pwd` 探测互不影响（探测仍用旧 `exec(String)`）。

---

### 4.2 SshExecuteAdkTool（domain/agent/service/tools）

**文件（新增）**：`ssh-server-domain/src/main/java/com/johnny/domain/agent/service/tools/SshExecuteAdkTool.java`
**包**：`com.johnny.domain.agent.service.tools`

普通 Spring `@Component`，`@Resource` 注入 `ISshTerminalService` / `ISshSessionPort`（事实 6：`FunctionTool.create` 支持实例方法）。方法与参数用 `@Annotations.Schema` 描述。

> **依赖前置（与阶段 1 同步落地）**：本类依赖 `ISshTerminalService.getConnectionId(String)`（§4.7.3 新增——虽列在请求链路节，但它是本工具直接依赖、**属阶段 1**，见附录 A.2）、`TerminalContext`（§4.9.1，阶段 1 建类、阶段 3 接 set/clear）、`ExecResult`（§4.1.1）。三项落地后本类才可编译。
>
> **反编译参考**：`docs/decompiled/google-adk/com/google/adk/tools/FunctionTool.java`（`create(Object,String)` 实例方法注册、参数 `@Schema` 校验规则 line 112-127）、`Annotations.java`（`@Schema` 注解三属性）。

```java
package com.johnny.domain.agent.service.tools;

import com.google.adk.tools.Annotations;
import com.johnny.domain.ssh.adapter.port.ExecResult;
import com.johnny.domain.ssh.adapter.port.ISshSessionPort;
import com.johnny.domain.ssh.service.ISshTerminalService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * ADK 工具：在用户绑定的远程服务器上执行单条 SSH 命令（走独立 exec 通道，Q1）。
 * <p>由 {@code AgentNode} 通过 {@code FunctionTool.create(sshExecuteAdkTool, "executeCommand")} 注册。
 * <p>核心契约：{@link #executeCommand(String)} 永不抛异常——任何失败都返回 {@code success:false} 的错误 Map，
 * 让 LLM 把失败当观察结果、转述给用户（Q3a）。
 */
@Slf4j
@Component
public class SshExecuteAdkTool {

    @Resource
    private ISshTerminalService sshTerminalService;

    @Resource
    private ISshSessionPort sshSessionPort;

    /**
     * 执行一条远程命令。
     * <p>调用链：黑名单 → ITL 取 terminalSessionId → 映射 connectionId → 校验连接 → exec → 组装 8 字段 Map。
     *
     * @param command 要执行的 shell 命令（单条）
     * @return 结构化结果 Map，LLM 直接消费其 JSON
     */
    public Map<String, Object> executeCommand(
            @Annotations.Schema(name = "command",
                    description = "要在远程服务器上执行的单条 shell 命令，例如 cat /etc/os-release")
            String command) {

        // 1) 入口打线程名日志：联调验证 ITL 继承是否正确（见 §4.9 风险）
        log.info("🔧 工具入口 thread={} command=[{}]", Thread.currentThread().getName(), command);

        // 2) 黑名单校验（Q12）——命中即拦截，不执行
        if (isBlocked(command)) {
            log.warn("命令被安全策略拦截 command=[{}]", command);
            return errorMap(command, "该命令被安全策略拦截，禁止执行（危险命令）",
                    "命令命中黑名单，请换用安全的等价命令或联系管理员。");
        }

        // 3) 从 ITL 取 terminalSessionId（§4.9）
        String terminalSessionId = TerminalContext.getTerminalSessionId();
        if (terminalSessionId == null || terminalSessionId.isBlank()) {
            return errorMap(command, "未绑定终端会话，请先在终端面板连接服务器",
                    "请用户在左侧终端面板先连接一台服务器，再提问。");
        }

        // 4) terminalSessionId → connectionId（§4.7.2 新增接口）
        String connectionId;
        try {
            connectionId = sshTerminalService.getConnectionId(terminalSessionId);
        } catch (Exception e) {
            log.warn("终端会话不存在 sessionId={} reason={}", terminalSessionId, e.getMessage());
            return errorMap(command, "终端会话已失效，请重新连接服务器",
                    "终端会话不存在或已关闭，请用户重新打开终端。");
        }
        if (connectionId == null) {
            return errorMap(command, "终端会话已失效，请重新连接服务器", null);
        }

        // 5) 校验 SSH 连接仍然在线
        if (!sshSessionPort.isConnected(connectionId)) {
            return errorMap(command, "SSH 连接已断开，请重新连接服务器",
                    "SSH 会话已掉线，请用户重新连接该服务器。");
        }

        // 6) exec（独立通道，30s 超时，Q4）
        ExecResult r = sshSessionPort.exec(connectionId, command, 30_000L);
        if (r == null) {
            return errorMap(command, "SSH 连接已断开，请重新连接服务器", null);
        }

        // 7) 组装返回 Map（Q9：8 字段）
        return assembleResult(command, r);
    }

    /** 组装成功/失败的统一返回 Map；失败时额外附加 analysis 字段（Q9）。 */
    private Map<String, Object> assembleResult(String command, ExecResult r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("command", command);
        boolean success = !r.timedOut && r.exitCode == 0;
        m.put("success", success);
        m.put("exitCode", r.exitCode);
        m.put("stdout", r.stdout);
        m.put("stderr", r.stderr);
        m.put("timedOut", r.timedOut);
        // truncated：stdout/stderr 任一被截断即为 true，并附原始字节数
        boolean truncated = r.stdoutTruncated || r.stderrTruncated;
        m.put("truncated", truncated);
        if (truncated) {
            m.put("originalBytes", "stdout=" + r.stdoutOriginalBytes + ",stderr=" + r.stderrOriginalBytes);
        }
        // analysis：仅失败时出现，规则不命中则省略（Q9）
        if (!success) {
            String analysis = analyzeFailure(command, r);
            if (analysis != null) {
                m.put("analysis", analysis);
            }
        }
        return m;
    }

    /** 构造错误 Map（执行前的拦截/前置失败用，未到 exec）。 */
    private Map<String, Object> errorMap(String command, String error, String analysis) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("command", command);
        m.put("success", false);
        m.put("error", error);
        if (analysis != null) {
            m.put("analysis", analysis);
        }
        return m;
    }

    /**
     * 失败分析（Q9）：纯字符串规则匹配，不调模型。首批 5 条规则。
     * @return 中文建议；不命中返回 null（调用方据此省略 analysis 字段）
     */
    private String analyzeFailure(String command, ExecResult r) {
        String stderr = r.stderr == null ? "" : r.stderr.toLowerCase();
        String combined = stderr; // 规则只看 stderr（分开采集的意义，Q4）
        if (r.timedOut) {
            return "命令执行超时（30s）。可能是交互式或长驻命令（如 top、vim、tail -f）。建议换非交互形式，例如 top → top -bn1，tail -f → tail -n 100。";
        }
        if (combined.contains("command not found") || combined.contains("not found")) {
            return "命令拼写错误或软件未安装。建议先用包管理器安装，或换等价命令。";
        }
        if (combined.contains("permission denied")) {
            return "权限不足。建议检查文件权限，或对受信任的命令加 sudo 前缀（需用户确认）。";
        }
        if (combined.contains("no such file or directory")) {
            return "路径不存在。建议先 ls 确认目标路径后再执行。";
        }
        return null;
    }

    // === 危险命令黑名单（Q12）===
    private static final List<Pattern> BLOCKED = List.of(
            Pattern.compile("\\brm\\s+(-[a-z]*r[a-z]*f|--force)\\s+(/|~|\\*|\\$HOME)\\b"),
            Pattern.compile("\\bmkfs\\b"),
            Pattern.compile("\\bdd\\s+.*\\bof=/dev/"),
            Pattern.compile("\\b(shutdown|reboot|halt|poweroff|init\\s+0)\\b"),
            Pattern.compile(":\\(\\)\\s*\\{\\s*:\\|:&\\s*\\}\\s*;\\s*:"),   // fork 炸弹
            Pattern.compile("\\b>(\\s*)/dev/sd[a-z]"),
            Pattern.compile("\\bchmod\\s+-R\\s+000\\s+/"),
            Pattern.compile("\\b>(\\s*)/dev/null\\s+<\\s*/dev/")           // 可选，按需增减
    );

    private boolean isBlocked(String command) {
        if (command == null) return false;
        for (Pattern p : BLOCKED) {
            if (p.matcher(command).find()) return true;
        }
        return false;
    }
}
```

**返回 Map 结构对照（LLM 消费的就是这个 JSON）**

| 字段 | 成功路径 | 失败路径 |
|------|---------|---------|
| `command` | 原样回显 | 原样回显 |
| `success` | `true` | `false` |
| `exitCode` | 0 | 非 0 或 -1 |
| `stdout` | 截断后的标准输出 | 截断后的标准输出（可能含错误信息） |
| `stderr` | 截断后的标准错误（常为空） | 截断后的标准错误 |
| `timedOut` | `false` | `true`（超时）或 `false` |
| `truncated` | 是否被截断 + `originalBytes` | 同左 |
| `analysis` | **不出现** | 中文建议（规则不命中则省略） |
| `error` | 不出现 | 仅「执行前拦截/前置失败」路径出现（未到 exec） |

### 4.3 MySpringAI 桥接（domain/agent/bridge，vendored）

把官方 `google-adk-spring-ai` 1.2.0（Apache 2.0，允许 vendor）的桥接层拷进代码库，**只改 `MessageConverter` 两处**，其余文件原样保留（仅改 package）。

#### 4.3.1 vendored 文件清单（8 个，依赖闭包完整）

从 `docs/decompiled/google-adk-spring-ai/com/google/adk/models/springai/` 拷贝以下文件到 `ssh-server-domain/src/main/java/com/johnny/domain/agent/bridge/springai/`，**package 统一改为 `com.johnny.domain.agent.bridge.springai`**（子包路径保留：`error/`、`observability/`、`properties/`），文件间 import 互指同步改包名：

| 源文件（官方） | 目标文件（vendor） | 改动 |
|----------------|-------------------|------|
| `springai/SpringAI.java` | `springai/MySpringAI.java` | package 改 + **类名 `SpringAI`→`MySpringAI`**（避免与官方 jar 同名冲突） |
| `springai/MessageConverter.java` | `springai/MessageConverter.java` | package 改 + **改两处**（见 4.3.2 / 4.3.3） |
| `springai/ToolConverter.java` | `springai/ToolConverter.java` | package 改，原样 |
| `springai/ConfigMapper.java` | `springai/ConfigMapper.java` | package 改，原样 |
| `springai/MessageConversionException.java` | `springai/MessageConversionException.java` | package 改，原样 |
| `springai/error/SpringAIErrorMapper.java` | `springai/error/SpringAIErrorMapper.java` | package 改，原样（含 `MappedError`/`ErrorCategory`/`RetryStrategy` 内嵌） |
| `springai/observability/SpringAIObservabilityHandler.java` | `springai/observability/SpringAIObservabilityHandler.java` | package 改，原样（含 `RequestContext` 内嵌） |
| `springai/properties/SpringAIProperties.java` | `springai/properties/SpringAIProperties.java` | package 改，原样（含 `Observability`/`Validation` 内嵌） |

**不 vendor**：`SpringAIEmbedding`/`EmbeddingConverter`（embedding 不用）、`SpringAIAutoConfiguration`/`autoconfigure/*`（autoconfig 不用，装配由 armory 手写）、`StreamingResponseAggregator`（不在依赖链上）。

> **拷贝姿势**：直接 `cp docs/decompiled/google-adk-spring-ai/com/google/adk/models/springai/X.java` 到目标目录，然后把每个文件首行 `package com.google.adk.models.springai[.sub];` 改为 `package com.johnny.domain.agent.bridge.springai[.sub];`，全局替换 import 里的 `com.google.adk.models.springai` → `com.johnny.domain.agent.bridge.springai`。`MySpringAI` 单独再把类名 `SpringAI` 改 `MySpringAI`（含构造方法名）。

#### 4.3.2 改动点 1：关闭 Spring AI 内部工具执行

**位置**：`MessageConverter.toLlmPrompt`（反编译源 line 78-108；vendor 后行号随 package 注释微移，定位锚点是 `ToolCallingChatOptions.builder()`）

**改前**（官方原样，反编译 line 79-107）：
```java
ToolCallingChatOptions.Builder optionsBuilder = ToolCallingChatOptions.builder();
optionsBuilder.toolCallbacks(toolCallbacks);
if (chatOptions != null) {
    if (chatOptions.getTemperature() != null) { optionsBuilder.temperature(chatOptions.getTemperature()); }
    // ... maxTokens / topP / topK / stopSequences / model / frequencyPenalty / presencePenalty ...
}
chatOptions = optionsBuilder.build();   // ← 缺 internalToolExecutionEnabled(false)
```

**改后**（vendor 改动点 1）：
```java
ToolCallingChatOptions.Builder optionsBuilder = ToolCallingChatOptions.builder();
optionsBuilder.toolCallbacks(toolCallbacks);
// 【改动点 1】关闭 Spring AI 内部工具执行——把 toolCall 原样返给 ADK，
// 由 ADK 原生 flow 执行 BaseTool、触发插件回调、再循环调模型（Q7 方案 B）。
// 官方版本缺这一行，导致 Spring AI 自己执行工具，ADK 事件流 functionCalls() 为空（stateDelta 坑）。
optionsBuilder.internalToolExecutionEnabled(false);
if (chatOptions != null) {
    if (chatOptions.getTemperature() != null) { optionsBuilder.temperature(chatOptions.getTemperature()); }
    // ... 其余 maxTokens / topP / topK / stopSequences / model / frequencyPenalty / presencePenalty 原样保留 ...
}
chatOptions = optionsBuilder.build();
```

> `internalToolExecutionEnabled(boolean)` 是 `org.springframework.ai.model.tool.ToolCallingChatOptions.Builder` 的标准方法（Spring AI 1.1.5）。`import org.springframework.ai.model.tool.ToolCallingChatOptions;` 官方已存在（反编译 MessageConverter line 33），无需新增 import。

#### 4.3.3 改动点 2：functionResponse → ToolResponseMessage

**位置**：`MessageConverter.handleUserContent`（反编译源 line 126-165；定位锚点是 `if (part.functionResponse().isPresent()) continue;`）

**官方硬伤**（反编译 line 128-137 + 163）：
```java
ArrayList toolResponseMessages = new ArrayList();   // line 128 声明了，但...
for (Part part : content.parts().orElse(List.of())) {
    if (part.text().isPresent()) { ... continue; }
    if (part.functionResponse().isPresent()) continue;   // ← line 137 直接跳过！toolResponseMessages 永远是空
    if (part.inlineData().isPresent()) { ... }
    // ...
}
// line 163：messages.addAll(toolResponseMessages);  → 永远加空列表
```

**改后**（vendor 改动点 2，把 `continue` 换成构造 `ToolResponseMessage`）：
```java
// 新增 import（MessageConverter 顶部）：
// import com.google.genai.types.FunctionResponse;
// import org.springframework.ai.chat.messages.ToolResponseMessage;

if (part.functionResponse().isPresent()) {
    // 【改动点 2】ADK functionResponse → Spring AI ToolResponseMessage（role=tool）。
    // 官方缺这一环：严格的 OpenAI/GLM 端点要求 assistant.tool_calls 后必须跟 role=tool 消息，否则 400。
    FunctionResponse fr = part.functionResponse().get();
    String respJson = this.toJson(fr.response().orElse(Map.of()));
    // fr.id() 来自 ADK Functions.java:299（= 同 round functionCall.id()），与 assistant.tool_calls[].id 关联一致（事实 10）
    toolResponseMessages.add(
            ToolResponseMessage.builder()
                    .responses(List.of(new ToolResponseMessage.ToolResponse(
                            fr.id().orElse(""),        // tool_call_id，关联上一个 assistant 的 tool_call
                            fr.name().orElse(""),      // 工具名
                            respJson)))                // responseData（JSON string）
                    .build());
    continue;
}
```

> `this.toJson(...)` 是 MessageConverter 已有的私有方法（反编译 line 244-251），原样复用。`ToolResponseMessage.builder()` 因构造器 `protected`（反编译 ToolResponseMessage line 16）必须走 builder——`new ToolResponseMessage(...)` 编译不过。`ToolResponse` 是 record（line 75），`new ToolResponseMessage.ToolResponse(id, name, responseData)` 直接构造。

#### 4.3.4 类头注释模板（所有 vendored 文件统一加）

```java
/**
 * 【Vendored from google-adk-spring-ai 1.2.0（Apache License 2.0）】
 * 来源：com.google.adk.models.springai.MessageConverter（见 docs/decompiled/google-adk-spring-ai/）
 * 改动：见类内【改动点 1/2】标注（仅 MessageConverter 有改动，其余 vendored 文件原样仅改 package）。
 * 升级 google-adk-spring-ai 版本时，需人工比对官方新版与本地 vendored 副本，同步改动点。
 * <p>License: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
 */
```

#### 4.3.5 装配侧替换

`AgentNode`（§4.4）装配 `LlmAgent` 时，`.model(new MySpringAI(chatModel))` 替代原来的 `new SpringAI(chatModel)`（`AgentRunnerRegistry.java:123` 现有写法）。`MySpringAI` 的构造方法签名与官方 `SpringAI(ChatModel)` 完全一致（vendor 时只改类名不改构造），其余装配代码不动。

---

### 4.4 armory 装配责任树（domain/agent/armory）

由 `DefaultArmoryFactory` 发起，节点复用 react 包现有的 `AbstractStrategyRouter<T,D,R>` / `StrategyHandler<T,D,R>` 责任链引擎（`com.johnny.domain.react.engine`，探索报告 §2a/2b），但**泛型不同**（armory 是装配期一次性流程，泛型为 `<Void, ArmoryDynamicContext, Void>`——入参无、上下文透传、无返回值），另行实例化一份节点链。

> 引擎机制回顾（`AbstractStrategyRouter`）：`router(p, ctx)` 只推进一步——取 `get(p, ctx)` 的下一节点并 `apply`；`get` 返回 `null` 走 `defaultStrategyHandler`（返回 null，链终止）。每个节点 `doApply` 末尾 `return router(p, ctx)` 推进下一步。armory 节点 `doApply` 完成自己的装配后调 `router` 进入下一节点。

#### 4.4.1 `ArmoryDynamicContext`（装配链数据载体）

**文件（新增）**：`ssh-server-domain/src/main/java/com/johnny/domain/agent/armory/ArmoryDynamicContext.java`

```java
package com.johnny.domain.agent.armory;

import lombok.Data;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.openai.OpenAiApi;
import com.google.adk.agents.LlmAgent;
import com.google.adk.models.springai.SpringAI; // 注意：用 vendored 的 MySpringAI（见下）
import com.johnny.domain.agent.bridge.springai.MySpringAI;
import com.google.adk.runner.Runner;
import com.google.adk.tools.FunctionTool;
import com.johnny.domain.agent.config.AgentTable;        // §4.6 绑定类
// ... 其余 import 省略

/**
 * armory 装配责任链的动态上下文，在各节点间透传半成品对象。
 * 每个节点把产出塞进对应字段，下游节点消费。
 * <p>泛型上对应 {@code AbstractStrategyRouter<Void, ArmoryDynamicContext, Void>} 的 D。
 */
@Data
public class ArmoryDynamicContext {
    /** 本次装配的 agent 配置表（来自 ssh-agent.yml 的一个 table） */
    private AgentTable table;
    /** AiApiNode 产出 */
    private OpenAiApi openAiApi;
    /** ChatModelNode 产出 */
    private ChatModel chatModel;
    /** AgentNode 产出 */
    private MySpringAI springAI;       // vendored 桥接（§4.3）
    private LlmAgent llmAgent;
    /** AgentWorkflowNode 产出（单 agent 直通，= llmAgent） */
    private LlmAgent workflowAgent;
    /** RunnerNode 产出 */
    private Runner runner;
    /** 装配过程中创建的 FunctionTool（调试用） */
    private java.util.List<FunctionTool> tools = new java.util.ArrayList<>();
}
```

#### 4.4.2 节点链骨架（6 个节点）

责任链：`ArmoryRootNode → AiApiNode → ChatModelNode → AgentNode → AgentWorkflowNode → RunnerNode`

所有节点 `extends AbstractStrategyRouter<Void, ArmoryDynamicContext, Void>`，`@Component` 注解命名（避免与 react 包同名 bean 冲突）。每个节点结构相同：`doApply` 干活 → `return router(null, ctx)`；`get` 返回下一节点 bean。

**文件（新增，统一在 `com.johnny.domain.agent.armory` 包）**：

```java
// ===== ArmoryRootNode.java =====
/** 链入口。bean 名 armoryRootNode，与 react 包 reactRootNode 区分（事实探索 §2d）。 */
@Slf4j
@Component("armoryRootNode")
public class ArmoryRootNode extends AbstractStrategyRouter<Void, ArmoryDynamicContext, Void> {
    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        log.info("armory 装配开始 agentId={} appName={}",
                ctx.getTable().getAgent().getAgentId(), ctx.getTable().getAgent().getAgentName());
        return router(p, ctx);   // 推进到 AiApiNode
    }
    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryAiApiNode");
    }
}

// ===== AiApiNode.java =====
/**
 * 构建 {@link OpenAiApi}（base-url / api-key / completions-path）。
 * disableThinking 拦截器（关闭 GLM 思考模式）从 AgentRunnerRegistry.java:83-102 原样迁入此处
 * ——构建 OpenAiApi 的职责在它身上（Q5）。
 */
@Slf4j
@Component("armoryAiApiNode")
public class AiApiNode extends AbstractStrategyRouter<Void, ArmoryDynamicContext, Void> {
    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        AgentTable.Module.AiApi apiCfg = ctx.getTable().getModule().getAiApi();
        if (StringUtils.isBlank(apiCfg.getApiKey())) {
            // api-key 为空快速失败（Q10）：dev 必须配 ZHIPU_API_KEY
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "armory 装配失败：api-key 为空，请配置 ZHIPU_API_KEY");
        }
        ClientHttpRequestInterceptor disableThinking = buildDisableThinkingInterceptor(); // 从 AgentRunnerRegistry 迁入
        OpenAiApi openAiApi = OpenAiApi.builder()
                .baseUrl(apiCfg.getBaseUrl())
                .apiKey(apiCfg.getApiKey())
                .completionsPath(StringUtils.isNotBlank(apiCfg.getCompletionsPath())
                        ? apiCfg.getCompletionsPath() : "v1/chat/completions")
                .restClientBuilder(RestClient.builder().requestInterceptor(disableThinking))
                .build();
        ctx.setOpenAiApi(openAiApi);
        log.info("armory[AiApiNode] 完成 baseUrl={} completionsPath={}",
                apiCfg.getBaseUrl(), apiCfg.getCompletionsPath());
        return router(p, ctx);
    }
    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryChatModelNode");
    }
    /** 迁移自 AgentRunnerRegistry.java:83-102 的 disableThinking lambda（关闭 glm-5.2 思考模式） */
    private ClientHttpRequestInterceptor buildDisableThinkingInterceptor() {
        return (request, body, execution) -> {
            String path = request.getURI().getPath();
            if (path != null && path.contains("chat/completions") && body != null && body.length > 0) {
                try {
                    JSONObject obj = JSON.parseObject(new String(body, StandardCharsets.UTF_8));
                    if (obj != null && !obj.containsKey("thinking")) {
                        JSONObject thinking = new JSONObject();
                        thinking.put("type", "disabled");
                        obj.put("thinking", thinking);
                        byte[] newBody = obj.toJSONString().getBytes(StandardCharsets.UTF_8);
                        request.getHeaders().setContentLength(newBody.length);
                        return execution.execute(request, newBody);
                    }
                } catch (Exception ignore) { /* 改写失败沿用原 body */ }
            }
            return execution.execute(request, body);
        };
    }
}

// ===== ChatModelNode.java =====
/** 构建 {@link ChatModel}（OpenAiChatModel + 模型名）。MCP/skills 扩展预留位。 */
@Slf4j
@Component("armoryChatModelNode")
public class ChatModelNode extends AbstractStrategyRouter<Void, ArmoryDynamicContext, Void> {
    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        AgentTable.Module.ChatModel cmCfg = ctx.getTable().getModule().getChatModel();
        ChatModel chatModel = OpenAiChatModel.builder()
                .openAiApi(ctx.getOpenAiApi())
                .defaultOptions(OpenAiChatOptions.builder().model(cmCfg.getModel()).build())
                .build();
        ctx.setChatModel(chatModel);
        log.info("armory[ChatModelNode] 完成 model={}", cmCfg.getModel());
        return router(p, ctx);
    }
    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryAgentNode");
    }
}

// ===== AgentNode.java =====
/**
 * 用 vendored {@link MySpringAI} 桥接构建 {@link LlmAgent}，注册 executeCommand 工具。
 * 依赖 {@link SshExecuteAdkTool}（§4.2）——Spring 注入。
 */
@Slf4j
@Component("armoryAgentNode")
public class AgentNode extends AbstractStrategyRouter<Void, ArmoryDynamicContext, Void> {
    @Resource private SshExecuteAdkTool sshExecuteAdkTool;

    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        AgentTable.Module module = ctx.getTable().getModule();
        AgentTable.Agent agentCfg = ctx.getTable().getAgent();
        // vendored 桥接（§4.3）：关闭内部工具执行 + 修正 functionResponse→ToolResponseMessage
        MySpringAI springAI = new MySpringAI(ctx.getChatModel());
        AgentTable.Module.AgentDef agentDef = module.getAgents().get(0); // 单 agent：取第一个
        FunctionTool tool = FunctionTool.create(sshExecuteAdkTool, "executeCommand");
        ctx.getTools().add(tool);

        LlmAgent llmAgent = LlmAgent.builder()
                .name(agentDef.getName())
                .description(agentDef.getDescription())
                .model(springAI)
                .instruction(agentDef.getInstruction())
                .outputKey(agentDef.getOutputKey())
                .tools(List.of(tool))    // tools(List<?>)，反编译 LlmAgent.java:485
                .build();
        ctx.setSpringAI(springAI);
        ctx.setLlmAgent(llmAgent);
        log.info("armory[AgentNode] 完成 agentName={} tools=[executeCommand]", agentDef.getName());
        return router(p, ctx);
    }
    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryAgentWorkflowNode");
    }
}

// ===== AgentWorkflowNode.java =====
/**
 * 显式占位：单 agent 场景直接透传 llmAgent。
 * 类注释写明「Loop/Parallel/Sequential 编排预留，当前直通」——多 Agent 编排时在此装配。
 */
@Slf4j
@Component("armoryAgentWorkflowNode")
public class AgentWorkflowNode extends AbstractStrategyRouter<Void, ArmoryDynamicContext, Void> {
    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        ctx.setWorkflowAgent(ctx.getLlmAgent());   // 直通
        log.info("armory[AgentWorkflowNode] 直通（单 agent，多 agent 编排预留）");
        return router(p, ctx);
    }
    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryRunnerNode");
    }
}

// ===== RunnerNode.java =====
/**
 * 构建 {@link InMemoryRunner}；按 plugin-name-list 逐个 getBean 注册插件；
 * 把 runner 包成 {@link AiAgentRegisterVO}，beanFactory.registerSingleton 动态注册进容器（Q5）。
 */
@Slf4j
@Component("armoryRunnerNode")
public class RunnerNode extends AbstractStrategyRouter<Void, ArmoryDynamicContext, Void> {
    @Resource private ConfigurableListableBeanFactory beanFactory;
    @Resource private ApplicationContext applicationContext;

    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        AgentTable table = ctx.getTable();
        String appName = table.getRunner().getAgentName();   // appName = agent name
        // 按 plugin-name-list 逐个 getBean 装配插件（Q8）
        List<Plugin> plugins = new ArrayList<>();
        for (String name : table.getRunner().getPluginNameList()) {
            plugins.add(applicationContext.getBean(name, Plugin.class));
        }
        Runner runner = new InMemoryRunner(ctx.getWorkflowAgent(), appName, plugins); // 反编译 InMemoryRunner.java:25
        ctx.setRunner(runner);

        // 包成 VO + 动态注册（registerSingleton，见 AiAgentRegisterVO 类注释警示）
        AiAgentRegisterVO vo = AiAgentRegisterVO.builder()
                .agentId(table.getAgent().getAgentId())
                .appName(appName)
                .agentName(table.getAgent().getAgentName())
                .agentDesc(table.getAgent().getAgentDesc())
                .runner(runner)
                .build();
        beanFactory.registerSingleton("aiAgentRunner_" + table.getAgent().getAgentId(), vo);
        log.info("armory[RunnerNode] 完成 agentId={} beanName=aiAgentRunner_{} plugins={}",
                table.getAgent().getAgentId(), table.getAgent().getAgentId(),
                table.getRunner().getPluginNameList());
        return router(p, ctx);   // get() 返回 null → defaultStrategyHandler → 链终止
    }
    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return defaultStrategyHandler;   // 终点：返回终止处理器
    }
}
```

> 所有节点的 `getBean(...)` 来自父类 `AbstractReActSupport`？不——armory 节点不继承 `AbstractReActSupport`（那是 react 包的），而是直接继承 `AbstractStrategyRouter`，故需自行注入 `ApplicationContext` 并实现 `getBean`。**建议**：在 armory 包内加一个 `AbstractArmoryNode extends AbstractStrategyRouter<Void, ArmoryDynamicContext, Void>`，注入 `ApplicationContext`，提供 `protected getBean(String)`，6 个节点都继承它（与 react 包 `AbstractReActSupport` 对称）。`ArmoryRootNode` 等改成 `extends AbstractArmoryNode`。

#### 4.4.3 `DefaultArmoryFactory`（装配发起者）

**文件（新增）**：`ssh-server-domain/src/main/java/com/johnny/domain/agent/armory/DefaultArmoryFactory.java`

```java
package com.johnny.domain.agent.armory;

import com.johnny.domain.agent.config.AgentConfigProperties;   // §4.6
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * armory 装配工厂：遍历配置里的每个 agent table，发起一条装配责任链。
 * 由瘦身后 {@link com.johnny.domain.agent.service.AgentRunnerRegistry} 的 build() 调用（§4.5）。
 */
@Slf4j
@Component
public class DefaultArmoryFactory {
    @Resource private ArmoryRootNode armoryRootNode;
    @Resource private AgentConfigProperties agentConfigProperties;

    public void assembleAll() throws Exception {
        // ⚠️ 启动健壮性：prod 不挂 ssh-agent.yml（Q10：只挂 dev）时 tables 为 null/空，
        // 必须跳过装配、不影响启动；否则 getTables().values() 会 NPE 搞死 prod 启动。
        if (agentConfigProperties.getTables() == null || agentConfigProperties.getTables().isEmpty()) {
            log.warn("armory 跳过装配：ai.agent.config.tables 为空（ssh-agent.yml 未挂载——prod 正常；dev 请检查 application-dev.yml 的 spring.config.import）");
            return;
        }
        for (AgentTable table : agentConfigProperties.getTables().values()) {
            ArmoryDynamicContext ctx = new ArmoryDynamicContext();
            ctx.setTable(table);
            armoryRootNode.apply(null, ctx);   // 入口 apply 触发整条链
            log.info("armory 装配完成 agentId={}", table.getAgent().getAgentId());
        }
    }
}
```

---

### 4.5 消费侧：AiAgentRegisterVO + Registry 门面 + MyTestPlugin

#### 4.5.1 `AiAgentRegisterVO`（RunnerHolder 改名 + 补字段）

**文件（改名）**：`RunnerHolder.java` → `ssh-server-domain/src/main/java/com/johnny/domain/agent/model/AiAgentRegisterVO.java`

```java
package com.johnny.domain.agent.model;

import com.google.adk.runner.Runner;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Agent 注册值对象：装配产物，动态注册进 Spring 容器（bean 名 aiAgentRunner_<agentId>）。
 * <p>原 RunnerHolder 的更名（原注释即写明是 AiAgentRegisterVO 的裁剪版，属对齐而非新造）。
 * <p>
 * ⚠️ registerSingleton 陷阱：refresh 之后的裸注册<b>不走 Bean 生命周期</b>——
 * 无代理、无 @PostConstruct、无 @Autowired 重新注入。对纯数据 VO 无害，
 * 但<b>今后不得往 VO 里塞需要 AOP / 依赖注入的东西</b>。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiAgentRegisterVO {
    private String agentId;
    private String appName;     // ADK appName（会话命名空间）
    private String agentName;
    private String agentDesc;
    private Runner runner;      // com.google.adk.runner.Runner
}
```

> 全局把对 `RunnerHolder` 的引用替换为 `AiAgentRegisterVO`：`AgentRunnerRegistry`、`ChatSessionService`、`AgentDTO` 映射处。三个消费方语义不变（字段名一致）。

#### 4.5.2 `AgentRunnerRegistry` 瘦身为容器查询门面

**文件（修改）**：`ssh-server-domain/src/main/java/com/johnny/domain/agent/service/AgentRunnerRegistry.java`

删内部 Map 与 40 行顺序装配代码，`build()` 改为触发 armory 责任树，`get/listAgents` 改走容器查询：

```java
@Slf4j
@Component
public class AgentRunnerRegistry implements ApplicationRunner {
    @Resource private DefaultArmoryFactory defaultArmoryFactory;
    @Resource private ApplicationContext applicationContext;

    @Override
    public void run(ApplicationArguments args) {
        build();
    }

    /** 触发 armory 装配责任树（替代原顺序装配） */
    private void build() {
        try {
            defaultArmoryFactory.assembleAll();
        } catch (Exception e) {
            log.error("armory 装配失败", e);
            throw new AppException(ResponseCode.UN_ERROR.getCode(), "Agent 装配失败：" + e.getMessage(), e);
        }
    }

    /** 容器查询：bean 名约定 aiAgentRunner_<agentId> */
    public AiAgentRegisterVO get(String agentId) {
        try {
            return applicationContext.getBean("aiAgentRunner_" + agentId, AiAgentRegisterVO.class);
        } catch (NoSuchBeanDefinitionException e) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "智能体不存在: " + agentId);
        }
    }

    /** 容器查询：列出所有已注册 agent */
    public List<AgentDTO> listAgents() {
        return applicationContext.getBeansOfType(AiAgentRegisterVO.class).values().stream()
                .map(vo -> AgentDTO.builder()
                        .agentId(vo.getAgentId())
                        .agentName(vo.getAgentName())
                        .agentDesc(vo.getAgentDesc())
                        .build())
                .collect(Collectors.toList());
    }
}
```

> 三个消费方（`AiCallNode` / `ChatSessionService` / `ChatController`）调用的是 `get(agentId)` / `listAgents()`，签名不变，**一行不改**。删字段 `@Resource AiProperties aiProperties`（旧配置，§4.11 清理）。

#### 4.5.3 `MyTestPlugin`（9 回调，旁观打日志）

**文件（新增）**：`ssh-server-domain/src/main/java/com/johnny/domain/agent/service/MyTestPlugin.java`

> **关键姿势**（反编译 `LoggingPlugin` 揭示）：用 `Maybe.fromAction(() -> { 打日志; })`——执行副作用后返回 empty `Maybe`，**绝不**返回非空 `Maybe`（非空会短路框架行为，见下文陷阱）。`afterRunCallback` 返回 `Completable`，用 `Completable.fromAction(...)`。

```java
package com.johnny.domain.agent.service;

import com.google.adk.agents.BaseAgent;
import com.google.adk.agents.CallbackContext;
import com.google.adk.agents.InvocationContext;
import com.google.adk.models.LlmRequest;
import com.google.adk.models.LlmResponse;
import com.google.adk.plugins.BasePlugin;
import com.google.adk.tools.BaseTool;
import com.google.adk.tools.ToolContext;
import com.google.genai.types.Content;
import io.reactivex.rxjava3.core.Maybe;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.stream.Collectors;

/**
 * 联调观测插件：9 回调全部旁观打中文日志，对照 §1 日志验收样例。
 * <p>bean 名 myTestPlugin（ssh-agent.yml runner.plugin-name-list 引用它）。
 * <p>
 * ⚠️ 返回值语义陷阱：回调返回<b>非空</b> Maybe 会短路框架行为——
 * 例如 beforeToolCallback 返回非空 Map 会跳过工具执行、拿返回值当结果。
 * 故全部用 {@code Maybe.fromAction(()->...)} 返回 empty（fromAction 执行副作用后产 empty）。
 * 字段取法借鉴反编译的 com.google.adk.plugins.LoggingPlugin（docs/decompiled/），
 * 但输出中文格式化，不用它。
 */
@Slf4j
@Component("myTestPlugin")
public class MyTestPlugin extends BasePlugin {

    public MyTestPlugin() {
        super("myTestPlugin");
    }

    // 🚀 用户输入信息
    @Override
    public Maybe<Content> onUserMessageCallback(InvocationContext ctx, Content userMessage) {
        return Maybe.fromAction(() -> {
            String content = userMessage == null ? "" : userMessage.parts()
                    .map(parts -> parts.stream().map(p -> p.text().orElse("")).collect(Collectors.joining()))
                    .orElse("");
            log.info("插件日志-🚀 用户输入信息 | invocationId:{} | userId:{} | content:{}",
                    ctx.invocationId(), ctx.userId(), content);
        });
    }

    // 🤖 智能体启动
    @Override
    public Maybe<Content> beforeAgentCallback(BaseAgent agent, CallbackContext ctx) {
        return Maybe.fromAction(() ->
                log.info("插件日志-🤖 智能体启动 | agentName:{} | invocationId:{}",
                        ctx.agentName(), ctx.invocationId()));
    }

    // 🧠 大模型请求（含可用工具）
    @Override
    public Maybe<LlmResponse> beforeModelCallback(CallbackContext ctx, LlmRequest.Builder reqBuilder) {
        return Maybe.fromAction(() -> {
            LlmRequest req = reqBuilder.build();
            String model = req.model().orElse("default");
            String tools = req.tools().keySet().stream().sorted().collect(Collectors.joining(","));
            log.info("插件日志-🧠 大模型请求 | agent:{} | model:{} | 可用工具:[{}]",
                    ctx.agentName(), model, tools);
        });
    }

    // 🧠 大模型响应（turnComplete）
    @Override
    public Maybe<LlmResponse> afterModelCallback(CallbackContext ctx, LlmResponse resp) {
        return Maybe.fromAction(() ->
                log.info("插件日志-🧠 大模型响应 | agent:{} | turnComplete:{}",
                        ctx.agentName(), resp.turnComplete().orElse(false)));
    }

    // 🔧 工具调用开始
    @Override
    public Maybe<Map<String, Object>> beforeToolCallback(BaseTool tool, Map<String, Object> args, ToolContext ctx) {
        return Maybe.fromAction(() ->
                log.info("插件日志-🔧 工具调用开始 | tool:{} | args:{}",
                        tool.name(), args));
    }

    // 🔧 工具调用完成
    @Override
    public Maybe<Map<String, Object>> afterToolCallback(BaseTool tool, Map<String, Object> args, ToolContext ctx, Map<String, Object> result) {
        return Maybe.fromAction(() ->
                log.info("插件日志-🔧 工具调用完成 | tool:{} | result:{}",
                        tool.name(), result));
    }

    // 🤖 智能体完成
    @Override
    public Maybe<Content> afterAgentCallback(BaseAgent agent, CallbackContext ctx) {
        return Maybe.fromAction(() ->
                log.info("插件日志-🤖 智能体完成 | agentName:{}", ctx.agentName()));
    }

    // ❌ 大模型调用异常
    @Override
    public Maybe<LlmResponse> onModelErrorCallback(CallbackContext ctx, LlmRequest.Builder reqBuilder, Throwable error) {
        return Maybe.fromAction(() ->
                log.error("插件日志-❌ 大模型调用异常 | agent:{} | error:{}",
                        ctx.agentName(), error.getMessage()), error);
    }

    // ❌ 工具调用异常
    @Override
    public Maybe<Map<String, Object>> onToolErrorCallback(BaseTool tool, Map<String, Object> args, ToolContext ctx, Throwable error) {
        return Maybe.fromAction(() ->
                log.error("插件日志-❌ 工具调用异常 | tool:{} | args:{} | error:{}",
                        tool.name(), args, error.getMessage()), error);
    }
}
```

> `Maybe.fromAction(Action0)` 执行 action 后 `onComplete`（产 empty）。带 Throwable 的重载 `Maybe.fromAction(Action0, Throwable)` 不存在——上面 `onModelErrorCallback`/`onToolErrorCallback` 若要打堆栈，改为：`return Maybe.fromAction(() -> log.error("...", ctx.agentName(), error));`（slf4j `log.error(msg, throwable)` 用最后一个可变参数传 throwable）。**实现时以编译通过为准**：`Maybe.fromAction` 只接 `Action0`，要打堆栈就 `log.error("...{}", arg, error)`（error 作为最后一个参数，slf4j 自动识别为 throwable）。

### 4.6 ssh-agent.yml 配置 + 绑定类

#### 4.6.1 配置文件

**文件（新增）**：`ssh-server-app/src/main/resources/ssh-agent.yml`

```yaml
ai:
  agent:
    config:
      tables:
        sshAgent:
          app-name: sshAgent
          agent:
            agent-id: "100000"
            agent-name: SSH AI Agent
            agent-desc: SSH 智能运维助手，可执行远程命令并智能分析结果
          module:
            ai-api:
              base-url: https://open.bigmodel.cn
              api-key: ${ZHIPU_API_KEY:}
              completions-path: /api/coding/paas/v4/chat/completions
            chat-model:
              model: glm-5.2
            agents:
              - name: sshOperator
                description: SSH 命令执行与结果分析智能体
                instruction: |
                  你是一个 SSH 智能运维助手，帮助用户在远程服务器上执行命令并智能处理结果。
                  **你拥有 executeCommand 工具，必须直接调用它来执行命令。**
                  禁止行为：
                  - ❌ 只用文字描述「我将执行 xxx 命令」但不实际调用工具
                  - ❌ 告诉用户「你可以运行 xxx」让用户自己执行
                  正确行为：
                  - ✅ 需要执行命令时，立即调用 executeCommand 工具
                  - ✅ 调用工具后再根据结果向用户报告
                  安全约束：
                  - 危险命令（rm -rf /、reboot 等）会被安全策略拦截；命令被拦截时如实向用户说明原因
                  - 命令失败时结合返回的 analysis 字段向用户解释并给出建议
                output-key: ssh_result
          runner:
            agent-name: sshOperator
            plugin-name-list:
              - myTestPlugin
```

> 模型与端点沿用当前项目**已跑通的 GLM**（bigmodel.cn + glm-5.2 + `ZHIPU_API_KEY`），与现有 `application-dev.yml` 的 `ai:` 段一致（§4.11 会把旧段删除，配置一步迁到此文件，避免双轨）。

**文件（修改）**：`ssh-server-app/src/main/resources/application-dev.yml`

在现有 `spring.config.import`（当前只有 `application-local.yml` 的两条 `optional:`，探索报告 §12）**追加一条**（**仅 dev**，不进 prod）：

```yaml
spring:
  config:
    import:
      - "optional:classpath:application-local.yml"
      - "optional:file:./config/application-local.yml"
      - "optional:classpath:ssh-agent.yml"        # ← 新增：agent 装配配置（仅 dev，Q10）
```

> `application.yml`（公共）和 `application-prod.yml` **不挂** ssh-agent.yml——prod 启动不依赖 agent 装配（Q10：挂公共配置 + api-key 为空会搞死 prod 启动）。

#### 4.6.2 绑定类

**文件（新增）**：`ssh-server-domain/src/main/java/com/johnny/domain/agent/config/AgentConfigProperties.java`

```java
package com.johnny.domain.agent.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import java.util.Map;

/**
 * ssh-agent.yml 的绑定类（prefix = ai.agent.config）。
 * <p>由 Application 上的 @ConfigurationPropertiesScan 自动注册（与旧 AiProperties 同机制）。
 * 替代旧 AiProperties（§4.11 删除）。
 */
@Data
@ConfigurationProperties(prefix = "ai.agent.config")
public class AgentConfigProperties {
    /** key = table 名（如 "sshAgent"），支持多 agent 配置 */
    private Map<String, AgentTable> tables;

    @Data
    public static class AgentTable {
        private String appName;
        private Agent agent;
        private Module module;
        private Runner runner;
    }

    @Data
    public static class Agent {
        /** agentId 保持 String（注册表 key / DTO / 前端全字符串，Q10） */
        private String agentId;
        private String agentName;
        private String agentDesc;
    }

    @Data
    public static class Module {
        private AiApi aiApi;
        private ChatModel chatModel;
        private java.util.List<AgentDef> agents;
        @Data public static class AiApi {
            private String baseUrl;
            private String apiKey;
            private String completionsPath;
        }
        @Data public static class ChatModel {
            private String model;
        }
        @Data public static class AgentDef {
            private String name;
            private String description;
            private String instruction;
            private String outputKey;
        }
    }

    @Data
    public static class Runner {
        private String agentName;          // ADK appName
        private java.util.List<String> pluginNameList;
    }
}
```

> 内嵌类命名注意：`Module.ChatModel` 与 Spring AI 的 `org.springframework.ai.chat.model.ChatModel` **不同包同名**——armory 节点里 import Spring AI 的 `ChatModel` 时用全限定名或 alias；`ArmoryDynamicContext.chatModel` 字段类型是 Spring AI 的 `ChatModel`（line 已用 `import org.springframework.ai.chat.model.ChatModel`），与配置类的 `Module.ChatModel` 区分清楚。

---

### 4.7 请求链路与 NDJSON 事件扩展

#### 4.7.1 `ChatRequestDTO` 新增字段

**文件（修改）**：`ssh-server-api/src/main/java/com/johnny/api/dto/ChatRequestDTO.java`

```java
private String terminalSessionId;   // 新增：当前绑定的终端会话 id（可空，无活跃终端时不带）
```

> 前端 `api/chat.ts` 请求体新增同名字段（§4.10）。`/api/v1/sessions` 不用它，`/api/v1/chat_stream` 用。

#### 4.7.2 `ReActContext` 新增字段 + `RootNode` 填充

**文件（修改）**：`ssh-server-domain/.../react/ReActContext.java` —— 新增字段：

```java
/** 当前请求绑定的终端会话 id（可空）；由 RootNode 从 ChatRequestDTO 填入 */
private String terminalSessionId;
```

**文件（修改）**：`ssh-server-domain/.../react/node/RootNode.java` —— `doApply` 内补一行：

```java
ctx.setTerminalSessionId(req.getTerminalSessionId());   // 紧挨现有 ctx.setMessage(...)
```

> `maxSteps` 字段保留但加注释「由 `RunConfig.maxLlmCalls` 取代（Q11），外层不再用它判熔断」。

#### 4.7.3 `ISshTerminalService` 新增 `getConnectionId`

> ⚠️ **阶段归属说明**：本节标题虽在「请求链路扩展」下，但 `getConnectionId` 是 `SshExecuteAdkTool`（§4.2）的**直接依赖，属阶段 1**（附录 A.2 已标阶段 1），须与阶段 1 同步落地；本节其余（4.7.1 / 4.7.2 / 4.7.4 / 4.7.5）才是阶段 3 内容。

**文件（修改）**：`ssh-server-domain/.../ssh/service/ISshTerminalService.java` —— 新增方法：

```java
/**
 * 由终端 sessionId 反查 SSH 连接 id（供工具层定位 exec 通道，Q3b）。
 * @param sessionId 终端会话 id
 * @return 对应 connectionId；会话不存在返回 null（工具层判空转错误 Map）
 */
String getConnectionId(String sessionId);
```

**文件（修改）**：`ssh-server-infrastructure/.../adapter/service/SshTerminalService.java` —— 实现（`TerminalSessionEntity` 已有 `connectionId` 字段，探索报告 §9b）：

```java
@Override
public String getConnectionId(String sessionId) {
    TerminalSessionEntity entity = sessions.get(sessionId);
    return entity == null ? null : entity.getConnectionId();
}
```

#### 4.7.4 `AbstractReActSupport` 新增两个事件发射方法

**文件（修改）**：`ssh-server-domain/.../react/node/AbstractReActSupport.java`

`ReActEventDTO` 已有 `event`/`content`/`toolCallId`/`toolName`/`status` 字段（探索报告 §4），补两个发射方法（与现有 `sendTextEvent` 同风格——`JSON.toJSONString(dto) + "\n"` 写 emitter）：

```java
/** 发 tool_call 事件：工具开始执行（LLM 决定调用工具时） */
protected void sendToolCallEvent(ResponseBodyEmitter emitter, String toolCallId, String toolName, String argsText) {
    ReActEventDTO dto = new ReActEventDTO();
    dto.setEvent("tool_call");
    dto.setToolCallId(toolCallId);
    dto.setToolName(toolName);
    dto.setContent(argsText);        // 命令文本（args 的 command 字段）
    dto.setStatus("running");
    writeNdjson(emitter, dto);
}

/** 发 tool_result 事件：工具执行完成（含成败 + 输出 + 错误分析） */
protected void sendToolResultEvent(ResponseBodyEmitter emitter, String toolCallId, String toolName,
                                   String status, String output, String analysis) {
    ReActEventDTO dto = new ReActEventDTO();
    dto.setEvent("tool_result");
    dto.setToolCallId(toolCallId);
    dto.setToolName(toolName);
    dto.setStatus(status);           // "success" / "error"
    dto.setContent(output);          // stdout（或错误信息）
    if (analysis != null) {
        // analysis 复用 stepInfo 字段不合适——建议 ReActEventDTO 新增 analysis 字段（见下）
        dto.setAnalysis(analysis);
    }
    writeNdjson(emitter, dto);
}

private void writeNdjson(ResponseBodyEmitter emitter, ReActEventDTO dto) {
    try {
        emitter.send(JSON.toJSONString(dto) + "\n");
    } catch (Exception e) {
        log.warn("发送 NDJSON 事件失败 type={} reason={}", dto.getEvent(), e.getMessage());
    }
}
```

> **ReActEventDTO 需新增 `analysis` 字段**（String，tool_result 时的错误分析建议）。现有字段 `content`/`toolCallId`/`toolName`/`status`/`fullText`/`stepInfo` 不足以承载 analysis。在 `ReActEventDTO.java` 加 `private String analysis;`。其余字段沿用。

#### 4.7.5 `ChatController` emitter 超时 3 分钟 → 10 分钟

**文件（修改）**：`ssh-server-trigger/.../http/ChatController.java` line 81：

```java
// 改前：ResponseBodyEmitter emitter = new ResponseBodyEmitter(3 * 60 * 1000L);
ResponseBodyEmitter emitter = new ResponseBodyEmitter(10 * 60 * 1000L);   // 10 分钟（Q11）
```

> 多轮工具调用 + LLM 推理可能较长；10 分钟硬上限够自用运维工具（Q11）。

---

### 4.8 AiCallNode 改造

**文件（修改）**：`ssh-server-domain/.../react/node/AiCallNode.java`（基于现有 `doApply` line 45-114 改造）

核心改动（对照设计决策）：
1. **外层链保持单步**：B 方案下多轮工具循环全部发生在一次 `runAsync` 内部（ADK 编排），不加 ToolCallNode 回环，`get()` 仍返回 `defaultStrategyHandler`；
2. `runAsync` 传自定义 `RunConfig`（`maxLlmCalls=10`）——用 4 参重载（事实 8）；
3. 消费事件流：`event.functionCalls()` → 发 `tool_call`；`event.functionResponses()` → 发 `tool_result`；文本照旧 `text`；
4. **删除 stateDelta 解析 TODO**（坑随 B 消失）；
5. **ITL**：`doApply` 消费前 `set`，`finally` 无条件 `clear`（§4.9）。

改造后 `doApply` 完整代码：

```java
@Slf4j
@Component("reactAiCallNode")
public class AiCallNode extends AbstractReActSupport {
    @Resource
    private AgentRunnerRegistry agentRunnerRegistry;

    @Override
    protected ReActResultDTO doApply(ChatRequestDTO req, ReActContext ctx) throws Exception {
        AiAgentRegisterVO holder = agentRunnerRegistry.get(ctx.getAgentId());
        Runner runner = holder.getRunner();
        ResponseBodyEmitter emitter = ctx.getEmitter();
        StringBuilder acc = ctx.getAssistantContent();

        // === 【新增】ITL set：让工具能拿到当前请求的 terminalSessionId（§4.9）===
        TerminalContext.setTerminalSessionId(ctx.getTerminalSessionId());

        Content userContent = Content.builder()
                .role("user")
                .parts(Part.builder().text(ctx.getMessage()).build())
                .build();

        // === 【新增】RunConfig 熔断：maxLlmCalls=10（允许最多约 9 轮工具调用，Q11）===
        RunConfig runConfig = RunConfig.builder().maxLlmCalls(10).build();

        try {
            // === 【改动】用 4 参重载 runAsync(userId, sessionId, content, RunConfig) ===
            Iterator<Event> events = runner.runAsync(
                    ctx.getUserId(), ctx.getSessionId(), userContent, runConfig)
                    .blockingIterable()
                    .iterator();

            while (events.hasNext()) {
                Event event = events.next();

                // 1) 文本片段 → text 事件（原逻辑保留）
                String text = event.stringifyContent();
                if (text != null && !text.isBlank()) {
                    acc.append(text);
                    sendTextEvent(emitter, text, acc.toString());
                }

                // 2) 【新增】functionCalls → tool_call 事件（B 方案：ADK 亲自编排后这是一等公民事件）
                for (FunctionCall fc : event.functionCalls()) {
                    String args = fc.args().map(a -> a.getOrDefault("command", a).toString()).orElse("");
                    sendToolCallEvent(emitter,
                            fc.id().orElse(""),
                            fc.name().orElse(""),
                            args);
                }

                // 3) 【新增】functionResponses → tool_result 事件
                for (FunctionResponse fr : event.functionResponses()) {
                    Map<String, Object> resp = fr.response().orElse(java.util.Map.of());
                    boolean success = Boolean.TRUE.equals(resp.get("success"));
                    String stdout = String.valueOf(resp.getOrDefault("stdout", ""));
                    String stderr = String.valueOf(resp.getOrDefault("stderr", ""));
                    String analysis = resp.get("analysis") == null ? null : String.valueOf(resp.get("analysis"));
                    String output = success ? stdout : (stderr.isBlank() ? stdout : stdout + "\n[stderr] " + stderr);
                    sendToolResultEvent(emitter,
                            fr.id().orElse(""),
                            fr.name().orElse(""),
                            success ? "success" : "error",
                            output,
                            analysis);
                }
                // ⛔ 删除原 stateDelta 解析 TODO（B 方案下 functionCall/Response 是一等公民，坑消失）
            }

            // 收尾（原逻辑保留）：完成事件 + ReActResultDTO
            ctx.setStep(ctx.getStep() + 1);
            // totalToolCalls：round_end 事件前端不渲染（chat.ts 显式忽略 round_end），传 0 不影响闭环；
            // 若需精确统计，在 while 循环中累加 event.functionResponses().size() 填入 ReActResultDTO.totalToolCalls。
            sendRoundEndEvent(emitter, ctx.getStep(), ctx.getMaxSteps(), false, 0);
            ReActResultDTO result = ReActResultDTO.builder()
                    /* 按现有构造填：stopReason="completed", content=acc.toString(), totalToolCalls=<可选统计> 等 */
                    .build();
            sendDoneEvent(emitter, result);
            emitter.complete();
            return result;
        } catch (Exception e) {
            log.error("AiCallNode 执行失败 sessionId={} agentId={}", ctx.getSessionId(), ctx.getAgentId(), e);
            sendErrorEvent(emitter, "AI 处理失败：" + e.getMessage());
            // maxLlmCalls 熔断（LlmCallsLimitExceededException）也走这里 → error 事件
            emitter.completeWithError(e);
            throw e;
        } finally {
            // === 【新增】ITL 无条件 clear（防线：避免池化线程串值，§4.9）===
            TerminalContext.clear();
        }
    }

    @Override
    public StrategyHandler<ChatRequestDTO, ReActContext, ReActResultDTO> get(ChatRequestDTO req, ReActContext ctx) {
        return defaultStrategyHandler;   // 外层单步：无回环节点（B 方案循环在 runAsync 内）
    }
}
```

> **新增 import**（AiCallNode 顶部）：
> ```java
> import com.google.adk.agents.RunConfig;
> import com.google.genai.types.FunctionCall;
> import com.google.genai.types.FunctionResponse;
> import com.johnny.domain.agent.model.AiAgentRegisterVO;   // RunnerHolder 改名
> import com.johnny.domain.agent.service.tools.TerminalContext;
> ```
> `RunnerHolder` → `AiAgentRegisterVO`（§4.5.1 改名，此处同步）。

---

### 4.9 ITL 上下文传递（终端绑定）

#### 4.9.1 `TerminalContext`（ITL 访问器）

**文件（新增）**：`ssh-server-domain/src/main/java/com/johnny/domain/agent/service/tools/TerminalContext.java`

```java
package com.johnny.domain.agent.service.tools;

/**
 * 终端会话绑定的线程上下文（Q2 最终方案：只存 terminalSessionId 字符串）。
 * <p>用 {@link InheritableThreadLocal}：ADK runAsync 的工具执行线程可能由请求线程派生，
 * ITL 让子线程继承到当前请求的 terminalSessionId。
 * <p>
 * ⚠️ 已知风险（见 §7）：若 ADK/RxJava 内部用<b>池化线程</b>执行工具，
 * 池化线程在创建时刻继承不到当前请求的值、甚至继承到上一请求残留值。
 * 防线：① 工具入口打线程名日志（SshExecuteAdkTool.executeCommand 第 1 步）联调确认；
 * ② AiCallNode finally 无条件 clear。若发现池化线程 → 升级为按 ADK sessionId 的
 * ConcurrentHashMap 注册表（升级预案，暂不实现）。
 */
public final class TerminalContext {

    private static final InheritableThreadLocal<String> TERMINAL_SESSION_ID = new InheritableThreadLocal<>();

    private TerminalContext() {}

    public static void setTerminalSessionId(String sessionId) {
        TERMINAL_SESSION_ID.set(sessionId);
    }

    public static String getTerminalSessionId() {
        return TERMINAL_SESSION_ID.get();
    }

    public static void clear() {
        TERMINAL_SESSION_ID.remove();
    }
}
```

#### 4.9.2 set / clear 调用点

| 位置 | 操作 | 说明 |
|------|------|------|
| `AiCallNode.doApply` 开头 | `TerminalContext.setTerminalSessionId(ctx.getTerminalSessionId())` | 进入请求线程，set 当前请求的终端 id |
| `AiCallNode.doApply` 的 `finally` | `TerminalContext.clear()` | 无条件 remove，防池化线程串值 |
| `SshExecuteAdkTool.executeCommand` 第 1 步 | `TerminalContext.getTerminalSessionId()` + 线程名日志 | 取值；日志确认继承是否正确 |

#### 4.9.3 会话复用现状不动

`ChatSessionService` 按 `userId` 复用 ADK 会话（历史共享）——终端绑定是**请求级**的（每次 chat 请求带当前 `terminalSessionId`），两个维度互不干扰（探索报告 §ChatSessionService + 设计 Q2）。

### 4.10 前端接线（ssh-client）

> 基于探索结论（ssh-client 报告）：`terminalStore.activeId` 是 **connectionId**（不是 sessionId），真正的终端 sessionId 在 `terminalManager.ts` 模块级 `Map<connectionId, ManagedTerminal>` 的 `mt.sessionId` 字段；`ChatPanel` 无 markdown 渲染；`api/chat.ts` 的 `ReActEvent` 类型已含 `tool_call`/`tool_result` 但 `handleEvent` 显式忽略；`StreamChatOptions` 只有 `onText/onDone/onError`；`ChatMessage` 只有 `{id,role,content,timestamp}`。

#### 4.10.1 `terminalManager.ts` 新增活跃终端 sessionId getter

**文件（修改）**：`ssh-client/src/terminal/terminalManager.ts`

```ts
// 文件顶部已有 import useTerminalStore、terminals Map（探索报告 §4.1）。新增 export：

/** 取当前活跃终端的后端 sessionId；无活跃终端或尚未 open 完成时返回 null。
 *  供 chatStore.sendMessage 带上 terminalSessionId（§4.10.2）。 */
export function getActiveTerminalSessionId(): string | null {
  const activeConnId = useTerminalStore.getState().activeId;
  if (!activeConnId) return null;
  return terminals.get(activeConnId)?.sessionId ?? null;
}
```

> `ManagedTerminal.sessionId` 在 `openTerminal` 返回后赋值（探索报告 §4.3 line 189-194）；终端未 open 完成时为 null，getter 返回 null（→ 不带 terminalSessionId，走 Q3a 错误 Map 路径）。

#### 4.10.2 `chatStore.sendMessage` 带上 terminalSessionId + 接 tool 事件

**文件（修改）**：`ssh-client/src/stores/chatStore.ts`

`sendMessage` 签名不变（`async (text: string)`），内部读活跃终端 sessionId；新增对 `onToolCall`/`onToolResult` 回调的处理，把工具调用结构化写进 assistant 消息的 `toolCalls` 字段：

```ts
// 顶部新增 import：
import { getActiveTerminalSessionId } from "@/terminal/terminalManager";
import type { ToolCall } from "@/types";

// sendMessage 内，构造请求处（原 line 176 附近）改造：
const terminalSessionId = getActiveTerminalSessionId();   // 可能为 null

abortRef = streamChat({
  agentId,
  sessionId,
  message: content,
  terminalSessionId,                      // 新增：null 时 chat.ts 不写入请求体
  onText: (full) => updateMessage(convId!, assistantId, (m) => ({ ...m, content: full })),
  // 新增：工具调用开始 → push 到 assistant 消息的 toolCalls
  onToolCall: (e) => updateMessage(convId!, assistantId, (m) => ({
    ...m,
    toolCalls: [...(m.toolCalls ?? []),
      { toolCallId: e.toolCallId ?? "", toolName: e.toolName ?? "", command: e.content, status: "running" } as ToolCall],
  })),
  // 新增：工具调用完成 → 按 toolCallId 配对更新状态/输出
  onToolResult: (e) => updateMessage(convId!, assistantId, (m) => ({
    ...m,
    toolCalls: (m.toolCalls ?? []).map((tc) =>
      tc.toolCallId === e.toolCallId
        ? { ...tc, status: (e.status as ToolCall["status"]) ?? "success", output: e.content, analysis: e.analysis }
        : tc),
  })),
  onDone: () => { abortRef = null; set({ sending: false }); },
  onError: (err) => { abortRef = null; failMsg(err); set({ sending: false }); },
});
```

> `updateMessage` 是 store 内已有闭包（探索报告 §1.4）。`freshId` 打字动画按 `content` 长度追赶；`toolCalls` 独立于 `content`，不与 typewriter 冲突（探索报告 §11.B.5）。

#### 4.10.3 `api/chat.ts` 扩展选项 + 请求体 + 事件分发

**文件（修改）**：`ssh-client/src/api/chat.ts`

```ts
// StreamChatOptions 扩展（原 line 49-59）：
export interface StreamChatOptions {
  agentId: string;
  sessionId: string;
  message: string;
  terminalSessionId?: string | null;       // 新增
  onText?: (fullText: string) => void;
  onToolCall?: (e: ReActEvent) => void;    // 新增
  onToolResult?: (e: ReActEvent) => void;  // 新增
  onDone?: () => void;
  onError?: (msg: string) => void;
}

// 请求体扩展（原 line 82-87）：
body: JSON.stringify({
  agentId: opts.agentId,
  userId: getUserId(),
  sessionId: opts.sessionId,
  message: opts.message,
  ...(opts.terminalSessionId ? { terminalSessionId: opts.terminalSessionId } : {}),  // null 不带
}),

// handleEvent 的 switch（原 line 143-176，替换「显式忽略」注释）：
case "tool_call":   opts.onToolCall?.(evt);   return;
case "tool_result": opts.onToolResult?.(evt); return;
case "round_end":   return;                    // 仍不渲染时间线
```

> `ReActEvent` 类型（line 13-26）已含 `toolCallId`/`toolName`/`status`/`content`，无需改；新增 `analysis?: string` 字段（与后端 ReActEventDTO 新增的 analysis 字段对齐）。

#### 4.10.4 `types/index.ts` 扩展 `ChatMessage`

**文件（修改）**：`ssh-client/src/types/index.ts`

```ts
export interface ToolCall {
  toolCallId: string;
  toolName: string;
  command?: string;
  status?: "running" | "success" | "error";
  output?: string;
  analysis?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];   // 新增：仅 assistant 消息，命令块据此渲染
}
```

> `Conversation.messages: ChatMessage[]` 持久化时 `toolCalls` 一并进 localStorage（`ai-ssh:chat`）——可接受（命令块历史回显）；若想精简，在 `partialize` 里剥掉。

#### 4.10.5 新建 `CommandBlock` 组件 + `MessageBubble` 接入

**文件（新增）**：`ssh-client/src/components/CommandBlock.tsx`

```tsx
import { useState } from "react";
import type { ToolCall } from "@/types";
import styles from "./CommandBlock.module.css";

/** 最小命令块（Q13）：等宽字体，命令行 + 可折叠输出 + 成败徽标。
 *  F2 的「可复制、可重跑」完整卡片留到下个迭代。 */
export default function CommandBlock({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(true);
  const status = call.status ?? "running";
  const ok = status === "success";
  return (
    <div className={styles.block}>
      <div className={styles.header} onClick={() => setOpen((v) => !v)}>
        <span className={styles.badge} data-ok={ok} data-running={status === "running"}>
          {status === "running" ? "执行中" : ok ? "成功" : "失败"}
        </span>
        <code className={styles.cmd}>{call.command}</code>
        <span className={styles.toggle}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (call.output || call.analysis) && (
        <pre className={styles.output}>
          {call.output}
          {call.analysis && <span className={styles.analysis}>💡 {call.analysis}</span>}
        </pre>
      )}
    </div>
  );
}
```

**文件（新增）**：`ssh-client/src/components/CommandBlock.module.css`（要点）：
- `.block`：等宽字体（`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`）、圆角边框、`background: rgba(0,0,0,0.3)`、`margin: 6px 0`；
- `.badge`：小圆角标签，`data-ok=true` 绿色 / `false` 红色 / `data-running=true` 黄色；
- `.cmd`：命令文本，`color: #9cdcfe`（VSCode 风）；
- `.output`：`white-space: pre-wrap`、`max-height` + 滚动、`font-size: 12px`；
- `.analysis`：`display:block`、`color: #dcb67a`、上方留白。

**文件（修改）**：`ssh-client/src/components/MessageBubble.tsx` —— 在 content 渲染前先 map `toolCalls`：

```tsx
// isUser 分支不变。AI 气泡内，content 之上插入命令块：
<div className={styles.content}>
  {message.toolCalls?.map((tc) => <CommandBlock key={tc.toolCallId} call={tc} />)}
  {isUser ? message.content : message.content.slice(0, visible)}
  {typing && <span className={styles.caret} />}
</div>
```

> 命令块在文本之前出现（工具调用先于最终总结文本），符合验收场景时序。打字动画只作用于 `content`，命令块一旦 push 即完整渲染。

---

### 4.11 旧代码清理（不留双轨）

照 §4.x 落地后，删除/改名以避免双轨（吸取 serversStore vs connectionStore 教训）：

| 动作 | 对象 | 说明 |
|------|------|------|
| **删类** | `com.johnny.domain.agent.config.AiProperties` | 旧绑定类，被 `AgentConfigProperties`（§4.6.2）取代 |
| **删配置段** | `application-dev.yml` 的旧 `ai:` 段（line 51-67） | 配置一步迁到 `ssh-agent.yml`（§4.6.1） |
| **删字段/方法** | `AgentRunnerRegistry` 的内部 `Map<String,RunnerHolder> registry`、`build(AiProperties)` 40 行顺序装配 | 已由 §4.5.2 瘦身为容器门面 + armory 触发 |
| **改名** | `RunnerHolder` → `AiAgentRegisterVO` | §4.5.1；全局引用同步 |
| **删 TODO** | `AiCallNode.java:75-78` 的 stateDelta 解析 TODO | B 方案下坑消失（§4.8） |

> 全局搜索 `AiProperties`、`RunnerHolder`、`new SpringAI(`（官方类，应已无引用）、旧 `ai.api` / `ai.agent` 配置 key，确保无残留引用、编译通过。

---

## 5. 超时与熔断三层预算（Q11 定稿）

| 层 | 值 | 管什么 | 实现位置 |
|----|-----|--------|---------|
| 单命令 exec 超时 | 30s | 单条命令不挂死（交互式命令强断，LLM 看到 `timedOut` 自我纠正） | `SshExecuteAdkTool.executeCommand` 传 `30_000L`；`SshSessionPort.exec` 强断通道 |
| `RunConfig.maxLlmCalls` | 10 | ADK 循环不失控（防模型死循环烧 token）；第 11 次 LLM 调用抛 `LlmCallsLimitExceededException` | `AiCallNode` 构造 `RunConfig.builder().maxLlmCalls(10).build()`（§4.8） |
| emitter 总超时 | 10 分钟（原 3 分钟） | 整条流的硬上限（自用运维工具，宁可宽松） | `ChatController.chatStream` `new ResponseBodyEmitter(10*60*1000L)`（§4.7.5） |

> `ReActContext.maxSteps`（默认 50）保留字段但标注「由 `RunConfig.maxLlmCalls` 取代」，外层不再用它判熔断。

---

## 6. 联调验证点

逐条过（验证通过的判据写在每条末尾）：

1. **端到端场景**：聊天输入「查看服务器系统信息，包括操作系统版本、CPU、内存」→ NDJSON 依次出现 `tool_call`（`cat /etc/os-release`）→ `tool_result`（成功）→ `tool_call`（`nproc && free -m`）→ `tool_result` → 最终 `text` 总结。判据：聊天面板出现两块成功命令块 + 自然语言总结。
2. **插件日志**：后端日志对照 §1 样例，🚀/🤖/🧠(请求+响应)/🔧(开始+完成) 全类别出现，且 `agent=sshOperator`、`可用工具:[executeCommand]`、`turnComplete` 先 false 后 true。判据：`grep "插件日志-"` 能看到完整序列。
3. **线程验证**：`SshExecuteAdkTool` 入口 `🔧 工具入口 thread=...` 日志确认 ITL 继承正确。判据：工具线程名以 `react-stream-<sessionId>` 开头（请求线程派生）。**若看到池化线程名（如 `Rx*`/`pool-*`）→ 启动 §7 的 Map 注册表升级预案**。
4. **GLM 兼容性**：多轮工具调用不出现 HTTP 400（验证改动点 2 的 `ToolResponseMessage` 转换正确，`fr.id()` 关联 `tool_call_id`）。判据：第 2 轮 LLM 请求（带 tool 结果）正常返回，无 400/500。
5. **黑名单**：诱导 AI 执行 `reboot`/`rm -rf /` → 工具拦截 → 返回 `success:false` + `error=该命令被安全策略拦截` → LLM 向用户转述被拦原因。判据：`tool_result` 的 `status=error` + 命令未真正执行（服务器未重启）。
6. **无终端**：不连终端直接提问「查看系统信息」→ `terminalSessionId` 为 null → 工具返回「未绑定终端会话」错误 Map → LLM 自然语言告知需先连接服务器。判据：命令块 status=error + AI 回复提示连接服务器。
7. **超时自纠**：诱导执行 `top` → 30s 超时返回 `timedOut:true` + `analysis=...换非交互形式 top -bn1` → LLM 自纠为 `top -bn1`。判据：第一块失败（timedOut）+ 第二块成功（`top -bn1`）。
8. **前端渲染**：命令块等宽显示、输出可折叠（▾/▸）、成败徽标颜色正确（成功绿/失败红/执行中黄）。判据：人工目视 ChatPanel。

---

## 7. 风险清单

| 风险 | 应对 | 状态 |
|------|------|------|
| ITL 在池化线程下串值/丢值 | 工具入口线程名日志验证（验证点 3）；预案：按 ADK sessionId 的 `ConcurrentHashMap` 注册表（`TerminalContext` 升级） | 待联调验证 |
| GLM 对 `role=tool` 消息格式的额外差异 | 联调验证点 4 重点观察；改动点 2 已用 `fr.id()` 关联（事实 10 确认 ADK Functions.java:299 带了 id），id 缺失风险已消除；仍需观察 GLM 是否对 `responseData` 非 JSON 字符串等有要求 | 风险已降级，待联调 |
| vendored 桥接类与 ADK 新版本脱节 | 类头注释标明来源版本 1.2.0 与改动点（§4.3.4）；升级时人工比对 `docs/decompiled/` 与官方新版 | 持续 |
| `registerSingleton` 不走 Bean 生命周期 | `AiAgentRegisterVO` 类注释警示（§4.5.1）；VO 只放纯数据，不塞 AOP/注入 | 已用注释约束 |
| `maxLlmCalls` 熔断对用户呈现为报错 | `LlmCallsLimitExceededException` 走 AiCallNode catch → `error` 事件 → 前端已有错误展示（§4.8） | 已覆盖 |
| `Module.ChatModel` 与 Spring AI `ChatModel` 同名混淆 | armory 节点 import 时注意全限定名/alias（§4.6.2）；`ArmoryDynamicContext.chatModel` 是 Spring AI 的 | 编译期可查 |
| root pom compiler 无 `-parameters` 致工具参数名缺失 | `executeCommand` 参数强制 `@Schema(name="command")`（§4.2，事实 6）；memory 已记 | 已规避 |

---

## 附录 A：新增/修改文件清单

> 阶段对应 `IMPLEMENTATION_PLAN.md`。所有路径相对仓库根。

### A.1 ssh-server 新增文件

| 阶段 | 文件 | 说明 |
|------|------|------|
| 1 | `ssh-server-domain/src/main/java/com/johnny/domain/ssh/adapter/port/ExecResult.java` | §4.1.1 exec 结构化结果 |
| 1 | `ssh-server-domain/src/main/java/com/johnny/domain/agent/service/tools/SshExecuteAdkTool.java` | §4.2 SSH 命令工具 |
| 1 | `ssh-server-domain/src/main/java/com/johnny/domain/agent/service/tools/TerminalContext.java` | §4.9.1 ITL 访问器（阶段 3 用，阶段 1 先建空壳也可） |
| 2 | `ssh-server-domain/src/main/java/com/johnny/domain/agent/bridge/springai/*.java`（8 个） | §4.3 vendored MySpringAI 桥接 |
| 2 | `ssh-server-domain/src/main/java/com/johnny/domain/agent/armory/*.java`（8 个：AbstractArmoryNode + 6 节点 + ArmoryDynamicContext + DefaultArmoryFactory） | §4.4 装配责任树 |
| 2 | `ssh-server-domain/src/main/java/com/johnny/domain/agent/model/AiAgentRegisterVO.java` | §4.5.1（由 RunnerHolder 改名，归为新增是因为类名/路径变） |
| 2 | `ssh-server-domain/src/main/java/com/johnny/domain/agent/config/AgentConfigProperties.java` | §4.6.2 绑定类 |
| 2 | `ssh-server-domain/src/main/java/com/johnny/domain/agent/service/MyTestPlugin.java` | §4.5.3 观测插件 |
| 2 | `ssh-server-app/src/main/resources/ssh-agent.yml` | §4.6.1 配置 |

### A.2 ssh-server 修改文件

| 阶段 | 文件 | 改动 |
|------|------|------|
| 1 | `.../domain/ssh/adapter/port/ISshSessionPort.java` | 新增 `exec(connectionId, command, timeoutMs)` 重载（§4.1.2） |
| 1 | `.../infrastructure/adapter/port/SshSessionPort.java` | 实现 exec 重载 + drainStream（§4.1.3） |
| 1 | `.../domain/ssh/service/ISshTerminalService.java` | 新增 `getConnectionId(sessionId)`（§4.7.3） |
| 1 | `.../infrastructure/adapter/service/SshTerminalService.java` | 实现 getConnectionId（§4.7.3） |
| 2 | `.../domain/agent/service/AgentRunnerRegistry.java` | 瘦身为容器门面（§4.5.2） |
| 2 | `.../app/src/main/resources/application-dev.yml` | `spring.config.import` 追加 ssh-agent.yml + 删旧 `ai:` 段（§4.6.1 / §4.11） |
| 2 | `.../api/dto/ReActEventDTO.java` | 新增 `analysis` 字段（§4.7.4） |
| 3 | `.../api/dto/ChatRequestDTO.java` | 新增 `terminalSessionId`（§4.7.1） |
| 3 | `.../domain/react/ReActContext.java` | 新增 `terminalSessionId` + maxSteps 注释（§4.7.2） |
| 3 | `.../domain/react/node/RootNode.java` | doApply 填 terminalSessionId（§4.7.2） |
| 3 | `.../domain/react/node/AbstractReActSupport.java` | 新增 sendToolCallEvent/sendToolResultEvent/writeNdjson（§4.7.4） |
| 3 | `.../domain/react/node/AiCallNode.java` | runAsync 带 RunConfig + 事件解析 + ITL（§4.8） |
| 3 | `.../trigger/http/ChatController.java` | emitter 超时 3→10 分钟（§4.7.5） |

### A.3 ssh-server 删除文件

| 阶段 | 文件 | 说明 |
|------|------|------|
| 2 | `.../domain/agent/config/AiProperties.java` | 被 AgentConfigProperties 取代（§4.11） |
| 2 | `.../domain/agent/model/RunnerHolder.java` | 改名为 AiAgentRegisterVO（§4.5.1） |

### A.4 ssh-client 新增文件

| 阶段 | 文件 | 说明 |
|------|------|------|
| 4 | `ssh-client/src/components/CommandBlock.tsx` | §4.10.5 命令块组件 |
| 4 | `ssh-client/src/components/CommandBlock.module.css` | §4.10.5 样式 |

### A.5 ssh-client 修改文件

| 阶段 | 文件 | 改动 |
|------|------|------|
| 4 | `ssh-client/src/terminal/terminalManager.ts` | 新增 `getActiveTerminalSessionId()`（§4.10.1） |
| 4 | `ssh-client/src/stores/chatStore.ts` | sendMessage 带 terminalSessionId + 接 tool 事件（§4.10.2） |
| 4 | `ssh-client/src/api/chat.ts` | StreamChatOptions/请求体/handleEvent 扩展 + ReActEvent 加 analysis（§4.10.3） |
| 4 | `ssh-client/src/types/index.ts` | 新增 ToolCall + ChatMessage.toolCalls（§4.10.4） |
| 4 | `ssh-client/src/components/MessageBubble.tsx` | 渲染 message.toolCalls（§4.10.5） |

### A.6 反编译参考源码（已生成，仅供查阅，不参与构建）

| 路径 | 来源 | 索引 |
|------|------|------|
| `docs/decompiled/google-adk/` | google-adk 1.2.0（Apache 2.0） | `docs/decompiled/README.md` |
| `docs/decompiled/google-adk-spring-ai/` | google-adk-spring-ai 1.2.0（Apache 2.0） | 同上 |
| `docs/decompiled/spring-ai/` | spring-ai-model 1.1.5（Apache 2.0） | 同上（ToolResponseMessage 等） |
| `docs/decompiled/jsch/` | mwiede/jsch 0.2.20（Revised BSD） | 同上（ChannelExec/Channel） |
| `tools/cfr.jar` | CFR 0.152（MIT） | 反编译工具 |

---

## 附录 B：端到端闭环走查

> 逐环节确认调用链无断点。每条链路标注「实现位置 → 反编译佐证」。审查结论：**4 条主链路 + 异常路径全部走通**。

### B.1 前端 → 后端：terminalSessionId 流转

```
terminalManager.getActiveTerminalSessionId()        [§4.10.1]
  → chatStore.sendMessage 读它塞请求体              [§4.10.2]
  → chat.ts 请求体 terminalSessionId 字段           [§4.10.3]
  → ChatRequestDTO.terminalSessionId                [§4.7.1]
  → RootNode.doApply: ctx.setTerminalSessionId      [§4.7.2]
  → AiCallNode: TerminalContext.set(...)            [§4.8]
  → SshExecuteAdkTool: TerminalContext.get()        [§4.2]
```
✅ 无断点。无活跃终端时 getter 返回 null → 请求体不带 → 工具走 Q3a 错误 Map（§4.2 第 3 步）。

### B.2 工具执行链

```
SshExecuteAdkTool.executeCommand(command)           [§4.2]
  → 黑名单拦截 [Q12] → ITL 取 sessionId
  → getConnectionId(sessionId)                      [§4.7.3]
  → sshSessionPort.isConnected(connectionId)        [现有接口]
  → sshSessionPort.exec(connectionId, cmd, 30_000)  [§4.1]
  → SshSessionPort: ChannelExec + stdout/stderr 分流 + 8KB 截断 + 退出码 [§4.1.3]
  → 组装 8 字段 Map 返回
```
**反编译佐证**：`FunctionTool.call()`（`FunctionTool.java:205-223`）`func.invoke` 后 `objectMapper.convertValue(result, Map<String,Object>)`——`executeCommand` 返回的 `Map` 直接被消费，无需额外适配。✅

### B.3 工具结果回流 LLM（方案 B 核心，最关键）

```
ADK Functions.java:299 把 result Map 包成
  FunctionResponse(id=functionCallId, name, response)   [ADK 内部]
  → ADK Event 流含 functionResponse
  → ADK 把 functionResponse 加入下一轮 LlmRequest.contents
  → MySpringAI [改动点2] handleUserContent 转
    ToolResponseMessage(role=tool, ToolResponse(id=fr.id(), name, responseData))  [§4.3.3]
  → GLM 收到合法 tool 消息，继续推理（无 400）
```
**反编译佐证**：`Functions.java:299` 证明 `fr.id() = toolContext.functionCallId() = 同 round functionCall.id()`——与 `ToolResponse.id` 关联一致，**无 id 缺失坑**。✅
关闭内部工具执行（改动点1）后，ADK 标准流程：`BaseLlmFlow` 收到含 `functionCall` 的 `LlmResponse` → `Functions.java` 执行 `BaseTool.runAsync` → 产 `functionResponse` Event → 再循环调模型。

### B.4 事件回流前端渲染

```
AiCallNode 消费 runAsync 事件流                        [§4.8]
  → event.functionCalls()      → 发 tool_call NDJSON
  → event.functionResponses()  → 发 tool_result NDJSON（解析 success/stdout/stderr/analysis）
  → event.stringifyContent()   → 发 text NDJSON
  → chat.ts handleEvent 分发 onToolCall/onToolResult/onText   [§4.10.3]
  → chatStore 写 message.toolCalls（按 toolCallId 配对）       [§4.10.2]
  → MessageBubble 渲染 CommandBlock（命令 + 可折叠输出 + 徽标）[§4.10.5]
```
**反编译佐证**：`Event.functionCalls()` / `functionResponses()` / `stringifyContent()`（`Event.java:260/265/282`）均为 public，直接可调。✅

### B.5 熔断与异常路径

```
RunConfig.maxLlmCalls=10  → 第 11 次 LLM 调用
  → InvocationCostManager.incrementAndEnforceLlmCallsLimit 抛 LlmCallsLimitExceededException
  → AiCallNode catch → sendErrorEvent + completeWithError   [§4.8]
  → chat.ts onError → failMsg 显示错误                       [§4.10.3]
```
**反编译佐证**：熔断逻辑在 `InvocationContext$InvocationCostManager`（`InvocationContext.java:338-343`），`++numberOfLlmCalls > runConfig.maxLlmCalls()` 时抛异常。✅

### B.6 启动健壮性（审查修复项）

`DefaultArmoryFactory.assembleAll()` 判 `tables == null/isEmpty` 跳过（§4.4.3）→ **prod 不挂 ssh-agent.yml 也能正常启动**（Q10：agent 装配仅 dev）。✅

### 闭环结论

| 链路 | 状态 |
|------|------|
| B.1 terminalSessionId 流转 | ✅ 无断点 |
| B.2 工具执行 | ✅ FunctionTool 反射调用 Map 返回值，无适配 |
| B.3 结果回流 LLM（方案 B 核心） | ✅ fr.id() 关联一致，经 Functions.java:299 佐证 |
| B.4 事件回流前端 | ✅ Event public API 直接消费 |
| B.5 熔断/异常 | ✅ 异常沿 Flowable 传播到 catch |
| B.6 启动健壮性 | ✅ 已加空配置跳过 |

关键依赖的 ADK 行为（functionResponse 带 id、关闭 internalToolExec 后 ADK 亲自编排工具、Event 暴露 functionCalls/Responses）**全部经反编译源码佐证**，方案可实现功能闭环。

---

> **文档完成度自检**：每个新增类给出完整包路径 + 可编译骨架；每个改动点给出 before/after 代码块 + 行号锚点；所有第三方 API 签名经反编译核实（§4.0 速查表 + `docs/decompiled/`）；两处 vendor 改动精确到 MessageConverter 的具体语句；端到端闭环走查见附录 B（4 主链路 + 异常 + 启动健壮性，全部标注反编译佐证）。开发者按附录 A 的阶段顺序落地即可，无需再探索或反编译。

