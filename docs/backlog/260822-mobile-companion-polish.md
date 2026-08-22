# 手机伴侣细节打磨

> 来源：260821 手机伴侣收官遗留（docs/actions/done/260821-mobile-companion.md 验证栏）。

体验优化非阻塞项，日常使用中按疼的程度捞：
- 桌面窄带渲染观感：手机在线期间 PTY 归手机（40 列），桌面窗口显示窄带流可读但不美观——可做居中/缩放或状态提示条（「手机正在操控此终端」）。
- web 建任务的 buffer ensure 兜底：当前依赖 task-created 事件预建，理论丢失场景（事件错过）下点开 running 任务仍回落「无 session」提示——在任务打开路径加 ensureTaskTerminal 兜底。
- running 态陈旧修正：手机建的任务若桌面从未打开该项目，tasks.json 里 status 永远停在落盘时的 pending/running——列表展示可按 PTY 句柄存活性现场修正。
- 多桌面切换体验：PWA manifest `name` 设备名插值（axum 服务 manifest 时注入本机名，约 10 行）——双机书签切换频繁、点错同名图标烦了再做（决议见 situations/260822）。
- keep-awake/自启/断线重连的观察项验收（powercfg 需管理员、重启验证）。
