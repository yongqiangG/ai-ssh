# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库结构

仓库包含两个独立项目（无共享构建，各自构建/运行）：

- `ssh-client/` — Tauri v2 + React 19 + TypeScript + Vite 7 + Zustand 5 的桌面客户端
- `ssh-server/` — Spring Boot 3.4.3（Java 17）多模块 Maven 项目，DDD 分层，`groupId: com.johnny`

开发计划的**唯一真相源**是 `docs/ROADMAP.md`（优先级/迭代状态只在此维护）；架构决策见 `docs/adr/`（0001 部署双形态：single 单体版优先迭代、server 内部版后续演化，代码层必须完全兼容；0002 Agent 工具调用；0003 SFTP 边界）。

## 常用命令

### ssh-server（在 `ssh-server/` 下）

```bash
# 首次 / 改动被依赖模块后：从根目录全量 install，再进 app 子目录启动
mvn clean install -DskipTests
cd ssh-server-app
mvn spring-boot:run          # 默认 single profile：HTTP 8091，H2 文件库（~/.ai-ssh/），零外部依赖
mvn spring-boot:run -Dspring-boot.run.profiles=dev   # dev：连 MySQL 127.0.0.1:13306/ai_ssh (root/123456)

# 单元测试：domain / infrastructure 模块用默认 surefire，可直接跑
mvn -pl ssh-server-domain test
mvn -pl ssh-server-infrastructure test
mvn -pl ssh-server-domain -Dtest=SshConnectionAggregateTest test   # 单个测试类

# ⚠️ ssh-server-app/pom.xml 的 surefire 硬编码 <skipTests>true</skipTests>，
#    `mvn test` 在该模块不会执行测试——app 模块的测试请在 IDE 中运行。
```

本地中间件（仅 dev profile 需要）：`ssh-server/docs/dev-ops/docker-compose-environment-aliyun.yml`（MySQL 13306、Redis 16379、phpMyAdmin 8899、redis-commander 8081）。

### ssh-client（在 `ssh-client/` 下）

```bash
npm install
npm run dev            # Vite dev server，http://localhost:1420（/api 代理到 8091）
npm run build          # tsc 类型检查 + Vite 生产构建
npm run test           # vitest watch
npm run test:run       # vitest 跑一次
npx vitest run src/stores/connectionStore.test.ts   # 跑单个测试文件
npm run tauri dev      # Tauri 桌面壳（自动拉起前端 dev server）
npm run tauri build    # 打包桌面应用
```

`npm run tauri` 走 `scripts/tauri.cmd`，该脚本固定了 MSVC 2022 BuildTools 与 Windows SDK 的路径（`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\...`）后再调用 Tauri CLI。换机器或工具链版本变化时需改这个文件。

## ssh-server 架构（DDD 分层）

六个 Maven 模块，依赖方向：`trigger`、`infrastructure` → `domain` ← `api`、`types`；`app` 负责装配启动。

| 模块 | 职责 | 关键内容 |
|---|---|---|
| `ssh-server-types` | 共享原语 | `Constants`、`ResponseCode` 枚举、`AppException` |
| `ssh-server-api` | 对外契约 | `Response<T>`（`code`/`info`/`data`，成功码字符串 `"0000"`）、请求/响应 DTO |
| `ssh-server-domain` | 领域核心 | `model/{aggregate,entity,valobj}`、`service/ISshConnectionService`、`adapter/{port,repository}` 接口（端口）；`agent/`（armory 装配责任树、vendored MySpringAI 桥接、ADK 工具）、`react/`（NDJSON ReAct 节点链） |
| `ssh-server-infrastructure` | 端口实现 | `SshSessionPort`（JSch）、`AesGcmSecretCipher`、`SshConnectionRepository`（MyBatis）、`SshConnectionService`（服务实现） |
| `ssh-server-trigger` | 入站适配器 | `http/`：SshConnectionController、SshTerminalController、SftpController、ChatController（NDJSON 流）、LlmConfigController、PingController（存活探针）；`GlobalExceptionHandler` |
| `ssh-server-app` | 启动装配 | `Application.java`、`config/`、`application*.yml`、MyBatis mapper XML、集成测试 |

跨层协作的关键约定：

- **服务契约用嵌套 Cmd POJO**：`ISshConnectionService` 内嵌 `CreateCmd` / `UpdateCmd`（public 字段），Controller 负责把 DTO 映射成 Cmd，领域层不接触 DTO。`UpdateCmd` 中字段为 `null` 表示「不修改」。
- **端口模式**：`ISshSessionPort`（SSH 会话，按 `connectionId` 存入 `ConcurrentHashMap`，单会话非线程安全）、`ISshConnectionRepository`（持久化）、`ISecretCipher`（AES-GCM 加密敏感字段）。领域只依赖接口，实现全部在 infrastructure。
- **JSch**：用 `com.github.mwiede:jsch`（fork），包名仍是 `com.jcraft.jsch`，兼容现代密钥算法。当前 `StrictHostKeyChecking=no`，known_hosts 校验未接入。
- **无鉴权**：`userId` 经请求头 `X-User-Id` 注入，缺省 `"default"`。
- **secret key**：dev 在 `application-dev.yml` 内置 Base64 密钥；prod 从环境变量 `SSH_SECRET_KEY` 注入，缺失即启动失败。

## ssh-client 架构

VSCode 风格三栏布局：`ActivityBar` + `LeftSidebar` + 中部 `TerminalPanel`/`SftpPanel`（`layoutStore.centerView` 切换，不建 tab）+ 右侧 `ChatPanel`，栏宽与显隐由 `layoutStore` 管理，可拖拽 `Splitter`。其它 store：`themeStore`、`chatStore`、`terminalStore`、`sftpStore`、`backendStore`、`connectionStore`。

HTTP 层 `src/api/request.ts`：fetch 封装，统一解包 `ApiResponse<T>`（`code !== "0000"` 抛错），自动附 `X-User-Id`。`baseURL` 在开发态为空（走 Vite `/api`→`localhost:8091` 代理），打包/生产态由「后端地址设置」写入 localStorage（`ai-ssh:baseUrl`）。

后端地址设置链路：`BackendSettingsModal` → `backendStore`（baseUrl 的 React 订阅镜像，底层数据源仍是 localStorage）→ `pingBackend()`（对 `/api/ping` 发 GET，用输入框当前值而非已保存值，改完即可验证）→ 服务端 `PingController`（无 DB 依赖的存活探针，返回 `Response.success("pong")`）。

SSH 连接管理走 `connectionStore.ts` + `api/sshConnection.ts`（真实后端集成）。早期 mock 脚手架（serversStore/mockSsh/mockAi）已于 2026-07-21 整体清理，状态层不存在双轨。

## 跨项目约定与陷阱

- **Controller 参数必须显式命名**：根 `pom.xml` 把 `maven-compiler-plugin` 锁在 `3.0`（无 `-parameters` 编译参数），`@PathVariable` / `@RequestParam` 必须写名字，如 `@PathVariable("connectionId")`，否则启动期绑定失败。
- **多模块启动顺序**：被依赖模块改动后必须先在根目录 `mvn install`，再进 `ssh-server-app` 跑 `spring-boot:run`，否则 IDE/启动读到的还是旧 jar。
- **统一响应码**：前后端成功码均为字符串 `"0000"`；新增接口/解析要保持一致。
- **DB**：默认 single profile 用 H2 文件库（`~/.ai-ssh/`）；dev profile 连 MySQL `13306`（docker 映射），不是默认 3306。
