# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

（Tauri v2 桌面壳内的 web 前端；设计语言按桌面 web 处理，非原生 OS 语言。）

## Users

个人开发者 / 运维工程师，在自己的 Windows 桌面上管理远程 Linux 服务器：连接、执行命令、传输文件、排查故障。使用场景常伴随时间压力（服务出问题、部署中断），用户对终端语义熟悉，对误操作高度敏感。

## Product Purpose

具备 AI 运维能力的 SSH 客户端。AI 不是旁挂的聊天窗——它能看到终端里发生了什么，并把结论安全地送回终端执行。成功 = 用户敢把真实生产机交给它管，且比裸终端更快定位、更少犯错。

## Positioning

「AI 与终端同处一室」：AI 可读取终端上下文（选区即问、报错诊断），可生成命令回填终端（只预填不回车）。邻近产品要么是纯 SSH 客户端（AI 盲）、要么是旁挂 Copilot（碰不到终端）。

## Operating Context

- VSCode 式三栏工作台：左侧连接管理（ActivityBar + Sidebar）、中部终端/SFTP 舞台、右侧 AI 对话舱，可拖拽分栏。
- 启动门（BootSplash）负责 sidecar 后端拉起，就绪前全屏接管。
- 长时间开着当工作台用：常驻监控条（CPU/内存）、多终端 tab、SFTP 双面板传输。

## Capabilities and Constraints

- SSH 连接 CRUD + 多会话终端（xterm.js）、SFTP 双面板、AI 对话（NDJSON 流式、思考过程可视化、工具调用）、命令确认门、服务器监控条、LLM/后端设置。
- **三条信任红线（产品级不可破）**：命令执行前永远可见可编辑（只预填不回车）；写操作必须人工确认；高危命令强制防呆（AI 生成与手输同防）。
- 技术：React 19 + Zustand 5 + CSS Modules；桌面离线运行，资源（字体等）必须本地打包，不可依赖 CDN。
- 终端配色经 themeStore 的 JS ThemePalette 注入 xterm（运行时读值，非 CSS 变量），该契约必须保持。

## Brand Commitments

- 名称 AI-SSH；几何小吉祥物（圆角方块 + 眼睛/嘴，启动门与会话提示共用）为已确立形象，保留并可强化。
- 已确认的界面文案语言为中文，语气平实（错误信息「人话化」是已交付特性）。
- 2026-07-26 用户决议（本次重设计的绑定视觉约束）：视觉世界「电路霓虹 · 能量流」；仅深色主题；物理动效引入 motion 库。

## Evidence on Hand

- 全部真实功能已跑通（无 mock）；docs/situations/ 与 docs/adr/ 存有历次产品决议。
- 无营销页/落地页诉求，全部 surface 均为 Operate 模式的工具界面。

## Product Principles

1. 信任优先于炫技：任何视觉表达不得模糊「即将执行什么」的可读性。
2. 能量即状态：视觉反馈忠实映射系统真实状态（连接、执行、传输、思考）。
3. 长时间可驻留：常亮工作台，装饰动效有上限，不与终端争注意力。
4. 危险必须显眼：高危态的视觉音量永远高于装饰。

## Accessibility & Inclusion

- `prefers-reduced-motion` 全局压平动画（已实现，须保持）。
- 键盘焦点环可见（:focus-visible，须保持）。
- 长时间使用场景，正文对比度不因霓虹风格牺牲。

（本文件由代码库证据与 2026-07-26 用户决议推断整理；用户已指示自动模式，未再逐项访谈。）
