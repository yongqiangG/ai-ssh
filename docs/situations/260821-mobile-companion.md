# 260821 · AI Coding 手机伴侣——Tailscale + 内嵌 web 门面

## 原始需求（用户原话）

> 当前如果希望将这个本地运行的应用，暴露到公网，允许手机通过web之类的进行操作，这一期主要考虑ai coding的板块，后续再来考虑ssh连接等其他操作。例如人在外面时，依然可以连接到本机进行ai coding对话或者新建任务之类的的操作，有什么成熟的方案。我的想法是通过frp进行内网穿透，然后通过服务器将本地电脑暴露出去，再通过手机的web端来进行操作。或者还有一个Tailscale之类的方式，我不太清楚。这个是成熟的方案吗，有没有这个场景更好的方案，核实后grill me。

> （grill 中补充）A 的 web 化方案会对原有的整体使用做重构吗，这样会不会风险很大。——要求保证当前已经成熟的 PC 使用维持正确。

## 背景（决策时事实，2026-08-21 核实）

- **AI Coding 链路无 HTTP 面**：前端 33 处直接 `invoke()` Tauri 命令（9 文件）；Rust 侧 61 个 `coding_*` 命令——storage/config/fs/analytics 等 40+ 个为无状态薄函数（无 Tauri 依赖），pty.rs 有状态命令注入 `State<TaskManager>`（纯 Rust struct）+ `AppHandle`；事件发射点全模块仅 16 处 `emit()`（event_watcher/fs_watcher/notify/pty/session 五文件）。**穿透工具的前提「本机已有 HTTP 服务」不成立，frp/Tailscale 都无物可穿。**
- **方案成熟度**：frp（国内事实标准，需 VPS ¥60-100+/年，公网暴露，安全压在应用层认证）；Tailscale（WireGuard 网状私网，免费档 3 用户 100 设备，设备级互信零公网暴露）；Cloudflare Tunnel 国内延迟高。
- **Tailscale 实测（2026-08-21 本机）**：PC `johnny` 100.78.122.10 + 华为 Mate 60 Pro 100.118.230.49 入同一 tailnet（johnny.gor10@）。netcheck：UDP true、MappingVariesByDestIP false（易打洞 NAT）、最近 DERP 香港 37.8ms。端到端验证通过：手机**蜂窝流量**下浏览器访问 PC 18080 端口 HTTP 服务成功（双端真实流量 12KB+）。
- **已知摩擦**：① 手机侧 controlplane（`login.tailscale.com`）国内直连不通，登录/同步需借代理「接力」（代理开→Tailscale 拿配置→代理关→Tailscale 独占 VPN 槽），仅入网与密钥过期（约 180 天）时发生，日常纯国内直连；② 当前路径走 DERP(悉尼) RTT 500ms–1.3s，直连未建立——PC 上 Clash Meta TUN（`Meta` 网卡）劫持 UDP 干扰打洞 + 手机蜂窝 CGNAT；突发式交互（看状态/批准/发消息）可用，终端持续打字回显闷。③ PC 防火墙已建临时规则 `ts-test-18080`（TCP 18080 全 profile 放行）。
- 应用现状零鉴权；AI Coding 域带 full_access 权限模式，等于「PC 上执行任意命令」的入口。
- 息屏/锁屏不影响后台任务与 Tailscale；仅睡眠/休眠杀一切。

## 决议

- **Q1 一期性质 → 开发「web 门面」而非纯运维配置**：Tauri 进程内嵌 axum HTTP/WS 服务镜像 coding 命令 + 独立手机 UI 入口。（穿透只是管道，真实工程是补出 HTTP 面；远程桌面手机体验不可用，第三方 web UI 放弃自建差异化。）
- **Q2 存量红线 → diff 白名单制**：桌面前端仅允许「设置面板新增自启开关」一处纯新增；Rust 存量仅允许 ① 16 处 `emit` 机械替换为 broadcast 总线 ② lib.rs 注册 axum 启动 ③ 任务生命周期挂 keep-awake 钩子；`cargo test` + `npm run test:run` + `npm run build` 全绿。白名单外改动即停线重审。（用户硬约束：成熟的 PC 使用不被破坏；核实结论——这不是重构，是加平行门面。）
  - **260821/22 阶段 3 白名单扩展（用户批准）**：手机建的任务需在桌面可见可看，追加桌面前端两处——AiCodingApp 的 `coding:task-created` 监听（入列+buffer 预建+自动导航）与 useTerminalManager 的 `coding:task-output` 事件回退（直通既有注入管线）；Rust 侧配套 send_pty_chunk 对 web_created 任务多发一路事件（tap 与事件并存,channel 任务不受影响）。同时 Q10 再修订：**PTY 尺寸仲裁——手机 WS 在线期间归手机**（桌面 resize 只留底不生效;40 列流在桌面呈窄带可读,反向必散架的不对称性）,断开还原留底；手机查看任务 PC 视图跟随（首连 nav=1 → 复用 coding:navigate 通路）。
- **Q3 手机范围 → 陪伴模式**：任务列表/运行状态 + 终端流查看与输入（agent 确认在 PTY 流内，批准路径必含）+ 新建任务 + 待确认状态横幅；**排除**文件浏览/本地 Shell/看板/设置。（覆盖「人在外面」完整闭环，API 面小 = 攻击面小。）
- **Q4 通道 → Tailscale 主通道，frp 不做**：设备级互信零公网暴露，安全模型优于把主防线押在自写认证上；axum + token 通道无关，frp 随时可作第二通道（仅配置）。
- **Q5 延迟优化路线 → 免费优先**：先在 Clash Meta TUN 配置放行 `tailscaled` 进程冲直连（成则 30-80ms），不成再国内 VPS 自建 DERP（<50ms，与 frp 共享 VPS 成本，不阻塞开发）。（当前 500ms 档对陪伴模式可用。）
- **Q6 认证 → 静态 token**：手机首连输入一次存 localStorage，服务端配置项管理，无 token 401；tailnet 内明文 HTTP 不叠 TLS（WireGuard 已加密；若公网化需 VPS 边缘补 TLS）。（纵深防御轻门，主防线是设备互信。）
- **Q7 双端并发 → 无锁自由交错**：事件双端扇出，两端皆可读可输入。（同一用户，等同双键盘 attach 同一 tmux；零新增状态机。）
- **Q8 睡眠/常开 → OS 设置 + 程序守卫双保险**：用户手设 Windows 永不睡眠；程序内 keep-awake 守卫（任务计数驱动专职线程持有 `SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED)`，清零释放，失败方向安全——最坏=不睡）；新增开机自启开关（tauri-plugin-autostart，默认关，桌面前端唯一白名单 diff）。（防「任务跑一半被睡眠杀死」。）
- **Q9 管道可替换性 → 通道是配置不是代码**：axum 只认到达 18080 的 HTTP，代码零感知 Tailscale；手机端访问地址为输入项（存 localStorage）；后续可零代码切换 frp/headscale/自建 DERP/Funnel，公网化时 VPS 边缘加 TLS。（本期不堵死任何后路。）
- **Q10 技术形态 → REST + WS + 独立 vite 入口**：REST 管任务 CRUD，WebSocket 管 PTY 双向流（输入帧 base64 保二进制安全，手机端不 resize 避免与桌面打架）；手机 UI 独立入口不进桌面 bundle；断线重连回放最近 ~256KB 尾窗（复用 session 查看器读取逻辑）。（实现细节，开发中可调。）
  - **260821 阶段 2 修订**：①手机端 **resize 接管**（不 resize 实测不可用：PTY 按桌面 220 列开、TUI 压进手机 40 列屏完全散架）——WS 建连发 resize 帧，最后一个手机连接断开时还原桌面最近 resize 留底（`coding_resize_pty` 记账）；②输入帧直接 JSON 字符串（既有链路是 String 非 raw 字节，base64 无必要）；③滚动走 SGR wheel 鼠标序列翻译（Claude 跑 alt-screen 无本地 scrollback，滚轮是 TUI 自处理事件）；④spawn 显式清除 NO_COLOR/CLAUDE_CODE_CHILD_SESSION（宿主脏环境泄漏会让 agent 输出全白，产品级修复）。
- **Q11 评审补丁整体回滚（2026-08-23）**：260823 交付的评审补丁三提交（P1-a/P1-b/P2-a/P2-b/P2-c、卫生项含 imeGate/nav=1/api 404/resize 守卫，及其 docs 补记）**用户判定为无效修复，当日整体回滚**——仅保留无关的 agent_compat 死代码清理（487fc86），`release/02-ai工作台` 本地与远端已 force 同步至回滚态。（补丁所修问题若真实现，重开决策而非直接复活旧提交；回滚前完整状态封存于 2d64277，reflog 可寻。）

## 影响范围

- ssh-client Rust：`coding/web/` 新模块（axum + token 中间件 + REST + WS）；`coding/` 新增 events 总线模块并替换 16 处 `emit`；`coding/keepawake.rs` 新模块挂 TaskManager 生命周期；`lib.rs` 启动注册；Cargo.toml 加 axum 系依赖 + tauri-plugin-autostart；app_settings 加 token 等字段。
- ssh-client 前端：**存量不动**（唯一例外：设置面板新增自启开关）；新增手机伴侣独立入口（vite 多入口）。
- 不动：ssh-server、SSH 运维链路、三条信任红线（本功能域独立于红线之外，沿用 agent CLI 原生权限交互）。
- 运维事实：端口 18080；防火墙规则 `ts-test-18080` 已存在（后续转正式命名）；tailnet 两节点已入网。
- pool 落一条：Clash TUN 放行实测 + 自建 DERP 路线（Q5 执行项，运维非代码）。
