# ROADMAP

> 开发计划的**唯一真相源**：优先级、迭代状态只在本文件维护（功能的交互定义见 `AI-OPS-PRODUCT.md`，架构决策见 `adr/`）。迭代结束时更新本文件；单迭代的战术拆解用仓库根 `IMPLEMENTATION_PLAN.md`（完成即删）。

## 迭代 A「安全地基」（2026-07-21 开工，开发完成）

> 三迭代规划来自 2026-07-21 规划 grill（P0+P1 逐项过堂，全部决议见各项要点）。发布节奏：迭代 A 末给 1 位最信任的朋友非正式试装；迭代 C 末正式发小圈子。
> **状态**：六项开发完成并经隔离实例冒烟验证（bind/不回显/密钥引用保护/accept-hostkey/留空不改均实证）；**待真机联调收口**：TOFU 确认弹窗、密钥复用连接、编辑表单三条链路需在真实 SSH 服务器 + 桌面 UI 上走一遍。

**目标**：发布给外人前的信任地基全部落地。
**验收**：以下六项合入 main，前后端构建与测试全绿，TOFU/密钥复用/不回显三条链路手动联调通过。

| # | 事项 | 决议要点 |
|---|---|---|
| A1 | HTTP 绑定本机 | `server.address: 127.0.0.1`（single + dev；prod/server 形态不加） |
| A2 | 连接高级配置接线 | `connectTimeout`/`keepaliveInterval`/`compression` 进 connect；`startupCommand` 在终端 shell 通道建立后写 stdin（可见回显）；connect 签名改配置对象 |
| A3 | 凭据只写不回显 | 连接 DTO 删凭据回传，改 `passwordConfigured` + `keyId`；留空=不改（空串转 undefined）；authType 切换保留对侧凭据 |
| A4 | host key TOFU | 自定义 HostKeyRepository；未知指纹→`SSH_HOSTKEY_UNKNOWN`+指纹→前端确认卡片→`POST accept-hostkey`→重连；变更→`SSH_HOSTKEY_CHANGED` 红色警告+双重确认；指纹存 per-connection `knownHosts`（OpenSSH 行格式）；`strictHostKeyCheck` 默认翻转 true |
| A5 | 密钥一等实体 | `ssh_key` 表（name/privateKey/passphrase 加密存/userId）+ CRUD（不回显）；连接 `keyId` 引用；存量内嵌私钥自动迁移提升；表单改密钥下拉+新建（粘贴/dialog 选文件，默认 `~/.ssh`）；生成密钥对/部署公钥/ssh-agent 不做 |
| A6 | Tauri 收紧 | CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http: https:`；fs scope 全盘 allow + **deny `$HOME/.ai-ssh/**`、`$HOME/.ssh/**`** |

## 迭代 B「AI 交互与确认门」（2026-07-21 开工，开发完成）

> **状态**：四项开发完成合入 main（B1 确认门前后端、B2 选中即问、B3 终端上下文脱敏、B4 报错诊断气泡）；前后端构建与单测全绿（前端 46、后端 42），后端 single profile 启动探活通过；**待真机联调收口**：确认门允许/拒绝/超时、选中即问反向飞行、F3 脱敏小标签、报错气泡直发四条链路需在真实 SSH 服务器 + 桌面 UI 上走一遍。

| # | 事项 | 决议要点 |
|---|---|---|
| B1 | agent 写操作确认门 | 读写分类=写模式规则 + 工具 schema `intent` 模型自评，双通道取 OR；`confirm_request` NDJSON 事件挂起→前端 CommandBlock `pending_confirm` 态→`POST /api/v1/chat/confirm` 唤醒；120s 超时=拒绝；拒绝返回错误 Map 模型继续；**无全局关闭、不记忆选择**；底线仍有 8 条硬黑名单 |
| B2 | F1 选中即问（新形态） | 选中→浮动气泡→反向飞行动效（对称 flyToTerminal）→引用块（含 ±2 行前后文）挂输入框+焦点→placeholder 提示 Tab 补全默认提问（error 正则二选一文案）；仅未输入时拦 Tab；**不定义新快捷键** |
| B3 | F3 终端上下文快照 | 输入栏开关默认关；固定 50 行；发送前轻量正则脱敏（PASSWORD/SECRET/TOKEN 值、私钥块、AWS key、长 base64）；气泡只显示小标签 |
| B4 | F5 报错诊断 | 前端输出流 error 正则检测→右下角气泡（懒诊断文案）→点击=引用报错前后文+诊断提问**直接发送**（复用 F1 管道）；同类防噪+全局开关 |

## 迭代 C「监控 + 发布」（排队）

| # | 事项 | 决议要点 |
|---|---|---|
| C1 | 激活服务器监控条 | 左栏连接列表下方，四项 CPU/内存/负载/磁盘；只采当前激活连接；CPU/内存/负载 ~10s（复合轻命令一次 exec，/proc/stat 差分），磁盘 300s；阈值着色（磁盘>85%黄>95%红、内存>90%红、load>核数×2红）；无 AI；未连接空态 |
| C2 | 首次安装走查 + 正式发布 | 全新环境装包→sidecar 拉起（失败有人话提示）→**无模型配置时的首次引导**→建连接→TOFU→终端→AI→命令块全链路；「不修没法给人用」级修复算走查内含；走查过→正式发小圈子 |

## 候选池

- **可选 master password 加密档**（对齐 Xshell/Tabby 实践：KDF+锁定解锁流+忘记恢复）· ssh-agent 集成/agent forwarding（与跳板机 bastion 同族设计）
- 生成密钥对 + 一键部署公钥（ssh-copy-id）——密钥实体第二步，追平 Termius Keychain
- F4 Ctrl+K 自然语言转命令（2026-07-21 砍：不加快捷键心智负担；替代路径=ChatPanel 问+命令块插入）· F2 完整三动作命令卡片（复制/解释）+ markdown 渲染
- 最小 AI eval 集（JUnit+真 LLM+SSH stub+硬断言+手动回归报告——形态已定，2026-07-21 砍出本期）
- F8 原形态增强：连接卡片健康小标、巡检报告面板、AI 解读懒按钮、周期巡检
- F6 危险命令防呆（覆盖用户手输的前端统一拦截层）· F7 任务式 Agent（依赖 B1 确认门）
- 企业 server 形态：用户体系、审计、统一 LLM 网关（ADR 0001 阶段 5）

## 已交付

- 2026-07-21 · 规范与一致性整理（死代码/脚手架清理、single 默认 profile、文档体系重构）
- 2026-07-19 · 四批次体验修复：启动体验、停止真停、会话隔离、逐条深度思考开关
- 2026-07 · SFTP 双面板拖拽传输 + `listFiles` tool（ADR 0003）
- 2026-07 · Tool 调用闭环：ADK 编排 + vendored MySpringAI 桥接 GLM、NDJSON 命令块（ADR 0002）
- 2026-07 · single 形态落地：H2 + 本机密钥 + Tauri sidecar（嵌入式 JRE）+ Windows/Mac CI 验证（ADR 0001）
- 2026-07 · 模型设置（自定义 baseUrl/apiKey/model/completionsPath，key 只写不回显）
- 2026-07-09 · 客户端 UI 改版（Linear/Warp 风 Modern Dark）；更早：SSH 连接管理接真实后端、终端轮询交互模型
