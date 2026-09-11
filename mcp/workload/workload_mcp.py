#!/usr/bin/env python3
"""工时统计 MCP —— OA 打卡 × 项目系统工时交叉核对。

口径（决议见 vault 工作/ai-ssh/需求/需求-工时统计MCP.md）：
- 应填判据 = OA 打卡：某日有任何打卡即应填 >= 7h；无打卡自动豁免。
- 工时只统计 type=4「任务」工作项，记录按 creator 防御过滤。
- 时长统一整数化到分钟再比较，免疫浮点累加噪声。
- 失败即停，不出半残报告；纯只读。

CLI 双形态：
    python workload_mcp.py report --start 2026-08-01 --end 2026-09-11
    python workload_mcp.py serve                # stdio MCP server
"""

from __future__ import annotations

import argparse
import calendar
import datetime as dt
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REQUIRED_HOURS = 7  # 每个打卡日应填工时下限（小时）
WORK_ITEM_TYPE = 4  # 只统计「任务」

PROJ_BASE = "http://10.10.10.135:48080"
OA_BASE = "https://oapt.luyanpharm.com"

DEFAULT_CONFIG_PATH = Path.home() / ".workload" / "config.json"


# ---------------------------------------------------------------------------
# 纯逻辑：日期与分类
# ---------------------------------------------------------------------------

def parse_date(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def clamp_range(start: dt.date, end: dt.date, today: dt.date | None = None) -> tuple[dt.date, dt.date]:
    """校验区间并把 end 钳到昨天（今天还没过完，不能判「未填」）。"""
    today = today or dt.date.today()
    if start > end:
        raise ValueError(f"start({start}) 不能晚于 end({end})")
    if start > today:
        raise ValueError(f"start({start}) 在未来，区间无效")
    return start, min(end, today - dt.timedelta(days=1))


def weekday_dates(start: dt.date, end: dt.date) -> list[dt.date]:
    """区间内所有周一至周五。节假日不在此处理——由打卡判据天然豁免。"""
    days = []
    d = start
    while d <= end:
        if d.weekday() < 5:
            days.append(d)
        d += dt.timedelta(days=1)
    return days


def classify(
    start: dt.date,
    end: dt.date,
    punch_dates: set[dt.date],
    day_minutes: dict[dt.date, int],
) -> dict:
    """三分比对：打卡日按 7h 判未填满/未填；日历工作日∩无打卡列兜底清单。"""
    required_min = REQUIRED_HOURS * 60

    # 「应填」语义是出勤：主判定只看工作日打卡；周末/节假日打卡（加班）单列参考，
    # 不再额外要求 7h（决议只豁免无打卡日，周末加班不制造「未填满」噪音）。
    workdays = set(weekday_dates(start, end))
    attendance_days = sorted(punch_dates & workdays)
    weekend_punch_days = sorted(punch_dates - workdays)

    underfilled, unfilled, ok_days = [], [], []
    for d in attendance_days:
        m = day_minutes.get(d, 0)
        if m <= 0:
            unfilled.append(d.isoformat())
        elif m < required_min:
            underfilled.append({"date": d.isoformat(), "reported_hours": round(m / 60, 2), "gap_hours": round((required_min - m) / 60, 2)})
        else:
            ok_days.append(d.isoformat())

    # 兜底清单：日历工作日 ∩ 无打卡（人工确认均为请假/节假日）
    no_punch_workdays = sorted(workdays - punch_dates)
    # 有工时却无打卡的日子单独标出（忘打卡嫌疑）
    workload_without_punch = sorted(set(day_minutes) & workdays - punch_dates)

    total_min = sum(m for d, m in day_minutes.items() if start <= d <= end)
    return {
        "range": {"start": start.isoformat(), "end": end.isoformat()},
        "summary": {
            "required_hours_per_day": REQUIRED_HOURS,
            "calendar_workdays": len(workdays),
            "attendance_days": len(attendance_days),
            "ok_days": len(ok_days),
            "underfilled_days": len(underfilled),
            "unfilled_days": len(unfilled),
            "total_reported_hours": round(total_min / 60, 2),
        },
        "underfilled": underfilled,
        "unfilled": unfilled,
        "safety_net": {
            "calendar_workday_without_punch": [d.isoformat() for d in no_punch_workdays],
            "note": "日历工作日但无打卡——请确认均为请假/节假日；忘打卡日会出现在 workload_without_punch",
            "workload_without_punch": [d.isoformat() for d in workload_without_punch],
        },
        "weekend_punch_days": [d.isoformat() for d in weekend_punch_days],
    }


# ---------------------------------------------------------------------------
# 纯逻辑：OA HTML 解析
# ---------------------------------------------------------------------------

# tbody 数据行：<td>序号</td> [可选空<td/>] <td>来源</td> <td>编号</td> <td>部门</td> <td>姓名</td> <td>日期</td> <td>时间</td>
_ROW_RE = re.compile(
    r"<tr[^>]*>\s*<td[^>]*>(\d+)</td>\s*"  # 序号
    r"(?:<td[^>]*>\s*</td>\s*)?"  # 可选的空 td（真实页面里多为纯空白）
    r"<td[^>]*>[^<]*</td>\s*"  # 数据来源
    r"<td[^>]*>([^<]*)</td>\s*"  # 人员编号
    r"<td[^>]*>([^<]*)</td>\s*"  # 部门
    r"<td[^>]*>([^<]*)</td>\s*"  # 姓名
    r"<td[^>]*>(\d{4}-\d{2}-\d{2})</td>\s*"  # 打卡日期
    r"<td[^>]*>([^<]*)</td>",  # 打卡时间（逗号分隔）
    re.S,
)

_TOTAL_RE = re.compile(r"共\s*(\d+)\s*条")

_LOGIN_MARKERS = ("doLogin", "loginForm", "用户名", "登录")


def parse_punch_html(html: str) -> tuple[list[dict], int]:
    """解析打卡列表 HTML → (行列表, 总条数)。登录页特征则抛 TokenExpiredError。"""
    lowered = html.lower()
    if any(m.lower() in lowered for m in ("dologin", "loginform")) or (_TOTAL_RE.search(html) is None and "punchcard" not in lowered):
        # 登录页既无分页 footer 也无 punchcard 表格
        if "punchcard_date" not in html and _TOTAL_RE.search(html) is None:
            raise TokenExpiredError("OA 返回疑似登录页，token 已过期")

    rows = []
    for m in _ROW_RE.finditer(html):
        rows.append({
            "user_code": m.group(2).strip(),
            "date": m.group(5),
            "times": [t.strip() for t in m.group(6).split(",") if t.strip()],
        })
    total_m = _TOTAL_RE.search(html)
    total = int(total_m.group(1)) if total_m else len(rows)
    return rows, total


def merge_punch_rows(rows: list[dict]) -> set[dt.date]:
    """跨设备同日多行合并为日期集合。"""
    return {parse_date(r["date"]) for r in rows if r["date"]}


# ---------------------------------------------------------------------------
# 纯逻辑：工时记录汇总
# ---------------------------------------------------------------------------

def accumulate_records(records: list[dict], creator_id: str) -> dict[dt.date, int]:
    """按 creator 过滤后按日累计分钟。"""
    minutes: dict[dt.date, int] = {}
    for r in records:
        if str(r.get("creator", "")) != str(creator_id):
            continue
        d = parse_date(r["reportedAt"])
        minutes[d] = minutes.get(d, 0) + int(round(float(r["duration"]) * 60))
    return minutes


# ---------------------------------------------------------------------------
# 错误与配置
# ---------------------------------------------------------------------------

class WorkloadError(Exception):
    """业务错误，message 可直接展示给用户。"""


class TokenExpiredError(WorkloadError):
    pass


def load_config(path: Path | None = None) -> dict:
    p = path or Path(os.environ.get("WORKLOAD_MCP_CONFIG", "") or DEFAULT_CONFIG_PATH)
    if not p.exists():
        raise WorkloadError(
            f"配置文件不存在：{p}\n"
            f"请创建（JSON）：{{\"oa_token\": \"<地址栏复制的 X-EOA-TOKEN>\", "
            f"\"refresh_token\": \"<浏览器 localStorage 的 REFRESH_TOKEN>\", \"creator_id\": \"167\"}}"
        )
    cfg = json.loads(p.read_text(encoding="utf-8"))
    for key in ("oa_token", "refresh_token", "creator_id"):
        if not cfg.get(key):
            raise WorkloadError(f"配置缺字段：{key}（配置文件 {p}）")
    return cfg


def save_config(cfg: dict, path: Path | None = None) -> None:
    p = path or Path(os.environ.get("WORKLOAD_MCP_CONFIG", "") or DEFAULT_CONFIG_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    # 原子写：先写临时文件再替换，避免写一半损坏凭据
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, p)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


# ---------------------------------------------------------------------------
# HTTP（urllib，零第三方依赖）
# ---------------------------------------------------------------------------

def _http_json(url: str, method: str = "GET", headers: dict | None = None, body: bytes | None = None, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise WorkloadError(f"HTTP {e.code} {url}: {e.read()[:200]!r}") from e
    except urllib.error.URLError as e:
        raise WorkloadError(f"网络错误 {url}: {e.reason}") from e


def _http_text(url: str, method: str = "POST", headers: dict | None = None, body: bytes | None = None, timeout: int = 30) -> str:
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise WorkloadError(f"HTTP {e.code} {url}: {e.read()[:200]!r}") from e
    except urllib.error.URLError as e:
        # SSL 证书问题降级提示（OA 是 https 自签/内网）
        if "CERTIFICATE_VERIFY_FAILED" in str(getattr(e, "reason", "")):
            raise WorkloadError(f"SSL 证书校验失败 {url}（内网自签证书属预期，本工具已忽略校验）") from e
        raise WorkloadError(f"网络错误 {url}: {e.reason}") from e


# ---------------------------------------------------------------------------
# 项目系统客户端（芋道）
# ---------------------------------------------------------------------------

class ProjClient:
    """芋道项目系统。

    实测该部署为单会话模式：每次 refresh-token 签发新 accessToken 的同时作废上一个
    （28 分钟窗口）。因此进程生命周期内只允许刷新一次，token 用到底；二次 401 直接
    报错，避免刷新把自己正在用的 token 踢掉。
    """

    def __init__(self, cfg: dict, config_path: Path | None = None):
        self.cfg = cfg
        self.config_path = config_path
        self.access_token: str | None = None
        self._refreshed = False

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "tenant-id": "1",
            "Accept": "application/json",
        }

    def _request(self, url: str, params: dict | None = None) -> dict:
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        if self.access_token is None:
            self._refresh()
        try:
            data = _http_json(url, headers=self._headers())
        except WorkloadError as e:
            if "HTTP 401" not in str(e):
                raise
            if self._refreshed:
                raise WorkloadError("accessToken 二次失效（单会话模式不支持中途换 token），请重跑本工具") from e
            self._refresh()
            data = _http_json(url, headers=self._headers())
        if data.get("code") != 0:
            raise WorkloadError(f"项目系统返回异常 code={data.get('code')} msg={data.get('msg')}")
        return data.get("data") or {}

    def _refresh(self) -> None:
        """芋道 refresh-token：免验证码。该部署 refreshToken 固定不滚动（实测返回同值）。"""
        url = f"{PROJ_BASE}/admin-api/system/auth/refresh-token?refreshToken={urllib.parse.quote(self.cfg['refresh_token'])}"
        try:
            data = _http_json(url, method="POST", headers={"tenant-id": "1", "Accept": "application/json"})
        except WorkloadError as e:
            raise TokenExpiredError(f"刷新 accessToken 失败：{e}\n请从浏览器 localStorage 更新 refresh_token") from e
        if data.get("code") != 0:
            raise TokenExpiredError(f"refresh-token 返回 code={data.get('code')} msg={data.get('msg')}——请手动更新 refresh_token")
        tokens = data.get("data") or {}
        self.access_token = tokens.get("accessToken")
        if not self.access_token:
            raise TokenExpiredError("refresh-token 响应缺 accessToken——请手动更新 refresh_token")
        self._refreshed = True
        # 该部署 refreshToken 不滚动；若将来部署升级为滚动模式，此处写回仍适用
        new_refresh = tokens.get("refreshToken")
        if new_refresh and new_refresh != self.cfg.get("refresh_token"):
            self.cfg["refresh_token"] = new_refresh
            try:
                save_config(self.cfg, self.config_path)
            except OSError:
                pass  # 写回失败不阻断本次统计，下次再用旧 token 刷一次

    def fetch_work_items(self) -> list[dict]:
        out, page = [], 1
        while True:
            data = self._request(f"{PROJ_BASE}/admin-api/proj-ms/work_item/page-for-workload",
                                 {"pageNo": page, "pageSize": 100, "type": WORK_ITEM_TYPE})
            out.extend(data.get("list") or [])
            if len(out) >= int(data.get("total") or 0) or not (data.get("list")):
                return out
            page += 1

    def fetch_workload_records(self, work_item_id: str) -> list[dict]:
        out, page = [], 1
        while True:
            data = self._request(f"{PROJ_BASE}/admin-api/proj-ms/workload-record/page",
                                 {"pageNo": page, "pageSize": 100, "workItemId": work_item_id})
            out.extend(data.get("list") or [])
            if len(out) >= int(data.get("total") or 0) or not (data.get("list")):
                return out
            page += 1


# ---------------------------------------------------------------------------
# OA 客户端
# ---------------------------------------------------------------------------

class OaClient:
    def __init__(self, cfg: dict):
        self.token = cfg["oa_token"]
        self.jsessionid = cfg.get("oa_jsessionid", "")

    def fetch_punch_rows(self, start: dt.date, end: dt.date) -> list[dict]:
        all_rows, page, total = [], 1, None
        while True:
            html = self._fetch_page(start, end, page)
            rows, total = parse_punch_html(html)
            all_rows.extend(rows)
            if not rows or len(all_rows) >= total or page > 50:  # page>50 熔断防死循环
                break
            page += 1
        if total is not None and len(all_rows) < total:
            raise WorkloadError(f"打卡记录抓取不完整：{len(all_rows)}/{total} 条（翻页异常）")
        return all_rows

    def _fetch_page(self, start: dt.date, end: dt.date, page: int) -> str:
        form = urllib.parse.urlencode({
            "pageSize": 50, "pageNo": page, "orderStr": "", "order": "",
            "start_date": start.isoformat(), "end_date": end.isoformat(),
            "pk_dept": "", "pk_org_id": "", "all_pk_org_id": "",
            "seal_id": "", "seal_type": "", "source": "",
        }).encode()
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": OA_BASE,
            "Referer": f"{OA_BASE}/sys_checkwork/punchCardData/punchCard_list.html",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        }
        if self.jsessionid:
            headers["Cookie"] = f"JSESSIONID={self.jsessionid}"
        url = f"{OA_BASE}/sys_checkwork/punchCardData/punchCard_list.html?X-EOA-TOKEN={urllib.parse.quote(self.token)}"
        # OA 是 https 自签证书，走忽略校验的 opener
        ctx = ssl_no_verify_context()
        return _http_text(url, headers=headers, body=form) if not ctx else _http_text_unverified(url, headers, form)


def ssl_no_verify_context():
    try:
        import ssl
        return ssl.create_default_context()
    except Exception:
        return None


def _http_text_unverified(url: str, headers: dict, body: bytes) -> str:
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, data=body, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise WorkloadError(f"HTTP {e.code} {url}: {e.read()[:200]!r}") from e
    except urllib.error.URLError as e:
        raise WorkloadError(f"网络错误 {url}: {e.reason}") from e


# ---------------------------------------------------------------------------
# 主流水线
# ---------------------------------------------------------------------------

def build_report(cfg: dict, start_s: str, end_s: str, full_detail: bool = False,
                 config_path: Path | None = None, today: dt.date | None = None) -> dict:
    start, end = clamp_range(parse_date(start_s), parse_date(end_s), today)
    creator_id = str(cfg["creator_id"])

    # 1) OA 打卡
    oa = OaClient(cfg)
    punch_rows = oa.fetch_punch_rows(start, end)
    punch_dates = merge_punch_rows(punch_rows)

    # 2) 项目系统工时
    proj = ProjClient(cfg, config_path)
    work_items = proj.fetch_work_items()
    records = []
    for item in work_items:
        recs = proj.fetch_workload_records(str(item["id"]))
        records.extend(recs)
        if full_detail:
            item["_records"] = recs
    day_minutes = accumulate_records(records, creator_id)

    # 3) 比对
    report = classify(start, end, punch_dates, day_minutes)

    # 健全性检查：打卡天数占日历工作日比例过低时提醒（核实项1的防线）
    cal = report["summary"]["calendar_workdays"]
    att = report["summary"]["attendance_days"]
    if cal and att / cal < 0.5:
        report["warnings"] = [f"打卡天数({att})不足日历工作日({cal})的一半，打卡数据可能残缺——请核对 OA 查询结果"]

    if full_detail:
        detail = []
        d = start
        while d <= end:
            m = day_minutes.get(d, 0)
            detail.append({
                "date": d.isoformat(),
                "weekday": ["一", "二", "三", "四", "五", "六", "日"][d.weekday()],
                "punched": d in punch_dates,
                "reported_hours": round(m / 60, 2),
            })
            d += dt.timedelta(days=1)
        report["detail"] = detail
        report["overtime_records"] = [
            {"date": r["reportedAt"], "hours": r["duration"], "description": _strip_html(r.get("description") or "")}
            for r in records if r.get("overtime")
        ]
    return report


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).strip()


# ---------------------------------------------------------------------------
# stdio MCP server（零依赖实现 JSON-RPC，无需官方 SDK）
# ---------------------------------------------------------------------------

def serve() -> None:
    """极简 MCP stdio：initialize / tools/list / tools/call。"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        _handle(msg)


def _handle(msg: dict) -> None:
    method = msg.get("method")
    msg_id = msg.get("id")
    result = None

    if method == "initialize":
        result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                  "serverInfo": {"name": "workload", "version": "1.0.0"}}
    elif method == "notifications/initialized":
        return
    elif method == "tools/list":
        result = {"tools": [{
            "name": "check_workload",
            "description": "统计指定区间内本人工时填写情况：OA 打卡日应填 >=7h，输出未填满/未填清单与兜底核对清单",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "起始日期 YYYY-MM-DD"},
                    "end_date": {"type": "string", "description": "结束日期 YYYY-MM-DD（超过今天自动钳到昨天）"},
                    "full_detail": {"type": "boolean", "description": "是否附日明细与加班记录"},
                },
                "required": ["start_date", "end_date"],
            },
        }]}
    elif method == "tools/call":
        params = msg.get("params") or {}
        args = params.get("arguments") or {}
        try:
            cfg_path = Path(os.environ.get("WORKLOAD_MCP_CONFIG", "") or DEFAULT_CONFIG_PATH)
            cfg = load_config(cfg_path)
            report = build_report(cfg, args["start_date"], args.get("end_date") or args["start_date"],
                                  bool(args.get("full_detail")), config_path=cfg_path)
            result = {"content": [{"type": "text", "text": json.dumps(report, ensure_ascii=False, indent=2)}]}
        except WorkloadError as e:
            result = {"content": [{"type": "text", "text": f"错误：{e}"}], "isError": True}
        except Exception as e:  # noqa: BLE001 — MCP 边界兜底
            result = {"content": [{"type": "text", "text": f"未预期错误：{e!r}"}], "isError": True}
    else:
        if msg_id is None:
            return
        _send({"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"unknown method {method}"}})
        return

    if msg_id is not None:
        _send({"jsonrpc": "2.0", "id": msg_id, "result": result})


def _send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="工时统计（OA 打卡 × 项目系统工时）")
    ap.add_argument("mode", choices=["report", "serve"], help="report=直接出报告；serve=stdio MCP server")
    ap.add_argument("--start", help="起始日期 YYYY-MM-DD")
    ap.add_argument("--end", help="结束日期 YYYY-MM-DD")
    ap.add_argument("--config", help="配置文件路径（默认 ~/.workload/config.json）")
    ap.add_argument("--full-detail", action="store_true", help="附日明细与加班记录")
    args = ap.parse_args(argv)

    if args.mode == "serve":
        serve()
        return 0

    cfg_path = Path(args.config) if args.config else Path(os.environ.get("WORKLOAD_MCP_CONFIG", "") or DEFAULT_CONFIG_PATH)
    try:
        cfg = load_config(cfg_path)
        report = build_report(cfg, args.start, args.end, args.full_detail, config_path=cfg_path)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except WorkloadError as e:
        print(f"错误：{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
