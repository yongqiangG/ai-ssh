# workload MCP — 工时统计（OA 打卡 × 项目系统工时交叉核对）

口径与决议见 vault `工作/ai-ssh/需求/需求-工时统计MCP.md`。

## 用法

```bash
# 配置（~/.workload/config.json，或环境变量 WORKLOAD_MCP_CONFIG 指定路径）
{
  "oa_token": "<OA 地址栏复制的 X-EOA-TOKEN>",
  "refresh_token": "<浏览器 localStorage 的 REFRESH_TOKEN>",
  "creator_id": "167"
}

# CLI 直接出报告
python workload_mcp.py report --start 2026-08-01 --end 2026-09-11

# stdio MCP server
python workload_mcp.py serve
```

零第三方依赖（urllib + 内置 json/ssl）。refreshToken 自动滚动写回配置文件。

## Claude Code 注册（.mcp.json 示例）

```json
{
  "mcpServers": {
    "workload": {
      "command": "python",
      "args": ["D:/project/ai-ssh/mcp/workload/workload_mcp.py", "serve"]
    }
  }
}
```
