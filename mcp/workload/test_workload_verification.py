"""本机验证码服务的真实 HTTP、取消和过期行为。"""

import io
import json
import queue
import unittest
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image
from workload_security import CancelledError, CaptchaRejected, RunContext, WorkloadError
from workload_verification import ManualVerifier


def challenge():
    buffer = io.BytesIO()
    Image.new("RGB", (145, 50), "white").save(buffer, "PNG")
    return {"kind": "text", "image": buffer.getvalue(), "_token": "never-public"}


def request(url, path="api/state", body=None, origin=None):
    headers = {}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers = {
            "Content-Type": "application/json",
            "Origin": origin
            or urllib.parse.urlsplit(url)
            ._replace(path="", query="", fragment="")
            .geturl(),
        }
    with urllib.request.urlopen(
        urllib.request.Request(url + path, data=data, headers=headers), timeout=3
    ) as response:
        return json.loads(response.read())


class TestManualVerification(unittest.TestCase):
    def start(self, submit, *, timeout=3):
        urls = queue.Queue()
        context = RunContext()
        verifier = ManualVerifier(
            context,
            timeout_seconds=timeout,
            open_browser=lambda url: urls.put(url) or True,
        )
        pool = ThreadPoolExecutor(max_workers=1)
        self.addCleanup(pool.shutdown)
        self.addCleanup(context.cancelled.set)
        future = pool.submit(verifier.solve, "OA 系统", challenge, submit)
        url = urls.get(timeout=3)
        return url, future, context

    def test_success_returns_secret_only_to_python_caller(self):
        url, future, _ = self.start(lambda image, answer: "private-auth-token")
        state = request(url)
        self.assertNotIn("never-public", json.dumps(state))
        self.assertEqual(state["kind"], "text")
        reply = request(
            url, "api/submit", {"generation": state["generation"], "answer": "a3bc"}
        )
        self.assertEqual(reply["status"], "completed")
        self.assertNotIn("private-auth-token", json.dumps(reply))
        self.assertEqual(future.result(timeout=3), "private-auth-token")

    def test_wrong_answer_can_refresh_without_changing_deadline(self):
        attempts = []

        def submit(image, answer):
            attempts.append(answer)
            if answer == "wrong":
                raise CaptchaRejected("验证码不正确")
            return "valid"

        url, future, _ = self.start(submit)
        state = request(url)
        reply = request(
            url, "api/submit", {"generation": state["generation"], "answer": "wrong"}
        )
        self.assertEqual(reply["status"], "waiting")
        refreshed = request(url, "api/refresh", {})
        self.assertNotEqual(refreshed["generation"], state["generation"])
        self.assertLessEqual(refreshed["remaining_seconds"], state["remaining_seconds"])
        request(
            url, "api/submit", {"generation": refreshed["generation"], "answer": "a3bc"}
        )
        self.assertEqual(future.result(timeout=3), "valid")

    def test_old_image_and_external_origin_are_rejected(self):
        url, future, _ = self.start(lambda image, answer: "valid")
        state = request(url)
        request(url, "api/refresh", {})
        with self.assertRaises(urllib.error.HTTPError) as stale:
            request(
                url, "api/submit", {"generation": state["generation"], "answer": "a3bc"}
            )
        self.assertEqual(stale.exception.code, 409)
        with self.assertRaises(urllib.error.HTTPError) as external:
            request(url, "api/cancel", {}, origin="https://example.org")
        self.assertEqual(external.exception.code, 403)
        request(url, "api/cancel", {})
        with self.assertRaises(CancelledError):
            future.result(timeout=3)

    def test_cancel_ends_original_operation(self):
        url, future, context = self.start(lambda image, answer: "valid")
        request(url, "api/cancel", {})
        with self.assertRaises(CancelledError):
            future.result(timeout=3)
        self.assertTrue(context.cancelled.is_set())

    def test_timeout_is_bounded(self):
        _, future, _ = self.start(lambda image, answer: "valid", timeout=0.15)
        with self.assertRaisesRegex(WorkloadError, "超时"):
            future.result(timeout=2)

    def test_mcp_cancellation_closes_verification(self):
        _, future, context = self.start(lambda image, answer: "valid")
        context.cancelled.set()
        with self.assertRaises(CancelledError):
            future.result(timeout=3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
