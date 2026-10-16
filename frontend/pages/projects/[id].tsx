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
import ProjectHero from "@/components/ProjectHero";
import ProjectStats from "@/components/ProjectStats";
import ProjectAiSummary from "@/components/ProjectAiSummary";
import ProjectAbout from "@/components/ProjectAbout";
import ProjectReviewsSection from "@/components/ProjectReviewsSection";
import ProjectMilestones from "@/components/ProjectMilestones";
import ProjectActiveCampaign from "@/components/ProjectActiveCampaign";
import ProjectCampaigns from "@/components/ProjectCampaigns";
import ProjectUpdatesFeed from "@/components/ProjectUpdatesFeed";
import ProjectDiscussion from "@/components/ProjectDiscussion";
import ProjectComments from "@/components/ProjectComments";
import ProjectImpactCalculator from "@/components/ProjectImpactCalculator";
import ProjectShareCard from "@/components/ProjectShareCard";
import ProjectReportCard from "@/components/ProjectReportCard";
import ProjectSubscribeCard from "@/components/ProjectSubscribeCard";
import ProjectCelebration from "@/components/ProjectCelebration";
import ProjectMatchBanner from "@/components/ProjectMatchBanner";
import {
  fetchProject,
  fetchProjectUpdates,
  fetchProjectMatches,
  generateProjectSummary,
  toggleUpdateLike,
  followProject,
  unfollowProject,
} from "@/lib/api";
import { copyToClipboard, formatXLM, progressPercent, shortenAddress } from "@/utils/format";
import { fetchProjectDiscussion, type ProjectDiscussionMessage } from "@/lib/stellar";
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
            <ProjectHero
              project={project}
              publicKey={publicKey}
              isComplete={isComplete}
              isFollowing={isFollowing}
              followCount={followCount}
              followLoading={followLoading}
              onToggleFollow={handleToggleFollow}
              isInWishlist={isInWishlist(project.id)}
              onToggleWishlist={() => toggleWishlist(project.id)}
              shareState={shareState}
              onTwitterShare={handleTwitterShare}
              onFacebookShare={handleFacebookShare}
              onCopyLink={handleCopyLink}
            />
            <ProjectStats
              project={project}
              copyState={copyState}
              onCopyWallet={handleCopyWallet}
            />
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
            onReply={(replyMemo) =>
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

