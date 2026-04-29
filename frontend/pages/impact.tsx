/**
 * pages/impact.tsx
 * Global Impact Dashboard — Querying aggregated data from backend API.
 */
import { useEffect, useState } from "react";
import Head from "next/head";
import AnimatedNumber from "@/components/AnimatedNumber";
import DonationTicker from "@/components/DonationTicker";
import WorldMap from "@/components/WorldMap";
import { fetchImpactGlobal, fetchLeaderboard, fetchProjects } from "@/lib/api";
import { getGlobalImpactStats } from "@/lib/stellar";
import { formatCO2, formatXLM, shortenAddress } from "@/utils/format";
import type { LeaderboardEntry } from "@/utils/types";
import type { ImpactGlobalStats } from "@/lib/api";

export default function ImpactPage() {
  const [stats, setStats] = useState<ImpactGlobalStats | null>(null);
  const [sorobanStats, setSorobanStats] = useState<{ totalRaisedXLM: string; totalCO2OffsetGrams: string; donationCount: number } | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [impactStats, topDonors, sorobanData, allProjects] = await Promise.all([
          fetchImpactGlobal(),
          fetchLeaderboard(3),
          getGlobalImpactStats(),
          fetchProjects(),
        ]);
        setStats(impactStats);
        setLeaderboard(topDonors);
        setSorobanStats(sorobanData);
        setProjectCount(allProjects.length);
      } catch (err) {
        console.error("Failed to load impact data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div className="min-h-screen bg-[#fcfdfc] font-body text-forest-900 selection:bg-forest-100 pb-20">
      <Head>
        <title>Global Impact | Stellar GreenPay</title>
        <meta name="description" content="Witness the real-time community impact of Stellar GreenPay donors." />
      </Head>



      <main className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Header Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-display font-bold text-forest-900 tracking-tight leading-tight">
            Our <span className="text-forest-500">Global Impact</span>
          </h1>
          <p className="mt-4 text-lg text-forest-600 max-w-2xl mx-auto">
            Transparency on-chain. Witness what the community has achieved together for our planet.
          </p>
        </div>

        {/* Global Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-16">
          <StatCard
            label="XLM Donated"
            icon="✨"
            value={sorobanStats?.totalRaisedXLM ?? "0"}
            unit="XLM"
            isLoading={isLoading}
          />
          <StatCard
            label="CO₂ Offset"
            icon="🌿"
            value={sorobanStats ? Number(sorobanStats.totalCO2OffsetGrams) / 1000 : 0}
            unit="Kg"
            isLoading={isLoading}
            formatter={(val) => formatCO2(Math.floor(val))}
          />
          <StatCard
            label="Unique Donors"
            icon="💝"
            value={stats?.donorCount ?? 0}
            isLoading={isLoading}
          />
          <StatCard
            label="Projects"
            icon="🌍"
            value={projectCount}
            isLoading={isLoading}
          />
          <StatCard
            label="Trees Equivalent"
            icon="🌲"
            value={stats?.treesEquivalent ?? 0}
            isLoading={isLoading}
          />
        </div>

        {/* Interactive World Map Section */}
        <div className="bg-white rounded-3xl border border-forest-100 shadow-sm p-8 mb-16">
          <h2 className="text-2xl font-display font-bold text-forest-900 mb-6 flex items-center gap-2">
            🗺️ Global Reach
          </h2>
          <WorldMap />
        </div>

        {/* Category Breakdown */}
        <div className="bg-white rounded-3xl border border-forest-100 shadow-sm p-8 mb-16">
          <h2 className="text-2xl font-display font-bold text-forest-900 mb-6 flex items-center gap-2">
            📊 Impact by Category
          </h2>
          {stats?.breakdownByCategory?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {stats.breakdownByCategory.map((row) => (
                <div
                  key={row.category}
                  className="flex items-center justify-between rounded-2xl border border-forest-100 bg-forest-50/40 p-5"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-forest-900 truncate">{row.category}</p>
                    <p className="text-xs text-forest-600 mt-1">
                      {row.donorCount} donor{row.donorCount !== 1 ? "s" : ""} • {formatCO2(row.co2OffsetKg)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-mono font-semibold text-forest-700">{formatXLM(row.totalDonationsXLM)}</p>
                    <p className="text-[11px] text-forest-500">donated</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-forest-500 text-sm">No category breakdown available yet.</p>
          )}
        </div>

        {/* Leaderboard Section */}
        <div className="bg-white rounded-3xl border border-forest-100 shadow-xl shadow-forest-100/30 p-8 mb-16 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-forest-50 rounded-bl-full -z-0 opacity-50 group-hover:scale-110 transition-transform duration-500" />
          <h2 className="text-2xl font-display font-bold text-forest-900 mb-8 relative z-10 flex items-center gap-2">
            🏆 Top Impact Leaders
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
            {leaderboard.length > 0 ? (
              leaderboard.map((entry, idx) => (
                <div key={entry.publicKey} className="flex flex-col items-center text-center p-6 bg-forest-50/50 rounded-2xl hover:bg-forest-50 transition-colors border border-transparent hover:border-forest-200">
                  <div className="w-12 h-12 rounded-full bg-forest-900 text-white flex items-center justify-center font-bold mb-4">
                    #{idx + 1}
                  </div>
                  <span className="font-bold text-lg text-forest-800 break-all">
                    {entry.displayName || shortenAddress(entry.publicKey)}
                  </span>
                  <p className="text-forest-500 text-sm mt-1">{entry.totalDonatedXLM} XLM Total</p>
                  <div className="mt-4 px-3 py-1 rounded-full bg-forest-100 text-forest-700 text-xs font-bold uppercase tracking-wider">
                    {entry.topBadge || "Seedling"}
                  </div>
                </div>
              ))
            ) : (
              <p className="col-span-3 text-center text-forest-400 py-10">No leaderboard data available yet.</p>
            )}
          </div>
        </div>

        {/* Community Call-to-Action */}
        <div className="text-center py-10">
            <h3 className="text-2xl font-bold text-forest-900 mb-4">Ready to make an impact?</h3>
            <button className="btn-primary px-8 py-3 text-lg" onClick={() => window.location.href = '/projects'}>
                View Climate Projects
            </button>
        </div>
      </main>

      <DonationTicker />
    </div>
  );
}

function StatCard({
  label,
  icon,
  value,
  unit,
  isLoading,
  formatter,
}: {
  label: string;
  icon: string;
  value: string | number;
  unit?: string;
  isLoading: boolean;
  formatter?: (val: number) => string;
}) {
  return (
    <div className="bg-white p-8 rounded-3xl border border-forest-100 shadow-sm hover:shadow-md transition-shadow relative group">
      <div className="w-12 h-12 rounded-2xl bg-forest-50 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <p className="text-forest-500 font-medium text-sm uppercase tracking-wider mb-2">{label}</p>
      <div className="text-4xl font-display font-bold text-forest-900 flex items-baseline gap-1.5">
        {!isLoading ? (
          <AnimatedNumber value={value} formatter={formatter} />
        ) : (
          <span className="w-24 h-8 bg-forest-50 animate-pulse rounded" />
        )}
        {unit && <span className="text-xl text-forest-400 font-normal">{unit}</span>}
      </div>
    </div>
  );
}
