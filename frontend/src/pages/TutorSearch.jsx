import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PublicHeader from "@/components/PublicHeader";
import { api } from "@/lib/api";
import { Star, Search, Filter, ChevronLeft, ChevronRight } from "lucide-react";

export default function TutorSearch() {
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState({ tutors: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState([]);
  const page = parseInt(sp.get("page") || "1");
  const subject = sp.get("subject") || "";
  const grade = sp.get("grade") || "";
  const maxPrice = sp.get("max_price") || "";
  const q = sp.get("q") || "";

  useEffect(() => { api.get("/subjects").then((r) => setSubjects(r.data)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = { page, page_size: 12 };
    if (subject) params.subject = subject;
    if (grade) params.grade = grade;
    if (maxPrice) params.max_price = maxPrice;
    if (q) params.q = q;
    api.get("/tutors", { params })
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [page, subject, grade, maxPrice, q]);

  const totalPages = Math.max(1, Math.ceil(data.total / 12));

  const update = (patch) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => v ? next.set(k, v) : next.delete(k));
    if (!("page" in patch)) next.set("page", "1");
    setSp(next);
  };

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-12">
        <div className="mb-8">
          <div className="eyebrow text-primary mb-3">Tutor marketplace</div>
          <h1 className="font-display font-extrabold text-4xl lg:text-5xl tracking-tight">Find your tutor.</h1>
          <p className="text-muted-foreground mt-2">Filter, compare, and book — all in one place.</p>
        </div>

        <div className="grid lg:grid-cols-12 gap-8">
          <aside className="lg:col-span-3">
            <div className="card-flat p-5 bg-white sticky top-24">
              <div className="flex items-center gap-2 mb-4"><Filter size={16} /><span className="font-semibold">Filters</span></div>
              <div className="mb-4">
                <label className="label">Search</label>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input className="field pl-9" defaultValue={q} onKeyDown={(e) => e.key === "Enter" && update({ q: e.target.value })} placeholder="Name, keyword..." data-testid="filter-search" />
                </div>
              </div>
              <div className="mb-4">
                <label className="label">Subject</label>
                <select className="field" value={subject} onChange={(e) => update({ subject: e.target.value })} data-testid="filter-subject">
                  <option value="">All subjects</option>
                  {subjects.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div className="mb-4">
                <label className="label">Grade level</label>
                <select className="field" value={grade} onChange={(e) => update({ grade: e.target.value })} data-testid="filter-grade">
                  <option value="">Any grade</option>
                  {["4", "5", "6", "7", "8", "9", "10", "11", "12", "College"].map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div className="mb-4">
                <label className="label">Max price /hr</label>
                <input type="number" className="field" value={maxPrice} onChange={(e) => update({ max_price: e.target.value })} placeholder="e.g. 50" data-testid="filter-price" />
              </div>
              <button className="btn-ghost w-full justify-center" onClick={() => setSp({})} data-testid="filter-clear">Clear filters</button>
            </div>
          </aside>

          <section className="lg:col-span-9">
            <div className="mb-4 text-sm text-muted-foreground" data-testid="results-count">
              {loading ? "Loading..." : `${data.total} tutor${data.total === 1 ? "" : "s"} found`}
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
              {data.tutors.map((t) => (
                <Link key={t.id} to={`/tutors/${t.id}`} className="card-flat p-5 bg-white flex flex-col fade-up" data-testid={`tutor-card-${t.id}`}>
                  <div className="flex items-start gap-4 mb-3">
                    <img src={t.photo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${t.first_name}${t.last_name}`}
                      className="w-14 h-14 rounded-xl object-cover border" alt="" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{t.first_name} {t.last_name}</div>
                      <div className="text-xs text-muted-foreground truncate">{t.qualifications || "Certified tutor"}</div>
                      <div className="flex items-center gap-1 mt-1 text-sm">
                        <Star size={13} className="fill-primary text-primary" />
                        <span>{t.rating_avg || 0}</span>
                        <span className="text-muted-foreground text-xs">({t.total_reviews})</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{t.bio}</p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {t.subjects.slice(0, 3).map((s) => <span key={s} className="chip text-[0.7rem]">{s}</span>)}
                  </div>
                  <div className="flex items-end justify-between mt-auto pt-3 border-t border-border">
                    <div className="text-xs text-muted-foreground">{t.experience_years}+ yrs experience</div>
                    <div className="font-bold text-lg">${t.hourly_price}<span className="text-sm text-muted-foreground font-normal">/hr</span></div>
                  </div>
                </Link>
              ))}
            </div>
            {!loading && data.tutors.length === 0 && (
              <div className="card-flat p-10 bg-white text-center text-muted-foreground" data-testid="results-empty">
                No tutors matched your filters. Try clearing them.
              </div>
            )}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-8">
                <button className="btn-outline" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}><ChevronLeft size={16} /> Prev</button>
                <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <button className="btn-outline" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>Next <ChevronRight size={16} /></button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
