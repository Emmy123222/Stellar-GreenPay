/**
 * pages/dashboard.tsx — Donor impact dashboard
 */
import { useState, useEffect, useMemo, useRef } from "react";
import html2canvas from "html2canvas";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import EditProfileForm from "@/components/EditProfileForm";
import ProjectCard from "@/components/ProjectCard";
import ImpactCertificate from "@/components/ImpactCertificate";
import ProjectRating from "@/components/ProjectRating";
import ReferralSection from "@/components/ReferralSection";
import { fetchProfile, fetchDonorHistory, fetchProjects, fetchMyTeam, createTeam, joinTeam, exportDonationHistoryCsv } from "@/lib/api";
import { getDueMonthlySubscriptions } from "@/lib/monthlyGiving";
import { getXLMBalance, getFriendBotFunding, NETWORK } from "@/lib/stellar";
import { formatXLM, formatCO2, timeAgo, shortenAddress, badgeEmoji, badgeLabel, calculateStreak } from "@/utils/format";
import { explorerUrl } from "@/lib/stellar";
import type { DonorProfile, Donation, ClimateProject, MonthlySubscription, Team } from "@/utils/types";
import { useWishlist } from "@/hooks/useWishlist";

interface DashboardProps { publicKey: string | null; onConnect: (pk: string) => void; }

/** Turn a canvas data URL into a PNG file download (issue #1200). */
function triggerCertificateDownload(dataUrl: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = "impact-certificate.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function Dashboard({ publicKey, onConnect }: DashboardProps) {
  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'impact' | 'saved'>('impact');
  const [savedProjects, setSavedProjects] = useState<ClimateProject[]>([]);
  const [allProjects, setAllProjects] = useState<ClimateProject[]>([]);
  const [isUnfunded, setIsUnfunded] = useState(false);
  const [friendbotState, setFriendbotState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [friendbotError, setFrienbotError] = useState<string | null>(null);
  const { wishlist } = useWishlist();
  const [showCertificate, setShowCertificate] = useState(false);
  const [pendingRating, setPendingRating] = useState<{ id: string, name: string } | null>(null);
  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamForm, setTeamForm] = useState<"none" | "create" | "join">("none");
  const [newTeamName, setNewTeamName] = useState("");
  const [joinTeamId, setJoinTeamId] = useState("");
  const [joinInviteCode, setJoinInviteCode] = useState("");
  const [teamActionState, setTeamActionState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [exportState, setExportState] = useState<"idle" | "loading" | "error">("idle");

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
        setAllProjects(allProjects);
        setSavedProjects(allProjects.filter(proj => wishlist.includes(proj.id)));

        // Fetch pending rating
        return fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/ratings/pending?donorAddress=${publicKey}`);
      })
      .then(r => r?.json())
      .then(res => {
        if (res?.success && res.data) {
          setPendingRating(res.data);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [publicKey, wishlist]);

  // Fetch the caller's team (if any) for the team-giving card.
  useEffect(() => {
    if (!publicKey) return;
    fetchMyTeam()
      .then(setMyTeam)
      .catch(() => setMyTeam(null));
  }, [publicKey]);

  // publicKey is always null during SSR/initial hydration (wallet connection
  // is a client-only interaction), so this is safe to derive directly during
  // render instead of via an effect + state.
  const dueSubscriptions = useMemo<MonthlySubscription[]>(
    () => (publicKey ? getDueMonthlySubscriptions() : []),
    [publicKey]
  );

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

  // ── Certificate image download (issue #1200) ───────────────────────────────
  // The first click rasterizes the certificate DOM once; later clicks reuse
  // the cached PNG until the donor's badge tier changes (the cache key), so
  // repeated downloads never re-render the subtree or compete on the main
  // thread.
  const [certificateRendering, setCertificateRendering] = useState(false);
  const certificateCanvasUrlRef = useRef<{ key: string; dataUrl: string } | null>(null);

  if (!publicKey) return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
      <div className="text-center mb-10">
        <h1 className="font-display text-3xl font-bold text-forest-900 mb-3">My Impact</h1>
        <p className="text-[#5a7a5a] dark:text-[#8aaa8a] font-body">Connect your wallet to see your donation history and impact</p>
      </div>
      <WalletConnect onConnect={onConnect} />
    </div>
  );

  const totalDonated = profile?.totalDonatedXLM || "0";
  const co2Estimate = Math.round(parseFloat(totalDonated) * 12); // rough estimate
  const projectsCount = profile?.projectsSupported || 0;

  const topBadgeTier = profile?.badges?.length ? profile.badges[0].tier : null;
  const supportedProjects = Array.from(
    new Map(
      donations.map((d) => [d.projectId, d.projectId]),
    ).values(),
  )
    .slice(0, 50)
    .map((projectId) => {
      const p = allProjects.find((sp) => sp.id === projectId);
      return p ? { id: p.id, name: p.name } : { id: projectId, name: projectId };
    });

  const handlePrintCertificate = () => {
    const el = document.getElementById("impact-certificate");
    if (!el) return;
    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!w) return;
    w.document.open();
    w.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Impact Certificate</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 24px; font-family: Nunito, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #f0f7f0; }
            @media print { body { background: #fff; padding: 0; } }
            .font-display { font-family: Lora, serif; }
          </style>
        </head>
        <body>
          <div class="font-display"></div>
          ${el.outerHTML}
          <script>
            window.onload = () => { window.focus(); window.print(); };
          </script>
        </body>
      </html>
    `);
    w.document.close();
  };

  const handleShareCertificate = () => {
    const text = `I just got my Stellar GreenPay impact certificate: ${formatCO2(co2Estimate)} offset from ${formatXLM(totalDonated)} donated.`;
    const url = typeof window !== "undefined" ? window.location.href : "https://stellar-greenpay.app";
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
    );
  };

  // Key includes the address (certificates are per donor) and the badge tier:
  // a tier change produces a new key, invalidating the cached snapshot.
  const certificateCacheKey = `${publicKey}|${topBadgeTier ?? "none"}`;

  const handleDownloadCertificate = async () => {
    // Criterion 1: only one render can be in flight — later clicks are
    // ignored while the button is disabled anyway.
    if (certificateRendering) return;
    const el = document.getElementById("impact-certificate");
    if (!el) return;

    // Criterion 2 + 3: serve the cached data URL until the tier changes.
    const cached = certificateCanvasUrlRef.current;
    if (cached && cached.key === certificateCacheKey) {
      triggerCertificateDownload(cached.dataUrl);
      return;
    }

    setCertificateRendering(true);
    try {
      const canvas = await html2canvas(el, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });
      const dataUrl = canvas.toDataURL("image/png");
      certificateCanvasUrlRef.current = { key: certificateCacheKey, dataUrl };
      triggerCertificateDownload(dataUrl);
    } catch (err) {
      // Graceful degradation: the pre-existing print-window flow still gives
      // the user a downloadable certificate if rasterization fails.
      console.error("Failed to rasterize the impact certificate", err);
      handlePrintCertificate();
    } finally {
      setCertificateRendering(false);
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    setTeamActionState("saving");
    setTeamError(null);
    try {
      const team = await createTeam({ name: newTeamName.trim() });
      setMyTeam(team);
      setTeamForm("none");
      setNewTeamName("");
      setTeamActionState("success");
      window.setTimeout(() => setTeamActionState("idle"), 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setTeamError(msg || "Could not create team.");
      setTeamActionState("error");
    }
  };

  const handleJoinTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinTeamId.trim() || !joinInviteCode.trim()) return;
    setTeamActionState("saving");
    setTeamError(null);
    try {
      const team = await joinTeam(joinTeamId.trim(), joinInviteCode.trim());
      setMyTeam(team);
      setTeamForm("none");
      setJoinTeamId("");
      setJoinInviteCode("");
      setTeamActionState("success");
      window.setTimeout(() => setTeamActionState("idle"), 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setTeamError(msg || "Could not join team.");
      setTeamActionState("error");
    }
  };

  const handleExportCsv = async () => {
    setExportState("loading");
    try {
      await exportDonationHistoryCsv();
      setExportState("idle");
    } catch (err: unknown) {
      setExportState("error");
      window.setTimeout(() => setExportState("idle"), 3000);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">

      {pendingRating && publicKey && (
        <ProjectRating
          projectId={pendingRating.id}
          projectName={pendingRating.name}
          donorAddress={publicKey}
          onSuccess={() => setPendingRating(null)}
          onCancel={() => setPendingRating(null)}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-forest-900 mb-1">My Impact</h1>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
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
          { icon: "💚", label: "Total Donated", value: formatXLM(totalDonated) },
          { icon: "♻️", label: "Est. CO₂ Offset", value: formatCO2(co2Estimate) },
          { icon: "🌍", label: "Projects Supported", value: projectsCount.toString() },
          { icon: "💰", label: "XLM Balance", value: balance ? formatXLM(balance) : "—" },
        ].map(stat => (
          <div key={stat.label} className="card text-center shadow-sm border border-forest-100/50">
            <p className="text-2xl mb-2">{stat.icon}</p>
            <p className="font-display font-bold text-forest-900 text-lg leading-tight">{loading ? "..." : stat.value}</p>
            <p className="text-xs text-[#8aaa8a] dark:text-forest-300 mt-1 font-body uppercase tracking-wider font-bold opacity-60">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-forest-100 mb-6">
        <button
          onClick={() => setActiveTab('impact')}
          className={`px-6 py-3 text-sm font-semibold transition-all border-b-2 ${activeTab === 'impact' ? 'border-forest-500 text-forest-900' : 'border-transparent text-[#8aaa8a] dark:text-forest-300 hover:text-forest-600'}`}
        >
          My Impact
        </button>
        <button
          onClick={() => setActiveTab('saved')}
          className={`px-6 py-3 text-sm font-semibold transition-all border-b-2 flex items-center gap-2 ${activeTab === 'saved' ? 'border-forest-500 text-forest-900' : 'border-transparent text-[#8aaa8a] dark:text-forest-300 hover:text-forest-600'}`}
        >
          Saved Projects
          {wishlist.length > 0 && (
            <span className="bg-forest-100 text-forest-700 px-2 py-0.5 rounded-full text-[10px]">{wishlist.length}</span>
          )}
        </button>
      </div>

      {activeTab === 'impact' ? (
        <div className="space-y-8 animate-slide-up">
          {/* Referral Section */}
          <ReferralSection publicKey={publicKey} />

          {/* Certificate */}
          <div className="card">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-bold text-forest-900">Your Impact Certificate</h2>
                <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body mt-1">
                  Download a PDF-ready certificate or share it on social media.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setShowCertificate((v) => !v)}
                  className="btn-primary text-sm py-2.5 px-5"
                >
                  {showCertificate ? "Hide" : "Preview"}
                </button>
                <button
                  onClick={handleDownloadCertificate}
                  disabled={certificateRendering || !showCertificate}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-forest-200 bg-forest-50 hover:bg-forest-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {certificateRendering ? "Rendering…" : "Download Certificate"}
                </button>
                <button
                  onClick={handleShareCertificate}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-forest-200 bg-white hover:bg-forest-50 transition-all"
                >
                  Share to Twitter
                </button>
              </div>
            </div>

            {showCertificate && (
              <div className="mt-6">
                <ImpactCertificate
                  donorAddress={publicKey}
                  donorName={profile?.displayName || null}
                  totalDonatedXLM={totalDonated}
                  totalCO2OffsetKg={co2Estimate}
                  badgeTier={topBadgeTier}
                  projectsSupported={supportedProjects}
                />
              </div>
            )}
          </div>

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
                  Streak broken? Don&apos;t worry, every donation counts. Start fresh this month!
                </p>
              </div>
            )}
          </div>

          {/* Team giving — combined impact for businesses and groups */}
          <div className="card shadow-sm border border-forest-100/50">
            <h2 className="font-display text-lg font-semibold text-forest-900 mb-4 flex items-center gap-2">
              <span>👥</span> Your Team
            </h2>

            {teamLoading ? (
              <div className="animate-pulse h-16 bg-forest-50 rounded-xl" />
            ) : myTeam ? (
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-forest-100 flex items-center justify-center text-2xl overflow-hidden flex-shrink-0">
                      {myTeam.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={myTeam.logoUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        "🌿"
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-forest-900 font-body">{myTeam.name}</p>
                      <p className="text-xs text-[#8aaa8a] dark:text-forest-300 font-body">
                        👥 {myTeam.memberCount} member{myTeam.memberCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <Link href="/leaderboard" className="text-xs font-semibold text-forest-600 hover:underline font-body">
                    View team leaderboard →
                  </Link>
                </div>
                <div className="mt-4 p-4 rounded-xl bg-forest-50 border border-forest-100 text-center">
                  <p className="text-[#5a7a5a] dark:text-[#8aaa8a] text-xs font-body uppercase tracking-wider font-bold mb-1">
                    Your team has donated
                  </p>
                  <p className="font-display text-2xl font-bold text-forest-900">
                    {formatXLM(myTeam.totalDonatedXLM)} XLM
                  </p>
                  <p className="text-xs text-[#8aaa8a] dark:text-forest-300 font-body mt-1">
                    ≈ {formatCO2(Number(myTeam.totalCO2OffsetKg || 0))} CO₂ offset combined
                  </p>
                </div>
              </div>
            ) : teamForm === "none" ? (
              <div>
                <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body mb-4">
                  Give as a team — combine your company&apos;s or group&apos;s donations under one profile and climb the team leaderboard together.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setTeamForm("create")}
                    className="btn-primary text-sm py-2 px-4"
                  >
                    Create a team
                  </button>
                  <button
                    onClick={() => setTeamForm("join")}
                    className="btn-secondary text-sm py-2 px-4"
                  >
                    Join with invite code
                  </button>
                </div>
              </div>
            ) : teamForm === "create" ? (
              <form onSubmit={handleCreateTeam} className="space-y-3">
                <div>
                  <label htmlFor="team-name" className="block text-xs font-bold text-forest-800 uppercase tracking-wider mb-1 opacity-60">
                    Team name
                  </label>
                  <input
                    id="team-name"
                    type="text"
                    required
                    maxLength={100}
                    placeholder="e.g. Acme Corp Giving"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    className="input-field"
                  />
                </div>
                {teamError && teamActionState === "error" && (
                  <p className="text-xs text-red-600 font-body">{teamError}</p>
                )}
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={teamActionState === "saving" || !newTeamName.trim()}
                    className="btn-primary text-sm py-2 px-4 disabled:opacity-60"
                  >
                    {teamActionState === "saving" ? "Creating…" : teamActionState === "success" ? "Team Created" : "Create Team"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTeamForm("none")}
                    className="btn-secondary text-sm py-2 px-4"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleJoinTeam} className="space-y-3">
                <div>
                  <label htmlFor="team-id" className="block text-xs font-bold text-forest-800 uppercase tracking-wider mb-1 opacity-60">
                    Team ID
                  </label>
                  <input
                    id="team-id"
                    type="text"
                    required
                    placeholder="Team ID from your invite"
                    value={joinTeamId}
                    onChange={(e) => setJoinTeamId(e.target.value)}
                    className="input-field"
                  />
                </div>
                <div>
                  <label htmlFor="invite-code" className="block text-xs font-bold text-forest-800 uppercase tracking-wider mb-1 opacity-60">
                    Invite code
                  </label>
                  <input
                    id="invite-code"
                    type="text"
                    required
                    placeholder="e.g. acme2026"
                    value={joinInviteCode}
                    onChange={(e) => setJoinInviteCode(e.target.value)}
                    className="input-field"
                  />
                </div>
                {teamError && teamActionState === "error" && (
                  <p className="text-xs text-red-600 font-body">{teamError}</p>
                )}
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={teamActionState === "saving" || !joinTeamId.trim() || !joinInviteCode.trim()}
                    className="btn-primary text-sm py-2 px-4 disabled:opacity-60"
                  >
                    {teamActionState === "saving" ? "Joining…" : teamActionState === "success" ? "Joined!" : "Join team"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTeamForm("none")}
                    className="btn-secondary text-sm py-2 px-4"
                  >
                    Cancel
                  </button>
                </div>
              </form>
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
                      <p className="text-[10px] text-[#8aaa8a] dark:text-forest-300 font-body uppercase tracking-widest font-bold opacity-80">Earned {timeAgo(badge.earnedAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Donation history */}
          <div className="card shadow-sm border border-forest-100/50">
            <div className="flex items-center justify-between gap-3 mb-5">
              <h2 className="font-display text-lg font-semibold text-forest-900 flex items-center gap-2">
                <span>📜</span> Donation History
              </h2>
              <div className="flex items-center gap-2">
                {exportState === "error" && (
                  <span className="text-xs text-red-600 font-body">Export failed — try again</span>
                )}
                <button
                  onClick={handleExportCsv}
                  disabled={exportState === "loading"}
                  className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-60"
                  title="Download your full donation history as a CSV for tax purposes"
                >
                  {exportState === "loading" ? "Exporting…" : "Export CSV"}
                </button>
              </div>
            </div>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-16 bg-forest-50 rounded-xl animate-pulse" />)}
              </div>
            ) : donations.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-4xl mb-3">🌱</p>
                <p className="text-[#5a7a5a] dark:text-[#8aaa8a] mb-4 font-body">No donations yet</p>
                <Link href="/projects" className="btn-primary text-sm">Browse Projects →</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {donations.map(d => (
                  <div key={d.id} className="flex items-center gap-4 p-4 rounded-xl bg-forest-50/50 hover:bg-forest-50 transition-colors border border-transparent hover:border-forest-100/50">
                    <div className="w-10 h-10 rounded-full bg-forest-100 flex items-center justify-center text-lg flex-shrink-0">🌱</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-forest-900 font-body">Project donation</p>
                      {d.message && <p className="text-xs text-[#5a7a5a] dark:text-[#8aaa8a] italic font-body truncate">&quot;{d.message}&quot;</p>}
                      <p className="text-[10px] text-[#8aaa8a] dark:text-forest-300 font-body uppercase tracking-wider font-bold opacity-70">{timeAgo(d.createdAt)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-mono font-semibold text-forest-700 text-sm">
                        {d.currency === "USDC" ? `$${parseFloat(d.amount || "0").toFixed(2)} USDC` : formatXLM(d.amountXLM || "0")}
                      </p>
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
              <p className="text-[#5a7a5a] dark:text-[#8aaa8a] mb-8 font-body">Save projects you&apos;re interested in to track their progress.</p>
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
