"""报告接线与 CLI/MCP 协议回归；网络和真实账号均隔离。"""

import contextlib
import datetime as dt
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import workload_mcp as app
from test_workload_auth import config
from test_workload_mcp import OA_HTML
from workload_security import CancelledError, CredentialStore, RunContext, WorkloadError


class TestReportIntegration(unittest.TestCase):
    def test_report_uses_authenticated_identity_and_filters_every_detail(self):
        cfg = config()
        oa = Mock()
        oa.fetch_punch_rows.return_value = [
            {"date": "2026-09-10", "user_code": "oa-user", "times": ["08:00"]}
        ]
        project = Mock()
        project.current_user_id.return_value = "42"
        project.fetch_work_items.return_value = [{"id": 100}]
        project.fetch_workload_records.return_value = [
            {
                "creator": "42",
                "reportedAt": "2026-09-10",
                "duration": 7,
                "overtime": True,
            },
            {
                "creator": "99",
                "reportedAt": "2026-09-10",
                "duration": 9,
                "overtime": True,
            },
            {
                "creator": "42",
                "reportedAt": "2026-08-10",
                "duration": 8,
                "overtime": True,
            },
        ]
        report = app.build_report(
            cfg, "2026-09-10", "2026-09-10", True, oa=oa, proj=project
        )
        project.current_user_id.assert_called_once_with("project-user")
        self.assertEqual(report["summary"]["total_reported_hours"], 7)
        self.assertEqual(report["summary"]["ok_days"], 1)
        self.assertEqual(len(report["overtime_records"]), 1)
        self.assertEqual(report["detail"][0]["reported_hours"], 7)

    def test_project_identity_must_match_configured_account(self):
        session = Mock()
        session.get.return_value = {"user": {"id": 42, "username": "someone-else"}}
        with self.assertRaisesRegex(WorkloadError, "账号.*不一致"):
            app.ProjClient(session).current_user_id("project-user")

    def test_project_profile_supplies_username_when_permission_info_omits_it(self):
        session = Mock()
        session.get.side_effect = [
            {"user": {"id": 42, "nickname": "Example"}},
            {"id": 42, "username": "project-user"},
        ]
        self.assertEqual(app.ProjClient(session).current_user_id("project-user"), "42")

    def test_oa_rows_from_another_account_abort_the_report(self):
        session = Mock()
        session.post.return_value = OA_HTML
        oa = app.OaClient(session, "other-account")
        with self.assertRaisesRegex(WorkloadError, "账号.*不一致"):
            oa.fetch_punch_rows(dt.date(2026, 9, 9), dt.date(2026, 9, 10))

    def test_oa_unexpected_html_is_a_data_error_not_an_expired_token(self):
        with self.assertRaisesRegex(WorkloadError, "打卡.*格式") as raised:
            app.parse_punch_html("<html><h1>正在维护</h1></html>")
        self.assertNotIsInstance(raised.exception, app.TokenExpiredError)

    def test_project_missing_page_is_not_silently_accepted(self):
        session = Mock()
        session.get.side_effect = [
            {"list": [{"id": 1}], "total": 2},
            {"list": [], "total": 2},
        ]
        with self.assertRaisesRegex(WorkloadError, "不完整"):
            app.ProjClient(session).fetch_work_items()

    def test_cancelled_report_does_not_fetch_business_data(self):
        context = RunContext()
        context.cancelled.set()
        oa, project = Mock(), Mock()
        with self.assertRaises(CancelledError):
            app.build_report(
                config(),
                "2026-09-10",
                "2026-09-10",
                context=context,
                oa=oa,
                proj=project,
            )
        oa.fetch_punch_rows.assert_not_called()
        project.fetch_work_items.assert_not_called()

    def test_range_containing_only_today_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "已结束"):
            app.clamp_range(
                dt.date(2026, 9, 14), dt.date(2026, 9, 14), dt.date(2026, 9, 14)
            )

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI")
    def test_runner_loads_and_saves_the_selected_encrypted_store(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "selected.dat"
            CredentialStore(path).save(config())
            arguments = {
                "start_date": "2026-09-10",
                "end_date": "2026-09-10",
                "full_detail": False,
            }
            with patch.object(
                app, "build_report", return_value={"summary": "ok"}
            ) as build:
                self.assertEqual(
                    app.run_report(arguments, RunContext(), path), {"summary": "ok"}
                )
                self.assertEqual(build.call_args.args[0], config())
                self.assertEqual(build.call_args.kwargs["config_path"], path)


class TestCli(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows DPAPI")
    def test_stdin_setup_hides_input_when_run_in_a_terminal(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "credentials.dat"
            with (
                patch("sys.stdin.isatty", return_value=True),
                patch(
                    "workload_mcp.getpass.getpass", return_value=json.dumps(config())
                ) as hidden_input,
                patch(
                    "sys.stdin.readline",
                    side_effect=AssertionError("terminal input must not echo"),
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(
                    app.main(["setup", "--stdin", "--config", str(path)]), 0
                )
            hidden_input.assert_called_once()
            self.assertEqual(CredentialStore(path).load(), config())

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI")
    def test_setup_stdin_saves_only_credentials_and_discards_cached_tokens(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "credentials.dat"
            supplied = {**config(), "oa_token": "do-not-import", "creator_id": "99"}
            output = io.StringIO()
            with (
                patch("sys.stdin", io.StringIO(json.dumps(supplied) + "\n")),
                contextlib.redirect_stdout(output),
            ):
                self.assertEqual(
                    app.main(["setup", "--stdin", "--config", str(path)]), 0
                )
            self.assertEqual(CredentialStore(path).load(), config())
            for secret in ("oa-secret", "project-secret", "do-not-import"):
                self.assertNotIn(secret, output.getvalue())
                self.assertNotIn(secret.encode(), path.read_bytes())

    def test_report_requires_both_dates_before_loading_credentials(self):
        with (
            patch.object(app, "load_config") as load,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            with self.assertRaises(SystemExit) as raised:
                app.main(["report", "--start", "2026-09-10"])
            self.assertEqual(raised.exception.code, 2)
            load.assert_not_called()

    def test_serve_honors_config_option(self):
        with patch.object(app, "serve") as serve:
            self.assertEqual(app.main(["serve", "--config", "custom.dat"]), 0)
            serve.assert_called_once_with(Path("custom.dat"))


class TestMcpProtocol(unittest.TestCase):
    def test_cancel_tool_and_result_query_end_the_same_job(self):
        def runner(arguments, context):
            context.cancelled.wait(3)
            context.check()

        jobs = app.ReportJobs(runner)
        self.addCleanup(jobs.close)

        def call(name, arguments):
            response = app._handle(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": arguments},
                },
                jobs,
            )
            return json.loads(response["result"]["content"][0]["text"])

        started = call(
            "check_workload", {"start_date": "2026-09-10", "end_date": "2026-09-10"}
        )
        cancelled = call("cancel_workload", {"task_id": started["task_id"]})
        self.assertEqual(cancelled["task_id"], started["task_id"])
        result = call(
            "get_workload_result", {"task_id": started["task_id"], "wait_seconds": 2}
        )
        self.assertEqual(result["status"], "cancelled")
        self.assertNotIn("report", result)

    def exchange(self, messages, runner=None):
        source = io.StringIO("\n".join(json.dumps(item) for item in messages) + "\n")
        output = io.StringIO()
        with patch("sys.stdin", source), contextlib.redirect_stdout(output):
            app.serve(
                Path("selected.dat"), runner=runner or Mock(return_value={"ok": True})
            )
        return [json.loads(line) for line in output.getvalue().splitlines()]

    def test_initialize_tools_and_report_use_json_rpc_only(self):
        runner = Mock(return_value={"summary": {"ok_days": 1}})
        messages = [
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {"protocolVersion": "2024-11-05"},
            },
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "check_workload",
                    "arguments": {"start_date": "2026-09-10", "end_date": "2026-09-10"},
                },
            },
        ]
        replies = self.exchange(messages, runner)
        self.assertEqual([reply["id"] for reply in replies], [1, 2, 3])
        names = {tool["name"] for tool in replies[1]["result"]["tools"]}
        self.assertEqual(
            names, {"check_workload", "get_workload_result", "cancel_workload"}
        )
        result = json.loads(replies[2]["result"]["content"][0]["text"])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["report"], {"summary": {"ok_days": 1}})
        self.assertEqual(runner.call_args.args[0]["full_detail"], False)

    def test_invalid_tool_and_arguments_do_not_start_a_report(self):
        runner = Mock()
        cases = [
            {"name": "unknown", "arguments": {}},
            {
                "name": "check_workload",
                "arguments": {"start_date": "bad", "end_date": "2026-09-10"},
            },
            {
                "name": "check_workload",
                "arguments": {
                    "start_date": "2026-09-10",
                    "end_date": "2026-09-10",
                    "full_detail": "false",
                },
            },
            {"name": "get_workload_result", "arguments": {"task_id": []}},
        ]
        for case in cases:
            with self.subTest(case=case):
                reply = self.exchange(
                    [
                        {
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "tools/call",
                            "params": case,
                        }
                    ],
                    runner,
                )[0]
                self.assertTrue(reply["result"]["isError"])
        runner.assert_not_called()

    def test_malformed_json_and_request_receive_protocol_errors(self):
        source = io.StringIO('not-json\n[]\n{"jsonrpc":"2.0","id":4,"method":"ping"}\n')
        output = io.StringIO()
        with patch("sys.stdin", source), contextlib.redirect_stdout(output):
            app.serve(runner=Mock())
        replies = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(replies[0]["error"]["code"], -32700)
        self.assertEqual(replies[1]["error"]["code"], -32600)
        self.assertEqual(replies[2]["result"], {})

    def test_end_of_input_cancels_background_report(self):
        contexts = []

        def wait_for_cancel(arguments, context):
            contexts.append(context)
            context.cancelled.wait(5)
            context.check()

        replies = self.exchange(
            [
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "check_workload",
                        "arguments": {
                            "start_date": "2026-09-10",
                            "end_date": "2026-09-10",
                        },
                    },
                }
            ],
            wait_for_cancel,
        )
        self.assertTrue(contexts[0].cancelled.is_set())
        self.assertEqual(
            json.loads(replies[0]["result"]["content"][0]["text"])["status"], "running"
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
