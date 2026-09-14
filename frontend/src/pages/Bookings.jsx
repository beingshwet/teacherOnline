import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { api, formatError, fmtDate } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Video, Star, ChevronLeft } from "lucide-react";

export function BookingsList({ role }) {
  const [items, setItems] = useState([]);

  useEffect(() => { api.get("/bookings").then((r) => setItems(r.data.bookings || [])); }, []);

  return (
    <DashboardLayout title={role === "tutor" ? "Bookings" : "My sessions"}>
      {items.length === 0 ? (
        <div className="card-flat p-10 bg-white text-center text-muted-foreground" data-testid="bookings-empty">
          No bookings yet.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((b) => (
            <div key={b.id} className="card-flat p-5 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3" data-testid={`booking-row-${b.id}`}>
              <div>
                <div className="font-semibold">{b.subject}</div>
                <div className="text-sm text-muted-foreground">
                  {role === "tutor" ? `Student: ${b.student_name}` : `Tutor: ${b.tutor_name}`} · {fmtDate(b.start_time)}
                </div>
                <span className="chip mt-2 inline-flex">{b.status}</span>
              </div>
              <Link to={role === "tutor" ? `/tutor/bookings/${b.id}` : `/student/bookings/${b.id}`} className="btn-outline">Details</Link>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}

export function BookingDetail({ role }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [b, setB] = useState(null);
  const [meetUrl, setMeetUrl] = useState("");
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");

  const load = () => api.get(`/bookings/${id}`).then((r) => { setB(r.data); setMeetUrl(r.data.meet_url || ""); });
  useEffect(() => { load(); }, [id]);

  const setProvider = async (provider) => {
    try { await api.put(`/bookings/${id}/video-provider`, { provider }); toast.success("Class format updated"); load(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const saveMeet = async () => {
    try { await api.put(`/bookings/${id}/meet-url`, { meet_url: meetUrl }); toast.success("Meet link saved"); load(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const cancel = async () => {
    if (!window.confirm("Cancel this booking?")) return;
    try { await api.post(`/bookings/${id}/cancel`); toast.success("Cancelled"); load(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const complete = async () => {
    try { await api.post(`/bookings/${id}/complete`); toast.success("Marked complete"); load(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const review = async () => {
    try { await api.post(`/bookings/${id}/review`, { rating, text: reviewText }); toast.success("Thanks for your review!"); load(); }
    catch (e) { toast.error(formatError(e)); }
  };

  if (!b) return <DashboardLayout title="Session">Loading…</DashboardLayout>;

  const isPast = new Date(b.start_time) < new Date();

  return (
    <DashboardLayout title="Session details">
      <button onClick={() => nav(-1)} className="btn-ghost mb-4 -ml-3"><ChevronLeft size={16} /> Back</button>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-flat p-8 bg-white">
          <div className="eyebrow text-primary mb-2">{b.status}</div>
          <h2 className="font-display font-extrabold text-3xl tracking-tight">{b.subject}</h2>
          <div className="grid sm:grid-cols-2 gap-4 mt-6">
            <div><div className="label">Tutor</div><div className="font-semibold" data-testid="detail-tutor">{b.tutor_name}</div></div>
            <div><div className="label">Student</div><div className="font-semibold" data-testid="detail-student">{b.student_name}</div></div>
            <div><div className="label">Start</div><div className="font-semibold">{fmtDate(b.start_time)}</div></div>
            <div><div className="label">Duration</div><div className="font-semibold">{b.duration_minutes} min</div></div>
            <div><div className="label">Price</div><div className="font-semibold">${b.price}</div></div>
            {role === "tutor" && <div><div className="label">Your earnings</div><div className="font-semibold">${b.tutor_earnings}</div></div>}
            <div><div className="label">Student joined</div><div className="font-semibold text-sm" data-testid="student-joined">{b.student_joined_at ? new Date(b.student_joined_at).toLocaleString() : <span className="text-muted-foreground font-normal">Not yet</span>}</div></div>
            <div><div className="label">Tutor joined</div><div className="font-semibold text-sm" data-testid="tutor-joined">{b.tutor_joined_at ? new Date(b.tutor_joined_at).toLocaleString() : <span className="text-muted-foreground font-normal">Not yet</span>}</div></div>
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <div className="label">Class format</div>
            {role === "tutor" ? (
              <div className="flex gap-2 mb-4">
                {[
                  { key: "builtin", label: "Built-in classroom", tag: "recommended" },
                  { key: "google_meet", label: "Google Meet", tag: "" },
                ].map((opt) => (
                  <button key={opt.key} onClick={() => setProvider(opt.key)}
                    className={`flex-1 py-3 px-4 rounded-xl border text-left transition ${b.video_provider === opt.key ? "border-primary bg-accent" : "bg-white border-border hover:bg-secondary"}`}
                    data-testid={`provider-${opt.key}`}>
                    <div className="font-semibold text-sm">{opt.label}</div>
                    {opt.tag && <div className="text-[0.7rem] text-primary mt-0.5">{opt.tag}</div>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="chip mb-3" data-testid="provider-chip">
                {b.video_provider === "builtin" ? "Built-in classroom" : "Google Meet"}
              </div>
            )}

            {b.video_provider === "google_meet" ? (
              <div>
                <div className="label">Google Meet link</div>
                {role === "tutor" ? (
                  <div className="flex gap-2">
                    <input className="field" placeholder="https://meet.google.com/xxx-xxxx-xxx" value={meetUrl} onChange={(e) => setMeetUrl(e.target.value)} data-testid="meet-url-input" />
                    <button className="btn-outline" onClick={saveMeet} data-testid="meet-url-save">Save</button>
                  </div>
                ) : b.meet_url ? (
                  <a href={b.meet_url} target="_blank" rel="noopener noreferrer" className="btn-primary" data-testid="join-google-meet"><Video size={15} /> Join Google Meet</a>
                ) : (
                  <div className="text-muted-foreground text-sm">Waiting for tutor to add link…</div>
                )}
              </div>
            ) : (
              <div>
                <div className="text-sm text-muted-foreground mb-3">
                  Video, screen share, chat, whiteboard, and recording — all built in. Classroom opens 10 min before the session starts.
                </div>
                <Link to={`/classroom/${b.id}`} className="btn-primary" data-testid="launch-classroom"><Video size={15} /> Launch classroom</Link>
              </div>
            )}
          </div>
        </div>

        <aside className="card-flat p-6 bg-white h-fit space-y-3">
          {b.status === "CONFIRMED" && !isPast && (
            <button className="btn-outline w-full" onClick={cancel} data-testid="cancel-booking">Cancel booking</button>
          )}
          {role === "tutor" && b.status === "CONFIRMED" && (
            <button className="btn-primary w-full" onClick={complete} data-testid="complete-booking">Mark completed</button>
          )}
          {role === "student" && b.status === "COMPLETED" && !b.review && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="label">Rate your session</div>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setRating(n)} data-testid={`star-${n}`}>
                    <Star size={22} className={n <= rating ? "fill-primary text-primary" : "text-muted-foreground"} />
                  </button>
                ))}
              </div>
              <textarea className="field" rows={3} placeholder="Share your feedback…" value={reviewText} onChange={(e) => setReviewText(e.target.value)} data-testid="review-text" />
              <button className="btn-primary w-full" onClick={review} data-testid="submit-review">Submit review</button>
            </div>
          )}
          {b.review && (
            <div className="pt-2 border-t border-border">
              <div className="label">Your review</div>
              <div className="flex items-center gap-1"><Star size={15} className="fill-primary text-primary" /> {b.review.rating}</div>
              <p className="text-sm mt-1">{b.review.text}</p>
            </div>
          )}
        </aside>
      </div>
    </DashboardLayout>
  );
}
