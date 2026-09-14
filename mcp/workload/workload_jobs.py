"""MCP 长任务的最小运行状态：单任务执行，短请求查询结果。"""

from __future__ import annotations

import math
import threading
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field

from workload_security import CancelledError, RunContext, WorkloadError


@dataclass
class _Job:
    task_id: str
    arguments: dict
    context: RunContext = field(default_factory=RunContext)
    done: threading.Event = field(default_factory=threading.Event)
    status: str = "running"
    report: dict | None = None
    error: str | None = None
    verification: dict | None = None
    verification_started: float = 0
    thread: threading.Thread | None = None


class ReportJobs:
    def __init__(self, runner: Callable[[dict, RunContext], dict]):
        self.runner = runner
        self.jobs: OrderedDict[str, _Job] = OrderedDict()
        self.lock = threading.RLock()

    def start(self, arguments: dict, wait_seconds=1) -> dict:
        with self.lock:
            for active in self.jobs.values():
                if not active.done.is_set():
                    if active.arguments == arguments:
                        return self._snapshot(active)
                    raise WorkloadError("已有统计正在执行，请先查询结果或取消该任务")
            job = _Job(uuid.uuid4().hex, dict(arguments))
            job.context.on_verification = lambda state: self._verification(job, state)
            self.jobs[job.task_id] = job
            while len(self.jobs) > 8:
                self.jobs.popitem(last=False)
            job.thread = threading.Thread(target=self._run, args=(job,), daemon=True)
            job.thread.start()
        return self.get(job.task_id, wait_seconds=wait_seconds)

    def _verification(self, job, state):
        with self.lock:
            job.verification = state
            job.verification_started = time.monotonic()
            job.status = "awaiting_verification" if state else "running"

    def _run(self, job):
        try:
            report = self.runner(job.arguments, job.context)
            job.context.check()
            with self.lock:
                job.report, job.status = report, "completed"
        except CancelledError as exc:
            with self.lock:
                job.error, job.status = str(exc), "cancelled"
        except WorkloadError as exc:
            with self.lock:
                job.error, job.status = str(exc), "failed"
        except Exception as exc:  # noqa: BLE001 — 后台任务须回报失败，且不暴露异常中的凭据
            with self.lock:
                job.error = (
                    f"统计遇到未预期错误（{type(exc).__name__}），请检查安装或重试"
                )
                job.status = "failed"
        finally:
            with self.lock:
                job.verification = None
                job.done.set()

    def _snapshot(self, job):
        result = {"task_id": job.task_id, "status": job.status}
        if job.status == "completed":
            result["report"] = job.report
        elif job.error:
            result["error"] = job.error
        else:
            result["next_action"] = (
                "继续调用 get_workload_result 查询此 task_id，直至 completed、failed 或 cancelled；不要重新发起统计。"
            )
            if job.verification:
                result["verification"] = {
                    **job.verification,
                    "remaining_seconds": max(
                        0,
                        math.ceil(
                            job.verification["timeout_seconds"]
                            - (time.monotonic() - job.verification_started)
                        ),
                    ),
                }
                result["message"] = (
                    "需要人工完成验证码，已打开本机浏览器；完成后原统计会自动继续。"
                )
        return result

    def get(self, task_id: str, wait_seconds=20) -> dict:
        if (
            not isinstance(wait_seconds, (int, float))
            or not math.isfinite(wait_seconds)
            or not 0 <= wait_seconds <= 20
        ):
            raise WorkloadError("wait_seconds 必须在 0–20 秒之间")
        with self.lock:
            job = self.jobs.get(task_id)
            if job is None:
                raise WorkloadError("统计任务不存在或已被清理，请重新发起统计")
        job.done.wait(wait_seconds)
        with self.lock:
            return self._snapshot(job)

    def cancel(self, task_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(task_id)
            if job is None:
                raise WorkloadError("统计任务不存在")
            if not job.done.is_set():
                job.context.cancelled.set()
                job.status = "cancelling"
            return self._snapshot(job)

    def close(self):
        with self.lock:
            pending = [job for job in self.jobs.values() if not job.done.is_set()]
            for job in pending:
                job.context.cancelled.set()
        for job in pending:
            job.thread.join(timeout=1)
