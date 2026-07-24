# 260724-session-lifecycle-fixes：会话生命周期整改收尾（对账修复 + 体验补齐）

> 背景：docs/situations/260723-ai-session-lifecycle.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

主体实现已在工作区完成（未提交），经 2026-07-24 核实 + grill 产生本收尾清单。

## 阶段 1：主体实现对账（已在工作区，随本阶段首个 commit 封印）

**目标**：确认修复共识的主体实现正确并留档验证结论
**设计**：
- 冷启动归档：`restoreChatState` + `partialize` + `merge`（partialize 行为在阶段 2 调整）
- 只读双保险：store 层 `sendMessage` guard + UI 层隐藏 `ChatInputBar`
- 配置变更判定：后端 `sameConfig`/`runnerReloadRequired`，Controller 条件 `rebuild()`
- AI_SESSION_EXPIRED：`AiCallNode` cause 链匹配 `"Session not found"` → 带 code 的 error 事件 + `emitter.complete()`；前端 onError 归档、不重发
**验收标准**：前端 vitest 全绿；infrastructure 测试全绿
**测试用例**：chatStore（归档/拒发/rehydrate/expired）、LlmConfigServiceTest（无变化不写库/仅 provider 不重载/model 变化重载）、ChatPanel.test（卡片状态翻转）
**验证**：2026-07-24 核实——infrastructure 17 例全绿；ADK 1.2.0 jar 内实证异常文案可命中；前端 1 例断言错误（阶段 2 F2 修）；domain 因 key 残留 BUILD FAILURE（阶段 2 F1 修）。主体实现经 grill 确认后随阶段 2/3 修复同 commit 封印
**状态**：已完成

## 阶段 2：P0/P1 修复

**目标**：两端测试回绿 + 消除逻辑边界 bug
**设计**：
- F1：`LlmEndpointManualTest` key 清空（保留 deepseek 端点默认），恢复 assumeTrue 跳过
- F2：AI_SESSION_EXPIRED 测试断言改 before/delta 相对比较
- F3：`archiveConversation` 转 history 时清理 `running`/`pending_confirm` toolCall → error「已随会话归档中断」
- F4：`partialize` 保留真实 `contextStatus`；`merge` 仅当 persisted 存在非空非 history 对话时设 sessionNotice
**验收标准**：`mvn -pl ssh-server-domain test` 与前端 vitest 全绿；历史对话永不携带进行中 toolCall；横幅只在真归档那次启动出现
**测试用例**：归档清理僵尸 toolCall；重启两次第二次不弹横幅；僵尸状态不再锁死配置保存
**验证**：mvn -pl ssh-server-domain test 42 例全绿（manual 2 例正确跳过）；前端 vitest 90/90（新增归档清理、冷启动横幅两级场景、AI_SESSION_EXPIRED delta 断言）；保存拦截范围收窄到活动对话双保险
**状态**：已完成

## 阶段 3：体验补齐

**目标**：grill 决议 Q4-Q7 落地
**设计**：
- F5：historyFooter 补「新建对话」按钮（行为同横幅按钮）
- F6：BootSplash `Mascot` 抽共享组件，横幅复用 thinking 心情，删新画 SVG
- F7：layoutStore `attentionPulse` 一次性信号 → LeftSidebar servers 列表 600ms 高亮脉冲（reduced-motion 跳过），ChatPanel 卡片点击触发
- F8：`ConfirmDialog` 扩展可选 `confirmText`/`cancelText`，`LlmSettingsModal` 两段式保存替换 `window.confirm`
**验收标准**：切历史会话有新建出口；全应用只有一个吉祥物；侧栏已展开时点卡片有可见反馈；确认弹窗主题统一
**测试用例**：ChatPanel 历史 footer 按钮新建并切换；卡片点击设置 attentionPulse；ConfirmDialog 自定义文案渲染
**验证**：ChatPanel.test 3 例（含面板已全展开时仍触发脉冲、历史 footer 一键新建）；npm run build（tsc + vite）通过；ConfirmDialog 既有调用点（SftpPanel）经默认参数零改动；确认框移出 modal overlay 兄弟渲染避免遮罩点击冒泡误关设置弹窗
**状态**：已完成
