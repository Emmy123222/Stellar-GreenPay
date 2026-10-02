import Link from "next/link";
import { useMemo, useState } from "react";
import { progressPercent } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";

interface ProjectComparisonProps {
  projects: ClimateProject[];
  onClose: () => void;
  onRemoveProject?: (projectId: string) => void;
  onAddProject?: () => void;
}

const ROWS = [
  { key: "co2", label: "CO₂ per XLM" },
  { key: "progress", label: "% Goal Reached" },
  { key: "donorCount", label: "Donor Count" },
  { key: "averageRating", label: "Avg Rating" },
  { key: "verified", label: "Verified" },
] as const;

export default function ProjectComparison({
  projects,
  onClose,
  onRemoveProject,
  onAddProject,
}: ProjectComparisonProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");

  const activeProjects = useMemo(
    () => projects.filter((project) => !removedIds.includes(project.id)),
    [projects, removedIds],
  );

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.searchParams.set("compare", activeProjects.map((project) => project.id).join(","));
    return url.toString();
  }, [activeProjects]);

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopyState("copied");
    setLiveAnnouncement("Comparison link copied to clipboard");
    window.setTimeout(() => setCopyState("idle"), 2000);
  };

  const handleRemove = (projectId: string) => {
    const projectToRemove = activeProjects.find((p) => p.id === projectId);
    setRemovedIds((prev) => [...prev, projectId]);
    if (onRemoveProject) {
      onRemoveProject(projectId);
    }
    if (projectToRemove) {
      setLiveAnnouncement(`${projectToRemove.name} removed from comparison`);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="comparison-title"
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4"
    >
      {/* Live announcement region for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      <div className="w-full max-w-6xl card bg-white max-h-[90vh] overflow-auto flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 id="comparison-title" className="font-display text-xl font-semibold text-forest-900">
            Project Comparison
          </h2>
          <div className="flex items-center gap-2">
            {activeProjects.length < 3 && (
              onAddProject ? (
                <button
                  type="button"
                  onClick={onAddProject}
                  aria-label="Add project to comparison"
                  className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Add Project</span>
                </button>
              ) : (
                <Link
                  href="/projects"
                  aria-label="Add project to comparison"
                  className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Add Project</span>
                </Link>
              )
            )}
            <button
              type="button"
              onClick={handleCopyLink}
              aria-label={copyState === "copied" ? "URL copied to clipboard" : "Share comparison URL"}
              className="btn-secondary text-xs py-1.5 px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600"
            >
              {copyState === "copied" ? "Copied URL" : "Share URL"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close comparison modal"
              className="btn-secondary text-xs py-1.5 px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600"
            >
              Close
            </button>
          </div>
        </div>

        {activeProjects.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-display text-lg text-forest-900 mb-2">No projects to compare</p>
            <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] mb-6">
              All projects have been removed from the comparison.
            </p>
            {onAddProject ? (
              <button
                type="button"
                onClick={onAddProject}
                className="btn-primary text-sm py-2 px-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600"
                aria-label="Add project to comparison"
              >
                Add Projects
              </button>
            ) : (
              <Link
                href="/projects"
                onClick={onClose}
                className="btn-primary text-sm py-2 px-6 inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600"
                aria-label="Browse projects to compare"
              >
                Browse Projects
              </Link>
            )}
          </div>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-label="Project comparison table"
            className="overflow-x-auto w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 rounded"
          >
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Comparison of selected climate projects across environmental impact, funding progress, and metrics
              </caption>
              <thead>
                <tr className="border-b border-forest-200">
                  <th
                    scope="col"
                    className="w-[150px] min-w-[150px] p-3 font-body text-xs uppercase tracking-widest text-[#8aaa8a] dark:text-forest-300 align-top"
                  >
                    Metric
                  </th>
                  {activeProjects.map((project) => (
                    <th
                      key={`${project.id}-header`}
                      scope="col"
                      className="min-w-[180px] p-3 align-top font-normal"
                    >
                      <div className="p-3 rounded-lg bg-forest-50 border border-forest-200">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-display text-sm font-semibold text-forest-900 break-words">
                              {project.name}
                            </p>
                            <p className="text-xs text-[#5a7a5a] dark:text-[#8aaa8a] mt-1 font-body">
                              {project.category}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemove(project.id)}
                            aria-label={`Remove ${project.name} from comparison`}
                            className="text-[#8aaa8a] hover:text-forest-900 rounded p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth="2"
                              aria-hidden="true"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.key} className="border-t border-forest-100">
                    <th
                      scope="row"
                      className="w-[150px] min-w-[150px] p-3 font-body text-sm font-medium text-[#5a7a5a] dark:text-[#8aaa8a] align-middle"
                    >
                      {row.label}
                    </th>
                    {activeProjects.map((project) => {
                      const pct = progressPercent(project.raisedXLM, project.goalXLM);
                      const co2PerXLM =
                        Number.parseFloat(project.goalXLM) > 0
                          ? project.co2OffsetKg / Number.parseFloat(project.goalXLM)
                          : 0;
                      let value = "";
                      if (row.key === "co2") value = `${co2PerXLM.toFixed(2)} kg`;
                      if (row.key === "progress") value = `${pct}%`;
                      if (row.key === "donorCount") value = project.donorCount.toLocaleString();
                      if (row.key === "averageRating") {
                        value =
                          (project.averageRating || 0) > 0
                            ? `${project.averageRating?.toFixed(1)} ★ (${project.ratingCount || 0})`
                            : "No ratings";
                      }
                      if (row.key === "verified") value = project.verified ? "✓ Yes" : "No";

                      return (
                        <td
                          key={`${project.id}-${row.key}`}
                          className="min-w-[180px] p-3 align-middle"
                        >
                          <p className="font-body text-sm text-forest-900">{value}</p>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t border-forest-100">
                  <th
                    scope="row"
                    className="w-[150px] min-w-[150px] p-3 font-body text-sm font-medium text-[#5a7a5a] dark:text-[#8aaa8a] align-middle"
                  >
                    Action
                  </th>
                  {activeProjects.map((project) => (
                    <td
                      key={`${project.id}-actions`}
                      className="min-w-[180px] p-3 pt-4 align-middle"
                    >
                      <Link
                        href={`/projects/${project.id}`}
                        aria-label={`Donate to ${project.name}`}
                        className="btn-primary text-sm py-2 px-4 inline-flex items-center justify-center w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2"
                      >
                        Donate
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
