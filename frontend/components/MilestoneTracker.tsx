/**
 * components/MilestoneTracker.tsx
 * Vertical timeline showing project milestones with completion status.
 */
import { useState } from "react";
import clsx from "clsx";

export interface Milestone {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  completedAt: string | null;
  order: number;
}

interface MilestoneTrackerProps {
  milestones: Milestone[];
  isAdmin?: boolean;
  onComplete?: (milestoneId: string) => void;
}

export default function MilestoneTracker({
  milestones,
  isAdmin = false,
  onComplete,
}: MilestoneTrackerProps) {
  const [completing, setCompleting] = useState<string | null>(null);

  const sorted = [...milestones].sort((a, b) => a.order - b.order);
  const completedCount = sorted.filter((m) => m.completedAt).length;
  const progress = sorted.length > 0 ? Math.round((completedCount / sorted.length) * 100) : 0;

  const handleComplete = async (milestoneId: string) => {
    if (!onComplete) return;
    setCompleting(milestoneId);
    try {
      await onComplete(milestoneId);
    } finally {
      setCompleting(null);
    }
  };

  if (sorted.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-4xl mb-3">🎯</p>
        <p className="font-display text-lg text-forest-900 mb-1">No milestones yet</p>
        <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
          Milestones will appear here as the project sets goals.
        </p>
      </div>
    );
  }

  return (
    <div className="card animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-lg font-semibold text-forest-900">
            Project Milestones
          </h3>
          <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
            {completedCount} of {sorted.length} completed
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-forest-700">{progress}%</div>
          <div className="w-24 h-2 bg-forest-100 rounded-full mt-1">
            <div
              className="h-full bg-forest-500 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-forest-200" />

        <div className="space-y-6">
          {sorted.map((milestone, index) => {
            const isCompleted = !!milestone.completedAt;
            const isLast = index === sorted.length - 1;

            return (
              <div key={milestone.id} className="relative flex gap-4">
                {/* Circle indicator */}
                <div
                  className={clsx(
                    "relative z-10 flex items-center justify-center w-10 h-10 rounded-full border-2 flex-shrink-0",
                    isCompleted
                      ? "bg-forest-500 border-forest-500 text-white"
                      : "bg-white border-forest-300 text-forest-400"
                  )}
                >
                  {isCompleted ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className="text-sm font-bold">{index + 1}</span>
                  )}
                </div>

                {/* Content */}
                <div
                  className={clsx(
                    "flex-1 pb-6",
                    !isLast && "border-b border-forest-100"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4
                        className={clsx(
                          "font-display font-semibold",
                          isCompleted ? "text-forest-500 line-through" : "text-forest-900"
                        )}
                      >
                        {milestone.title}
                      </h4>
                      {milestone.description && (
                        <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body mt-1">
                          {milestone.description}
                        </p>
                      )}
                    </div>
                    {isAdmin && !isCompleted && (
                      <button
                        onClick={() => handleComplete(milestone.id)}
                        disabled={completing === milestone.id}
                        className="btn-primary text-xs py-1.5 px-3 flex-shrink-0"
                      >
                        {completing === milestone.id ? "..." : "Mark Complete"}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-2 text-xs text-[#8aaa8a] dark:text-forest-300 font-body">
                    <span>
                      📅 Target: {new Date(milestone.targetDate).toLocaleDateString()}
                    </span>
                    {isCompleted && milestone.completedAt && (
                      <span className="text-forest-500">
                        ✅ Completed: {new Date(milestone.completedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
