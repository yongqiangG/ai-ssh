# 260722-boot-splash-and-startup-speed：启动遮罩统一就绪门 + server 启动提速

## 原始需求

当前 client 端在启动的时候，会等待 server 的就绪状态，再来联动查询服务器列表和渲染 chat 面板。现在考虑用户的体验：1. 增加启动遮罩，直接在遮罩等待 server 的就绪。可以通过动画、进度条、小动物之类的动效来进行过渡。如果 server 启动失败，就不进入页面，直接报错。本身当前 ssh 工具就强依赖 server 服务。2. 移除掉原来散落在各个组件的就绪检查，统一前置到遮罩检查。另外希望动效可以俏皮一点，这是一款 ai 现代化的 ssh 运维工具。另外当前的 server 端在单体构建时是以 sidecar 集成，检查下构建的 workflow，是否有哪些技巧可以加快 server 的 java 项目启动速度。

## 背景

2026-07-22 grill 产物。决策时事实：`App.tsx` 已有统一 `waitForReady()`（600ms 轮询 `/api/ping`，60s 超时）+ 成功后联动 `fetchList`/`loadAgents`，「统一等待」已存在，散落的是**就绪状态的展示**（ConnectionsPanel / ChatPanel 各自的 checking/fail EmptyState 与重试逻辑）。已知缺陷：`lib.rs` sidecar spawn 失败仅 `eprintln!`，前端无感知，必死故障也要傻等满 60s 超时。构建现状：fat jar + jlink 裁剪 JRE（`build-personal.sh`），无 CDS/AOT/JVM 启动参数调优；GitHub workflow 构建已验证通过。后端地址设置入口（`BackendSettingsModal`）在主界面内。

## 决议

### Q1：遮罩失败态什么形态？「不进入页面直接报错」做成死门吗？
**结论**：可恢复错误页——错误信息 + 重试 + 「修改后端地址」入口（复用 BackendSettingsModal）+ 日志文件路径提示，不退出应用、不放行进主界面。字面死门会死锁：地址配错 → ping 永远不通 → 用户永远够不着页面内的地址设置入口。

### Q2：运行期 sidecar 崩溃的处理边界？
**结论**：本次只守启动（遮罩 + spawn 失败快报），运行期后端死亡靠各请求自身错误提示兜底；「运行期崩溃检测 + 自动重拉」入 backlog——现状那两个 fail EmptyState 在运行期本来也触发不了（无机制把 readyStatus 翻回 fail），留着是死代码。

### Q3：遮罩的出现时机（生命周期）？
**结论**：一次性启动门——新增 `bootPhase`（booting/failed/done）与 `readyStatus` 解耦：首次就绪成功前遮罩体系负责一切（含失败页改地址→重试循环）；done 后永不回退，运行中改后端地址只走设置 Modal 内测试 + 静默刷新数据，不再全屏——普通设置变更不该被渲染成重启。

### Q4：启动提速做到哪一档？
**结论**：CDS 全套（fat jar `extract` 布局 + CI 训练 run `spring.context.exit=onRefresh` 生成 `.jsa` 随包分发 + `lib.rs` 固定 `current_dir` 相对路径启动）+ 堆参数收敛（`-Xms128m -Xmx512m`），预期砍 30-40% 启动时间；归档失配时 JVM 静默回退不会崩。明确不做：`TieredStopAtLevel=1`（保终端大流量峰值吞吐）、lazy-init（会让 ping 提前变绿而业务 bean 未热，破坏「进页面即全可用」的遮罩承诺）；native-image 入 backlog。

### Q5：动效概念与技术载体？
**结论**：吉祥物 + 俏皮日志——几何小生物（SVG：漂浮/眨眼/光晕呼吸，失败态眼睛变 ✕ 停止漂浮）+ 打字机伪启动日志（俏皮文案池随机）+ 历史时长预估进度条（localStorage 记上次耗时，ease-out 至 ~90% 悬停，ping 通冲刺 100%，首次按 8s 兜底；超 ~15s 追加安抚文案，60s 判 fail）。载体纯 CSS/SVG 零依赖、全部吃现有主题 token——Lottie 需维护 json 资产且吃不到 token，否决；纯不确定动画在低配机 30-60s 场景会让人怀疑卡死，否决。遵守 `prefers-reduced-motion`。

## 影响范围

- ssh-client：`backendStore`（bootPhase 状态机）、`App.tsx`（启动门禁）、新增 `BootSplash` 组件、`ConnectionsPanel`/`ChatPanel`（删散落就绪分支）
- ssh-client/src-tauri：`lib.rs`（spawn 失败 emit 事件、CDS 启动命令、堆参数）
- 构建：`scripts/build-personal.sh`（extract + 训练 run）；workflow 无实质改动
- C2 走查清单「sidecar 拉起失败需有人话提示」由本工作覆盖
- backlog 新增：运行期崩溃检测与自动重拉、GraalVM native-image
- 执行计划：docs/actions/260722-boot-splash.md
