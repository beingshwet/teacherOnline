"""Iteration 3 — Resend email swap, Messaging (REST + WS), Attendance tracking."""
import os
import json
import time
import asyncio
import requests
import pytest
from datetime import datetime, timedelta, timezone

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"
WS_BASE = BASE.replace("https://", "wss://").replace("http://", "ws://")

ADMIN = ("admin@example.com", "Admin@12345")
TUTOR = ("tutor@example.com", "Tutor@12345")
STUDENT = ("student@example.com", "Student@12345")


def login(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


def _extract_token(sess: requests.Session) -> str:
    tok = sess.cookies.get("access_token")
    assert tok, "no access_token cookie"
    return tok


@pytest.fixture(scope="module")
def student_sess(): return login(*STUDENT)


@pytest.fixture(scope="module")
def tutor_sess(): return login(*TUTOR)


@pytest.fixture(scope="module")
def admin_sess(): return login(*ADMIN)


@pytest.fixture(scope="module")
def student_id(student_sess):
    return student_sess.get(f"{API}/auth/me").json()["user"]["id"]


@pytest.fixture(scope="module")
def tutor_id(tutor_sess):
    return tutor_sess.get(f"{API}/auth/me").json()["user"]["id"]


# --- Resend email provider swap ---
class TestResendEmail:
    def test_run_reminders_and_check_provider(self, admin_sess):
        r = admin_sess.post(f"{API}/admin/reminders/run")
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_email_log_has_resend_rows(self, admin_sess):
        r = admin_sess.get(f"{API}/admin/email-log?limit=100")
        assert r.status_code == 200
        emails = r.json().get("emails", [])
        # Might be empty if no upcoming bookings — but if reminders fired earlier we should see rows
        # Look for any 'resend' provider row
        resend_rows = [e for e in emails if e.get("provider") == "resend"]
        if not resend_rows:
            pytest.skip("No resend email log entries yet — no bookings in reminder window")
        # Every resend row should have status field
        for e in resend_rows[:10]:
            assert e.get("status") in ("sent", "failed"), f"missing status: {e}"
            if e["status"] == "sent":
                assert e.get("provider_message_id"), "sent row missing provider_message_id"
            else:
                assert e.get("error"), "failed row missing error"


# --- Messaging REST ---
class TestMessagingREST:
    def test_send_empty_message_rejected(self, student_sess, tutor_id):
        r = student_sess.post(f"{API}/messages", json={"to_user_id": tutor_id, "body": "   "})
        assert r.status_code == 400

    def test_send_oversize_rejected(self, student_sess, tutor_id):
        r = student_sess.post(f"{API}/messages", json={"to_user_id": tutor_id, "body": "x" * 5000})
        assert r.status_code == 400

    def test_stranger_forbidden(self, student_sess):
        # Create fresh stranger tutor with no bookings
        email = f"stranger_tutor_{int(time.time())}@example.com"
        rr = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "Passw0rd@1",
            "first_name": "Stranger", "last_name": "Tutor", "role": "tutor",
        })
        assert rr.status_code in (200, 201)
        stranger_id = rr.json()["user"]["id"]
        r = student_sess.post(f"{API}/messages", json={"to_user_id": stranger_id, "body": "hi"})
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_send_message_success(self, student_sess, tutor_id, student_id):
        body_text = f"Hello tutor at {time.time()}"
        r = student_sess.post(f"{API}/messages", json={"to_user_id": tutor_id, "body": body_text})
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["body"] == body_text
        assert msg["from_user_id"] == student_id
        assert msg["to_user_id"] == tutor_id
        assert msg["read"] is False
        assert "thread_key" in msg
        assert "created_at" in msg
        assert "_id" not in msg
        pytest.iter3_msg_body = body_text

    def test_threads_list(self, student_sess, tutor_id):
        r = student_sess.get(f"{API}/messages/threads")
        assert r.status_code == 200
        threads = r.json().get("threads", [])
        assert any(t["other_user_id"] == tutor_id for t in threads), f"tutor thread missing: {threads}"
        t = next(t for t in threads if t["other_user_id"] == tutor_id)
        assert "last_body" in t and "last_at" in t and "unread" in t and "other_name" in t

    def test_thread_marks_read(self, student_sess, tutor_sess, student_id, tutor_id):
        # tutor sends to student -> student has unread
        r = tutor_sess.post(f"{API}/messages", json={"to_user_id": student_id, "body": f"tutor msg {time.time()}"})
        assert r.status_code == 200, r.text
        # student threads should show unread>=1 for tutor
        threads = student_sess.get(f"{API}/messages/threads").json()["threads"]
        t = next(t for t in threads if t["other_user_id"] == tutor_id)
        assert t["unread"] >= 1
        # fetch thread -> marks read
        r2 = student_sess.get(f"{API}/messages/thread/{tutor_id}")
        assert r2.status_code == 200
        data = r2.json()
        assert "messages" in data and isinstance(data["messages"], list)
        assert len(data["messages"]) >= 1
        # ascending order check
        times = [m["created_at"] for m in data["messages"]]
        assert times == sorted(times)
        # after fetch, unread should be 0
        threads2 = student_sess.get(f"{API}/messages/threads").json()["threads"]
        t2 = next(t for t in threads2 if t["other_user_id"] == tutor_id)
        assert t2["unread"] == 0, f"expected unread=0 after fetch, got {t2}"


# --- Attendance ---
def _find_booking_between(sess, tutor_id):
    r = sess.get(f"{API}/bookings")
    j = r.json()
    items = j if isinstance(j, list) else j.get("bookings", j.get("items", []))
    # Prefer CONFIRMED, else any with tutor_id match
    for b in items:
        if b.get("tutor_id") == tutor_id and b.get("status") == "CONFIRMED":
            return b
    for b in items:
        if b.get("tutor_id") == tutor_id:
            return b
    return None


class TestAttendance:
    def test_student_join(self, student_sess, tutor_id):
        b = _find_booking_between(student_sess, tutor_id)
        assert b, "no booking found for attendance test"
        r = student_sess.post(f"{API}/bookings/{b['id']}/attendance/join")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert data.get("student_joined_at")
        first_ts = data["student_joined_at"]
        # idempotent
        r2 = student_sess.post(f"{API}/bookings/{b['id']}/attendance/join")
        assert r2.status_code == 200
        assert r2.json()["student_joined_at"] == first_ts, "attendance should be idempotent"
        pytest.iter3_booking_id = b["id"]

    def test_tutor_join(self, tutor_sess, student_sess, tutor_id):
        bid = getattr(pytest, "iter3_booking_id", None)
        if not bid:
            b = _find_booking_between(student_sess, tutor_id)
            assert b
            bid = b["id"]
        r = tutor_sess.post(f"{API}/bookings/{bid}/attendance/join")
        assert r.status_code == 200, r.text
        assert r.json().get("tutor_joined_at")

    def test_booking_hydration_exposes_timestamps(self, student_sess):
        bid = getattr(pytest, "iter3_booking_id", None)
        if not bid: pytest.skip("no booking")
        r = student_sess.get(f"{API}/bookings/{bid}")
        assert r.status_code == 200
        b = r.json()
        assert b.get("student_joined_at"), f"student_joined_at missing: {b}"
        assert b.get("tutor_joined_at"), f"tutor_joined_at missing: {b}"

    def test_non_participant_forbidden(self, student_sess, tutor_id):
        bid = getattr(pytest, "iter3_booking_id", None)
        if not bid: pytest.skip("no booking")
        # Create fresh stranger student
        email = f"stranger_stu_{int(time.time())}@example.com"
        rr = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "Passw0rd@1",
            "first_name": "Str", "last_name": "Stu", "role": "student",
        })
        assert rr.status_code in (200, 201)
        s2 = login(email, "Passw0rd@1")
        r = s2.post(f"{API}/bookings/{bid}/attendance/join")
        assert r.status_code == 403


# --- WebSocket ---
class TestWebSocket:
    def test_ws_hello_and_realtime_push(self, student_sess, tutor_sess, tutor_id, student_id):
        try:
            import websockets
        except ImportError:
            pytest.skip("websockets library not installed")

        token = _extract_token(student_sess)
        url = f"{WS_BASE}/api/ws/messages?token={token}"

        async def scenario():
            async with websockets.connect(url, open_timeout=10) as ws:
                hello_raw = await asyncio.wait_for(ws.recv(), timeout=5)
                hello = json.loads(hello_raw)
                assert hello.get("type") == "hello"
                assert hello.get("user_id") == student_id
                # Trigger a POST from tutor to student
                body_text = f"ws-test-{time.time()}"
                r = tutor_sess.post(f"{API}/messages", json={"to_user_id": student_id, "body": body_text})
                assert r.status_code == 200, r.text
                # Await ws frame
                got = None
                for _ in range(5):
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=3)
                        pkt = json.loads(raw)
                        if pkt.get("type") == "message" and pkt.get("message", {}).get("body") == body_text:
                            got = pkt
                            break
                    except asyncio.TimeoutError:
                        break
                assert got, "did not receive real-time message frame"
                assert got["message"]["from_user_id"] == tutor_id
                assert got["message"]["to_user_id"] == student_id

        asyncio.run(scenario())

    def test_ws_rejects_missing_token(self):
        try:
            import websockets
        except ImportError:
            pytest.skip("websockets library not installed")
        url = f"{WS_BASE}/api/ws/messages"

        async def scenario():
            try:
                async with websockets.connect(url, open_timeout=10) as ws:
                    # server should close; recv will raise
                    try:
                        await asyncio.wait_for(ws.recv(), timeout=3)
                    except Exception:
                        return  # closed as expected
                    pytest.fail("expected ws to close without token")
            except Exception:
                return  # connection rejected/closed — acceptable
        asyncio.run(scenario())


# --- Frontend routes/sidebar sanity ---
def test_frontend_landing_reachable():
    r = requests.get(BASE, timeout=10, allow_redirects=True)
    assert r.status_code == 200
