import { useEffect, useRef, useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api, formatError, BACKEND_URL, API } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Send, MessageSquare, Paperclip, FileText, Image as ImageIcon, X, Download } from "lucide-react";
import { toast } from "sonner";

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Messages() {
  const { user } = useAuth();
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const wsRef = useRef(null);
  const scrollerRef = useRef(null);

  const loadThreads = useCallback(() => {
    api.get("/messages/threads").then((r) => {
      setThreads(r.data.threads || []);
      if (!activeId && r.data.threads?.length) setActiveId(r.data.threads[0].other_user_id);
    });
  }, [activeId]);

  const loadThread = useCallback((otherId) => {
    if (!otherId) return;
    api.get(`/messages/thread/${otherId}`).then((r) => {
      setActive(r.data);
      setTimeout(() => scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight }), 30);
    });
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { if (activeId) loadThread(activeId); }, [activeId, loadThread]);

  // WebSocket subscription for real-time
  useEffect(() => {
    if (!user) return;
    const wsUrl = BACKEND_URL.replace(/^http/, "ws") + "/api/ws/messages";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type !== "message") return;
        const m = msg.message;
        // If message belongs to the currently open thread, append
        if (active && (m.from_user_id === active.other.id || m.to_user_id === active.other.id)) {
          setActive((cur) => cur ? { ...cur, messages: [...cur.messages, m] } : cur);
          setTimeout(() => scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" }), 30);
        }
        // Refresh thread list to bump ordering + unread counts
        loadThreads();
      } catch {}
    };
    ws.onclose = () => { wsRef.current = null; };
    // ping every 25s to keep connection alive
    const iv = setInterval(() => {
      try { ws.readyState === 1 && ws.send(JSON.stringify({ type: "ping" })); } catch {}
    }, 25000);
    return () => { clearInterval(iv); try { ws.close(); } catch {} };
  }, [user, active, loadThreads]);

  const send = async () => {
    if (!active) return;
    if (pendingFile) {
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", pendingFile);
        const params = new URLSearchParams({ to_user_id: active.other.id, caption: text.trim() });
        await api.post(`/messages/attachment?${params}`, form);
        setText(""); setPendingFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (e) { toast.error(formatError(e)); }
      finally { setUploading(false); }
      return;
    }
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.post("/messages", { to_user_id: active.other.id, body: text.trim() });
      setText("");
    } catch (e) { toast.error(formatError(e)); }
    finally { setSending(false); }
  };

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast.error("Max 10 MB per file"); e.target.value = ""; return; }
    setPendingFile(f);
  };

  const humanSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const initials = (name) => name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <DashboardLayout title="Messages">
      <div className="card-flat bg-white overflow-hidden grid grid-cols-12 h-[calc(100vh-10rem)] min-h-[500px]">
        <aside className="col-span-12 md:col-span-4 lg:col-span-3 border-r border-border flex flex-col">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold flex items-center gap-2"><MessageSquare size={16} /> Threads</h2>
          </div>
          <div className="flex-1 overflow-auto">
            {threads.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground" data-testid="threads-empty">
                No conversations yet. After a booking, you can message the {user?.role === "tutor" ? "student" : "tutor"} here.
              </div>
            ) : threads.map((t) => (
              <button key={t.other_user_id} onClick={() => setActiveId(t.other_user_id)}
                className={`w-full text-left px-4 py-3 border-b border-border transition ${activeId === t.other_user_id ? "bg-accent" : "hover:bg-secondary"}`}
                data-testid={`thread-${t.other_user_id}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm ${t.unread ? "bg-primary text-white" : "bg-accent text-accent-foreground"}`}>
                    {initials(t.other_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-sm truncate">{t.other_name}</div>
                      <div className="text-[0.65rem] text-muted-foreground">{fmtTime(t.last_at)}</div>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {t.last_from_me && "You: "}{t.last_body}
                    </div>
                  </div>
                  {t.unread > 0 && <div className="chip text-[0.65rem]">{t.unread}</div>}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="col-span-12 md:col-span-8 lg:col-span-9 flex flex-col">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a conversation to start messaging.
            </div>
          ) : (
            <>
              <header className="px-6 h-14 flex items-center justify-between border-b border-border">
                <div>
                  <div className="font-semibold" data-testid="active-thread-name">{active.other.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">{active.other.role}</div>
                </div>
                <div className="text-xs text-muted-foreground">Real-time via WebSocket</div>
              </header>
              <div ref={scrollerRef} className="flex-1 overflow-auto p-6 space-y-2 bg-secondary/30" data-testid="messages-scroller">
                {active.messages.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-10">No messages yet. Say hi 👋</div>
                ) : active.messages.map((m) => {
                  const mine = m.from_user_id === user?.id;
                  const att = m.attachment;
                  const attUrl = att ? `${API}/messages/attachment/${att.id}` : null;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.id}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${mine ? "bg-primary text-white rounded-br-sm" : "bg-white border border-border rounded-bl-sm"}`}>
                        {att && att.is_image && (
                          <a href={attUrl} target="_blank" rel="noopener noreferrer" className="block mb-2 -mx-2 -mt-1" data-testid={`msg-image-${m.id}`}>
                            <img src={attUrl} alt={att.filename} className="rounded-xl max-h-72 object-cover w-full" />
                          </a>
                        )}
                        {att && !att.is_image && (
                          <a href={attUrl} target="_blank" rel="noopener noreferrer"
                            className={`flex items-center gap-3 rounded-xl px-3 py-2 mb-1 border ${mine ? "bg-white/10 border-white/20 hover:bg-white/20" : "bg-secondary/70 border-border hover:bg-secondary"} transition`}
                            data-testid={`msg-file-${m.id}`}>
                            <FileText size={22} className={mine ? "text-white" : "text-primary"} />
                            <div className="flex-1 min-w-0">
                              <div className={`font-semibold text-sm truncate ${mine ? "text-white" : ""}`}>{att.filename}</div>
                              <div className={`text-[0.7rem] ${mine ? "text-white/70" : "text-muted-foreground"}`}>{humanSize(att.size)} · {att.content_type.split("/")[1]?.toUpperCase()}</div>
                            </div>
                            <Download size={15} className={mine ? "text-white/80" : "text-muted-foreground"} />
                          </a>
                        )}
                        {m.body && <div className="whitespace-pre-wrap break-words text-sm">{m.body}</div>}
                        <div className={`text-[0.65rem] mt-1 ${mine ? "text-white/70" : "text-muted-foreground"}`}>{fmtTime(m.created_at)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="p-4 border-t border-border">
                {pendingFile && (
                  <div className="mb-2 flex items-center gap-2 bg-accent px-3 py-2 rounded-lg text-sm" data-testid="pending-file">
                    {pendingFile.type.startsWith("image/") ? <ImageIcon size={16} className="text-primary" /> : <FileText size={16} className="text-primary" />}
                    <div className="flex-1 min-w-0 truncate">{pendingFile.name}</div>
                    <div className="text-xs text-muted-foreground">{humanSize(pendingFile.size)}</div>
                    <button onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="btn-ghost p-1" data-testid="pending-file-remove"><X size={14} /></button>
                  </div>
                )}
                <div className="flex gap-2">
                  <input ref={fileInputRef} type="file" hidden onChange={pickFile}
                    accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    data-testid="message-file-input" />
                  <button type="button" className="btn-outline !px-3" onClick={() => fileInputRef.current?.click()} title="Attach file (max 10 MB)" data-testid="message-attach">
                    <Paperclip size={16} />
                  </button>
                  <input className="field flex-1" value={text} onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                    placeholder={pendingFile ? "Add a caption (optional)…" : `Message ${active.other.name}…`}
                    data-testid="message-input" />
                  <button className="btn-primary" onClick={send} disabled={sending || uploading || (!text.trim() && !pendingFile)} data-testid="message-send">
                    {uploading ? "Uploading…" : <><Send size={15} /> Send</>}
                  </button>
                </div>
                <div className="text-[0.65rem] text-muted-foreground mt-2">
                  Attach worksheets, PDFs, or images so students walk in prepared. Max 10 MB.
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
