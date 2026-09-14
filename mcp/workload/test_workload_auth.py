"""认证恢复与凭据保护回归，不访问实际账号或网络。"""

import base64
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from workload_auth import OaSession, ProjectSession
from workload_security import (
    CaptchaRejected,
    CredentialStore,
    HttpError,
    WorkloadError,
    redact,
)


def config():
    return {
        "oa_username": "oa-user",
        "oa_password": "oa-secret",
        "project_username": "project-user",
        "project_password": "project-secret",
    }


def tokens(access="new-access", refresh="new-refresh"):
    return {
        "accessToken": access,
        "refreshToken": refresh,
        "expiresTime": int((time.time() + 1800) * 1000),
        "userId": 42,
    }


class TestCredentialStore(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows DPAPI")
    def test_dpapi_roundtrip_never_writes_plaintext(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "credentials.dat"
            store = CredentialStore(path)
            data = {**config(), "oa_token": "private-token"}
            store.save(data)
            raw = path.read_bytes()
            for secret in ("oa-secret", "project-secret", "private-token"):
                self.assertNotIn(secret.encode(), raw)
            self.assertEqual(store.load(), data)

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI")
    def test_corrupt_store_has_actionable_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "credentials.dat"
            CredentialStore(path).save(config())
            path.write_bytes(path.read_bytes()[:30])
            with self.assertRaisesRegex(WorkloadError, "setup"):
                CredentialStore(path).load()

    @unittest.skipUnless(os.name == "nt", "Windows file locking")
    def test_competing_store_cannot_take_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "credentials.dat"
            with (
                CredentialStore(path).lock(),
                self.assertRaisesRegex(WorkloadError, "正在"),
                CredentialStore(path).lock(wait_seconds=0),
            ):
                self.fail("competing lock must fail")

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI")
    def test_failed_replace_preserves_previous_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            store = CredentialStore(Path(directory) / "credentials.dat")
            store.save(config())
            with (
                patch(
                    "workload_security.os.replace", side_effect=OSError("disk error")
                ),
                self.assertRaises(WorkloadError),
            ):
                store.save({**config(), "oa_password": "replacement"})
            self.assertEqual(store.load(), config())
            self.assertEqual(list(Path(directory).glob("*.tmp")), [])

    def test_redaction_covers_plain_and_encoded_passwords(self):
        data = config()
        data["refresh_token"] = "private-refresh"
        message = (
            "oa-secret project-secret private-refresh "
            + base64.b64encode(b"oa-secret").decode()
        )
        safe = redact(message, data)
        for value in ("oa-secret", "project-secret", "private-refresh", "b2Etc2VjcmV0"):
            self.assertNotIn(value, safe)


class TestProjectSession(unittest.TestCase):
    def setUp(self):
        self.cfg = config()
        self.transport = Mock()
        self.save = Mock()
        self.session = ProjectSession(
            self.cfg, self.save, transport=self.transport, solver=Mock(), manual=Mock()
        )

    def cache(self):
        self.cfg.update(
            access_token="cached-access",
            refresh_token="cached-refresh",
            expires_time=int((time.time() + 1800) * 1000),
        )

    def test_valid_cache_does_not_refresh_or_login(self):
        self.cache()
        self.transport.json.return_value = {"code": 0, "data": {"id": 42}}
        self.assertEqual(
            self.session.get("/system/auth/get-permission-info"), {"id": 42}
        )
        self.assertEqual(self.transport.json.call_count, 1)
        self.save.assert_not_called()

    def test_json_401_refreshes_then_replays_once(self):
        self.cache()
        self.transport.json.side_effect = [
            {"code": 401, "msg": "账号未登录"},
            {"code": 0, "data": tokens()},
            {"code": 0, "data": {"id": 42}},
        ]
        self.assertEqual(self.session.get("/identity"), {"id": 42})
        self.assertEqual(self.cfg["access_token"], "new-access")
        self.assertEqual(self.cfg["refresh_token"], "new-refresh")
        self.save.assert_called_once()

    def test_http_401_has_same_recovery(self):
        self.cache()
        self.transport.json.side_effect = [
            HttpError(401, "unauthorized"),
            {"code": 0, "data": tokens()},
            {"code": 0, "data": {"ok": True}},
        ]
        self.assertEqual(self.session.get("/identity"), {"ok": True})

    def test_expired_refresh_falls_back_to_password_login(self):
        self.cfg["refresh_token"] = "expired"
        self.transport.json.side_effect = [
            {"code": 401, "msg": "无效的刷新令牌"},
            {"code": 0, "data": {"ok": True}},
        ]
        with patch.object(self.session, "login") as login:
            login.side_effect = lambda: self.cfg.update(access_token="logged-in")
            self.assertEqual(self.session.get("/identity"), {"ok": True})
            login.assert_called_once()

    def test_network_failure_does_not_attempt_login(self):
        self.cache()
        self.transport.json.side_effect = WorkloadError("网络不可达")
        with patch.object(self.session, "login") as login:
            with self.assertRaisesRegex(WorkloadError, "网络"):
                self.session.get("/identity")
            login.assert_not_called()

    def test_second_401_stops_instead_of_looping(self):
        self.cache()
        self.transport.json.side_effect = [
            {"code": 401},
            {"code": 0, "data": tokens()},
            {"code": 401},
        ]
        with self.assertRaises(WorkloadError):
            self.session.get("/identity")
        self.assertEqual(self.transport.json.call_count, 3)

    def test_three_captcha_attempts_then_manual_login(self):
        with (
            patch.object(self.session, "challenge", return_value={"kind": "slider"}),
            patch.object(
                self.session, "submit", side_effect=CaptchaRejected("位置不正确")
            ) as submit,
        ):
            self.session.manual.solve.return_value = tokens()
            self.session.login()
        self.assertEqual(submit.call_count, 3)
        self.session.manual.solve.assert_called_once()
        self.assertEqual(self.cfg["creator_id"], "42")

    def test_password_error_does_not_reach_manual_captcha(self):
        with (
            patch.object(self.session, "challenge", return_value={"kind": "slider"}),
            patch.object(
                self.session, "submit", side_effect=WorkloadError("账号或密码错误")
            ) as submit,
            self.assertRaises(WorkloadError),
        ):
            self.session.login()
        self.assertEqual(submit.call_count, 1)
        self.session.manual.solve.assert_not_called()


class TestOaSession(unittest.TestCase):
    def setUp(self):
        self.cfg = config()
        self.transport = Mock()
        self.session = OaSession(
            self.cfg, Mock(), transport=self.transport, solver=Mock(), manual=Mock()
        )

    def test_required_force_login_is_automatic(self):
        self.transport.json.side_effect = [
            {"success": True, "append": "账号已登录，需要强制登录"},
            {"success": True, "data": "oa-access"},
        ]
        self.assertEqual(self.session.submit({"kind": "text"}, "a3bc"), "oa-access")
        self.assertIn("force=Y", self.transport.json.call_args_list[1].args[0])

    def test_incorrect_password_is_not_a_captcha_retry(self):
        self.transport.json.return_value = {"success": False, "msg": "密码错误"}
        with self.assertRaises(WorkloadError) as raised:
            self.session.submit({"kind": "text"}, "a3bc")
        self.assertNotIsInstance(raised.exception, CaptchaRejected)
        self.assertEqual(self.transport.json.call_count, 1)

    def test_login_page_triggers_relogin_and_replay(self):
        self.cfg["oa_token"] = "old-token"
        self.transport.text.side_effect = [
            '<input name="jlLoginName"><input name="jlPassword">',
            "<table>attendance</table>",
        ]
        with patch.object(self.session, "login") as login:
            login.side_effect = lambda: self.cfg.update(oa_token="new-token")
            self.assertEqual(
                self.session.post("/attendance", {}), "<table>attendance</table>"
            )
            login.assert_called_once()

    def test_cached_oa_token_does_not_login(self):
        self.cfg["oa_token"] = "valid-token"
        self.transport.text.return_value = "<table>attendance</table>"
        with patch.object(self.session, "login") as login:
            self.session.post("/attendance", {})
            login.assert_not_called()

    def test_three_ocr_failures_open_manual_verification(self):
        self.session.solver.solve.side_effect = CaptchaRejected("无法识别")
        self.session.manual.solve.return_value = "manual-oa-token"
        with patch.object(
            self.session, "challenge", return_value={"kind": "text"}
        ) as challenge:
            self.session.login()
        self.assertEqual(challenge.call_count, 3)
        self.session.manual.solve.assert_called_once()
        self.assertEqual(self.cfg["oa_token"], "manual-oa-token")

    def test_second_login_page_stops_instead_of_looping(self):
        self.cfg["oa_token"] = "old-token"
        self.transport.text.return_value = '<form id="loginForm"></form>'
        with (
            patch.object(self.session, "login") as login,
            self.assertRaisesRegex(WorkloadError, "仍未授权"),
        ):
            self.session.post("/attendance", {})
        login.assert_called_once()
        self.assertEqual(self.transport.text.call_count, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
