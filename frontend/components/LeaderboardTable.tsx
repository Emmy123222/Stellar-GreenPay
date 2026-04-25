/**
 * components/LeaderboardTable.tsx
 */
import { useState, useEffect } from "react";
import { fetchLeaderboard } from "@/lib/api";
import { formatXLM, formatUSDEquivalent, shortenAddress, badgeEmoji } from "@/utils/format";
import { accountUrl } from "@/lib/stellar";
import { useXlmPrice } from "@/lib/priceContext";
import type { LeaderboardEntry } from "@/utils/types";

const AVATAR_COLORS = [
  "#227239",
  "#4caf70",
  "#2e7d32",
  "#1b5e20",
  "#1565c0",
  "#6a1b9a",
  "#c62828",
  "#ef6c00",
];

function hashToIndex(input: string, modulo: number) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

function avatarInitials(displayName: string | undefined, publicKey: string) {
  const source = (displayName || publicKey).trim();
  const first = source[0] || "G";
  const second = source[1] || "P";
  return `${first}${second}`.toUpperCase();
}

function Avatar({ publicKey, displayName }: { publicKey: string; displayName?: string }) {
  const bg = AVATAR_COLORS[hashToIndex(publicKey, AVATAR_COLORS.length)];
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-display text-sm"
      style={{ backgroundColor: bg, color: "white" }}
      aria-hidden="true"
      title={displayName || publicKey}
    >
      {avatarInitials(displayName, publicKey)}
    </div>
  );
}

export default function LeaderboardTable({ limit = 20, period = "all" }: { limit?: number; period?: "all" | "month" | "year" }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const xlmUsd = useXlmPrice();

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchLeaderboard(limit, period)
      .then(setEntries)
      .catch(() => setError("Could not load leaderboard."))
      .finally(() => setLoading(false));
  }, [limit, period]);

  if (loading) return (
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

  if (entries.length === 0) return (
    <div className="text-center py-12">
      <p className="text-3xl mb-3">🌱</p>
      <p className="text-[#5a7a5a] font-body">No donors yet — be the first!</p>
    </div>
  );

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div key={entry.publicKey}
          className="flex items-center gap-4 p-4 rounded-xl bg-white border border-[rgba(34,114,57,0.10)] hover:border-[rgba(34,114,57,0.25)] transition-all">

          {/* Rank */}
          <div className="w-8 text-center flex-shrink-0">
            {entry.rank <= 3
              ? <span className="text-lg">{medals[entry.rank - 1]}</span>
              : <span className="text-sm font-semibold text-[#8aaa8a] font-body">#{entry.rank}</span>
            }
          </div>

          {/* Badge */}
          {entry.topBadge && (
            <span className="text-xl flex-shrink-0" title={entry.topBadge}>
              {badgeEmoji(entry.topBadge)}
            </span>
          )}

          {/* Name / address */}
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <Avatar publicKey={entry.publicKey} displayName={entry.displayName} />
            <div className="min-w-0">
              <a
                href={accountUrl(entry.publicKey)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-forest-900 hover:text-forest-600 transition-colors text-sm font-body block truncate"
              >
                {entry.displayName || shortenAddress(entry.publicKey)}
              </a>
              <p className="text-xs text-[#8aaa8a] font-body mt-0.5">
                {entry.projectsSupported} project{entry.projectsSupported !== 1 ? "s" : ""} supported
              </p>
            </div>
          </div>

          {/* Total donated */}
          <div className="text-right flex-shrink-0">
            <p className="font-mono font-semibold text-forest-600 text-sm">
              {formatXLM(entry.totalDonatedXLM)}
            </p>
            {formatUSDEquivalent(entry.totalDonatedXLM, xlmUsd) && (
              <p className="text-[11px] text-[#8aaa8a] font-body">
                {formatUSDEquivalent(entry.totalDonatedXLM, xlmUsd)}
              </p>
            )}
            <p className="text-xs text-[#8aaa8a] font-body">donated</p>
          </div>
        </div>
      ))}
    </div>
  );
}
