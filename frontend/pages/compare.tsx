/**
 * pages/compare.tsx — Side-by-side project impact comparison
 *
 * Accepts ?ids=uuid1,uuid2,uuid3 query param and renders a comparison
 * table showing CO₂ per XLM, % goal reached, donor count, verification
 * status, and average rating for up to 3 projects.
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import ProjectComparison from "@/components/ProjectComparison";
import { fetchProject } from "@/lib/api";
import type { ClimateProject } from "@/utils/types";

export default function ComparePage() {
  const router = useRouter();
  const { ids } = router.query;

  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // The initial load is tracked by comparing the ids the projects were
  // loaded for to the current ids query param (derived, rather than toggled
  // synchronously inside the effect, which triggers a cascading render).
  const [loadedForKey, setLoadedForKey] = useState<string | null>(null);

  const idsKey = typeof ids === "string" ? ids : null;
  const idList = idsKey ? idsKey.split(",").slice(0, 3).map((id) => id.trim()).filter(Boolean) : [];

  const loading = idsKey === null ? true : idList.length > 0 && loadedForKey !== idsKey;
  const error = idsKey !== null && idList.length === 0
    ? "No valid project IDs provided. Use ?ids=uuid1,uuid2,uuid3"
    : fetchError;

  useEffect(() => {
    if (idList.length === 0) return;

    Promise.all(idList.map((id) => fetchProject(id)))
      .then((results) => {
        setProjects(results);
        setFetchError(null);
      })
      .catch(() => {
        setFetchError("Failed to load one or more projects. Check the IDs and try again.");
      })
      .finally(() => setLoadedForKey(idsKey));
    // idList is a pure derivation of idsKey (already a dep) recomputed fresh
    // every render; adding it here would refire this effect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
        <div className="h-8 bg-forest-200 rounded w-1/3 mb-6" />
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-4 bg-forest-100 rounded w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <Head>
          <title>Compare Projects — Stellar GreenPay</title>
        </Head>
        <div className="card text-center py-16">
          <p className="text-5xl mb-4">🔍</p>
          <h2 className="font-display text-xl font-semibold text-forest-900 mb-2">
            Could not load projects
          </h2>
          <p className="text-[#5a7a5a] dark:text-[#8aaa8a] text-sm font-body mb-6">
            {error}
          </p>
          <Link
            href="/projects"
            className="btn-primary text-sm py-2 px-6 inline-flex items-center gap-2"
          >
            ← Browse Projects
          </Link>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <Head>
          <title>Compare Projects — Stellar GreenPay</title>
        </Head>
        <div className="card text-center py-16">
          <p className="text-5xl mb-4">📊</p>
          <h2 className="font-display text-xl font-semibold text-forest-900 mb-2">
            Compare Projects
          </h2>
          <p className="text-[#5a7a5a] dark:text-[#8aaa8a] text-sm font-body mb-4">
            Add project IDs to the URL to compare them side by side.
          </p>
          <p className="text-xs text-[#8aaa8a] dark:text-forest-300 font-mono bg-forest-50 rounded-lg p-3 inline-block">
            /compare?ids=uuid1,uuid2,uuid3
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <Head>
        <title>
          Compare {projects.map((p) => p.name).join(" vs ")} — Stellar GreenPay
        </title>
        <meta
          name="description"
          content={`Side-by-side comparison of ${projects.map((p) => p.name).join(", ")}`}
        />
      </Head>

      <Link
        href="/projects"
        className="inline-flex items-center gap-1 text-sm text-[#5a7a5a] dark:text-[#8aaa8a] hover:text-forest-700 transition-colors mb-6 font-body"
      >
        ← Back to Projects
      </Link>

      <ProjectComparison
        projects={projects}
        onClose={() => router.push("/projects")}
      />
    </div>
  );
}
