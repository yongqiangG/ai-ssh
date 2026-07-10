# ssh-client UI 设计开发文档

> 2026-07-09 经 UI/UX Pro Max skill 评审后确定的界面改版设计规范。
> 方向：**Linear/Warp 风 Modern Dark**，中等特效强度，dark-first（浅色主题降级维护）。
> 本文档是视觉/动效实现的唯一依据；配色 token 修改时必须同步 `src/stores/themeStore.ts` 的 `PALETTES`。

## 1. 设计原则

1. **深蓝黑分层，不用纯灰/纯黑**：背景带蓝调（`#0a0b10` 一族），层级靠「表面亮度递增 + hairline 半透明描边」表达，不靠重阴影。
2. **Indigo 光晕 accent**：主色 `#5e6ad2`，交互焦点/主按钮配 `--accent-glow` 光晕；AI 相关元素用 indigo→cyan 渐变做身份识别，与普通控件区分。
3. **动效表达因果，节奏全局统一**：所有过渡走 motion token（120/200/320ms + spring 曲线），只动 transform/opacity/color/box-shadow，不动布局属性。
4. **终端区域保持纯净**：xterm 视口内不加任何装饰特效；氛围特效只出现在空态和 AI 面板。
5. **可访问性不妥协**：focus ring 可见、正文对比度 ≥4.5:1、`prefers-reduced-motion` 全局降级。

## 2. 设计 Token

### 2.1 色板（dark，主主题）

| Token | 值 | 用途 |
|---|---|---|
| `--vsc-editor-bg` | `#0a0b10` | 编辑区/终端底 |
| `--vsc-sidebar-bg` | `#0e0f16` | 侧栏/面板 |
| `--vsc-titlebar-bg` | `#12131c` | 顶栏 |
| `--vsc-panel-header-bg` | `#111219` | 面板头 |
| `--vsc-activitybar-bg` | `#0c0d13` | 活动栏 |
| `--vsc-input-bg` | `#161826` | 输入控件 |
| `--vsc-list-hover` | `rgba(255,255,255,0.05)` | 列表 hover |
| `--vsc-list-active` | `rgba(255,255,255,0.09)` | 列表按压 |
| `--vsc-list-selected` | `rgba(94,106,210,0.2)` | 选中态 |
| `--vsc-border` | `rgba(255,255,255,0.07)` | hairline 描边 |
| `--vsc-border-strong` | `rgba(255,255,255,0.16)` | 强描边 |
| `--vsc-fg` | `#c8cad4` | 正文 |
| `--vsc-fg-strong` | `#f2f3f7` | 标题/强调 |
| `--vsc-fg-muted` | `#9298a6` | 次要文字（≈7:1） |
| `--vsc-fg-faint` | `#7b8294` | 提示文字（≥4.5:1，修复项） |
| `--vsc-accent` | `#5e6ad2` | 主色 indigo |
| `--vsc-accent-hover` | `#707cdf` | 主色 hover |
| 状态色 | green `#4ade80` / yellow `#fbbf24` / red `#f87171` / blue `#60a5fa` / purple `#c084fc` | 现代饱和度，深底可读 |
| `--terminal-bg / fg / prompt / cursor` | `#0a0b10` / `#d2d6e0` / `#4ade80` / `#aab0c0` | xterm 运行时读取 |
| `--vsc-secondary-bg` (+hover) | `rgba(255,255,255,0.07)` / `0.12` | 次级按钮 |
| `--vsc-bubble-ai-bg` | `#141624` | AI 气泡 |
| `--vsc-avatar-ai-bg` | `rgba(94,106,210,0.22)` | AI 头像底（叠加渐变） |
| `--vsc-avatar-user-bg` | `rgba(96,165,250,0.16)` | 用户头像底 |
| `--vsc-avatar-neutral-bg` | `rgba(255,255,255,0.08)` | 中性头像底 |
| `--vsc-danger-bg / border` | `rgba(248,113,113,0.14)` / `0.45` | 危险态 |
| `--vsc-error-bg` | `rgba(248,113,113,0.12)` | 错误提示底 |
| `--vsc-scrollbar-thumb` (+hover) | `rgba(255,255,255,0.14)` / `0.24` | 滚动条 |
| `--vsc-modal-overlay` | `rgba(4,5,12,0.6)` | 弹窗遮罩（配 backdrop blur） |
| `--vsc-splitter` (+hover) | `#191b26` / `#5e6ad2` | 分隔条 |

### 2.2 色板（light，降级维护）

只做三类改动，其余保持现状：
- accent 族对齐 indigo：`--vsc-accent: #4c56b8`、`--vsc-accent-hover: #5e6ad2`、`--vsc-list-selected: rgba(94,106,210,0.18)`、`--vsc-splitter-hover: #5e6ad2`。
- 对比度修复：`--vsc-fg-faint: #646b78`（在 `#f3f3f3` 上 ≥4.5:1）。
- AI 相关底色换 indigo 调：`--vsc-avatar-ai-bg: rgba(94,106,210,0.15)`、`--vsc-bubble-ai-bg: #eceef5`。

浅色主题**不做**光晕/渐变特效适配（效果 token 在浅色下取弱化值即可）。

### 2.3 效果与动效 token（CSS-only，不进 ThemePalette）

```css
:root {
  /* 圆角 */
  --radius-sm: 6px;   /* 按钮、输入框、tab */
  --radius-md: 10px;  /* 卡片、气泡 */
  --radius-lg: 14px;  /* 弹窗 */

  /* 动效 */
  --dur-fast: 120ms;  /* hover/按压反馈 */
  --dur-base: 200ms;  /* 常规状态过渡、入场 */
  --dur-slow: 320ms;  /* 弹窗、面板级动效 */
  --ease-out: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
}
[data-theme="dark"] {
  --accent-glow: rgba(94, 106, 210, 0.35);
  --ai-grad-a: #5e6ad2;   /* AI 身份渐变起点（indigo） */
  --ai-grad-b: #22d3ee;   /* AI 身份渐变终点（cyan） */
}
[data-theme="light"] {
  --accent-glow: rgba(94, 106, 210, 0.2);
  --ai-grad-a: #4c56b8;
  --ai-grad-b: #0891b2;
}
```

**约定**：`--vsc-*` / `--terminal-*` 是「色板 token」，与 `themeStore.ThemePalette` 一一对应；`--radius-*` / `--dur-*` / `--ease-*` / `--accent-glow` / `--ai-grad-*` 是「效果 token」，仅 CSS 使用，JS 不镜像。

## 3. 全局基础规范（index.css）

- **focus**：`:focus-visible { outline: 2px solid var(--vsc-accent); outline-offset: 1px; }`；输入控件 focus 追加 `box-shadow: 0 0 0 3px var(--accent-glow)`。
- **reduced-motion**：媒体查询将所有 animation/transition 时长压到 0.01ms。
- **按钮**：`.btn`/`.icon-btn` 统一 `transition: background/color/border-color/box-shadow/transform var(--dur-fast) var(--ease-out)`；`:active { transform: scale(0.97) }`；`.btn` hover 加 `box-shadow: 0 2px 12px var(--accent-glow)`；圆角 `--radius-sm`。
- **滚动条**：thumb 圆角 5px。

## 4. 组件级规范

### 4.1 连接卡片（ConnectionsPanel）
- 列表行改浮起卡片：`margin: 4px 8px`、`radius-md`、`background: rgba(255,255,255,0.03)`、hairline 描边。
- hover：`translateY(-1px)` + 描边亮化 + `box-shadow: 0 4px 16px rgba(0,0,0,0.3)`，`--dur-base` 过渡。
- 操作按钮组 opacity 过渡 `--dur-fast`；已连接状态点保留 glow。

### 4.2 弹窗（sshConnectionModal / BackendSettingsModal 共用样式）
- 遮罩：fadeIn `--dur-fast` + `backdrop-filter: blur(6px)`（毛玻璃）。
- 对话框：`radius-lg`，入场 `scale(0.96) + translateY(8px) → 原位`，`--dur-slow` spring 曲线。

### 4.3 顶栏 / 活动栏 / 终端 tab
- 所有 iconBtn 补过渡；活动栏 hover 加 `rgba(255,255,255,0.06)` 底。
- 终端 tab 关闭按钮 `×` 文本换 `<Icon name="close" />`，补 `aria-label`。
- tab 切换 color/border `--dur-fast` 过渡。

### 4.4 AI 面板身份视觉（核心差异化）
- **AI 头像**：`linear-gradient(135deg, --ai-grad-a → --ai-grad-b 的透明变体)` 底 + indigo 描边；thinking 时呼吸光晕（`breathe` 2s 循环 box-shadow）。
- **消息入场**：每条消息 mount 时 `opacity 0 + translateY(6px) → 原位`，`--dur-base`。
- **流式打字**：chatStore 增加非持久化字段 `freshId`（最新到达的 AI 消息 id）；`MessageBubble` 对 fresh 消息用 typewriter 逐字显示（每 24ms +2 字符），显示中带闪烁块状光标；`prefers-reduced-motion` 时直接整段显示。打字期间 ChatPanel 保持滚动到底。
- **输入框**：`focus-within` 时描边转 indigo + 外发光；发送按钮用 `--ai-grad-a → --ai-grad-b` 渐变底。

### 4.5 空态氛围（EmptyState / App.EmptyCenter）
- 容器 `position: relative; overflow: hidden`，背后放 2 个模糊光斑（indigo / cyan，`blur(60px)`、opacity ≤0.12、20s 级缓慢漂移 keyframes）。
- 图标包进 `radius-md` 发光容器。
- 终端 xterm 视口内**不加**任何此类效果。

## 5. 硬性验收清单

- [ ] `npm run build`（tsc + vite）通过，`npm run test:run` 通过
- [ ] 键盘 Tab 遍历所有控件均有可见 focus ring
- [ ] dark 下 hint/faint 文字对比度 ≥4.5:1（用 `#7b8294`），light 下同（`#646b78`）
- [ ] 系统开启「减弱动态效果」后无持续动画
- [ ] 所有过渡使用 motion token，无裸写 duration
- [ ] `themeStore.PALETTES` 与 `index.css` 色板一致
- [ ] 终端视口内无装饰性特效；xterm 主题色跟随新 token（重开终端生效）
- [ ] 无 emoji/文本字符当图标（`×` 已替换）
