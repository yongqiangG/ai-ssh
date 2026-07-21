# 260721-three-iterations：小圈子发布前的三迭代规划

## 原始需求

把产品发布给外人（先 1 位最信任的朋友试装，后正式发小圈子）之前，对 P0+P1 事项逐项过堂，定出迭代切分、顺序与每一项的执行边界。

## 背景

2026-07-21 规划 grill 产物（P0+P1 逐项过堂）。本文档为同日文档体系迁移时从 ROADMAP 决议要点重建：结论为当时原文（含后续评审 grill 对个别条目的修订，如 A4 结构化字段、A6 撤销 `.ssh` deny），问题为迁移时倒推，grill 现场完整问答未存档（当时体系尚无 situations）。功能交互定义原载 AI-OPS-PRODUCT.md，已随迁移分解进 backlog 与本文件。

## 决议

### Q1：迭代如何切分排序？
**结论**：A「安全地基」→ B「AI 交互与确认门」→ C「监控+发布」——信任地基不齐不能给外人装，AI 交互是差异化本体，监控与走查收尾成发布。

### Q2：发布节奏？
**结论**：C2 内序列化——自己走查（含 A/B 共 7 条真机联调债）修完 → 1 位最信任的朋友非正式试装 → 反馈处理 → 正式发小圈子（评审 grill 修订版）。

### Q3（A1）：无鉴权后端的暴露面？
**结论**：`server.address: 127.0.0.1` 绑定本机，single+dev 生效、prod/server 形态不加——无鉴权 HTTP 不能听在全网卡。

### Q4（A2）：连接高级配置如何真正生效？
**结论**：`connectTimeout`/`keepaliveInterval`/`compression` 进 connect；`startupCommand` 在终端 shell 通道建立后写 stdin（可见回显）；connect 签名改配置对象。

### Q5（A3）：凭据回显策略？
**结论**：连接 DTO 删凭据回传，改 `passwordConfigured` + `keyId`；编辑表单留空=不改（空串转 undefined）；authType 切换保留对侧凭据。

### Q6（A4）：host key 校验形态？
**结论**：自定义 HostKeyRepository 走 TOFU——未知指纹→connect 返回 `hostKeyStatus=UNKNOWN`+指纹（结构化字段，非独立响应码）→前端确认卡片→`POST accept-hostkey`→重连；变更→`hostKeyStatus=CHANGED` 红色警告+双重确认；指纹存 per-connection `knownHosts`（OpenSSH 行格式）；`strictHostKeyCheck` 默认翻转 true（存量行启动时迁移补齐）。

### Q7（A5）：私钥管理形态？
**结论**：密钥升一等实体——`ssh_key` 表（name/privateKey/passphrase 加密存/userId）+ CRUD 不回显；连接 `keyId` 引用；存量内嵌私钥自动迁移提升；表单改密钥下拉+内联新建（粘贴/dialog 选文件，默认 `~/.ssh`）；生成密钥对/部署公钥/ssh-agent 本期不做。

### Q8（A6）：Tauri 安全边界？
**结论**：CSP 收紧（`default-src 'self'` 系；style 允许 inline、img/font 允许 data:、connect 允许 http/https）；fs scope 全盘 allow（SFTP 本地面板刚需）+ deny `$HOME/.ai-ssh/**`；deny `$HOME/.ssh/**` 已撤销（eac30df）——Tauri deny 会压制 dialog 运行时授权导致 A5 密钥导入失败，且对无鉴权 localhost 后端该 deny 只是象征性防线，真实防线=CSP+绑定本机。

### Q9（B1）：agent 写操作如何管控？
**结论**：读写分类=写模式规则+工具 schema `intent` 模型自评双通道取 OR；`confirm_request` NDJSON 事件挂起→前端 CommandBlock `pending_confirm` 态→`POST /api/v1/chat/confirm` 唤醒；120s 超时=拒绝；拒绝返回错误 Map 模型继续转述；无全局关闭、不记忆选择；底线仍有 8 条硬黑名单。

### Q10（B2）：选中即问的形态？
**结论**：选中→浮动气泡→反向飞行动效（对称 flyToTerminal）→引用块（±2 行前后文）挂输入框+焦点；placeholder 提示 Tab 补全默认提问（error 正则二选一文案），仅未输入时拦 Tab；不定义新快捷键——不加心智负担。

### Q11（B3）：终端上下文附带策略？
**结论**：输入栏开关默认关；固定 50 行；发送前轻量正则脱敏（PASSWORD/SECRET/TOKEN 值、私钥块、AWS key、长 base64）；气泡只显示小标签——上下文出境是隐私面，默认关+显式标签是刻意设计。

### Q12（B4）：报错诊断形态？
**结论**：前端输出流 error 正则检测→右下角气泡（懒诊断文案）→点击=引用报错前后文+诊断提问直接发送（复用 F1 管道）；同类防噪+全局开关。

### Q13（C1）：监控什么、怎么采？
**结论**：左栏连接列表下方四项 CPU/内存/负载/磁盘，只采当前激活连接；CPU/内存/负载 ~10s（复合轻命令一次 exec，/proc/stat 差分）、磁盘 300s；阈值着色（磁盘>85%黄>95%红、内存>90%红、load>核数×2 红）；无 AI；未连接空态。

### Q14（C2）：发布前走查范围？
**结论**：全新环境装包→sidecar 拉起（失败有人话提示）→无模型配置首次引导→建连接→TOFU→终端→AI→命令块全链路；A/B 两迭代 7 条待联调链路的真机首验并入走查；「不修没法给人用」级修复算走查内含。

### Q15：哪些明确砍出本期？
**结论**：F4 Ctrl+K 自然语言转命令（不加快捷键心智负担，替代路径=ChatPanel 问+命令块插入）、最小 AI eval 集（形态已定：JUnit+真 LLM+SSH stub+硬断言+手动回归报告）——均入 backlog 等时机。

## 影响范围

- 迭代 A/B/C1 的全部实现（已合入 main）；C2 执行计划见 docs/actions/260721-iteration-c2.md
- 候选池与未实现功能定义 → docs/backlog/（2026-07-21 文档体系迁移入档）
