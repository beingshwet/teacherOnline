import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PublicHeader from "@/components/PublicHeader";
import { api, formatError, fmtTime } from "@/lib/api";
import { Star, Calendar, Globe, Award, ChevronLeft, ChevronRight, Video } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function TutorProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [subject, setSubject] = useState("");
  const [booking, setBooking] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    api.get(`/tutors/${id}`).then((r) => {
      setData(r.data);
      setSubject(r.data.tutor.subjects?.[0] || "");
    }).catch(() => {});
  }, [id]);

  useEffect(() => {
    setLoadingSlots(true); setSelectedSlot(null);
    const dateStr = selectedDate.toISOString().slice(0, 10);
    api.get(`/tutors/${id}/slots`, { params: { date: dateStr } })
      .then((r) => setSlots(r.data.slots || []))
      .finally(() => setLoadingSlots(false));
  }, [id, selectedDate]);

  const book = async () => {
    if (!user) { nav("/login"); return; }
    if (user.role !== "student") { toast.error("Only students can book sessions"); return; }
    if (!selectedSlot) return;
    setBooking(true);
    try {
      const r = await api.post("/bookings", {
        tutor_id: id, subject, start_time: selectedSlot, duration_minutes: 60,
      });
      toast.success("Booking confirmed!");
      nav(`/student/bookings/${r.data.id}`);
    } catch (e) { toast.error(formatError(e)); }
    finally { setBooking(false); }
  };

  if (!data) return <div className="min-h-screen"><PublicHeader /><div className="max-w-7xl mx-auto p-10 text-muted-foreground">Loading…</div></div>;

  const t = data.tutor;
  const dayOffsets = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i); return d;
  });

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-10">
        <Link to="/tutors" className="btn-ghost mb-4 -ml-3" data-testid="back-to-search"><ChevronLeft size={16} /> All tutors</Link>

        <div className="grid lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8">
            <div className="card-flat bg-white p-8">
              <div className="flex flex-col sm:flex-row gap-6">
                <img src={t.photo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${t.first_name}${t.last_name}`}
                  className="w-32 h-32 rounded-2xl object-cover border border-border" alt={t.first_name} />
                <div className="flex-1 min-w-0">
                  <h1 className="font-display font-extrabold text-3xl tracking-tight" data-testid="tutor-name">{t.first_name} {t.last_name}</h1>
                  <div className="text-muted-foreground mt-1">{t.qualifications}</div>
                  <div className="flex flex-wrap gap-4 mt-4 text-sm">
                    <div className="flex items-center gap-1.5"><Star size={15} className="fill-primary text-primary" /> <strong>{t.rating_avg}</strong> <span className="text-muted-foreground">({t.total_reviews} reviews)</span></div>
                    <div className="flex items-center gap-1.5 text-muted-foreground"><Calendar size={15} /> {t.total_sessions} sessions</div>
                    <div className="flex items-center gap-1.5 text-muted-foreground"><Award size={15} /> {t.experience_years}+ yrs</div>
                    <div className="flex items-center gap-1.5 text-muted-foreground"><Globe size={15} /> {t.languages.join(", ")}</div>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <h2 className="eyebrow text-primary mb-2">About</h2>
                <p className="text-foreground/90 leading-relaxed" data-testid="tutor-bio">{t.bio}</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-6 mt-8">
                <div>
                  <h3 className="eyebrow text-primary mb-2">Subjects</h3>
                  <div className="flex flex-wrap gap-2">{t.subjects.map((s) => <span key={s} className="chip">{s}</span>)}</div>
                </div>
                <div>
                  <h3 className="eyebrow text-primary mb-2">Grade levels</h3>
                  <div className="flex flex-wrap gap-2">{t.grade_levels.map((g) => <span key={g} className="chip">Grade {g}</span>)}</div>
                </div>
              </div>
            </div>

            <div className="card-flat bg-white p-8 mt-6">
              <h2 className="font-display font-extrabold text-2xl tracking-tight mb-6">Reviews ({data.reviews.length})</h2>
              {data.reviews.length === 0 && <div className="text-muted-foreground">No reviews yet.</div>}
              <div className="space-y-5">
                {data.reviews.map((r) => (
                  <div key={r.id} className="border-b border-border pb-5 last:border-0" data-testid={`review-${r.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{r.student_name}</div>
                      <div className="flex items-center gap-1 text-sm"><Star size={13} className="fill-primary text-primary" /> {r.rating}</div>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">{r.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside className="lg:col-span-4">
            <div className="card-flat bg-white p-6 sticky top-24">
              <div className="flex items-baseline gap-1 mb-1">
                <span className="stat-num">${t.hourly_price}</span>
                <span className="text-muted-foreground">/ 60 min</span>
              </div>
              <div className="text-sm text-muted-foreground mb-5 flex items-center gap-1"><Video size={13} /> Class on Google Meet</div>

              <label className="label">Subject</label>
              <select className="field mb-4" value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="booking-subject">
                {t.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>

              <label className="label">Pick a day</label>
              <div className="grid grid-cols-7 gap-1 mb-4">
                {dayOffsets.map((d) => {
                  const isSel = d.toDateString() === selectedDate.toDateString();
                  return (
                    <button key={d.toDateString()} onClick={() => setSelectedDate(d)}
                      className={`flex flex-col items-center py-2 rounded-lg border text-xs transition ${isSel ? "bg-primary text-white border-primary" : "bg-white hover:bg-secondary border-border"}`}
                      data-testid={`day-${d.toISOString().slice(0, 10)}`}>
                      <span className="text-[0.65rem] opacity-70">{d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3)}</span>
                      <span className="font-bold">{d.getDate()}</span>
                    </button>
                  );
                })}
              </div>

              <label className="label">Available times</label>
              {loadingSlots ? (
                <div className="text-sm text-muted-foreground py-4">Loading slots…</div>
              ) : slots.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4" data-testid="no-slots">No slots this day. Try another day.</div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 mb-5 max-h-52 overflow-auto">
                  {slots.map((s) => (
                    <button key={s.start_time} disabled={s.booked} onClick={() => setSelectedSlot(s.start_time)}
                      className={`py-2 rounded-md border text-xs font-medium transition ${
                        s.booked ? "bg-secondary text-muted-foreground line-through cursor-not-allowed border-border" :
                        selectedSlot === s.start_time ? "bg-primary text-white border-primary" :
                        "bg-white hover:bg-accent border-border"
                      }`}
                      data-testid={`slot-${s.start_time}`}>
                      {fmtTime(s.start_time)}
                    </button>
                  ))}
                </div>
              )}

              <button className="btn-primary w-full" disabled={!selectedSlot || booking} onClick={book} data-testid="book-session-btn">
                {booking ? "Booking..." : selectedSlot ? "Book session" : "Select a time"} <ChevronRight size={16} />
              </button>
              <div className="text-[0.7rem] text-muted-foreground mt-3 text-center">
                Payments are skipped in Phase 1. Bookings confirm instantly.
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
