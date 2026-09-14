import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, formatError, fmtDate } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ChevronLeft, Loader2, Video, ExternalLink } from "lucide-react";

// Load Jitsi external_api.js once
function useJitsiScript() {
  const [ready, setReady] = useState(!!window.JitsiMeetExternalAPI);
  useEffect(() => {
    if (window.JitsiMeetExternalAPI) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://meet.jit.si/external_api.js";
    s.async = true;
    s.onload = () => setReady(true);
    s.onerror = () => setReady(false);
    document.body.appendChild(s);
  }, []);
  return ready;
}

export default function Classroom() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const jitsiReady = useJitsiScript();

  useEffect(() => {
    setLoading(true);
    api.get(`/bookings/${id}/video-room`)
      .then((r) => {
        setInfo(r.data);
        // Auto-mark attendance in the background
        api.post(`/bookings/${id}/attendance/join`).catch(() => {});
      })
      .catch((e) => setError(e.response?.data?.detail || formatError(e)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!info || info.provider !== "builtin" || !jitsiReady || !containerRef.current) return;
    if (apiRef.current) { apiRef.current.dispose(); apiRef.current = null; }

    const options = {
      roomName: info.room_name,
      parentNode: containerRef.current,
      width: "100%",
      height: "100%",
      userInfo: info.user,
      configOverwrite: {
        startWithAudioMuted: false,
        startWithVideoMuted: false,
        prejoinPageEnabled: true,
        disableDeepLinking: true,
        enableWelcomePage: false,
        toolbarButtons: [
          "microphone", "camera", "desktop", "chat", "raisehand",
          "tileview", "videoquality", "fullscreen", "settings",
          "whiteboard", "etherpad", "recording", "sharedvideo",
          "select-background", "hangup",
        ],
      },
      interfaceConfigOverwrite: {
        DEFAULT_BACKGROUND: "#0F172A",
        DEFAULT_LOGO_URL: "",
        DEFAULT_WELCOME_PAGE_LOGO_URL: "",
        SHOW_JITSI_WATERMARK: false,
        SHOW_WATERMARK_FOR_GUESTS: false,
        SHOW_BRAND_WATERMARK: false,
        DISABLE_VIDEO_BACKGROUND: false,
      },
    };
    const j = new window.JitsiMeetExternalAPI(info.domain, options);
    apiRef.current = j;
    j.addListener("readyToClose", () => nav(-1));
    return () => { try { j.dispose(); } catch {} };
  }, [info, jitsiReady, nav]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-foreground text-white"><Loader2 className="animate-spin mr-2" /> Preparing classroom…</div>;
  }
  if (error) {
    const detail = typeof error === "string" ? error : error?.message;
    const openInfo = typeof error === "object" && error?.opens_at ? error : null;
    return (
      <div className="min-h-screen flex items-center justify-center bg-foreground text-white px-6">
        <div className="max-w-md text-center">
          <Video size={40} className="mx-auto mb-4 text-primary" />
          <h1 className="font-display font-extrabold text-3xl mb-2">Classroom not open</h1>
          <p className="text-white/80 mb-1">{detail}</p>
          {openInfo && (
            <p className="text-white/60 text-sm mb-6">Opens at {fmtDate(openInfo.opens_at)}</p>
          )}
          <button className="btn-primary" onClick={() => nav(-1)} data-testid="classroom-back">Back</button>
        </div>
      </div>
    );
  }

  if (info?.provider === "google_meet") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-foreground text-white px-6">
        <div className="max-w-md text-center card-flat bg-white text-foreground p-8">
          <Video size={40} className="mx-auto mb-4 text-primary" />
          <h1 className="font-display font-extrabold text-2xl mb-2">This session uses Google Meet</h1>
          <p className="text-muted-foreground mb-6">Click below to open Google Meet in a new tab.</p>
          {info.join_url ? (
            <a href={info.join_url} target="_blank" rel="noopener noreferrer" className="btn-primary" data-testid="classroom-open-meet">
              <ExternalLink size={16} /> Open Google Meet
            </a>
          ) : (
            <div className="text-sm text-muted-foreground">Your tutor hasn't added the Meet link yet.</div>
          )}
          <div className="mt-4"><Link to={-1} className="btn-ghost">Back</Link></div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-foreground overflow-hidden">
      <header className="h-14 shrink-0 px-4 flex items-center justify-between text-white bg-black/40 backdrop-blur">
        <button onClick={() => nav(-1)} className="btn-ghost text-white hover:!bg-white/10" data-testid="classroom-leave">
          <ChevronLeft size={16} /> Leave
        </button>
        <div className="font-display font-semibold truncate">{info?.booking?.subject} · TutorHive Classroom</div>
        <div className="text-xs opacity-70 hidden sm:block">Room: {info?.room_name?.slice(0, 24)}…</div>
      </header>
      <div ref={containerRef} className="flex-1 min-h-0 w-full" data-testid="classroom-jitsi-container" />
    </div>
  );
}
