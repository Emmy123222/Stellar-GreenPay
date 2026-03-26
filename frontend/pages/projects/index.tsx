/**
 * pages/projects/index.tsx — Browse all climate projects
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import ProjectCard, { ProjectCardSkeleton } from "@/components/ProjectCard";
import { fetchProjects } from "@/lib/api";
import { PROJECT_CATEGORIES, CATEGORY_ICONS } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";
import clsx from "clsx";

export default function ProjectsPage() {
  const router   = useRouter();
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");

  const category = (router.query.category as string) || "";
  const status   = (router.query.status   as string) || "active";
  const verified = (router.query.verified as string) === "true";

  useEffect(() => {
    setLoading(true);
    fetchProjects({ 
      category: category || undefined, 
      status: status || undefined, 
      verified: verified || undefined,
      limit: 50 
    })
      .then(setProjects).catch(console.error).finally(() => setLoading(false));
  }, [category, status, verified]);

  const filtered = search.trim()
    ? projects.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase()) ||
        p.location.toLowerCase().includes(search.toLowerCase())
      )
    : projects;

  const setFilter = (key: string, val: string) => {
    router.push({ pathname: "/projects", query: { ...router.query, [key]: val || undefined } }, undefined, { shallow: true });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-forest-900 mb-1">Climate Projects</h1>
          <p className="text-[#5a7a5a] text-sm font-body">
            {loading ? "Loading..." : `${filtered.length} verified project${filtered.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8aaa8a]">🔍</span>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search projects by name, location, or keyword..."
          className="input-field pl-10" />
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <aside className="hidden lg:block w-52 flex-shrink-0 space-y-6">

          <div>
            <p className="label">Status</p>
            <div className="space-y-1">
              {[["active","Active"], ["completed","Completed"], ["","All"]].map(([val, lab]) => (
                <button key={val} onClick={() => setFilter("status", val)}
                  className={clsx("w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body",
                    status === val ? "bg-forest-100 text-forest-700 font-semibold" : "text-[#5a7a5a] hover:bg-forest-50 hover:text-forest-700")}>
                  {lab}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label">Verification</p>
            <button 
              onClick={() => setFilter("verified", verified ? "" : "true")}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors font-body",
                verified 
                  ? "bg-forest-100 text-forest-700" 
                  : "text-[#5a7a5a] hover:bg-forest-50 hover:text-forest-700"
              )}>
              {/* Toggle Switch */}
              <div className={clsx(
                "relative w-10 h-6 rounded-full transition-colors",
                verified ? "bg-emerald-600" : "bg-[#d0d0d0]"
              )}>
                <div className={clsx(
                  "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                  verified ? "right-1" : "left-1"
                )} />
              </div>
              <span className="flex-1 text-left">
                ✓ Verified only <span className="text-xs text-[#8aaa8a]">({projects.filter(p => p.verified).length})</span>
              </span>
            </button>
          </div>

          <div>
            <p className="label">Category</p>
            <div className="space-y-1">
              <button onClick={() => setFilter("category", "")}
                className={clsx("w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body",
                  !category ? "bg-forest-100 text-forest-700 font-semibold" : "text-[#5a7a5a] hover:bg-forest-50 hover:text-forest-700")}>
                All Categories
              </button>
              {PROJECT_CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setFilter("category", cat)}
                  className={clsx("w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body flex items-center gap-2",
                    category === cat ? "bg-forest-100 text-forest-700 font-semibold" : "text-[#5a7a5a] hover:bg-forest-50 hover:text-forest-700")}>
                  <span>{CATEGORY_ICONS[cat]}</span>{cat}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Grid */}
        <div className="flex-1">
          {loading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <ProjectCardSkeleton key={i} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card text-center py-16">
              <p className="text-4xl mb-3">🌿</p>
              <p className="font-display text-xl text-forest-900 mb-2">No projects found</p>
              <p className="text-[#5a7a5a] text-sm font-body">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(p => <ProjectCard key={p.id} project={p} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
