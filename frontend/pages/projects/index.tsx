/**
 * pages/projects/index.tsx — Browse all climate projects
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import ProjectCard, { ProjectCardSkeleton } from "@/components/ProjectCard";
import ProjectComparison from "@/components/ProjectComparison";
import { fetchProjects } from "@/lib/api";
import { PROJECT_CATEGORIES, CATEGORY_ICONS } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";
import { useAutocomplete } from "@/hooks/useAutocomplete";
import clsx from "clsx";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  
  const searchRef = useRef<HTMLDivElement>(null);
  
  const {
    query: search,
    setQuery: setSearch,
    results: autocompleteResults,
    isOpen: isAutocompleteOpen,
    setIsOpen: setIsAutocompleteOpen,
    activeIndex,
    handleKeyDown
  } = useAutocomplete<ClimateProject>(
    async (q) => {
      const data = await fetchProjects({ search: q, limit: 5 });
      return data;
    }
  );

  const category = (router.query.category as string) || "";
  const status = (router.query.status as string) || "active";
  const verified = (router.query.verified as string) === "true";
  const searchQuery = (router.query.search as string) || "";
  const compareQuery = (router.query.compare as string) || "";

  const selectedProjects = useMemo(
    () => projects.filter((project) => selectedProjectIds.includes(project.id)),
    [projects, selectedProjectIds],
  );

  // Initialize search from URL query parameter
  useEffect(() => {
    if (searchQuery && !search) {
      setSearch(searchQuery);
    }
  }, [searchQuery]);

  // Click outside listener for autocomplete
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsAutocompleteOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      fetchProjects({
        category: category || undefined,
        status: status || undefined,
        verified: verified || undefined,
        search: search || undefined,
        limit: 50,
      })
        .then(setProjects)
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [category, status, verified, search]);

  useEffect(() => {
    if (!compareQuery || projects.length === 0) return;
    const ids = compareQuery
      .split(",")
      .map((id) => id.trim())
      .filter((id) => projects.some((project) => project.id === id))
      .slice(0, 3);
    if (ids.length >= 2) {
      setSelectedProjectIds(ids);
      setShowComparison(true);
    }
  }, [compareQuery, projects]);

  const setFilter = (key: string, val: string) => {
    router.push(
      {
        pathname: "/projects",
        query: { ...router.query, [key]: val || undefined },
      },
      undefined,
      { shallow: true },
    );
  };

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearch(value);
      
      // Update URL with search query (debounced would be better but keeping simple for now)
      const timer = setTimeout(() => {
        router.push(
          {
            pathname: "/projects",
            query: { ...router.query, search: value || undefined },
          },
          undefined,
          { shallow: true },
        );
      }, 500);
      return () => clearTimeout(timer);
    },
    [router, router.query, setSearch],
  );

  const handleSelectProject = (project: ClimateProject) => {
    setIsAutocompleteOpen(false);
    router.push(`/projects/${project.id}`);
  };

  const toggleSelection = (projectId: string) => {
    setSelectedProjectIds((current) => {
      if (current.includes(projectId)) {
        return current.filter((id) => id !== projectId);
      }
      if (current.length >= 3) {
        return current;
      }
      return [...current, projectId];
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-forest-900 mb-1">
            Climate Projects
          </h1>
          <p className="text-[#5a7a5a] text-sm font-body">
            {loading
              ? "Loading..."
              : `${projects.length} verified project${projects.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6" ref={searchRef}>
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8aaa8a] z-10">
          🔍
        </span>
        <input
          type="text"
          value={search}
          onChange={handleSearchChange}
          onKeyDown={(e) => {
            handleKeyDown(e);
            if (e.key === 'Enter' && activeIndex >= 0) {
              handleSelectProject(autocompleteResults[activeIndex]);
            }
          }}
          onFocus={() => search.length >= 2 && setIsAutocompleteOpen(true)}
          placeholder="Search projects by name, location, or keyword..."
          className="input-field pl-10 relative z-10"
        />

        {/* Autocomplete Dropdown */}
        {isAutocompleteOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-forest-200 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in">
            {autocompleteResults.map((p, i) => (
              <div
                key={p.id}
                onClick={() => handleSelectProject(p)}
                className={clsx(
                  "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-forest-50 last:border-0",
                  i === activeIndex ? "bg-forest-100" : "hover:bg-forest-50"
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-forest-100 flex items-center justify-center text-lg flex-shrink-0">
                  {CATEGORY_ICONS[p.category] || "🌿"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-forest-900 truncate">{p.name}</p>
                  <p className="text-xs text-[#8aaa8a] font-body truncate">{p.location} · {p.category}</p>
                </div>
                <div className="text-xs font-bold text-forest-500 uppercase tracking-widest opacity-40">View →</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <aside className="hidden lg:block w-52 flex-shrink-0 space-y-6">
          <div>
            <p className="label">Status</p>
            <div className="space-y-1">
              {[
                ["active", "Active"],
                ["completed", "Completed"],
                ["", "All"],
              ].map(([val, lab]) => (
                <button
                  key={val}
                  onClick={() => setFilter("status", val)}
                  className={clsx(
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body",
                    status === val
                      ? "bg-forest-100 text-forest-700 font-semibold"
                      : "text-[#5a7a5a] hover:bg-forest-50 hover:text-forest-700",
                  )}
                >
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
                  : "text-[#5a7a5a] hover:bg-forest-50 hover:text-forest-700",
              )}
            >
              {/* Toggle Switch */}
              <div
                className={clsx(
                  "relative w-10 h-6 rounded-full transition-colors",
                  verified ? "bg-emerald-600" : "bg-[#d0d0d0]",
                )}
              >
                <div
                  className={clsx(
                    "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                    verified ? "right-1" : "left-1",
                  )}
                />
              </div>
              <span className="flex-1 text-left">
                ✓ Verified only{" "}
                <span className="text-xs text-[#8aaa8a]">
                  ({projects.filter((p) => p.verified).length})
                </span>
              </span>
            </button>
          </div>

          <div>
            <p className="label">Category</p>
            <div className="space-y-1">
              <button
                onClick={() => setFilter("category", "")}
                className={clsx(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body",
                  !category
                    ? "bg-forest-100 text-forest-700 font-semibold"
                    : "text-[#5a7a5a] hover:bg-forest-50 hover:text-forest-700",
                )}
              >
                All Categories
              </button>
              {PROJECT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilter("category", cat)}
                  className={clsx(
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body flex items-center gap-2",
                    category === cat
                      ? "bg-forest-100 text-forest-700 font-semibold"
                      : "text-[#5a7a5a] hover:bg-forest-50 hover:text-forest-700",
                  )}
                >
                  <span>{CATEGORY_ICONS[cat]}</span>
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Grid */}
        <div className="flex-1">
          {selectedProjectIds.length >= 2 && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-forest-200 bg-forest-50 px-4 py-3">
              <p className="text-sm text-forest-800 font-body">
                {selectedProjectIds.length} selected for comparison
              </p>
              <button
                type="button"
                onClick={() => setShowComparison(true)}
                className="btn-primary text-sm py-2 px-4"
              >
                Compare selected
              </button>
            </div>
          )}

          {loading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <ProjectCardSkeleton key={i} />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="card text-center py-16">
              <p className="text-4xl mb-3">🌿</p>
              <p className="font-display text-xl text-forest-900 mb-2">
                {search ? `No results for "${search}"` : "No projects found"}
              </p>
              <p className="text-[#5a7a5a] text-sm font-body">
                {search
                  ? "Try a different search"
                  : "Try adjusting your filters"}
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((p) => (
                <div key={p.id} className="relative">
                  <label
                    className={`absolute left-3 top-3 z-30 flex items-center gap-2 rounded-md border px-2 py-1 text-xs font-body shadow-sm ${
                      selectedProjectIds.includes(p.id)
                        ? "bg-forest-700 text-white border-forest-700"
                        : "bg-white text-forest-700 border-forest-200"
                    }`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedProjectIds.includes(p.id)}
                      onChange={() => toggleSelection(p.id)}
                      disabled={selectedProjectIds.length >= 3 && !selectedProjectIds.includes(p.id)}
                    />
                    Compare
                  </label>
                  <ProjectCard project={p} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showComparison && selectedProjects.length >= 2 && (
        <ProjectComparison
          projects={selectedProjects}
          onClose={() => setShowComparison(false)}
        />
      )}
    </div>
  );
}
