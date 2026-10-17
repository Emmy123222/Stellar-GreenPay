import React from "react";
import ShareButtons from "@/components/ShareButtons";
import ProjectProgressBar from "@/components/ProjectProgressBar";
import { formatXLM, statusClass, statusLabel, CATEGORY_ICONS } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";

export interface ProjectHeroProps {
  project: ClimateProject;
  publicKey: string | null;
  isComplete: boolean;
  isFollowing: boolean;
  followCount: number;
  followLoading: boolean;
  onToggleFollow: () => void;
  isInWishlist: boolean;
  onToggleWishlist: () => void;
  shareState: "idle" | "copied";
  onTwitterShare: () => void;
  onFacebookShare: () => void;
  onCopyLink: () => void;
}

export default function ProjectHero({
  project,
  publicKey,
  isComplete,
  isFollowing,
  followCount,
  followLoading,
  onToggleFollow,
  isInWishlist,
  onToggleWishlist,
  shareState,
  onTwitterShare,
  onFacebookShare,
  onCopyLink,
}: ProjectHeroProps) {
  return (
    <>
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
              <span className="badge text-xs px-3 py-1.5 rounded-full bg-gradient-to-r from-green-500 to-emerald-600 text-white border-2 border-white shadow-lg font-body font-bold animate-pulse motion-reduce:animate-none">
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
                onTwitter={onTwitterShare}
                onFacebook={onFacebookShare}
                onCopyLink={onCopyLink}
                copyState={shareState}
              />
            </span>
            {/* Follow button — visible to connected wallets only */}
            {publicKey && (
              <button
                onClick={onToggleFollow}
                disabled={followLoading}
                className={`text-xs py-1 px-3 rounded-lg border font-medium transition-all motion-reduce:transition-none duration-200 ${
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
              onClick={onToggleWishlist}
              className={`p-2 rounded-lg border transition-all motion-reduce:transition-none duration-300 transform active:scale-90 ${
                isInWishlist
                  ? "bg-red-50 text-red-500 border-red-200"
                  : "bg-forest-50 text-[var(--text-tertiary)] dark:text-forest-300 border-forest-200 hover:text-red-400 hover:border-red-200"
              }`}
              title={isInWishlist ? "Remove from wishlist" : "Add to wishlist"}
            >
              <svg
                className={`w-5 h-5 ${isInWishlist ? "fill-current" : "fill-none"}`}
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
                <span className="text-forest-900 text-sm font-bold">
                  {project.averageRating?.toFixed(1)}
                </span>
                <span className="text-[var(--text-secondary)] dark:text-forest-300 text-xs">
                  ({project.ratingCount} reviews)
                </span>
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
              <span>
                {Number(project.goalXLM) > 0
                  ? `towards ${formatXLM(project.goalXLM)} goal`
                  : "No goal set"}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
