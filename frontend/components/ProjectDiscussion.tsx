import React from "react";
import { formatXLM, timeAgo } from "@/utils/format";
import { accountUrl, type ProjectDiscussionMessage } from "@/lib/stellar";

export interface ProjectDiscussionProps {
  discussion: ProjectDiscussionMessage[];
  loading: boolean;
  onReply: (replyMemo: string) => void;
}

export default function ProjectDiscussion({
  discussion,
  loading,
  onReply,
}: ProjectDiscussionProps) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="font-display text-lg font-semibold text-forest-900">
          Donor Discussion
        </h2>
        <span className="text-xs text-[var(--text-secondary)] dark:text-forest-300 font-body">
          On-chain memos
        </span>
      </div>
      <p className="text-xs text-[var(--text-secondary)] dark:text-[#8aaa8a] font-body mb-4">
        Discuss by donating — messages are Stellar transaction memos from real donations.
      </p>

      {loading ? (
        <p className="text-sm text-[var(--text-secondary)] dark:text-[#8aaa8a] font-body">
          Loading discussion…
        </p>
      ) : discussion.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] dark:text-[#8aaa8a] font-body">
          No memo messages yet. Be the first to leave a message with your donation.
        </p>
      ) : (
        <div className="space-y-3">
          {discussion.slice(-50).map((m) => {
            const suggested = `Reply to ${m.from.slice(0, 6)}…: `;
            const replyMemo =
              suggested.length <= 100 ? suggested : suggested.slice(0, 100);
            return (
              <div
                key={m.id}
                className="p-3 rounded-xl border border-forest-100 bg-white"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="text-xs text-[var(--text-secondary)] dark:text-forest-300 font-body">
                    <a
                      href={accountUrl(m.from)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-forest-700 hover:underline"
                    >
                      {m.from.slice(0, 6)}…{m.from.slice(-6)}
                    </a>
                    <span className="mx-2">•</span>
                    <span className="font-semibold text-forest-900">
                      {formatXLM(m.amount, 2)}
                    </span>
                    <span className="mx-2">•</span>
                    <span>{timeAgo(m.createdAt)}</span>
                  </div>
                  <button
                    onClick={() => onReply(replyMemo)}
                    className="text-xs font-semibold text-forest-700 hover:underline self-start sm:self-auto"
                    title="Reply by donating with a pre-filled memo"
                  >
                    Reply via donation
                  </button>
                </div>
                <p className="mt-2 text-sm text-forest-900 font-body leading-relaxed">
                  {m.memo}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
