"""markitdown 薄壳测试 —— 向量程序化生成，不打网络（决议 8）。

docx 用 zipfile 手造最小 OOXML（含一张 1x1 PNG 图片，验证 base64 保留/占位/外链
三模式），不引 python-docx 依赖。
"""

from __future__ import annotations

import base64
import hashlib
import struct
import sys
import zipfile
from pathlib import Path

import pytest

from markitdown_mcp import (
    ALLOWED_SUFFIXES,
    _resolve_and_check,
    convert_to_markdown,
    main,
)

# ---------------------------------------------------------------------------
# 测试向量工厂
# ---------------------------------------------------------------------------

# 1x1 红色 PNG


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", 0)


def _make_png() -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + _png_chunk(b"IDAT", b"\x78\x9c\x62\xd8\xcf\xa0\x00\x00\x00\x66\x00\x1f")
        + _png_chunk(b"IEND", b"")
    )


def make_docx(path: Path) -> Path:
    """最小可转换 docx：标题 + 段落 + 一张内嵌 PNG。"""
    document = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>测试标题</w:t></w:r></w:p>
    <w:p><w:r><w:t>正文段落，包含加粗与表格。</w:t></w:r></w:p>
    <w:p><w:r><w:drawing>
      <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:nvPicPr><pic:cNvPr id="1" name="img1"/><pic:cNvPicPr/></pic:nvPicPr>
              <pic:blipFill><a:blip r:embed="rId101" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></pic:blipFill>
              <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing></w:r></w:p>
  </w:body>
</w:document>
"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""
    doc_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId101" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>
"""
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/document.xml", document)
        zf.writestr("word/_rels/document.xml.rels", doc_rels)
        zf.writestr("word/media/image1.png", _make_png())
    return path


def make_html(path: Path) -> Path:
    path.write_text(
        "<html><head><title>页面标题</title></head><body>"
        "<h1>标题一</h1><p>段落<a href='https://example.com'>链接</a>。</p>"
        "<table><tr><th>列A</th><th>列B</th></tr>"
        "<tr><td>1</td><td>2</td></tr></table>"
        "</body></html>",
        encoding="utf-8",
    )
    return path


# ---------------------------------------------------------------------------
# 白名单与穿越防御
# ---------------------------------------------------------------------------


class TestResolveAndCheck:
    def test_allowed_suffix_passes(self, tmp_path):
        f = tmp_path / "a.docx"
        f.write_bytes(b"x")
        assert _resolve_and_check(str(f)) == f.resolve()

    def test_suffix_case_insensitive(self, tmp_path):
        f = tmp_path / "b.PDF"
        f.write_bytes(b"x")
        assert _resolve_and_check(str(f)).suffix == ".PDF"

    def test_dat_rejected(self, tmp_path):
        f = tmp_path / "credentials.dat"
        f.write_bytes(b"x")
        with pytest.raises(ValueError, match="不支持的文件类型"):
            _resolve_and_check(str(f))

    def test_no_suffix_rejected(self, tmp_path):
        f = tmp_path / "id_rsa"
        f.write_bytes(b"x")
        with pytest.raises(ValueError, match="无后缀"):
            _resolve_and_check(str(f))

    def test_traversal_rejected(self, tmp_path):
        f = tmp_path / ".." / "etc" / "passwd.pdf"
        with pytest.raises(ValueError, match="路径穿越"):
            _resolve_and_check(str(f))

    def test_missing_file_rejected(self, tmp_path):
        with pytest.raises(ValueError, match="文件不存在"):
            _resolve_and_check(str(tmp_path / "nope.docx"))

    def test_empty_path_rejected(self):
        with pytest.raises(ValueError, match="不能为空"):
            _resolve_and_check("  ")


# ---------------------------------------------------------------------------
# 转换：默认占位模式 / 落盘模式
# ---------------------------------------------------------------------------


class TestConvert:
    def test_docx_default_mode_image_placeholder(self, tmp_path):
        """默认模式：图片变 data:... 占位符，不内嵌完整 base64。"""
        docx = make_docx(tmp_path / "sample.docx")
        out = convert_to_markdown(file_path=str(docx))
        assert "测试标题" in out
        assert "data:image" in out and "..." in out
        # 占位模式不应出现完整 base64 载荷（截断后仅剩前缀）
        assert "](" not in out.split("data:image")[1][:40].rsplit(",", 1)[-1] + ")"

    def test_invalid_image_mode_rejected(self, tmp_path):
        """image_mode 非法值在转换前被拒（快速失败）。"""
        docx = make_docx(tmp_path / "sample.docx")
        out = convert_to_markdown(
            file_path=str(docx),
            save_path=str(tmp_path / "o.md"),
            image_mode="bogus",
        )
        assert "image_mode" in out and ("external" in out or "inline" in out)
        assert not (tmp_path / "o.md").exists()

    def test_docx_save_mode_embeds_base64(self, tmp_path):
        """落盘 inline 模式：keep_data_uris=True，文件内含完整 base64 图片。"""
        docx = make_docx(tmp_path / "sample.docx")
        save = tmp_path / "out.md"
        out = convert_to_markdown(
            file_path=str(docx), save_path=str(save), image_mode="inline"
        )
        assert "已写入" in out and str(save) in out
        saved = save.read_text(encoding="utf-8")
        assert "测试标题" in saved
        assert "data:image/png;base64," in saved
        assert "iVBOR" in saved  # PNG base64 头，证明载荷完整
        # 返回的是摘要结构（路径 + 行数 + 预览），不是裸 markdown
        assert out.startswith("已写入：")
        # inline 模式不产生资产目录
        assert not (tmp_path / "out.assets").exists()

    def test_docx_save_mode_external_links(self, tmp_path):
        """落盘 external 模式（默认）：图片落 <md同名>.assets/，md 相对链接。"""
        docx = make_docx(tmp_path / "sample.docx")
        save = tmp_path / "out.md"
        out = convert_to_markdown(file_path=str(docx), save_path=str(save))
        assert out.startswith("已写入：")
        saved = save.read_text(encoding="utf-8")
        assert "测试标题" in saved
        # md 本体不再含 base64 载荷
        assert "base64," not in saved
        # 图片目录存在且恰有一张 PNG，文件名 = sha1 前 12 位
        assets = tmp_path / "out.assets"
        pngs = list(assets.glob("*.png"))
        assert len(pngs) == 1
        expect_name = hashlib.sha1(_make_png()).hexdigest()[:12]
        assert pngs[0].name == f"{expect_name}.png"
        # 落盘字节与原 PNG 一致（解码无损）
        assert pngs[0].read_bytes() == _make_png()
        # md 里是相对链接引用
        assert f"](out.assets/{expect_name}.png)" in saved
        # 摘要报告外链张数与资产目录
        assert "out.assets" in out
        assert "1 张" in out

    def test_docx_save_mode_external_dedup(self, tmp_path):
        """同一图片出现两次：assets 只落一份，两处引用同一文件。

        双图 docx 向量太重，直接用两个相同 data URI 的 HTML 最轻。
        """
        html = tmp_path / "dupe.html"
        png_b64 = base64.b64encode(_make_png()).decode()
        html.write_text(
            "<html><body><p>a</p>"
            f"<img src='data:image/png;base64,{png_b64}'/>"
            f"<img src='data:image/png;base64,{png_b64}'/>"
            "<p>b</p></body></html>",
            encoding="utf-8",
        )
        save = tmp_path / "dupe.md"
        convert_to_markdown(file_path=str(html), save_path=str(save))
        assets = tmp_path / "dupe.assets"
        assert len(list(assets.iterdir())) == 1
        saved = save.read_text(encoding="utf-8")
        assert saved.count(".assets/") == 2  # 两处引用

    def test_save_mode_preview_truncates_long_lines(self, tmp_path):
        """预览超长行截断：inline 模式 base64 行不得整行进摘要。"""
        html = tmp_path / "long.html"
        png_b64 = base64.b64encode(_make_png()).decode()
        html.write_text(
            "<html><body><p>line1</p>"
            f"<img src='data:image/png;base64,{png_b64}'/></body></html>",
            encoding="utf-8",
        )
        save = tmp_path / "long.md"
        out = convert_to_markdown(
            file_path=str(html), save_path=str(save), image_mode="inline"
        )
        # 摘要里每个预览行不超过 200 + 截断标记的量级
        for line in out.splitlines():
            assert len(line) <= 220, f"预览行超长：{len(line)}"

    def test_save_mode_missing_parent_dir(self, tmp_path):
        docx = make_docx(tmp_path / "sample.docx")
        out = convert_to_markdown(
            file_path=str(docx), save_path=str(tmp_path / "no" / "dir" / "o.md")
        )
        assert "父目录不存在" in out

    def test_html_smoke(self, tmp_path):
        """HTML 冒烟：标题/链接/表格保留。"""
        html = make_html(tmp_path / "page.html")
        out = convert_to_markdown(file_path=str(html))
        assert "标题一" in out
        assert "https://example.com" in out
        assert "列A" in out and "2" in out

    def test_whitelist_guard_before_conversion(self, tmp_path):
        """白名单外的文件在进转换器前就被拒。"""
        bad = tmp_path / "x.pem"
        bad.write_text("-----BEGIN PRIVATE KEY-----")
        out = convert_to_markdown(file_path=str(bad))
        assert "不支持的文件类型" in out
        assert "PRIVATE KEY" not in out


def test_allowed_suffixes_match_design():
    """白名单与决议 6 逐项对齐。"""
    assert ALLOWED_SUFFIXES == {
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


def test_main_runs(monkeypatch):
    """main 委托 MCPServer.run()（不真起 stdio 循环）。"""
    called = {}
    monkeypatch.setattr(
        sys.modules["markitdown_mcp"].mcp,
        "run",
        lambda: called.setdefault("r", True),
    )
    assert main() == 0
    assert called.get("r") is True
