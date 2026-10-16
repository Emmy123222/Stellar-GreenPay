import React from "react";
import { timeAgo } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";

export interface ProjectAiSummaryProps {
  project: ClimateProject;
  publicKey: string | null;
  aiSummaryState: "idle" | "loading" | "error";
  aiSummaryError: string | null;
  onGenerateSummary: () => void;
}

export default function ProjectAiSummary({
  project,
  publicKey,
  aiSummaryState,
  aiSummaryError,
  onGenerateSummary,
}: ProjectAiSummaryProps) {
  const isOwner = Boolean(publicKey && publicKey === project.walletAddress);

  if (!project.aiSummary && !isOwner) {
    return null;
  }

  return (
    <div className="card border-l-4 border-forest-500 bg-forest-50/40">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden="true">
            ✨
          </span>
          <h2 className="font-display text-base font-semibold text-forest-900">
            Impact at a glance
          </h2>
          <span className="text-[10px] uppercase tracking-wider font-bold bg-forest-200 text-forest-800 px-2 py-0.5 rounded-full">
            AI Generated
          </span>
        </div>
        {isOwner && (
          <button
            onClick={onGenerateSummary}
            disabled={aiSummaryState === "loading"}
            className="text-xs font-semibold text-forest-700 hover:text-forest-900 disabled:opacity-50 disabled:cursor-not-allowed font-body"
          >
            {aiSummaryState === "loading"
              ? "Generating…"
              : project.aiSummary
              ? "Refresh summary"
              : "Generate summary"}
          </button>
        )}
      </div>

      {project.aiSummary ? (
        <p className="text-sm text-forest-900/90 leading-relaxed font-body">
          {project.aiSummary}
        </p>
      ) : (
        <p className="text-sm text-[var(--text-secondary)] dark:text-[#8aaa8a] italic font-body">
          No AI summary yet. Click &ldquo;Generate summary&rdquo; to create one for donors.
        </p>
      )}

      {aiSummaryError && (
        <p className="mt-2 text-xs text-red-600 font-body">{aiSummaryError}</p>
      )}

      <p className="mt-3 text-[11px] text-[#7a9a7a] font-body leading-snug">
        AI-generated from this project&rsquo;s description. May contain
        inaccuracies — read the full description below before donating.
        {project.aiSummaryGeneratedAt && (
          <> Generated {timeAgo(project.aiSummaryGeneratedAt)}.</>
        )}
      </p>
    </div>
  );
}
