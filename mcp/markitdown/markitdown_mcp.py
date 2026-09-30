#!/usr/bin/env python3
"""markitdown 薄壳 MCP —— 本地文档转 Markdown（开发侧工具）。

复刻 mcp/workload 惯例，协议层用官方 mcp SDK 2.x（MCPServer，FastMCP 已改名），单工具无后台任务。
决议见 vault 工作/ai-ssh/需求/需求-markitdown文档转MD.md：
- 只收本地路径（不放开 http/data URI，攻击面比官方 markitdown-mcp 小）。
- 后缀白名单只放行文档格式，凭据类文件（.dat/.pem/.toml）天然进不来。
- 双模式：默认图片占位 + 全文返回（读文档问答）；save_path 非空时落盘返回摘要
  （重文档场景）。落盘图片两形态：external（默认）解码写 <md同名>.assets/ 并在
  md 里留相对链接（sha1 前 12 位命名，按 URI 去重，幂等重跑，EMF/WMF 原样不转
  格式）；inline 保留 base64 内嵌。

CLI：
    python markitdown_mcp.py           # stdio MCP server
"""

from __future__ import annotations

import base64
import hashlib
import re
import sys
from pathlib import Path

from mcp.server.mcpserver import MCPServer

# 后缀白名单 = markitdown 已装 extras 的能力面（决议 3/6）。
# .doc/.xls/.ppt 老格式与 .msg/.mp3 不在 [pdf,docx,pptx,xlsx] extras 内，不放行。
ALLOWED_SUFFIXES = {
    ".pdf",
    ".docx",
    ".pptx",
    ".xlsx",
    ".html",
    ".htm",
    ".csv",
    ".epub",
    ".zip",
    ".txt",
    ".md",
    ".json",
    ".ipynb",
}

mcp = MCPServer("markitdown")

_converter = None


def _get_converter():
    """进程内单例：magika 模型只加载一次（决议：模块级懒加载）。"""
    global _converter
    if _converter is None:
        from markitdown import MarkItDown

        _converter = MarkItDown()
    return _converter


def _resolve_and_check(file_path: str) -> Path:
    """白名单 + 穿越防御。返回解析后的路径，非法时抛 ValueError。"""
    if not file_path or not file_path.strip():
        raise ValueError("file_path 不能为空")
    path = Path(file_path.strip()).expanduser()
    if ".." in path.parts:
        raise ValueError(f"不允许路径穿越：{file_path}")
    resolved = path.resolve()
    if resolved.suffix.lower() not in ALLOWED_SUFFIXES:
        raise ValueError(
            f"不支持的文件类型「{resolved.suffix or '(无后缀)'}」，"
            f"允许：{', '.join(sorted(ALLOWED_SUFFIXES))}"
        )
    if not resolved.is_file():
        raise ValueError(f"文件不存在：{resolved}")
    return resolved


# data URI 抓取：宽松匹配（不限定 image/*，pptx/epub 冒出的音频片段同规则落盘）。
_DATA_URI_RE = re.compile(r"data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)")

# MIME → 扩展名。刻意穷举而非 mimetypes.guess_extension：
# 后者对 x-emf 返回 None，且映射随 Python 版本漂移。
_MIME_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/x-emf": ".emf",
    "image/x-wmf": ".wmf",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
}

_PREVIEW_LINE_LIMIT = 200


def _externalize_images(markdown: str, assets_dir: Path) -> tuple[str, int]:
    """把 md 里的 data URI 解码落盘到 assets_dir，正文替换为相对链接。

    同一 URI（= 同字节）只落一份；文件名 sha1 前 12 位，重跑幂等（决议 2/3/4）。
    返回（替换后 md, 落盘文件数）。
    """
    assets_dir.mkdir(parents=True, exist_ok=True)
    seen: dict[str, str] = {}  # 完整 URI → 相对链接
    count = 0

    def _replace(match: re.Match) -> str:
        nonlocal count
        uri = match.group(0)
        if uri in seen:
            return seen[uri]
        mime, b64 = match.group(1), match.group(2)
        raw = base64.b64decode(b64)
        name = hashlib.sha1(raw).hexdigest()[:12] + _MIME_EXT.get(mime, ".bin")
        target_file = assets_dir / name
        if not target_file.is_file() or target_file.read_bytes() != raw:
            target_file.write_bytes(raw)
        seen[uri] = rel = f"{assets_dir.name}/{name}"
        count += 1
        return rel

    return _DATA_URI_RE.sub(_replace, markdown), count


def _clip_line(line: str, limit: int = _PREVIEW_LINE_LIMIT) -> str:
    """预览行截断：base64/超长表格行不得整行进摘要（决议 7）。"""
    return line if len(line) <= limit else line[:limit] + "…(截断)"


@mcp.tool()
def convert_to_markdown(
    file_path: str, save_path: str = "", image_mode: str = "external"
) -> str:
    """将本地文档转换为 Markdown。支持 pdf/docx/pptx/xlsx/html/csv/epub/zip/txt/md/json/ipynb。

    Args:
        file_path: 本地文档绝对或相对路径（仅限白名单后缀，不允许路径穿越）。
        save_path: 可选。为空时直接返回 Markdown 全文（文档内图片以占位符表示，
            适合阅读问答）；非空时将 Markdown 写入该路径并返回摘要（适合大文档，
            避免撑爆上下文）。
        image_mode: 落盘时的图片形态。external（默认）解码写 <md同名>.assets/
            目录并在 md 里留相对链接；inline 保留 base64 内嵌。save_path 为空时
            本参数无效。

    Returns:
        save_path 为空：Markdown 全文；非空：落盘路径 + 预览 + 行数统计。
    """
    from markitdown import FileConversionException, UnsupportedFormatException

    image_mode = (image_mode or "external").strip().lower()
    if image_mode not in ("external", "inline"):
        return f"image_mode 非法：{image_mode}，可选 external（外链落盘）/ inline（base64 内嵌）"

    try:
        resolved = _resolve_and_check(file_path)
    except ValueError as exc:
        return str(exc)

    keep_images = bool(save_path.strip())
    try:
        result = _get_converter().convert(str(resolved), keep_data_uris=keep_images)
    except FileConversionException as exc:
        return f"转换失败：{exc}"
    except UnsupportedFormatException as exc:
        return f"不支持的格式：{exc}"

    markdown = result.markdown or ""

    if not keep_images:
        return markdown

    target = Path(save_path.strip()).expanduser()
    parent = target.parent if str(target.parent) else Path(".")
    if not parent.is_dir():
        return f"save_path 父目录不存在：{parent}"

    if image_mode == "external":
        assets_dir = parent / f"{target.stem}.assets"
        markdown, image_count = _externalize_images(markdown, assets_dir)
        image_note = f"图片外链 {image_count} 张至 {assets_dir.name}/"
    else:
        image_note = "图片以 base64 内嵌保留"

    target.write_text(markdown, encoding="utf-8")
    preview_lines = [_clip_line(line) for line in markdown.splitlines()[:20]]
    preview = "\n".join(preview_lines)
    total = len(markdown.splitlines())
    suffix = "……" if total > 20 else ""
    return (
        f"已写入：{target.resolve()}\n"
        f"共 {total} 行（{image_note}）。预览前 20 行：\n\n"
        f"{preview}\n{suffix}"
    )


def main() -> int:
    mcp.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
