# ADR 0001：个人单体版与企业服务端版部署形态

## 背景

当前项目采用 Tauri 客户端 + Spring Boot 服务端架构。现阶段 SSH 配置只依赖两张表，个人用户试用时额外安装 MySQL 会显著抬高分发和使用门槛。

产品后续仍需要演进为公司内部工具，由统一服务端接入 LLM、用户体系、成本控制和审计能力。因此不能为了个人单体版拆掉现有 Spring Boot 服务端边界。

## 决策

项目支持两种明确的运行形态，通过 Spring profile 区分。

- `single`：个人/小团队单体版
  - Tauri 最终携带并启动本机 Spring Boot sidecar。
  - 服务端使用 H2 文件库，不依赖外部 MySQL。
  - SSH 密码、私钥、LLM API Key 使用本机自动生成密钥加密后落库。
  - LLM 配置作为本地用户数据保存，第一阶段只支持一个默认配置。
  - 本地数据只承诺应用层导出/导入，不承诺自动无损迁移到企业 MySQL。

- `server` / `prod`：企业服务端版
  - 服务端使用 MySQL。
  - LLM 由服务端统一配置或接入统一网关。
  - 后续扩展用户、权限、成本控制、审计和集中密钥管理。

## 不做什么

- 不把 SSH、AI、终端能力迁移到 Tauri/Rust/前端。
- 不在第一阶段实现用户体系、租户体系、成本统计和审计。
- 不实现 H2 到 MySQL 的数据库级自动迁移。
- 不接 Windows Credential Manager、macOS Keychain 或 Linux Secret Service。
- 不支持多 Provider、多模型路由或按会话选择模型。

## 分阶段落地

1. ✅ 后端支持 `single` profile：H2 文件库、本机密钥、无 MySQL 启动。
2. ✅ 增加本地 LLM 配置接口：读取、保存、测试连接，保存后重装配 Agent（`LlmConfigController` + `AgentRunnerRegistry.rebuild()`）。
3. ✅ 前端增加模型设置入口，用户填写 `baseUrl`、`apiKey`、`model` 和 `completionsPath`。
4. ✅ Tauri 打包接入 sidecar 生命周期管理（`lib.rs` 嵌入式 JRE + jar 启动，CI 见 `.github/workflows/build-*-validation.yml`）。
5. 企业版阶段再引入统一 LLM 网关、用户权限、成本控制和审计。（未开始）

> 现状（2026-07-21）：阶段 1-4 已完成，single 为默认开发 profile（`application.yml`），优先迭代单体形态；两形态代码层保持完全兼容，差异只允许出现在数据库实现与 profile 配置。

## 安全边界

个人版本机加密只用于避免敏感信息明文落库，不等同于企业级密钥托管。若攻击者同时取得 H2 文件和本机密钥文件，仍可能解密敏感字段。企业版必须使用服务端统一密钥管理策略。
