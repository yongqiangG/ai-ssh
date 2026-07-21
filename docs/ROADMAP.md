# ROADMAP

> 开发计划的**唯一真相源**：优先级、迭代状态只在本文件维护（功能的交互定义见 `AI-OPS-PRODUCT.md`，架构决策见 `adr/`）。迭代结束时更新本文件；单迭代的战术拆解用仓库根 `IMPLEMENTATION_PLAN.md`（完成即删）。

## 当前迭代

**规范与一致性整理（2026-07-21）**——已完成：mock 双轨死代码清理、脚手架残留清理、single 定为默认 profile、文档体系重构（ADR 0002/0003、本文件、README）、LLM 测试去硬编码 key。

下一迭代从候选池取材，开工前需规划 grill 敲定范围。

## 候选池

### P0 · 安全信任地基（发布给任何外人之前必修）

| # | 事项 | 要点 |
|---|---|---|
| 1 | single 版 HTTP 绑定 127.0.0.1 | 当前无 `server.address` 配置默认监听全网卡，同网段可无鉴权拿全部明文凭据/借会话执行命令；一行配置，**候选池中最高优先** |
| 2 | 凭据只写不回显 | `SshConnectionResponseDTO` 去掉 password/privateKey 回传，改 `passwordConfigured`/`privateKeyConfigured` 布尔 + 留空不改；照抄 LlmConfig 的 `apiKeyConfigured` 模式（DTO/Controller/Service 三层样板俱全）；前端编辑表单同步改造 |
| 3 | host key TOFU | 自定义 JSch `HostKeyRepository` 捕获未知指纹 → 连接失败带指纹返回 → 前端弹确认卡片 → 存入连接的 `knownHosts` 字段（DB 列已有）→ `strictHostKeyCheck` 真正接线；指纹变更（疑似 MITM）红色强警告 + 二次确认。AI 会替用户执行命令，传输层被 MITM 的后果远超普通 SSH 客户端 |
| 4 | 私钥第一层 | passphrase 支持（表列/DTO/表单 + `addIdentity` 第 4 参）+ 密钥文件选择器（tauri-plugin-dialog 已装）；随 #2 一起不回显 |
| 5 | 连接高级配置真正接线 | `keepaliveInterval`（`setServerAliveInterval`）、`connectTimeout`、`compression` 等字段全套存在但 `connect()` 未消费，一并接线 |
| 6 | Tauri 收紧 | CSP 从 `null` 配置为白名单；fs scope 从全盘 `**` 收窄（私钥/SFTP 本地文件靠 dialog 选中授权） |

### P1 · AI 差异化（护城河，别让 SSH 基本盘挤占）

| # | 事项 | 要点 |
|---|---|---|
| 1 | agent 写操作确认门 | 工具侧读写分类（规则 + 模型自评双通道）→ 写命令经 NDJSON 发 `confirm_request` 挂起 → 前端确认卡片 → 放行/拒绝；挂载点已备好（ADK Plugin `beforeToolCallback` 返回非空 Map 即跳过执行，见 ADR 0002 §6）；是 F7 任务式 Agent 的唯一前置 |
| 2 | F1 选中即问 + F3 终端上下文快照 | 补上「AI 能看到终端里发生了什么」这半句产品主张（「送回终端执行」半句已实现）；F3 注意上下文脱敏问题（密钥/密码 token 掩码）待设计 |
| 3 | F5 报错自动诊断 + F4 Ctrl+K | Warp 已验证的路线，纯前端 + 现有通道 |
| 4 | F8 连接巡检 + 健康小标 | 对位 WindTerm/FinalShell 监控卖点，AI 摘要加成，成本低差异化高 |
| 5 | 最小 AI eval 集 | 约 10 个脚本化场景（会不会调用工具/黑名单拦截/超时自纠/无终端降级），换模型或改 instruction 后回归，替代手感验证 |

### P2 · 远期

- 密钥一等实体：独立密钥库表、连接引用密钥、生成密钥对（JSch KeyPair）、一键部署公钥（ssh-copy-id 语义，复用 exec 通道）——追平 Termius Keychain 核心
- ssh-agent 集成 / agent forwarding：与跳板机（bastion）同场景族，一起设计
- F6 危险命令防呆（前端统一拦截层，覆盖手输命令）· F7 任务式 Agent（依赖 P1-1 确认门）
- 企业 server 形态：用户体系、审计、统一 LLM 网关（ADR 0001 阶段 5）

## 已交付

- 2026-07-21 · 规范与一致性整理（死代码/脚手架清理、single 默认 profile、文档体系重构）
- 2026-07-19 · 四批次体验修复：启动体验、停止真停、会话隔离、逐条深度思考开关
- 2026-07 · SFTP 双面板拖拽传输 + `listFiles` tool（ADR 0003）
- 2026-07 · Tool 调用闭环：ADK 编排 + vendored MySpringAI 桥接 GLM、NDJSON 命令块（ADR 0002）
- 2026-07 · single 形态落地：H2 + 本机密钥 + Tauri sidecar（嵌入式 JRE）+ Windows/Mac CI 验证（ADR 0001）
- 2026-07 · 模型设置（自定义 baseUrl/apiKey/model/completionsPath，key 只写不回显）
- 2026-07-09 · 客户端 UI 改版（Linear/Warp 风 Modern Dark）；更早：SSH 连接管理接真实后端、终端轮询交互模型
