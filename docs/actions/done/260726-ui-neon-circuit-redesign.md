> 背景：docs/situations/260726-ui-neon-circuit-redesign.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

# ssh-client UI/UX 重设计执行计划：「电路霓虹 · 能量流」

## 方向契约（direction contract）

- **THESIS**：运维工作台即电路——系统状态、AI 结论、命令执行全部以「能量在电路中流动」呈现；拒绝的默认 = 又一个 VSCode 皮肤。
- **OWN-WORLD**：void 深空底（#07080f/#0b0d17/#10131f）+ 能量三色渐变 plasma #ff2d95 → circuit #7c5cff → volt #00e5ff；状态色 surge #ffb020 / overload #ff4d6d / live #3dffa8。Chakra Petch 标签面 + JetBrains Mono 等宽 + 系统 CJK 正文。面板 = 暗色电路板（微网格纹理 + 发光描边），小锐圆角。
- **STORY**：用户看一眼便知道哪里通电（活跃）、哪里在流动（执行/传输/思考）、哪里高压（危险）。
- **签名交互**：「电流传导」——确认执行的命令化作电流脉冲奔向终端，落点浪涌；SFTP 传输与流式输出复用同一隐喻。
- **FORM**：Operate 模式工具界面，用户钦定方向（免抽签）；表达永不遮蔽任务与状态。

## 阶段 1：世界基建（令牌、字体、motion 底座）

**目标**：全应用换血为新色板与新字体，动效底座就位，旧组件在新令牌下仍协调可用。
**设计**：
- `npm i motion @fontsource/chakra-petch @fontsource/jetbrains-mono`（离线打包，main.tsx 引入字体 css）
- `index.css`：`--vsc-*` 保名换值；新增 `--energy-*` 效果令牌、能量流 keyframes、电路纹理 utility；头部写入方向契约注释
- `themeStore.ts`：ThemeMode 收窄 dark-only，删 light palette 与 toggle，ThemePalette 字段名不动值换新（xterm 契约不破）
- 全局原语：`.btn` 能量渐变、`.input` focus 通电、panel-header、滚动条
- `Header.tsx` 移除主题切换按钮
**验收标准**：`npm run build` + `npm run test:run` 全绿；dev 起后全应用新配色协调、无残留 indigo/浅色路径。
**测试用例**：现有测试全量通过；themeStore 相关引用无 light 残留（grep 校验）。
**验证**：`npm run build` + `npm run test:run` 全绿（10 文件 111 测试）；grep 确认 toggle/light 引用清零（ActivityBar 主题按钮已摘除）；字体经 @fontsource 本地打包进 dist。遗留：Icon.tsx 的 sun/moon 图标定义未删（无引用、无害），随后续阶段顺手清理。
**状态**：已完成

## 阶段 2：外壳与启动仪式

**目标**：Header/ActivityBar/Splitter/ConnectionsPanel/BootSplash+Mascot 完成能量语言重塑。
**设计**：
- Header 指挥条：连接状态 = 电路通断；Chakra Petch 标签化
- ActivityBar 能量轨道：motion layoutId 滑动指示器
- Splitter 通电导线：hover/拖拽能量流点亮
- ConnectionsPanel 电路节点卡：在线通电呼吸 / 连接中电流爬行描边；motion 弹簧入场与重排
- BootSplash 开机通电仪式：进度 = 主电路充能；Mascot 霓虹轮廓光；失败 = 红色断路
**验收标准**：build+test 全绿；外壳所有可视状态在新语言下语义清晰。
**测试用例**：connectionStore/backendStore 测试通过；bootProgress.test 通过。
**验证**：build + test:run 全绿（111 测试）。ActivityBar 指示器改 motion layoutId 弹簧滑动；ConnectionsPanel 卡片 motion 弹簧入场/重排（AnimatePresence popLayout），激活卡能量流描边（弃用旧 3px 左光条，符合 craft-floor），连接中新增电流爬行描边（@property --crawl-angle + conic mask）；Splitter hover 通电；BootSplash 电路网格底 + 能量流充能条；Mascot 换 circuit 紫渐变 + volt 内描边。
**状态**：已完成

## 阶段 3：终端舞台与监控仪表

**目标**：终端区与监控条完成重塑，签名动效「电流传导」上线。
**设计**：
- TerminalPanel：tab 通电下划线滑动；选区/报错气泡换能量语言
- terminalManager：xterm 主题换新 palette，光标发光
- ServerMonitorBar：CPU/内存电流仪表化（能量渐变，遵循 dataviz 规范）
- flyToTerminal 升级：电流脉冲 + 落点浪涌，降级路径保留
**验收标准**：build+test 全绿；终端可读性不降（xterm 视口内无叠加特效）。
**测试用例**：errorDetect 测试通过；手动验证选区气泡、报错气泡、飞行动效。
**验证**：build + test:run 全绿（111 测试）。tab 活跃态改 ::after 能量渐变下划线+发光；xterm 换 JetBrains Mono 并补 cursor/selection 色（terminal-fg 修正为读 --terminal-fg，旧代码误读 --vsc-fg）；监控条按 dataviz 规范做 stat tile + 3px 电量刻度（负载无百分比标度不画仪表，状态色只随阈值）；flyToTerminal 升级：能量渐变脉冲 chip + volt/plasma 双层浪涌，降级路径不变。飞行动效与气泡的真机观感留待阶段 5 tauri dev 目检。
**状态**：已完成

## 阶段 4：AI 对话舱

**目标**：ChatPanel 全链路（气泡/思考/确认卡/输入条）完成能量信道化。
**设计**：
- MessageBubble：AI = 能量信道注入，用户 = plasma 身份色；流式 caret = 电流光点；motion 弹簧入场
- 思考块：思考中电流巡行细纹
- CommandBlock：普通写操作 = 合闸确认；高危 = 高压红色警示（红线语义不变，视觉强化）
- ChatInputBar：focus 通电、发送充能反馈
**验收标准**：build+test 全绿；确认按钮文案与 DOM 语义不变（CommandBlock/ChatPanel 测试兼容）。
**测试用例**：chatStore、CommandBlock、ChatPanel 测试全量通过。
**验证**：build + test:run 全绿（111 测试）。AI 头像/打字指示换 circuit→volt 能量渐变，打字三点改 plasma/circuit/volt 依序点亮；用户消息改 plasma 身份（深底品红描边，弃纯色 accent 底保正文对比）；流式 caret 加 volt 发光；思考块弃 3px 左边条改 1px 全描边 + 思考中 circuit 呼吸（craft-floor 合规）；CommandBlock 徽标/按钮全面 token 化，新增高危确认「高压警示」态（dangerBlock：红描边嗡鸣脉动 + 红色合闸钮，按钮文案与确认流程语义不变）。注意：PowerShell 默认编码曾损坏 MessageBubble.module.css 中文注释，已全量重写修复——后续文件文本处理一律用 Read/Write 工具。
**状态**：已完成

## 阶段 5：SFTP、模态与收尾打磨

**目标**：剩余 surface 归一，全局有界打磨，完工归档。
**设计**：
- SftpPanel/DirListView/TransferTrack：传输 = 能量在两面板间流动
- 全部模态 motion 弹簧入场 + 通电边框；EmptyState 重塑
- impeccable 有界验证：detect.mjs 一次 + finish 审查（降级 in-thread）+ 一轮修复
- reduced-motion 走查、对比度抽查、动画合成器属性核查
- DESIGN.md 从建成世界记录（documenter 降级流程）；action 归档 done/；CLAUDE.md 简史加一行
**验收标准**：build+test 全绿；`npm run tauri dev` 桌面壳目检通过。
**测试用例**：全量 test:run + sanitize/llm* 工具测试通过。
**验证**：build + test:run 全绿（10 文件 111 测试）。SFTP：TransferTrack running 态改 energy-flow-loop 签名流动、进度条 width→scaleX（消布局抖动）、SftpPanel 清死代码（.tx* 块）并修 --vsc-bg 悬空变量；模态：共享 dialog 换能量渐变描边 + 弹簧入场，HostKeyConfirmModal 全令牌化（指纹变更 = 高压警示）。impeccable detect.mjs 收敛至 2 条已论证保留（启动页电路网格 = 承诺世界材质；blockquote 左线 = 排版惯例）；finish 审查以 general-purpose 子代理替代官方 reviewer（本会话无浏览器截图能力，纯代码级审查，已声明替代）——揪出致命 bug：CSS Modules 哈希化 animation 名导致引用全局 keyframes 的 4 处能量流动画在产物中静死，已把 keyframes 下沉到消费模块并经 dist 产物 grep 实证哈希名配对；另修 cardActive 被 hover 覆盖、危险按钮 #fff/#ff4d6d 对比 3.2:1 不达标（改深色 ink 6.1:1）。DESIGN.md + .impeccable/design.json 从建成世界记录（降级 documenter 流程，北极星「通电的电路板」按自动模式推定）。遗留：真机 `npm run tauri dev` 目检与 dataviz 校验器跑色板未执行（无浏览器/交互环境），交用户首启目检。
**状态**：已完成
