"""两系统独立登录会话与有界授权恢复。"""

from __future__ import annotations

import base64
import http.cookiejar
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable

from workload_captcha import CaptchaSolver
from workload_security import (
    CaptchaRejected,
    HttpError,
    RunContext,
    WorkloadError,
    redact,
)

PROJECT_BASE = "http://10.10.10.135:48080/admin-api"
OA_BASE = "https://oapt.luyanpharm.com"
MAX_CAPTCHA_ATTEMPTS = 3
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36"


def is_login_page(html: str) -> bool:
    return bool(
        re.search(
            r"(?:name|id)=[\"\'](?:jlLoginName|loginForm)[\"\']", html, re.IGNORECASE
        )
    )


class HttpTransport:
    def __init__(self, base_url: str, system: str, context: RunContext | None = None):
        self.base_url = base_url.rstrip("/")
        self.system = system
        self.context = context or RunContext()
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )

    def binary(
        self, path: str, data=None, *, form=False, headers=None, method=None
    ) -> bytes:
        self.context.check()
        if path.startswith(("http:", "https:")):
            raise WorkloadError("请求路径必须相对系统地址")
        request_headers = {"User-Agent": USER_AGENT, **(headers or {})}
        body = None
        if data is not None:
            if form:
                body = urllib.parse.urlencode(data).encode()
                request_headers["Content-Type"] = "application/x-www-form-urlencoded"
            else:
                body = json.dumps(data, separators=(",", ":")).encode()
                request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.base_url + "/" + path.lstrip("/"),
            data=body,
            headers=request_headers,
            method=method,
        )
        safe_path = urllib.parse.urlsplit(path).path
        try:
            with self.opener.open(request, timeout=20) as response:
                result = response.read()
            self.context.check()
            return result
        except urllib.error.HTTPError as exc:
            raise HttpError(
                exc.code, f"{self.system} 请求失败（HTTP {exc.code}，{safe_path}）"
            ) from None
        except TimeoutError as exc:
            raise WorkloadError(f"{self.system} 请求超时，请检查网络后重试") from exc
        except (urllib.error.URLError, OSError) as exc:
            raise WorkloadError(f"无法连接{self.system}，请检查网络及系统地址") from exc

    def text(self, path: str, data=None, **kwargs) -> str:
        return self.binary(path, data, **kwargs).decode("utf-8", errors="replace")

    def json(self, path: str, data=None, **kwargs) -> dict:
        try:
            result = json.loads(self.text(path, data, **kwargs))
        except ValueError as exc:
            raise WorkloadError(
                f"{self.system} 返回了非 JSON 响应，请稍后重试"
            ) from exc
        if not isinstance(result, dict):
            raise WorkloadError(f"{self.system} 响应格式发生变化")
        return result


def _manual(context):
    from workload_verification import ManualVerifier

    return ManualVerifier(context)


class ProjectSession:
    def __init__(
        self,
        cfg: dict,
        save: Callable[[], None],
        *,
        transport=None,
        solver=None,
        manual=None,
        context=None,
    ):
        self.cfg, self.save = cfg, save
        self.context = context or RunContext()
        self.transport = transport or HttpTransport(
            PROJECT_BASE, "项目系统", self.context
        )
        self.solver = solver or CaptchaSolver()
        self.manual = manual if manual is not None else _manual(self.context)

    def _headers(self, authenticated=False) -> dict:
        headers = {"tenant-id": "1", "Accept": "application/json"}
        if authenticated:
            headers["Authorization"] = "Bearer " + self.cfg["access_token"]
        return headers

    def _apply(self, tokens: dict) -> None:
        if (
            not isinstance(tokens, dict)
            or not tokens.get("accessToken")
            or not tokens.get("refreshToken")
        ):
            raise WorkloadError("项目登录响应缺少令牌，请检查系统登录接口")
        self.context.check()
        self.cfg.update(
            access_token=tokens["accessToken"],
            refresh_token=tokens["refreshToken"],
            expires_time=tokens.get("expiresTime", 0),
        )
        if tokens.get("userId") is not None:
            self.cfg["creator_id"] = str(tokens["userId"])
        self.save()

    def _refresh(self) -> bool:
        refresh = self.cfg.get("refresh_token")
        if not refresh:
            return False
        try:
            result = self.transport.json(
                "/system/auth/refresh-token?refreshToken="
                + urllib.parse.quote(refresh, safe=""),
                method="POST",
                headers=self._headers(),
            )
        except HttpError as exc:
            if exc.status in (400, 401):
                return False
            raise
        if result.get("code") == 0:
            self._apply(result.get("data"))
            return True
        message = str(result.get("msg", ""))
        if result.get("code") == 401 or (
            "刷新令牌" in message
            and any(word in message for word in ("无效", "过期", "不存在"))
        ):
            return False
        raise WorkloadError("项目系统续期失败：" + redact(message, self.cfg))

    def _recover(self) -> None:
        self.context.check()
        if not self._refresh():
            self.login()

    def get(self, path: str, params: dict | None = None) -> dict:
        expiry = self.cfg.get("expires_time", 0)
        if (
            not self.cfg.get("access_token")
            or not isinstance(expiry, (int, float))
            or expiry <= (time.time() + 30) * 1000
        ):
            self._recover()
        if params:
            path += "?" + urllib.parse.urlencode(params)
        for attempt in range(2):
            try:
                result = self.transport.json(
                    path, headers=self._headers(authenticated=True)
                )
            except HttpError as exc:
                if exc.status != 401:
                    raise
                result = {"code": 401}
            if result.get("code") == 401:
                if attempt == 0:
                    self._recover()
                    continue
                raise WorkloadError("项目系统恢复登录后仍未授权，请稍后重试")
            if result.get("code") != 0:
                raise WorkloadError(
                    "项目系统请求失败："
                    + redact(result.get("msg", "未知错误"), self.cfg)
                )
            return result.get("data") or {}
        raise WorkloadError("项目系统授权恢复失败")

    def challenge(self) -> dict:
        result = self.transport.json(
            "/system/captcha/get",
            {"captchaType": "blockPuzzle"},
            headers=self._headers(),
        )
        if result.get("repCode") != "0000":
            raise WorkloadError(
                "无法获取项目验证码：" + redact(result.get("repMsg"), self.cfg)
            )
        data = result.get("repData") or {}
        try:
            return {
                "kind": "slider",
                "background": base64.b64decode(
                    data["originalImageBase64"], validate=True
                ),
                "piece": base64.b64decode(data["jigsawImageBase64"], validate=True),
                "_token": data["token"],
                "_secret": data.get("secretKey"),
            }
        except (KeyError, ValueError, TypeError) as exc:
            raise WorkloadError("项目验证码响应格式发生变化") from exc

    def submit(self, challenge: dict, answer) -> dict:
        from Crypto.Cipher import AES
        from Crypto.Util.Padding import pad

        def encrypt(value):
            secret = challenge.get("_secret")
            if not secret:
                return value
            return base64.b64encode(
                AES.new(secret.encode(), AES.MODE_ECB).encrypt(pad(value.encode(), 16))
            ).decode()

        try:
            offset = int(answer)
        except (TypeError, ValueError) as exc:
            raise CaptchaRejected("请拖动滑块到拼图缺口") from exc
        if not 0 <= offset <= 310:
            raise CaptchaRejected("滑块位置超出图片范围")
        point = json.dumps({"x": offset, "y": 5}, separators=(",", ":"))
        result = self.transport.json(
            "/system/captcha/check",
            {
                "captchaType": "blockPuzzle",
                "pointJson": encrypt(point),
                "token": challenge["_token"],
            },
            headers=self._headers(),
        )
        if result.get("repCode") != "0000":
            if result.get("repCode") in ("6110", "6111", "6112"):
                raise CaptchaRejected("拼图位置不正确或验证码已过期，请重试")
            raise WorkloadError(
                "项目验证码校验失败：" + redact(result.get("repMsg"), self.cfg)
            )
        result = self.transport.json(
            "/system/auth/login",
            {
                "tenantName": "Luyan",
                "username": self.cfg["project_username"],
                "password": self.cfg["project_password"],
                "captchaVerification": encrypt(challenge["_token"] + "---" + point),
                "rememberMe": False,
            },
            headers=self._headers(),
        )
        if result.get("code") != 0:
            message = redact(result.get("msg", "未知错误"), self.cfg)
            if "验证码" in message:
                raise CaptchaRejected(message)
            raise WorkloadError("项目系统登录失败：" + message)
        return result.get("data") or {}

    def login(self) -> None:
        for _ in range(MAX_CAPTCHA_ATTEMPTS):
            self.context.check()
            challenge = self.challenge()
            try:
                result = self.submit(challenge, self.solver.solve(challenge))
                break
            except CaptchaRejected:
                continue
        else:
            result = self.manual.solve("项目系统", self.challenge, self.submit)
        self._apply(result)


class OaSession:
    def __init__(
        self,
        cfg: dict,
        save: Callable[[], None],
        *,
        transport=None,
        solver=None,
        manual=None,
        context=None,
    ):
        self.cfg, self.save = cfg, save
        self.context = context or RunContext()
        self.transport = transport or HttpTransport(OA_BASE, "OA 系统", self.context)
        self.solver = solver or CaptchaSolver()
        self.manual = manual if manual is not None else _manual(self.context)

    def challenge(self) -> dict:
        # 同一个 CookieJar 贯穿初始化、取图、登录和打卡查询。
        self.transport.text("/")
        return {
            "kind": "text",
            "image": self.transport.binary("/getVeriCode.do?t=" + str(time.time_ns())),
        }

    def submit(self, challenge: dict, answer) -> str:
        if not isinstance(answer, str) or not re.fullmatch(r"[A-Za-z0-9]{4}", answer):
            raise CaptchaRejected("请输入图片中的 4 位字母或数字")
        form = {
            "account": self.cfg["oa_username"],
            "pwd": base64.b64encode(self.cfg["oa_password"].encode()).decode(),
            "verifyCode": answer,
            "e_msg": "",
        }
        headers = {
            "Origin": OA_BASE,
            "Referer": OA_BASE + "/",
            "X-Requested-With": "XMLHttpRequest",
        }
        result = self.transport.json("/login.json", form, form=True, headers=headers)
        if result.get("success") is True and result.get("append"):
            result = self.transport.json(
                "/login.json?force=Y", form, form=True, headers=headers
            )
        if result.get("success") is not True:
            message = redact(result.get("msg", "未知错误"), self.cfg)
            if "验证码" in message:
                raise CaptchaRejected(message)
            raise WorkloadError("OA 登录失败：" + message)
        token = result.get("data")
        if result.get("append") or not isinstance(token, str) or not token:
            raise WorkloadError("OA 登录未返回授权，请稍后重试")
        return token

    def login(self) -> None:
        for _ in range(MAX_CAPTCHA_ATTEMPTS):
            self.context.check()
            challenge = self.challenge()
            try:
                token = self.submit(challenge, self.solver.solve(challenge))
                break
            except CaptchaRejected:
                continue
        else:
            token = self.manual.solve("OA 系统", self.challenge, self.submit)
        self.context.check()
        self.cfg["oa_token"] = token
        self.cfg.pop("oa_jsessionid", None)
        self.save()

    def post(self, path: str, form: dict) -> str:
        if not self.cfg.get("oa_token"):
            self.login()
        for attempt in range(2):
            separator = "&" if "?" in path else "?"
            url = (
                path
                + separator
                + "X-EOA-TOKEN="
                + urllib.parse.quote(self.cfg["oa_token"], safe="")
            )
            try:
                html = self.transport.text(
                    url, form, form=True, headers={"Origin": OA_BASE}
                )
                expired = is_login_page(html)
            except HttpError as exc:
                if exc.status != 401:
                    raise
                expired, html = True, ""
            if not expired:
                return html
            if attempt == 0:
                self.login()
            else:
                raise WorkloadError("OA 恢复登录后仍未授权，请稍后重试")
        raise WorkloadError("OA 授权恢复失败")
