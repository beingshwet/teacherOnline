# TutorHive — Product Requirements Document

## Problem Statement
Build a 1-to-1 online tutoring platform (Phase 1, web-only) that connects students with vetted tutors for personalized sessions. Students discover tutors, check availability, book sessions and join classes on Google Meet. Tutors manage availability, bookings and share Meet links. Admins approve tutors and oversee the platform.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async). Single modular monolith, all routes prefixed `/api`.
- **Frontend**: React 19 + React Router 7 + TanStack Query + Tailwind CSS. Custom design system inspired by Swiss / organic (Terracotta + Sage).
- **Auth**: JWT (7d) via httpOnly cookie, bcrypt hashing, role-based (student/tutor/admin/super_admin).
- **Video**: MVP approach — tutor pastes Google Meet URL. Architected so a `VideoProvider` abstraction can replace it later (e.g., LiveKit).
- **Payments/Email**: SKIPPED / MOCKED in Phase 1 per user choice (bookings auto-confirm, notifications in-app only).

## User Personas
1. **Student** — Discovers tutors, books sessions, joins Meet, reviews.
2. **Tutor** — Creates profile, sets weekly availability, manages bookings, shares Meet URL, tracks earnings.
3. **Admin** — Approves/suspends tutors, oversees revenue and platform activity.

## Core Requirements (P0 — Delivered)
- [x] Auth (register/login/logout/me) with role choice at signup
- [x] Tutor profiles (bio, subjects, grades, languages, price, photo, ratings)
- [x] Tutor discovery/search with subject / grade / price / language / query filters + pagination
- [x] Weekly recurring availability (Mon–Sun, multiple time ranges, UTC-normalized)
- [x] Booking flow with 7-day picker + 1-hour slot grid
- [x] Double-booking prevention (partial unique index + overlap query)
- [x] Booking lifecycle: CONFIRMED → COMPLETED / CANCELLED
- [x] Google Meet URL per booking (tutor edits, student joins)
- [x] Reviews (5-star + text, one per completed booking, aggregate rating)
- [x] Student dashboard (upcoming/past sessions + quick actions)
- [x] Tutor dashboard (upcoming sessions + earnings + platform fee breakdown)
- [x] Admin dashboard (9 platform stats)
- [x] Admin tutor management (approve/reject/suspend, only APPROVED visible in search)
- [x] In-app notifications (booking created/confirmed/completed/cancelled/meet-url)
- [x] Configurable platform commission (default 20%) with tutor_earnings computed per booking
- [x] Role-based authorization enforced on backend (no student can view another student's booking)

## Implemented (Jan 2026)
- Backend `/app/backend/server.py` with 40+ endpoints, MongoDB indexes, seed data (6 tutors + demo student/admin + 10 subjects + weekly availability)
- Frontend with 20+ routes: Landing, Login/Register, TutorSearch, TutorProfile, StudentDashboard, TutorDashboard/Profile/Availability/Earnings, BookingsList/Detail, Admin (dashboard/tutors/students/bookings), Notifications
- Design system: Cabinet Grotesk + Manrope typography, terracotta primary, glass sticky header, dashboard sidebar
- 12/12 backend regression tests pass at `/app/backend/tests/test_tutorhive.py`
- Test credentials: `/app/memory/test_credentials.md`

## Prioritized Backlog

### P1 (next up)
- [x] **Session reminder scheduler (24h / 1h / 10m) with mock email provider + in-app notifications** (Jan 2026)
- [x] Admin email log viewer (/admin/emails) with manual "run now" trigger
- [x] **Built-in live classroom via Jitsi Meet** (free, no API keys) — video, screen share, chat, whiteboard, recording. Tutor picks per-session between "Built-in classroom" and "Google Meet". Room opens 10 min before start, closes 30 min after end. (Jan 2026)
- Swap MockEmailProvider for SendGrid or Resend (drop-in — implement EmailProvider.send)
- Messaging (student ↔ tutor) via WebSocket
- Cancellation/refund workflow (with cutoff windows)
- Stripe payment integration (playbook-based)
- Tutor profile picture upload to S3

### P2
- Timezone-aware availability (currently UTC only)
- Recurring bookings / packages
- Native mobile apps (React Native, same API)
- LiveKit / built-in video provider
- Whiteboard, recording, transcripts

## Key Architectural Decisions
- MongoDB used with **partial unique index** on `(tutor_id, start_time)` filtered by `status ∈ {PENDING, CONFIRMED}` to guarantee no double-booking at DB level, plus range-overlap query for student & tutor.
- UUID public IDs (`id` field), never exposing MongoDB `_id`.
- Video provider abstraction is currently a plain `meet_url` string field on the booking — future work will introduce a `VideoProvider` service class.
- All timestamps stored as UTC ISO strings; frontend converts to local via `toLocaleString`.
- CORS: explicit origins only (browsers reject `*` + credentials).
