/**
 * pages/index.tsx — GreenPay landing page
 */
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import WalletConnect from "@/components/WalletConnect";
import { useCountUp } from "@/hooks/useCountUp";
import {
  fetchGlobalStats,
  fetchFeaturedProject,
  fetchProjects,
  fetchCategoryStats,
} from "@/lib/api";
import { streamGlobalProjectDonations } from "@/lib/stellar";
import { formatCO2, formatXLM, progressPercent } from "@/utils/format";
import type { GlobalStats, CategoryStats } from "@/lib/api";
import type { ClimateProject } from "@/utils/types";

interface HomeProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

interface LiveDonationTickerItem {
  id: string;
  projectId: string;
  projectName: string;
  amountXLM: string;
  createdAt: string;
}

const FEATURES = [
  {
    icon: "🔗",
    title: "Direct to Project",
    desc: "Your XLM goes straight to the project wallet — no platform takes a cut.",
  },
  {
    icon: "🔍",
    title: "Full Transparency",
    desc: "Every donation is recorded on Stellar and tracked by a Soroban smart contract.",
  },
  {
    icon: "⚡",
    title: "Instant Settlement",
    desc: "Donations confirm in 3–5 seconds anywhere in the world for near-zero fees.",
  },
  {
    icon: "🏆",
    title: "Impact Badges",
    desc: "Earn on-chain badges as you give more — Seedling, Tree, Forest, Earth Guardian.",
  },
];

const IMPACT_STATS = [
  { value: 0, suffix: "%", label: "Platform fees", duration: 1500 },
  {
    value: 100,
    prefix: ">",
    suffix: "%",
    label: "Direct to Project",
    duration: 2000,
  },
  { value: 5000, suffix: "+", label: "Monthly Donors", duration: 2500 },
  { value: 250, suffix: "k", label: "CO₂ Offset (kg)", duration: 3000 },
];

const CATEGORIES = [
  { icon: "🌳", label: "Reforestation" },
  { icon: "☀️", label: "Solar Energy" },
  { icon: "🌊", label: "Ocean Conservation" },
  { icon: "💧", label: "Clean Water" },
  { icon: "🦁", label: "Wildlife Protection" },
  { icon: "♻️", label: "Carbon Capture" },
];

// Helper to get icon for a category
function getCategoryIcon(category: string): string {
  const match = CATEGORIES.find((c) => c.label === category);
  return match ? match.icon : "📁";
}

export default function Home({ publicKey, onConnect }: HomeProps) {
  const [showConnect, setShowConnect] = useState(false);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [featuredProject, setFeaturedProject] = useState<ClimateProject | null>(
    null,
  );
  const [categoryStats, setCategoryStats] = useState<CategoryStats[]>([]);
  const [liveDonations, setLiveDonations] = useState<LiveDonationTickerItem[]>(
    [],
  );
  const [tickerIndex, setTickerIndex] = useState(0);

  useEffect(() => {
    let closeStream: (() => void) | null = null;
    let isMounted = true;

    fetchGlobalStats()
      .then(setGlobalStats)
      .catch(() => null);
    fetchFeaturedProject()
      .then(setFeaturedProject)
      .catch(() => null);
    fetchCategoryStats()
      .then(setCategoryStats)
      .catch(() => null);

    fetchProjects({ limit: 100 })
      .then((projects) => {
        if (!isMounted || projects.length === 0) return;
        closeStream = streamGlobalProjectDonations(
          projects.map((project) => ({
            id: project.id,
            name: project.name,
            walletAddress: project.walletAddress,
          })),
          (donation) => {
            setLiveDonations((prev) =>
              [
                {
                  id: donation.id,
                  projectId: donation.projectId,
                  projectName: donation.projectName,
                  amountXLM: donation.amountXLM,
                  createdAt: donation.createdAt,
                },
                ...prev.filter((item) => item.id !== donation.id),
              ].slice(0, 10),
            );
          },
        );
      })
      .catch(() => null);

    return () => {
      isMounted = false;
      if (closeStream) closeStream();
    };
  }, []);

  useEffect(() => {
    if (liveDonations.length <= 1) return;
    const timer = window.setInterval(() => {
      setTickerIndex((current) => (current + 1) % liveDonations.length);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [liveDonations.length]);

  useEffect(() => {
    if (tickerIndex >= liveDonations.length) {
      setTickerIndex(0);
    }
  }, [liveDonations.length, tickerIndex]);

  return (
    <div className="relative overflow-hidden">
      {/* Background leaf gradient */}
      <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-white to-transparent pointer-events-none" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* ── Hero ────────────────────────────────────────────────────── */}
        <div className="text-center pt-20 pb-16 animate-fade-in relative">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-forest-200 bg-forest-50 text-forest-700 text-xs font-semibold mb-8 font-body">
            <span className="w-1.5 h-1.5 rounded-full bg-forest-500 animate-pulse" />
            Open Source · Built on Stellar · Powered by Soroban
          </div>

          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold text-forest-900 leading-tight mb-6">
            Fund the planet.
            <br />
            <span className="text-gradient-green italic">
              One XLM at a time.
            </span>
          </h1>

          <p className="text-[#5a7a5a] text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed font-body">
            Stellar GreenPay connects donors with verified climate projects
            worldwide. Donations go directly on-chain — no banks, no delays, no
            fees swallowed by middlemen.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {publicKey ? (
              <>
                <Link
                  href="/projects"
                  className="btn-primary text-base px-8 py-3.5"
                >
                  🌍 Browse Projects
                </Link>
                <Link
                  href="/dashboard"
                  className="btn-secondary text-base px-8 py-3.5"
                >
                  My Impact
                </Link>
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowConnect(true)}
                  className="btn-primary text-base px-8 py-3.5"
                >
                  🌱 Start Donating
                </button>
                <Link
                  href="/projects"
                  className="btn-secondary text-base px-8 py-3.5"
                >
                  Browse Projects
                </Link>
              </>
            )}
          </div>
        </div>

        {/* ── Stats ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-forest-200 rounded-2xl overflow-hidden border border-forest-200 mb-20 shadow-sm">
          {IMPACT_STATS.map((s) => (
            <StatItem key={s.label} stat={s} />
          ))}
        </div>

        {/* ── Global CO2 Offset Ticker ────────────────────────────── */}
        {globalStats !== null && <CO2OffsetTicker stats={globalStats} />}

        {/* ── Featured Project Spotlight ──────────────────────────── */}
        {featuredProject !== null && (
          <FeaturedProjectCard project={featuredProject} />
        )}

        {/* ── Features ────────────────────────────────────────────────── */}
        <div className="mb-20">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-forest-900 mb-3">
              Why GreenPay?
            </h2>
            <p className="text-[#5a7a5a] max-w-xl mx-auto font-body">
              Blockchain-powered climate finance that actually reaches the
              projects that need it.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="card hover:shadow-green transition-all"
              >
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-display font-semibold text-forest-900 mb-2 text-base">
                  {f.title}
                </h3>
                <p className="text-[#5a7a5a] text-sm leading-relaxed font-body">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Categories ──────────────────────────────────────────────── */}
        <div className="mb-20">
          <div className="text-center mb-10">
            <h2 className="font-display text-3xl font-bold text-forest-900 mb-3">
              Explore by Category
            </h2>
            <p className="text-[#5a7a5a] max-w-xl mx-auto font-body mb-8">
              Browse active climate projects across different impact areas
            </p>
          </div>

          {/* Category Stats Bar Chart */}
          {categoryStats.length > 0 && (
            <CategoryStatsChart stats={categoryStats} />
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-8">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.label}
                href={`/projects?category=${encodeURIComponent(cat.label)}`}
                className="card text-center hover:shadow-green hover:border-forest-300 transition-all group py-5"
              >
                <div className="text-3xl mb-2">{cat.icon}</div>
                <p className="text-xs font-semibold text-forest-800 group-hover:text-forest-600 font-body">
                  {cat.label}
                </p>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Badge system callout ─────────────────────────────────────── */}
        <div className="card mb-20 bg-gradient-to-br from-forest-50 to-white border-forest-200 text-center py-12">
          <h2 className="font-display text-3xl font-bold text-forest-900 mb-4">
            Earn Impact Badges
          </h2>
          <p className="text-[#5a7a5a] max-w-xl mx-auto mb-8 font-body">
            As you donate more, you unlock on-chain badges recorded on the
            Stellar blockchain. Show your commitment to the planet.
          </p>
          <div className="flex flex-wrap justify-center gap-6">
            {[
              { emoji: "🌱", name: "Seedling", threshold: "10+ XLM" },
              { emoji: "🌳", name: "Tree", threshold: "100+ XLM" },
              { emoji: "🌲", name: "Forest", threshold: "500+ XLM" },
              { emoji: "🌍", name: "Earth Guardian", threshold: "2,000+ XLM" },
            ].map((b) => (
              <div key={b.name} className="text-center">
                <div className="text-4xl mb-2">{b.emoji}</div>
                <p className="font-display font-semibold text-forest-900 text-sm">
                  {b.name}
                </p>
                <p className="text-xs text-[#5a7a5a] font-body">
                  {b.threshold}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="text-center pb-12 border-t border-forest-100 pt-8">
          <p className="text-[#8aaa8a] text-sm font-body">
            Open source · MIT License ·{" "}
            <a
              href="https://github.com/your-org/stellar-greenpay"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-forest-600 transition-colors"
            >
              Contribute on GitHub →
            </a>
          </p>
        </div>
      </div>

      {/* Wallet connect modal */}
      {showConnect && !publicKey && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm">
            <WalletConnect
              onConnect={(pk) => {
                onConnect(pk);
                setShowConnect(false);
              }}
            />
            <button
              onClick={() => setShowConnect(false)}
              className="mt-4 w-full text-center text-sm text-[#8aaa8a] hover:text-[#5a7a5a] transition-colors font-body"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <LiveDonationTicker donations={liveDonations} activeIndex={tickerIndex} />
    </div>
  );
}

function LiveDonationTicker({
  donations,
  activeIndex,
}: {
  donations: LiveDonationTickerItem[];
  activeIndex: number;
}) {
  if (donations.length === 0) return null;
  const item = donations[activeIndex];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-forest-800 bg-forest-900/95 backdrop-blur px-4 py-2">
      <div className="max-w-6xl mx-auto flex items-center gap-3 text-sm text-white font-body">
        <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest text-forest-300 font-bold">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live donations
        </span>
        <p key={item.id} className="animate-slide-up">
          just donated <strong>{formatXLM(item.amountXLM)}</strong> to{" "}
          <Link
            href={`/projects/${item.projectId}`}
            className="text-emerald-300 hover:text-emerald-200"
          >
            {item.projectName}
          </Link>
        </p>
      </div>
    </div>
  );
}

function CategoryStatsChart({ stats }: { stats: CategoryStats[] }) {
  const maxCount = Math.max(...stats.map((s) => s.count));

  return (
    <div className="card p-6 mb-6">
      <h3 className="font-display text-lg font-semibold text-forest-900 mb-4">
        Active Projects by Category
      </h3>
      <div className="space-y-3">
        {stats.map((stat) => {
          const percentage = maxCount > 0 ? (stat.count / maxCount) * 100 : 0;
          return (
            <Link
              key={stat.category}
              href={`/projects?category=${encodeURIComponent(stat.category)}`}
              className="block group"
            >
              <div className="flex items-center gap-3 mb-1">
                <span className="text-xl">
                  {getCategoryIcon(stat.category)}
                </span>
                <span className="font-body text-sm font-medium text-forest-800 group-hover:text-forest-600 transition-colors flex-1">
                  {stat.category}
                </span>
                <span className="font-body text-sm font-bold text-forest-700">
                  {stat.count}
                </span>
              </div>
              <div
                className="h-2 bg-forest-100 rounded-full overflow-hidden"
                style={{ width: "100%" }}
              >
                <div
                  className="h-full bg-gradient-to-r from-forest-500 to-forest-600 rounded-full transition-all duration-500 ease-out group-hover:from-forest-600 group-hover:to-forest-700"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function FeaturedProjectCard({ project }: { project: ClimateProject }) {
  const pct = progressPercent(project.raisedXLM, project.goalXLM);
  return (
    <div className="mb-20">
      <div className="text-center mb-8">
        <h2 className="font-display text-3xl font-bold text-forest-900 mb-2">
          ⭐ Featured Project
        </h2>
        <p className="text-[#5a7a5a] font-body">
          The project making the biggest impact right now
        </p>
      </div>
      <div className="card border-forest-200 shadow-lg hover:shadow-green transition-all p-6 sm:p-8">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs font-semibold bg-amber-100 text-amber-800 px-3 py-1 rounded-full border border-amber-200 font-body">
                🏆 Most Donors
              </span>
              <span className="text-xs text-[#8aaa8a] bg-forest-50 px-2.5 py-1 rounded-full border border-forest-100 font-body">
                {project.category}
              </span>
            </div>
            <h3 className="font-display text-2xl font-bold text-forest-900 mb-2">
              {project.name}
            </h3>
            <p className="text-[#5a7a5a] text-sm leading-relaxed font-body mb-4 line-clamp-3">
              {project.description}
            </p>
            <div className="flex flex-wrap gap-4 text-sm mb-5">
              <span className="flex items-center gap-1 text-forest-700 font-body">
                👥 <strong>{project.donorCount.toLocaleString()}</strong> donors
              </span>
              <span className="flex items-center gap-1 text-forest-700 font-body">
                ♻️ <strong>{formatCO2(project.co2OffsetKg)}</strong> offset
              </span>
              <span className="flex items-center gap-1 text-[#5a7a5a] font-body">
                📍 {project.location}
              </span>
            </div>
            {/* Progress bar */}
            <div className="mb-2">
              <div className="flex justify-between text-xs mb-1 font-body">
                <span className="font-semibold text-forest-700">
                  {formatXLM(project.raisedXLM)} raised
                </span>
                <span className="text-[#5a7a5a]">
                  {pct}% of {formatXLM(project.goalXLM)}
                </span>
              </div>
              <div className="progress-bar h-2.5">
                <div
                  className={
                    pct >= 100
                      ? "progress-fill progress-fill-complete"
                      : "progress-fill"
                  }
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-3 md:w-48">
            <Link
              href={`/projects/${project.id}`}
              className="btn-primary text-base py-3 px-6 text-center"
            >
              🌍 Donate Now
            </Link>
            <Link
              href={`/projects/${project.id}`}
              className="btn-secondary text-sm py-2.5 px-4 text-center"
            >
              View Project →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function CO2OffsetTicker({ stats }: { stats: GlobalStats }) {
  const { count, elementRef } = useCountUp(stats.totalCO2OffsetKg, 2500);
  return (
    <div
      ref={elementRef}
      className="card mb-20 bg-gradient-to-br from-forest-900 to-forest-700 border-none text-white text-center py-10 shadow-xl"
    >
      <p className="text-3xl mb-2">🍃</p>
      <div className="font-display text-5xl sm:text-6xl font-bold text-white mb-2">
        {formatCO2(count)}
      </div>
      <p className="text-forest-200 text-sm font-body uppercase tracking-widest font-bold opacity-80">
        Total CO₂ Offset Across All Donations
      </p>
      <p className="text-forest-300 text-xs font-body mt-2">
        {stats.totalDonations.toLocaleString()} donations ·{" "}
        {parseFloat(stats.totalXLMRaised).toLocaleString()} XLM raised
      </p>
    </div>
  );
}

function StatItem({ stat }: { stat: any }) {
  const { count, elementRef } = useCountUp(stat.value, stat.duration);
  return (
    <div ref={elementRef} className="bg-white text-center py-10 px-4">
      <div className="font-display text-4xl font-bold text-gradient-green mb-1">
        {stat.prefix}
        {count.toLocaleString()}
        {stat.suffix}
      </div>
      <div className="text-[#5a7a5a] text-sm font-body uppercase tracking-widest font-bold opacity-60">
        {stat.label}
      </div>
    </div>
  );
}
