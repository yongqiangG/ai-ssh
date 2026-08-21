# 260821 行动档：AI Coding 手机伴侣（web 门面一期）

> 背景：docs/situations/260821-mobile-companion.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

红线（Q2 决议，全程有效）：桌面前端 diff 仅限「设置面板新增自启开关」；Rust 存量 diff 仅限 emit×16 机械替换 / lib.rs 启动注册 / keep-awake 钩子；`cargo test` + `npm run test:run` + `npm run build` 全绿；白名单外改动停线重审。

## 阶段 1：地基——axum 骨架 + broadcast 总线 + 只读 API + 手机页面壳

**目标**：Tauri 进程内起 18080 端口的 axum 服务（token 认证），16 处 emit 改总线扇出（桌面行为等价），手机浏览器能拉到任务列表。

**设计**（随实现就地更新）：
- `coding/events.rs`：`tokio::sync::broadcast` 总线（容量 1024，状态类事件滞后丢弃无害；**PTY 字节流不走总线**——agent 任务输出走 `tauri::ipc::Channel` 单订阅直投、shell 输出走事件，阶段 2 需在 `OutputSink` 源头另设带序号环形缓冲）。16 处 emit 改 `events::publish(&app, ...)` **双写**：原地 `app.emit`（桌面路径逐字节不变）+ 旁路广播，无桥任务、无额外跳变
- `coding/web/mod.rs`：axum + tokio（`tauri::async_runtime::spawn`），`0.0.0.0:18080`；配置独立落 `~/.ai-ssh/coding/web.json`（enabled 默认 true/port 18080/token 空则自动生成 uuid 回写）——**刻意不进 app_settings**：桌面设置面板整结构体回存会把不认识字段抹回默认、token 被重置
- 只读 API（统一封皮 `{"code":"0000"}`）：`GET /api/health`（免鉴权）、`GET /api/projects`、`GET /api/projects/{id}/tasks`、`GET /api/tasks/{id}`（跨项目扫描）；handler 注入 fn 指针 loader，纯函数可测不碰真实 `~/.ai-ssh`
- 鉴权：`X-Companion-Token` 头或 `Authorization: Bearer`，失败 401（code 0401）；`/api/*` 组经 `route_layer`，静态资源与 health 免鉴权
- 静态资源：rust-embed 6.8（pin 6.8 + `#[folder = "../dist-mobile"]` 相对 src-tauri/——**8.x 对缺失目录宽容导致真凶被吞、路径差一级编译期即 panic**），debug 从磁盘实时读（前端迭代免重编）、release 内嵌；SPA 兜底回 index.html
- 手机壳：vite 独立构建（`vite.mobile.config.ts`，root=`mobile/`，产物平铺 dist-mobile/index.html），`src/mobile/`（api/App/main/css，token 首连页 + 项目/任务列表 + 状态徽标），`build:mobile` 脚本末尾补写 `.gitkeep`（emptyOutDir 会清掉）；tauri `beforeBuildCommand` 追加 `npm run build:mobile`
- WebState 阶段 1 只含 token + loaders；阶段 2 给 `start()` 传 AppHandle 入 state（tauri 2.x `State::inner()` 只给 `&TaskManager` 拿不到 Arc，AppHandle Clone 廉价，`app.state::<TaskManager>()` 就地 Deref）

**验收标准**：
- 三套验证全绿（cargo test / npm run test:run / npm run build）
- 桌面端事件冒烟清单通过：任务启动/输出/状态变化/文件变更/通知与改前一致
- 手机（蜂窝流量 + tailnet）带 token 拉到任务列表 JSON；无 token 得 401

**测试用例**：
- Rust：总线扇出/晚订阅/滞后恢复（共享 BUS 单例，测试加锁串行 + 零订阅者 send 需保活端，同 260820 analytics 纪律）；token 中间件 401/放行/health 免鉴权（oneshot）；三个只读 handler 纯函数（0000/空/不存在映射 0404）；web.json 默认值与部分解析
- 前端：现有回归套件原样全绿（本阶段桌面前端零 diff）

**验证**：cargo test 112 全绿 / vitest 36 文件 261 全绿 / npm run build 过（含 src/mobile 类型检查）；dev 实例实测四连——health 返 0000、无 token 401、token 拉到 5 个项目真实数据、静态页 200；手机真机（蜂窝流量+tailnet）token 首连 + 项目/任务列表人工验收通过；桌面回归 = 全量测试 + dev 实例人工目验（emit→publish 双写，桌面前端零 diff；5 个 emit 文件的 Emitter 导入随替换清理）。坑与对策：PowerShell 管道改文件致 GBK mojibake（只用 Edit/Write 工具）、rust-embed 路径相对 CARGO_MANIFEST_DIR、dev 实例被「双开归一」让位（须先退正式版实例）

**状态**：已完成

## 阶段 2：核心闭环——PTY 流 WS + 终端查看/输入 + 断线重连 + 状态横幅

**目标**：手机实时看终端输出、发按键过 agent 确认；断网重连不丢后续输出。

**设计**：
- `WS /api/ws/task/:taskId`：建连先推最近 ~256KB 尾窗快照（复用 session 查看器读取逻辑，复用其截断纪律），再实时转发总线 PTY 事件；输入帧 `{type:"input", data:<base64>}` → `TaskManager` 写入路径
- 手机端不 resize（固定逻辑尺寸，避免与桌面端打架）；连接断开自动重连（指数退避），重连走同样的尾窗回放
- 待确认横幅：input_required/awaiting_review 状态事件 → 手机顶部通知条（attention 事件源复用）
- xterm.js 复用桌面同款渲染（mobile 入口独立打包自己的实例）

**验收标准**：
- 手机在任务运行时看到流式输出；发 `y`+回车能通过 agent 确认
- 手机断网 30s 后重连，不丢期间输出（尾窗覆盖）
- 桌面端同任务终端行为不变（双端并发无锁自由交错，Q7 决议）

**测试用例**：
- Rust：WS 集成测试（tokio 起服务连 WS：尾窗快照→实时流→输入回环）；尾窗截断正确性；双订阅者扇出
- 前端：mobile 重连状态机单测（mock WS）

**验证**：
**状态**：未开始

## 阶段 3：补全——新建任务 + keep-awake 守卫 + 自启开关 + 主屏快捷方式

**目标**：手机全闭环（新建→跑→批准→看结果）；任务运行时 PC 不睡；PC 重启后应用可自启。

**设计**：
- `POST /api/projects/:id/tasks`（agent/权限模式/cwd），走 `coding_run_task` 同一内部路径，不复制逻辑
- `coding/keepawake.rs`：专职长寿命线程持有 `SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED)`，任务计数 0→N 获取、N→0 释放；挂 TaskManager 起止/终结路径（沿用 260820 资源评审的清理纪律）
- autostart：tauri-plugin-autostart + GeneralPanel 开关（默认关，**桌面前端唯一白名单 diff**）
- PWA-lite：manifest + 图标，可添加到主屏（不做 service worker 离线）

**验收标准**：
- 手机完成新建→运行→批准→查看全闭环（蜂窝流量）
- 有任务跑时 `powercfg /requests` 可见 SYSTEM 条目，任务清零后消失
- 自启开关开→重启 PC 应用拉起；默认关不拉起
- 三套验证全绿 + 桌面冒烟清单复跑

**测试用例**：
- Rust：keep-awake 计数单测（获取/释放/重复/异常清理路径）；新建任务参数校验单测
- 前端：自启开关组件测试

**验证**：
**状态**：未开始
