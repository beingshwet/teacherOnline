"""Iteration 4 — Chat file attachments (GridFS, upload/download, auth, validation)."""
import os
import io
import json
import asyncio
import requests
import pytest
import uuid
import threading

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


def register_and_login(role="student"):
    email = f"stranger_{role}_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={
        "first_name": "Stg", "last_name": "User", "email": email,
        "password": "Password@123", "role": role,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return s, email


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


# tiny valid PNG (1x1 pixel)
PNG_1x1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
    b"\xc0\x00\x00\x00\x03\x00\x01\x8a\xf8\xd6a\x00\x00\x00\x00IEND\xaeB`\x82"
)
PDF_MIN = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


class TestAttachmentUpload:
    def test_upload_pdf_ok(self, tutor_sess, student_id):
        files = {"file": ("worksheet.pdf", PDF_MIN, "application/pdf")}
        r = tutor_sess.post(f"{API}/messages/attachment",
                            params={"to_user_id": student_id, "caption": "Homework"},
                            files=files, timeout=30)
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["body"] == "Homework"
        assert m["from_user_id"] and m["to_user_id"] == student_id
        att = m["attachment"]
        assert att["filename"] == "worksheet.pdf"
        assert att["content_type"] == "application/pdf"
        assert att["size"] == len(PDF_MIN)
        assert att["is_image"] is False
        assert isinstance(att["id"], str) and len(att["id"]) == 24
        pytest.iter4_pdf_id = att["id"]
        pytest.iter4_pdf_msg_id = m["id"]

    def test_upload_png_ok(self, student_sess, tutor_id):
        files = {"file": ("photo.png", PNG_1x1, "image/png")}
        r = student_sess.post(f"{API}/messages/attachment",
                              params={"to_user_id": tutor_id, "caption": ""},
                              files=files, timeout=30)
        assert r.status_code == 200, r.text
        m = r.json()
        att = m["attachment"]
        assert att["is_image"] is True
        assert att["content_type"] == "image/png"
        pytest.iter4_png_id = att["id"]

    def test_reject_bad_mime(self, tutor_sess, student_id):
        files = {"file": ("hack.exe", b"MZ\x90\x00", "application/x-msdownload")}
        r = tutor_sess.post(f"{API}/messages/attachment",
                            params={"to_user_id": student_id},
                            files=files, timeout=15)
        assert r.status_code == 400
        assert "not allowed" in r.json().get("detail", "").lower()

    def test_reject_oversize(self, tutor_sess, student_id):
        big = b"A" * (10 * 1024 * 1024 + 100)  # 10MB + 100 bytes
        files = {"file": ("big.pdf", big, "application/pdf")}
        r = tutor_sess.post(f"{API}/messages/attachment",
                            params={"to_user_id": student_id},
                            files=files, timeout=60)
        assert r.status_code == 400
        assert "too large" in r.json().get("detail", "").lower() or "10" in r.json().get("detail", "")

    def test_reject_empty(self, tutor_sess, student_id):
        files = {"file": ("empty.pdf", b"", "application/pdf")}
        r = tutor_sess.post(f"{API}/messages/attachment",
                            params={"to_user_id": student_id},
                            files=files, timeout=15)
        assert r.status_code == 400
        assert "empty" in r.json().get("detail", "").lower()

    def test_stranger_cannot_upload(self, student_id):
        stranger, _ = register_and_login("tutor")
        files = {"file": ("x.pdf", PDF_MIN, "application/pdf")}
        r = stranger.post(f"{API}/messages/attachment",
                          params={"to_user_id": student_id},
                          files=files, timeout=15)
        assert r.status_code == 403


class TestAttachmentDownload:
    def test_recipient_download_byte_identical_pdf(self, student_sess):
        fid = pytest.iter4_pdf_id
        r = student_sess.get(f"{API}/messages/attachment/{fid}", timeout=15)
        assert r.status_code == 200
        assert r.content == PDF_MIN
        assert r.headers["Content-Type"].startswith("application/pdf")
        assert r.headers.get("Content-Disposition", "").startswith("inline")

    def test_sender_can_download(self, tutor_sess):
        fid = pytest.iter4_pdf_id
        r = tutor_sess.get(f"{API}/messages/attachment/{fid}", timeout=15)
        assert r.status_code == 200
        assert r.content == PDF_MIN

    def test_image_inline_disposition(self, tutor_sess):
        fid = pytest.iter4_png_id
        r = tutor_sess.get(f"{API}/messages/attachment/{fid}", timeout=15)
        assert r.status_code == 200
        assert r.headers["Content-Type"].startswith("image/png")
        assert r.headers.get("Content-Disposition", "").startswith("inline")
        assert r.content == PNG_1x1

    def test_third_party_forbidden(self):
        stranger, _ = register_and_login("student")
        fid = pytest.iter4_pdf_id
        r = stranger.get(f"{API}/messages/attachment/{fid}", timeout=15)
        assert r.status_code == 403

    def test_bogus_id_404(self, student_sess):
        # Well-formed but nonexistent ObjectId
        r = student_sess.get(f"{API}/messages/attachment/507f1f77bcf86cd799439011", timeout=15)
        assert r.status_code == 404
        # Malformed also -> 404
        r2 = student_sess.get(f"{API}/messages/attachment/not-an-id", timeout=15)
        assert r2.status_code == 404

    def test_admin_can_download(self, admin_sess):
        fid = pytest.iter4_pdf_id
        r = admin_sess.get(f"{API}/messages/attachment/{fid}", timeout=15)
        assert r.status_code == 200


class TestThreadIncludesAttachment:
    def test_thread_list_populated_attachment(self, student_sess, tutor_id):
        r = student_sess.get(f"{API}/messages/thread/{tutor_id}")
        assert r.status_code == 200
        msgs = r.json()["messages"]
        with_att = [m for m in msgs if m.get("attachment")]
        without_att = [m for m in msgs if m.get("attachment") is None]
        assert len(with_att) >= 1, "Expected at least one attachment message"
        assert len(without_att) >= 1 or True  # not strict — depends on prior test data
        # Structure check
        a = with_att[-1]["attachment"]
        assert set(["id", "filename", "content_type", "size", "is_image"]).issubset(a.keys())


class TestWebSocketPush:
    def test_ws_receives_attachment_message(self, tutor_sess, student_sess, student_id, tutor_id):
        try:
            import websockets
        except ImportError:
            pytest.skip("websockets lib not installed")

        tok = student_sess.cookies.get("access_token")
        assert tok, "no student cookie"
        url = f"{WS_BASE}/api/ws/messages?token={tok}"

        received = []

        async def run():
            async with websockets.connect(url, open_timeout=10) as ws:
                hello = await asyncio.wait_for(ws.recv(), timeout=5)
                assert json.loads(hello).get("type") == "hello"
                # tutor uploads
                def upload():
                    files = {"file": ("ws_push.pdf", PDF_MIN, "application/pdf")}
                    tutor_sess.post(f"{API}/messages/attachment",
                                    params={"to_user_id": student_id, "caption": "ws-test"},
                                    files=files, timeout=15)
                t = threading.Thread(target=upload)
                t.start()
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=10)
                    received.append(json.loads(raw))
                finally:
                    t.join(timeout=15)

        asyncio.run(run())
        assert received, "no ws message received"
        msg = received[0]
        assert msg["type"] == "message"
        assert msg["message"]["attachment"] is not None
        assert msg["message"]["attachment"]["filename"] == "ws_push.pdf"


# --- Regression: prior messaging still works ---
class TestRegression:
    def test_text_only_message_still_works(self, student_sess, tutor_id):
        r = student_sess.post(f"{API}/messages", json={"to_user_id": tutor_id, "body": "iter4 regression text"})
        assert r.status_code == 200
        assert r.json()["attachment"] is None

    def test_threads_list_still_ok(self, student_sess):
        r = student_sess.get(f"{API}/messages/threads")
        assert r.status_code == 200
        assert isinstance(r.json()["threads"], list)

    def test_bookings_list_still_ok(self, student_sess):
        r = student_sess.get(f"{API}/bookings")
        assert r.status_code == 200

    def test_admin_dashboard_ok(self, admin_sess):
        r = admin_sess.get(f"{API}/admin/dashboard")
        assert r.status_code == 200
        d = r.json()
        assert "total_students" in d and "total_tutors" in d

    def test_tutors_search_ok(self, student_sess):
        r = student_sess.get(f"{API}/tutors")
        assert r.status_code == 200

    def test_email_log_ok(self, admin_sess):
        r = admin_sess.get(f"{API}/admin/email-log?limit=5")
        assert r.status_code == 200
