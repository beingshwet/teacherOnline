from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import asyncio
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta, time as dtime, date as ddate
from typing import List, Optional, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

# ------------------------------------------------------------
# Config
# ------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_ALGO = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]
ACCESS_MIN = 60 * 24 * 7  # 7 days
PLATFORM_COMMISSION = 20  # percent (config in DB later)

app = FastAPI(title="TutorHive API", version="1.0")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s - %(message)s')
log = logging.getLogger("tutorhive")

# ------------------------------------------------------------
# Helpers: hashing / jwt / time
# ------------------------------------------------------------
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=10)).decode()

def check_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def make_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_MIN),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()

def parse_iso(s: str) -> datetime:
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

# ------------------------------------------------------------
# Models
# ------------------------------------------------------------
Role = Literal["student", "tutor", "admin", "super_admin"]
BookingStatus = Literal["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]
TutorApprovalStatus = Literal["PENDING_APPROVAL", "APPROVED", "REJECTED", "SUSPENDED"]

class RegisterReq(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    phone: Optional[str] = None
    password: str
    role: Literal["student", "tutor"] = "student"

class LoginReq(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    phone: Optional[str] = None
    role: str
    status: str
    created_at: str

class TutorProfileUpdate(BaseModel):
    bio: Optional[str] = None
    qualifications: Optional[str] = None
    experience_years: Optional[int] = None
    subjects: Optional[List[str]] = None
    grade_levels: Optional[List[str]] = None
    languages: Optional[List[str]] = None
    hourly_price: Optional[float] = None
    photo_url: Optional[str] = None

class AvailabilitySlot(BaseModel):
    day_of_week: int  # 0=Mon..6=Sun
    start_time: str   # "HH:MM"
    end_time: str     # "HH:MM"

class AvailabilityUpdate(BaseModel):
    slots: List[AvailabilitySlot]
    timezone: str = "UTC"

class BookingCreate(BaseModel):
    tutor_id: str
    subject: str
    start_time: str  # ISO UTC
    duration_minutes: int = 60

class MeetUrlReq(BaseModel):
    meet_url: str

class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: Optional[str] = None

class SubjectIn(BaseModel):
    name: str
    description: Optional[str] = None

# ------------------------------------------------------------
# Auth dependency
# ------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"password_hash": 0, "_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user

def require_roles(*roles):
    async def _dep(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Forbidden")
        return user
    return _dep

def set_auth_cookie(resp: Response, token: str):
    resp.set_cookie(
        key="access_token", value=token, httponly=True, secure=True,
        samesite="none", max_age=ACCESS_MIN * 60, path="/",
    )

def user_to_out(u: dict) -> dict:
    return {
        "id": u["id"], "email": u["email"], "first_name": u["first_name"],
        "last_name": u["last_name"], "phone": u.get("phone"),
        "role": u["role"], "status": u.get("status", "ACTIVE"),
        "created_at": u["created_at"],
    }

# ------------------------------------------------------------
# Notifications helper
# ------------------------------------------------------------
async def notify(user_id: str, ntype: str, title: str, body: str):
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": ntype,
        "title": title,
        "body": body,
        "read": False,
        "created_at": iso(now_utc()),
    })

# ============================================================
# Auth endpoints
# ============================================================
@api.post("/auth/register")
async def register(body: RegisterReq, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email already registered")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid, "email": email, "password_hash": hash_pw(body.password),
        "first_name": body.first_name, "last_name": body.last_name,
        "phone": body.phone, "role": body.role, "status": "ACTIVE",
        "created_at": iso(now_utc()),
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    if body.role == "tutor":
        await db.tutor_profiles.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid,
            "bio": "", "qualifications": "", "experience_years": 0,
            "subjects": [], "grade_levels": [], "languages": ["English"],
            "hourly_price": 30.0, "photo_url": "",
            "approval_status": "PENDING_APPROVAL",
            "rating_avg": 0.0, "total_reviews": 0, "total_sessions": 0,
            "created_at": iso(now_utc()),
        })
    token = make_token(uid, email, body.role)
    set_auth_cookie(response, token)
    return {"user": user_to_out(doc), "access_token": token}

@api.post("/auth/login")
async def login(body: LoginReq, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not check_pw(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    if user.get("status") == "SUSPENDED":
        raise HTTPException(403, "Account suspended")
    token = make_token(user["id"], user["email"], user["role"])
    set_auth_cookie(response, token)
    return {"user": user_to_out(user), "access_token": token}

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": user_to_out(user)}

# ============================================================
# Subjects
# ============================================================
@api.get("/subjects")
async def list_subjects():
    subs = await db.subjects.find({"active": True}, {"_id": 0}).sort("name", 1).to_list(200)
    return subs

@api.post("/subjects")
async def add_subject(body: SubjectIn, _: dict = Depends(require_roles("admin", "super_admin"))):
    doc = {"id": str(uuid.uuid4()), "name": body.name, "description": body.description or "", "active": True}
    await db.subjects.insert_one(doc)
    doc.pop("_id", None)
    return doc

# ============================================================
# Tutors
# ============================================================
async def _hydrate_tutor(tp: dict) -> dict:
    u = await db.users.find_one({"id": tp["user_id"]}, {"_id": 0, "password_hash": 0}) or {}
    return {
        "id": tp["user_id"],  # public id = user_id
        "profile_id": tp["id"],
        "first_name": u.get("first_name", ""),
        "last_name": u.get("last_name", ""),
        "bio": tp.get("bio", ""),
        "qualifications": tp.get("qualifications", ""),
        "experience_years": tp.get("experience_years", 0),
        "subjects": tp.get("subjects", []),
        "grade_levels": tp.get("grade_levels", []),
        "languages": tp.get("languages", []),
        "hourly_price": tp.get("hourly_price", 0),
        "photo_url": tp.get("photo_url", ""),
        "rating_avg": tp.get("rating_avg", 0),
        "total_reviews": tp.get("total_reviews", 0),
        "total_sessions": tp.get("total_sessions", 0),
        "approval_status": tp.get("approval_status", "PENDING_APPROVAL"),
    }

@api.get("/tutors")
async def search_tutors(
    subject: Optional[str] = None,
    grade: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    min_rating: Optional[float] = None,
    language: Optional[str] = None,
    q: Optional[str] = None,
    page: int = 1,
    page_size: int = 12,
):
    query: dict = {"approval_status": "APPROVED"}
    if subject:
        query["subjects"] = subject
    if grade:
        query["grade_levels"] = grade
    if language:
        query["languages"] = language
    if min_price is not None or max_price is not None:
        pr = {}
        if min_price is not None: pr["$gte"] = min_price
        if max_price is not None: pr["$lte"] = max_price
        query["hourly_price"] = pr
    if min_rating is not None:
        query["rating_avg"] = {"$gte": min_rating}
    total = await db.tutor_profiles.count_documents(query)
    cursor = db.tutor_profiles.find(query, {"_id": 0}).skip((page - 1) * page_size).limit(page_size)
    tutors = []
    async for tp in cursor:
        hydrated = await _hydrate_tutor(tp)
        if q:
            hay = (hydrated["first_name"] + " " + hydrated["last_name"] + " " + hydrated["bio"]).lower()
            if q.lower() not in hay:
                continue
        tutors.append(hydrated)
    return {"tutors": tutors, "total": total, "page": page, "page_size": page_size}

@api.get("/tutors/{tutor_id}")
async def get_tutor(tutor_id: str):
    tp = await db.tutor_profiles.find_one({"user_id": tutor_id}, {"_id": 0})
    if not tp:
        raise HTTPException(404, "Tutor not found")
    tutor = await _hydrate_tutor(tp)
    reviews = await db.reviews.find({"tutor_id": tutor_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    # hydrate reviewer name
    for r in reviews:
        s = await db.users.find_one({"id": r["student_id"]}, {"_id": 0, "first_name": 1, "last_name": 1})
        r["student_name"] = f"{s['first_name']} {s['last_name'][:1]}." if s else "Student"
    return {"tutor": tutor, "reviews": reviews}

@api.put("/tutors/me/profile")
async def update_my_tutor(body: TutorProfileUpdate, user: dict = Depends(require_roles("tutor"))):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if update:
        await db.tutor_profiles.update_one({"user_id": user["id"]}, {"$set": update})
    tp = await db.tutor_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    return await _hydrate_tutor(tp)

@api.get("/tutors/me/profile")
async def get_my_tutor(user: dict = Depends(require_roles("tutor"))):
    tp = await db.tutor_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    if not tp:
        raise HTTPException(404, "Tutor profile missing")
    return await _hydrate_tutor(tp)

# ============================================================
# Availability
# ============================================================
@api.get("/tutors/me/availability")
async def get_my_availability(user: dict = Depends(require_roles("tutor"))):
    slots = await db.availability.find({"tutor_id": user["id"]}, {"_id": 0}).to_list(200)
    return {"slots": slots}

@api.get("/tutors/{tutor_id}/availability")
async def get_availability(tutor_id: str):
    slots = await db.availability.find({"tutor_id": tutor_id}, {"_id": 0}).to_list(200)
    return {"slots": slots}

@api.put("/tutors/me/availability")
async def set_availability(body: AvailabilityUpdate, user: dict = Depends(require_roles("tutor"))):
    await db.availability.delete_many({"tutor_id": user["id"]})
    if body.slots:
        docs = [{
            "id": str(uuid.uuid4()), "tutor_id": user["id"],
            "day_of_week": s.day_of_week, "start_time": s.start_time,
            "end_time": s.end_time, "timezone": body.timezone,
        } for s in body.slots]
        await db.availability.insert_many(docs)
    slots = await db.availability.find({"tutor_id": user["id"]}, {"_id": 0}).to_list(200)
    return {"slots": slots}

@api.get("/tutors/{tutor_id}/slots")
async def get_slots(tutor_id: str, date: str):
    """Return bookable 1-hour slots for a given date (YYYY-MM-DD) in UTC."""
    target = ddate.fromisoformat(date)
    dow = target.weekday()  # 0=Mon
    day_avail = await db.availability.find({"tutor_id": tutor_id, "day_of_week": dow}, {"_id": 0}).to_list(20)
    # Build 1-hour slots
    all_slots: list = []
    for a in day_avail:
        sh, sm = map(int, a["start_time"].split(":"))
        eh, em = map(int, a["end_time"].split(":"))
        cur = datetime.combine(target, dtime(sh, sm), tzinfo=timezone.utc)
        end = datetime.combine(target, dtime(eh, em), tzinfo=timezone.utc)
        while cur + timedelta(hours=1) <= end:
            all_slots.append(cur)
            cur += timedelta(hours=1)
    # Filter out booked
    day_start = datetime.combine(target, dtime(0, 0), tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    booked = await db.bookings.find({
        "tutor_id": tutor_id,
        "status": {"$in": ["PENDING", "CONFIRMED"]},
        "start_time": {"$gte": iso(day_start), "$lt": iso(day_end)},
    }, {"_id": 0, "start_time": 1}).to_list(100)
    booked_set = {b["start_time"] for b in booked}
    now = now_utc()
    result = []
    for s in all_slots:
        if s < now:
            continue
        s_iso = iso(s)
        result.append({"start_time": s_iso, "booked": s_iso in booked_set})
    return {"date": date, "slots": result}

# ============================================================
# Bookings
# ============================================================
@api.post("/bookings")
async def create_booking(body: BookingCreate, user: dict = Depends(require_roles("student"))):
    tp = await db.tutor_profiles.find_one({"user_id": body.tutor_id}, {"_id": 0})
    if not tp:
        raise HTTPException(404, "Tutor not found")
    if tp.get("approval_status") != "APPROVED":
        raise HTTPException(400, "Tutor not available for booking")
    start = parse_iso(body.start_time)
    if start < now_utc():
        raise HTTPException(400, "Cannot book in the past")
    end = start + timedelta(minutes=body.duration_minutes)
    # Check tutor availability window
    dow = start.weekday()
    day_avail = await db.availability.find({"tutor_id": body.tutor_id, "day_of_week": dow}, {"_id": 0}).to_list(20)
    ok_window = False
    for a in day_avail:
        sh, sm = map(int, a["start_time"].split(":"))
        eh, em = map(int, a["end_time"].split(":"))
        aw_start = datetime.combine(start.date(), dtime(sh, sm), tzinfo=timezone.utc)
        aw_end = datetime.combine(start.date(), dtime(eh, em), tzinfo=timezone.utc)
        if aw_start <= start and end <= aw_end:
            ok_window = True
            break
    if not ok_window:
        raise HTTPException(400, "Tutor not available for that time")
    # Overlap check (student & tutor)
    for owner_key, owner_id in [("tutor_id", body.tutor_id), ("student_id", user["id"])]:
        overlap = await db.bookings.find_one({
            owner_key: owner_id,
            "status": {"$in": ["PENDING", "CONFIRMED"]},
            "start_time": {"$lt": iso(end)},
            "end_time": {"$gt": iso(start)},
        })
        if overlap:
            raise HTTPException(409, "SLOT_UNAVAILABLE: That time slot is no longer available")
    # Insert with unique-slot guard
    booking_id = str(uuid.uuid4())
    price = float(tp.get("hourly_price", 30)) * (body.duration_minutes / 60.0)
    commission = round(price * PLATFORM_COMMISSION / 100.0, 2)
    doc = {
        "id": booking_id,
        "student_id": user["id"], "tutor_id": body.tutor_id,
        "subject": body.subject,
        "start_time": iso(start), "end_time": iso(end),
        "duration_minutes": body.duration_minutes,
        "status": "CONFIRMED",  # payment skipped in Phase 1
        "meet_url": "",
        "price": round(price, 2),
        "platform_fee": commission,
        "tutor_earnings": round(price - commission, 2),
        "created_at": iso(now_utc()),
        "updated_at": iso(now_utc()),
    }
    try:
        await db.bookings.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "SLOT_UNAVAILABLE: That time slot is no longer available")
    # Notifications
    tutor_user = await db.users.find_one({"id": body.tutor_id}, {"_id": 0})
    await notify(user["id"], "BOOKING_CONFIRMED",
                 "Booking confirmed",
                 f"Your session on {start.strftime('%b %d at %H:%M UTC')} is confirmed.")
    if tutor_user:
        await notify(tutor_user["id"], "BOOKING_CREATED",
                     "New booking",
                     f"{user['first_name']} booked a session for {start.strftime('%b %d at %H:%M UTC')}.")
    return await _hydrate_booking(doc)

async def _hydrate_booking(b: dict) -> dict:
    s = await db.users.find_one({"id": b["student_id"]}, {"_id": 0, "first_name": 1, "last_name": 1, "email": 1})
    t = await db.users.find_one({"id": b["tutor_id"]}, {"_id": 0, "first_name": 1, "last_name": 1, "email": 1})
    out = dict(b); out.pop("_id", None)
    out["student_name"] = f"{s['first_name']} {s['last_name']}" if s else ""
    out["tutor_name"] = f"{t['first_name']} {t['last_name']}" if t else ""
    out.setdefault("video_provider", "google_meet" if out.get("meet_url") else "builtin")
    return out

@api.get("/bookings")
async def list_bookings(user: dict = Depends(get_current_user), scope: Optional[str] = None):
    q: dict = {}
    if user["role"] == "student":
        q["student_id"] = user["id"]
    elif user["role"] == "tutor":
        q["tutor_id"] = user["id"]
    elif user["role"] in ("admin", "super_admin"):
        pass  # all
    if scope == "upcoming":
        q["start_time"] = {"$gte": iso(now_utc())}
        q["status"] = {"$in": ["CONFIRMED", "PENDING"]}
    elif scope == "past":
        q["$or"] = [{"start_time": {"$lt": iso(now_utc())}}, {"status": {"$in": ["COMPLETED", "CANCELLED", "NO_SHOW"]}}]
    cursor = db.bookings.find(q, {"_id": 0}).sort("start_time", 1).limit(200)
    items = []
    async for b in cursor:
        items.append(await _hydrate_booking(b))
    return {"bookings": items}

@api.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, user: dict = Depends(get_current_user)):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "student" and b["student_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    if user["role"] == "tutor" and b["tutor_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    review = await db.reviews.find_one({"booking_id": booking_id}, {"_id": 0})
    hydrated = await _hydrate_booking(b)
    hydrated["review"] = review
    return hydrated

@api.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, user: dict = Depends(get_current_user)):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "student" and b["student_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    if user["role"] == "tutor" and b["tutor_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    if b["status"] in ("CANCELLED", "COMPLETED"):
        raise HTTPException(400, "Cannot cancel this booking")
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "CANCELLED", "updated_at": iso(now_utc())}})
    await notify(b["student_id"], "BOOKING_CANCELLED", "Session cancelled", f"Your session was cancelled.")
    await notify(b["tutor_id"], "BOOKING_CANCELLED", "Session cancelled", f"A session was cancelled.")
    return {"ok": True}

@api.post("/bookings/{booking_id}/complete")
async def complete_booking(booking_id: str, user: dict = Depends(get_current_user)):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "tutor" and b["tutor_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    if user["role"] == "student":
        raise HTTPException(403, "Only tutor/admin can complete")
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "COMPLETED", "updated_at": iso(now_utc())}})
    await db.tutor_profiles.update_one({"user_id": b["tutor_id"]}, {"$inc": {"total_sessions": 1}})
    await notify(b["student_id"], "SESSION_COMPLETED", "Session completed", "Please rate your tutor!")
    return {"ok": True}

@api.put("/bookings/{booking_id}/meet-url")
async def set_meet_url(booking_id: str, body: MeetUrlReq, user: dict = Depends(require_roles("tutor", "admin", "super_admin"))):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "tutor" and b["tutor_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    if not (body.meet_url.startswith("https://meet.google.com/") or body.meet_url.startswith("https://")):
        raise HTTPException(400, "Invalid meeting URL")
    await db.bookings.update_one({"id": booking_id}, {"$set": {"meet_url": body.meet_url, "updated_at": iso(now_utc())}})
    await notify(b["student_id"], "MEET_URL_ADDED", "Class link ready", "Your tutor added the Google Meet link.")
    return {"ok": True, "meet_url": body.meet_url}

# ============================================================
# Video provider abstraction (Google Meet + Built-in Jitsi)
# ============================================================
class VideoProvider:
    key = "base"
    async def prepare_room(self, booking: dict) -> dict:
        raise NotImplementedError
    def join_info(self, booking: dict, user: dict) -> dict:
        raise NotImplementedError

class GoogleMeetProvider(VideoProvider):
    key = "google_meet"
    async def prepare_room(self, booking: dict) -> dict:
        return {"provider": "google_meet", "meet_url": booking.get("meet_url", "")}
    def join_info(self, booking: dict, user: dict) -> dict:
        return {"provider": "google_meet", "join_url": booking.get("meet_url", ""), "embed": False}

class JitsiProvider(VideoProvider):
    key = "builtin"
    domain = "meet.jit.si"
    async def prepare_room(self, booking: dict) -> dict:
        room = booking.get("video_room_name")
        if not room:
            # short, unguessable room name tied to booking
            room = f"tutorhive-{booking['id'].replace('-', '')[:16]}-{uuid.uuid4().hex[:8]}"
        return {"provider": "builtin", "domain": self.domain, "room_name": room}
    def join_info(self, booking: dict, user: dict) -> dict:
        room = booking.get("video_room_name") or ""
        return {
            "provider": "builtin",
            "domain": self.domain,
            "room_name": room,
            "user": {
                "displayName": f"{user.get('first_name','')} {user.get('last_name','')}".strip(),
                "email": user.get("email", ""),
            },
            "is_moderator": user.get("id") == booking.get("tutor_id") or user.get("role") in ("admin", "super_admin"),
            "embed": True,
        }

VIDEO_PROVIDERS = {p.key: p() for p in [GoogleMeetProvider, JitsiProvider]}

class VideoProviderReq(BaseModel):
    provider: Literal["google_meet", "builtin"]

@api.put("/bookings/{booking_id}/video-provider")
async def set_video_provider(booking_id: str, body: VideoProviderReq, user: dict = Depends(require_roles("tutor", "admin", "super_admin"))):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "tutor" and b["tutor_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    provider = VIDEO_PROVIDERS[body.provider]
    b["video_provider"] = body.provider
    room = await provider.prepare_room(b)
    update = {"video_provider": body.provider, "updated_at": iso(now_utc())}
    if body.provider == "builtin":
        update["video_room_name"] = room["room_name"]
    await db.bookings.update_one({"id": booking_id}, {"$set": update})
    await notify(b["student_id"], "VIDEO_ROOM_READY",
                 "Classroom ready",
                 "Your tutor set up the classroom for your upcoming session.")
    return {"ok": True, "provider": body.provider, "room": room}

@api.get("/bookings/{booking_id}/video-room")
async def get_video_room(booking_id: str, user: dict = Depends(get_current_user)):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "student" and b["student_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    if user["role"] == "tutor" and b["tutor_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    if b["status"] not in ("CONFIRMED", "COMPLETED"):
        raise HTTPException(400, "Session is not available")
    # Enforce join window: 10 min before start → 30 min after end
    start = parse_iso(b["start_time"]); end = parse_iso(b["end_time"])
    now = now_utc()
    open_from = start - timedelta(minutes=10)
    open_until = end + timedelta(minutes=30)
    if not (open_from <= now <= open_until):
        raise HTTPException(400, {
            "code": "ROOM_CLOSED",
            "message": "Classroom opens 10 minutes before session start.",
            "opens_at": iso(open_from),
            "closes_at": iso(open_until),
        })
    provider_key = b.get("video_provider") or ("google_meet" if b.get("meet_url") else "builtin")
    provider = VIDEO_PROVIDERS[provider_key]
    if provider_key == "builtin" and not b.get("video_room_name"):
        room = await provider.prepare_room(b)
        await db.bookings.update_one({"id": booking_id}, {"$set": {"video_room_name": room["room_name"], "video_provider": "builtin"}})
        b["video_room_name"] = room["room_name"]
    info = provider.join_info(b, user)
    info["booking"] = {
        "id": b["id"], "subject": b["subject"],
        "start_time": b["start_time"], "end_time": b["end_time"],
        "tutor_id": b["tutor_id"], "student_id": b["student_id"],
    }
    return info

# ============================================================
# Reviews
# ============================================================
@api.post("/bookings/{booking_id}/review")
async def add_review(booking_id: str, body: ReviewCreate, user: dict = Depends(require_roles("student"))):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if b["student_id"] != user["id"]:
        raise HTTPException(403, "Only the student who booked can review")
    if b["status"] != "COMPLETED":
        raise HTTPException(400, "Only completed sessions can be reviewed")
    existing = await db.reviews.find_one({"booking_id": booking_id})
    if existing:
        raise HTTPException(400, "Review already submitted")
    doc = {
        "id": str(uuid.uuid4()), "booking_id": booking_id,
        "student_id": user["id"], "tutor_id": b["tutor_id"],
        "rating": body.rating, "text": body.text or "",
        "created_at": iso(now_utc()),
    }
    await db.reviews.insert_one(doc)
    doc.pop("_id", None)
    # Recalc aggregate rating
    agg = await db.reviews.aggregate([
        {"$match": {"tutor_id": b["tutor_id"]}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    if agg:
        await db.tutor_profiles.update_one(
            {"user_id": b["tutor_id"]},
            {"$set": {"rating_avg": round(agg[0]["avg"], 2), "total_reviews": agg[0]["count"]}},
        )
    return doc

# ============================================================
# Notifications
# ============================================================
@api.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    items = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    unread = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"notifications": items, "unread": unread}

@api.post("/notifications/{nid}/read")
async def read_notification(nid: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one({"id": nid, "user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}

# ============================================================
# Admin
# ============================================================
@api.get("/admin/dashboard")
async def admin_dashboard(_: dict = Depends(require_roles("admin", "super_admin"))):
    total_students = await db.users.count_documents({"role": "student"})
    total_tutors = await db.users.count_documents({"role": "tutor"})
    active_tutors = await db.tutor_profiles.count_documents({"approval_status": "APPROVED"})
    total_bookings = await db.bookings.count_documents({})
    completed = await db.bookings.count_documents({"status": "COMPLETED"})
    cancelled = await db.bookings.count_documents({"status": "CANCELLED"})
    upcoming = await db.bookings.count_documents({"status": "CONFIRMED", "start_time": {"$gte": iso(now_utc())}})
    revenue_agg = await db.bookings.aggregate([
        {"$match": {"status": {"$in": ["CONFIRMED", "COMPLETED"]}}},
        {"$group": {"_id": None, "revenue": {"$sum": "$price"}, "fee": {"$sum": "$platform_fee"}}},
    ]).to_list(1)
    revenue = revenue_agg[0]["revenue"] if revenue_agg else 0
    fee = revenue_agg[0]["fee"] if revenue_agg else 0
    return {
        "total_students": total_students, "total_tutors": total_tutors,
        "active_tutors": active_tutors, "total_bookings": total_bookings,
        "completed_sessions": completed, "cancelled_sessions": cancelled,
        "upcoming_sessions": upcoming, "revenue": round(revenue, 2),
        "platform_fees": round(fee, 2),
    }

@api.get("/admin/tutors")
async def admin_list_tutors(status: Optional[str] = None, _: dict = Depends(require_roles("admin", "super_admin"))):
    q = {}
    if status:
        q["approval_status"] = status
    cursor = db.tutor_profiles.find(q, {"_id": 0}).sort("created_at", -1).limit(200)
    out = []
    async for tp in cursor:
        out.append(await _hydrate_tutor(tp))
    return {"tutors": out}

@api.post("/admin/tutors/{tutor_id}/approve")
async def admin_approve(tutor_id: str, _: dict = Depends(require_roles("admin", "super_admin"))):
    await db.tutor_profiles.update_one({"user_id": tutor_id}, {"$set": {"approval_status": "APPROVED"}})
    await notify(tutor_id, "TUTOR_APPROVED", "Profile approved", "You are now visible in tutor search.")
    return {"ok": True}

@api.post("/admin/tutors/{tutor_id}/reject")
async def admin_reject(tutor_id: str, _: dict = Depends(require_roles("admin", "super_admin"))):
    await db.tutor_profiles.update_one({"user_id": tutor_id}, {"$set": {"approval_status": "REJECTED"}})
    return {"ok": True}

@api.post("/admin/tutors/{tutor_id}/suspend")
async def admin_suspend(tutor_id: str, _: dict = Depends(require_roles("admin", "super_admin"))):
    await db.tutor_profiles.update_one({"user_id": tutor_id}, {"$set": {"approval_status": "SUSPENDED"}})
    return {"ok": True}

@api.get("/admin/students")
async def admin_list_students(_: dict = Depends(require_roles("admin", "super_admin"))):
    students = await db.users.find({"role": "student"}, {"_id": 0, "password_hash": 0}).limit(500).to_list(500)
    return {"students": students}

@api.get("/admin/bookings")
async def admin_list_bookings(_: dict = Depends(require_roles("admin", "super_admin"))):
    cursor = db.bookings.find({}, {"_id": 0}).sort("start_time", -1).limit(200)
    items = []
    async for b in cursor:
        items.append(await _hydrate_booking(b))
    return {"bookings": items}

# ============================================================
# Tutor earnings
# ============================================================
@api.get("/tutors/me/earnings")
async def tutor_earnings(user: dict = Depends(require_roles("tutor"))):
    completed = await db.bookings.count_documents({"tutor_id": user["id"], "status": "COMPLETED"})
    upcoming = await db.bookings.count_documents({"tutor_id": user["id"], "status": "CONFIRMED", "start_time": {"$gte": iso(now_utc())}})
    cancelled = await db.bookings.count_documents({"tutor_id": user["id"], "status": "CANCELLED"})
    earned_agg = await db.bookings.aggregate([
        {"$match": {"tutor_id": user["id"], "status": "COMPLETED"}},
        {"$group": {"_id": None, "earnings": {"$sum": "$tutor_earnings"}, "fee": {"$sum": "$platform_fee"}}},
    ]).to_list(1)
    pending_agg = await db.bookings.aggregate([
        {"$match": {"tutor_id": user["id"], "status": "CONFIRMED"}},
        {"$group": {"_id": None, "earnings": {"$sum": "$tutor_earnings"}}},
    ]).to_list(1)
    return {
        "completed_sessions": completed, "upcoming_sessions": upcoming, "cancelled_sessions": cancelled,
        "total_earnings": round(earned_agg[0]["earnings"], 2) if earned_agg else 0,
        "pending_earnings": round(pending_agg[0]["earnings"], 2) if pending_agg else 0,
        "platform_fees": round(earned_agg[0]["fee"], 2) if earned_agg else 0,
    }

# ============================================================
# Email reminders (mock provider) + scheduler
# ============================================================
REMINDER_CHECKPOINTS = [
    {"key": "24h", "minutes_before": 24 * 60, "label": "24 hours"},
    {"key": "1h",  "minutes_before": 60,      "label": "1 hour"},
    {"key": "10m", "minutes_before": 10,      "label": "10 minutes"},
]

class EmailProvider:
    """Abstraction so a real provider (SendGrid/Resend) can replace this later."""
    async def send(self, to_email: str, to_name: str, subject: str, body: str, meta: dict):
        raise NotImplementedError

class MockEmailProvider(EmailProvider):
    async def send(self, to_email, to_name, subject, body, meta):
        log.info("[EMAIL:MOCK] to=%s <%s> | subject=%s | booking=%s checkpoint=%s",
                 to_name, to_email, subject, meta.get("booking_id"), meta.get("checkpoint"))
        log.info("[EMAIL:MOCK BODY]\n%s\n---", body)
        await db.email_log.insert_one({
            "id": str(uuid.uuid4()),
            "to_email": to_email, "to_name": to_name,
            "subject": subject, "body": body, "meta": meta,
            "provider": "mock",
            "sent_at": iso(now_utc()),
        })

email_provider: EmailProvider = MockEmailProvider()

def _render_reminder(booking: dict, recipient: dict, other: dict, checkpoint_label: str) -> tuple:
    start = parse_iso(booking["start_time"])
    when_pretty = start.strftime("%A, %b %d at %H:%M UTC")
    role_line = "your student" if recipient.get("role") == "tutor" else "your tutor"
    subject = f"Your {booking['subject']} session starts in {checkpoint_label}"
    join_line = booking.get("meet_url") or "The Google Meet link will appear on your session page."
    body = (
        f"Hi {recipient.get('first_name','')},\n\n"
        f"This is a friendly reminder that your {booking['subject']} session with "
        f"{role_line} {other.get('first_name','')} {other.get('last_name','')} starts in "
        f"{checkpoint_label}.\n\n"
        f"When: {when_pretty}\n"
        f"Duration: {booking['duration_minutes']} minutes\n"
        f"Join Class: {join_line}\n\n"
        f"See you there!\n"
        f"— TutorHive"
    )
    return subject, body

async def _fire_reminder(booking: dict, checkpoint_key: str, checkpoint_label: str):
    student = await db.users.find_one({"id": booking["student_id"]}, {"_id": 0}) or {}
    tutor = await db.users.find_one({"id": booking["tutor_id"]}, {"_id": 0}) or {}
    # Email both parties
    for recipient, other in [(student, tutor), (tutor, student)]:
        if not recipient.get("email"):
            continue
        subject, body = _render_reminder(booking, recipient, other, checkpoint_label)
        await email_provider.send(
            to_email=recipient["email"],
            to_name=f"{recipient.get('first_name','')} {recipient.get('last_name','')}".strip(),
            subject=subject,
            body=body,
            meta={"booking_id": booking["id"], "checkpoint": checkpoint_key, "role": recipient.get("role")},
        )
    # In-app notification for both
    await notify(booking["student_id"], f"SESSION_REMINDER_{checkpoint_key.upper()}",
                 f"Session starts in {checkpoint_label}",
                 f"Your {booking['subject']} session with {tutor.get('first_name','')} starts in {checkpoint_label}.")
    await notify(booking["tutor_id"], f"SESSION_REMINDER_{checkpoint_key.upper()}",
                 f"Session starts in {checkpoint_label}",
                 f"Your {booking['subject']} session with {student.get('first_name','')} starts in {checkpoint_label}.")

async def _run_reminder_cycle():
    """Scan upcoming CONFIRMED bookings and fire any due reminders (idempotent via reminders_sent)."""
    now = now_utc()
    horizon = now + timedelta(minutes=REMINDER_CHECKPOINTS[0]["minutes_before"] + 30)
    cursor = db.bookings.find({
        "status": "CONFIRMED",
        "start_time": {"$gte": iso(now), "$lte": iso(horizon)},
    }, {"_id": 0})
    async for b in cursor:
        start = parse_iso(b["start_time"])
        minutes_until = (start - now).total_seconds() / 60.0
        sent = b.get("reminders_sent") or {}
        for cp in REMINDER_CHECKPOINTS:
            if sent.get(cp["key"]):
                continue
            # Fire when we're within the checkpoint window (catch-up if scheduler was down)
            if minutes_until <= cp["minutes_before"]:
                try:
                    await _fire_reminder(b, cp["key"], cp["label"])
                    await db.bookings.update_one(
                        {"id": b["id"]},
                        {"$set": {f"reminders_sent.{cp['key']}": iso(now_utc())}},
                    )
                    log.info("Reminder %s fired for booking %s", cp["key"], b["id"])
                except Exception as e:
                    log.exception("Reminder %s failed for booking %s: %s", cp["key"], b["id"], e)

async def reminder_scheduler_loop():
    log.info("Reminder scheduler started (interval=60s)")
    while True:
        try:
            await _run_reminder_cycle()
        except Exception as e:
            log.exception("Reminder cycle error: %s", e)
        await asyncio.sleep(60)

# Admin: view email log
@api.get("/admin/email-log")
async def admin_email_log(_: dict = Depends(require_roles("admin", "super_admin")), limit: int = 100):
    items = await db.email_log.find({}, {"_id": 0}).sort("sent_at", -1).limit(limit).to_list(limit)
    return {"emails": items}

# Admin: manually trigger a reminder cycle (useful for demos/testing)
@api.post("/admin/reminders/run")
async def admin_run_reminders(_: dict = Depends(require_roles("admin", "super_admin"))):
    await _run_reminder_cycle()
    return {"ok": True, "ran_at": iso(now_utc())}

# ============================================================
# CORS + startup
# ============================================================
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    # Indexes
    await db.users.create_index([("email", ASCENDING)], unique=True)
    await db.users.create_index([("id", ASCENDING)], unique=True)
    await db.tutor_profiles.create_index([("user_id", ASCENDING)], unique=True)
    await db.availability.create_index([("tutor_id", ASCENDING), ("day_of_week", ASCENDING)])
    await db.bookings.create_index([("id", ASCENDING)], unique=True)
    await db.bookings.create_index(
        [("tutor_id", ASCENDING), ("start_time", ASCENDING)],
        unique=True,
        partialFilterExpression={"status": {"$in": ["PENDING", "CONFIRMED"]}},
    )
    await db.reviews.create_index([("booking_id", ASCENDING)], unique=True)
    await db.notifications.create_index([("user_id", ASCENDING), ("created_at", -1)])
    await db.email_log.create_index([("sent_at", -1)])
    await seed()
    # Launch background reminder scheduler (no external cron needed)
    asyncio.create_task(reminder_scheduler_loop())

@app.on_event("shutdown")
async def shutdown():
    client.close()

# ------------------------------------------------------------
# Seed data
# ------------------------------------------------------------
DEMO_TUTORS = [
    {
        "email": "john.smith@example.com", "first_name": "John", "last_name": "Smith",
        "bio": "Passionate mathematics tutor with a decade of classroom experience. I focus on building intuition and confidence, not memorization.",
        "qualifications": "MSc Mathematics, Stanford University", "experience_years": 10,
        "subjects": ["Mathematics", "Algebra", "Geometry"], "grade_levels": ["4", "5", "6", "7"],
        "languages": ["English"], "hourly_price": 30.0,
        "photo_url": "https://images.pexels.com/photos/8423069/pexels-photo-8423069.jpeg",
    },
    {
        "email": "aisha.patel@example.com", "first_name": "Aisha", "last_name": "Patel",
        "bio": "Physics and chemistry specialist. IB and AP curriculum expert. Turning tough concepts into 'aha' moments.",
        "qualifications": "PhD Physics, MIT", "experience_years": 8,
        "subjects": ["Physics", "Chemistry"], "grade_levels": ["9", "10", "11", "12"],
        "languages": ["English", "Hindi"], "hourly_price": 45.0,
        "photo_url": "https://images.pexels.com/photos/8423388/pexels-photo-8423388.jpeg",
    },
    {
        "email": "carlos.gomez@example.com", "first_name": "Carlos", "last_name": "Gomez",
        "bio": "Full-stack developer teaching programming to teens and adults. Python, JavaScript, and computer science fundamentals.",
        "qualifications": "BSc Computer Science, ex-Google", "experience_years": 6,
        "subjects": ["Computer Science", "Programming"], "grade_levels": ["9", "10", "11", "12", "College"],
        "languages": ["English", "Spanish"], "hourly_price": 50.0,
        "photo_url": "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=400",
    },
    {
        "email": "emma.wilson@example.com", "first_name": "Emma", "last_name": "Wilson",
        "bio": "English literature and writing coach. I help students find their voice and ace essay assignments.",
        "qualifications": "MA English Literature, Oxford", "experience_years": 12,
        "subjects": ["English"], "grade_levels": ["6", "7", "8", "9", "10"],
        "languages": ["English"], "hourly_price": 35.0,
        "photo_url": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
    },
    {
        "email": "raj.kumar@example.com", "first_name": "Raj", "last_name": "Kumar",
        "bio": "Biology & general science tutor. Bringing microscopes and ecosystems into your living room.",
        "qualifications": "MSc Biology, IIT Delhi", "experience_years": 5,
        "subjects": ["Science", "Biology"], "grade_levels": ["6", "7", "8", "9"],
        "languages": ["English", "Hindi"], "hourly_price": 25.0,
        "photo_url": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
    },
]

DEFAULT_AVAILABILITY = [
    {"day_of_week": 0, "start_time": "17:00", "end_time": "21:00"},
    {"day_of_week": 1, "start_time": "17:00", "end_time": "21:00"},
    {"day_of_week": 2, "start_time": "17:00", "end_time": "21:00"},
    {"day_of_week": 3, "start_time": "17:00", "end_time": "21:00"},
    {"day_of_week": 5, "start_time": "10:00", "end_time": "14:00"},
]

DEFAULT_SUBJECTS = [
    "Mathematics", "Algebra", "Geometry", "Science", "Biology",
    "Physics", "Chemistry", "English", "Computer Science", "Programming",
]

async def _create_user(email, password, role, first, last):
    existing = await db.users.find_one({"email": email})
    if existing:
        return existing["id"]
    uid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": uid, "email": email, "password_hash": hash_pw(password),
        "first_name": first, "last_name": last, "phone": None,
        "role": role, "status": "ACTIVE", "created_at": iso(now_utc()),
    })
    return uid

async def seed():
    # Subjects
    for s in DEFAULT_SUBJECTS:
        if not await db.subjects.find_one({"name": s}):
            await db.subjects.insert_one({"id": str(uuid.uuid4()), "name": s, "description": "", "active": True})

    # Admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "Admin@12345")
    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        await _create_user(admin_email, admin_pw, "admin", "Platform", "Admin")
    elif not check_pw(admin_pw, existing_admin["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_pw(admin_pw)}})

    # Demo student
    student_email = os.environ.get("DEMO_STUDENT_EMAIL", "student@example.com")
    student_pw = os.environ.get("DEMO_STUDENT_PASSWORD", "Student@12345")
    await _create_user(student_email, student_pw, "student", "Jane", "Doe")

    # Demo tutor account (approved)
    tutor_email = os.environ.get("DEMO_TUTOR_EMAIL", "tutor@example.com")
    tutor_pw = os.environ.get("DEMO_TUTOR_PASSWORD", "Tutor@12345")
    tutor_uid = await _create_user(tutor_email, tutor_pw, "tutor", "Demo", "Tutor")
    if not await db.tutor_profiles.find_one({"user_id": tutor_uid}):
        await db.tutor_profiles.insert_one({
            "id": str(uuid.uuid4()), "user_id": tutor_uid,
            "bio": "Demo tutor account for testing bookings and dashboard flows.",
            "qualifications": "Demo", "experience_years": 3,
            "subjects": ["Mathematics"], "grade_levels": ["5", "6"],
            "languages": ["English"], "hourly_price": 20.0,
            "photo_url": "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400",
            "approval_status": "APPROVED",
            "rating_avg": 0.0, "total_reviews": 0, "total_sessions": 0,
            "created_at": iso(now_utc()),
        })
        for a in DEFAULT_AVAILABILITY:
            await db.availability.insert_one({
                "id": str(uuid.uuid4()), "tutor_id": tutor_uid,
                **a, "timezone": "UTC",
            })

    # Sample tutors
    for t in DEMO_TUTORS:
        uid = await _create_user(t["email"], "Password@123", "tutor", t["first_name"], t["last_name"])
        if not await db.tutor_profiles.find_one({"user_id": uid}):
            await db.tutor_profiles.insert_one({
                "id": str(uuid.uuid4()), "user_id": uid,
                "bio": t["bio"], "qualifications": t["qualifications"],
                "experience_years": t["experience_years"],
                "subjects": t["subjects"], "grade_levels": t["grade_levels"],
                "languages": t["languages"], "hourly_price": t["hourly_price"],
                "photo_url": t["photo_url"],
                "approval_status": "APPROVED",
                "rating_avg": round(4.5 + (t["experience_years"] % 5) * 0.1, 2),
                "total_reviews": 12 + t["experience_years"],
                "total_sessions": 50 + t["experience_years"] * 10,
                "created_at": iso(now_utc()),
            })
            for a in DEFAULT_AVAILABILITY:
                await db.availability.insert_one({
                    "id": str(uuid.uuid4()), "tutor_id": uid,
                    **a, "timezone": "UTC",
                })
