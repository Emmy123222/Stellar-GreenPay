/**
 * pages/projects/[id].tsx — Single project detail + donate
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import DonateForm from "@/components/DonateForm";
import DonationFeed from "@/components/DonationFeed";
import WalletConnect from "@/components/WalletConnect";
import { fetchProject, fetchProjectUpdates } from "@/lib/api";
import { formatXLM, formatCO2, progressPercent, timeAgo, statusClass, statusLabel, CATEGORY_ICONS, copyToClipboard } from "@/utils/format";
import { accountUrl } from "@/lib/stellar";
import type { ClimateProject, ProjectUpdate } from "@/utils/types";

interface ProjectDetailProps { publicKey: string | null; onConnect: (pk: string) => void; }

export default function ProjectDetail({ publicKey, onConnect }: ProjectDetailProps) {
  const router = useRouter();
  const { id } = router.query;

  const [project,   setProject]   = useState<ClimateProject | null>(null);
  const [updates,   setUpdates]   = useState<ProjectUpdate[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

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

  if (loading || !project) return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
      <div className="h-8 bg-forest-200 rounded w-2/3 mb-4"/>
      <div className="card space-y-4">
        {[1,2,3].map(i=><div key={i} className="h-4 bg-forest-100 rounded"/>)}
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
                  {project.verified && <span className="badge-verified text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-body">✓ Verified</span>}
                  <span className="text-xs text-[#8aaa8a] bg-forest-50 px-2.5 py-1 rounded-full border border-forest-100 font-body">{project.category}</span>
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
                {project.walletAddress.slice(0,8)}...{project.walletAddress.slice(-6)} ↗
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
            <DonationFeed projectId={project.id} refreshKey={refreshKey} />
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
            <button
              onClick={() => navigator.clipboard?.writeText(window.location.href)}
              className="btn-secondary text-sm py-2 px-4 w-full">
              Copy Project Link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
