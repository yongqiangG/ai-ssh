# 手机建任务的桌面实时流

> 来源：260821 手机伴侣阶段 2 遗留（docs/actions/260821 验证栏）。

手机经 `POST /api/projects/:id/tasks`（阶段 3）创建的任务，桌面端打开其终端无实时输出流——桌面 TaskView 的输出绑定在 `coding_run_task` 调用时前端传入的 `ipc::Channel` 上，web 侧建任务没有该通道（输出仅进旁路缓冲，session 回放可见）。修法方向：桌面 TaskView 对无 channel 绑定的 running 任务改走事件订阅（桌面 shell 已是此模式），或 run_task 的 channel 参数改可选。属桌面前端改动，超出 260821 红线白名单，故延后。
