# AGENTS.md

本文件为 Codex 在本仓库工作时的项目指南，参考 `CLAUDE.md` 初始化，与全局 `AGENTS.md` 中的开发约定配合使用。项目事实以当前代码和配置为准。

## 工作约定

- 环境为 Windows 10，默认使用 PowerShell；命令和本地路径使用 Windows 写法。仓库已有 `.sh` 脚本通过 Git Bash 执行。
- 开始前检查工作区状态，先研究现有实现，再做可编译、可验证的小步变更，保留用户已有改动。
- 遵循理解 → 测试 → 实现 → 重构 → 提交的流程；功能新增和修复先用有意义的测试复现，再做最小实现。文档变更检查内容、路径和格式。
- 提交前自查差异，运行改动范围内的测试及现有格式检查；不能把被跳过的测试视为通过，也不通过禁用测试掩盖失败。当前客户端没有 `lint` 脚本，不要假定存在 `npm run lint`。
- 优先组合、接口和显式依赖；函数与类保持单一职责，避免过早抽象。错误应快速失败并包含调试上下文，在合适层级处理，不静默吞掉异常。
- 同一问题最多尝试 3 次；仍未解决时停止重复尝试，记录具体方案、完整错误和原因判断，再调研替代实现并重新审视方案。

## 仓库结构与产品边界

两个主要项目独立构建、运行，另有独立的 Python MCP 工具集：

| 目录 | 技术与职责 |
| --- | --- |
| `ssh-client\` | Tauri v2 + React 19 + TypeScript + Vite 7 + Zustand 5 桌面客户端；Rust 壳位于 `src-tauri\` |
| `ssh-server\` | Spring Boot 3.4.3、Java 17、六模块 Maven 项目，DDD 分层，`groupId: com.johnny` |
| `mcp\` | Python MCP 工具集，各工具使用独立虚拟环境；`workload\` 为工时统计工具 |
| `scripts\` | 仓库级构建、打包脚本 |
| `docs\adr\` | 跨需求的架构决策 |

产品定位是具备 AI 运维能力的 SSH 客户端：AI 能读取终端上下文，并把建议安全地送回终端执行。

### SSH 运维链路

以下三条信任红线仅适用于产品中的 AI 聊天 → SSH 终端执行链路：

1. 命令执行前始终可见、可编辑；只预填，不自动回车。
2. 写操作必须由用户人工确认。
3. 高危命令强制防呆，AI 生成和用户手输采用相同防护。

### AI Coding 功能域

- 前端位于 `ssh-client\src\features\aiCoding\`，Rust 位于 `ssh-client\src-tauri\src\coding\`；包含项目与任务管理、Claude/Codex PTY 终端、文件浏览、本地 Shell、看板和手机伴侣。
- 该功能域独立于 SSH 运维链路，不经 `ssh-server`，不复用 SSH 信任链；Tauri 命令使用 `coding_` 前缀，事件使用 `coding:` 前缀。
- 安装版数据默认在 `%USERPROFILE%\.ai-ssh\coding\`，项目内数据目录为 `.ai-coding\`；开发模式遵循下文的 `AI_SSH_HOME` 沙盒配置。
- `ask` / `auto_edit` / `full_access` 权限模式由用户创建任务时显式选择，沿用 agent CLI 原生交互；上述 SSH 三条红线不扩展到这个功能域。
- 状态跟踪同时使用 hook 注入与 agent session 文件轮询。Codex hook 会改写用户 `%USERPROFILE%\.codex\config.toml`；Claude 使用自有 settings 文件，通过 `--settings` 传入。
- Windows 全屏 TUI 的 scrollback 依赖随包侧载的 ConPTY，资源在 `ssh-client\src-tauri\resources\conpty\`。开发涉及 Rust 命令时使用 `npm run tauri dev`。
- 手机伴侣使用进程内 axum 提供 REST/WS，带 token 鉴权；终端同步使用 vt100 屏幕快照，原始 PTY 尾窗用于引导和回退。
- 该功能源自 GPL-3.0 的 nezha；保留来源与许可证信息，公开分发按现有 GPL-3.0 决议处理。背景见 [AI Coding 面板决议](docs/situations/260815-ai-coding-panel.md)。

## 规划与文档

- 一个需求一份文档，放在 `D:\project\ObsidianNotes\工作\ai-ssh\需求\需求-<标题>.md`，从 vault 的 `模板\需求设计.md` 起步；项目代码仓内不新建需求规划文档。
- 文档保留原始需求（用户原话）、背景（决策时事实）、决议（问题 + 结论及理由）、实现概览、影响范围、方案与执行计划、待办。实现概览在阶段验证通过后补齐。
- 执行前补齐阶段计划；简单需求一阶段即可，复杂需求拆为 3–5 阶段，每阶段包含目标、设计、验收标准、测试用例、验证和状态。
- 同一需求的澄清、决策、执行、验证持续更新同一份文档；续接时先核对代码现状，文档与现场不符则先修订文档。
- frontmatter `状态` 使用：待澄清 → 待开发 → 进行中 → 待验收 → 已上线；阶段状态在正文中使用未开始 / 进行中 / 已完成。
- frontmatter `项目` 填 `ai-ssh`，`模块` 按内容选择 `SSH运维模块`、`AI Coding模块` 或 `工程化模块`，供 Obsidian 工作首页和模块导航查询。
- `docs\situations\`、`docs\actions\`、`docs\backlog\` 为封存历史，只读参考，不再更新；跨需求的架构决策继续放 `docs\adr\`。

## 常用命令

### 客户端：在 `ssh-client\` 下执行

```powershell
npm install
npm run dev                 # Vite：1420，/api 代理到 localhost:8092
npm run build               # tsc 类型检查 + Vite 生产构建
npm run test                # Vitest watch
npm run test:run             # Vitest 单次运行
npx vitest run connectionStore.test.ts
npm run tauri dev           # 桌面壳 + 前端 dev server + 后端 sidecar
npm run tauri build         # 打包桌面应用，需先准备后端和运行时资源
```

手机伴侣前端构建使用 `npm run build:mobile`。涉及 Rust 时，在 `ssh-client\src-tauri\` 下执行 `cargo check` 与相关 `cargo test`，并准备好 Windows 工具链和 Tauri resources。

### 后端：在 `ssh-server\` 下执行

```powershell
# 首次构建或改动被依赖模块后，先安装整个 Maven reactor
mvn clean install

# domain / infrastructure 模块可直接运行单元测试
mvn -pl ssh-server-domain test
mvn -pl ssh-server-infrastructure test
mvn -pl ssh-server-domain "-Dtest=SshConnectionAggregateTest" test
```

仅独立调试 Java 后端时，进入 `ssh-server\ssh-server-app\`，按所需 profile 选择启动命令：

```powershell
mvn spring-boot:run                                   # 默认 single：8091 + H2
mvn spring-boot:run "-Dspring-boot.run.profiles=dev"    # dev：MySQL 127.0.0.1:13306/ai_ssh
```

- 日常 `npm run tauri dev` 会自动启动 sidecar，无需另起 Java 实例。独立 Java 调试需核对端口和数据目录，避免与运行中的 sidecar 冲突。
- 若独立后端需配合 Vite 开发代理，设置 `AI_SSH_HOME` 为 `%USERPROFILE%\.ai-ssh-dev`，并通过 `"-Dspring-boot.run.arguments=--server.port=8092"` 指定端口；先退出占用该沙盒的 Tauri dev。
- `ssh-server-app\pom.xml` 当前在 Surefire 中硬编码 `<skipTests>true</skipTests>`；普通 `mvn test` 不会执行 app 模块测试，应在 IDE 中运行相关测试并明确记录验证结果。
- 仅 dev profile 需要本地中间件，配置在 `ssh-server\docs\dev-ops\docker-compose-environment-aliyun.yml`：MySQL `13306`、Redis `16379`、phpMyAdmin `8899`、redis-commander `8081`。

### 工时统计 MCP：在仓库根目录执行

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mcp\workload\install.ps1 -Development
& '.\mcp\workload\.venv\Scripts\python.exe' -X utf8 -m unittest discover -s mcp\workload -p 'test_*.py'
& '.\mcp\workload\.venv\Scripts\python.exe' -m ruff check mcp\workload
& '.\mcp\workload\.venv\Scripts\python.exe' -m ruff format --check mcp\workload
```

安装、CLI `setup` / `report` / `serve` 和 MCP 工具约定见 [工时统计 README](mcp/workload/README.md)。该工具只读取考勤和工时；凭据由 Windows DPAPI 加密，默认在 `%USERPROFILE%\.workload\credentials.dat`。离线测试使用虚构凭据与模拟响应，不登录真实账号。需求口径见 vault 的 `工作\ai-ssh\需求\需求-工时统计MCP.md`。

## 开发沙盒与打包

| 运行方式 | 默认数据根 | sidecar 后端 | 手机伴侣 |
| --- | --- | --- | --- |
| 安装版 | `%USERPROFILE%\.ai-ssh` | `8091` | `18080` |
| `npm run tauri dev` | `%USERPROFILE%\.ai-ssh-dev` | `8092` | `18081` |

- `ssh-client\scripts\tauri.cmd` 的 dev 分支注入 `AI_SSH_HOME`，并加载 `src-tauri\tauri.dev.conf.json`，使用独立标识 `com.johnny.ai-ssh.dev`，隔离单实例锁、WebView2 profile 和 appdata。手机伴侣端口可由 `web.json` 显式覆盖。
- 该脚本的非 dev 分支配置固定版本的 MSVC 2022 BuildTools 与 Windows SDK 路径；换机器或升级工具链时先检查脚本。
- dev sidecar 使用 resources 中已打包的 jar；修改 Java 后须更新后端资源，再重启 dev，避免仍运行旧 jar。
- dev 与安装版同时运行 Codex 任务时，会共享并改写用户的全局 `config.toml` hook 配置；Claude 的任务级 `--settings` 不受此问题影响。
- `scripts\build-personal.sh` 将后端提取为瘦 jar + `lib\` 放入 Tauri resources，并生成 jlink runtime 和 base CDS archive（`-Xshare:dump`）。
- dynamic CDS 归档与 jar mtime 绑定，由用户机首次启动后在后台生成，不随安装包分发；logback 日志目录通过 `-DLOG_DIR` 注入，打包版写 appdata。

## ssh-server 架构

主要依赖方向为 `trigger`、`infrastructure` → `domain` → `api`、`types`；`trigger` 也直接依赖 `api`、`types`，`app` 负责装配启动。不要引入领域层对基础设施实现的反向依赖。

| 模块 | 职责与关键内容 |
| --- | --- |
| `ssh-server-types` | 共享原语：`Constants`、`ResponseCode`、`AppException` |
| `ssh-server-api` | 对外 DTO 与 `Response<T>`（`code` / `info` / `data`） |
| `ssh-server-domain` | aggregate/entity/valobj、服务契约与 adapter 端口；`agent\` 包含 armory、MySpringAI 桥接、ADK 工具，`react\` 为 NDJSON ReAct 节点链 |
| `ssh-server-infrastructure` | JSch 会话、AES-GCM 加密、MyBatis 仓储及服务实现 |
| `ssh-server-trigger` | HTTP Controller、NDJSON 聊天流、`GlobalExceptionHandler` |
| `ssh-server-app` | `Application.java`、配置、MyBatis mapper XML、集成测试 |

- 服务契约使用嵌套 Cmd POJO：`ISshConnectionService.CreateCmd` / `UpdateCmd` 为 public 字段，Controller 负责 DTO → Cmd 映射，领域服务不直接接收 HTTP DTO。`UpdateCmd` 字段为 `null` 表示不修改。
- 端口包括 `ISshSessionPort`、`ISshConnectionRepository`、`ISecretCipher`，实现位于 infrastructure。SSH 会话按 `connectionId` 保存在 `ConcurrentHashMap` 中，单会话本身非线程安全。
- 使用 `com.github.mwiede:jsch`，Java 包名仍为 `com.jcraft.jsch`。当前 `StrictHostKeyChecking=no`，尚未接入 known_hosts 校验。
- SSH 后端当前没有真实鉴权；`X-User-Id` 缺省为字符串 `"default"`。AI Coding 手机伴侣的 token 鉴权属于独立功能域。
- dev 密钥来自 `application-dev.yml`；prod 从 `SSH_SECRET_KEY` 环境变量注入，缺失时启动失败；single 使用本地密钥文件。

## ssh-client 架构

- VSCode 风格布局：`ActivityBar` + `LeftSidebar` + 中部 `TerminalPanel` / `SftpPanel` + 右侧 `ChatPanel`。中部视图由 `layoutStore.centerView` 切换，栏宽与显隐由 `layoutStore` 管理，使用可拖拽 `Splitter`。
- 主要 store：`themeStore`、`chatStore`、`terminalStore`、`sftpStore`、`backendStore`、`connectionStore`。SSH 连接使用真实 `connectionStore.ts` + `api\sshConnection.ts`，已清理早期 mock 状态通路。
- `backendStore.bootPhase`（booting / failed / done）是一次性启动门；done 前由全屏 `BootSplash` 接管，done 后不回退。业务面板挂载时默认后端已就绪，运行中更改后端地址走设置弹窗与刷新。
- release 构建中，Rust sidecar 启动失败通过 `backend-launch-failed` 事件与补查命令上报。
- HTTP 层为 `src\api\request.ts`，统一解包 `ApiResponse<T>`，`code !== "0000"` 抛错，自动附带 `X-User-Id`。
- 未配置自定义地址时，开发态 baseURL 为空，由 Vite `/api` 代理到 `localhost:8092`；生产态默认 `http://127.0.0.1:8091`。用户设置存入 localStorage 的 `ai-ssh:baseUrl`。
- 地址设置链路：`BackendSettingsModal` → `backendStore` → `pingBackend()` → `/api/ping`。连通性检查使用输入框当前值；`PingController` 不依赖 DB，返回 `Response.success("pong")`。

## 跨项目约定与参考

- Controller 参数显式写出 `@PathVariable("connectionId")`、`@RequestParam("name")` 的名字；根 Maven 编译配置虽开启 `-parameters`，仍保持显式命名风格。
- 前后端成功码统一为字符串 `"0000"`；新增接口和解析逻辑保持一致。
- Maven 被依赖模块变更后，先在 `ssh-server\` 根目录执行 `mvn install`，再从 app 模块启动，避免读取本地仓库的旧 jar。
- single 默认使用 H2 文件库；dev 使用 MySQL `13306`。开发桌面沙盒与 Spring `dev` profile 是不同配置维度，不要混用。
- [ADR 0001：部署双形态](docs/adr/0001-single-and-server-deployment-modes.md)：优先迭代 single 单体版，保持后续 server 内部版的代码兼容性。
- [ADR 0002：Agent 工具调用](docs/adr/0002-adk-tool-calling-architecture.md)、[ADR 0003：SFTP 边界](docs/adr/0003-sftp-transfer-boundaries.md)。
- 手机伴侣历史决议：[接入方案](docs/situations/260821-mobile-companion.md)、[快照同步](docs/situations/260824-mobile-snapshot-statesync.md)、[恢复任务](docs/situations/260825-mobile-resume-task.md)。新的需求与验证记录继续维护在 vault。
