import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { GraduationCap, Menu, X } from "lucide-react";
import { useState } from "react";

export default function PublicHeader() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const dashPath = user?.role === "tutor" ? "/tutor/dashboard" : user?.role?.includes("admin") ? "/admin/dashboard" : "/student/dashboard";

  return (
    <header className="glass-header sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2" data-testid="brand-logo">
          <div className="w-9 h-9 rounded-xl bg-primary text-white flex items-center justify-center">
            <GraduationCap size={20} />
          </div>
          <span className="font-display font-extrabold text-xl">TutorHive</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <NavLink to="/tutors" className="btn-ghost" data-testid="nav-find-tutor">Find a tutor</NavLink>
          <NavLink to="/about" className="btn-ghost" data-testid="nav-about">How it works</NavLink>
          {user ? (
            <>
              <Link to={dashPath} className="btn-ghost" data-testid="nav-dashboard">Dashboard</Link>
              <button className="btn-ghost" onClick={async () => { await logout(); nav("/"); }} data-testid="nav-logout">Log out</button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-ghost" data-testid="nav-login">Log in</Link>
              <Link to="/register" className="btn-primary" data-testid="nav-signup">Get started</Link>
            </>
          )}
        </nav>

        <button className="md:hidden btn-ghost" onClick={() => setOpen(!open)} data-testid="nav-menu-toggle">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && (
        <div className="md:hidden border-t bg-white px-6 py-3 flex flex-col gap-1">
          <Link to="/tutors" onClick={() => setOpen(false)} className="btn-ghost justify-start">Find a tutor</Link>
          <Link to="/about" onClick={() => setOpen(false)} className="btn-ghost justify-start">How it works</Link>
          {user ? (
            <>
              <Link to={dashPath} onClick={() => setOpen(false)} className="btn-ghost justify-start">Dashboard</Link>
              <button onClick={async () => { await logout(); setOpen(false); nav("/"); }} className="btn-ghost justify-start">Log out</button>
            </>
          ) : (
            <>
              <Link to="/login" onClick={() => setOpen(false)} className="btn-ghost justify-start">Log in</Link>
              <Link to="/register" onClick={() => setOpen(false)} className="btn-primary">Get started</Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
