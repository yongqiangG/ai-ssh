"""MCP 后台任务必须在人工验证后接续，且只返回完整报告。"""

import threading
import unittest

from workload_jobs import ReportJobs
from workload_security import WorkloadError


class TestReportJobs(unittest.TestCase):
    def test_manual_verification_resumes_original_query(self):
        entered, proceed = threading.Event(), threading.Event()
        arguments = {"start_date": "2026-09-01", "end_date": "2026-09-11"}

        def runner(args, context):
            context.notify(
                {
                    "system": "OA",
                    "url": "http://127.0.0.1:1234/test/",
                    "timeout_seconds": 300,
                }
            )
            entered.set()
            proceed.wait(2)
            context.check()
            context.notify(None)
            return {"range": args, "summary": {"ok_days": 1}}

        jobs = ReportJobs(runner)
        self.addCleanup(jobs.close)
        self.addCleanup(proceed.set)
        started = jobs.start(arguments, wait_seconds=0)
        self.assertTrue(entered.wait(2))
        pending = jobs.get(started["task_id"], wait_seconds=0)
        self.assertEqual(pending["status"], "awaiting_verification")
        self.assertNotIn("report", pending)
        self.assertEqual(
            jobs.start(arguments, wait_seconds=0)["task_id"], started["task_id"]
        )
        with self.assertRaises(WorkloadError):
            jobs.start({"start_date": "another"}, wait_seconds=0)
        proceed.set()
        finished = jobs.get(started["task_id"], wait_seconds=2)
        self.assertEqual(finished["status"], "completed")
        self.assertEqual(finished["report"]["range"], arguments)

    def test_cancel_reaches_worker(self):
        def runner(args, context):
            context.cancelled.wait(2)
            context.check()

        jobs = ReportJobs(runner)
        self.addCleanup(jobs.close)
        started = jobs.start({}, wait_seconds=0)
        jobs.cancel(started["task_id"])
        finished = jobs.get(started["task_id"], wait_seconds=2)
        self.assertEqual(finished["status"], "cancelled")
        self.assertNotIn("report", finished)

    def test_errors_never_produce_partial_reports(self):
        def runner(args, context):
            raise WorkloadError("OA 无法连接")

        jobs = ReportJobs(runner)
        self.addCleanup(jobs.close)
        result = jobs.start({}, wait_seconds=1)
        self.assertEqual(result["status"], "failed")
        self.assertNotIn("report", result)

    def test_unexpected_error_does_not_echo_credentials(self):
        def runner(args, context):
            raise ValueError("private-password")

        jobs = ReportJobs(runner)
        self.addCleanup(jobs.close)
        result = jobs.start({}, wait_seconds=1)
        self.assertNotIn("private-password", str(result))

    def test_wait_limit_and_unknown_id_are_rejected(self):
        jobs = ReportJobs(lambda args, context: {})
        self.addCleanup(jobs.close)
        result = jobs.start({}, wait_seconds=1)
        with self.assertRaises(WorkloadError):
            jobs.get(result["task_id"], wait_seconds=999)
        with self.assertRaises(WorkloadError):
            jobs.get("unknown", wait_seconds=0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
