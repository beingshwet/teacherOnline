import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api, formatError, fmtDate } from "@/lib/api";
import { toast } from "sonner";
import { Mail, RefreshCw, PlayCircle } from "lucide-react";

function FragmentRow({ e, expanded, onToggle, badgeColor }) {
  return (
    <>
      <tr className="border-t border-border hover:bg-accent/30" data-testid={`email-log-row-${e.id}`}>
        <td className="p-3 text-muted-foreground">{new Date(e.sent_at).toLocaleString()}</td>
        <td className="p-3">
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${badgeColor(e.meta?.checkpoint)}`}>
            {e.meta?.checkpoint || "—"}
          </span>
        </td>
        <td className="p-3">
          <div className="font-semibold">{e.to_name}</div>
          <div className="text-xs text-muted-foreground">{e.to_email}</div>
        </td>
        <td className="p-3">{e.subject}</td>
        <td className="p-3 text-right">
          <button className="btn-ghost text-xs" onClick={onToggle} data-testid={`email-log-expand-${e.id}`}>
            {expanded ? "Hide" : "View"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-secondary/30">
          <td colSpan="5" className="p-4">
            <pre className="whitespace-pre-wrap text-xs bg-white p-4 rounded-lg border border-border max-h-72 overflow-auto">{e.body}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminEmailLog() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [running, setRunning] = useState(false);

  const load = () => {
    setLoading(true);
    api.get("/admin/email-log", { params: { limit: 100 } })
      .then((r) => setEmails(r.data.emails || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      await api.post("/admin/reminders/run");
      toast.success("Reminder cycle triggered");
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setRunning(false); }
  };

  const badgeColor = (cp) => cp === "24h" ? "bg-sky-100 text-sky-700"
    : cp === "1h" ? "bg-amber-100 text-amber-700"
    : cp === "10m" ? "bg-rose-100 text-rose-700"
    : "bg-secondary text-foreground";

  return (
    <DashboardLayout title="Email log (mock)">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Reminders are scheduled at <strong>24 hours</strong>, <strong>1 hour</strong>, and <strong>10 minutes</strong> before every confirmed session,
          sent to <strong>both student and tutor</strong>. The scheduler runs every 60 seconds. Provider is currently <span className="chip">MOCK</span> — swap in SendGrid or Resend to send for real.
        </p>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={load} data-testid="email-log-refresh"><RefreshCw size={15} /> Refresh</button>
          <button className="btn-primary" onClick={runNow} disabled={running} data-testid="email-log-run"><PlayCircle size={15} /> {running ? "Running..." : "Run reminder cycle now"}</button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : emails.length === 0 ? (
        <div className="card-flat p-10 bg-white text-center text-muted-foreground" data-testid="email-log-empty">
          <Mail className="mx-auto mb-3 text-muted-foreground" /> No reminders sent yet. They'll appear here as sessions approach.
        </div>
      ) : (
        <div className="card-flat bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="p-3">When</th>
                <th className="p-3">Checkpoint</th>
                <th className="p-3">To</th>
                <th className="p-3">Subject</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <FragmentRow key={e.id} e={e} expanded={expanded === e.id} onToggle={() => setExpanded(expanded === e.id ? null : e.id)} badgeColor={badgeColor} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}
