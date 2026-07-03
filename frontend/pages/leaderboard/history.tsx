/**
 * pages/leaderboard/history.tsx — Monthly Donor of the Month leaderboard history
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface MonthEntry {
  rank: number;
  donorAddress: string;
  displayName: string | null;
  totalXLMThatMonth: string;
  badge: string | null;
}

interface MonthSnapshot {
  month: string; // "YYYY-MM"
  entries: MonthEntry[];
}

const BADGE_ICONS: Record<string, string> = {
  seedling: "🌱",
  tree:     "🌳",
  forest:   "🌲",
  earth:    "🌍",
};

const RANK_MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function monthLabel(ym: string) {
  const [year, month] = ym.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString("default", { month: "long", year: "numeric" });
}

export default function LeaderboardHistoryPage() {
  const [history, setHistory] = useState<MonthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/leaderboard/history?months=12`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setHistory(json.data);
        else setError("Failed to load history");
      })
      .catch(() => setError("Failed to load history"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <div className="text-center mb-10">
        <div className="text-5xl mb-4">🏅</div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-forest-900 mb-3">
          Donor of the Month — History
        </h1>
        <p className="text-[#5a7a5a] max-w-xl mx-auto font-body leading-relaxed">
          Each month&apos;s top climate donors, permanently recorded on the Stellar blockchain.
        </p>
        <Link href="/leaderboard" className="text-forest-600 text-sm underline mt-2 inline-block">
          ← Back to all-time leaderboard
        </Link>
      </div>

      {loading && (
        <div className="text-center text-[#5a7a5a] py-16">Loading…</div>
      )}

      {error && (
        <div className="text-center text-red-600 py-16">{error}</div>
      )}

      {!loading && !error && history.length === 0 && (
        <div className="text-center text-[#5a7a5a] py-16">
          No monthly snapshots yet. Check back after the first snapshot is taken.
        </div>
      )}

      {history.map((snapshot) => (
        <div key={snapshot.month} className="mb-10">
          <h2 className="font-display text-xl font-bold text-forest-900 mb-4 border-b border-forest-200 pb-2">
            {monthLabel(snapshot.month)}
          </h2>

          {snapshot.entries.length === 0 ? (
            <p className="text-[#5a7a5a] text-sm">No donations recorded this month.</p>
          ) : (
            <div className="space-y-3">
              {snapshot.entries.slice(0, 10).map((entry) => (
                <div
                  key={entry.donorAddress}
                  className={`flex items-center bg-white border rounded-xl px-4 py-3 shadow-sm ${
                    entry.rank === 1 ? "border-yellow-400 bg-yellow-50" : "border-forest-100"
                  }`}
                >
                  <span className="text-2xl w-10 text-center">
                    {RANK_MEDALS[entry.rank] ?? `#${entry.rank}`}
                  </span>

                  <div className="flex-1 ml-3">
                    <p className="font-semibold text-forest-900 text-sm">
                      {entry.displayName ??
                        `${entry.donorAddress.slice(0, 6)}…${entry.donorAddress.slice(-4)}`}
                    </p>
                    <Link
                      href={`/donors/${entry.donorAddress}`}
                      className="text-xs text-forest-600 hover:underline"
                    >
                      View profile
                    </Link>
                  </div>

                  <div className="flex items-center gap-2">
                    {entry.badge && (
                      <span className="text-lg" title={entry.badge}>
                        {BADGE_ICONS[entry.badge] ?? "🏅"}
                      </span>
                    )}
                    <span className="font-bold text-forest-900 text-sm">
                      {parseFloat(entry.totalXLMThatMonth).toFixed(2)} XLM
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
