import React, { useState, useEffect } from "react";
import { formatXLM } from "@/utils/format";
import type { ProjectCampaign } from "@/utils/types";

function formatCountdown(deadline: string, nowMs: number) {
  const deltaMs = new Date(deadline).getTime() - nowMs;
  if (deltaMs <= 0) return "0h 0m 0s";

  const totalSeconds = Math.floor(deltaMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export interface ProjectActiveCampaignProps {
  campaign: ProjectCampaign | null;
}

export default function ProjectActiveCampaign({
  campaign,
}: ProjectActiveCampaignProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!campaign) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [campaign]);

  if (!campaign) return null;

  const countdownText = formatCountdown(campaign.deadline, now);

  return (
    <div className="card mb-6 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest font-bold text-amber-700 font-body mb-1">
            Active Campaign
          </p>
          <h2 className="font-display text-xl font-semibold text-amber-900">
            {campaign.title}
          </h2>
          {campaign.description && (
            <p className="text-sm text-amber-800 font-body mt-1">
              {campaign.description}
            </p>
          )}
        </div>
        <p className="text-xs px-3 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-800 font-body">
          Ends in {countdownText}
        </p>
      </div>
      <div className="mt-4">
        <div className="flex justify-between text-xs mb-1 font-body text-amber-800">
          <span>{formatXLM(campaign.raisedXLM)} raised</span>
          <span>
            {campaign.progressPercent}% of {formatXLM(campaign.goalXLM)}
          </span>
        </div>
        <div className="progress-bar h-2.5">
          <div
            className="progress-fill"
            style={{
              width: `${Math.min(campaign.progressPercent, 100)}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
