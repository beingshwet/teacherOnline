import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api, formatError, fmtDate } from "@/lib/api";
import { toast } from "sonner";
import { Users, GraduationCap, CalendarClock, DollarSign, ShieldCheck } from "lucide-react";

export function AdminDashboard() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/admin/dashboard").then((r) => setS(r.data)); }, []);
  if (!s) return <DashboardLayout title="Overview">Loading…</DashboardLayout>;

  const stats = [
    { label: "Students", value: s.total_students, icon: Users },
    { label: "Tutors", value: s.total_tutors, icon: GraduationCap },
    { label: "Active tutors", value: s.active_tutors, icon: ShieldCheck },
    { label: "Total bookings", value: s.total_bookings, icon: CalendarClock },
    { label: "Completed", value: s.completed_sessions, icon: CalendarClock },
    { label: "Cancelled", value: s.cancelled_sessions, icon: CalendarClock },
    { label: "Upcoming", value: s.upcoming_sessions, icon: CalendarClock },
    { label: "Revenue", value: `$${s.revenue}`, icon: DollarSign },
    { label: "Platform fees", value: `$${s.platform_fees}`, icon: DollarSign },
  ];

  return (
    <DashboardLayout title="Admin overview">
      <div className="grid md:grid-cols-3 lg:grid-cols-3 gap-4">
        {stats.map((x) => (
          <div key={x.label} className="card-flat p-6 bg-white" data-testid={`admin-stat-${x.label.toLowerCase().replace(/\s+/g, '-')}`}>
            <x.icon className="text-primary mb-3" />
            <div className="label">{x.label}</div>
            <div className="stat-num mt-1">{x.value}</div>
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
}

export function AdminTutors() {
  const [tutors, setTutors] = useState([]);
  const [filter, setFilter] = useState("");
  const load = () => api.get("/admin/tutors", { params: filter ? { status: filter } : {} }).then((r) => setTutors(r.data.tutors || []));
  useEffect(() => { load(); }, [filter]);

  const act = async (id, action) => {
    try { await api.post(`/admin/tutors/${id}/${action}`); toast.success(`Tutor ${action}d`); load(); }
    catch (e) { toast.error(formatError(e)); }
  };

  return (
    <DashboardLayout title="Tutors">
      <div className="mb-4 flex gap-2 flex-wrap">
        {["", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SUSPENDED"].map((f) => (
          <button key={f || "all"} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-sm border transition ${filter === f ? "bg-primary text-white border-primary" : "bg-white border-border hover:bg-secondary"}`}
            data-testid={`admin-filter-${f || "all"}`}>
            {f ? f.replace("_", " ") : "All"}
          </button>
        ))}
      </div>
      <div className="card-flat bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wider">
            <tr><th className="p-3">Tutor</th><th className="p-3">Subjects</th><th className="p-3">Price</th><th className="p-3">Rating</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr>
          </thead>
          <tbody>
            {tutors.map((t) => (
              <tr key={t.id} className="border-t border-border" data-testid={`admin-tutor-row-${t.id}`}>
                <td className="p-3 font-semibold">{t.first_name} {t.last_name}</td>
                <td className="p-3 text-muted-foreground">{t.subjects.join(", ")}</td>
                <td className="p-3">${t.hourly_price}</td>
                <td className="p-3">{t.rating_avg} ({t.total_reviews})</td>
                <td className="p-3"><span className="chip">{t.approval_status}</span></td>
                <td className="p-3 flex gap-1">
                  {t.approval_status !== "APPROVED" && <button className="btn-ghost text-xs" onClick={() => act(t.id, "approve")} data-testid={`approve-${t.id}`}>Approve</button>}
                  {t.approval_status !== "REJECTED" && <button className="btn-ghost text-xs" onClick={() => act(t.id, "reject")} data-testid={`reject-${t.id}`}>Reject</button>}
                  {t.approval_status === "APPROVED" && <button className="btn-ghost text-xs" onClick={() => act(t.id, "suspend")} data-testid={`suspend-${t.id}`}>Suspend</button>}
                </td>
              </tr>
            ))}
            {tutors.length === 0 && <tr><td colSpan="6" className="p-10 text-center text-muted-foreground">No tutors match.</td></tr>}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  );
}

export function AdminStudents() {
  const [students, setStudents] = useState([]);
  useEffect(() => { api.get("/admin/students").then((r) => setStudents(r.data.students || [])); }, []);
  return (
    <DashboardLayout title="Students">
      <div className="card-flat bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wider">
            <tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Status</th><th className="p-3">Joined</th></tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="p-3 font-semibold">{s.first_name} {s.last_name}</td>
                <td className="p-3 text-muted-foreground">{s.email}</td>
                <td className="p-3"><span className="chip">{s.status}</span></td>
                <td className="p-3 text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  );
}

export function AdminBookings() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get("/admin/bookings").then((r) => setItems(r.data.bookings || [])); }, []);
  return (
    <DashboardLayout title="Bookings">
      <div className="card-flat bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wider">
            <tr><th className="p-3">Subject</th><th className="p-3">Tutor</th><th className="p-3">Student</th><th className="p-3">When</th><th className="p-3">Status</th><th className="p-3">$</th></tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.id} className="border-t border-border">
                <td className="p-3 font-semibold">{b.subject}</td>
                <td className="p-3">{b.tutor_name}</td>
                <td className="p-3">{b.student_name}</td>
                <td className="p-3 text-muted-foreground">{fmtDate(b.start_time)}</td>
                <td className="p-3"><span className="chip">{b.status}</span></td>
                <td className="p-3">${b.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  );
}
