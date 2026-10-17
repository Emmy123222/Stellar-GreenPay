import React from "react";
import type { ProjectMilestone } from "@/utils/types";

export interface ProjectMilestonesProps {
  milestones: ProjectMilestone[];
  raisedXLM: string;
  goalXLM: string;
}

export default function ProjectMilestones({
  milestones,
  raisedXLM,
  goalXLM,
}: ProjectMilestonesProps) {
  if (!milestones || milestones.length === 0) {
    return null;
  }

  const raised = parseFloat(raisedXLM);
  const goal = parseFloat(goalXLM);

  return (
    <div className="card">
      <h2 className="font-display text-lg font-semibold text-forest-900 mb-4">
        Project Milestones
      </h2>
      <div className="space-y-4">
        {milestones.map((m) => {
          const reached = raised >= (goal * m.percentage) / 100;
          const milestoneGoal = (goal * m.percentage) / 100;
          const progress = milestoneGoal > 0 ? (raised / milestoneGoal) * 100 : 0;

          return (
            <div key={m.id} className="relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      m.reachedAt
                        ? "bg-emerald-500 text-white"
                        : reached
                        ? "bg-amber-400 text-white"
                        : "bg-forest-100 text-forest-700"
                    }`}
                  >
                    {m.percentage}%
                  </div>
                  <span className="text-sm font-semibold text-forest-900 font-body">
                    {m.title}
                  </span>
                </div>
                {m.transactionHash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${m.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-forest-500 hover:text-emerald-600 font-bold uppercase tracking-widest transition-colors"
                  >
                    Proof ↗
                  </a>
                )}
              </div>
              <div className="w-full bg-forest-100 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all motion-reduce:transition-none duration-1000 ${
                    m.reachedAt
                      ? "bg-emerald-500"
                      : reached
                      ? "bg-amber-400"
                      : "bg-forest-300"
                  }`}
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
