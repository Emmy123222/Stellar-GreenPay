/**
 * pages/dashboard.tsx — Donor impact dashboard
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import EditProfileForm from "@/components/EditProfileForm";
import { fetchProfile, fetchDonorHistory } from "@/lib/api";
import { getXLMBalance } from "@/lib/stellar";
import { formatXLM, formatCO2, timeAgo, shortenAddress, badgeEmoji, badgeLabel } from "@/utils/format";
import { explorerUrl } from "@/lib/stellar";
import type { DonorProfile, Donation } from "@/utils/types";

interface DashboardProps { publicKey: string | null; onConnect: (pk: string) => void; }

export default function Dashboard({ publicKey, onConnect }: DashboardProps) {
  const [profile,   setProfile]   = useState<DonorProfile | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [balance,   setBalance]   = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!publicKey) return;
    Promise.all([
      fetchProfile(publicKey).catch(() => null),
      fetchDonorHistory(publicKey),
      getXLMBalance(publicKey),
    ])
      .then(([p, d, b]) => { setProfile(p); setDonations(d); setBalance(b); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [publicKey]);

  if (!publicKey) return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
      <div className="text-center mb-10">
        <h1 className="font-display text-3xl font-bold text-forest-900 mb-3">My Impact</h1>
        <p className="text-[#5a7a5a] font-body">Connect your wallet to see your donation history and impact</p>
      </div>
      <WalletConnect onConnect={onConnect} />
    </div>
  );

  const totalDonated  = profile?.totalDonatedXLM || "0";
  const co2Estimate   = Math.round(parseFloat(totalDonated) * 12); // rough estimate
  const projectsCount = profile?.projectsSupported || 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-forest-900 mb-1">My Impact</h1>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/>
            <span className="address-tag">{shortenAddress(publicKey)}</span>
          </div>
        </div>
        <Link href="/projects" className="btn-primary text-sm py-2.5 px-5 flex-shrink-0">🌱 Donate Now</Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { icon: "💚", label: "Total Donated",     value: formatXLM(totalDonated) },
          { icon: "♻️", label: "Est. CO₂ Offset",   value: formatCO2(co2Estimate) },
          { icon: "🌍", label: "Projects Supported", value: projectsCount.toString() },
          { icon: "💰", label: "XLM Balance",        value: balance ? formatXLM(balance) : "—" },
        ].map(stat => (
          <div key={stat.label} className="card text-center shadow-sm border border-forest-100/50">
            <p className="text-2xl mb-2">{stat.icon}</p>
            <p className="font-display font-bold text-forest-900 text-lg leading-tight">{loading ? "..." : stat.value}</p>
            <p className="text-xs text-[#8aaa8a] mt-1 font-body uppercase tracking-wider font-bold opacity-60">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Profile Edit */}
      <div className="mb-8">
        <EditProfileForm publicKey={publicKey} />
      </div>

      {/* Badges */}
      {profile?.badges && profile.badges.length > 0 && (
        <div className="card mb-8 shadow-sm border border-forest-100/50">
          <h2 className="font-display text-lg font-semibold text-forest-900 mb-4 flex items-center gap-2">
            <span>🏆</span> Your Impact Badges
          </h2>
          <div className="flex flex-wrap gap-4">
            {profile.badges.map((badge, i) => (
              <div key={i} className="flex items-center gap-3 bg-forest-50/50 rounded-xl px-4 py-3 border border-forest-200/50 hover:bg-forest-50 transition-colors">
                <span className="text-3xl">{badgeEmoji(badge.tier)}</span>
                <div>
                  <p className="font-semibold text-forest-900 text-sm font-body">{badgeLabel(badge.tier)}</p>
                  <p className="text-[10px] text-[#8aaa8a] font-body uppercase tracking-widest font-bold opacity-80">Earned {timeAgo(badge.earnedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Donation history */}
      <div className="card shadow-sm border border-forest-100/50">
        <h2 className="font-display text-lg font-semibold text-forest-900 mb-5 flex items-center gap-2">
          <span>📜</span> Donation History
        </h2>
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-forest-50 rounded-xl animate-pulse"/>)}
          </div>
        ) : donations.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🌱</p>
            <p className="text-[#5a7a5a] mb-4 font-body">No donations yet</p>
            <Link href="/projects" className="btn-primary text-sm">Browse Projects →</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {donations.map(d => (
              <div key={d.id} className="flex items-center gap-4 p-4 rounded-xl bg-forest-50/50 hover:bg-forest-50 transition-colors border border-transparent hover:border-forest-100/50">
                <div className="w-10 h-10 rounded-full bg-forest-100 flex items-center justify-center text-lg flex-shrink-0">🌱</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-forest-900 font-body">Project donation</p>
                  {d.message && <p className="text-xs text-[#5a7a5a] italic font-body truncate">"{d.message}"</p>}
                  <p className="text-[10px] text-[#8aaa8a] font-body uppercase tracking-wider font-bold opacity-70">{timeAgo(d.createdAt)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-mono font-semibold text-forest-700 text-sm">{formatXLM(d.amountXLM || "0")}</p>
                  <a href={explorerUrl(d.transactionHash)} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-forest-500 hover:text-forest-700 font-bold uppercase tracking-widest transition-colors">View tx ↗</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

