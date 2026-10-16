/**
 * components/TeamsLeaderboard.tsx
 *
 * Team leaderboard — teams ranked by the combined total donated across all
 * member wallets. Paginated with a "Load more" button via offset cursors.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchTeamLeaderboard } from "@/lib/api";
import { formatXLM, formatUSDEquivalent, formatCO2 } from "@/utils/format";
import { useXlmPrice } from "@/lib/priceContext";
import type { TeamLeaderboardEntry } from "@/utils/types";

const PAGE_SIZE = 20;

export default function TeamsLeaderboard({ period = "all" }: { period?: "all" | "week" | "month" | "year" }) {
  const [entries, setEntries] = useState<TeamLeaderboardEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const xlmUsd = useXlmPrice();

  // `loading` is derived by comparing the in-flight request to the last one
  // that resolved, rather than toggled synchronously inside the effect
  // (which triggers a cascading render).
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const requestKey = period;
  const loading = loadedRequestKey !== requestKey;

  useEffect(() => {
    fetchTeamLeaderboard({ limit: PAGE_SIZE, offset: 0, period })
      .then((res) => {
        setEntries(res.data);
        setHasMore(res.has_more);
        setError(null);
      })
      .catch(() => {
        setEntries([]);
        setError("Could not load the team leaderboard.");
      })
      .finally(() => {
        setLoadedRequestKey(requestKey);
      });
  }, [period, requestKey]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetchTeamLeaderboard({
        limit: PAGE_SIZE,
        offset: entries.length,
        period,
      });
      setEntries((prev) => [...prev, ...res.data]);
      setHasMore(res.has_more);
    } catch {
      // keep the already-loaded entries on failure
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading && entries.length === 0) return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse flex items-center gap-4 p-4 rounded-xl bg-forest-50 border border-forest-100">
          <div className="w-8 h-8 rounded-full bg-forest-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-forest-200 rounded w-1/3" />
            <div className="h-2 bg-forest-100 rounded w-1/4" />
          </div>
          <div className="h-4 bg-forest-200 rounded w-20" />
        </div>
      ))}
    </div>
  );

  if (error) return <p className="text-red-500 text-sm text-center py-6 font-body">{error}</p>;

  if (!loading && entries.length === 0) return (
    <div className="text-center py-12">
      <p className="text-[#5a7a5a] dark:text-[#8aaa8a] font-body mb-4">
        🌱 No team donations yet — be the first team on the leaderboard!
      </p>
      <Link href="/dashboard" className="btn-primary">
        Create a Team
      </Link>
    </div>
  );

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center gap-4 p-4 rounded-xl bg-white border border-[rgba(34,114,57,0.10)] hover:border-[rgba(34,114,57,0.25)] transition-all"
        >
          {/* Rank */}
          <div className="w-8 text-center flex-shrink-0">
            {entry.rank <= 3
              ? <span className="text-lg">{medals[entry.rank - 1]}</span>
              : <span className="text-sm font-semibold text-[#8aaa8a] dark:text-forest-300 font-body">#{entry.rank}</span>}
          </div>

          {/* Team logo / initial */}
          <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-display text-sm bg-forest-600 text-white overflow-hidden">
            {entry.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.logoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              entry.name.slice(0, 2).toUpperCase()
            )}
          </div>

          {/* Team name + member count */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-forest-900 text-sm font-body block truncate">
              {entry.name}
            </p>
            <p className="text-xs text-[#8aaa8a] dark:text-forest-300 font-body mt-0.5">
              👥 {entry.memberCount} member{entry.memberCount === 1 ? "" : "s"}
            </p>
          </div>

          {/* Combined totals */}
          <div className="text-right flex-shrink-0 flex gap-4 sm:gap-6">
            <div>
              <p className="font-mono font-semibold text-forest-600 text-sm">
                {formatXLM(entry.totalDonatedXLM)}
              </p>
              {formatUSDEquivalent(entry.totalDonatedXLM, xlmUsd) && (
                <p className="text-[11px] text-[#8aaa8a] dark:text-forest-300 font-body">
                  {formatUSDEquivalent(entry.totalDonatedXLM, xlmUsd)}
                </p>
              )}
              <p className="text-xs text-[#8aaa8a] dark:text-forest-300 font-body">donated</p>
            </div>
            <div>
              <p className="font-mono font-semibold text-forest-600 text-sm">
                {formatCO2(Number(entry.totalCO2OffsetKg || 0))}
              </p>
              <p className="text-xs text-[#8aaa8a] dark:text-forest-300 font-body mt-auto">offset</p>
            </div>
          </div>
        </div>
      ))}

      {hasMore && (
        <div className="text-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="btn-secondary text-sm py-2 px-5 disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more teams"}
          </button>
        </div>
      )}
    </div>
  );
}
