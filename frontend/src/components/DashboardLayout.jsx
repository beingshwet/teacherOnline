import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  GraduationCap, LayoutDashboard, Users, CalendarClock, Wallet, Bell, LogOut, Search,
  BookOpen, ShieldCheck, ClipboardList,
} from "lucide-react";

const linksByRole = {
  student: [
    { to: "/student/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "sb-student-dashboard" },
    { to: "/tutors", label: "Find a tutor", icon: Search, testid: "sb-student-tutors" },
    { to: "/student/bookings", label: "My sessions", icon: CalendarClock, testid: "sb-student-bookings" },
    { to: "/student/notifications", label: "Notifications", icon: Bell, testid: "sb-student-notifications" },
  ],
  tutor: [
    { to: "/tutor/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "sb-tutor-dashboard" },
    { to: "/tutor/profile", label: "Profile", icon: BookOpen, testid: "sb-tutor-profile" },
    { to: "/tutor/availability", label: "Availability", icon: CalendarClock, testid: "sb-tutor-availability" },
    { to: "/tutor/bookings", label: "Bookings", icon: ClipboardList, testid: "sb-tutor-bookings" },
    { to: "/tutor/earnings", label: "Earnings", icon: Wallet, testid: "sb-tutor-earnings" },
  ],
  admin: [
    { to: "/admin/dashboard", label: "Overview", icon: LayoutDashboard, testid: "sb-admin-dashboard" },
    { to: "/admin/tutors", label: "Tutors", icon: ShieldCheck, testid: "sb-admin-tutors" },
    { to: "/admin/students", label: "Students", icon: Users, testid: "sb-admin-students" },
    { to: "/admin/bookings", label: "Bookings", icon: CalendarClock, testid: "sb-admin-bookings" },
  ],
};

export default function DashboardLayout({ children, title }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const roleKey = user?.role?.includes("admin") ? "admin" : user?.role || "student";
  const links = linksByRole[roleKey] || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <aside className="hidden lg:flex flex-col w-64 border-r border-border bg-white min-h-screen sticky top-0 h-screen">
          <Link to="/" className="flex items-center gap-2 px-6 h-16 border-b border-border" data-testid="sb-brand">
            <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center"><GraduationCap size={18} /></div>
            <span className="font-display font-extrabold text-lg">TutorHive</span>
          </Link>
          <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
            <div className="eyebrow text-muted-foreground px-3 mb-2">{roleKey}</div>
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} data-testid={l.testid} className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
                <l.icon size={17} />{l.label}
              </NavLink>
            ))}
          </nav>
          <div className="p-3 border-t border-border">
            <div className="px-3 py-2 mb-2">
              <div className="text-xs text-muted-foreground">Signed in as</div>
              <div className="font-semibold text-sm truncate">{user?.first_name} {user?.last_name}</div>
              <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
            </div>
            <button onClick={async () => { await logout(); nav("/"); }} className="sidebar-link w-full" data-testid="sb-logout">
              <LogOut size={17} /> Log out
            </button>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <header className="h-16 border-b border-border bg-white flex items-center justify-between px-6 lg:px-10 sticky top-0 z-30">
            <h1 className="font-display font-extrabold text-2xl tracking-tight">{title}</h1>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-sm text-muted-foreground">{user?.email}</span>
              <div className="w-9 h-9 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-semibold">
                {user?.first_name?.[0]}{user?.last_name?.[0]}
              </div>
            </div>
          </header>
          <div className="px-6 lg:px-10 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
