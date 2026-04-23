/**
 * pages/projects/[id].tsx — Single project detail + donate
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import DonateForm from "@/components/DonateForm";
import DonationFeed from "@/components/DonationFeed";
import WalletConnect from "@/components/WalletConnect";
import { fetchProject, fetchProjectUpdates, subscribeToProject } from "@/lib/api";
import { formatXLM, formatCO2, progressPercent, timeAgo, statusClass, statusLabel, CATEGORY_ICONS, copyToClipboard } from "@/utils/format";
import { accountUrl } from "@/lib/stellar";
import type { ClimateProject, ProjectUpdate } from "@/utils/types";

interface ProjectDetailProps { publicKey: string | null; onConnect: (pk: string) => void; }

export default function ProjectDetail({ publicKey, onConnect }: ProjectDetailProps) {
  const router = useRouter();
  const { id } = router.query;

  const [project, setProject] = useState<ClimateProject | null>(null);
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
  const [shareCount, setShareCount] = useState<number>(0);
  const [subEmail, setSubEmail] = useState("");
  const [subState, setSubState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [subError, setSubError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchProject(id as string), fetchProjectUpdates(id as string)])
      .then(([p, u]) => { setProject(p); setUpdates(u); })
      .catch(() => router.push("/projects"))
      .finally(() => setLoading(false));
  }, [id]);

  const handleCopyWallet = async () => {
    if (!project) return;
    const success = await copyToClipboard(project.walletAddress);
    if (success) {
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } else {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  const incrementShare = () => setShareCount(prev => prev + 1);

  const handleTwitterShare = () => {
    if (!project) return;
    incrementShare();
    const text = `I just donated to ${project.name} on Stellar GreenPay!`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.href)}`, '_blank');
  };

  const handleWhatsappShare = () => {
    if (!project) return;
    incrementShare();
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(window.location.href)}`, '_blank');
  };

  const handleCopyLink = async () => {
    if (!project) return;
    incrementShare();

    const shareData = {
      title: `${project.name} - Stellar GreenPay`,
      text: `Support ${project.name} on Stellar GreenPay - ${project.description.slice(0, 100)}...`,
      url: window.location.href,
    };

    // Try Web Share API first (mobile)
    if (navigator.share && /mobile|android|iphone|ipad/i.test(navigator.userAgent)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        // User cancelled or share failed, fall back to clipboard
        if ((err as Error).name === 'AbortError') return;
      }
    }

    // Fallback to clipboard copy
    const success = await copyToClipboard(window.location.href);
    if (success) {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2000);
    }
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !subEmail) return;
    setSubState('loading');
    setSubError(null);
    try {
      await subscribeToProject({
        projectId: project.id,
        email: subEmail,
        donorAddress: publicKey || undefined,
      });
      setSubState('success');
      setSubEmail("");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSubError(msg || "Could not subscribe. Try again.");
      setSubState('error');
    }
  };

  if (loading || !project) return (    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
      <div className="h-8 bg-forest-200 rounded w-2/3 mb-4" />
      <div className="card space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="h-4 bg-forest-100 rounded" />)}
      </div>
    </div>
  );

  const pct = progressPercent(project.raisedXLM, project.goalXLM);
  const isComplete = pct >= 100;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {isComplete && (
        <div className="celebration-overlay">
          {Array.from({ length: 30 }).map((_, i) => (
            <div
              key={i}
              className={i % 2 === 0 ? "celebration-leaf" : "celebration-confetti"}
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${3 + Math.random() * 2}s`,
              }}
            />
          ))}
        </div>
      )}

      <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-[#5a7a5a] hover:text-forest-700 transition-colors mb-6 font-body">
        ← Back to Projects
      </Link>

      <div className="grid lg:grid-cols-3 gap-6">

        {/* ── Main content ────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Header card */}
          <div className="card">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-forest-100 flex items-center justify-center text-3xl border border-forest-200 flex-shrink-0">
                {CATEGORY_ICONS[project.category] || "🌿"}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className={statusClass(project.status)}>{statusLabel(project.status)}</span>
                  {project.onChainVerified ? (
                    <span className="badge-verified text-xs px-2.5 py-1 rounded-full bg-forest-100 text-forest-800 border border-forest-300 font-body font-bold shadow-sm">
                      On-chain verified ✓
                    </span>
                  ) : project.verified ? (
                    <span className="badge-verified text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-body">
                      ✓ Verified
                    </span>
                  ) : null}
                  <span className="text-xs text-[#8aaa8a] bg-forest-50 px-2.5 py-1 rounded-full border border-forest-100 font-body">{project.category}</span>
                  <button
                    onClick={handleCopyLink}
                    className="btn-secondary text-xs py-1 px-3 ml-auto"
                    title="Share this project"
                  >
                    {shareState === 'copied' ? '✓ Link copied!' : 'Share 🌍'}
                  </button>
                </div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-forest-900">{project.name}</h1>
                <p className="text-[#5a7a5a] text-sm mt-1 font-body">📍 {project.location}</p>
              </div>
            </div>

            {/* Progress */}
            <div className="mb-5">
              {isComplete ? (
                <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-5 py-4 rounded-xl text-center font-semibold text-lg shadow-lg">
                  🎉 Goal Reached!
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-sm mb-2 font-body">
                    <span className="font-semibold text-forest-700">{formatXLM(project.raisedXLM)} raised</span>
                    <span className="text-[#5a7a5a]">{pct}% of {formatXLM(project.goalXLM)} goal</span>
                  </div>
                  <div className="progress-bar h-3">
                    <div className={pct >= 100 ? "progress-fill progress-fill-complete" : "progress-fill"} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </>
              )}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: "👥", label: "Donors", value: project.donorCount.toString() },
                { icon: "♻️", label: "CO₂ Offset", value: formatCO2(project.co2OffsetKg) },
                { icon: "🎯", label: "Goal", value: formatXLM(project.goalXLM) },
              ].map(s => (
                <div key={s.label} className="stat-card text-center">
                  <p className="text-lg mb-1">{s.icon}</p>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <p className="font-semibold text-forest-900 text-sm font-body">{s.value}</p>
                    {s.label === "CO₂ Offset" && (
                      <span className="tooltip" onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                        <button
                          type="button"
                          className="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-forest-100 text-[8px] text-forest-600 border border-forest-200 hover:bg-forest-200 transition-colors focus:outline-none focus:ring-1 focus:ring-forest-400"
                          aria-label="CO2 offset estimate methodology info"
                        >
                          ℹ️
                        </button>
                        <span className="tooltip-text" role="tooltip">
                          Estimated CO₂ offset based on this project's declared impact rate per XLM donated. Actual results may vary.
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#8aaa8a] font-body">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Wallet link */}
            <div className="mt-4 pt-4 border-t border-forest-100 flex items-center gap-2 text-xs text-[#8aaa8a] font-body">
              <span>Project wallet:</span>
              <a href={accountUrl(project.walletAddress)} target="_blank" rel="noopener noreferrer"
                className="address-tag hover:border-forest-300 transition-colors">
                {project.walletAddress.slice(0, 8)}...{project.walletAddress.slice(-6)} ↗
              </a>
              <button
                onClick={handleCopyWallet}
                className="ml-1 p-1.5 rounded hover:bg-forest-100 transition-colors focus:outline-none focus:ring-2 focus:ring-forest-300"
                title="Copy wallet address"
                aria-label="Copy wallet address to clipboard"
              >
                {copyState === 'copied' ? (
                  <span className="flex items-center gap-1 text-green-600 font-semibold">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </span>
                ) : copyState === 'error' ? (
                  <span className="flex items-center gap-1 text-red-600 text-xs">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                ) : (
                  <svg className="w-4 h-4 text-[#8aaa8a] hover:text-forest-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-forest-900 mb-3">About this Project</h2>
            <p className="text-[#5a7a5a] leading-relaxed text-sm whitespace-pre-wrap font-body">{project.description}</p>
            {project.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {project.tags.map(tag => (
                  <span key={tag} className="text-xs bg-forest-50 text-forest-700 border border-forest-200 px-2.5 py-1 rounded-full font-body">{tag}</span>
                ))}
              </div>
            )}
          </div>

          {/* Project updates */}
          {updates.length > 0 && (
            <div className="card">
              <h2 className="font-display text-lg font-semibold text-forest-900 mb-4">Project Updates</h2>
              <div className="space-y-4">
                {updates.map(u => (
                  <div key={u.id} className="pb-4 border-b border-forest-100 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-forest-900 text-sm font-body">{u.title}</h3>
                      <span className="text-xs text-[#8aaa8a] font-body">{timeAgo(u.createdAt)}</span>
                    </div>
                    <p className="text-[#5a7a5a] text-sm leading-relaxed font-body">{u.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Donation feed */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-forest-900 mb-4">Recent Donations</h2>
            <DonationFeed projectId={project.id} walletAddress={project.walletAddress} refreshKey={refreshKey} />
          </div>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div className="space-y-4">
          {publicKey ? (
            <DonateForm
              project={project}
              publicKey={publicKey}
              onSuccess={() => {
                setRefreshKey(k => k + 1);
                setTimeout(() => fetchProject(project.id).then(setProject), 2000);
              }}
            />
          ) : (
            <div>
              <p className="text-center text-[#5a7a5a] text-sm mb-4 font-body">Connect your wallet to donate</p>
              <WalletConnect onConnect={onConnect} />
            </div>
          )}

          {/* Share card */}
          <div className="card text-center bg-forest-50 border-forest-200">
            <p className="font-display font-semibold text-forest-900 mb-2">Spread the word 🌍</p>
            <p className="text-xs text-[#5a7a5a] mb-3 font-body">Share this project with friends and family to increase its impact.</p>
            
            <div className="grid grid-cols-3 gap-2 mb-3">
              <button
                onClick={handleTwitterShare}
                className="btn-secondary flex items-center justify-center py-2 px-0 text-[#1DA1F2] hover:bg-forest-100/50"
                title="Share on Twitter"
                aria-label="Share on Twitter"
              >
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/></svg>
              </button>
              <button
                onClick={handleWhatsappShare}
                className="btn-secondary flex items-center justify-center py-2 px-0 text-[#25D366] hover:bg-forest-100/50"
                title="Share on WhatsApp"
                aria-label="Share on WhatsApp"
              >
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
              </button>
              <button
                onClick={handleCopyLink}
                className="btn-secondary flex items-center justify-center py-2 px-0 text-forest-700 hover:bg-forest-100/50"
                title="Copy Link"
                aria-label="Copy Link"
              >
                {shareState === 'copied' ? '✓' : (
                   <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                )}
              </button>
            </div>
            {shareCount > 0 && <p className="text-xs text-forest-700 font-semibold mb-3">{shareCount} shares so far!</p>}

            <Link
              href={`/donate/${project.id}`}
              className="btn-secondary text-sm py-2 px-4 w-full mt-2 inline-flex items-center justify-center gap-2"
            >
              📱 Generate Donation QR
            </Link>
          </div>

          {/* Subscribe card */}
          <div className="card bg-forest-50 border-forest-200">
            <p className="font-display font-semibold text-forest-900 mb-1">Get project updates 🔔</p>
            <p className="text-xs text-[#5a7a5a] mb-3 font-body">
              Receive an email when this project posts new updates.
            </p>
            {subState === 'success' ? (
              <p className="text-sm text-green-700 font-body text-center py-2">
                ✓ You're subscribed!
              </p>
            ) : (
              <form onSubmit={handleSubscribe} className="space-y-2">
                <input
                  type="email"
                  required
                  placeholder="your@email.com"
                  value={subEmail}
                  onChange={(e) => setSubEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-forest-200 bg-white focus:outline-none focus:ring-2 focus:ring-forest-400 font-body"
                />
                {subError && (
                  <p className="text-xs text-red-600 font-body">{subError}</p>
                )}
                <button
                  type="submit"
                  disabled={subState === 'loading'}
                  className="btn-primary text-sm py-2 px-4 w-full disabled:opacity-60"
                >
                  {subState === 'loading' ? 'Subscribing…' : 'Subscribe'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
