"""Iteration 5 — Message deletion + read receipts.

Covers:
  * DELETE /api/messages/{id} — sender window, admin override, 403/404, DELETE_WINDOW_EXPIRED
  * Idempotent second delete → {already_deleted:true}
  * Attachment GridFS blob cleanup on delete
  * Thread endpoint returns deleted messages with deleted=true, body='', attachment=None, read=True
  * Threads list shows tombstone last_body='This message was deleted'
  * WebSocket message_deleted push to both parties
  * Read receipts: GET thread marks read + broadcasts {type:'read', up_to_message_id, ...}
  * Response returned by GET thread includes read=true and read_at for just-read msgs
"""
import os
import io
import json
import time
import asyncio
import threading
import uuid
import datetime as dt

import pytest
import requests
import websockets  # v10+

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"
WS_URL_BASE = BASE.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/messages"

ADMIN = ("admin@example.com", "Admin@12345")
TUTOR = ("tutor@example.com", "Tutor@12345")
STUDENT = ("student@example.com", "Student@12345")

# tiny valid PNG
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00"
    b"\x00\x03\x00\x01\x5c\xcd\xff\x69\x00\x00\x00\x00IEND\xaeB`\x82"
)


def login(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    tok = None
    for c in s.cookies:
        if c.name == "access_token":
            tok = c.value
            break
    return s, tok


def me(sess):
    return sess.get(f"{API}/auth/me").json()["user"]


@pytest.fixture(scope="module")
def tutor():
    s, tok = login(*TUTOR)
    u = me(s)
    return {"sess": s, "token": tok, "id": u["id"]}


@pytest.fixture(scope="module")
def student():
    s, tok = login(*STUDENT)
    u = me(s)
    return {"sess": s, "token": tok, "id": u["id"]}


@pytest.fixture(scope="module")
def admin():
    s, tok = login(*ADMIN)
    u = me(s)
    return {"sess": s, "token": tok, "id": u["id"]}


@pytest.fixture(scope="module")
def stranger():
    # random student
    email = f"stranger_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={
        "first_name": "Stg", "last_name": "User", "email": email,
        "password": "Password@123", "role": "student",
    }, timeout=15)
    assert r.status_code == 200, r.text
    tok = None
    for c in s.cookies:
        if c.name == "access_token":
            tok = c.value
    return {"sess": s, "token": tok, "id": me(s)["id"]}


def send_text(sender, to_id, body="hello"):
    r = sender["sess"].post(f"{API}/messages", json={"to_user_id": to_id, "body": body})
    assert r.status_code == 200, r.text
    return r.json()


def send_attach(sender, to_id, caption="cap", data=PNG_BYTES, filename="t.png", ctype="image/png"):
    files = {"file": (filename, data, ctype)}
    r = sender["sess"].post(f"{API}/messages/attachment",
                            params={"to_user_id": to_id, "caption": caption}, files=files)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 404 / 403 ----------
class TestPermissions:
    def test_delete_404_unknown(self, tutor):
        r = tutor["sess"].delete(f"{API}/messages/does-not-exist-xyz")
        assert r.status_code == 404

    def test_delete_403_stranger_cant_delete_others(self, tutor, student, stranger):
        m = send_text(tutor, student["id"], "own-msg-for-403")
        r = stranger["sess"].delete(f"{API}/messages/{m['id']}")
        assert r.status_code == 403, r.text


# ---------- happy path + idempotency ----------
class TestSenderDelete:
    def test_sender_delete_within_window(self, tutor, student):
        m = send_text(tutor, student["id"], "delete-me-please")
        r = tutor["sess"].delete(f"{API}/messages/{m['id']}")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert not j.get("already_deleted")
        pytest.iter5_deleted_id = m["id"]

    def test_second_delete_idempotent(self, tutor):
        r = tutor["sess"].delete(f"{API}/messages/{pytest.iter5_deleted_id}")
        assert r.status_code == 200
        assert r.json().get("already_deleted") is True

    def test_thread_shows_tombstone(self, tutor, student):
        r = tutor["sess"].get(f"{API}/messages/thread/{student['id']}")
        assert r.status_code == 200
        msgs = r.json()["messages"]
        found = [m for m in msgs if m["id"] == pytest.iter5_deleted_id]
        assert found, "deleted msg missing from thread"
        m = found[0]
        assert m.get("deleted") is True
        assert m.get("body") == ""
        assert m.get("attachment") in (None,)
        assert m.get("read") is True


# ---------- attachment cleanup ----------
class TestAttachmentDelete:
    def test_delete_attachment_removes_blob(self, tutor, student):
        msg = send_attach(tutor, student["id"], caption="to-be-deleted")
        att_id = msg["attachment"]["id"]
        # sanity: can download before delete
        r0 = tutor["sess"].get(f"{API}/messages/attachment/{att_id}")
        assert r0.status_code == 200
        rd = tutor["sess"].delete(f"{API}/messages/{msg['id']}")
        assert rd.status_code == 200 and rd.json().get("ok")
        # blob gone
        r1 = tutor["sess"].get(f"{API}/messages/attachment/{att_id}")
        assert r1.status_code == 404, f"blob still fetchable: {r1.status_code}"


# ---------- window expiry (mutate created_at via Mongo) ----------
class TestWindowExpiry:
    def test_expired_window_400_and_admin_override(self, tutor, student, admin):
        # need to mutate created_at back 10 min via direct mongo
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "tutoring_platform")
        cli = MongoClient(mongo_url)
        db = cli[db_name]

        m = send_text(tutor, student["id"], "old-msg")
        past = (dt.datetime.utcnow() - dt.timedelta(minutes=10)).isoformat() + "+00:00"
        db.messages.update_one({"id": m["id"]}, {"$set": {"created_at": past}})
        # sender: 400 with DELETE_WINDOW_EXPIRED
        r = tutor["sess"].delete(f"{API}/messages/{m['id']}")
        assert r.status_code == 400, r.text
        detail = r.json().get("detail")
        # FastAPI wraps our dict under 'detail'
        assert isinstance(detail, dict), f"expected dict detail, got {detail!r}"
        assert detail.get("code") == "DELETE_WINDOW_EXPIRED"
        assert "message" in detail

        # admin can delete anyway
        r2 = admin["sess"].delete(f"{API}/messages/{m['id']}")
        assert r2.status_code == 200, r2.text
        assert r2.json().get("ok") is True


# ---------- threads list tombstone ----------
class TestThreadsListTombstone:
    def test_threads_last_body_tombstone(self, tutor, student):
        m = send_text(tutor, student["id"], "will-tombstone")
        rd = tutor["sess"].delete(f"{API}/messages/{m['id']}")
        assert rd.status_code == 200
        # threads list from tutor side
        r = tutor["sess"].get(f"{API}/messages/threads")
        assert r.status_code == 200
        threads = r.json().get("threads", r.json() if isinstance(r.json(), list) else [])
        # Find thread with student
        entry = None
        for t in threads:
            if t.get("other", {}).get("id") == student["id"] or t.get("other_user_id") == student["id"]:
                entry = t; break
        assert entry is not None, f"no thread with student in {threads}"
        # last_body should be tombstone since we just deleted the latest
        assert entry.get("last_body") == "This message was deleted", entry


# ---------- WebSocket: message_deleted + read receipt ----------
async def _ws_collect(token, want_types, timeout=8.0):
    """Connect and collect messages until we've seen all want_types or timeout."""
    seen = []
    got = {}
    try:
        async with websockets.connect(f"{WS_URL_BASE}?token={token}", open_timeout=10, close_timeout=2) as ws:
            deadline = time.time() + timeout
            while time.time() < deadline and not all(t in got for t in want_types):
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=deadline - time.time())
                except (asyncio.TimeoutError, Exception):
                    break
                try:
                    ev = json.loads(raw)
                except Exception:
                    continue
                seen.append(ev)
                t = ev.get("type")
                if t in want_types and t not in got:
                    got[t] = ev
    except Exception as e:
        print("WS error:", e)
    return got, seen


class TestWebSocketDelete:
    def test_ws_message_deleted_both_parties(self, tutor, student):
        # Prime: send a message first so we know both parties are "in conversation"
        m = send_text(tutor, student["id"], "delete-via-ws")

        results = {}

        async def _run():
            async def _tutor_side():
                res, _ = await _ws_collect(tutor["token"], {"message_deleted"}, timeout=10.0)
                results["tutor"] = res

            async def _student_side():
                res, _ = await _ws_collect(student["token"], {"message_deleted"}, timeout=10.0)
                results["student"] = res

            async def _deleter():
                await asyncio.sleep(1.5)  # let both WS clients subscribe
                # call delete in thread to avoid blocking loop
                await asyncio.get_event_loop().run_in_executor(
                    None, lambda: tutor["sess"].delete(f"{API}/messages/{m['id']}"))

            await asyncio.gather(_tutor_side(), _student_side(), _deleter())

        asyncio.run(_run())

        for who in ("tutor", "student"):
            assert "message_deleted" in results.get(who, {}), f"{who} missed WS event; got {results.get(who)}"
            ev = results[who]["message_deleted"]
            assert ev["message_id"] == m["id"]
            assert ev.get("thread_key")
            assert ev.get("deleted_at")
            assert ev.get("deleted_by") == tutor["id"]


class TestReadReceipts:
    def test_read_receipt_ws_and_response(self, tutor, student):
        # Tutor sends a fresh msg to student
        m = send_text(tutor, student["id"], f"rr-{uuid.uuid4().hex[:6]}")
        assert m.get("read") is False

        results = {}

        async def _run():
            async def _tutor_ws():
                res, _ = await _ws_collect(tutor["token"], {"read"}, timeout=10.0)
                results["tutor"] = res

            async def _reader():
                await asyncio.sleep(1.5)
                # student opens the thread → server marks read + broadcasts
                r = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: student["sess"].get(f"{API}/messages/thread/{tutor['id']}"))
                results["thread_resp"] = r.json()

            await asyncio.gather(_tutor_ws(), _reader())

        asyncio.run(_run())

        # 1. Tutor should have received WS 'read' event
        assert "read" in results.get("tutor", {}), f"tutor missed 'read' WS event: {results.get('tutor')}"
        ev = results["tutor"]["read"]
        assert ev.get("reader_id") == student["id"]
        assert ev.get("thread_key")
        assert ev.get("up_to_message_id") == m["id"]
        assert ev.get("read_at")

        # 2. Response returned from GET thread must include read=true + read_at for that msg
        msgs = results["thread_resp"]["messages"]
        target = [x for x in msgs if x["id"] == m["id"]]
        assert target and target[0].get("read") is True
        assert target[0].get("read_at")
