import React from "react";
import { formatDate, formatXLM } from "@/utils/format";
import type { DonationMatch } from "@/utils/types";

export interface ProjectMatchBannerProps {
  matches: DonationMatch[];
}

export default function ProjectMatchBanner({ matches }: ProjectMatchBannerProps) {
  if (!matches || matches.length === 0) return null;

  const activeMatch = matches[0];

  return (
    <div className="card mb-6 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest font-bold text-green-700 font-body mb-1">
            Donation Matching Active
          </p>
          <h2 className="font-display text-xl font-semibold text-green-900">
            Your donation will be matched up to {activeMatch.multiplier}x!
          </h2>
          <p className="text-sm text-green-800 font-body mt-2">
            Remaining capacity: {formatXLM(activeMatch.remainingXLM || 0)}
          </p>
        </div>
        <p className="text-xs px-3 py-1 rounded-full bg-green-100 border border-green-200 text-green-800 font-body">
          {formatDate(activeMatch.expiresAt)}
        </p>
      </div>
    </div>
  );
}
