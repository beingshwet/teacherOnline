import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api, formatError, fmtDate } from "@/lib/api";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Wallet, CalendarClock, CheckCheck, XCircle } from "lucide-react";

export function TutorDashboard() {
  const [upcoming, setUpcoming] = useState([]);
  const [earnings, setEarnings] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    api.get("/bookings", { params: { scope: "upcoming" } }).then((r) => setUpcoming(r.data.bookings || []));
    api.get("/tutors/me/earnings").then((r) => setEarnings(r.data));
    api.get("/tutors/me/profile").then((r) => setProfile(r.data));
  }, []);

  return (
    <DashboardLayout title="Tutor dashboard">
      {profile?.approval_status !== "APPROVED" && (
        <div className="card-flat p-5 bg-accent border-primary/30 mb-6" data-testid="pending-approval-banner">
          <div className="font-semibold text-accent-foreground">Your profile is <strong>{profile?.approval_status?.replace("_", " ").toLowerCase()}</strong>.</div>
          <div className="text-sm text-accent-foreground/80 mt-1">You won't appear in tutor search until an admin approves you. Complete your <Link to="/tutor/profile" className="underline">profile</Link> and add <Link to="/tutor/availability" className="underline">availability</Link>.</div>
        </div>
      )}

      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <div className="card-flat p-5 bg-white" data-testid="stat-earnings">
          <Wallet className="text-primary mb-3" />
          <div className="text-xs text-muted-foreground">Total earnings</div>
          <div className="stat-num mt-1">${earnings?.total_earnings ?? 0}</div>
        </div>
        <div className="card-flat p-5 bg-white" data-testid="stat-pending">
          <Wallet className="text-primary mb-3" />
          <div className="text-xs text-muted-foreground">Pending</div>
          <div className="stat-num mt-1">${earnings?.pending_earnings ?? 0}</div>
        </div>
        <div className="card-flat p-5 bg-white" data-testid="stat-upcoming">
          <CalendarClock className="text-primary mb-3" />
          <div className="text-xs text-muted-foreground">Upcoming</div>
          <div className="stat-num mt-1">{earnings?.upcoming_sessions ?? 0}</div>
        </div>
        <div className="card-flat p-5 bg-white" data-testid="stat-completed">
          <CheckCheck className="text-primary mb-3" />
          <div className="text-xs text-muted-foreground">Completed</div>
          <div className="stat-num mt-1">{earnings?.completed_sessions ?? 0}</div>
        </div>
      </div>

      <h2 className="font-display font-extrabold text-2xl mb-4 tracking-tight">Upcoming sessions</h2>
      {upcoming.length === 0 ? (
        <div className="card-flat p-8 bg-white text-center text-muted-foreground">No upcoming sessions.</div>
      ) : (
        <div className="grid gap-3">
          {upcoming.map((b) => (
            <div key={b.id} className="card-flat p-5 bg-white flex items-center justify-between" data-testid={`tutor-upcoming-${b.id}`}>
              <div>
                <div className="font-semibold">{b.subject} with {b.student_name}</div>
                <div className="text-sm text-muted-foreground">{fmtDate(b.start_time)}</div>
              </div>
              <Link to={`/tutor/bookings/${b.id}`} className="btn-outline">Manage</Link>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}

export function TutorProfileEdit() {
  const [form, setForm] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/tutors/me/profile").then((r) => setForm({
      ...r.data,
      subjects_csv: r.data.subjects.join(", "),
      grades_csv: r.data.grade_levels.join(", "),
      languages_csv: r.data.languages.join(", "),
    }));
    api.get("/subjects").then((r) => setSubjects(r.data));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/tutors/me/profile", {
        bio: form.bio, qualifications: form.qualifications,
        experience_years: Number(form.experience_years) || 0,
        hourly_price: Number(form.hourly_price) || 0,
        photo_url: form.photo_url || "",
        subjects: form.subjects_csv.split(",").map((s) => s.trim()).filter(Boolean),
        grade_levels: form.grades_csv.split(",").map((s) => s.trim()).filter(Boolean),
        languages: form.languages_csv.split(",").map((s) => s.trim()).filter(Boolean),
      });
      toast.success("Profile saved");
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  if (!form) return <DashboardLayout title="Profile">Loading…</DashboardLayout>;
  const upd = (k, v) => setForm({ ...form, [k]: v });

  return (
    <DashboardLayout title="Tutor profile">
      <div className="card-flat p-6 bg-white grid gap-4 max-w-3xl">
        <div><label className="label">Photo URL</label><input className="field" value={form.photo_url || ""} onChange={(e) => upd("photo_url", e.target.value)} data-testid="profile-photo" /></div>
        <div><label className="label">Short bio</label><textarea className="field" rows={4} value={form.bio || ""} onChange={(e) => upd("bio", e.target.value)} data-testid="profile-bio" /></div>
        <div><label className="label">Qualifications</label><input className="field" value={form.qualifications || ""} onChange={(e) => upd("qualifications", e.target.value)} data-testid="profile-qualifications" /></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">Experience (years)</label><input type="number" className="field" value={form.experience_years} onChange={(e) => upd("experience_years", e.target.value)} data-testid="profile-experience" /></div>
          <div><label className="label">Hourly price ($)</label><input type="number" className="field" value={form.hourly_price} onChange={(e) => upd("hourly_price", e.target.value)} data-testid="profile-price" /></div>
        </div>
        <div><label className="label">Subjects (comma-separated) — available: {subjects.map((s) => s.name).join(", ")}</label><input className="field" value={form.subjects_csv} onChange={(e) => upd("subjects_csv", e.target.value)} data-testid="profile-subjects" /></div>
        <div><label className="label">Grade levels (comma-separated)</label><input className="field" value={form.grades_csv} onChange={(e) => upd("grades_csv", e.target.value)} data-testid="profile-grades" /></div>
        <div><label className="label">Languages (comma-separated)</label><input className="field" value={form.languages_csv} onChange={(e) => upd("languages_csv", e.target.value)} data-testid="profile-languages" /></div>
        <div><button className="btn-primary" disabled={saving} onClick={save} data-testid="profile-save">{saving ? "Saving..." : "Save profile"}</button></div>
      </div>
    </DashboardLayout>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function TutorAvailability() {
  const [slots, setSlots] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/tutors/me/profile").then((r) => {
      api.get(`/tutors/${r.data.id}/availability`).then((res) => setSlots(res.data.slots || []));
    });
  }, []);

  const add = () => setSlots([...slots, { day_of_week: 0, start_time: "17:00", end_time: "20:00" }]);
  const remove = (i) => setSlots(slots.filter((_, idx) => idx !== i));
  const upd = (i, k, v) => setSlots(slots.map((s, idx) => idx === i ? { ...s, [k]: k === "day_of_week" ? Number(v) : v } : s));

  const save = async () => {
    setSaving(true);
    try { await api.put("/tutors/me/availability", { slots, timezone: "UTC" }); toast.success("Availability saved"); }
    catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <DashboardLayout title="Availability">
      <div className="card-flat p-6 bg-white max-w-3xl">
        <p className="text-sm text-muted-foreground mb-4">Set your weekly recurring hours (in UTC). Students see these when booking.</p>
        <div className="space-y-3">
          {slots.map((s, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`avail-row-${i}`}>
              <select className="field col-span-4" value={s.day_of_week} onChange={(e) => upd(i, "day_of_week", e.target.value)}>
                {DAYS.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
              </select>
              <input type="time" className="field col-span-3" value={s.start_time} onChange={(e) => upd(i, "start_time", e.target.value)} />
              <input type="time" className="field col-span-3" value={s.end_time} onChange={(e) => upd(i, "end_time", e.target.value)} />
              <button className="btn-ghost col-span-2 text-destructive" onClick={() => remove(i)} data-testid={`avail-remove-${i}`}><XCircle size={16} /></button>
            </div>
          ))}
          {slots.length === 0 && <div className="text-muted-foreground text-sm py-4">No availability yet.</div>}
        </div>
        <div className="flex gap-2 mt-5">
          <button className="btn-outline" onClick={add} data-testid="avail-add">+ Add slot</button>
          <button className="btn-primary" disabled={saving} onClick={save} data-testid="avail-save">{saving ? "Saving..." : "Save availability"}</button>
        </div>
      </div>
    </DashboardLayout>
  );
}

export function TutorEarnings() {
  const [e, setE] = useState(null);
  useEffect(() => { api.get("/tutors/me/earnings").then((r) => setE(r.data)); }, []);
  if (!e) return <DashboardLayout title="Earnings">Loading…</DashboardLayout>;
  return (
    <DashboardLayout title="Earnings">
      <div className="grid md:grid-cols-3 gap-4 max-w-3xl">
        <div className="card-flat p-6 bg-white"><div className="label">Total earnings</div><div className="stat-num mt-1">${e.total_earnings}</div></div>
        <div className="card-flat p-6 bg-white"><div className="label">Pending</div><div className="stat-num mt-1">${e.pending_earnings}</div></div>
        <div className="card-flat p-6 bg-white"><div className="label">Platform fees</div><div className="stat-num mt-1">${e.platform_fees}</div></div>
        <div className="card-flat p-6 bg-white"><div className="label">Completed sessions</div><div className="stat-num mt-1">{e.completed_sessions}</div></div>
        <div className="card-flat p-6 bg-white"><div className="label">Upcoming sessions</div><div className="stat-num mt-1">{e.upcoming_sessions}</div></div>
        <div className="card-flat p-6 bg-white"><div className="label">Cancelled</div><div className="stat-num mt-1">{e.cancelled_sessions}</div></div>
      </div>
    </DashboardLayout>
  );
}
