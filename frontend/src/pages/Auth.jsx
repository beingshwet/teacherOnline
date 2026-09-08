import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PublicHeader from "@/components/PublicHeader";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function Login() {
  const { login, formatError } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const u = await login(email, password);
      toast.success(`Welcome back, ${u.first_name}!`);
      const dash = u.role === "tutor" ? "/tutor/dashboard" : u.role.includes("admin") ? "/admin/dashboard" : "/student/dashboard";
      nav(dash);
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <div className="max-w-md mx-auto px-6 py-16">
        <h1 className="font-display font-extrabold text-4xl tracking-tight mb-2">Welcome back</h1>
        <p className="text-muted-foreground mb-8">Log in to continue learning.</p>
        <form onSubmit={submit} className="card-flat p-6 bg-white space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="field" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" />
          </div>
          {err && <div className="text-sm text-destructive" data-testid="login-error">{err}</div>}
          <button className="btn-primary w-full" disabled={loading} data-testid="login-submit">
            {loading ? "Signing in..." : "Log in"}
          </button>
          <div className="text-center text-sm text-muted-foreground">
            No account? <Link to="/register" className="text-primary font-semibold">Sign up</Link>
          </div>
        </form>
        <div className="mt-6 text-xs text-muted-foreground text-center">
          Demo: student@example.com / Student@12345 · tutor@example.com / Tutor@12345 · admin@example.com / Admin@12345
        </div>
      </div>
    </div>
  );
}

export function Register() {
  const { register, formatError } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [role, setRole] = useState(sp.get("role") === "tutor" ? "tutor" : "student");
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "", password: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const u = await register({ ...form, role });
      toast.success(`Welcome, ${u.first_name}!`);
      nav(role === "tutor" ? "/tutor/profile" : "/student/dashboard");
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <div className="max-w-md mx-auto px-6 py-16">
        <h1 className="font-display font-extrabold text-4xl tracking-tight mb-2">Create your account</h1>
        <p className="text-muted-foreground mb-8">Free forever. Start learning or teaching in seconds.</p>

        <div className="flex gap-2 mb-5">
          {["student", "tutor"].map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)}
              className={`flex-1 py-3 rounded-xl border font-semibold capitalize transition ${role === r ? "bg-primary text-white border-primary" : "bg-white border-border hover:bg-secondary"}`}
              data-testid={`register-role-${r}`}>
              I'm a {r}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="card-flat p-6 bg-white space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">First name</label>
              <input className="field" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} data-testid="register-firstname" />
            </div>
            <div>
              <label className="label">Last name</label>
              <input className="field" required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} data-testid="register-lastname" />
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input className="field" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="register-email" />
          </div>
          <div>
            <label className="label">Phone (optional)</label>
            <input className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="register-phone" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="field" type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="register-password" />
          </div>
          {err && <div className="text-sm text-destructive" data-testid="register-error">{err}</div>}
          <button className="btn-primary w-full" disabled={loading} data-testid="register-submit">
            {loading ? "Creating..." : "Create account"}
          </button>
          <div className="text-center text-sm text-muted-foreground">
            Already have an account? <Link to="/login" className="text-primary font-semibold">Log in</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
