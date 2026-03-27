/**
 * pages/impact.tsx
 * Global Impact Dashboard — Querying live data from Soroban and backend API.
 */
import { useEffect, useState } from "react";
import Head from "next/head";
import AnimatedNumber from "@/components/AnimatedNumber";
import DonationTicker from "@/components/DonationTicker";
import { getGlobalImpactStats } from "@/lib/stellar";
import { fetchProjects, fetchLeaderboard } from "@/lib/api";
import { shortenAddress } from "@/utils/format";
import type { ClimateProject, LeaderboardEntry } from "@/utils/types";

export default function ImpactPage() {
  const [stats, setStats] = useState({ totalRaisedXLM: "0", totalCO2OffsetGrams: "0", donationCount: 0 });
  const [projectCount, setProjectCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [impactStats, projects, topDonors] = await Promise.all([
          getGlobalImpactStats(),
          fetchProjects({ limit: 100 }),
          fetchLeaderboard(3),
        ]);
        setStats(impactStats);
        setProjectCount(projects.length);
        setLeaderboard(topDonors);
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          <StatCard
            label="XLM Raised"
            icon="✨"
            value={stats.totalRaisedXLM}
            unit="XLM"
            isLoading={isLoading}
          />
          <StatCard
            label="CO₂ Offset"
            icon="🌿"
            value={(Number(stats.totalCO2OffsetGrams) / 1000).toLocaleString()}
            unit="Kg"
            isLoading={isLoading}
          />
          <StatCard
            label="Total Donations"
            icon="💝"
            value={stats.donationCount}
            isLoading={isLoading}
          />
          <StatCard
            label="Verified Projects"
            icon="🏗️"
            value={projectCount}
            isLoading={isLoading}
          />
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

function StatCard({ label, icon, value, unit, isLoading }: { label: string; icon: string; value: string | number; unit?: string; isLoading: boolean }) {
  return (
    <div className="bg-white p-8 rounded-3xl border border-forest-100 shadow-sm hover:shadow-md transition-shadow relative group">
      <div className="w-12 h-12 rounded-2xl bg-forest-50 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <p className="text-forest-500 font-medium text-sm uppercase tracking-wider mb-2">{label}</p>
      <div className="text-4xl font-display font-bold text-forest-900 flex items-baseline gap-1.5">
        {!isLoading ? (
          <AnimatedNumber value={value} />
        ) : (
          <span className="w-24 h-8 bg-forest-50 animate-pulse rounded" />
        )}
        {unit && <span className="text-xl text-forest-400 font-normal">{unit}</span>}
      </div>
    </div>
  );
}
