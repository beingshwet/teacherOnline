import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api, fmtDate } from "@/lib/api";
import { Bell, CheckCircle } from "lucide-react";

export default function Notifications() {
  const [items, setItems] = useState([]);

  const load = () => api.get("/notifications").then((r) => setItems(r.data.notifications || []));
  useEffect(() => { load(); }, []);

  const markRead = async (id) => { await api.post(`/notifications/${id}/read`); load(); };

  return (
    <DashboardLayout title="Notifications">
      {items.length === 0 ? (
        <div className="card-flat p-10 bg-white text-center text-muted-foreground" data-testid="notif-empty">
          <Bell className="mx-auto mb-3 text-muted-foreground" /> Nothing yet.
        </div>
      ) : (
        <div className="grid gap-3 max-w-3xl">
          {items.map((n) => (
            <div key={n.id} className={`card-flat p-5 bg-white flex items-start justify-between gap-3 ${!n.read ? "border-primary/50" : ""}`} data-testid={`notif-${n.id}`}>
              <div>
                <div className="font-semibold">{n.title}</div>
                <div className="text-sm text-muted-foreground">{n.body}</div>
                <div className="text-xs text-muted-foreground mt-1">{fmtDate(n.created_at)}</div>
              </div>
              {!n.read && <button onClick={() => markRead(n.id)} className="btn-ghost text-xs" data-testid={`notif-read-${n.id}`}><CheckCircle size={14} /> Mark read</button>}
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
