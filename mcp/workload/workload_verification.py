"""有时限的本机验证码接管；网页登录信息始终留在 Python 进程。"""

from __future__ import annotations

import base64
import io
import json
import logging
import math
import secrets
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from workload_security import CancelledError, CaptchaRejected, RunContext, WorkloadError

ASSETS = Path(__file__).parent
MANUAL_TIMEOUT_SECONDS = 300


class _BadRequest(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def _image(raw):
    from PIL import Image

    image = Image.open(io.BytesIO(raw))
    mime = "image/jpeg" if image.format == "JPEG" else "image/png"
    return f"data:{mime};base64," + base64.b64encode(raw).decode(), image.size


class _Verification:
    def __init__(self, system, factory, submit, context, timeout):
        self.system, self.factory, self.submit = system, factory, submit
        self.context = context
        self.deadline = time.monotonic() + timeout
        self.done = threading.Event()
        self.action_lock = threading.Lock()
        self.state_lock = threading.RLock()
        self.status = "waiting"
        self.message = ""
        self.result = None
        self.error = None
        self.challenge = None
        self.generation = ""
        self.refresh()

    def check(self):
        self.context.check()
        if time.monotonic() >= self.deadline:
            raise WorkloadError("验证码等待超时，本次统计已结束，请重新发起统计")

    def refresh(self):
        self.check()
        challenge = self.factory()
        self.check()
        with self.state_lock:
            self.challenge = challenge
            self.generation = secrets.token_urlsafe(12)
            self.message = ""

    def state(self):
        with self.state_lock:
            result = {
                "system": self.system,
                "status": self.status,
                "message": self.message,
                "generation": self.generation,
                "remaining_seconds": math.ceil(
                    max(0, self.deadline - time.monotonic())
                ),
                "kind": self.challenge["kind"],
            }
            if self.challenge["kind"] == "text":
                result["image"], _ = _image(self.challenge["image"])
            else:
                result["background"], size = _image(self.challenge["background"])
                result["piece"], tile_size = _image(self.challenge["piece"])
                result.update(width=size[0], height=size[1], piece_width=tile_size[0])
            return result

    def answer(self, payload):
        self.check()
        if payload.get("generation") != self.generation:
            raise _BadRequest(409, "验证码已刷新，请使用当前图片")
        try:
            result = self.submit(self.challenge, payload.get("answer"))
        except CaptchaRejected as exc:
            self.refresh()
            with self.state_lock:
                self.message = str(exc)
            return self.state()
        self.check()
        with self.state_lock:
            self.result = result
            self.status = "completed"
            self.message = "验证完成，工时统计将继续。可以关闭此页面。"
        return {"status": "completed", "message": self.message}

    def fail(self, error):
        with self.state_lock:
            self.error = error
            self.status = "cancelled" if isinstance(error, CancelledError) else "failed"
            self.message = str(error)


def _handler(session, prefix):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Workload"
        sys_version = ""

        def log_message(self, format, *args):
            # 默认访问日志会记录一次性验证地址，故不生成访问日志。
            return

        def write_response(
            self, code, payload, content_type="application/json; charset=utf-8"
        ):
            raw = (
                payload
                if isinstance(payload, bytes)
                else json.dumps(payload, ensure_ascii=False).encode()
            )
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            )
            self.end_headers()
            try:
                self.wfile.write(raw)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                logging.getLogger(__name__).debug("验证码页面连接已断开")

        def route(self, require_origin=False):
            host = f"127.0.0.1:{self.server.server_port}"
            if self.headers.get("Host") != host:
                raise _BadRequest(403, "不允许的请求地址")
            if require_origin and self.headers.get("Origin") != "http://" + host:
                raise _BadRequest(403, "不允许的请求来源")
            path = urllib.parse.urlsplit(self.path).path
            if not path.startswith(prefix):
                raise _BadRequest(404, "验证页面不存在或已失效")
            return path[len(prefix) :]

        def do_GET(self):
            try:
                route = self.route()
                if route == "api/state":
                    self.write_response(200, session.state())
                    return
                files = {
                    "": ("verification.html", "text/html; charset=utf-8"),
                    "verification.css": ("verification.css", "text/css; charset=utf-8"),
                    "verification.js": (
                        "verification.js",
                        "text/javascript; charset=utf-8",
                    ),
                }
                if route not in files:
                    raise _BadRequest(404, "页面不存在")
                name, content_type = files[route]
                self.write_response(200, (ASSETS / name).read_bytes(), content_type)
            except _BadRequest as exc:
                self.write_response(exc.status, {"message": exc.message})
            except OSError:
                self.write_response(
                    500, {"message": "验证码页面资源缺失，请重新安装工具"}
                )

        def do_POST(self):
            locked = False
            try:
                route = self.route(require_origin=True)
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    raise _BadRequest(400, "请求格式不正确") from None
                if not 0 < length <= 4096:
                    raise _BadRequest(400, "请求内容大小不正确")
                try:
                    payload = json.loads(self.rfile.read(length))
                except (ValueError, UnicodeError):
                    raise _BadRequest(400, "请求格式不正确") from None
                if not isinstance(payload, dict):
                    raise _BadRequest(400, "请求格式不正确")
                if route == "api/cancel":
                    session.context.cancelled.set()
                    session.fail(CancelledError("已取消验证，本次统计已结束"))
                    self.write_response(
                        200, {"status": "cancelled", "message": session.message}
                    )
                    return
                if route not in ("api/refresh", "api/submit"):
                    raise _BadRequest(404, "操作不存在")
                locked = session.action_lock.acquire(blocking=False)
                if not locked:
                    raise _BadRequest(409, "正在处理上一项验证，请稍候")
                if session.status != "waiting":
                    raise _BadRequest(410, "本次验证已结束")
                session.check()
                if route == "api/refresh":
                    session.refresh()
                    reply = session.state()
                else:
                    reply = session.answer(payload)
                self.write_response(200, reply)
            except _BadRequest as exc:
                self.write_response(exc.status, {"message": exc.message})
            except WorkloadError as exc:
                session.fail(exc)
                self.write_response(
                    200, {"status": session.status, "message": session.message}
                )
            except Exception as exc:  # noqa: BLE001 — HTTP 边界须结束等待，不向浏览器泄露异常内容
                logging.getLogger(__name__).error(
                    "验证码服务异常：%s", type(exc).__name__
                )
                session.fail(WorkloadError("验证码服务遇到错误，请重新发起统计"))
                self.write_response(
                    500, {"status": "failed", "message": session.message}
                )
            finally:
                if locked:
                    session.action_lock.release()
                if session.status != "waiting":
                    session.done.set()

    return Handler


class ManualVerifier:
    def __init__(
        self,
        context: RunContext,
        *,
        timeout_seconds=MANUAL_TIMEOUT_SECONDS,
        open_browser=None,
    ):
        self.context = context
        self.timeout = timeout_seconds
        self.open_browser = open_browser or (lambda url: webbrowser.open(url, new=1))

    def solve(self, system, factory, submit):
        session = _Verification(system, factory, submit, self.context, self.timeout)
        prefix = "/" + secrets.token_urlsafe(32) + "/"
        server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(session, prefix))
        server.daemon_threads = True
        thread = threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}{prefix}"
        notice = {"system": system, "url": url, "timeout_seconds": self.timeout}
        try:
            self.context.notify(notice)
            try:
                opened = self.open_browser(url)
            except OSError:
                opened = False
            if not opened:
                self.context.notify(
                    {**notice, "message": "浏览器未能自动打开，请点击验证链接"}
                )
            while not session.done.wait(0.05):
                session.check()
            if session.error:
                raise session.error
            self.context.check()
            return session.result
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=1)
            self.context.notify(None)
