# ssh-client UI/UX 整体重设计：「电路霓虹 · 能量流」

## 原始需求（用户原话）

> 我现在想通过这两个skill（frontend-design + impeccable）来重新打磨这个项目的client的ui和ux，整体的功能已经跑通。我希望client端的界面和交互可以更加的酷炫，达到一个高质量的设计品质，跳出传统布局框架，追求先锋视觉风格，流畅的物理动效。打造统一完整的的精品页面，做出突破常规ui认知、令人惊艳的交互体验。

## 背景（决策时事实）

- 功能全部跑通，本次为纯视觉/交互重塑，不改业务行为。
- 现状：Linear/VSCode 风格深色 UI（indigo 强调、hairline 描边、CSS Modules + `--vsc-*` 令牌、无动画库）；已有三个动效资产（几何吉祥物、flyToTerminal 三幕 WAAPI 动画、卡片呼吸光条）。
- 令牌双轨契约：CSS 变量与 themeStore 的 ThemePalette 同名同步，xterm 运行时读 JS palette。
- 桌面离线运行，字体等资源必须本地打包。
- 新装 skill：frontend-design（官方）+ impeccable v4.0.2，本次重设计按其方法论执行。

## 决议（问题 + 结论）

1. **视觉世界选哪个方向？** → **电路霓虹能量流**（赛博朋克路线：霓虹渐变描边、能量沿边框流动、命令执行 = 电流传导注入终端）。理由：动效语言天然成体系——一切反馈皆能量流，与「AI 把结论安全送回终端」的产品叙事同构。（候选：深空指挥舱 HUD、极光玻璃、CRT 幽灵终端，均落选。）
2. **浅色主题去留？** → **只做深色**，砍掉浅色主题与切换开关，themeStore 结构保留仅剩 dark。理由：先锋视觉世界在浅色下不成立，双主题拉低上限且成本 +40%。
3. **物理动效技术底座？** → **引入 motion 库**（framer-motion 续作，React 19 兼容）。理由：真弹簧物理与布局动画是「流畅物理动效」的正规军；DOM 直操的 flyToTerminal 维持 WAAPI。
4. **信任红线如何处理？** → 三条红线（命令可见可编辑 / 写确认 / 高危防呆）语义原样保留，视觉上强化而非弱化（高危 = 高压警示，视觉音量高于一切装饰）。
5. **DESIGN.md 何时写？** → 按 impeccable new-work 规范，完工时从已建成世界记录，不预写。方向契约先落本文件与 index.css 头注释。

## 影响范围

- `ssh-client/src` 全部 34 个样式文件与对应组件（分 5 阶段推进，见 actions/260726-ui-neon-circuit-redesign.md）。
- 新增依赖：motion、@fontsource/chakra-petch、@fontsource/jetbrains-mono。
- 后端 ssh-server 零改动；业务逻辑/store 行为零改动。
