/**
 * components/ContributorTimeline.tsx
 * Vertical timeline of merged pull requests, celebrating who shipped what.
 */
import type { ContributorPR } from "@/utils/types";

interface ContributorTimelineProps {
  pullRequests: ContributorPR[];
}

export default function ContributorTimeline({
  pullRequests,
}: ContributorTimelineProps) {
  if (pullRequests.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-4xl mb-3">🌱</p>
        <p className="font-display text-lg text-forest-900 mb-1">
          No merged contributions yet
        </p>
        <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
          Merged pull requests will appear here as contributors ship features.
        </p>
      </div>
    );
  }

  return (
    <div className="card animate-fade-in">
      <div className="relative">
        <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-forest-200" />

        <div className="space-y-6">
          {pullRequests.map((pr, index) => {
            const isLast = index === pullRequests.length - 1;

            return (
              <div key={pr.id} className="relative flex gap-4">
                <a
                  href={pr.author.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative z-10 flex-shrink-0"
                  title={pr.author.login}
                >
                  <img
                    src={pr.author.avatarUrl}
                    alt={`${pr.author.login}'s avatar`}
                    className="w-10 h-10 rounded-full border-2 border-forest-300 bg-white"
                  />
                </a>

                <div
                  className={
                    "flex-1 pb-6" + (!isLast ? " border-b border-forest-100" : "")
                  }
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <a
                        href={pr.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-display font-semibold text-forest-900 hover:text-forest-600 hover:underline"
                      >
                        {pr.title}
                      </a>
                      <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body mt-1">
                        by{" "}
                        <a
                          href={pr.author.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          @{pr.author.login}
                        </a>{" "}
                        · #{pr.number}
                      </p>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-forest-100 text-forest-700 text-xs font-bold uppercase tracking-wider flex-shrink-0">
                      {pr.feature}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-2 text-xs text-[#8aaa8a] dark:text-forest-300 font-body">
                    <span>
                      🎉 Merged {new Date(pr.mergedAt).toLocaleDateString()}
                    </span>
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
