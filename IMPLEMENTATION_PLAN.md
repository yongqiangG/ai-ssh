# IMPLEMENTATION_PLAN — Tool 调用最小闭环

> 方案与全部决策见 `docs/TOOL-CALLING-DESIGN.md`（2026-07-13 grill 会话定稿）。
> 开发方式：跳过 TDD 流程直接落代码；纯逻辑单测在阶段 4 前作为收尾补充，非阻塞。
> 阶段①②名称出自 grill 会话定稿（原文在此处截断），③④按依赖顺序补全。
> 所有阶段完成后删除本文件。

## 阶段 1：exec 端口 + 工具类

**目标**：
- `ISshSessionPort` 新增 `exec(connectionId, command, timeoutMs)` + `ExecResult`（stdout/stderr/exitCode/timedOut）；`SshSessionPort` 用一次性 JSch `ChannelExec` 实现（30s 超时强断、stdout/stderr 分开采集、各截 8KB 带 truncated 标记）
- `ISshTerminalService` 新增 `String getConnectionId(String sessionId)`，`SshTerminalService` 实现
- `SshExecuteAdkTool`（`domain/agent/service/tools`，Spring `@Component`）：`@Annotations.Schema` 描述 `executeCommand`；黑名单拦截 → ITL 取 sessionId → 换 connectionId → `isConnected` 校验 → exec → 组装 8 字段 Map；`analyzeFailure` 5 条规则；永不抛异常；入口打线程名日志

**验收标准**：
- 对着 dev 环境真实 SSH 连接手工调用工具方法：正常命令返回 `success:true` + 真实 exitCode；`top` 触发 30s 超时返回 `timedOut:true`；大输出被截断且 `truncated:true`
- 黑名单命令（`reboot` 等）不执行、返回拦截错误 Map；未绑定终端/SSH 断开返回对应错误 Map

**测试用例**（补充单测，非阻塞）：`analyzeFailure` 5 条规则命中/不命中；黑名单正则匹配；8KB 截断边界

**状态**：未开始

## 阶段 2：armory 装配责任树 + MySpringAI + 配置

**目标**：
- vendor `MySpringAI` + `MessageConverter` 到 `domain/agent/bridge`（基于官方 1.2.0，改两处：`internalToolExecutionEnabled(false)`、functionResponse→`ToolResponseMessage`，类头注释标明）
- `domain/agent/armory`：`DefaultArmoryFactory` 发起 `ArmoryRootNode → AiApiNode → ChatModelNode → AgentNode → AgentWorkflowNode（占位直通）→ RunnerNode` 责任树，复用 `AbstractStrategyRouter`/`StrategyHandler` 引擎 + `ArmoryDynamicContext`；disableThinking 拦截器迁入 `AiApiNode`；`AgentNode` 注入 `MySpringAI` + `FunctionTool.create(sshExecuteAdkTool, "executeCommand")`
- `RunnerNode`：按 `plugin-name-list` getBean 注册插件 → 包成 `AiAgentRegisterVO`（`RunnerHolder` 改名，注明 registerSingleton 不走 Bean 生命周期）→ `registerSingleton("aiAgentRunner_" + agentId, vo)`
- `MyTestPlugin`：`@Component("myTestPlugin")` 继承 `BasePlugin`，9 回调（7 常规 + 2 错误）全 `Maybe.empty()` 旁观打日志
- `ssh-agent.yml`（GLM 定稿内容）+ `@ConfigurationProperties(prefix = "ai.agent.config")` 绑定类；`application-dev.yml` 仅 dev `spring.config.import`
- 清理：删 `AiProperties` 与旧 `ai:` 配置段；`AgentRunnerRegistry` 瘦身为容器查询门面（get/listAgents 走容器，三个消费方不改）

**验收标准**：应用启动成功，日志可见装配链逐节点执行；容器中存在 `aiAgentRunner_100000`；`GET /api/v1/agents` 返回新 agent（id=100000）；旧配置无残留引用、编译通过

**测试用例**（补充单测，非阻塞）：配置绑定类装载 `ssh-agent.yml` 结构正确

**状态**：未开始

## 阶段 3：运行链路改造（AiCallNode + 事件 + ITL + 超时）

**目标**:
- `ChatRequestDTO` 加 `terminalSessionId`；`RootNode` 填入 `ReActContext`
- `ReActEventDTO` 新增 `tool_call` / `tool_result` 事件类型
- `AiCallNode`：`runAsync` 传 `RunConfig`（`maxLlmCalls=10`）；解析 `event.functionCalls()` → 发 `tool_call`、`functionResponses()` → 发 `tool_result`；删 stateDelta TODO；ITL set / finally remove；`ReActContext.maxSteps` 标注被取代
- `ChatController` emitter 超时 3 分钟 → 10 分钟

**验收标准**：curl 模拟带 `terminalSessionId` 的 chat 请求，NDJSON 流中出现 `tool_call`/`tool_result` 交替与最终 `text`；后端日志出现 9 类插件日志（对照设计文档第 1 节样例）；GLM 多轮工具调用无 400；工具入口线程名日志确认 ITL 继承正常（若为池化线程 → 触发 Map 注册表升级预案）

**测试用例**：手工联调为主（app 模块 surefire 被跳过）

**状态**：未开始

## 阶段 4：前端接线 + 端到端联调

**目标**：
- `chatStore.sendMessage` 从 `terminalStore` 取活跃终端 sessionId 塞请求体（无活跃终端不带）
- `ChatPanel` 解析 `tool_call`/`tool_result`，渲染最小命令块（等宽字体：命令 + 可折叠输出 + 成败徽标）
- 补充单测收尾（阶段 1/2 遗留项）

**验收标准**：桌面端输入「查看服务器系统信息，包括操作系统版本、CPU、内存」→ 聊天面板实时出现命令块（成功徽标）→ 最终自然语言总结；无终端时提问 → AI 告知先连接服务器；诱导 `reboot` → AI 转述被安全策略拦截；诱导 `top` → 超时后 AI 自纠为 `top -bn1`

**测试用例**：`npm run test:run` 全绿（chatStore 事件解析新增用例）；设计文档第 6 节 8 项联调验证点逐条过

**状态**：未开始
