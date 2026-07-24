# 260724-confirm-fly-animation：确认门交互动效（命令飞向终端）

## 原始需求（用户原话）

> 对于写命令的确认门，我希望用户点击确认执行或者拒绝执行时有点互动的动效。例如点击执行命令时，会有一个命令飞向 terminal 面板的动画。
> （对复用现款方案的反馈）复用，但是我希望动效更加流畅物理动效、有冲击力、令人惊艳。

## 背景（决策时事实）

- `CommandBlock.flyToTerminal` 已存在（手动执行按钮：clone chip 直线飞向 `#work-center` + 落点内描边闪光），但确认门「允许/拒绝」按钮无任何动效；还有对称的 `TerminalPanel.flyToChat`。
- 现款为单元素直线一段式 transition，无预备动作、无弧线、无着陆反馈——缺物理感的三要素。
- 确认门放行后命令确实会出现在用户终端执行（后端工具走 terminalSessionId），「飞向终端」隐喻语义成立。
- 既有缺口：`flyToTerminal` 无 reduced-motion 处理；`run` 的危险命令防呆仍是 `window.confirm`（与 F8 换掉的同一问题）。

## 决议

1. **允许执行复用「飞向终端」语言而非新造**——同一个动作（命令进终端）同一个动效；放行后跟随切到终端面板（注意力跟着命令走，动画即视线引导）。
2. **动效升级为三幕物理动效**（重写为共享 `utils/flyToTerminal.ts`，WAAPI 多段 keyframes）：
   - 蓄力弹射（~90ms 后退微缩，anticipation）；
   - 弧线飞行 + 拖尾（双层位移合成抛物线、姿态跟随速度、2 个延迟残影，整体压至 ~550ms——冲击力来自快不是久）；
   - 着陆冲击（chip squash 湮灭 + 冲击波 ripple + 面板震动两下 + 保留内发光）。
   - 收敛上限：不上粒子爆炸/屏幕闪白——高频动效的「惊艳」标准是第 50 次看到仍不烦。
3. **拒绝不飞、原地熄火**——被拒的命令没有去处，飞出去语义错误；confirmBar 收缩折叠（220ms）+ 卡片红色脉冲一次，播完才 `decideConfirm(false)`。
4. **降级策略**——`prefers-reduced-motion` 或无 WAAPI 环境（jsdom）跳过全部飞行，仅保留落点单次发光；动效纯装饰，任何能力缺失不影响业务动作。
5. **顺带清偿两笔债**——reduced-motion 缺口随重写补齐；危险命令 `window.confirm` 换应用内 `ConfirmDialog`（「仍要执行/取消」）。

## 影响范围

- 新增 `ssh-client/src/utils/flyToTerminal.ts`（共享动效）；
- `CommandBlock.tsx`（删内联动效函数、确认门接线、危险确认弹窗）+ `CommandBlock.module.css`（拒绝熄火动画）；
- `TerminalPanel.flyToChat` 未动（方向不同、频次低，留待观感对齐需求出现再说）。
