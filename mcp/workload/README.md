# 工时统计 MCP

读取 OA 打卡和项目系统工时，检查本人哪些出勤工作日未填满 7 小时。保留无打卡工作日核对清单，周末打卡单列。

统计与查询为只读。另提供受控写入能力：向进行中的任务逐条提交工时（单条提交、预检剩余容量、失败即停），用于补录历史工时。

两系统用账号密码自动登录，验证码在本机识别。账号配置一次后，无需手工复制 token。

## Windows 安装与配置

需要可访问公司内网的 Windows 10/11、64 位 Python 3.10 以上版本。已在 Python 3.13 上验证。以下命令在仓库根目录的 PowerShell 运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mcp\workload\install.ps1
& '.\mcp\workload\.venv\Scripts\python.exe' -X utf8 .\mcp\workload\workload_mcp.py setup
```

`setup` 依次提示项目系统账号、密码和 OA 账号、密码，密码隐藏输入。运行 `setup` 可更换密码或账号，并清除旧的登录缓存。首次安装下载本地 OCR 依赖，运行时不使用云端识别服务。

凭据默认保存到 `%USERPROFILE%\.workload\credentials.dat`。整个文件由 Windows DPAPI 绑定当前用户加密，临时写入文件同样是密文。换 Windows 账号或电脑时重新运行 `setup`。

所有模式均支持 `--config <路径>`；也可设置环境变量 `WORKLOAD_MCP_CONFIG`，优先级为命令行、环境变量、默认路径。同一凭据文件上的统计和配置操作使用文件锁协调。

需要由其他程序初始化时，可使用 `setup --stdin`，从标准输入读取**一行 JSON**，字段为 `project_username`、`project_password`、`oa_username`、`oa_password`。不要将实际密码写入脚本、命令行参数或仓库；此入口不导入 token。

旧版本的 `%USERPROFILE%\.workload\config.json` 不会被导入或覆盖。升级后运行一次 `setup`；若以前设置过 `WORKLOAD_MCP_CONFIG`，请将其改为新的加密文件路径。

## 生成报告

```powershell
& '.\mcp\workload\.venv\Scripts\python.exe' -X utf8 .\mcp\workload\workload_mcp.py report --start 2026-08-01 --end 2026-09-11 --full-detail
```

结束日期最晚取昨天；当天尚未结束，不判定缺工时。汇总和加班明细均按登录身份及日期区间过滤。任一系统读取失败会结束统计，标准输出只在成功时给出完整 JSON 报告，错误写入标准错误。

登录会优先复用缓存。项目系统 access token 到期后自动刷新，刷新授权失效后重新登录；OA 返回登录失效时重新登录。OA 明确要求强制登录时自动提交 `force=Y`，这可能结束已有的 OA 会话。

验证码最多自动尝试 3 次，仍未通过就打开本机浏览器验证页：

- OA：输入图片中的 4 位字母或数字。
- 项目系统：拖动滑块到拼图缺口，也可用方向键微调，再点击“验证并继续”。
- 完成后自动继续原报告；可刷新图片，但不会延长总计 300 秒的等待时间。
- “取消统计”或超时会结束本次统计；仅关闭浏览器页面会继续等待，直到验证超时。

浏览器未自动打开时，CLI 标准错误或 MCP 任务结果会提供一次性本机链接。验证服务只监听 `127.0.0.1`，完成后关闭；页面不接收账号密码或系统 token。

## MCP 使用

注册示例（路径替换为自己的仓库位置）：

```json
{
  "mcpServers": {
    "workload": {
      "command": "D:\\project\\ai-ssh\\mcp\\workload\\.venv\\Scripts\\python.exe",
      "args": [
        "-X",
        "utf8",
        "D:\\project\\ai-ssh\\mcp\\workload\\workload_mcp.py",
        "serve"
      ]
    }
  }
}
```

MCP 应运行在用户本机，以便打开验证码页面并使用当前 Windows 用户的加密凭据。

| 工具                  | 参数                                            | 用途                                |
| --------------------- | ----------------------------------------------- | ----------------------------------- |
| `check_workload`      | `start_date`、`end_date`，可选 `full_detail`    | 启动后台统计，返回 `task_id` 和状态 |
| `get_workload_result` | `task_id`，可选 `wait_seconds`（0–20，默认 20） | 查询状态，完成时返回 `report`       |
| `cancel_workload`     | `task_id`                                       | 请求取消统计                        |
| `list_work_tasks`     | 可选 `number`                                    | 查询任务及预估/已报/剩余工时；不传列进行中任务，传 `number` 不限状态回查单个任务（含 COMPLETED，用于提交后验证） |
| `submit_workload`     | `number`、`date`、`duration`、`description`     | 为任务提交一条工时（写入，单条）    |

`submit_workload` 是写入操作，防呆约束：`number` 须严格唯一命中进行中任务；`date` 最晚昨天；`duration` 为正数且 0.1 的整数倍；`description` 必须填任务标题原文（`list_work_tasks` 返回的 `title`），与真实标题不符即拒——该参数用于调用方向用户展示「提交到哪个任务」，写入系统的描述由服务端用真实标题构造、不受入参影响；提交前自动校验不超出任务剩余容量（预估−已报），超出即拒绝——唯一例外：`duration=0.1` 视为补报口令，满额任务也放行（剩余钳位为 0），用于触发系统将已报超预估的任务自动流转为 `COMPLETED`；`type` 固定 `DEVELOP`、`overtime` 固定 `false`。任何失败立即中断，不重试。建议客户端在调用前向用户复述确认（编号、标题、日期、时长），确认后再提交。

客户端调用 `check_workload` 后，若状态为 `running`、`awaiting_verification` 或 `cancelling`，应继续查询同一 `task_id`，直至 `completed`、`failed` 或 `cancelled`。仅 `completed` 含完整报告。人工验证不会阻塞一个 MCP 请求五分钟，验证完成后原后台任务自动继续。

同一服务一次运行一个统计任务；相同的进行中请求复用任务，不同日期的并发请求会提示先完成或取消。最多保留最近 8 个任务，服务退出后清除；stdio 断开会取消未完成任务。取消可立即标记，但正在进行的网络请求最多需等其 20 秒超时后退出。

## 开发验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mcp\workload\install.ps1 -Development
& '.\mcp\workload\.venv\Scripts\python.exe' -X utf8 -m unittest discover -s mcp\workload -p 'test_*.py'
& '.\mcp\workload\.venv\Scripts\python.exe' -m ruff check mcp\workload
& '.\mcp\workload\.venv\Scripts\python.exe' -m ruff format --check mcp\workload
```

离线测试使用虚构凭据、模拟系统响应和本机临时 HTTP 服务；不会登录实际账号。`browser_check.py` 单独使用本机已安装的 Edge 做浏览器验证，不属于默认单元测试。虚拟环境、缓存和验证产物均不入库。

需求、口径与实施验证统一维护在 Obsidian：`工作\ai-ssh\需求\需求-工时统计MCP.md`。
