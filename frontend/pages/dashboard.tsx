/**
 * pages/dashboard.tsx — Donor impact dashboard
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import EditProfileForm from "@/components/EditProfileForm";
import ProjectCard from "@/components/ProjectCard";
import { fetchProfile, fetchDonorHistory, fetchProjects } from "@/lib/api";
import { getDueMonthlySubscriptions } from "@/lib/monthlyGiving";
import { getXLMBalance, getFriendBotFunding, NETWORK } from "@/lib/stellar";
import { formatXLM, formatCO2, timeAgo, shortenAddress, badgeEmoji, badgeLabel, calculateStreak } from "@/utils/format";
import { explorerUrl } from "@/lib/stellar";
import type { DonorProfile, Donation, ClimateProject, MonthlySubscription } from "@/utils/types";
import { useWishlist } from "@/hooks/useWishlist";

interface DashboardProps { publicKey: string | null; onConnect: (pk: string) => void; }

export default function Dashboard({ publicKey, onConnect }: DashboardProps) {
  const [profile,   setProfile]   = useState<DonorProfile | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [balance,   setBalance]   = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<'impact' | 'saved'>('impact');
  const [savedProjects, setSavedProjects] = useState<ClimateProject[]>([]);
  const [isUnfunded, setIsUnfunded] = useState(false);
  const [friendbotState, setFriendbotState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [friendbotError, setFrienbotError] = useState<string | null>(null);
  const [dueSubscriptions, setDueSubscriptions] = useState<MonthlySubscription[]>([]);
  const { wishlist } = useWishlist();

  useEffect(() => {
    if (!publicKey) return;
    Promise.all([
      fetchProfile(publicKey).catch(() => null),
      fetchDonorHistory(publicKey),
      getXLMBalance(publicKey).catch(() => { setIsUnfunded(true); return null; }),
      fetchProjects(),
    ])
      .then(([p, d, b, allProjects]) => { 
        setProfile(p); 
        setDonations(d); 
        if (b !== null) {
          setBalance(b);
          setIsUnfunded(false);
        }
        setSavedProjects(allProjects.filter(proj => wishlist.includes(proj.id)));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [publicKey, wishlist]);

  useEffect(() => {
    if (!publicKey) return;
    setDueSubscriptions(getDueMonthlySubscriptions());
  }, [publicKey]);

  const streak = calculateStreak(donations);
  
  const handleFriendbot = async () => {
    if (!publicKey) return;
    setFriendbotState('loading');
    setFrienbotError(null);
    try {
      const newBalance = await getFriendBotFunding(publicKey);
      setBalance(newBalance);
      setIsUnfunded(false);
      setFriendbotState('success');
    } catch (err: unknown) {
      setFrienbotError((err as Error).message || "Funding failed. Try again.");
      setFriendbotState('error');
    }
  };
  
  // Persistence for longest streak
  useEffect(() => {
    if (streak.longest > 0) {
      const stored = localStorage.getItem("longest_streak");
      if (!stored || parseInt(stored) < streak.longest) {
        localStorage.setItem("longest_streak", streak.longest.toString());
      }
    }
  }, [streak.longest]);

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

      {dueSubscriptions.length > 0 && (
        <div className="card mb-6 border-amber-200 bg-amber-50">
          <h2 className="font-display text-lg font-semibold text-amber-900 mb-2">Monthly Giving Due Today</h2>
          <div className="space-y-2">
            {dueSubscriptions.map((subscription) => (
              <div key={subscription.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2">
                <p className="text-sm text-amber-900 font-body">
                  {subscription.projectName}: {formatXLM(subscription.amountXLM)}
                </p>
                <Link
                  href={`/projects/${subscription.projectId}?amount=${encodeURIComponent(subscription.amountXLM)}&monthlySubId=${encodeURIComponent(subscription.id)}`}
                  className="btn-primary text-xs py-1.5 px-3 inline-flex items-center justify-center"
                >
                  Pay Now
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Testnet Friendbot funding card — testnet only, shown when account is unfunded */}
      {NETWORK === "testnet" && isUnfunded && (
        <div className="card mb-6 bg-amber-50 border-amber-200 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="text-3xl">🚰</div>
            <div className="flex-1">
              <h2 className="font-display font-bold text-amber-900 text-base mb-1">
                Your testnet wallet has no XLM
              </h2>
              <p className="text-amber-700 text-sm font-body">
                Fund it instantly with Stellar Friendbot to start donating on testnet.
              </p>
              {friendbotState === 'success' && (
                <p className="text-green-700 text-sm font-body mt-1 font-semibold">
                  ✓ Funded! Your wallet received 10,000 XLM testnet tokens.
                </p>
              )}
              {friendbotState === 'error' && friendbotError && (
                <p className="text-red-600 text-sm font-body mt-1">{friendbotError}</p>
              )}
            </div>
            <button
              onClick={handleFriendbot}
              disabled={friendbotState === 'loading' || friendbotState === 'success'}
              className="btn-primary text-sm py-2.5 px-5 flex-shrink-0 disabled:opacity-60"
            >
              {friendbotState === 'loading' ? 'Funding…' : friendbotState === 'success' ? '✓ Funded!' : '💧 Fund My Testnet Wallet'}
            </button>
          </div>
        </div>
      )}

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

      {/* Tabs */}
      <div className="flex border-b border-forest-100 mb-6">
        <button
          onClick={() => setActiveTab('impact')}
          className={`px-6 py-3 text-sm font-semibold transition-all border-b-2 ${activeTab === 'impact' ? 'border-forest-500 text-forest-900' : 'border-transparent text-[#8aaa8a] hover:text-forest-600'}`}
        >
          My Impact
        </button>
        <button
          onClick={() => setActiveTab('saved')}
          className={`px-6 py-3 text-sm font-semibold transition-all border-b-2 flex items-center gap-2 ${activeTab === 'saved' ? 'border-forest-500 text-forest-900' : 'border-transparent text-[#8aaa8a] hover:text-forest-600'}`}
        >
          Saved Projects
          {wishlist.length > 0 && (
            <span className="bg-forest-100 text-forest-700 px-2 py-0.5 rounded-full text-[10px]">{wishlist.length}</span>
          )}
        </button>
      </div>

      {activeTab === 'impact' ? (
        <div className="space-y-8 animate-slide-up">
          {/* Streak Section */}
          <div className="card bg-gradient-to-br from-forest-900 to-forest-800 text-white border-none shadow-xl">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-white/10 rounded-2xl flex items-center justify-center text-4xl border border-white/20 shadow-inner">
                  {streak.current > 0 ? "🔥" : "🌱"}
                </div>
                <div>
                  <h2 className="text-2xl font-display font-bold">
                    {streak.current} Month Streak
                  </h2>
                  <p className="text-forest-200 text-sm font-body">
                    {streak.current > 0 
                      ? "Keep it up! Your monthly support drives long-term change." 
                      : "Start a monthly donation habit to build your streak!"}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                {[
                  { m: 3, label: "3mo", emoji: "🥉" },
                  { m: 6, label: "6mo", emoji: "🥈" },
                  { m: 12, label: "12mo", emoji: "🥇" },
                ].map(m => (
                  <div 
                    key={m.m} 
                    className={`flex flex-col items-center p-3 rounded-xl border transition-all ${streak.longest >= m.m ? 'bg-white/10 border-white/30' : 'bg-black/20 border-white/5 opacity-30'}`}
                    title={`${m.m} Month Milestone`}
                  >
                    <span className="text-xl mb-1">{m.emoji}</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest">{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {streak.current === 0 && donations.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/10 text-center">
                <p className="text-xs text-forest-300 font-body italic">
                  Streak broken? Don't worry, every donation counts. Start fresh this month!
                </p>
              </div>
            )}
          </div>

          {/* Profile Edit */}
          <EditProfileForm publicKey={publicKey} />

          {/* Badges */}
          {profile?.badges && profile.badges.length > 0 && (
            <div className="card shadow-sm border border-forest-100/50">
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
      ) : (
        <div className="animate-slide-up">
          {savedProjects.length === 0 ? (
            <div className="card text-center py-20">
              <p className="text-5xl mb-4">❤️</p>
              <h2 className="text-xl font-display font-bold text-forest-900 mb-2">No saved projects yet</h2>
              <p className="text-[#5a7a5a] mb-8 font-body">Save projects you're interested in to track their progress.</p>
              <Link href="/projects" className="btn-primary text-sm">Explore Projects</Link>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {savedProjects.map(project => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

