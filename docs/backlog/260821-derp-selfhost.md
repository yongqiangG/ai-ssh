# Tailscale 链路提速：Clash TUN 放行 → 自建 DERP

> 来源：situations/260821 Q5 决议（运维执行项，非代码）。

当前手机→PC 走 DERP(悉尼) 500ms–1.3s（Clash Meta TUN 劫持 UDP 干扰打洞 + 手机 CGNAT）。两步走：① Clash Meta `tun` 配置放行 `tailscaled.exe` 进程冲直连（成则 30-80ms，免费）；② 不成则国内 VPS 自建 DERP 节点（<50ms，约 ¥35/年；与 frp 备选通道共享 VPS）。突发式交互当前延迟可用，本项为体验优化非阻塞。
