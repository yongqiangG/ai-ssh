---
name: AI-SSH
description: 具备 AI 运维能力的 SSH 客户端——电路霓虹·能量流视觉世界
colors:
  void-editor: "#07080f"
  void-sidebar: "#0b0d17"
  void-floating: "#10131f"
  volt: "#00e5ff"
  plasma: "#ff2d95"
  circuit: "#7c5cff"
  surge: "#ffb020"
  overload: "#ff4d6d"
  live: "#3dffa8"
  link-blue: "#5ca8ff"
  ink: "#c6cbe0"
  ink-strong: "#f0f3ff"
  ink-muted: "#8a93b2"
  ink-faint: "#6a7394"
  ink-on-volt: "#041018"
  ink-on-overload: "#2a040c"
  hairline: "rgba(140, 160, 255, 0.1)"
  hairline-strong: "rgba(140, 160, 255, 0.22)"
typography:
  label:
    fontFamily: "Chakra Petch, Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "10px-11px"
    fontWeight: 600
    letterSpacing: "0.04em-0.1em"
  body:
    fontFamily: "-apple-system, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace"
    fontSize: "12px-13px"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "linear-gradient(100deg, {colors.circuit}, {colors.volt})"
    textColor: "{colors.ink-on-volt}"
    rounded: "{rounded.sm}"
    height: "26px"
    padding: "0 12px"
  button-secondary:
    backgroundColor: "rgba(140, 160, 255, 0.08)"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "26px"
  button-compact:
    backgroundColor: "linear-gradient(100deg, {colors.circuit}, {colors.volt})"
    textColor: "{colors.ink-on-volt}"
    rounded: "{rounded.sm}"
    height: "22px"
    padding: "0 8px"
  input-default:
    backgroundColor: "{colors.void-floating}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
  card-node:
    backgroundColor: "rgba(158, 170, 255, 0.03)"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: AI-SSH

## Overview

**Creative North Star: "通电的电路板（The Live Circuit）"**

整个工作台是一块通电的暗色电路板：服务器是电路节点，AI 是副驾电源，命令与数据是在电路中流动的能量。系统状态从不靠文字独白——通电（活跃）、流动（执行/传输/思考）、高压（危险）三种能量形态就是界面的语言。深空 void 三层底压住全场，能量三色 plasma→circuit→volt 只在「真的有事发生」的地方出现。

这是 Operate 模式的工具界面：表达永不遮蔽任务。终端视口内零特效，装饰性常驻动画同屏不超过 3 处，危险态的视觉音量永远高于一切装饰。已确认的反参照（anti-reference）：旧版「VSCode 皮肤 + Linear indigo」的中性工具脸。

**Key Characteristics:**
- 深空底 + 发光 hairline 描边，面板即电路板
- 能量渐变只表达「进行中/活跃」，静止元素不上渐变
- 弹簧位移（motion 库）+ 发光呼吸（CSS）双动效族
- 中文正文系统栈，标签/徽标用 Chakra Petch 丝印体，等宽一律 JetBrains Mono

## Colors

深空冷底上的三色能量导线，加三只状态信号灯。

### Primary
- **Volt 电青** (#00e5ff)：主强调。活跃态、焦点环、执行按钮、能量流终点色。深色文字 ink-on-volt (#041018) 压在其上。
- **Plasma 品红** (#ff2d95)：用户侧身份色（用户消息描边/头像）、能量流起点色。
- **Circuit 电紫** (#7c5cff)：渐变中继、AI 思考态、次强调与选中态。

### Secondary（状态信号灯）
- **Live 荧绿** (#3dffa8)：在线/成功/终端 prompt。
- **Surge 琥珀** (#ffb020)：警示/连接中/写操作确认（合闸）。
- **Overload 警红** (#ff4d6d)：错误/高危命令（高压警示），文字用 ink-on-overload (#2a040c)。

### Neutral
- **Void 三层底** (#07080f / #0b0d17 / #10131f)：编辑区 / 侧栏 / 浮层，亮度递增表达层级。
- **Ink 系** (#c6cbe0 正文 / #f0f3ff 强调 / #8a93b2 次要 / #6a7394 微弱)：冷蓝灰文字阶梯。
- **Hairline** (rgba(140,160,255,0.1) / 0.22)：半透明冷蓝描边，取代实色边框。

### Named Rules
**The Energy-Means-Motion Rule.** plasma→circuit→volt 渐变（`--energy-flow`）只出现在「正在发生」的元素上：流动动画、进行态描边、充能条。静止元素永远不披渐变——渐变的稀缺性就是状态可读性。

**The High-Voltage Rule.** overload 红的视觉音量（描边+辉光+嗡鸣脉动）必须压过屏幕上一切装饰；反之，装饰动画永远不得使用 overload 红。

## Typography

**Display Font:** Chakra Petch（fallback Segoe UI / Microsoft YaHei）
**Body Font:** 系统栈（-apple-system / Segoe UI / PingFang SC / Microsoft YaHei）
**Label/Mono Font:** JetBrains Mono（fallback Cascadia Code / Consolas）

**Character:** Chakra Petch 的棱角像电路板丝印，只用于小号标签；正文交给系统 CJK 栈保证中文长时阅读；一切命令、代码、主机名、数字仪表走 JetBrains Mono。

### Hierarchy
- **Label**（600，10-11px，letter-spacing 0.04-0.1em，多为大写）：面板标题、状态徽标、监控条标题——Chakra Petch。
- **Body**（400，13px，line-height 1.5）：正文、消息、表单。
- **Mono**（400-600，11-13px）：终端、命令块、代码块、主机地址、指标数值（tabular-nums）。

### Named Rules
**The Silk-Screen Rule.** Chakra Petch 只出现在 12px 以下的标签面；正文与标题永远不用它——丝印是元件铭牌，不是文章。

## Layout

VSCode 式三栏工作台：48px ActivityBar + 可拖左栏（连接管理）+ 中部舞台（终端/SFTP）+ 可拖右栏（AI 对话舱）。分隔条是 1px 通电导线（hover 点亮）。密度紧凑（13px 基准、26px 控件高、8-16px 节奏），长时驻留场景，禁止横向滚动。

## Elevation & Depth

混合策略：层级主要靠 void 三层底的亮度阶梯（tonal layering），阴影只有两种角色——深空投影（模态/浮层用带偏移的黑影 `0 16px 48px rgba(0,0,0,0.55)`）与能量辉光（状态发光 `0 0 8-24px var(--glow-*)`）。

### Shadow Vocabulary
- **深空投影** (`0 16px 48px rgba(0,0,0,0.55)`)：模态、悬浮气泡。
- **能量辉光** (`0 0 8px~24px` 各 `--glow-volt/plasma/circuit/overload/live`)：状态性发光，语义与色相绑定。

### Named Rules
**The Glow-Is-State Rule.** 辉光是状态不是装饰：volt=活跃、circuit=思考/选中、live=在线、surge=警示、overload=危险。不给中性元素加辉光。

## Shapes

小锐圆角：4px 控件 / 8px 卡片 / 12px 模态。描边一律 1px（hairline 或能量渐变 border-box 技法），禁止 >1px 的单侧色条。进行态用 conic-gradient 爬行弧（`--crawl-angle` @property）表达「电流在找路」。

## Components

### Buttons
- **Shape:** 4px（`--radius-sm`）
- **Primary:** circuit→volt 渐变底 + 深色文字 (#041018)，hover 渐变位移增亮 + volt 辉光
- **Compact（`.btn-sm`）:** 22px 高紧凑主 CTA，用于面板头等窄位（如连接面板「+ 新建」），能量语言与 Primary 一致
- **Hover / Focus:** 120-200ms `--ease-out`；:active scale(0.97)；focus-visible 2px volt 外环
- **Secondary:** 半透明冷蓝底（rgba(140,160,255,0.08)），无辉光
- **Danger（合闸/高压）:** surge 或 overload 实色底 + 深色文字，hover 同色辉光

**The One-Switch Rule.** 每个动作全应用只保留一个常驻入口：新建连接 = 连接面板头部 CTA；后端设置 = ActivityBar 底部；LLM 设置 = 对话面板。空态引导按钮（EmptyState）与启动门自救按钮（BootSplash 失败页）是上下文通道，不算重复。

### Cards / Containers（电路节点卡）
- **Corner Style:** 8px
- **Background:** rgba(158,170,255,0.03) 上浮于侧栏底
- **激活态:** 能量流描边（双层 background：padding-box 深底 + border-box `--energy-flow-loop` 位移动画）+ glowBreathe 呼吸辉光
- **连接中:** conic 爬行弧描边（crawlSpin 1.4s）
- **Border:** 1px hairline；hover 升为 hairline-strong

### Inputs / Fields
- **Style:** void-floating 底 + 1px hairline-strong + 4px 圆角
- **Focus:** 「通电」——volt 描边 + `0 0 0 3px rgba(0,229,255,0.16)` 电场 + volt 辉光
- **Error:** overload 红描边与淡红底
- **选择器族**（智能体/会话切换等 select）：24px 高与开关芯片同排对齐；hover circuit 紫描边、focus circuit 电场——紫 = 选择/思考族，与 volt 的输入/执行族区分
- **聊天输入区**：发送钮 = 注入（circuit→volt 渐变，有字即带微辉光，hover 满档）；停止钮 = 断路（danger 红底红描边）——一对语义互反的按钮永远不同色
- **齿轮按钮**（`.gear-spin`）：一切设置入口 hover 齿轮旋转 90°（`--dur-slow` + `--ease-out`），全应用一致

### Switch Chip（开关芯片）
- **Shape:** 999px pill，24px 高，内置 6px 状态灯
- **关闭:** hairline-strong 描边 + ink-muted 文字 + 熄灭灰灯
- **开启:** volt 描边（rgba(0,229,255,0.5)）+ volt 文字 + 状态灯点亮发光 + 微弱电场底
- **用途:** 一切「持续生效的开关」（深度思考、让 AI 看终端、自动检测报错）；带 `aria-pressed`。开关状态由灯表达，禁止「·开/·关」文字后缀

### Panel Toggle Group（面板显隐开关组）
- Header 右侧 segmented 组：三个 30×24 图标钮共享 hairline 外框，图标即区域（panelLeft / panelTerminal / panelRight）
- **显示中:** volt 染色 + 淡电场底 + drop-shadow 辉光；隐藏 = ink-faint
- 动作类按钮（如新建对话）不得混入开关组——开关表达状态，动作触发事件，两族永不同容器

### Navigation（ActivityBar 能量轨道）
- 48px 竖轨，活跃项 volt 染色 + drop-shadow 辉光，指示器为 2px volt→circuit 渐变棒，由 motion layoutId 弹簧滑动（stiffness 520, damping 34）。

### 签名组件：电流传导（flyToTerminal）
命令确认/手动执行时，命令化作 circuit→volt 渐变脉冲 chip（⚡ 前缀 + 双残影拖尾），三幕 WAAPI 弧线飞向终端，落点 volt 主浪涌 + plasma 余波双 ripple + 面板震动。`prefers-reduced-motion` 或无 WAAPI 时降级为落点单次发光。SFTP 传输条与启动充能条复用同一「能量在流动」隐喻（`--energy-flow-loop` 位移）。

## Do's and Don'ts

### Do:
- **Do** 把 keyframes 定义在消费它的 CSS Module 文件内——CSS Modules 哈希化 animation 名，引用 index.css 全局 keyframes 会悬空静死。
- **Do** 动画只碰 transform / opacity / background-position（合成器友好）；进度类一律 `transform: scaleX()`，禁 width/left 过渡。
- **Do** 为每个无限循环动画补 `prefers-reduced-motion: reduce` 关停（全局压平已兜底，模块内仍显式声明）。
- **Do** 新增颜色时同步 index.css 变量与 themeStore.ThemePalette 双侧（xterm 运行时读 JS palette）。
- **Do** 有色底上的文字用同族深色 ink（ink-on-volt / ink-on-overload / #1a1206），保 4.5:1。

### Don't:
- **Don't** 给静止元素上能量渐变或辉光（The Energy-Means-Motion Rule）。
- **Don't** 恢复浅色主题路径——本世界仅深色（决议 260726）。
- **Don't** 在 xterm 视口内叠加任何特效层。
- **Don't** 同屏放超过 3 处常驻流动动画。
- **Don't** 用 PowerShell 管道改写含中文的源文件（编码事故已发生过一次），文本处理走 Read/Write 工具。
