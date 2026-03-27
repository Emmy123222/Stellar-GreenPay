/**
 * components/ProjectCard.tsx
 */
import Link from "next/link";
import type { ClimateProject } from "@/utils/types";
import { formatXLM, formatCO2, progressPercent, statusClass, statusLabel, CATEGORY_ICONS } from "@/utils/format";

export default function ProjectCard({ project }: { project: ClimateProject }) {
  const pct = progressPercent(project.raisedXLM, project.goalXLM);
  const isComplete = pct >= 100;

  return (
    <Link href={`/projects/${project.id}`}>
      <div className="card-hover group animate-fade-in flex flex-col h-full">

        {/* Category icon + badges */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-forest-100 flex items-center justify-center text-xl border border-forest-200">
              {CATEGORY_ICONS[project.category] || "🌿"}
            </div>
            <div>
              <p className="text-xs text-[#5a7a5a] font-body">{project.category}</p>
              <p className="text-xs text-[#8aaa8a] font-body">{project.location}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {project.onChainVerified ? (
              <span className="badge-verified text-[10px] px-2 py-0.5 rounded-full bg-forest-100 text-forest-700 border border-forest-300 font-body font-bold shadow-sm">
                On-chain verified ✓
              </span>
            ) : project.verified ? (
              <span className="badge-verified text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-body">
                ✓ Verified
              </span>
            ) : null}
            {isComplete ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 font-body font-semibold">✅ Fully Funded</span>
            ) : (
              <span className={statusClass(project.status)}>{statusLabel(project.status)}</span>
            )}
          </div>
        </div>

        {/* Name & description */}
        <h3 className="font-display font-semibold text-forest-900 text-base leading-snug mb-2 group-hover:text-forest-600 transition-colors line-clamp-2">
          {project.name}
        </h3>
        <p className="text-[#5a7a5a] text-sm leading-relaxed line-clamp-3 mb-4 flex-1 font-body">
          {project.description}
        </p>

        {/* Progress bar */}
        <div className="mb-4">
          {isComplete ? (
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-2 rounded-lg text-center text-sm font-semibold shadow-sm">
              ✅ Fully Funded
            </div>
          ) : (
            <>
              <div className="flex justify-between text-xs text-[#8aaa8a] mb-1.5 font-body">
                <span>{formatXLM(project.raisedXLM)} raised</span>
                <span>{pct}% of {formatXLM(project.goalXLM)}</span>
              </div>
              <div className="progress-bar">
                <div className={pct >= 100 ? "progress-fill progress-fill-complete" : "progress-fill"} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between pt-3 border-t border-[rgba(34,114,57,0.07)]">
          <div className="flex items-center gap-3 text-xs text-[#5a7a5a] font-body">
            <span>👥 {project.donorCount} donors</span>
            <span className="flex items-center gap-1">
              ♻️ {formatCO2(project.co2OffsetKg)}
              <span className="tooltip" onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                <button
                  type="button"
                  className="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-forest-100 text-[8px] text-forest-600 border border-forest-200 hover:bg-forest-200 transition-colors focus:outline-none focus:ring-1 focus:ring-forest-400"
                  aria-label="CO2 offset estimate methodology info"
                >
                  ℹ️
                </button>
                <span className="tooltip-text" role="tooltip">
                  Estimated CO₂ offset based on this project's declared impact rate per XLM donated. Actual results may vary.
                </span>
              </span>
            </span>
          </div>
          <span className="text-xs font-semibold text-forest-600 font-body group-hover:text-forest-700">
            Donate →
          </span>
        </div>
      </div>
    </Link>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="card animate-pulse flex flex-col h-full border border-[rgba(34,114,57,0.06)] shadow-none pointer-events-none">
      
      {/* Category icon + badges skeleton */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-forest-100 border border-forest-200" />
          <div className="space-y-1.5">
            <div className="h-2.5 bg-forest-100 rounded-full w-16" />
            <div className="h-2 bg-forest-50 rounded-full w-20" />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
           <div className="h-5 bg-forest-50 rounded-full w-16" />
           <div className="h-5 bg-forest-100 rounded-full w-12" />
        </div>
      </div>

      {/* Name & description skeleton */}
      <div className="space-y-2.5 mb-5 flex-1">
        <div className="h-4 bg-forest-100 rounded-full w-3/4" />
        <div className="h-4 bg-forest-100 rounded-full w-1/2" />
        <div className="pt-2 space-y-2">
          <div className="h-2.5 bg-forest-50 rounded-full w-full" />
          <div className="h-2.5 bg-forest-50 rounded-full w-full" />
          <div className="h-2.5 bg-forest-50 rounded-full w-2/3" />
        </div>
      </div>

      {/* Progress bar skeleton */}
      <div className="mb-5">
        <div className="flex justify-between mb-2">
          <div className="h-2 bg-forest-50 rounded-full w-1/4" />
          <div className="h-2 bg-forest-50 rounded-full w-1/3" />
        </div>
        <div className="h-2.5 bg-forest-100 rounded-full w-full" />
      </div>

      {/* Stats row skeleton */}
      <div className="flex items-center justify-between pt-3 border-t border-[rgba(34,114,57,0.05)]">
        <div className="flex items-center gap-4">
          <div className="h-3 bg-forest-50 rounded-full w-14" />
          <div className="h-3 bg-forest-50 rounded-full w-16" />
        </div>
        <div className="h-3 bg-forest-100 rounded-full w-12" />
      </div>
    </div>
  );
}
