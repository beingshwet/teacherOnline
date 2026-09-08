"""TutorHive regression + coverage tests (iteration 2)."""
import os
import time
import threading
import requests
import pytest
from datetime import datetime, timedelta, timezone

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://learn-live-60.preview.emergentagent.com"
API = f"{BASE}/api"

ADMIN = ("admin@example.com", "Admin@12345")
TUTOR = ("tutor@example.com", "Tutor@12345")
STUDENT = ("student@example.com", "Student@12345")


def login(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def student_sess():
    return login(*STUDENT)


@pytest.fixture(scope="module")
def tutor_sess():
    return login(*TUTOR)


@pytest.fixture(scope="module")
def admin_sess():
    return login(*ADMIN)


# --- Health / Auth ---
def test_unauth_me():
    r = requests.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 401


def test_login_returns_role(student_sess, tutor_sess, admin_sess):
    for s, role in [(student_sess, "student"), (tutor_sess, "tutor"), (admin_sess, "admin")]:
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200
        body = r.json()
        role_val = body.get("role") or (body.get("user") or {}).get("role")
        assert role_val == role


# --- Tutors listing (only APPROVED) ---
def test_tutors_only_approved(admin_sess):
    r = requests.get(f"{API}/tutors")
    assert r.status_code == 200
    tutors = r.json().get("tutors", r.json()) if isinstance(r.json(), dict) else r.json()
    # accept both shapes
    items = tutors if isinstance(tutors, list) else r.json().get("items", [])
    assert len(items) >= 6, f"expected >=6 approved tutors, got {len(items)}"
    for t in items:
        assert t.get("approval_status", "APPROVED") == "APPROVED"


def test_new_tutor_pending_not_listed_then_approved(admin_sess):
    # Register a new tutor
    email = f"pending_tutor_{int(time.time())}@example.com"
    reg = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "Passw0rd@1", "first_name": "Pending",
        "last_name": "Tutor", "role": "tutor",
    })
    assert reg.status_code in (200, 201), reg.text
    new_tid = reg.json()["user"]["id"]
    # Should NOT appear in public list
    lst = requests.get(f"{API}/tutors").json()
    items = lst if isinstance(lst, list) else lst.get("tutors", lst.get("items", []))
    ids = [t.get("user_id") or t.get("id") for t in items]
    assert new_tid not in ids
    # Admin approves directly using known id
    ap = admin_sess.post(f"{API}/admin/tutors/{new_tid}/approve")
    assert ap.status_code == 200, ap.text
    # Now should appear
    lst2 = requests.get(f"{API}/tutors").json()
    items2 = lst2 if isinstance(lst2, list) else lst2.get("tutors", lst2.get("items", []))
    ids2 = [t.get("user_id") or t.get("id") for t in items2]
    assert new_tid in ids2


# --- Regression: tutor availability endpoint returns seeded slots ---
def test_tutor_me_availability_seeded(tutor_sess):
    r = tutor_sess.get(f"{API}/tutors/me/availability")
    assert r.status_code == 200, r.text
    slots = r.json().get("slots", [])
    assert len(slots) >= 5, f"expected >=5 seeded slots, got {len(slots)}: {slots}"


# --- Booking flow + review regression ---
def _next_weekday_with_avail(tutor_id):
    """Find first upcoming Mon-Thu 17:00 UTC slot at least 1h in future."""
    now = datetime.now(timezone.utc)
    for i in range(1, 10):
        d = now + timedelta(days=i)
        if d.weekday() in (0, 1, 2, 3):
            slot = datetime(d.year, d.month, d.day, 17, 0, tzinfo=timezone.utc)
            if slot > now + timedelta(hours=1):
                return slot
    return None


@pytest.fixture(scope="module")
def demo_tutor_id():
    r = requests.get(f"{API}/tutors")
    j = r.json()
    items = j if isinstance(j, list) else j.get("tutors", j.get("items", []))
    for t in items:
        em = t.get("email") or (t.get("user") or {}).get("email")
        # Public listing may not include email; fall back to matching by first_name
        if em == TUTOR[0] or t.get("first_name") == "Demo":
            return t.get("user_id") or t.get("id") or (t.get("user") or {}).get("id")
    # fallback: login as tutor and read /auth/me
    s = login(*TUTOR)
    return s.get(f"{API}/auth/me").json()["user"]["id"]


def test_double_booking_prevention(student_sess, demo_tutor_id):
    slot = _next_weekday_with_avail(demo_tutor_id)
    payload = {
        "tutor_id": demo_tutor_id,
        "subject": "Mathematics",
        "start_time": slot.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "duration_minutes": 60,
    }
    # first booking
    r1 = student_sess.post(f"{API}/bookings", json=payload)
    # If already booked (leftover), cancel and retry
    if r1.status_code == 409:
        # find + cancel
        b = student_sess.get(f"{API}/bookings").json()
        blist = b if isinstance(b, list) else b.get("bookings", b.get("items", []))
        for bk in blist:
            if bk.get("start_time", "").startswith(slot.strftime("%Y-%m-%dT%H:%M")):
                student_sess.post(f"{API}/bookings/{bk['id']}/cancel")
        r1 = student_sess.post(f"{API}/bookings", json=payload)
    assert r1.status_code == 200, r1.text
    bid1 = r1.json()["id"]
    # concurrent second attempt (same student, same slot) should be 409
    r2 = student_sess.post(f"{API}/bookings", json=payload)
    assert r2.status_code == 409
    assert "SLOT_UNAVAILABLE" in r2.text
    # store for later tests
    pytest.booking_id = bid1
    pytest.booking_slot = slot


def test_authorization_cross_student(demo_tutor_id):
    # Register a second student
    email = f"student2_{int(time.time())}@example.com"
    rr = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "Passw0rd@1",
        "first_name": "Stu2", "last_name": "Test", "role": "student"
    })
    assert rr.status_code in (200, 201)
    s2 = login(email, "Passw0rd@1")
    # try to fetch first student's booking
    bid = getattr(pytest, "booking_id", None)
    if not bid:
        pytest.skip("no booking to test")
    r = s2.get(f"{API}/bookings/{bid}")
    assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


def test_admin_forbidden_for_student(student_sess):
    r = student_sess.get(f"{API}/admin/dashboard")
    assert r.status_code == 403


def test_tutor_completes_booking_and_meet_url(tutor_sess):
    bid = getattr(pytest, "booking_id", None)
    if not bid:
        pytest.skip("no booking")
    r = tutor_sess.put(f"{API}/bookings/{bid}/meet-url",
                       json={"meet_url": "https://meet.google.com/abc-defg-hij"})
    assert r.status_code == 200, r.text
    assert r.json().get("meet_url", "").startswith("https://meet.google.com/")
    r2 = tutor_sess.post(f"{API}/bookings/{bid}/complete")
    assert r2.status_code == 200, r2.text


def test_review_endpoint_returns_200_json(student_sess):
    bid = getattr(pytest, "booking_id", None)
    if not bid:
        pytest.skip("no booking")
    r = student_sess.post(f"{API}/bookings/{bid}/review",
                          json={"rating": 5, "comment": "Excellent tutor!"})
    # If already reviewed from a previous run, 400 is acceptable BUT we want to prove 500 is fixed
    assert r.status_code in (200, 201, 400), f"got {r.status_code}: {r.text}"
    if r.status_code in (200, 201):
        body = r.json()
        assert "rating" in body
        assert body["rating"] == 5
        # ensure no _id leaked
        assert "_id" not in body


def test_student_dashboard_shows_bookings(student_sess):
    r = student_sess.get(f"{API}/bookings")
    assert r.status_code == 200
    j = r.json()
    items = j if isinstance(j, list) else j.get("bookings", j.get("items", []))
    assert len(items) >= 1


def test_admin_endpoints(admin_sess):
    for path in ["/admin/dashboard", "/admin/tutors", "/admin/students", "/admin/bookings"]:
        r = admin_sess.get(f"{API}{path}")
        assert r.status_code == 200, f"{path}: {r.status_code}"
