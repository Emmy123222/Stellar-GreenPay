/**
 * pages/projects/[id].tsx — Single project detail + donate
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import DonateForm from "@/components/DonateForm";
import DonationFeed from "@/components/DonationFeed";
import WalletConnect from "@/components/WalletConnect";
import CircularProgress from "@/components/CircularProgress";
import { fetchProject, fetchProjectUpdates, subscribeToProject } from "@/lib/api";
import { formatXLM, formatCO2, progressPercent, timeAgo, statusClass, statusLabel, CATEGORY_ICONS, copyToClipboard } from "@/utils/format";
import { accountUrl } from "@/lib/stellar";
import { markMonthlySubscriptionPaid } from "@/lib/monthlyGiving";
import type {
  ClimateProject,
  ProjectCampaign,
  ProjectUpdate,
} from "@/utils/types";
import { useWishlist } from "@/hooks/useWishlist";

interface ProjectDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function ProjectDetail({
  publicKey,
  onConnect,
}: ProjectDetailProps) {
  const router = useRouter();
  const { id } = router.query;

  const [project, setProject] = useState<ClimateProject | null>(null);
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const [subEmail, setSubEmail] = useState("");
  const [subState, setSubState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [subError, setSubError] = useState<string | null>(null);
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [showMonthlySetup, setShowMonthlySetup] = useState(false);
  const [countdownNow, setCountdownNow] = useState(Date.now());
  const [campaignForm, setCampaignForm] = useState({
    title: "",
    goalXLM: "",
    deadline: "",
    description: "",
  });
  const [campaignState, setCampaignState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [campaignError, setCampaignError] = useState<string | null>(null);

  const { toggleWishlist, isInWishlist } = useWishlist();
  const prefillAmount =
    typeof router.query.amount === "string" ? router.query.amount : undefined;
  const monthlySubId =
    typeof router.query.monthlySubId === "string"
      ? router.query.monthlySubId
      : null;

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchProject(id as string), fetchProjectUpdates(id as string)])
      .then(([p, u]) => {
        setProject(p);
        setUpdates(u);
      })
      .catch(() => router.push("/projects"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetchSubscriberCount(id as string)
      .then(setSubscriberCount)
      .catch(() => null);
  }, [id]);

  useEffect(() => {
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleCopyWallet = async () => {
    if (!project) return;
    const success = await copyToClipboard(project.walletAddress);
    if (success) {
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } else {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2000);
    }
  };

  const handleShare = async () => {
    if (!project) return;

    const shareData = {
      title: `${project.name} - Stellar GreenPay`,
      text: `Support ${project.name} on Stellar GreenPay - ${project.description.slice(0, 100)}...`,
      url: window.location.href,
    };

    // Try Web Share API first (mobile)
    if (
      navigator.share &&
      /mobile|android|iphone|ipad/i.test(navigator.userAgent)
    ) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        // User cancelled or share failed, fall back to clipboard
        if ((err as Error).name === "AbortError") return;
      }
    }

    // Fallback to clipboard copy
    const success = await copyToClipboard(window.location.href);
    if (success) {
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 2000);
    }
  };

  const handlePrintReport = () => {
    if (!project) return;

    const pct = progressPercent(project.raisedXLM, project.goalXLM);
    const reportDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Create print window content
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${project.name} - Impact Report</title>
          <style>
            @media print {
              @page { margin: 0.75in; }
              body { margin: 0; }
            }
            
            * { box-sizing: border-box; }
            
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #1a2e1a;
              max-width: 800px;
              margin: 0 auto;
              padding: 40px 20px;
              background: white;
            }
            
            .header {
              text-align: center;
              margin-bottom: 40px;
              padding-bottom: 30px;
              border-bottom: 3px solid #227239;
            }
            
            .logo {
              font-size: 48px;
              margin-bottom: 10px;
            }
            
            .header h1 {
              font-size: 28px;
              color: #227239;
              margin: 0 0 10px 0;
              font-weight: 700;
            }
            
            .header .subtitle {
              font-size: 14px;
              color: #5a7a5a;
              text-transform: uppercase;
              letter-spacing: 2px;
              font-weight: 600;
            }
            
            .project-header {
              margin-bottom: 30px;
            }
            
            .project-title {
              font-size: 32px;
              color: #1a2e1a;
              margin: 0 0 10px 0;
              font-weight: 700;
            }
            
            .project-meta {
              display: flex;
              gap: 20px;
              flex-wrap: wrap;
              font-size: 14px;
              color: #5a7a5a;
              margin-bottom: 20px;
            }
            
            .project-meta span {
              display: inline-flex;
              align-items: center;
              gap: 5px;
            }
            
            .badges {
              display: flex;
              gap: 10px;
              flex-wrap: wrap;
              margin-bottom: 20px;
            }
            
            .badge {
              display: inline-block;
              padding: 6px 12px;
              border-radius: 20px;
              font-size: 12px;
              font-weight: 600;
              border: 2px solid;
            }
            
            .badge-verified {
              background: #e8f5e9;
              color: #2e7d32;
              border-color: #4caf50;
            }
            
            .badge-funded {
              background: #e8f5e9;
              color: #1b5e20;
              border-color: #4caf50;
            }
            
            .badge-category {
              background: #f0f7f0;
              color: #227239;
              border-color: #c8dfc8;
            }
            
            .section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }
            
            .section-title {
              font-size: 20px;
              color: #227239;
              margin: 0 0 15px 0;
              font-weight: 700;
              border-bottom: 2px solid #e8f3e8;
              padding-bottom: 8px;
            }
            
            .description {
              font-size: 15px;
              line-height: 1.8;
              color: #1a2e1a;
              white-space: pre-wrap;
            }
            
            .stats-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
              margin-bottom: 30px;
            }
            
            .stat-card {
              background: #f0f7f0;
              border: 2px solid #c8dfc8;
              border-radius: 12px;
              padding: 20px;
              text-align: center;
            }
            
            .stat-icon {
              font-size: 32px;
              margin-bottom: 8px;
            }
            
            .stat-value {
              font-size: 24px;
              font-weight: 700;
              color: #227239;
              margin-bottom: 5px;
            }
            
            .stat-label {
              font-size: 13px;
              color: #5a7a5a;
              text-transform: uppercase;
              letter-spacing: 1px;
              font-weight: 600;
            }
            
            .progress-section {
              background: #f0f7f0;
              border: 2px solid #c8dfc8;
              border-radius: 12px;
              padding: 25px;
              margin-bottom: 30px;
            }
            
            .progress-header {
              display: flex;
              justify-content: space-between;
              margin-bottom: 12px;
              font-size: 14px;
              font-weight: 600;
            }
            
            .progress-bar {
              height: 24px;
              background: #c8dfc8;
              border-radius: 12px;
              overflow: hidden;
              position: relative;
            }
            
            .progress-fill {
              height: 100%;
              background: linear-gradient(90deg, #227239, #4caf70);
              border-radius: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-weight: 700;
              font-size: 13px;
            }
            
            .updates-list {
              list-style: none;
              padding: 0;
              margin: 0;
            }
            
            .update-item {
              padding: 15px 0;
              border-bottom: 1px solid #e8f3e8;
            }
            
            .update-item:last-child {
              border-bottom: none;
            }
            
            .update-title {
              font-weight: 600;
              color: #1a2e1a;
              margin-bottom: 5px;
            }
            
            .update-date {
              font-size: 12px;
              color: #8aaa8a;
              margin-bottom: 8px;
            }
            
            .update-body {
              font-size: 14px;
              color: #5a7a5a;
              line-height: 1.6;
            }
            
            .footer {
              margin-top: 50px;
              padding-top: 30px;
              border-top: 2px solid #e8f3e8;
              text-align: center;
              font-size: 12px;
              color: #8aaa8a;
            }
            
            .footer-logo {
              font-size: 24px;
              margin-bottom: 10px;
            }
            
            .wallet-address {
              font-family: 'Courier New', monospace;
              background: #f0f7f0;
              padding: 8px 12px;
              border-radius: 6px;
              font-size: 11px;
              color: #227239;
              border: 1px solid #c8dfc8;
              word-break: break-all;
            }
            
            @media print {
              body { font-size: 12pt; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">🌱</div>
            <h1>Stellar GreenPay</h1>
            <div class="subtitle">Project Impact Report</div>
          </div>
          
          <div class="project-header">
            <h2 class="project-title">${project.name}</h2>
            <div class="project-meta">
              <span>📍 ${project.location}</span>
              <span>📅 Report Date: ${reportDate}</span>
            </div>
            <div class="badges">
              ${project.verified ? '<span class="badge badge-verified">✓ Verified Project</span>' : ""}
              ${pct >= 100 ? '<span class="badge badge-funded">✅ Fully Funded</span>' : ""}
              <span class="badge badge-category">${project.category}</span>
            </div>
          </div>
          
          <div class="section">
            <h3 class="section-title">Project Overview</h3>
            <div class="description">${project.description}</div>
          </div>
          
          <div class="section">
            <h3 class="section-title">Impact Metrics</h3>
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-icon">💰</div>
                <div class="stat-value">${formatXLM(project.raisedXLM)}</div>
                <div class="stat-label">Total Raised</div>
              </div>
              <div class="stat-card">
                <div class="stat-icon">🎯</div>
                <div class="stat-value">${formatXLM(project.goalXLM)}</div>
                <div class="stat-label">Funding Goal</div>
              </div>
              <div class="stat-card">
                <div class="stat-icon">👥</div>
                <div class="stat-value">${project.donorCount.toLocaleString()}</div>
                <div class="stat-label">Total Donors</div>
              </div>
              <div class="stat-card">
                <div class="stat-icon">♻️</div>
                <div class="stat-value">${formatCO2(project.co2OffsetKg)}</div>
                <div class="stat-label">CO₂ Offset</div>
              </div>
            </div>
          </div>
          
          <div class="section">
            <h3 class="section-title">Funding Progress</h3>
            <div class="progress-section">
              <div class="progress-header">
                <span>${formatXLM(project.raisedXLM)} raised</span>
                <span>${pct}% of goal</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${Math.min(pct, 100)}%">
                  ${pct >= 100 ? "Goal Reached!" : `${pct}%`}
                </div>
              </div>
            </div>
          </div>
          
          ${
            updates.length > 0
              ? `
          <div class="section">
            <h3 class="section-title">Recent Project Updates</h3>
            <ul class="updates-list">
              ${updates
                .slice(0, 5)
                .map(
                  (update) => `
                <li class="update-item">
                  <div class="update-title">${update.title}</div>
                  <div class="update-date">${new Date(update.createdAt).toLocaleDateString()}</div>
                  <div class="update-body">${update.body}</div>
                </li>
              `,
                )
                .join("")}
            </ul>
          </div>
          `
              : ""
          }
          
          <div class="section">
            <h3 class="section-title">Project Wallet</h3>
            <p style="margin-bottom: 10px; font-size: 14px; color: #5a7a5a;">
              All donations are sent directly to this Stellar blockchain address:
            </p>
            <div class="wallet-address">${project.walletAddress}</div>
          </div>
          
          <div class="footer">
            <div class="footer-logo">🌍</div>
            <p>
              <strong>Stellar GreenPay</strong><br>
              Blockchain-powered climate finance<br>
              Open Source • Built on Stellar • Powered by Soroban
            </p>
            <p style="margin-top: 15px;">
              Learn more at stellar-greenpay.org
            </p>
          </div>
        </body>
      </html>
    `;

    // Open print window
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      // Small delay to ensure content is loaded before printing
      setTimeout(() => {
        printWindow.print();
      }, 250);
    }
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !subEmail) return;
    setSubState("loading");
    setSubError(null);
    try {
      await subscribeToProject({
        projectId: project.id,
        email: subEmail,
        donorAddress: publicKey || undefined,
      });
      setSubState("success");
      setSubEmail("");
      setSubscriberCount((c) => (c !== null ? c + 1 : null));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      setSubError(msg || "Could not subscribe. Try again.");
      setSubState("error");
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setCampaignState("saving");
    setCampaignError(null);
    try {
      await createProjectCampaign(project.id, campaignForm);
      const updatedProject = await fetchProject(project.id);
      setProject(updatedProject);
      setCampaignForm({
        title: "",
        goalXLM: "",
        deadline: "",
        description: "",
      });
      setCampaignState("success");
      window.setTimeout(() => setCampaignState("idle"), 2000);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      setCampaignError(message || "Could not create campaign.");
      setCampaignState("error");
    }
  };

  if (loading || !project)
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
        <div className="h-8 bg-forest-200 rounded w-2/3 mb-4" />
        <div className="card space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-forest-100 rounded" />
          ))}
        </div>
      </div>
    );

  const pct = progressPercent(project.raisedXLM, project.goalXLM);
  const isComplete = pct >= 100;
  const campaigns = project.campaigns || [];
  const activeCampaign =
    project.activeCampaign ||
    campaigns.find((campaign) => campaign.active) ||
    null;
  const completedCampaigns = campaigns.filter((campaign) => campaign.completed);

  const countdownText = activeCampaign
    ? formatCountdown(activeCampaign.deadline, countdownNow)
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {isComplete && (
        <div className="celebration-overlay">
          {Array.from({ length: 50 }).map((_, i) => (
            <div
              key={i}
              className={
                i % 2 === 0 ? "celebration-leaf" : "celebration-confetti"
              }
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 3}s`,
                animationDuration: `${3 + Math.random() * 2}s`,
              }}
            />
          ))}
        </div>
      )}

      <Link
        href="/projects"
        className="inline-flex items-center gap-1 text-sm text-[#5a7a5a] hover:text-forest-700 transition-colors mb-6 font-body"
      >
        ← Back to Projects
      </Link>

      {/* Celebration Banner */}
      {isComplete && (
        <div className="celebration-banner mb-6 bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500 text-white rounded-2xl p-8 text-center shadow-2xl border-4 border-white relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
          <div className="relative z-10">
            <div className="text-6xl mb-4 animate-bounce">🎉</div>
            <h2 className="font-display text-3xl sm:text-4xl font-bold mb-3">
              Fully Funded!
            </h2>
            <p className="text-lg sm:text-xl text-white/90 max-w-2xl mx-auto font-body">
              This project has reached its funding goal! Thank you to all{" "}
              {project.donorCount.toLocaleString()} donors who made this
              possible.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-6 py-3 rounded-full border border-white/30">
              <span className="text-2xl">✅</span>
              <span className="font-semibold text-lg">
                {formatXLM(project.raisedXLM)} raised of{" "}
                {formatXLM(project.goalXLM)} goal
              </span>
            </div>
          </div>
        </div>
      )}

      {activeCampaign && (
        <div className="card mb-6 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest font-bold text-amber-700 font-body mb-1">
                Active Campaign
              </p>
              <h2 className="font-display text-xl font-semibold text-amber-900">
                {activeCampaign.title}
              </h2>
              {activeCampaign.description && (
                <p className="text-sm text-amber-800 font-body mt-1">
                  {activeCampaign.description}
                </p>
              )}
            </div>
            <p className="text-xs px-3 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-800 font-body">
              Ends in {countdownText}
            </p>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs mb-1 font-body text-amber-800">
              <span>{formatXLM(activeCampaign.raisedXLM)} raised</span>
              <span>
                {activeCampaign.progressPercent}% of{" "}
                {formatXLM(activeCampaign.goalXLM)}
              </span>
            </div>
            <div className="progress-bar h-2.5">
              <div
                className="progress-fill"
                style={{
                  width: `${Math.min(activeCampaign.progressPercent, 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

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
                  {isComplete ? (
                    <span className="badge text-xs px-3 py-1.5 rounded-full bg-gradient-to-r from-green-500 to-emerald-600 text-white border-2 border-white shadow-lg font-body font-bold animate-pulse">
                      ✅ Fully Funded
                    </span>
                  ) : (
                    <span className={statusClass(project.status)}>
                      {statusLabel(project.status)}
                    </span>
                  )}
                  {project.onChainVerified ? (
                    <span className="badge-verified text-xs px-2.5 py-1 rounded-full bg-forest-100 text-forest-800 border border-forest-300 font-body font-bold shadow-sm">
                      On-chain verified ✓
                    </span>
                  ) : project.verified ? (
                    <span className="badge-verified text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-body">
                      ✓ Verified
                    </span>
                  ) : null}
                  <span className="text-xs text-[#8aaa8a] bg-forest-50 px-2.5 py-1 rounded-full border border-forest-100 font-body">
                    {project.category}
                  </span>
                  <button
                    onClick={handleShare}
                    className="btn-secondary text-xs py-1 px-3 ml-auto"
                    title="Share this project"
                  >
                    {shareState === "copied" ? "✓ Link copied!" : "Share 🌍"}
                  </button>
                  <button
                    onClick={() => toggleWishlist(project.id)}
                    className={`p-2 rounded-lg border transition-all duration-300 transform active:scale-90 
                      ${
                        isInWishlist(project.id)
                          ? "bg-red-50 text-red-500 border-red-200"
                          : "bg-forest-50 text-forest-300 border-forest-200 hover:text-red-400 hover:border-red-200"
                      }`}
                    title={
                      isInWishlist(project.id)
                        ? "Remove from wishlist"
                        : "Add to wishlist"
                    }
                  >
                    <svg
                      className={`w-5 h-5 ${isInWishlist(project.id) ? "fill-current" : "fill-none"}`}
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                      />
                    </svg>
                  </button>
                </div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-forest-900">
                  {project.name}
                </h1>
                <p className="text-[#5a7a5a] text-sm mt-1 font-body">
                  📍 {project.location}
                </p>
              </div>
            </div>

            {/* Progress */}
            <div className="mb-5">
              {isComplete ? (
                <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-5 py-4 rounded-xl text-center font-semibold text-lg shadow-lg">
                  🎉 Goal Reached!
                </div>
              ) : (
                <div className="flex items-center gap-5">
                  <CircularProgress percentage={pct} size={64} strokeWidth={6} />
                  <div className="flex-1">
                    <p className="font-semibold text-forest-800 text-lg">{formatXLM(project.raisedXLM)} raised</p>
                    <p className="text-[#5a7a5a] text-sm font-body mt-0.5">towards {formatXLM(project.goalXLM)} goal</p>
                  </div>
                </div>
              )}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  icon: "👥",
                  label: "Donors",
                  value: project.donorCount.toString(),
                },
                {
                  icon: "♻️",
                  label: "CO₂ Offset",
                  value: formatCO2(project.co2OffsetKg),
                },
                {
                  icon: "🎯",
                  label: "Goal",
                  value: formatXLM(project.goalXLM),
                },
              ].map((s) => (
                <div key={s.label} className="stat-card text-center">
                  <p className="text-lg mb-1">{s.icon}</p>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <p className="font-semibold text-forest-900 text-sm font-body">
                      {s.value}
                    </p>
                    {s.label === "CO₂ Offset" && (
                      <span
                        className="tooltip"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                      >
                        <button
                          type="button"
                          className="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-forest-100 text-[8px] text-forest-600 border border-forest-200 hover:bg-forest-200 transition-colors focus:outline-none focus:ring-1 focus:ring-forest-400"
                          aria-label="CO2 offset estimate methodology info"
                        >
                          ℹ️
                        </button>
                        <span className="tooltip-text" role="tooltip">
                          Estimated CO₂ offset based on this project's declared
                          impact rate per XLM donated. Actual results may vary.
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
              <a
                href={accountUrl(project.walletAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="address-tag hover:border-forest-300 transition-colors"
              >
                {project.walletAddress.slice(0, 8)}...
                {project.walletAddress.slice(-6)} ↗
              </a>
              <button
                onClick={handleCopyWallet}
                className="ml-1 p-1.5 rounded hover:bg-forest-100 transition-colors focus:outline-none focus:ring-2 focus:ring-forest-300"
                title="Copy wallet address"
                aria-label="Copy wallet address to clipboard"
              >
                {copyState === "copied" ? (
                  <span className="flex items-center gap-1 text-green-600 font-semibold">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Copied!
                  </span>
                ) : copyState === "error" ? (
                  <span className="flex items-center gap-1 text-red-600 text-xs">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </span>
                ) : (
                  <svg
                    className="w-4 h-4 text-[#8aaa8a] hover:text-forest-700"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-forest-900 mb-3">
              About this Project
            </h2>
            <p className="text-[#5a7a5a] leading-relaxed text-sm whitespace-pre-wrap font-body">
              {project.description}
            </p>
            {project.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {project.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs bg-forest-50 text-forest-700 border border-forest-200 px-2.5 py-1 rounded-full font-body"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {completedCampaigns.length > 0 && (
            <div className="card">
              <h2 className="font-display text-lg font-semibold text-forest-900 mb-4">
                Campaign History
              </h2>
              <div className="space-y-3">
                {completedCampaigns.map((campaign: ProjectCampaign) => (
                  <div
                    key={campaign.id}
                    className="rounded-xl border border-forest-200 bg-forest-50 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <p className="font-semibold text-forest-900 font-body">
                        {campaign.title}
                      </p>
                      <span className="text-xs px-2 py-1 rounded-full bg-forest-100 border border-forest-200 text-forest-700 font-body">
                        Completed
                      </span>
                    </div>
                    <p className="text-xs text-[#5a7a5a] font-body mb-2">
                      Ended {new Date(campaign.deadline).toLocaleDateString()}
                    </p>
                    <div className="flex justify-between text-xs mb-1 font-body">
                      <span>{formatXLM(campaign.raisedXLM)} raised</span>
                      <span>
                        {campaign.progressPercent}% of{" "}
                        {formatXLM(campaign.goalXLM)}
                      </span>
                    </div>
                    <div className="progress-bar h-2">
                      <div
                        className="progress-fill progress-fill-complete"
                        style={{
                          width: `${Math.min(campaign.progressPercent, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card bg-forest-50 border-forest-200">
            <h2 className="font-display text-lg font-semibold text-forest-900 mb-2">
              Campaign Creator
            </h2>
            <p className="text-xs text-[#5a7a5a] font-body mb-4">
              Project admins can launch a time-limited campaign with a custom
              goal and deadline.
            </p>
            <form onSubmit={handleCreateCampaign} className="space-y-3">
              <input
                type="text"
                required
                placeholder="Campaign title"
                value={campaignForm.title}
                onChange={(e) =>
                  setCampaignForm((prev) => ({
                    ...prev,
                    title: e.target.value,
                  }))
                }
                className="input-field"
              />
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  type="number"
                  required
                  min="1"
                  step="1"
                  placeholder="Goal (XLM)"
                  value={campaignForm.goalXLM}
                  onChange={(e) =>
                    setCampaignForm((prev) => ({
                      ...prev,
                      goalXLM: e.target.value,
                    }))
                  }
                  className="input-field"
                />
                <input
                  type="datetime-local"
                  required
                  value={campaignForm.deadline}
                  onChange={(e) =>
                    setCampaignForm((prev) => ({
                      ...prev,
                      deadline: e.target.value,
                    }))
                  }
                  className="input-field"
                />
              </div>
              <textarea
                placeholder="Description (optional)"
                value={campaignForm.description}
                onChange={(e) =>
                  setCampaignForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                className="input-field min-h-24"
              />
              {campaignError && (
                <p className="text-xs text-red-600 font-body">
                  {campaignError}
                </p>
              )}
              <button
                type="submit"
                disabled={campaignState === "saving"}
                className="btn-primary text-sm py-2 px-4"
              >
                {campaignState === "saving"
                  ? "Saving..."
                  : campaignState === "success"
                    ? "Campaign Created"
                    : "Create Campaign"}
              </button>
            </form>
          </div>

          {/* Project updates */}
          {updates.length > 0 && (
            <div className="card">
              <h2 className="font-display text-lg font-semibold text-forest-900 mb-4">
                Project Updates
              </h2>
              <div className="space-y-4">
                {updates.map((u) => (
                  <div
                    key={u.id}
                    className="pb-4 border-b border-forest-100 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-forest-900 text-sm font-body">
                        {u.title}
                      </h3>
                      <span className="text-xs text-[#8aaa8a] font-body">
                        {timeAgo(u.createdAt)}
                      </span>
                    </div>
                    <p className="text-[#5a7a5a] text-sm leading-relaxed font-body">
                      {u.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Donation feed */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-forest-900 mb-4">
              Recent Donations
            </h2>
            <DonationFeed
              projectId={project.id}
              walletAddress={project.walletAddress}
              refreshKey={refreshKey}
            />
          </div>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setShowMonthlySetup(true)}
            className="btn-secondary w-full text-sm py-2.5 px-4"
          >
            Give Monthly
          </button>

          {publicKey ? (
            <DonateForm
              project={project}
              publicKey={publicKey}
              initialAmount={prefillAmount}
              onSuccess={() => {
                if (monthlySubId && prefillAmount) {
                  const parsedPrefillAmount = Number.parseFloat(prefillAmount);
                  if (
                    Number.isFinite(parsedPrefillAmount) &&
                    parsedPrefillAmount > 0
                  ) {
                    markMonthlySubscriptionPaid(
                      monthlySubId,
                      parsedPrefillAmount.toFixed(7),
                    );
                  }
                }
                setRefreshKey((k) => k + 1);
                setTimeout(
                  () => fetchProject(project.id).then(setProject),
                  2000,
                );
              }}
            />
          ) : (
            <div>
              <p className="text-center text-[#5a7a5a] text-sm mb-4 font-body">
                Connect your wallet to donate
              </p>
              <WalletConnect onConnect={onConnect} />
            </div>
          )}

          {/* Share card */}
          <div className="card text-center bg-forest-50 border-forest-200">
            <p className="font-display font-semibold text-forest-900 mb-2">
              Spread the word 🌍
            </p>
            <p className="text-xs text-[#5a7a5a] mb-3 font-body">
              Share this project with friends and family to increase its impact.
            </p>
            <button
              onClick={() =>
                navigator.clipboard?.writeText(window.location.href)
              }
              className="btn-secondary text-sm py-2 px-4 w-full"
            >
              Copy Project Link
            </button>
            <Link
              href={`/donate/${project.id}`}
              className="btn-secondary text-sm py-2 px-4 w-full mt-2 inline-flex items-center justify-center gap-2"
            >
              📱 Generate Donation QR
            </Link>
          </div>

          {/* Impact Report card */}
          <div className="card text-center bg-forest-50 border-forest-200">
            <p className="font-display font-semibold text-forest-900 mb-2">
              Impact Report 📊
            </p>
            <p className="text-xs text-[#5a7a5a] mb-3 font-body">
              Download a print-friendly summary of this project's progress and
              impact.
            </p>
            <button
              onClick={handlePrintReport}
              className="btn-primary text-sm py-2 px-4 w-full inline-flex items-center justify-center gap-2"
            >
              📄 Download Report
            </button>
          </div>

          {/* Subscribe card */}
          <div className="card bg-forest-50 border-forest-200">
            <p className="font-display font-semibold text-forest-900 mb-1">
              Get project updates 🔔
            </p>
            <p className="text-xs text-[#5a7a5a] mb-3 font-body">
              Receive an email when this project posts new updates.
            </p>
            {subscriberCount !== null && (
              <p className="text-xs text-[#8aaa8a] font-body mb-3">
                📬 {subscriberCount.toLocaleString()}{" "}
                {subscriberCount === 1 ? "subscriber" : "subscribers"}
              </p>
            )}
            {subState === "success" ? (
              <p className="text-sm text-green-700 font-body text-center py-2 font-semibold">
                ✓ Thank you for subscribing!
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
                  disabled={subState === "loading"}
                  className="btn-primary text-sm py-2 px-4 w-full disabled:opacity-60"
                >
                  {subState === "loading" ? "Subscribing…" : "Subscribe"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {showMonthlySetup && (
        <MonthlyGivingSetup
          projectId={project.id}
          projectName={project.name}
          onClose={() => setShowMonthlySetup(false)}
        />
      )}
    </div>
  );
}

function formatCountdown(deadline: string, nowMs: number) {
  const deltaMs = new Date(deadline).getTime() - nowMs;
  if (deltaMs <= 0) return "0h 0m 0s";

  const totalSeconds = Math.floor(deltaMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${hours}h ${minutes}m ${seconds}s`;
}
