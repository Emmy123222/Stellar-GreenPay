/**
 * pages/widget/[projectId].tsx — Embeddable widget for external sites
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import CircularProgress from "@/components/CircularProgress";
import { fetchProject } from "@/lib/api";
import { formatXLM, formatCO2, progressPercent } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";

export default function WidgetPage() {
  const router = useRouter();
  const { projectId } = router.query;
  const [project, setProject] = useState<ClimateProject | null>(null);
  const [loading, setLoading] = useState(true);
  const theme = (router.query.theme as "light" | "dark") || "light";

  useEffect(() => {
    if (!projectId) return;
    fetchProject(projectId as string)
      .then(setProject)
      .catch(() => setProject(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${theme === "dark" ? "bg-gray-900" : "bg-white"}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-forest-600" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${theme === "dark" ? "bg-gray-900" : "bg-white"}`}>
        <p className={theme === "dark" ? "text-gray-300" : "text-gray-600"}>
          Project not found
        </p>
      </div>
    );
  }

  const pct = progressPercent(project.raisedXLM, project.goalXLM);
  const bgClass = theme === "dark" ? "bg-gray-800 text-white" : "bg-white";
  const textClass = theme === "dark" ? "text-gray-100" : "text-gray-900";
  const secondaryClass = theme === "dark" ? "text-gray-400" : "text-gray-600";
  const borderClass = theme === "dark" ? "border-gray-700" : "border-gray-200";
  const buttonClass = theme === "dark"
    ? "bg-forest-600 hover:bg-forest-700 text-white"
    : "bg-forest-500 hover:bg-forest-600 text-white";

  return (
    <div className={`min-h-screen ${bgClass} p-4 flex items-center justify-center`}>
      <div className={`w-full max-w-sm rounded-xl border ${borderClass} overflow-hidden shadow-lg`}>
        {/* Header */}
        <div className="bg-gradient-to-r from-forest-500 to-emerald-500 p-4 text-white">
          <h3 className="font-display text-lg font-bold truncate">{project.name}</h3>
          <p className={`text-sm opacity-90 truncate`}>{project.category}</p>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Progress bar */}
          <div>
            <div className="flex justify-between items-baseline mb-2">
              <p className={`text-sm font-semibold ${textClass}`}>
                {formatXLM(project.raisedXLM)} raised
              </p>
              <p className={`text-xs ${secondaryClass}`}>
                {pct}% of {formatXLM(project.goalXLM)}
              </p>
            </div>
            <div className={`h-2 rounded-full bg-gray-200 overflow-hidden`}>
              <div
                className="h-full bg-gradient-to-r from-forest-500 to-emerald-500 transition-all"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className={`p-2 rounded bg-opacity-10 bg-forest-600`}>
              <p className={`text-xs ${secondaryClass} font-semibold`}>Donors</p>
              <p className={`text-lg font-bold ${textClass}`}>{project.donorCount}</p>
            </div>
            <div className={`p-2 rounded bg-opacity-10 bg-emerald-600`}>
              <p className={`text-xs ${secondaryClass} font-semibold`}>CO₂ Offset</p>
              <p className={`text-lg font-bold ${textClass}`}>{formatCO2(project.co2OffsetKg)}</p>
            </div>
          </div>

          {/* Donate button */}
          <Link
            href={`/projects/${project.id}?utm_source=widget`}
            target="_blank"
            rel="noopener noreferrer"
            className={`block w-full py-3 rounded-lg font-semibold text-center transition-colors ${buttonClass}`}
          >
            Donate on GreenPay
          </Link>
        </div>

        {/* Footer */}
        <div className={`px-4 py-2 border-t ${borderClass} flex items-center justify-center`}>
          <a
            href="https://greenpay.app"
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs ${secondaryClass} hover:text-forest-600 transition-colors`}
          >
            Powered by GreenPay
          </a>
        </div>
      </div>
    </div>
  );
}
