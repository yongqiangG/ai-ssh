#!/usr/bin/env python3
"""工时统计 MCP —— OA 打卡 × 项目系统工时交叉核对。

口径（决议见 vault 工作/ai-ssh/需求/需求-工时统计MCP.md）：
- 应填判据 = OA 打卡：某日有任何打卡即应填 >= 7h；无打卡自动豁免。
- 工时只统计 type=4「任务」工作项，记录按 creator 防御过滤。
- 时长统一整数化到分钟再比较，免疫浮点累加噪声。
- 失败即停，不出半残报告；纯只读。

CLI：
    python workload_mcp.py setup               # 一次配置账号，密码隐藏输入
    python workload_mcp.py report --start 2026-08-01 --end 2026-09-11
    python workload_mcp.py serve                # stdio MCP server
"""

from __future__ import annotations

import argparse
import datetime as dt
import getpass
import html
import json
import re
import sys
from pathlib import Path

from workload_auth import OaSession, ProjectSession, is_login_page
from workload_captcha import CaptchaSolver
from workload_jobs import ReportJobs
from workload_security import (
    REQUIRED_CREDENTIALS,
    CancelledError,
    CredentialStore,
    RunContext,
    TokenExpiredError,
    WorkloadError,
    redact,
    validate_credentials,
)
from workload_security import (
    config_path as resolve_config_path,
)

REQUIRED_HOURS = 7  # 每个打卡日应填工时下限（小时）
WORK_ITEM_TYPE = 4  # 只统计「任务」

# ---------------------------------------------------------------------------
# 纯逻辑：日期与分类
# ---------------------------------------------------------------------------


def parse_date(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def clamp_range(
    start: dt.date, end: dt.date, today: dt.date | None = None
) -> tuple[dt.date, dt.date]:
    """校验区间并把 end 钳到昨天（今天还没过完，不能判「未填」）。"""
    today = today or dt.datetime.now(dt.timezone.utc).astimezone().date()
    if start > end:
        raise ValueError(f"start({start}) 不能晚于 end({end})")
    if start > today:
        raise ValueError(f"start({start}) 在未来，区间无效")
    end = min(end, today - dt.timedelta(days=1))
    if start > end:
        raise ValueError("区间需包含至少一个已结束的日期，今天暂不统计")
    return start, end


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
            underfilled.append(
                {
                    "date": d.isoformat(),
                    "reported_hours": round(m / 60, 2),
                    "gap_hours": round((required_min - m) / 60, 2),
                }
            )
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
            "calendar_workday_without_punch": [
                d.isoformat() for d in no_punch_workdays
            ],
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
    re.DOTALL,
)

_TOTAL_RE = re.compile(r"共\s*(\d+)\s*条")


def parse_punch_html(html: str) -> tuple[list[dict], int]:
    """解析打卡列表 HTML → (行列表, 总条数)。登录页特征则抛 TokenExpiredError。"""
    if is_login_page(html):
        raise TokenExpiredError("OA 返回登录页，授权已失效")
    total_m = _TOTAL_RE.search(html)
    if total_m is None:
        raise WorkloadError(
            "OA 打卡页面格式发生变化：未找到分页总数，请核对 OA 查询结果"
        )

    rows = []
    for m in _ROW_RE.finditer(html):
        rows.append(
            {
                "user_code": m.group(2).strip(),
                "date": m.group(5),
                "times": [t.strip() for t in m.group(6).split(",") if t.strip()],
            }
        )
    total = int(total_m.group(1))
    if total and not rows:
        raise WorkloadError("OA 打卡页面格式发生变化：未能解析数据行")
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
        minutes[d] = minutes.get(d, 0) + round(float(r["duration"]) * 60)
    return minutes


# ---------------------------------------------------------------------------
# 凭据与业务客户端：认证恢复由 session 负责
# ---------------------------------------------------------------------------


def load_config(path: Path | None = None) -> dict:
    return CredentialStore(path).load()


def save_config(cfg: dict, path: Path | None = None) -> None:
    CredentialStore(path).save(cfg)


class ProjClient:
    """只读工时接口；独立会话由 ProjectSession 管理。"""

    def __init__(self, session: ProjectSession, context: RunContext | None = None):
        self.session = session
        self.context = context or RunContext()

    def current_user_id(self, username: str) -> str:
        data = self.session.get("/system/auth/get-permission-info")
        user = data.get("user") if isinstance(data, dict) else None
        if not isinstance(user, dict) or user.get("id") is None:
            raise WorkloadError("项目系统未返回当前用户标识，请检查身份接口")
        user_id = str(user["id"])
        if not user.get("username"):
            user = self.session.get("/system/user/profile/get")
        if (
            not isinstance(user, dict)
            or str(user.get("id")) != user_id
            or str(user.get("username", "")).casefold() != username.casefold()
        ):
            raise WorkloadError("项目系统当前账号与配置不一致，请运行 setup 重新配置")
        return user_id

    def _pages(self, path: str, params: dict) -> list[dict]:
        out, seen_ids = [], set()
        for page in range(1, 1001):
            self.context.check()
            data = self.session.get(path, {**params, "pageNo": page, "pageSize": 100})
            if not isinstance(data, dict) or not isinstance(data.get("list"), list):
                raise WorkloadError("项目系统分页响应格式发生变化")
            try:
                total = int(data["total"])
            except (KeyError, TypeError, ValueError) as exc:
                raise WorkloadError("项目系统分页响应缺少有效总数") from exc
            rows = data["list"]
            for row in rows:
                if not isinstance(row, dict) or row.get("id") is None:
                    raise WorkloadError("项目系统分页记录缺少标识")
                row_id = str(row["id"])
                if row_id in seen_ids:
                    raise WorkloadError("项目系统分页返回了重复记录，请稍后重试")
                seen_ids.add(row_id)
            out.extend(rows)
            if len(out) == total:
                return out
            if not rows or len(out) > total:
                raise WorkloadError(
                    f"项目系统记录抓取不完整：{len(out)}/{total} 条，请重试"
                )
        raise WorkloadError("项目系统分页超出上限，已停止本次统计")

    def fetch_work_items(self) -> list[dict]:
        return self._pages(
            "/proj-ms/work_item/page-for-workload", {"type": WORK_ITEM_TYPE}
        )

    def fetch_in_progress_tasks(self) -> list[dict]:
        return self._pages(
            "/proj-ms/work_item/page-for-workload",
            {"type": WORK_ITEM_TYPE, "state": "IN_PROGRESS"},
        )

    def fetch_tasks_by_number(self, number: str) -> list[dict]:
        """不限状态回查：提交后任务可能已流转出 IN_PROGRESS（如 COMPLETED）。"""
        rows = self.fetch_work_items()
        return [row for row in rows if str(row.get("number") or "") == number]

    def fetch_workload_records(self, work_item_id: str) -> list[dict]:
        return self._pages(
            "/proj-ms/workload-record/page", {"workItemId": work_item_id}
        )

    def submit_workload(
        self,
        number: str,
        date: str,
        duration: float,
        description: str = "",
        *,
        today: dt.date | None = None,
    ) -> dict:
        """单条提交：number 严格唯一命中 IN_PROGRESS 任务，预检剩余，失败即停。

        description 为回显校验参数：必须等于任务真实标题（strip 后精确匹配），
        不符即拒且不发写入——保证调用方卡片上展示的标题就是将写入系统的标题。
        """
        checked = submit_arguments(
            {
                "number": number,
                "date": date,
                "duration": duration,
                "description": description,
            },
            today=today,
        )
        date_s, duration_f = checked["date"], checked["duration"]
        candidates = [
            t for t in self.fetch_in_progress_tasks() if t.get("number") == number
        ]
        if not candidates:
            raise WorkloadError(
                f"未找到编号 {number} 的进行中任务，请核对编号或先调用 list_work_tasks；"
                f"若任务已报满会流转为 COMPLETED，可用 list_work_tasks 的 number 参数回查"
            )
        if len(candidates) > 1:
            raise WorkloadError(
                f"编号 {number} 命中 {len(candidates)} 个任务，请检查系统数据"
            )
        item = candidates[0]
        title = str(item.get("title") or number)
        echo = checked["description"]
        if echo != title.strip():
            raise WorkloadError(
                f"description 与任务 {number} 的真实标题不一致，已拒绝提交。"
                f"真实标题：{title}——请以 list_work_tasks 返回的 title 为准重新调用"
            )
        try:
            estimated = float(item["estimatedWorkload"] or 0)
            reported = float(item["reportedWorkload"] or 0)
        except (KeyError, TypeError, ValueError) as exc:
            raise WorkloadError(
                "任务预估/已报字段缺失或格式异常，请重新查询任务列表"
            ) from exc
        remaining = round(estimated - reported, 2)
        # 0.1h 是补报口令：满额任务也放行，触发系统自动流转 COMPLETED；
        # 其余时长照旧防呆，拒绝写出负剩余。
        if duration_f != 0.1 and remaining - duration_f < -0.01:
            raise WorkloadError(
                f"提交 {duration_f:g}h 超出任务剩余容量 {remaining:g}h"
                f"（预估 {estimated:g}h，已报 {reported:g}h），已拒绝提交"
            )
        # 剩余钳位到 0：负数服务端照存但任务不流转（SYSCCG-1135 实测），必须写 0
        remaining_after = max(round(remaining - duration_f, 2), 0.0)
        payload = {
            "workItemId": str(item["id"]),
            "duration": _format_hours(duration_f),
            "remainingWorkload": remaining_after,
            "type": "DEVELOP",
            "overtime": False,
            "reportedAt": date_s,
            "description": "<p>" + html.escape(title) + "</p>",
        }
        self.session.post_json("/proj-ms/workload-record/create", payload)
        return {
            "number": number,
            "title": title,
            "date": date_s,
            "duration": duration_f,
            "remaining_after": remaining_after,
        }


def _format_hours(value: float) -> str:
    """6.0 → "6"，6.5 → "6.5"，与系统展示口径一致。"""
    return str(int(value)) if float(value).is_integer() else str(value)


class OaClient:
    def __init__(
        self, session: OaSession, username: str, context: RunContext | None = None
    ):
        self.session, self.username = session, username
        self.context = context or RunContext()

    def fetch_punch_rows(self, start: dt.date, end: dt.date) -> list[dict]:
        all_rows, seen_pages = [], set()
        for page in range(1, 51):
            self.context.check()
            html = self.session.post(
                "/sys_checkwork/punchCardData/punchCard_list.html",
                {
                    "pageSize": 50,
                    "pageNo": page,
                    "orderStr": "",
                    "order": "",
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "pk_dept": "",
                    "pk_org_id": "",
                    "all_pk_org_id": "",
                    "seal_id": "",
                    "seal_type": "",
                    "source": "",
                },
            )
            rows, total = parse_punch_html(html)
            if any(
                row["user_code"].casefold() != self.username.casefold() for row in rows
            ):
                raise WorkloadError(
                    "OA 打卡记录账号与配置不一致，请运行 setup 重新配置"
                )
            signature = tuple(
                (r["user_code"], r["date"], tuple(r["times"])) for r in rows
            )
            if rows and signature in seen_pages:
                raise WorkloadError("OA 打卡分页返回了重复数据，请稍后重试")
            seen_pages.add(signature)
            all_rows.extend(rows)
            if len(all_rows) == total:
                return all_rows
            if not rows or len(all_rows) > total:
                raise WorkloadError(
                    f"打卡记录抓取不完整：{len(all_rows)}/{total} 条，请重试"
                )
        raise WorkloadError("OA 打卡分页超出 50 页上限，请缩小统计日期区间")


# ---------------------------------------------------------------------------
# 主流水线
# ---------------------------------------------------------------------------


def build_report(
    cfg: dict,
    start_s: str,
    end_s: str,
    full_detail: bool = False,
    config_path: Path | None = None,
    today: dt.date | None = None,
    *,
    context: RunContext | None = None,
    oa: OaClient | None = None,
    proj: ProjClient | None = None,
) -> dict:
    context = context or RunContext()
    context.check()
    start, end = clamp_range(parse_date(start_s), parse_date(end_s), today)
    solver = CaptchaSolver()

    def save():
        save_config(cfg, config_path)

    if proj is None:
        proj = ProjClient(
            ProjectSession(cfg, save, solver=solver, context=context), context
        )
    if oa is None:
        oa = OaClient(
            OaSession(cfg, save, solver=solver, context=context),
            cfg["oa_username"],
            context,
        )

    creator_id = proj.current_user_id(cfg["project_username"])
    punch_rows = oa.fetch_punch_rows(start, end)
    punch_dates = {
        date for date in merge_punch_rows(punch_rows) if start <= date <= end
    }
    work_items = proj.fetch_work_items()
    records = []
    for item in work_items:
        context.check()
        recs = proj.fetch_workload_records(str(item["id"]))
        try:
            records.extend(
                r
                for r in recs
                if str(r.get("creator", "")) == creator_id
                and start <= parse_date(r["reportedAt"]) <= end
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise WorkloadError("项目工时记录格式发生变化，请检查记录日期") from exc
    context.check()
    day_minutes = accumulate_records(records, creator_id)
    report = classify(start, end, punch_dates, day_minutes)

    cal = report["summary"]["calendar_workdays"]
    att = report["summary"]["attendance_days"]
    if cal and att / cal < 0.5:
        report["warnings"] = [
            f"打卡天数({att})不足日历工作日({cal})的一半，打卡数据可能残缺——请核对 OA 查询结果"
        ]

    if full_detail:
        detail = []
        date = start
        while date <= end:
            detail.append(
                {
                    "date": date.isoformat(),
                    "weekday": ["一", "二", "三", "四", "五", "六", "日"][
                        date.weekday()
                    ],
                    "punched": date in punch_dates,
                    "reported_hours": round(day_minutes.get(date, 0) / 60, 2),
                }
            )
            date += dt.timedelta(days=1)
        report["detail"] = detail
        report["overtime_records"] = [
            {
                "date": r["reportedAt"],
                "hours": r["duration"],
                "description": _strip_html(r.get("description") or ""),
            }
            for r in records
            if r.get("overtime")
        ]
    context.check()
    return report


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).strip()


def report_arguments(arguments: dict) -> dict:
    if not isinstance(arguments, dict) or set(arguments) - {
        "start_date",
        "end_date",
        "full_detail",
    }:
        raise WorkloadError("统计参数不正确，仅支持 start_date、end_date、full_detail")
    for key in ("start_date", "end_date"):
        value = arguments.get(key)
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise WorkloadError(f"{key} 必须是 YYYY-MM-DD 日期")
    if not isinstance(arguments.get("full_detail", False), bool):
        raise WorkloadError("full_detail 必须是布尔值")
    try:
        start, end = clamp_range(
            parse_date(arguments["start_date"]), parse_date(arguments["end_date"])
        )
    except ValueError as exc:
        raise WorkloadError("日期区间无效：" + str(exc)) from exc
    return {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "full_detail": arguments.get("full_detail", False),
    }


def list_tasks_arguments(arguments: dict) -> dict:
    if not isinstance(arguments, dict) or set(arguments) - {"number"}:
        raise WorkloadError("任务列表查询仅支持可选参数 number（任务编号）")
    if "number" not in arguments:
        return {}
    number = arguments["number"]
    if not isinstance(number, str) or not number.strip():
        raise WorkloadError("number 必须是非空任务编号，如 SYSCCG-1821")
    return {"number": number.strip()}


def submit_arguments(arguments: dict, *, today: dt.date | None = None) -> dict:
    """提交工时参数校验：最晚今天（统计口径仍只到昨天，两侧分离）、0.1 步进正数。"""
    if not isinstance(arguments, dict) or set(arguments) - {
        "number",
        "date",
        "duration",
        "description",
    }:
        raise WorkloadError(
            "提交参数不正确，仅支持 number、date、duration、description"
        )
    number = arguments.get("number")
    if not isinstance(number, str) or not number.strip():
        raise WorkloadError("number 必须是非空任务编号，如 SYSCCG-1821")
    description = arguments.get("description")
    if not isinstance(description, str) or not description.strip():
        raise WorkloadError(
            "description 必须是任务标题原文（list_work_tasks 返回的 title 字段），"
            "用于调用方展示确认；与真实标题不符会拒绝提交"
        )
    date_value = arguments.get("date")
    if not isinstance(date_value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}", date_value
    ):
        raise WorkloadError("date 必须是 YYYY-MM-DD 日期")
    duration = arguments.get("duration")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)):
        raise WorkloadError("duration 必须是数字（小时）")
    duration = float(duration)
    if duration <= 0 or abs(duration * 10 - round(duration * 10)) > 1e-6:
        raise WorkloadError("duration 必须是正数且为 0.1 的整数倍（如 7、6.5 或 0.1）")
    duration = round(duration, 1)  # 归一浮点尾数：0.30000000000000004 → 0.3
    parsed = parse_date(date_value)
    today = today or dt.datetime.now(dt.timezone.utc).astimezone().date()
    if parsed > today:
        raise WorkloadError("date 不能是未来日期——不预填未来工时")
    return {
        "number": number.strip(),
        "date": date_value,
        "duration": duration,
        "description": description.strip(),
    }


def run_report(
    arguments: dict, context: RunContext | None = None, config_path: Path | None = None
) -> dict:
    arguments = report_arguments(arguments)
    context = context or RunContext()
    context.check()
    path = resolve_config_path(config_path)
    store = CredentialStore(path)
    with store.lock():
        context.check()
        cfg = load_config(path)
        try:
            return build_report(
                cfg,
                arguments["start_date"],
                arguments["end_date"],
                arguments["full_detail"],
                config_path=path,
                context=context,
            )
        except CancelledError:
            raise
        except WorkloadError as exc:
            raise WorkloadError(redact(exc, cfg)) from None
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            raise WorkloadError(
                f"统计数据格式发生变化（{type(exc).__name__}），请核对系统返回数据"
            ) from None


def _project_client(
    config_path: Path | None = None, context: RunContext | None = None
) -> tuple[ProjClient, dict]:
    """同步短请求共用的会话装配：持锁读凭据，复用缓存 token。"""
    context = context or RunContext()
    path = resolve_config_path(config_path)
    store = CredentialStore(path)
    with store.lock():
        cfg = load_config(path)
        client = ProjClient(
            ProjectSession(
                cfg,
                lambda: save_config(cfg, path),
                solver=CaptchaSolver(),
                context=context,
            ),
            context,
        )
    return client, cfg


def run_list_tasks(
    arguments: dict | None = None, config_path: Path | None = None
) -> dict:
    checked = list_tasks_arguments(arguments or {})
    context = RunContext()
    client, cfg = _project_client(config_path, context)
    try:
        if "number" in checked:
            items = client.fetch_tasks_by_number(checked["number"])
        else:
            items = client.fetch_in_progress_tasks()
    except WorkloadError as exc:
        raise WorkloadError(redact(exc, cfg)) from None
    return {
        "total": len(items),
        "tasks": [
            {
                "number": item.get("number"),
                "id": str(item.get("id")),
                "title": item.get("title"),
                "state": item.get("state"),
                "estimated_workload": item.get("estimatedWorkload"),
                "reported_workload": item.get("reportedWorkload"),
                "remaining_workload": item.get("remainingWorkload"),
                "create_time": (
                    dt.datetime.fromtimestamp(
                        item["createTime"] / 1000, dt.timezone.utc
                    )
                    .astimezone()
                    .strftime("%Y-%m-%d")
                    if item.get("createTime")
                    else None
                ),
            }
            for item in items
        ],
    }


def run_submit_workload(arguments: dict, config_path: Path | None = None) -> dict:
    checked = submit_arguments(arguments)
    context = RunContext()
    client, cfg = _project_client(config_path, context)
    try:
        return client.submit_workload(
            checked["number"],
            checked["date"],
            checked["duration"],
            checked["description"],
        )
    except WorkloadError as exc:
        raise WorkloadError(redact(exc, cfg)) from None


# ---------------------------------------------------------------------------
# stdio MCP：后台统计 + 有界查询，等待人工验证不占用单个长请求
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "name": "check_workload",
        "description": (
            "统计本人工时：工作日有 OA 打卡则应填 >=7h。自动登录；验证码失败会打开本机验证页。"
            "返回 task_id 和状态；未结束时必须继续调用 get_workload_result，直到 completed/failed/cancelled。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "起始日期 YYYY-MM-DD"},
                "end_date": {
                    "type": "string",
                    "description": "结束日期 YYYY-MM-DD，最晚统计到昨天",
                },
                "full_detail": {
                    "type": "boolean",
                    "default": False,
                    "description": "附日明细与本人区间内加班记录",
                },
            },
            "required": ["start_date", "end_date"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_workload_result",
        "description": "查询工时任务，每次最多等待 20 秒；人工验证后自动继续原统计。仅 completed 状态包含 report。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "wait_seconds": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 20,
                    "default": 20,
                },
            },
            "required": ["task_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "cancel_workload",
        "description": "取消进行中或等待验证码的工时统计；正在进行的网络请求结束后取消，不返回残缺报告。",
        "inputSchema": {
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
            "required": ["task_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_work_tasks",
        "description": (
            "查询项目系统任务及预估/已报/剩余工时，纯只读。不传参数返回全部进行中（IN_PROGRESS）任务，"
            "用于选择要填报工时的任务；传 number 按编号不限状态回查单个任务"
            "（含 COMPLETED，用于提交后验证任务状态与已报工时）。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "number": {
                    "type": "string",
                    "description": "任务编号，如 FXZT-237（number 字段，非 id）；不传则列全部进行中任务",
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "submit_workload",
        "description": (
            "为指定任务提交一条工时记录（写入操作，单条）。number 须严格唯一命中进行中任务；"
            "date 最晚今天（未来日期拒绝）；duration 为正数且 0.1 的整数倍；提交前自动校验不超出任务剩余容量，"
            "超出即拒绝——唯一例外：duration=0.1 视为补报口令，满额任务也放行（剩余钳位为 0），"
            "用于触发系统将已报超预估的任务自动流转为 COMPLETED。"
            "description 必须填任务标题原文（list_work_tasks 返回的 title 字段）——"
            "用于调用前向用户展示「提交到哪个任务」，与真实标题不符会拒绝提交；"
            "写入系统的 description 由服务端用真实标题构造，不受入参影响。"
            "type 固定 DEVELOP、overtime 固定 false。任何失败立即中断，不做重试。"
            "本会话未查过该编号标题时先调 list_work_tasks 取当前 title，不得凭记忆。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "number": {
                    "type": "string",
                    "description": "任务编号，如 SYSCCG-1821（number 字段，非 id）",
                },
                "date": {
                    "type": "string",
                    "description": "工时归属日期 YYYY-MM-DD，最晚今天",
                },
                "duration": {
                    "type": "number",
                    "description": "时长（小时），正数且 0.1 的整数倍，如 7、6.5 或 0.1（补报触发流转）",
                },
                "description": {
                    "type": "string",
                    "description": (
                        "任务标题原文（list_work_tasks 返回的 title 字段）。"
                        "回显校验用：与真实标题不符会拒绝提交"
                    ),
                },
            },
            "required": ["number", "date", "duration", "description"],
            "additionalProperties": False,
        },
    },
]


def serve(config_path: Path | None = None, *, runner=None) -> None:
    jobs = ReportJobs(
        runner or (lambda args, context: run_report(args, context, config_path))
    )
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                message = json.loads(line)
            except (ValueError, UnicodeError):
                _send(_rpc_error(None, -32700, "JSON 解析失败"))
                continue
            reply = _handle(message, jobs, config_path=config_path)
            if reply is not None:
                _send(reply)
    finally:
        jobs.close()


def _call_tool(params: dict, jobs: ReportJobs, config_path: Path | None = None) -> dict:
    if not isinstance(params, dict):
        raise WorkloadError("工具调用参数必须为对象")
    name = params.get("name")
    args = params.get("arguments", {})
    if name == "check_workload":
        return jobs.start(report_arguments(args))
    if name == "list_work_tasks":
        return run_list_tasks(args, config_path)
    if name == "submit_workload":
        return run_submit_workload(args, config_path)
    if name not in ("get_workload_result", "cancel_workload"):
        raise WorkloadError("未知工具，请调用 tools/list 查看可用工具")
    if (
        not isinstance(args, dict)
        or not isinstance(args.get("task_id"), str)
        or not args["task_id"]
    ):
        raise WorkloadError("请提供有效的 task_id")
    allowed = (
        {"task_id", "wait_seconds"} if name == "get_workload_result" else {"task_id"}
    )
    if set(args) - allowed:
        raise WorkloadError("任务参数包含不支持的字段")
    if name == "cancel_workload":
        return jobs.cancel(args["task_id"])
    if isinstance(args.get("wait_seconds"), bool):
        raise WorkloadError("wait_seconds 必须是 0–20 之间的秒数")
    return jobs.get(args["task_id"], args.get("wait_seconds", 20))


def _handle(
    msg: dict, jobs: ReportJobs, config_path: Path | None = None
) -> dict | None:
    if (
        not isinstance(msg, dict)
        or msg.get("jsonrpc") != "2.0"
        or not isinstance(msg.get("method"), str)
    ):
        return _rpc_error(None, -32600, "无效的 JSON-RPC 请求")
    msg_id = msg.get("id")
    if msg_id is None:
        return None
    if isinstance(msg_id, bool) or not isinstance(msg_id, (str, int)):
        return _rpc_error(None, -32600, "无效的请求 id")
    method = msg["method"]
    if method == "initialize":
        params = msg.get("params") or {}
        if not isinstance(params, dict):
            return _rpc_error(msg_id, -32602, "initialize 参数必须为对象")
        versions = ("2024-11-05", "2025-03-26", "2025-06-18")
        version = params.get("protocolVersion")
        result = {
            "protocolVersion": version if version in versions else versions[-1],
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "workload", "version": "2.5.0"},
            "instructions": (
                "check_workload 返回未完成状态时，持续调用 get_workload_result；验证码完成后原统计自动继续。"
                "submit_workload 是写入操作，description 参数必须填任务标题原文"
                "（list_work_tasks 返回的 title，不得凭记忆或编造）——它用于向用户展示提交到哪个任务，"
                "与真实标题不符会拒绝提交；确认前须向用户展示编号、标题、日期、时长。"
                "失败即停。成功后向用户报告剩余工时；若报满则提示任务已流转 COMPLETED，"
                "可用 list_work_tasks 传 number 回查验证，不限状态。"
                "duration=0.1 是补报口令：满额任务也放行，用于触发系统自动流转 COMPLETED。"
            ),
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        try:
            value = _call_tool(msg.get("params", {}), jobs, config_path=config_path)
            result = {
                "content": [
                    {"type": "text", "text": json.dumps(value, ensure_ascii=False)}
                ]
            }
            if value.get("status") in ("failed", "cancelled"):
                result["isError"] = True
        except WorkloadError as exc:
            result = {"content": [{"type": "text", "text": str(exc)}], "isError": True}
        except Exception as exc:  # noqa: BLE001 — 协议边界只暴露异常类型，避免凭据进入响应
            result = {
                "content": [
                    {
                        "type": "text",
                        "text": f"工具调用失败（{type(exc).__name__}），请检查参数或重新运行",
                    }
                ],
                "isError": True,
            }
    else:
        return _rpc_error(msg_id, -32601, "未知方法")
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def _rpc_error(msg_id, code, message):
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def _send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def setup(path: Path, *, from_stdin=False) -> None:
    if from_stdin:
        raw = (
            getpass.getpass("登录配置 JSON（隐藏输入）：")
            if sys.stdin.isatty()
            else sys.stdin.readline(65537)
        )
        if len(raw) > 65536:
            raise WorkloadError("登录配置输入过长")
        try:
            cfg = json.loads(raw)
        except (ValueError, UnicodeError):
            raise WorkloadError("请通过标准输入提供一行有效的登录配置 JSON") from None
    else:
        if not sys.stdin.isatty():
            raise WorkloadError(
                "请在交互式终端运行 setup，或使用 setup --stdin 提供登录信息"
            )
        cfg = {
            "project_username": input("项目系统账号：").strip(),
            "project_password": getpass.getpass("项目系统密码（隐藏输入）："),
            "oa_username": input("OA 账号：").strip(),
            "oa_password": getpass.getpass("OA 密码（隐藏输入）："),
        }
    validate_credentials(cfg)
    credentials = {key: cfg[key] for key in REQUIRED_CREDENTIALS}
    store = CredentialStore(path)
    with store.lock():
        store.save(credentials)
    print(f"两系统登录信息已加密保存：{path}\n下次统计将自动登录，无需配置 token。")


def _verification_notice(state):
    if state:
        print(
            f"{state['system']} 需要完成验证码：{state['url']}\n"
            f"最多等待 {state['timeout_seconds']} 秒，完成后自动继续统计。",
            file=sys.stderr,
            flush=True,
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="工时统计（OA 打卡 × 项目系统工时，自动登录）"
    )
    modes = parser.add_subparsers(dest="mode", required=True)
    setup_parser = modes.add_parser("setup", help="一次配置两系统账号，密码隐藏输入")
    setup_parser.add_argument(
        "--stdin", action="store_true", help="从标准输入读取一行登录配置 JSON"
    )
    report_parser = modes.add_parser("report", help="直接生成工时报告")
    report_parser.add_argument("--start", required=True, help="起始日期 YYYY-MM-DD")
    report_parser.add_argument("--end", required=True, help="结束日期 YYYY-MM-DD")
    report_parser.add_argument(
        "--full-detail", action="store_true", help="附日明细与加班记录"
    )
    serve_parser = modes.add_parser("serve", help="启动 stdio MCP server")
    for subparser in (setup_parser, report_parser, serve_parser):
        subparser.add_argument(
            "--config",
            help="加密凭据路径，默认 %USERPROFILE%\\.workload\\credentials.dat",
        )
    args = parser.parse_args(argv)
    path = resolve_config_path(Path(args.config) if args.config else None)
    context = RunContext(on_verification=_verification_notice)
    try:
        if args.mode == "setup":
            setup(path, from_stdin=args.stdin)
        elif args.mode == "serve":
            serve(path)
        else:
            report = run_report(
                {
                    "start_date": args.start,
                    "end_date": args.end,
                    "full_detail": args.full_detail,
                },
                context,
                path,
            )
            print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except KeyboardInterrupt:
        context.cancelled.set()
        print("统计已取消", file=sys.stderr)
        return 130
    except WorkloadError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 — CLI 边界不打印可能包含凭据的异常内容
        print(f"未预期错误（{type(exc).__name__}），请检查安装或重试", file=sys.stderr)
        return 1


if __name__ == "__main__":
    # Windows 控制台和 MCP 管道统一 UTF-8；第三方识别库不向协议流输出日志。
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
