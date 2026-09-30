# markitdown 文档转 MD MCP

本地文档转 Markdown 的开发侧 MCP 工具，薄壳封装 [microsoft/markitdown](https://github.com/microsoft/markitdown)（MIT）核心库。供 Claude Code 等 agent 读取 PDF/Word/PPT/Excel 等文档内容。

与官方 markitdown-mcp 的差异：只收本地路径（不放开 http/data URI）；依赖只装办公四件套 extras（不强制 `[all]` 全家桶）；后缀白名单拒绝非文档文件（`.dat`/`.pem` 等凭据类进不来）。决议见 vault 工作/ai-ssh/需求/需求-markitdown文档转MD.md。

## 支持格式

`.pdf .docx .pptx .xlsx .html .htm .csv .epub .zip .txt .md .json .ipynb`

## Windows 安装

需要 64 位 Python 3.10+（已在 3.13 验证）。仓库根目录 PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mcp\markitdown\install.ps1
```

## 工具说明

单工具 `convert_to_markdown(file_path, save_path="", image_mode="external")`，三模式：

- **默认，save_path 为空（读文档问答）**：返回 Markdown 全文，文档内图片以 `![...](data:image/png;base64...)` 占位符表示——轻，适合让 agent 阅读内容。
- **save_path 非空 + image_mode="external"（默认，大文档落盘）**：图片解码为独立文件写入 `<md同名>.assets/`（sha1 前 12 位命名，同图去重，重跑幂等，EMF/WMF 原样不转格式），md 里是相对链接。md 本体小（实测 36 图文档 4.9MB → 24KB），VS Code/Obsidian 直接看图。
- **save_path 非空 + image_mode="inline"**：base64 整段内嵌进 md 单文件——需要单文件分发时用。

落盘模式均返回「路径 + 总行数 + 前 20 行预览（每行截 200 字符）」摘要，不撑爆上下文。

错误（白名单外后缀、路径穿越、文件不存在、转换失败）以文本形式返回，不抛异常。

## MCP 注册示例

路径替换为自己的仓库位置，加入 `claude mcp add --scope user` 或客户端对应配置：

```json
{
  "mcpServers": {
    "markitdown": {
      "command": "D:\\project\\ai-ssh\\mcp\\markitdown\\.venv\\Scripts\\python.exe",
      "args": [
        "-X",
        "utf8",
        "D:\\project\\ai-ssh\\mcp\\markitdown\\markitdown_mcp.py"
      ]
    }
  }
}
```

## 测试

```powershell
& '.\mcp\markitdown\.venv\Scripts\python.exe' -X utf8 -m pytest .\mcp\markitdown\test_markitdown_mcp.py
```

测试向量程序化生成（zipfile 手造含图 docx、纯文本 html），不打网络。

## 升级

依赖精确 pin（markitdown 0.1.8 / mcp 2.2.0，Beta 期库，防 extras 结构变化破坏），升级 = 改 `requirements.txt` 版本号后重跑 install.ps1。注意 mcp SDK 2.x 已将 FastMCP 改名 MCPServer，本壳用的是 `mcp.server.mcpserver.MCPServer`。
