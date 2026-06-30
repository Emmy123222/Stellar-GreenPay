/**
 * pages/map.tsx — Project World Map
 *
 * Displays a full-screen Leaflet map with a marker for every active
 * ClimateProject.  Clicking a marker opens a mini popup card showing
 * the project name, category, raised XLM, and a Donate link.
 *
 * Data is fetched server-side via getServerSideProps so the page renders
 * a populated marker set on first load without a client-side loading flash.
 *
 * The Leaflet map itself is loaded via next/dynamic with ssr:false — Leaflet
 * depends on browser APIs (document, window) that don't exist on the server.
 */
import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import type { ClimateProject } from "@/utils/types";
import { fetchProjects } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// ── Dynamic import — Leaflet requires a real browser environment ───────────────
const ProjectMap = dynamic(
  () => import("@/components/ProjectMap"),
  {
    ssr:     false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-forest-50">
        <div className="flex flex-col items-center gap-3 text-forest-600">
          <span className="text-3xl animate-spin">🌍</span>
          <span className="text-sm font-body">Loading map…</span>
        </div>
      </div>
    ),
  },
);

// ── Types ──────────────────────────────────────────────────────────────────────

interface MapPageProps {
  projects: ClimateProject[];
  /** ISO timestamp of when data was fetched — shown in the page footer. */
  fetchedAt: string;
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function MapPage({ projects, fetchedAt }: MapPageProps) {
  const { t } = useI18n();
  const activeCount = projects.length;

  return (
    <>
      <Head>
        <title>Project Map — Stellar GreenPay</title>
        <meta
          name="description"
          content="Explore active climate projects on a world map. Click a marker to see project details and donate XLM."
        />
      </Head>

      {/* Full-viewport layout ──────────────────────────────────────────────── */}
      <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>

        {/* Top banner ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 bg-white border-b border-forest-200 shadow-sm flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl" aria-hidden="true">🌍</span>
            <div>
              <h1 className="font-display font-bold text-forest-900 text-base leading-tight">
                {t("map.title")}
              </h1>
              <p className="text-xs text-forest-500 font-body">
                {t("map.subtitle").replace("{count}", String(activeCount))}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Project count badge */}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-forest-100 text-forest-700 text-xs font-body font-semibold border border-forest-200">
              <span className="w-1.5 h-1.5 rounded-full bg-forest-500 animate-pulse" aria-hidden="true" />
              {activeCount} {t("map.activeProjects")}
            </span>

            {/* Link to full project listing */}
            <Link
              href="/projects"
              className="text-xs font-body font-medium text-forest-600 hover:text-forest-800 hover:underline transition-colors hidden sm:block"
            >
              {t("map.browseAll")} →
            </Link>
          </div>
        </div>

        {/* Map ──────────────────────────────────────────────────────────────── */}
        <div className="relative flex-1 overflow-hidden">
          {activeCount === 0 ? (
            /* Empty state ---------------------------------------------------- */
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-forest-50 text-forest-600 px-4 text-center">
              <span className="text-5xl">🌿</span>
              <p className="font-display font-semibold text-lg">{t("map.noProjects")}</p>
              <p className="text-sm font-body text-forest-400">{t("map.noProjectsDesc")}</p>
              <Link href="/projects" className="btn-primary text-sm mt-2">
                {t("map.browseAll")}
              </Link>
            </div>
          ) : (
            <ProjectMap projects={projects} />
          )}

          {/* Bottom-left attribution note (subtle) --------------------------- */}
          <p className="absolute bottom-2 left-3 z-[1000] text-[10px] text-gray-400 pointer-events-none select-none hidden sm:block">
            {t("map.dataUpdated").replace("{time}", new Date(fetchedAt).toLocaleTimeString())}
          </p>
        </div>
      </div>
    </>
  );
}

// ── Server-side data fetching ──────────────────────────────────────────────────

export const getServerSideProps: GetServerSideProps<MapPageProps> = async () => {
  try {
    // Only show active, verified projects on the map
    const projects = await fetchProjects({ status: "active" });
    return {
      props: {
        projects,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch {
    // On API failure, render an empty map rather than a 500 page
    return {
      props: {
        projects: [],
        fetchedAt: new Date().toISOString(),
      },
    };
  }
};
