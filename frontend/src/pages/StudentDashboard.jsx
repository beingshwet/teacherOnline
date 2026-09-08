import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { api, fmtDate, fmtDay, fmtTime } from "@/lib/api";
import { Video, CalendarClock, Search, Star } from "lucide-react";

export default function StudentDashboard() {
  const [upcoming, setUpcoming] = useState([]);
  const [past, setPast] = useState([]);

  useEffect(() => {
    api.get("/bookings", { params: { scope: "upcoming" } }).then((r) => setUpcoming(r.data.bookings || []));
    api.get("/bookings", { params: { scope: "past" } }).then((r) => setPast((r.data.bookings || []).slice(0, 5)));
  }, []);

  return (
    <DashboardLayout title="Dashboard">
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <Link to="/tutors" className="card-flat p-5 bg-white hover:bg-accent" data-testid="qa-find-tutor">
          <Search className="text-primary mb-3" />
          <div className="font-semibold">Find a tutor</div>
          <div className="text-xs text-muted-foreground">Search and book</div>
        </Link>
        <Link to="/student/bookings" className="card-flat p-5 bg-white" data-testid="qa-my-sessions">
          <CalendarClock className="text-primary mb-3" />
          <div className="font-semibold">My sessions</div>
          <div className="text-xs text-muted-foreground">{upcoming.length} upcoming</div>
        </Link>
        <Link to="/student/notifications" className="card-flat p-5 bg-white" data-testid="qa-notifications">
          <Video className="text-primary mb-3" />
          <div className="font-semibold">Notifications</div>
          <div className="text-xs text-muted-foreground">Stay in the loop</div>
        </Link>
        <div className="card-flat p-5 bg-foreground text-white">
          <Star className="text-primary mb-3" />
          <div className="font-semibold">Track progress</div>
          <div className="text-xs text-white/70">Coming soon</div>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="font-display font-extrabold text-2xl mb-4 tracking-tight">Upcoming sessions</h2>
        {upcoming.length === 0 ? (
          <div className="card-flat p-8 bg-white text-muted-foreground text-center" data-testid="upcoming-empty">
            No upcoming sessions. <Link to="/tutors" className="text-primary font-semibold">Book one now →</Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {upcoming.map((b) => (
              <div key={b.id} className="card-flat p-5 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-4" data-testid={`upcoming-${b.id}`}>
                <div>
                  <div className="font-semibold">{b.subject} with {b.tutor_name}</div>
                  <div className="text-sm text-muted-foreground">{fmtDate(b.start_time)} · 60 min · <span className="chip ml-1">{b.status}</span></div>
                </div>
                <div className="flex gap-2">
                  {b.meet_url && <a href={b.meet_url} target="_blank" rel="noopener noreferrer" className="btn-primary" data-testid={`join-${b.id}`}><Video size={15} /> Join class</a>}
                  <Link to={`/student/bookings/${b.id}`} className="btn-outline">Details</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display font-extrabold text-2xl mb-4 tracking-tight">Recent sessions</h2>
        {past.length === 0 ? (
          <div className="card-flat p-8 bg-white text-muted-foreground text-center">No past sessions yet.</div>
        ) : (
          <div className="grid gap-3">
            {past.map((b) => (
              <div key={b.id} className="card-flat p-5 bg-white flex items-center justify-between" data-testid={`past-${b.id}`}>
                <div>
                  <div className="font-semibold">{b.subject} with {b.tutor_name}</div>
                  <div className="text-sm text-muted-foreground">{fmtDay(b.start_time)} at {fmtTime(b.start_time)} · <span className="chip ml-1">{b.status}</span></div>
                </div>
                <Link to={`/student/bookings/${b.id}`} className="btn-outline">View</Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </DashboardLayout>
  );
}
