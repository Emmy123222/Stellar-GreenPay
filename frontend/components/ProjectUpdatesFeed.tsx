import React from "react";
import { useI18n } from "@/lib/i18n";
import { timeAgo } from "@/utils/format";
import type { ProjectUpdate } from "@/utils/types";

import { renderMarkdown } from "@/lib/renderMarkdown";
export { renderMarkdown };

export interface ProjectUpdatesFeedProps {
  updates: ProjectUpdate[];
  updateLikes: Record<string, { liked: boolean; likeCount: number }>;
  publicKey: string | null;
  onToggleLike: (updateId: string) => void;
}

export default function ProjectUpdatesFeed({
  updates,
  updateLikes,
  publicKey,
  onToggleLike,
}: ProjectUpdatesFeedProps) {
  const { t } = useI18n();

  return (
    <div className="card">
      <h2 className="font-display text-lg font-semibold text-forest-900 mb-4">
        {t("project.projectUpdates")}
      </h2>
      {updates.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] dark:text-[#8aaa8a] font-body">
          {t("project.noUpdatesYet")}
        </p>
      ) : (
        <div className="space-y-4">
          {updates.map((u) => {
            const like = updateLikes[u.id];
            return (
              <div
                key={u.id}
                className="pb-4 border-b border-forest-100 last:border-0 last:pb-0"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-forest-900 text-sm font-body">
                    {u.title}
                  </h3>
                  <span className="text-xs text-[var(--text-secondary)] dark:text-forest-300 font-body">
                    {timeAgo(u.createdAt)}
                  </span>
                </div>
                <div
                  className="text-[var(--text-secondary)] dark:text-[#8aaa8a] text-sm leading-relaxed font-body prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(u.body) }}
                />
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => onToggleLike(u.id)}
                    disabled={!publicKey}
                    className={`flex items-center gap-1.5 text-xs font-body transition-colors ${
                      like?.liked
                        ? "text-red-500 font-semibold"
                        : "text-[var(--text-secondary)] dark:text-forest-300 hover:text-red-400"
                    } disabled:opacity-50`}
                  >
                    <span>{like?.liked ? "❤️" : "🤍"}</span>
                    <span>{like?.likeCount ?? 0}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
