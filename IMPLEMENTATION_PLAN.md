# IMPLEMENTATION_PLAN — Review 修复四批次

> 来源：2026-07-19 整体 review + grill 会话定稿。全部阶段完成后删除本文件。
> 开发方式：跳过严格 TDD；纯逻辑改动补单测（黑名单正则、latch、store 用例），UI/装配类手动验证。
> 最终验收：全部批次完成后用 Playwright 驱动（single 后端 + vite 前端）做端到端验证。
> 明确不做：H2 凭据明文回传（用户决定暂缓）；conv.agentId 与全局 agentId 不一致（等多 agent 场景）；
> 消息级思考的 D2 双 Runner 方案（记入功能池，D1 全局标志够用）；删除对话时清理后端 ADK 会话（留 TODO）。

## 阶段 1：启动体验（P1 状态闪跳 + P2 agents 竞态）

**目标**：
- P1 方案 d+ii：连接 status 不再持久化——`SshConnectionEntity` 删 status 字段与 markConnected/markDisconnected，
  mapper/schema 删 status 列，`SshConnectionController` 的 list/get 组装 DTO 时用 `sshConnectionService.isConnected()`
  实时计算（0/1 编码不变，前端零改动）
- P2 方案 b：`AgentRunnerRegistry` 加"首次装配已结束（成功或缺 key 跳过）"CountDownLatch，
  `listAgents()` 先 await（10s 超时）再返回
- ChatPanel 三空态：订阅 readyStatus（checking→"启动中"/fail→重试）；ready 且 agents 空时查 llm-config
  的 apiKeyConfigured 区分"请先配置模型"引导 vs "加载失败+重试"
- chatStore：loadAgents 去掉 agents.length>0 守卫（总是重拉）、加 agentsError 状态
- waitForReady 超时 30s→60s；TerminalPanel 心跳改 Promise.allSettled 并行

**验收标准**：重启后端后前端连接列表不再闪现"已连接"；后端启动窗口期 ChatPanel 显示启动中而非空白；
single 无 key 时显示配置引导；既有 vitest/surefire 全绿

**状态**：已完成（Playwright 终验待做）

## 阶段 2：执行安全（H1 停止真停 + P3 终端提示）

**目标**：
- H1 方案 a：`ReActContext` 加 cancelled 标志；ChatController 给 emitter 挂 onError/onTimeout/onCompletion 置位；
  `writeNdjson` 发送失败置位；AiCallNode 事件循环检查标志 break + iterator 强转 Disposable 后 dispose
- ChatController 裸 new Thread → 有界共享线程池（核 4 / 上限 16，拒绝时 emitter 报错）
- 前端：ChatInputBar 发送按钮 sending 期间变形为停止按钮；stop() 把 running 的 toolCalls 标记为 error（"已停止"）
- P3 方案 a：ChatPanel 输入框上方常驻警示条（无绑定终端时），可点击跳转连接面板；显隐条件与 sendMessage 判定同源
- Q8b 方案 b：无 terminalSessionId 时 AiCallNode 在用户消息后追加系统提示，模型直接文字回答不试探工具
- 顺手：黑名单补 `-[a-z]*f[a-z]*r` 变体；ReActContext maxSteps 50→10

**验收标准**：流式中点停止后服务端日志确认循环中断、无后续工具执行；无终端时警示条显示、发消息一轮内得到
"请先连接"回答；黑名单单测含 rm -fr 变体

**状态**：未开始

## 阶段 3：会话隔离（H3）

**目标**：`ChatSessionService` 删 userSessions 复用 map，createSession 每次真建新 ADK 会话；
前端 conversation ↔ 后端 session 一一对应；会话清理留 TODO 注释

**验收标准**：两个前端对话各自 createSession 得到不同 sessionId；新对话不携带旧对话上下文

**状态**：未开始

## 阶段 4：消息级深度思考按钮（D1）

**目标**：
- `ChatRequestDTO` 加 thinkingEnabled（默认 false）→ RootNode 填入 ReActContext → AiCallNode 在 runAsync 前
  写入 ThinkingContext 全局标志（finally 清除，正确性依赖前端全局 sending 锁保证单流）
- AiApiNode 拦截器读标志：false（默认）注入 thinking.type=disabled（仅 GLM，现状）；true 不注入
- 前端：ChatInputBar 加"深度思考"切换按钮，逐条消息不粘滞（发送后回落为关）；chat.ts 请求体带上标志

**验收标准**：默认行为与现状完全一致（请求体含 thinking.disabled）；按钮开启的那条消息请求体不含 thinking 字段；
手动跑一次开思考 + SSE 流式对话确认无解析异常

**状态**：未开始

## 最终验收：Playwright 端到端

启动 single profile 后端 + vite 前端，用 Playwright 验证：
1. 后端未就绪期 ChatPanel/连接面板的等待态；就绪后 agents 正常渲染
2. 连接列表冷启动不闪"已连接"
3. 无终端时警示条显示
4. 停止按钮在 sending 期间出现
5. 深度思考按钮可切换且发送后回落

**状态**：未开始
