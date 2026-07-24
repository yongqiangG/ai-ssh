# 260723-ai-session-lifecycle：AI 会话生命周期整改 + 未连接终端卡片优化

## 原始需求（用户原话）

1. 保存模型配置会热重建 Runner，已有 ADK 内存会话也会失效，目前没有同步清理前端 sessionId。
2. 重启后看起来是在继续旧对话，模型实际上没有旧上下文。
3. 当前 chat panel 有一个卡片展示，"未连接终端，AI 无法执行命令——纯问答不受影响，点击此处连接服务器"，由于点击时是展开服务器列表，在展开的情况下，很像是点击了没反应。需要优化一下。

## 背景（决策时事实）

- ADK Session 存于 InMemorySessionService，sidecar 重启 / Runner 热重建即失，前端 localStorage 里的对话历史与后端上下文天然可脱节。
- 前端 sessionId 本就不持久化，但对话本身持久化且重启后可直接续聊——造成「假继续」。
- `AgentRunnerRegistry.rebuild()` 每次保存配置都无条件执行，即使配置没变。
- ADK 1.2.0 找不到会话时异常文案为 `"Session not found: %s for user %s"`（jar 内实证）。
- BootSplash 已有 CSS div 吉祥物 `Mascot`（thinking/happy/dead 三心情）；项目已有主题统一的 `ConfirmDialog` 组件。

## 决议

### 修复共识（2026-07-23）

- **暂不持久化 ADK Session，也不回放前端历史**——UI 允许发送就必须拥有真实有效的后端上下文；理由：半真半假的上下文比明确的「历史只读」更危险（可能脱离旧上下文执行命令）。
- **历史会话只读保留**：系统不删除、不允许直接续聊（用户手动删除仍可）。
- **历史提示展示**：「历史会话暂不支持继续对话」+「上下文恢复正在加速适配中」+ 机器人动画 + 「新建对话」按钮。
- **应用冷启动**：有消息的旧对话全部转只读历史；空对话移除；自动创建并选中空白新对话。
- **模型配置确实变化时**：保存前提示将结束所有 AI 会话；AI 正在回复 / 执行工具 / 等待确认时禁止保存；确认且后端保存、热重载成功后，归档所有非空对话并新建空白对话。
- **配置无实际变化时**：不重建 Runner、不写库、不影响会话（后端 `sameConfig`/`runnerReloadRequired` 判定为真相之源）。
- **sidecar 意外重启导致 Session not found**：后端返回机器码 `AI_SESSION_EXPIRED`（`ReActEventDTO.code`）；前端归档全部活动对话并新建空白对话；**不自动重发**失败消息（避免脱离旧上下文执行命令）。
- **排除项**：「引用历史开启新对话」与真正的 Session 持久化留待后续，不混入本轮。

### Grill 补充决议（2026-07-24 核实后拷问）

1. **Q1 密钥残留**：`LlmEndpointManualTest` 硬编码的真实 key 清空（临时 key 不轮换），保留 deepseek 中转端点默认值——恢复 `assumeTrue` 空 key 跳过机制，domain 测试回绿。
2. **Q2 僵尸 toolCall**：归档口清理——`archiveConversation` 转 history 时把 `running`/`pending_confirm` 的 toolCall 置为 error；理由：「历史」不该携带「进行中」，一次修掉保存锁死与永远转圈两个症状。
3. **Q3 冷启动横幅**：`partialize` 保留对话真实 `contextStatus`（恢复口归档兜底不变），`merge` 仅当持久化数据里存在非空非 history 对话时弹「应用已重新启动」横幅；理由：横幅只在真发生归档的那次启动有信息量，每次必弹是噪音。
4. **Q4 历史 footer**：补「新建对话」按钮；动画不进 footer（每次切历史都蹦跳太吵），只留横幅。
5. **Q5 机器人形象**：共识中「现有 SVG 跑动机器人」实际不存在——复用 BootSplash 的 `Mascot`（抽为共享组件），删除本次新画的内联 SVG；理由：产品只留一个吉祥物形象。
6. **Q6 卡片反馈**：layoutStore 加一次性 `attentionPulse` 信号，点击卡片后服务器列表播 ~600ms 高亮脉冲（reduced-motion 跳过）；理由：已展开场景下四个 layout 写入全幂等，必须有独立于状态翻转的注意力反馈。
7. **Q7 确认弹窗**：`window.confirm` 换项目 `ConfirmDialog`（扩展可选按钮文案），保存流程拆两段；理由：ConfirmDialog 当初就是为替代原生 dialog 而建。
8. **Q8 loadAgents 缺口撤回**：`loadAgents` 内部自吞错误从不外抛，归档不会被跳过；网络级半成功由 AI_SESSION_EXPIRED 兜底，不修。

### 接受的遗留（不修，评审勿重复上报）

- `"Session not found"` 字符串匹配绑定 ADK 1.2.0 文案，升级 ADK 需复核（失效时降级为普通 error 路径，fail-safe）。
- 前端填入与旧值相同的 apiKey 会白弹一次确认框（后端判无需重载、不归档，行为正确，仅提示冗余）。
- `LlmConfigSaveResult` 同时存在 `isXxx()` 与 `xxx()` 两套访问器（Lombok @Data + 手写 fluent），风格异味不影响行为。

## 影响范围

- ssh-client：chatStore（归档/持久化/notice）、ChatPanel（历史 footer/横幅/卡片）、LlmSettingsModal（两段式保存）、layoutStore（attentionPulse）、LeftSidebar（脉冲消费）、ConfirmDialog（文案扩展）、Mascot（从 BootSplash 抽出）、types（Conversation.contextStatus/historyReason）、api/chat+llmConfig（code 字段/SaveResult）。
- ssh-server：LlmConfigService（变更判定）、LlmConfigController（条件 rebuild）、AiCallNode/AbstractReActSupport（AI_SESSION_EXPIRED）、ReActEventDTO/LlmConfigDTO（新字段）、LlmConfigSaveResult（新模型）、LlmEndpointManualTest（key 清理）。
