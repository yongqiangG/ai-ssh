# SFTP 文件传输 · 设计定稿

> 2026-07-14 grill 会话定稿。开发方式：跳过 TDD 直接落代码。
> 与 `docs/TOOL-CALLING-DESIGN.md`（命令执行 tool）对称——SFTP 同步封装 LLM tool。

## 0. 目标

最小闭环：在中间工作区以**双面板**展示「本地目录 | 远程目录」，**拖拽**完成文件双向传输（上传/下载）。同时把 SFTP 的列目录能力封装成 LLM tool（`SftpAdkTool.listFiles`），供后续 AI 运维场景调用。

## 1. 布局决策（grill 结论）

| 决策 | 结论 | 依据 |
|---|---|---|
| 面板位置 | **中间**（非左栏） | 左栏 ≤560px 放不下双面板；双向拖拽刚需双面板；VSCode 心智（资源在侧栏、主工作区在中间） |
| 中间视图模型 | 加 `centerView: 'terminal' \| 'sftp'`，**切换不建 tab** | tab 本质=连接（`terminalStore` 1:1），`activeId` 是两视图共享锚点 |
| 终端保活 | 切到 sftp 时 `TerminalPanel` 用 `visibility:hidden` 隐藏 | 复用现有堆叠机制，会话/日志不丢；sftp 与 shell 是同 session 不同 channel，并存无冲突 |
| ChatPanel 耦合 | 仅改 `CommandBlock.run()` 一行 | 耦合在 store 层（`activeId`+`setShowTerminal`），不在组件层；`setShowTerminal(true)` 升级为「切回 terminal 视图」 |
| 本地侧呈现 | **双面板**（本地树 \| 远程树），webview 内 HTML5 拖拽 | Tauri webview「拖出到 OS」不可行；要双向拖拽 → 本地侧必须有可见拖放目标 → 双面板是唯一解 |
| 列表形态 | **单级列表 + 面包屑**，不做递归树 | FileZilla 默认主视图；本地/远程对称复用 `DirListView`，省懒加载/展开状态工作量 |

## 2. 传输边界（最小闭环）

| 项 | 决策 |
|---|---|
| 传输对象 | 单文件 + 多选文件；**不做目录递归**（拖文件夹提示不支持） |
| 同名覆盖 | 落前查目标侧重名 → `confirm` 覆盖/取消；后端 `overwrite` 参数 |
| 进度反馈 | 内联进度条，不做传输队列面板 |
| 前后端传输 | 上传 multipart（返回 JSON）、下载 blob 流（绕开 `request.ts` JSON 解包） |
| 大小边界 | 单文件 ~100MB；不做分块/断点续传 |
| 上传进度 | 用 `XMLHttpRequest`（fetch 拿不到 upload progress） |

**明确不做**：目录递归 ❌｜断点续传/分块 ❌｜传输队列面板 ❌｜远程在线编辑/预览 ❌｜多 sftp tab ❌｜重命名/跳过策略 ❌

## 3. 数据流（三段）

```
本地磁盘 ↔[tauri-plugin-fs]↔ 前端 webview ↔[ HTTP ]↔ Spring Boot ↔[JSch ChannelSftp]↔ 远程
```

- **上传**：`fs.readFile(本地路径)` → `FormData`(Blob) → XHR POST `/upload`（带进度）→ 后端 `ChannelSftp.put`
- **下载**：GET `/download`（`octet-stream`，绕开 JSON 解包）→ 前端 blob → `fs.writeFile(本地目标路径)`；下载进度走 `response.body.getReader()`
- 两段对称：上传查远程目录重名（sftp list），下载查本地目录重名（fs readDir）

## 4. 后端设计（DDD 分层）

### 4.1 domain 层

**`ISftpPort`**（`domain/ssh/adapter/port/`，对称 `ISshSessionPort`）：
```java
List<SftpEntry> list(String connectionId, String path);          // 列目录（UI + tool 共用）
void upload(String connectionId, String remotePath, InputStream in, boolean overwrite);
void download(String connectionId, String remotePath, OutputStream out);
```

**`SftpEntry`**（`domain/ssh/adapter/port/`，对称 `ExecResult`，值对象）：`name / directory(boolean) / size(long) / lastModified(long)`

> port 不进 `ISshSessionPort`——SFTP 是独立关注点，单独成端口。复用 `SshSessionPort.getSession(connectionId)` 拿 JSch Session（同层调用，已在 `SshSessionPort.java:106` 暴露）。

### 4.2 infrastructure 层

**`SftpSessionPort implements ISftpPort`**（`@Component`）：
- 注入 `SshSessionPort`，`getSession(connectionId)` → `session.openChannel("sftp")` → `ChannelSftp`
- 每次操作开一次性 channel，用完 `disconnect()`（对称 exec 的 ChannelExec 模型，最小闭环够用）
- `list`：`channel.ls(path)` → 映射 `SftpEntry`，目录优先排序
- `upload`：`overwrite` 为 false 且目标存在则抛 `AppException`；否则 `channel.put(in, remotePath, ChannelSftp.OVERWRITE)`
- `download`：`channel.get(remotePath, out)`

**`SftpService implements ISftpService`**（`infrastructure/adapter/service/`）：薄编排，委托 port。

### 4.3 trigger 层

**`SftpController`**（`trigger/http/`，参数显式命名——compiler 锁 3.0 无 `-parameters`）：
- `GET /api/ssh/sftp/list?connectionId=&path=` → `Response<List<SftpEntryDTO>>`
- `POST /api/ssh/sftp/upload`（multipart：`connectionId`/`remotePath`/`overwrite` + `file`）→ `Response<Void>`
- `GET /api/ssh/sftp/download?connectionId=&remotePath=` → `octet-stream`（`StreamingResponseBody` 或直接写 `OutputStream`），带 `Content-Disposition`

### 4.4 api 层

`SftpEntryDTO`：`name / directory / size / lastModified`。成功码字符串 `"0000"`。

## 5. LLM Tool 设计（对称 `SshExecuteAdkTool`）

**`SftpAdkTool`**（`domain/agent/service/tools/`，`@Component`）：

```java
public Map<String, Object> listFiles(
        ToolContext toolContext,
        @Annotations.Schema(name = "path",
            description = "要列出的远程目录绝对路径，例如 /var/log；首次可用 / 或 ~")
        String path)
```

- **永不抛异常**——失败返回 `success:false` 错误 Map（LLM 当观察结果转述）
- 绑定链路同 `executeCommand`：`TerminalContext.getTerminalSessionId(adkSessionId)` → `sshTerminalService.getConnectionId(...)` → `sshSessionPort.isConnected` 校验 → `sftpPort.list` → 组装 Map
- 返回字段：`path / success / entries:[{name,directory,size,lastModified}] / truncated(>200 条截断) / error?`
- 截断策略：条目 >200 条截断，附 `originalCount`（对称 exec 的 8KB 截断思想）

**注册**（`AgentNode.java:35-44`）：
```java
@Resource private SftpAdkTool sftpAdkTool;
...
FunctionTool execTool = FunctionTool.create(sshExecuteAdkTool, "executeCommand");
FunctionTool sftpTool  = FunctionTool.create(sftpAdkTool, "listFiles");
ctx.getTools().add(execTool);
ctx.getTools().add(sftpTool);
.tools(List.of(execTool, sftpTool))
```

> upload/download 是二进制流，不适合直接做 LLM tool；`readFile`（读远程文本返回 LLM）作为同类后续扩展，本期不实现。

## 6. 前端设计

### 6.1 layoutStore

新增 `centerView: 'terminal' | 'sftp'`（默认 `'terminal'`）+ `setCenterView`。ActivityBar sftp 按钮 → `setCenterView('sftp')`；`CommandBlock.run()` 的 `setShowTerminal(true)` 同时 `setCenterView('terminal')`。

### 6.2 App.tsx 中间区

```tsx
{centerView === 'terminal' ? <TerminalPanel/> : <SftpPanel/>}
```
（TerminalPanel 切换时 visibility 隐藏保留——见 §1）

### 6.3 SftpPanel（重写）

```
┌──────────────── 中间 centerView='sftp' ────────────────┐
│ 连接:[srv-01▾]  远程:/home/user▸logs▸app  [刷新]       │
│ ┌──── 本地 ────┐ ⇄拖拽⇄ ┌──── 远程 ────┐               │
│ │ C:\Users\me▸dl│        │ /home/user/app│              │
│ │ 📁photos 📄x │        │ 📁config 📄y │              │
│ └──────────────┘        └──────────────┘               │
│ [⟳] 传输中: server.jar ▓▓▓░░ 62%                       │
└────────────────────────────────────────────────────────┘
```

- 顶部连接选择器（仅 `connected` 连接，默认 `activeId`）+ 远程面包屑 + 刷新
- `DirListView` 对称复用：本地侧数据源 `tauri-plugin-fs`，远程侧 SFTP `list`
- HTML5 DnD：本地→远程=上传，远程→本地=下载；落点=目标侧 cwd

### 6.4 新增 sftpStore

管：`connectionId` / 远程 `cwd`+`entries` / 本地 `cwd`+`entries` / 传输项 `{id,direction,name,progress,status}`。`terminalStore` 不动。

### 6.5 Tauri 配置

装 `tauri-plugin-fs` + `tauri-plugin-dialog`（`Cargo.toml` + `package.json` 各一份），配 capabilities scope。本地根目录默认用户家目录，记忆上次目录。

## 7. 实施阶段

1. **后端 SFTP 能力 + tool**：`ISftpPort`/`SftpEntry`/`SftpSessionPort`/`SftpService`/`SftpController`/`SftpEntryDTO` + `SftpAdkTool.listFiles` + `AgentNode` 注册。改了被依赖模块 → 根目录 `mvn install`。
2. **前端 centerView 切换 + SftpPanel 骨架 + 远程列表 + 连接选择器**：打通「中间看远程目录」。
3. **Tauri fs/dialog + 本地侧列表**：打通「双面板都能看」。
4. **双向拖拽 + 覆盖检测 + 内联进度**：完整闭环。
5. （打磨）空目录态、错误提示、刷新、边界文案。
