"""Windows 用户凭据保护、进程互斥与可展示的错误。"""

from __future__ import annotations

import base64
import ctypes
import json
import os
import re
import tempfile
import threading
import time
import urllib.parse
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CONFIG_PATH = Path.home() / ".workload" / "credentials.dat"
_MAGIC = b"WORKLOAD-DPAPI-1\n"
REQUIRED_CREDENTIALS = (
    "oa_username",
    "oa_password",
    "project_username",
    "project_password",
)


class WorkloadError(Exception):
    """内容已脱敏，可以直接显示给用户。"""


class TokenExpiredError(WorkloadError):
    pass


class CaptchaRejected(WorkloadError):
    pass


class CancelledError(WorkloadError):
    pass


class HttpError(WorkloadError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


@dataclass
class RunContext:
    cancelled: threading.Event = field(default_factory=threading.Event)
    on_verification: Callable[[dict | None], None] | None = None

    def check(self) -> None:
        if self.cancelled.is_set():
            raise CancelledError("统计已取消")

    def notify(self, state: dict | None) -> None:
        if self.on_verification:
            self.on_verification(state)


def redact(message: object, cfg: dict | None = None) -> str:
    text = str(message)
    secrets = set()
    for key, value in (cfg or {}).items():
        if (
            isinstance(value, str)
            and value
            and any(
                part in key.lower()
                for part in ("password", "token", "secret", "jsession")
            )
        ):
            secrets.update((value, urllib.parse.quote(value, safe="")))
            secrets.add(urllib.parse.quote_plus(value))
            if "password" in key.lower():
                secrets.add(base64.b64encode(value.encode()).decode())
    for secret in sorted(secrets, key=len, reverse=True):
        text = text.replace(secret, "<redacted>")
    text = re.sub(r"(?i)(Bearer\s+)\S+", r"\1<redacted>", text)
    text = re.sub(
        r"(?i)((?:X-EOA-TOKEN|refreshToken|accessToken|password|pwd)=)[^&\s]+",
        r"\1<redacted>",
        text,
    )
    return text[:400]


def config_path(path: Path | None = None) -> Path:
    return path or Path(os.environ.get("WORKLOAD_MCP_CONFIG") or DEFAULT_CONFIG_PATH)


def validate_credentials(cfg: dict) -> dict:
    if not isinstance(cfg, dict):
        raise WorkloadError("凭据格式不正确，请运行 setup 重新配置")
    for key in REQUIRED_CREDENTIALS:
        if not isinstance(cfg.get(key), str) or not cfg[key]:
            raise WorkloadError(f"缺少登录信息 {key}，请运行 setup 配置两系统账号密码")
    return cfg


def _dpapi(data: bytes, *, decrypt: bool = False) -> bytes:
    if os.name != "nt":
        raise WorkloadError("自动登录凭据仅支持当前 Windows 用户，请在 Windows 上运行")
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    source_buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    function = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    function.argtypes = [
        ctypes.POINTER(Blob),
        ctypes.c_void_p,
        ctypes.POINTER(Blob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(Blob),
    ]
    function.restype = wintypes.BOOL
    if not function(
        ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)
    ):
        raise WorkloadError(
            f"Windows 凭据保护失败（错误 {ctypes.get_last_error()}），请运行 setup 重新配置"
        )
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel32.LocalFree(target.data)


class CredentialStore:
    def __init__(self, path: Path | None = None):
        self.path = config_path(path)

    def load(self) -> dict:
        if not self.path.exists():
            raise WorkloadError(
                f"尚未配置登录账号，请运行 setup（凭据文件：{self.path}）"
            )
        try:
            raw = self.path.read_bytes()
            if not raw.startswith(_MAGIC):
                raise WorkloadError(
                    "该文件不是加密凭据，请运行 setup 重新配置；无需复制 token"
                )
            cfg = json.loads(_dpapi(raw[len(_MAGIC) :], decrypt=True).decode("utf-8"))
            return validate_credentials(cfg)
        except WorkloadError:
            raise
        except (OSError, ValueError, UnicodeError) as exc:
            raise WorkloadError(
                "凭据文件无法读取或解密，请运行 setup 重新配置"
            ) from exc

    def save(self, cfg: dict) -> None:
        validate_credentials(cfg)
        payload = _MAGIC + _dpapi(json.dumps(cfg, ensure_ascii=False).encode("utf-8"))
        temporary = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
            with os.fdopen(fd, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        except OSError as exc:
            raise WorkloadError(
                f"无法保存加密凭据，请检查目录写入权限：{self.path.parent}"
            ) from exc
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    @contextmanager
    def lock(self, wait_seconds: float = 3):
        if os.name != "nt":
            raise WorkloadError("此版本自动登录仅支持 Windows")
        import msvcrt

        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            stream = self.path.with_suffix(self.path.suffix + ".lock").open("a+b")
        except OSError as exc:
            raise WorkloadError("无法创建凭据锁，请检查用户目录权限") from exc
        with stream:
            if os.fstat(stream.fileno()).st_size == 0:
                stream.write(b"\0")
                stream.flush()
            deadline = time.monotonic() + wait_seconds
            while True:
                stream.seek(0)
                try:
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise WorkloadError(
                            "另一项统计或凭据配置正在进行，请完成后重试"
                        ) from None
                    time.sleep(0.1)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
