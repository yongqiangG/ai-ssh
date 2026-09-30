"""任务列表查询与工时提交的纯逻辑回归；网络与真实账号隔离。

覆盖决议（见 vault 工作/ai-ssh/需求/需求-工时统计MCP.md）：
- 查询：state=IN_PROGRESS 全量、字段完整透出、不做年份过滤。
- 提交：number 严格唯一命中、最晚今天（未来拒绝）、duration 0.1 步进、
  预检负剩余拒发（duration=0.1 补报豁免，用于满额任务触发流转）、
  description=html.escape(标题)、type/overtime 固定、
  code==0 即成功、异常即停不吞错。
"""

import datetime as dt
import unittest
from unittest.mock import Mock

from test_workload_auth import config
from workload_auth import ProjectSession
from workload_mcp import (
    ProjClient,
    list_tasks_arguments,
    submit_arguments,
)
from workload_security import WorkloadError


def task(number="SYSCCG-1821", **overrides):
    base = {
        "id": "2095826220573782266",
        "number": number,
        "title": "[后端] 组合商品病症提交",
        "state": "IN_PROGRESS",
        "estimatedWorkload": 7.0,
        "reportedWorkload": 0.0,
        "remainingWorkload": 7.0,
        "headUsername": "高永强",
        "createTime": 1788518884000,
    }
    base.update(overrides)
    return base


class ListTasksTests(unittest.TestCase):
    def setUp(self):
        self.session = Mock()
        self.session.get.return_value = {
            "list": [task(), task("KJSC-1038", id="11", createTime=1760169600000)],
            "total": 2,
        }
        self.client = ProjClient(self.session)

    def test_passes_state_filter_and_keeps_all_fields(self):
        rows = self.client.fetch_in_progress_tasks()
        path = self.session.get.call_args.args[0]
        params = self.session.get.call_args.args[1]
        self.assertEqual(path, "/proj-ms/work_item/page-for-workload")
        self.assertEqual(params["state"], "IN_PROGRESS")
        self.assertEqual(params["type"], 4)
        self.assertEqual([r["number"] for r in rows], ["SYSCCG-1821", "KJSC-1038"])

    def test_arguments_reject_unknown_fields(self):
        with self.assertRaises(WorkloadError):
            list_tasks_arguments({"state": "DONE"})


class ListTasksNumberLookupTests(unittest.TestCase):
    """可选 number：不限状态回查任务——提交后任务可能流转出 IN_PROGRESS（COMPLETED）。"""

    def setUp(self):
        self.session = Mock()
        self.session.get.return_value = {
            "list": [
                task(
                    number="FXZT-237",
                    id="2105122034845585410",
                    state="COMPLETED",
                    reportedWorkload=4.0,
                    remainingWorkload=0.0,
                ),
                task(),
            ],
            "total": 2,
        }
        self.client = ProjClient(self.session)

    def test_lookup_drops_state_filter(self):
        rows = self.client.fetch_tasks_by_number("FXZT-237")
        params = self.session.get.call_args.args[1]
        self.assertNotIn("state", params)
        self.assertEqual(params["type"], 4)
        self.assertEqual([r["state"] for r in rows], ["COMPLETED"])

    def test_lookup_unknown_number_returns_empty(self):
        self.assertEqual(self.client.fetch_tasks_by_number("X-1"), [])

    def test_arguments_accept_optional_number_stripped(self):
        self.assertEqual(list_tasks_arguments({}), {})
        self.assertEqual(
            list_tasks_arguments({"number": " FXZT-237 "}), {"number": "FXZT-237"}
        )

    def test_arguments_reject_bad_number(self):
        for bad in ("", "   ", 123, True, None):
            with (
                self.subTest(bad=bad),
                self.assertRaises(WorkloadError),
            ):
                list_tasks_arguments({"number": bad})


class SubmitArgumentsTests(unittest.TestCase):
    def today(self):
        return dt.date(2026, 9, 30)

    def valid(self, **overrides):
        args = {
            "number": "SYSCCG-1821",
            "date": "2026-09-28",
            "duration": 7,
            "description": "[后端] 组合商品病症提交",
        }
        args.update(overrides)
        return submit_arguments(args, today=self.today())

    def test_minimal_valid(self):
        args = self.valid()
        self.assertEqual(args["number"], "SYSCCG-1821")
        self.assertEqual(args["date"], "2026-09-28")
        self.assertEqual(args["duration"], 7.0)
        self.assertEqual(args["description"], "[后端] 组合商品病症提交")

    def test_description_required_and_stripped(self):
        # 必填：缺失/空白/非字符串均拒；传入则 strip 归一
        for bad in (None, "", "   ", 123, True):
            with (
                self.subTest(bad=bad),
                self.assertRaisesRegex(WorkloadError, "description"),
            ):
                self.valid(description=bad)
        self.assertEqual(
            self.valid(description="  [后端] 组合商品病症提交  ")["description"],
            "[后端] 组合商品病症提交",
        )

    def test_accepts_today_rejects_future(self):
        # 今天放行（决议 26：当天随手记工时；统计侧仍只到昨天，口径分离）
        self.assertEqual(self.valid(date="2026-09-30")["date"], "2026-09-30")
        for bad in ("2026-10-01", "2026-12-31"):
            with (
                self.subTest(bad=bad),
                self.assertRaisesRegex(WorkloadError, "未来"),
            ):
                self.valid(date=bad)

    def test_rejects_bad_duration_steps(self):
        for bad in (0, -1, 0.05, 7.25, "7", True):
            with (
                self.subTest(bad=bad),
                self.assertRaises(WorkloadError),
            ):
                self.valid(duration=bad)

    def test_accepts_tenth_hour_duration_and_normalizes(self):
        # 0.1 步进：0.1/0.2/0.7 合法；浮点尾数归一到一位小数
        for good, expected in ((0.1, 0.1), (0.2, 0.2), (0.7, 0.7), (6.5, 6.5)):
            with self.subTest(good=good):
                self.assertEqual(self.valid(duration=good)["duration"], expected)
        self.assertEqual(self.valid(duration=0.30000000000000004)["duration"], 0.3)

    def test_rejects_unknown_fields_and_bad_date(self):
        for overrides in (
            {"extra": 1},
            {"date": "20260928"},
            {"description": None, "number": "X"},
        ):
            args = {
                "number": "SYSCCG-1821",
                "date": "2026-09-28",
                "duration": 7,
            }
            args.update(overrides)
            with (
                self.subTest(args=args),
                self.assertRaises(WorkloadError),
            ):
                submit_arguments(args, today=self.today())


class SubmitWorkloadTests(unittest.TestCase):
    def setUp(self):
        self.session = Mock()
        self.session.get.return_value = {
            "list": [task()],
            "total": 1,
        }
        self.session.post_json.return_value = {"code": 0, "data": True}
        self.client = ProjClient(self.session)

    def submit(
        self,
        duration=7,
        number="SYSCCG-1821",
        date="2026-09-28",
        description="[后端] 组合商品病症提交",
    ):
        return self.client.submit_workload(
            number, date, duration, description, today=dt.date(2026, 9, 30)
        )

    def test_description_mismatch_rejected_before_write(self):
        # 回显校验：description 必须等于任务真实标题（strip 后精确匹配），
        # 不符即拒且不发写入请求——卡片展示 = 将写入内容的硬保证。
        with self.assertRaisesRegex(WorkloadError, "标题不一致"):
            self.submit(description="[后端] 组合商品中药开方")
        self.session.post_json.assert_not_called()

    def test_description_mismatch_error_includes_real_title(self):
        # 报错带真实标题，AI 可自愈：重读错误即得正确值，无需再查列表。
        with self.assertRaisesRegex(WorkloadError, r"组合商品病症提交"):
            self.submit(description="编造的标题")

    def test_description_stripped_before_compare(self):
        result = self.submit(description="  [后端] 组合商品病症提交  ")
        self.assertEqual(result["duration"], 7.0)

    def test_happy_path_payload(self):
        result = self.submit()
        path, payload = (
            self.session.post_json.call_args.args[0],
            self.session.post_json.call_args.args[1],
        )
        self.assertEqual(path, "/proj-ms/workload-record/create")
        self.assertEqual(payload["workItemId"], "2095826220573782266")
        self.assertEqual(payload["duration"], "7")
        self.assertEqual(payload["remainingWorkload"], 0)
        self.assertEqual(payload["type"], "DEVELOP")
        self.assertIs(payload["overtime"], False)
        self.assertEqual(payload["reportedAt"], "2026-09-28")
        self.assertEqual(payload["description"], "<p>[后端] 组合商品病症提交</p>")
        self.assertEqual(
            result,
            {
                "number": "SYSCCG-1821",
                "title": "[后端] 组合商品病症提交",
                "date": "2026-09-28",
                "duration": 7.0,
                "remaining_after": 0.0,
            },
        )

    def test_partial_fill_computes_remaining_from_reported(self):
        self.session.get.return_value = {
            "list": [task(reportedWorkload=4.0, remainingWorkload=3.0)],
            "total": 1,
        }
        result = self.submit(duration=2)
        payload = self.session.post_json.call_args.args[1]
        self.assertEqual(payload["remainingWorkload"], 1)
        self.assertEqual(result["remaining_after"], 1.0)

    def test_over_remaining_rejected_before_any_write(self):
        self.session.get.return_value = {
            "list": [task(reportedWorkload=4.0, remainingWorkload=3.0)],
            "total": 1,
        }
        with self.assertRaisesRegex(WorkloadError, "剩余"):
            self.submit(duration=4)
        self.session.post_json.assert_not_called()

    def test_zero_or_negative_remaining_rejected(self):
        self.session.get.return_value = {
            "list": [task(reportedWorkload=7.0, remainingWorkload=0.0)],
            "total": 1,
        }
        with self.assertRaisesRegex(WorkloadError, "剩余"):
            self.submit(duration=1)
        self.session.post_json.assert_not_called()

    def test_tenth_hour_topup_bypasses_remaining_check(self):
        # 0.1h 补报口令：满额任务（剩余 0）也放行，remainingWorkload 写 0 触发流转
        # （实测写负数服务端照存但任务不流转，SYSCCG-1135 首试确证）
        self.session.get.return_value = {
            "list": [task(reportedWorkload=7.0, remainingWorkload=0.0)],
            "total": 1,
        }
        result = self.submit(duration=0.1)
        payload = self.session.post_json.call_args.args[1]
        self.assertEqual(payload["duration"], "0.1")
        self.assertEqual(payload["remainingWorkload"], 0)
        self.assertEqual(result["remaining_after"], 0.0)

    def test_tenth_hour_topup_on_nonfull_task_keeps_real_math(self):
        # 非满额任务用 0.1h：正常扣减，不钳位（remaining 0.5 → 0.4）
        self.session.get.return_value = {
            "list": [task(reportedWorkload=6.5, remainingWorkload=0.5)],
            "total": 1,
        }
        result = self.submit(duration=0.1)
        payload = self.session.post_json.call_args.args[1]
        self.assertEqual(payload["remainingWorkload"], 0.4)
        self.assertEqual(result["remaining_after"], 0.4)

    def test_non_tenth_topup_still_rejected_when_full(self):
        # 豁免只认 0.1：满额任务补 0.2/0.5 照旧拒绝
        self.session.get.return_value = {
            "list": [task(reportedWorkload=7.0, remainingWorkload=0.0)],
            "total": 1,
        }
        for bad in (0.2, 0.5):
            with self.subTest(bad=bad), self.assertRaisesRegex(WorkloadError, "剩余"):
                self.submit(duration=bad)
        self.session.post_json.assert_not_called()

    def test_unknown_number_rejected_with_no_write(self):
        with self.assertRaisesRegex(WorkloadError, "SYSCCG-9999"):
            self.submit(number="SYSCCG-9999")
        self.session.post_json.assert_not_called()

    def test_duplicate_number_rejected(self):
        self.session.get.return_value = {
            "list": [task(), task(id="2095826220573782267")],
            "total": 2,
        }
        with self.assertRaisesRegex(WorkloadError, "SYSCCG-1821"):
            self.submit()
        self.session.post_json.assert_not_called()

    def test_title_html_is_escaped(self):
        title = '<script>alert("x")</script>组合套餐'
        self.session.get.return_value = {
            "list": [task(title=title)],
            "total": 1,
        }
        self.submit(description=title)
        payload = self.session.post_json.call_args.args[1]
        self.assertEqual(
            payload["description"],
            "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;组合套餐</p>",
        )

    def test_server_error_stops_without_retry(self):
        # 会话层（ProjectSession.post_json）对 code!=0 抛 WorkloadError；
        # 这里断言 ProjClient 不吞错、不重试，单次调用即上抛。
        self.session.post_json.side_effect = WorkloadError("项目系统提交失败：服务繁忙")
        with self.assertRaisesRegex(WorkloadError, "服务繁忙"):
            self.submit()
        self.assertEqual(self.session.post_json.call_count, 1)

    def test_fraction_duration_allowed_and_serialized_cleanly(self):
        result = self.submit(duration=6.5)
        payload = self.session.post_json.call_args.args[1]
        self.assertEqual(payload["duration"], "6.5")
        self.assertEqual(result["remaining_after"], 0.5)


class SessionPostJsonTests(unittest.TestCase):
    """会话层写入：code!=0 单次即抛，不重试；401 恢复一次后重放。"""

    def setUp(self):
        import time
        from unittest.mock import Mock

        self.transport = Mock()
        self.session = ProjectSession(
            config(), Mock(), transport=self.transport, solver=Mock(), manual=Mock()
        )
        self.session.cfg.update(
            access_token="a",
            refresh_token="r",
            expires_time=int((time.time() + 1800) * 1000),
        )

    def test_business_error_raises_without_retry(self):
        self.transport.json.return_value = {"code": 500, "msg": "服务繁忙"}
        with self.assertRaisesRegex(WorkloadError, "服务繁忙"):
            self.session.post_json("/proj-ms/workload-record/create", {})
        self.assertEqual(self.transport.json.call_count, 1)

    def test_401_recovers_once_then_replays(self):
        from test_workload_auth import tokens

        self.transport.json.side_effect = [
            {"code": 401, "msg": "账号未登录"},
            {"code": 0, "data": tokens()},
            {"code": 0, "data": True},
        ]
        self.assertEqual(
            self.session.post_json("/proj-ms/workload-record/create", {"x": 1}), True
        )
        self.assertEqual(self.transport.json.call_count, 3)


class ToolsRegistrationTests(unittest.TestCase):
    def test_new_tools_registered(self):
        from workload_mcp import TOOLS

        names = {t["name"] for t in TOOLS}
        self.assertIn("list_work_tasks", names)
        self.assertIn("submit_workload", names)

    def test_run_submit_workload_forwards_description(self):
        # 入口级断链防再漏：run_submit_workload 必须把 description 传给
        # client.submit_workload（曾漏传导致 MCP 入口永远走必填校验拒绝）。
        from unittest.mock import patch

        import workload_mcp as m

        captured = {}

        class _FakeClient:
            def submit_workload(self, number, date, duration, description=""):
                captured.update(
                    number=number,
                    date=date,
                    duration=duration,
                    description=description,
                )
                return {"ok": True}

        with patch.object(m, "_project_client", return_value=(_FakeClient(), {})):
            result = m.run_submit_workload(
                {
                    "number": "SYSCCG-1821",
                    "date": "2026-09-28",
                    "duration": 7,
                    "description": "[后端] 组合商品病症提交",
                }
            )
        self.assertEqual(result, {"ok": True})
        self.assertEqual(captured["description"], "[后端] 组合商品病症提交")
        self.assertEqual(captured["duration"], 7)

    def test_tool_schema_submit_requires_four_fields(self):
        from workload_mcp import TOOLS

        submit = next(t for t in TOOLS if t["name"] == "submit_workload")
        self.assertEqual(
            set(submit["inputSchema"]["required"]),
            {"number", "date", "duration", "description"},
        )
        self.assertEqual(
            submit["inputSchema"]["properties"]["description"]["type"], "string"
        )

    def test_tool_schema_list_allows_optional_number(self):
        from workload_mcp import TOOLS

        listing = next(t for t in TOOLS if t["name"] == "list_work_tasks")
        self.assertEqual(listing["inputSchema"].get("required", []), [])
        self.assertIn("number", listing["inputSchema"]["properties"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
