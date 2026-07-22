# sidecar 运行期崩溃检测与自动重拉

来源：260722 启动遮罩 grill（Q2 边界裁定出本期）。

## 问题

启动遮罩只守启动窗口。应用运行中 sidecar JVM 死亡（OOM、任务管理器误杀、端口被抢）后，用户只能看到各请求零散报错，无全局告知、无恢复手段（只能重启应用）。启动门方案落地时已删除各面板的 fail EmptyState（它们在运行期本来也触发不了）。

## 草图

- Rust 侧：spawn 后持有 Child，后台线程 `wait()` 监听退出 → `app.emit("backend-exited", code)`
- 前端：全局横幅「后端服务已断开」+ 重拉按钮；重拉 = Rust command 重新 start_backend + 前端重走 waitForReady（不是全屏遮罩，主界面状态保留）
- 连带问题要一起定：重启幂等（旧进程端口残留，参考 Windows 孤儿 JVM 坑按 8091 补杀）、终端/聊天会话失效的提示与恢复、自动重拉是否要退避上限
