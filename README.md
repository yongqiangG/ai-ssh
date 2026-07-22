# AI-SSH

一款具备 AI 运维能力的 SSH 客户端：AI 能看到终端里发生了什么，并能把结论**安全地**送回终端执行——不是「SSH 客户端旁边挂一个聊天窗」。

- 终端 / SFTP 双面板 / 连接管理（凭据加密落库）
- AI 对话内嵌可执行命令块：模型经独立 exec 通道多轮「执行 → 观察 → 推理」（ADK ReAct），每条命令可一键送回终端
- 自定义模型端点（baseUrl / apiKey / model，OpenAI 兼容协议，已验证 GLM 等）

## 产品形态

| 形态 | 说明 | 状态 |
|---|---|---|
| **single 单体版** | Tauri 桌面应用内嵌 Spring Boot sidecar（自带 JRE）+ H2 文件库（`~/.ai-ssh/`），敏感字段本机密钥加密，**独立分发、零外部依赖** | 当前优先迭代，打包验证见 `.github/workflows/` |
| **server 内部版** | client/server 分离，内部统一部署 server + MySQL，后续加用户体系/审计/统一 LLM 网关 | 规划中（ADR 0001） |

两形态**代码层完全兼容**，差异只允许出现在数据库实现与 Spring profile 配置。

## 仓库结构

```
ssh-client/   Tauri v2 + React 19 + TypeScript + Zustand（桌面客户端）
ssh-server/   Spring Boot 3.4 多模块 Maven，DDD 分层（后端 / sidecar）
docs/         situations 决议 · actions 执行计划 · backlog 未来池 · adr 架构决策
```

## 快速开始

```bash
# 后端（默认 single profile：H2 零依赖，克隆即跑）
cd ssh-server && mvn clean install -DskipTests
cd ssh-server-app && mvn spring-boot:run        # HTTP 8091

# 客户端
cd ssh-client && npm install
npm run dev           # 浏览器开发（http://localhost:1420，/api 代理到 8091）
npm run tauri dev     # 桌面壳
```

连 MySQL 调试（server 形态）：起 `ssh-server/docs/dev-ops/docker-compose-environment-aliyun.yml` 后，`mvn spring-boot:run -Dspring-boot.run.profiles=dev`。

更多开发约定（模块依赖顺序、编译器陷阱、测试命令）见 [CLAUDE.md](CLAUDE.md)。

## 文档

- [决议记录](docs/situations/) — 需求背景与决议全文（信任红线见 [CLAUDE.md](CLAUDE.md) 产品定位）
- [执行计划](docs/actions/) — 进行中任务与阶段进度
- [Backlog](docs/backlog/) — 未来工作项与功能池
- [ADR](docs/adr/) — 架构决策：部署双形态 / Agent 工具调用 / SFTP 边界
- [UI 规范](ssh-client/docs/UI-DESIGN.md) — 视觉与动效
