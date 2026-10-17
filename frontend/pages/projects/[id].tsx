/**
 * pages/projects/[id].tsx — Single project detail + donate
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import ProjectHeadMeta from "@/components/ProjectHeadMeta";
import type { GetServerSideProps } from "next";
import Link from "next/link";
import DonateForm from "@/components/DonateForm";
import DonationFeed from "@/components/DonationFeed";
import ToastNotification, { type ToastItem } from "@/components/ToastNotification";
import WalletConnect from "@/components/WalletConnect";
import MonthlyGivingSetup from "@/components/MonthlyGivingSetup";
import DescriptionAccordion from "@/components/DescriptionAccordion";
import WalletAddressQRCode from "@/components/WalletAddressQRCode";
import ProjectProgressBar from "@/components/ProjectProgressBar";
import ShareButtons from "@/components/ShareButtons";
import ProjectCelebration from "@/components/ProjectCelebration";
import ProjectActiveCampaign from "@/components/ProjectActiveCampaign";
import ProjectMatchBanner from "@/components/ProjectMatchBanner";
import ProjectAiSummary from "@/components/ProjectAiSummary";
import ProjectAbout from "@/components/ProjectAbout";
import ProjectReviewsSection from "@/components/ProjectReviewsSection";
import ProjectMilestones from "@/components/ProjectMilestones";
import ProjectCampaigns from "@/components/ProjectCampaigns";
import ProjectUpdatesFeed from "@/components/ProjectUpdatesFeed";
import ProjectDiscussion from "@/components/ProjectDiscussion";
import ProjectImpactCalculator from "@/components/ProjectImpactCalculator";
import ProjectShareCard from "@/components/ProjectShareCard";
import ProjectReportCard from "@/components/ProjectReportCard";
import ProjectSubscribeCard from "@/components/ProjectSubscribeCard";
import ProjectComments from "@/components/ProjectComments";
import {
  fetchProject,
  fetchProjectUpdates,
  fetchProjectMatches,
  generateProjectSummary,
  toggleUpdateLike,
  followProject,
  unfollowProject,
} from "@/lib/api";
import {
  copyToClipboard,
  formatXLM,
  progressPercent,
  shortenAddress,
  CATEGORY_ICONS,
  statusClass,
  statusLabel,
  formatCO2,
  formatDate,
  timeAgo,
} from "@/utils/format";
import { accountUrl, fetchProjectDiscussion, type ProjectDiscussionMessage } from "@/lib/stellar";
import { markMonthlySubscriptionPaid } from "@/lib/monthlyGiving";
import { printProjectReport } from "@/utils/projectReport";
import { useWishlist } from "@/hooks/useWishlist";
import { useProjectShare } from "@/hooks/useProjectShare";
import { useProjectReviews } from "@/hooks/useProjectReviews";
import { useProjectBadges } from "@/hooks/useProjectBadges";
import type { ClimateProject, ProjectUpdate } from "@/utils/types";

interface ProjectDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
  ogProject?: {
    id?: string;
    name: string;
    description: string;
    imageUrl?: string;
    category: string;
    location: string;
  } | null;
}

export default function ProjectDetail({
  publicKey,
  onConnect,
  ogProject,
}: ProjectDetailProps) {
  const router = useRouter();
  const { id } = router.query;
  const projectId = typeof id === "string" ? id : undefined;

  const [project, setProject] = useState<ClimateProject | null>(null);
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [updateLikes, setUpdateLikes] = useState<Record<string, { liked: boolean; likeCount: number }>>({});
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [calcAmount, setCalcAmount] = useState<string>("50");
  const [showMonthlySetup, setShowMonthlySetup] = useState(false);
  const [discussion, setDiscussion] = useState<ProjectDiscussionMessage[]>([]);
  const [discussionLoadedFor, setDiscussionLoadedFor] = useState<string | null>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [aiSummaryState, setAiSummaryState] = useState<"idle" | "loading" | "error">("idle");
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followCount, setFollowCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  const [celebrationParticles] = useState(() =>
    Array.from({ length: 50 }).map(() => ({
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 3}s`,
      animationDuration: `${3 + Math.random() * 2}s`,
    }))
  );

  const { toggleWishlist, isInWishlist } = useWishlist();
  const {
    shareState,
    shareCount,
    handleTwitterShare,
    handleFacebookShare,
    handleWhatsappShare,
    handleCopyLink,
  } = useProjectShare(project);

  const {
    reviews,
    reviewsTotal,
    reviewsLoading,
    reviewsHasMore,
    loadingMoreReviews,
    handleLoadMoreReviews,
  } = useProjectReviews(projectId, refreshKey);

  useProjectBadges(projectId, (toast) => setToasts((prev) => [...prev, toast]));

  const prefillAmount =
    typeof router.query.amount === "string" ? router.query.amount : undefined;
  const monthlySubId =
    typeof router.query.monthlySubId === "string"
      ? router.query.monthlySubId
      : null;
  const prefillReplyMemo =
    typeof router.query.replyMemo === "string" ? router.query.replyMemo : undefined;

  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      fetchProject(projectId, publicKey ?? undefined),
      fetchProjectUpdates(projectId),
      fetchProjectMatches(projectId),
    ])
      .then(([p, u, m]) => {
        setProject(p);
        setUpdates(u);
        setMatches(m);
        setIsFollowing(p.isFollowing ?? false);
        setFollowCount(p.followCount ?? 0);
      })
      .catch(() => router.push("/projects"))
      .finally(() => setLoading(false));
  }, [projectId, publicKey, router]);

  const projectWalletAddress = project?.walletAddress;
  const discussionLoading = Boolean(project) && discussionLoadedFor !== projectWalletAddress;

  useEffect(() => {
    if (!projectWalletAddress) return;
    fetchProjectDiscussion(projectWalletAddress, 50)
      .then(setDiscussion)
      .catch(() => setDiscussion([]))
      .finally(() => setDiscussionLoadedFor(projectWalletAddress));
  }, [projectWalletAddress]);

  const handleCopyWallet = async () => {
    if (!project) return;
    const success = await copyToClipboard(project.walletAddress);
    setCopyState(success ? "copied" : "error");
    setTimeout(() => setCopyState("idle"), 2000);
  };

  const handleToggleLike = async (updateId: string) => {
    if (!publicKey) return;
    try {
      const result = await toggleUpdateLike(updateId, publicKey);
      setUpdateLikes((prev) => ({ ...prev, [updateId]: result }));
    } catch {
      // silently fail
    }
  };

  const handleToggleFollow = async () => {
    if (!publicKey || !project || followLoading) return;
    setFollowLoading(true);
    try {
      const result = isFollowing
        ? await unfollowProject(project.id, publicKey)
        : await followProject(project.id, publicKey);
      setIsFollowing(result.isFollowing);
      setFollowCount(result.followCount);
    } catch {
      // silently fail
    } finally {
      setFollowLoading(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!project || !publicKey || aiSummaryState === "loading") return;
    setAiSummaryState("loading");
    setAiSummaryError(null);
    try {
      const result = await generateProjectSummary(project.id, publicKey);
      setProject({ ...project, ...result });
      setAiSummaryState("idle");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate summary";
      setAiSummaryError(msg);
      setAiSummaryState("error");
    }
  };

  if (loading || !project) {
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
  }

  const pct = progressPercent(project.raisedXLM, project.goalXLM);
  const isComplete = pct >= 100;
  const campaigns = project.campaigns || [];
  const activeCampaign =
    project.activeCampaign ||
    campaigns.find((campaign) => campaign.active) ||
    null;
  const completedCampaigns = campaigns.filter((campaign) => campaign.completed);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 pb-24 sm:pb-10 animate-fade-in">
      <ProjectHeadMeta project={project} ogProject={ogProject} />

      <ToastNotification
        toasts={toasts}
        onDismiss={(toastId) => setToasts((prev) => prev.filter((t) => t.id !== toastId))}
      />

      <ProjectCelebration
        isComplete={isComplete}
        donorCount={project.donorCount}
        raisedXLM={project.raisedXLM}
        raisedUSDC={project.raisedUSDC}
        goalXLM={project.goalXLM}
        particles={celebrationParticles}
      />

      <Link
        href="/projects"
        className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] dark:text-[#8aaa8a] hover:text-forest-700 transition-colors mb-6 font-body"
      >
        ← Back to Projects
      </Link>

      <ProjectActiveCampaign campaign={activeCampaign} />

      <ProjectMatchBanner matches={matches} />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* ── Main content ────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            {project.imageUrl ? (
              <div className="mb-5 overflow-hidden rounded-3xl border border-forest-100 bg-forest-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={project.imageUrl}
                  alt={project.name}
                  className="h-56 w-full object-cover"
                />
              </div>
            ) : null}
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
                  <span className="text-xs text-[var(--text-secondary)] dark:text-forest-300 bg-forest-50 px-2.5 py-1 rounded-full border border-forest-100 font-body">
                    {project.category}
                  </span>
                  <span className="ml-auto">
                    <ShareButtons
                      onTwitter={handleTwitterShare}
                      onFacebook={handleFacebookShare}
                      onCopyLink={handleCopyLink}
                      copyState={shareState}
                    />
                  </span>
                  {/* Follow button — visible to connected wallets only */}
                  {publicKey && (
                    <button
                      onClick={handleToggleFollow}
                      disabled={followLoading}
                      className={`text-xs py-1 px-3 rounded-lg border font-medium transition-all duration-200 ${
                        isFollowing
                          ? "bg-green-50 text-green-700 border-green-300 hover:bg-red-50 hover:text-red-600 hover:border-red-300"
                          : "bg-forest-50 text-forest-700 border-forest-200 hover:bg-green-50 hover:text-green-700 hover:border-green-300"
                      } ${followLoading ? "opacity-60 cursor-not-allowed" : ""}`}
                      title={isFollowing ? "Unfollow project" : "Follow project"}
                    >
                      {followLoading
                        ? "…"
                        : isFollowing
                        ? `✓ Following${followCount > 0 ? ` (${followCount})` : ""}`
                        : `Follow${followCount > 0 ? ` (${followCount})` : ""}`}
                    </button>
                  )}
                  <button
                    onClick={() => toggleWishlist(project.id)}
                    className={`p-2 rounded-lg border transition-all duration-300 transform active:scale-90 
                      ${
                        isInWishlist(project.id)
                          ? "bg-red-50 text-red-500 border-red-200"
                          : "bg-forest-50 text-[var(--text-tertiary)] dark:text-forest-300 border-forest-200 hover:text-red-400 hover:border-red-200"
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
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                  <p className="text-[var(--text-secondary)] dark:text-[#8aaa8a] text-sm font-body">
                    📍 {project.location}
                  </p>
                  {(project.averageRating || 0) > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-amber-400 text-sm">★</span>
                      <span className="text-forest-900 text-sm font-bold">{project.averageRating?.toFixed(1)}</span>
                      <span className="text-[var(--text-secondary)] dark:text-forest-300 text-xs">({project.ratingCount} reviews)</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="mb-5">
              {isComplete ? (
                <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-5 py-4 rounded-xl text-center font-semibold text-lg shadow-lg">
                  🎉 Goal Reached!
                </div>
              ) : (
                <div className="space-y-3">
                  <ProjectProgressBar
                    raisedXLM={project.raisedXLM}
                    goalXLM={project.goalXLM}
                    className="w-full"
                  />
                  <div className="flex items-center justify-between text-sm text-[var(--text-secondary)] font-body">
                    <span>{formatXLM(project.raisedXLM)} raised</span>
                    <span>{Number(project.goalXLM) > 0 ? `towards ${formatXLM(project.goalXLM)} goal` : "No goal set"}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                          Estimated CO₂ offset based on this project&apos;s declared
                          impact rate per XLM donated. Actual results may vary.
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] dark:text-forest-300 font-body">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Wallet link */}
            <div className="mt-4 pt-4 border-t border-forest-100 flex items-center gap-2 text-xs text-[var(--text-secondary)] dark:text-forest-300 font-body">
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
                    className="w-4 h-4 text-[var(--text-secondary)] dark:text-forest-300 hover:text-forest-700"
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

            {/* QR code — tap to reveal; lets Freighter mobile scan-to-donate
                without copying the wallet address manually (issue #405) */}
            <div className="mt-3">
              <WalletAddressQRCode
                walletAddress={project.walletAddress}
                projectName={project.name}
              />
            </div>
          </div>

          <ProjectAiSummary
            project={project}
            publicKey={publicKey}
            aiSummaryState={aiSummaryState}
            aiSummaryError={aiSummaryError}
            onGenerateSummary={handleGenerateSummary}
          />

          <ProjectAbout description={project.description} tags={project.tags} />

          <ProjectReviewsSection
            reviews={reviews}
            reviewsTotal={reviewsTotal}
            reviewsLoading={reviewsLoading}
            reviewsHasMore={reviewsHasMore}
            loadingMoreReviews={loadingMoreReviews}
            averageRating={project.averageRating}
            ratingCount={project.ratingCount}
            onLoadMore={handleLoadMoreReviews}
          />

          <ProjectMilestones
            milestones={project.milestones || []}
            raisedXLM={project.raisedXLM}
            goalXLM={project.goalXLM}
          />

          <ProjectCampaigns
            projectId={project.id}
            completedCampaigns={completedCampaigns}
            onCampaignCreated={setProject}
          />

          <ProjectUpdatesFeed
            updates={updates}
            updateLikes={updateLikes}
            publicKey={publicKey}
            onToggleLike={handleToggleLike}
          />

          <div className="card">
            <h2 className="font-display text-lg font-semibold text-forest-900 mb-4">
              Recent Donations
            </h2>
            <DonationFeed
              projectId={project.id}
              walletAddress={project.walletAddress}
              refreshKey={refreshKey}
              onNewDonation={(d) => {
                setToasts((prev) => [
                  ...prev,
                  {
                    id: `${d.id}`,
                    title: "New donation received",
                    description: `${shortenAddress(d.donorAddress)} just donated ${formatXLM(d.amountXLM || d.amount || "0")}`,
                    createdAt: Date.now(),
                  },
                ]);
              }}
            />
            <ToastNotification
              toasts={toasts}
              onDismiss={(toastId) => setToasts((prev) => prev.filter((t) => t.id !== toastId))}
            />
          </div>

          <ProjectDiscussion
            discussion={discussion}
            loading={discussionLoading}
            onReply={(replyMemo: string) =>
              router.push({ pathname: router.pathname, query: { ...router.query, replyMemo } })
            }
          />

          <ProjectComments projectId={project.id} publicKey={publicKey} />
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="fixed bottom-0 left-0 right-0 z-40 p-3 bg-white/95 backdrop-blur-sm border-t border-forest-200 sm:hidden">
            {publicKey ? (
              <a
                href="#donate-form"
                className="btn-primary w-full text-center text-sm py-3 block"
              >
                Donate to {project.name}
              </a>
            ) : (
              <WalletConnect onConnect={onConnect} />
            )}
          </div>

          <ProjectImpactCalculator
            calcAmount={calcAmount}
            onAmountChange={setCalcAmount}
            co2OffsetKg={project.co2OffsetKg || 0}
          />

          {publicKey ? (
            <div id="donate-form">
              <DonateForm
                project={project}
                publicKey={publicKey}
                initialAmount={prefillAmount}
                initialMessage={prefillReplyMemo}
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
            </div>
          ) : (
            <div>
              <p className="text-center text-[var(--text-secondary)] dark:text-[#8aaa8a] text-sm mb-4 font-body">
                Connect your wallet to donate
              </p>
              <WalletConnect onConnect={onConnect} />
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowMonthlySetup(true)}
            className="btn-secondary w-full text-sm"
          >
            Give monthly
          </button>

          <ProjectShareCard
            projectId={project.id}
            shareState={shareState}
            shareCount={shareCount}
            onTwitterShare={handleTwitterShare}
            onWhatsappShare={handleWhatsappShare}
            onCopyLink={handleCopyLink}
          />

          <ProjectReportCard
            onDownloadReport={() => printProjectReport(project, updates)}
          />

          <ProjectSubscribeCard
            projectId={project.id}
            publicKey={publicKey}
          />
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

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { id } = context.params as { id: string };
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  try {
    const res = await fetch(`${apiUrl}/api/projects/${encodeURIComponent(id)}`);
    if (!res.ok) return { props: { ogProject: null } };
    const body = await res.json();
    const p = body.data;
    return {
      props: {
        ogProject: {
          id: p.id ?? undefined,
          name: p.name ?? "",
          description: p.description ?? "",
          imageUrl: p.imageUrl ?? null,
          category: p.category ?? "",
          location: p.location ?? "",
        },
      },
    };
  } catch {
    return { props: { ogProject: null } };
  }
};

