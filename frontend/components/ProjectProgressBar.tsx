import React from "react";
import { formatXLM } from "@/utils/format";

interface ProjectProgressBarProps {
  raisedXLM: string | number;
  goalXLM: string | number;
  className?: string;
}

export default function ProjectProgressBar({
  raisedXLM,
  goalXLM,
  className = "",
}: ProjectProgressBarProps) {
  const parsedRaised = Number(raisedXLM);
  const parsedGoal = Number(goalXLM);
  const hasGoal = Number.isFinite(parsedGoal) && parsedGoal > 0;
  const percentage = hasGoal
    ? Math.min(100, Math.max(0, Math.round((parsedRaised / parsedGoal) * 100)))
    : 0;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-forest-700 dark:text-forest-100">
          {hasGoal ? `${percentage}%` : "No goal set"}
        </span>
        {hasGoal ? (
          <span className="text-xs text-[var(--text-secondary)] dark:text-[#a8c2a8]">
            {formatXLM(parsedRaised)} / {formatXLM(parsedGoal)}
          </span>
        ) : (
          <span className="text-xs text-[var(--text-tertiary)] dark:text-[#a8c2a8]">
            Raised: {formatXLM(parsedRaised)}
          </span>
        )}
      </div>

      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="progressbar"
        aria-label="Fundraising goal progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={hasGoal ? percentage : 0}
        aria-valuetext={hasGoal ? `${percentage}% complete` : "No goal set"}
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-300 dark:bg-emerald-400"
          style={{ width: `${hasGoal ? percentage : 0}%` }}
        />
      </div>
    </div>
  );
}
