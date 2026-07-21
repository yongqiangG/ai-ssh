# ADR 0003：SFTP 传输能力边界与视图模型

> 2026-07-14 grill 会话定稿，已落地。原设计文档（SFTP-DESIGN.md）随实现完成退役，本 ADR 保留长期有效的边界决策；实现细节以代码为准。

## 背景

在中间工作区提供「本地目录 | 远程目录」双面板拖拽传输，同时把 SFTP 列目录能力封装为 LLM tool（`listFiles`）。

## 决策

### 1. 独立 `ISftpPort`，一次性 channel 模型

SFTP 是独立关注点，不并入 `ISshSessionPort`；复用其 `getSession(connectionId)` 拿 JSch Session，每次操作开一次性 `ChannelSftp`、用完断开（对称 exec 的 ChannelExec 模型）。

### 2. 中间区视图模型：`centerView` 切换，不建 tab

`layoutStore.centerView: 'terminal' | 'sftp'`——tab 的本质是连接（terminalStore 与连接 1:1），`activeId` 是两视图共享的锚点。切到 sftp 时 TerminalPanel 用 `visibility:hidden` 保活（会话/日志不丢；sftp 与 shell 是同 session 不同 channel，并存无冲突）。

### 3. 双面板 + HTML5 拖拽是唯一解

Tauri webview「拖出到 OS」不可行 → 要双向拖拽，本地侧必须有可见拖放目标 → 双面板（本地树 | 远程树），`DirListView` 对称复用（本地侧 tauri-plugin-fs，远程侧 SFTP list）。列表形态是单级列表 + 面包屑（FileZilla 默认视图），不做递归树。

### 4. 传输边界（最小闭环，明确不做）

单文件 + 多选；同名覆盖走 confirm + `overwrite` 参数；内联进度条。**明确不做**：目录递归 ❌ 断点续传/分块 ❌ 传输队列面板 ❌ 远程在线编辑/预览 ❌ 多 sftp tab ❌。单文件约 100MB 内。

### 5. 传输通道形态

上传用 `XMLHttpRequest` multipart（fetch 拿不到 upload progress）；下载 `octet-stream` blob 流（绕开 `request.ts` 的 JSON 解包），进度走 `response.body.getReader()`。

### 6. LLM tool 只做 `listFiles`

upload/download 是二进制流，不适合做 LLM tool；`readFile`（读远程文本文件返回给模型）是同类后续扩展候选。`listFiles` 与 `executeCommand` 同契约：永不抛异常、失败返回错误 Map、条目 >200 截断附 `originalCount`。
