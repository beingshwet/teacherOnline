import { Link } from "react-router-dom";
import PublicHeader from "@/components/PublicHeader";
import { Star, Calendar, ShieldCheck, Video, MessageSquare, ChevronRight, GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const SUBJECTS = [
  { name: "Mathematics", color: "bg-orange-50 text-orange-700" },
  { name: "Science", color: "bg-emerald-50 text-emerald-700" },
  { name: "English", color: "bg-sky-50 text-sky-700" },
  { name: "Physics", color: "bg-rose-50 text-rose-700" },
  { name: "Chemistry", color: "bg-amber-50 text-amber-700" },
  { name: "Computer Science", color: "bg-violet-50 text-violet-700" },
];

const HOW = [
  { title: "Discover", body: "Search verified tutors by subject, grade, price and availability.", icon: GraduationCap },
  { title: "Book", body: "Pick a time that fits your schedule and confirm in seconds.", icon: Calendar },
  { title: "Meet on Google Meet", body: "Join your session with a single click. No installs.", icon: Video },
  { title: "Grow", body: "Rate your tutor, track progress, and build a learning routine.", icon: Star },
];

export default function Landing() {
  const [featured, setFeatured] = useState([]);

  useEffect(() => {
    api.get("/tutors", { params: { page: 1, page_size: 3 } })
      .then((r) => setFeatured(r.data.tutors || []))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen">
      <PublicHeader />

      {/* Hero */}
      <section className="noise-bg">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-20 pb-24 grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 fade-up">
            <div className="chip mb-6" data-testid="hero-eyebrow">Live 1-on-1 tutoring</div>
            <h1 className="font-display font-extrabold text-5xl sm:text-6xl lg:text-7xl leading-[0.95] tracking-tight text-foreground">
              Learn from the right tutor,<br /> <span className="text-primary">one-on-one.</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl">
              Book personalized online tutoring sessions with experienced educators from anywhere. Real teachers, real progress, all on Google Meet.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/tutors" className="btn-primary" data-testid="hero-find-tutor">Find a tutor <ChevronRight size={18} /></Link>
              <Link to="/register?role=tutor" className="btn-outline" data-testid="hero-become-tutor">Become a tutor</Link>
            </div>
            <div className="mt-10 flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-primary" /> Vetted tutors</div>
              <div className="flex items-center gap-2"><Video size={16} className="text-primary" /> Google Meet classes</div>
              <div className="flex items-center gap-2"><Star size={16} className="text-primary" /> Rated 4.9 / 5</div>
            </div>
          </div>
          <div className="lg:col-span-5">
            <div className="relative">
              <img src="https://images.unsplash.com/photo-1616587226960-4a03badbe8bf" alt="Tutor teaching online"
                className="rounded-3xl border border-border shadow-xl aspect-[4/5] object-cover w-full" />
              <div className="absolute -bottom-6 -left-6 card-flat p-4 w-56 hidden sm:block bg-white">
                <div className="eyebrow text-muted-foreground mb-1">Next session</div>
                <div className="font-semibold">Algebra II</div>
                <div className="text-sm text-muted-foreground">Today • 5:00 PM</div>
                <div className="mt-2 chip">Confirmed</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-6 lg:px-10 py-24">
        <div className="max-w-2xl mb-14">
          <div className="eyebrow text-primary mb-3">How it works</div>
          <h2 className="font-display font-extrabold text-4xl tracking-tight">From matched to mastering, in four steps.</h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {HOW.map((h, i) => (
            <div key={h.title} className="card-flat p-6 bg-white" data-testid={`how-step-${i}`}>
              <div className="w-11 h-11 rounded-xl bg-accent text-accent-foreground flex items-center justify-center mb-4"><h.icon size={20} /></div>
              <div className="stat-num text-primary mb-2">{String(i + 1).padStart(2, "0")}</div>
              <div className="font-semibold text-lg mb-1">{h.title}</div>
              <div className="text-sm text-muted-foreground">{h.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Popular subjects */}
      <section className="bg-white border-y border-border">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20">
          <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
            <div>
              <div className="eyebrow text-primary mb-3">Popular subjects</div>
              <h2 className="font-display font-extrabold text-4xl tracking-tight">Browse by what you're learning.</h2>
            </div>
            <Link to="/tutors" className="btn-ghost">All subjects <ChevronRight size={16} /></Link>
          </div>
          <div className="flex flex-wrap gap-3">
            {SUBJECTS.map((s) => (
              <Link key={s.name} to={`/tutors?subject=${encodeURIComponent(s.name)}`}
                className={`px-5 py-3 rounded-full font-semibold text-sm border border-transparent hover:border-border transition ${s.color}`}
                data-testid={`subject-chip-${s.name.toLowerCase().replace(/\s+/g, '-')}`}>
                {s.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured tutors */}
      <section className="max-w-7xl mx-auto px-6 lg:px-10 py-24">
        <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
          <div>
            <div className="eyebrow text-primary mb-3">Featured tutors</div>
            <h2 className="font-display font-extrabold text-4xl tracking-tight">Handpicked educators, ready when you are.</h2>
          </div>
          <Link to="/tutors" className="btn-outline">See all tutors</Link>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {featured.map((t) => (
            <Link key={t.id} to={`/tutors/${t.id}`} className="card-flat p-6 bg-white" data-testid={`featured-tutor-${t.id}`}>
              <div className="flex items-center gap-4 mb-4">
                <img src={t.photo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${t.first_name}${t.last_name}`}
                  className="w-16 h-16 rounded-2xl object-cover border border-border" alt={t.first_name} />
                <div>
                  <div className="font-semibold text-lg">{t.first_name} {t.last_name}</div>
                  <div className="text-sm text-muted-foreground">{t.experience_years}+ yrs • {t.subjects[0]}</div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{t.bio}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-sm"><Star size={14} className="fill-primary text-primary" /> {t.rating_avg} <span className="text-muted-foreground">({t.total_reviews})</span></div>
                <div className="font-semibold">${t.hourly_price}<span className="text-sm text-muted-foreground">/hr</span></div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Why us */}
      <section className="bg-foreground text-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-24 grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6">
            <div className="eyebrow text-primary mb-3">Why TutorHive</div>
            <h2 className="font-display font-extrabold text-4xl lg:text-5xl tracking-tight">Built for real learning, not just video chat.</h2>
            <p className="text-muted-foreground/80 mt-6 text-lg">Every tutor is vetted. Every session runs on Google Meet. Every booking is transparent. No dark patterns, no surprise fees.</p>
          </div>
          <div className="lg:col-span-6 grid sm:grid-cols-2 gap-4">
            {[
              { icon: ShieldCheck, title: "Vetted tutors", body: "Manual approval by our team." },
              { icon: Calendar, title: "Real availability", body: "Book only the slots tutors truly offer." },
              { icon: Video, title: "Google Meet built-in", body: "One-click join, no installs." },
              { icon: MessageSquare, title: "Ratings that matter", body: "Only students who attended can review." },
            ].map((b, i) => (
              <div key={i} className="rounded-2xl border border-white/10 p-5 bg-white/5">
                <b.icon size={22} className="text-primary mb-3" />
                <div className="font-semibold mb-1">{b.title}</div>
                <div className="text-sm text-white/70">{b.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 lg:px-10 py-24 text-center">
        <h2 className="font-display font-extrabold text-4xl lg:text-5xl tracking-tight">Ready to learn?</h2>
        <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Create a free account and book your first session in under a minute.</p>
        <div className="mt-8 flex justify-center gap-3 flex-wrap">
          <Link to="/register" className="btn-primary" data-testid="cta-signup">Create free account</Link>
          <Link to="/tutors" className="btn-outline" data-testid="cta-browse">Browse tutors</Link>
        </div>
      </section>

      <footer className="border-t border-border py-10 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} TutorHive. A production-quality Phase 1 MVP.
      </footer>
    </div>
  );
}
