# 260822 · AI Coding 手机伴侣——第二台桌面入网（双机切换）

## 原始需求（用户原话）

> 当前在另外一台电脑已经打通这个链路，如果我想在这台电脑也打通这个链路。当前这个方案支持手机在两个桌面端进行切换吗，例如也安装tailscale，核实下是否可行 grill me

## 背景（决策时事实，2026-08-22 核实）

- **架构天然支持多桌面，零代码改动**：手机页由各桌面自身 axum 托管、API/WS 全走同源 `location.host`（`src/mobile/api.ts`）；token 存 localStorage，而 localStorage 按 origin（协议+主机+端口）隔离——两台桌面 = 两个 origin，各自的 token 各自记，互不覆盖。每台桌面独立 token 落 `~/.ai-ssh/coding/web.json`（空则首启自动生成 uuid）。手机端零跨机共享状态，切换 = 换访问地址。
- **手机单账号是硬前提**：Tailscale 手机 App 同一时刻只能登录一个账号（切换需重走代理接力），双机切换轻量的前提是两台桌面同一 tailnet。
- **PWA 按 origin 独立安装**（manifest `start_url` 相对路径），但 manifest `name` 固定「ai-ssh 伴侣」，两个图标同名，仅可按位置区分。
- **本机入网前现状**：web.json 已就绪（token 已生成）；Tailscale 未装；防火墙无 18080 放行；跑着 Clash Verge + Meta TUN（与另一台同款，将继承「DERP 悉尼 500ms–1.3s」延迟档）。
- **tailnet（johnny.gor10@，MagicDNS 后缀 `taile502f1.ts.net`）**：另一台 PC `johnny` 100.78.122.10、手机 `huawei-mate-60-pro` 100.118.230.49；本机入网分得 `johnny-home-pc` 100.125.52.27。

## 决议

- **Q1 同一 tailnet**：两台桌面 + 手机同入 johnny.gor10@；本机设备名 `johnny-home-pc`。（手机只认一个 tailnet；命名区分避免与既有 `johnny` 混淆——Tailscale 遇同名自动改 `johnny-1`。）
- **Q2 切换交互 = 浏览器书签起步**：零开发零维护。PWA manifest 设备名插值（axum 服务 manifest 时注入，约 10 行 Rust）留观——切换频繁、点错图标烦了再做，落 backlog polish 一行。App 内服务器切换器不做（跨 origin 要 CORS + 双 token 管理 + WS 重连状态机重写，工程量不配收益）。
- **Q3 本机防火墙立正式规**：`ai-ssh-coding-web-18080`，入站 TCP 18080、远程地址限 `100.64.0.0/10`（CGNAT 段 = 仅 tailnet 来源）、全 profile。（attack surface 从「局域网+tailnet」缩到「仅 tailnet」，与 Q4「设备互信为主防线」决议对齐；另一台临时规 `ts-test-18080` 的改名属顺手清理非阻塞。）
- **Q4 Clash 干扰照搬另一台已验证形态**：`tun.exclude-process: [tailscaled.exe]`（Clash Verge 全局扩展配置 Merge）。（TUN 层直接排除，流量不进 mihomo 栈、原始 socket 与 NAT 映射保留，对 UDP 打洞最干净——优于规则级 `PROCESS-NAME,...,DIRECT` 的截走再直连。验收 `tailscale ping` 手机出 `via direct`；仍 DERP 则走池内自建 DERP 路线，不折腾。）
- **Q5 接受三孤岛边界，不进 backlog**：任务数据不互通（各自 `~/.ai-ssh/coding/`）、通知不聚合（待确认横幅只在当前打开的 origin）、状态无跨机联动。（「同一用户的两个工作位」的自然属性非缺陷；真需要聚合层时说明同时在两台跑任务且都卡确认——解法是少开一台，不是造聚合层。）
- **Q6 本机为无人值守角色**：OS 交流电永不睡眠 + app 开机自启开关 + keep-awake（已交付自动生效）+ 安装 release 构建。（本机也要独立跑长任务，人离开后手机要能看；仅 dev 会话在线满足不了。）

## 影响范围

- **零代码改动**（Q2/Q5 明确不做开发项；manifest 插值留 backlog）。
- 本机运维（执行于 2026-08-22）：Tailscale 1.102.2（winget）入网改名 `johnny-home-pc`；防火墙规则已立；`powercfg` 交流电永不睡眠已设；Clash Merge exclude-process 已保存；release 构建安装 + app 内自启开关（装机后开启）。
- 手机侧：新增书签 `http://johnny-home-pc.taile502f1.ts.net:18080`（或裸 IP `http://100.125.52.27:18080`），首次访问输入本机 token（per-origin 存储，与另一台的 token 互不干扰）。
- backlog：`260822-mobile-companion-polish.md` 补一行 PWA manifest 设备名插值。
- 验证记录（2026-08-22 收尾）：①安装版 app 门面 `0.0.0.0:18080` 本地 HTTP 200；②手机蜂窝访问书签出任务列表、任务输入回显正常（用户验收通过）；③`tailscale ping` 手机 = `direct`（非 DERP）——`tun.exclude-process` 生效判据达成；实测 RTT ~400ms 为当时 **PC 经手机热点上网、双端同蜂窝 NAT** 的产物，非打洞失败，PC 回固定宽带 + 手机异地蜂窝时预期 30-80ms 档，留日常观察。④开机自启重启验证未做，留 backlog polish 既有观察项。
