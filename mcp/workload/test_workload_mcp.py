"""workload_mcp 纯逻辑单元测试（unittest，零第三方依赖）。

跑法：python test_workload_mcp.py
"""

import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from workload_mcp import (
    TokenExpiredError,
    accumulate_records,
    clamp_range,
    classify,
    merge_punch_rows,
    parse_punch_html,
    weekday_dates,
)

# ---------------------------------------------------------------------------
# 真实 OA HTML 结构片段（脱胎于 2026-09-11 抓包：序号后有空 td、跨设备同日两行）
# ---------------------------------------------------------------------------

OA_HTML = """<table class="table"><thead><tr><th>序号</th><th>数据来源</th><th>人员编号</th>
<th>所属部门</th><th>姓名</th><th>打卡日期</th><th>打卡时间</th></tr></thead><tbody>
<tr rel="sds" id="trid">
	<td class="view-item txtc" style="width:40px;">1</td>

	<td class="view-item txtl">鹭燕总部大厦7楼</td>
	<td class="view-item txtl">gyqiang</td>
	<td class="view-item txtl">信息管理部</td>
	<td class="view-item txtl">高永强</td>
	<td class="view-item txtl">2026-09-10</td>
	<td class="view-item txtl">12:22</td>
</tr>
<tr rel="sds" id="trid">
	<td class="view-item txtc" style="width:40px;">2</td>

	<td class="view-item txtl">鹭燕总部大楼1楼</td>
	<td class="view-item txtl">gyqiang</td>
	<td class="view-item txtl">信息管理部</td>
	<td class="view-item txtl">高永强</td>
	<td class="view-item txtl">2026-09-10</td>
	<td class="view-item txtl">07:57,12:30,17:32</td>
</tr>
<tr rel="sds" id="trid">
	<td class="view-item txtc" style="width:40px;">3</td>

	<td class="view-item txtl">鹭燕总部大楼1楼</td>
	<td class="view-item txtl">gyqiang</td>
	<td class="view-item txtl">信息管理部</td>
	<td class="view-item txtl">高永强</td>
	<td class="view-item txtl">2026-09-09</td>
	<td class="view-item txtl">12:24,17:32</td>
</tr>
</tbody></table>
<tr><td class='td_table_bottom'><div>共 3 条</div></td></tr>
"""

LOGIN_HTML = """<!DOCTYPE html><html><head><title>登录</title></head>
<body><form id="loginForm" action="doLogin.do" method="post">
<input name="username"/><input name="password"/></form></body></html>"""


class TestParsePunchHtml(unittest.TestCase):
    def test_rows_and_total(self):
        rows, total = parse_punch_html(OA_HTML)
        self.assertEqual(total, 3)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]["date"], "2026-09-10")
        self.assertEqual(rows[0]["times"], ["12:22"])
        self.assertEqual(rows[2]["times"], ["12:24", "17:32"])

    def test_login_page_raises(self):
        with self.assertRaises(TokenExpiredError):
            parse_punch_html(LOGIN_HTML)

    def test_empty_body_no_crash(self):
        # 无数据页：表格在但 tbody 空，total=0
        html = '<table><thead><tr><th>序号</th></tr></thead><tbody></tbody></table><div>共 0 条</div>'
        rows, total = parse_punch_html(html)
        self.assertEqual(rows, [])
        self.assertEqual(total, 0)

    def test_merge_same_day_multi_device(self):
        rows, _ = parse_punch_html(OA_HTML)
        dates = merge_punch_rows(rows)
        self.assertEqual(dates, {dt.date(2026, 9, 10), dt.date(2026, 9, 9)})


class TestClampRange(unittest.TestCase):
    def test_end_clamped_to_yesterday(self):
        today = dt.date(2026, 9, 11)
        s, e = clamp_range(dt.date(2026, 8, 1), dt.date(2026, 9, 11), today)
        self.assertEqual(e, dt.date(2026, 9, 10))
        self.assertEqual(s, dt.date(2026, 8, 1))

    def test_future_start_rejected(self):
        with self.assertRaises(ValueError):
            clamp_range(dt.date(2026, 10, 1), dt.date(2026, 10, 2), dt.date(2026, 9, 11))

    def test_start_after_end_rejected(self):
        with self.assertRaises(ValueError):
            clamp_range(dt.date(2026, 9, 10), dt.date(2026, 9, 1))


class TestWeekdayDates(unittest.TestCase):
    def test_weekend_excluded(self):
        # 2026-09-07(一) ~ 09-13(日)：7 天里 5 个工作日
        days = weekday_dates(dt.date(2026, 9, 7), dt.date(2026, 9, 13))
        self.assertEqual(len(days), 5)
        self.assertEqual(days[0], dt.date(2026, 9, 7))
        self.assertEqual(days[-1], dt.date(2026, 9, 11))


class TestAccumulate(unittest.TestCase):
    def test_creator_filter(self):
        records = [
            {"reportedAt": "2026-09-10", "duration": 3.5, "creator": "167"},
            {"reportedAt": "2026-09-10", "duration": 3.5, "creator": "167"},
            {"reportedAt": "2026-09-10", "duration": 2.0, "creator": "999"},  # 他人记录
        ]
        minutes = accumulate_records(records, "167")
        self.assertEqual(minutes, {dt.date(2026, 9, 10): 420})  # 7h 整，分钟整数化

    def test_float_noise_immunity(self):
        # 0.1 × 70 累加在浮点下不等于 7，整数化到分钟后必须判满
        records = [{"reportedAt": "2026-09-10", "duration": 0.1, "creator": "167"} for _ in range(70)]
        minutes = accumulate_records(records, "167")
        self.assertEqual(minutes[dt.date(2026, 9, 10)], 420)


class TestClassify(unittest.TestCase):
    def test_full_picture(self):
        # 9/7(一)~9/11(五) 5 个工作日；打卡 9/7,9/9,9/10；工时 9/7=7h、9/9=6.98h、9/10=0
        punch = {dt.date(2026, 9, 7), dt.date(2026, 9, 9), dt.date(2026, 9, 10)}
        day_minutes = {
            dt.date(2026, 9, 7): 420,
            dt.date(2026, 9, 9): 419,   # 6.98h → 未填满缺口 0.02h
            dt.date(2026, 9, 10): 0,
        }
        r = classify(dt.date(2026, 9, 7), dt.date(2026, 9, 11), punch, day_minutes)
        s = r["summary"]
        self.assertEqual(s["calendar_workdays"], 5)
        self.assertEqual(s["attendance_days"], 3)
        self.assertEqual(s["ok_days"], 1)
        self.assertEqual(s["underfilled_days"], 1)
        self.assertEqual(s["unfilled_days"], 1)
        self.assertEqual(r["unfilled"], ["2026-09-10"])
        self.assertEqual(r["underfilled"][0]["date"], "2026-09-09")
        self.assertLess(abs(r["underfilled"][0]["gap_hours"] - 0.02), 1e-9)
        # 兜底：9/8、9/11 工作日无打卡
        self.assertEqual(r["safety_net"]["calendar_workday_without_punch"], ["2026-09-08", "2026-09-11"])

    def test_workload_without_punch_surfaces(self):
        # 9/8 填了工时但没打卡 → 兜底清单 workload_without_punch 浮出（忘打卡嫌疑）
        punch = {dt.date(2026, 9, 7)}
        day_minutes = {dt.date(2026, 9, 8): 420}
        r = classify(dt.date(2026, 9, 7), dt.date(2026, 9, 11), punch, day_minutes)
        self.assertEqual(r["safety_net"]["workload_without_punch"], ["2026-09-08"])

    def test_weekend_punch_separate(self):
        # 9/12(六) 打卡不进工作日判定，单列 weekend_punch_days
        punch = {dt.date(2026, 9, 7), dt.date(2026, 9, 12)}
        day_minutes = {dt.date(2026, 9, 7): 420}
        r = classify(dt.date(2026, 9, 7), dt.date(2026, 9, 13), punch, day_minutes)
        self.assertEqual(r["weekend_punch_days"], ["2026-09-12"])
        self.assertEqual(r["summary"]["attendance_days"], 1)

    def test_saturday_punch_with_workload_not_in_unfilled(self):
        # 周六填了 3h：不算未填满（不是应填日），也不算 workload_without_punch（不是工作日）
        punch = {dt.date(2026, 9, 7), dt.date(2026, 9, 12)}
        day_minutes = {dt.date(2026, 9, 7): 420, dt.date(2026, 9, 12): 180}
        r = classify(dt.date(2026, 9, 7), dt.date(2026, 9, 13), punch, day_minutes)
        self.assertEqual(r["summary"]["underfilled_days"], 0)
        self.assertEqual(r["summary"]["unfilled_days"], 0)
        self.assertEqual(r["safety_net"]["workload_without_punch"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
