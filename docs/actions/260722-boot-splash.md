# 260722-boot-splash：启动遮罩统一就绪门 + server 启动提速

> 背景：docs/situations/260722-boot-splash-and-startup-speed.md
> 状态栏可能滞后于 git；据本文件行动前先对账校准，再动手

## 阶段 1：启动门状态机 + 遮罩骨架
**目标**：bootPhase 一次性启动门生效，散落就绪检查移除，失败态可自救（重试/改地址）
**设计**：
- `backendStore` 增 `bootPhase: "booting" | "failed" | "done"` 与 `boot()`：内部走 waitForReady，成功置 done（终态不回退），失败置 failed；done 后 setBaseUrl/waitForReady 不影响 bootPhase
- `App.tsx`：bootPhase !== "done" 渲染全屏 `BootSplash`，done 才挂主界面；数据联动（fetchList/loadAgents）保留在 boot 成功路径
- `BootSplash` 骨架：等待态（占位文案+进度区）/ 失败态（readyMessage + 重试按钮 + 「修改后端地址」复用 BackendSettingsModal）
- 删 `ConnectionsPanel`/`ChatPanel` 的 readyStatus checking/fail 分支及 `reloadAfterReady`/`retryReady`
**验收标准**：启动全程遮罩→就绪进主界面；kill 后端启动→失败页可改地址可重试；运行中改 baseUrl 不再全屏
**测试用例**：backendStore.test.ts——boot 成功流转 done；失败流转 failed；failed 重试成功流转 done；done 后 setBaseUrl 不回退 bootPhase
**状态**：已完成

## 阶段 2：吉祥物动效与预估进度
**目标**：俏皮完整的等待/失败视觉——吉祥物 + 打字机日志 + 历史时长预估进度条
**设计**：
- 吉祥物 SVG：圆角方块+大眼睛，漂浮/眨眼/光晕呼吸 CSS keyframes；失败态眼睛变 ✕、停漂浮
- 打字机伪启动日志：俏皮文案池随机抽取逐条输出，失败时日志区切错误信息+操作
- 进度：`bootProgress.ts` 纯函数（ease-out 至 90% 悬停 + 冲刺收尾）+ localStorage 历史启动耗时（首次 8s 兜底）；>15s 追加安抚文案
- `prefers-reduced-motion`：停漂浮/眨眼/打字机逐字，保留进度与状态文案
- 全部用现有主题 token（--vsc-accent/--vsc-green/--vsc-red 系）
**验收标准**：动效流畅无布局抖动；进度条不倒退、就绪冲刺 100% 后过渡进主界面；reduced-motion 下静态可用
**测试用例**：bootProgress 纯函数——单调不减、90% 封顶、历史时长读写、异常值兜底
**状态**：已完成（视觉走查：等待态动效/60s 超时失败态/Modal 复用/重试进主界面 全通过）

## 阶段 3：Rust 失败快报与日志路径
**目标**：sidecar 必死故障（jar/JRE 缺失、spawn 失败）前端秒知，失败页展示日志路径
**设计**：
- `lib.rs`：start_backend 失败时 `app.emit("backend-launch-failed", msg)`；前端 BootSplash 监听（@tauri-apps/api event），收到即 bootPhase=failed 并中止 waitForReady 轮询
- 日志路径：Rust 暴露 `backend_log_dir` command（app_data_dir），失败页显示 backend.err.log 路径；纯浏览器 dev 无 Tauri 时隐藏该行
- setup 早于 webview 就绪的时序兜底：spawn 失败结果暂存 state，前端首次挂载时主动查询一次（invoke）补偿错过的事件
**验收标准**：改名 jar 模拟缺失→遮罩秒转失败态并显示日志路径；恢复后重试可进（需重启应用拉起 sidecar 的场景给明确文案）
**测试用例**：人工验证（Rust 无测试基建）：jar 缺失/正常两分支；浏览器 dev 下无 Tauri API 不报错
**状态**：未开始

## 阶段 4：server 启动提速（CDS + 堆参数）
**目标**：打包版 sidecar 冷启动时间下降 ≥25%
**设计**：
- `build-personal.sh`：package 后 `java -Djarmode=tools -jar app.jar extract` 出 CDS 布局；训练 run（`-XX:ArchiveClassesAtExit` + `spring.context.exit=onRefresh`，指向临时 H2 目录避免污染）生成 `app.jsa`；extracted 目录整体替代单 jar 进 Tauri resources
- `lib.rs`：`current_dir(backend_dir)` + 相对路径 `-jar ssh-server-app.jar` + `-XX:SharedArchiveFile=app.jsa` + `-Xms128m -Xmx512m`
- 归档失配静默回退（-Xshare:auto 默认），最坏仅不提速
- workflow 无改动（build-personal.sh 内自包含）；本地与 CI 均出归档
**验收标准**：本地打包实测启动时间对比（改造前后各 3 次取中位）下降 ≥25%；`-Xlog:class+load` 抽查确认命中 shared archive；workflow 构建通过
**测试用例**：训练 run 产物存在性校验入脚本（缺 .jsa 即 fail）；启动日志含 CDS 生效证据；ping 就绪时间对比记录入本文件
**状态**：未开始

## 阶段 5：收尾验证与归档
**目标**：全量测试绿、真机走查关键路径、文档归档
**设计**：
- `npm run test:run` + `npm run build` 全绿；后端不受影响（无 server 代码改动，跑受影响面确认）
- 真机走查：正常启动、慢启动（限流模拟）、spawn 失败、地址配错自救四条路径
- backlog 落两条（崩溃检测重拉 / native-image）；本文件移入 done/
**验收标准**：四条路径全通过；测试全绿；文档归档完成
**测试用例**：见各路径；回归 C2 走查清单「sidecar 拉起失败有人话提示」项
**状态**：未开始
