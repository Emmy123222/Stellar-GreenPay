import React from "react";
import { shortenAddress, timeAgo } from "@/utils/format";
import type { ProjectReview } from "@/utils/types";

export interface ProjectReviewsSectionProps {
  reviews: ProjectReview[];
  reviewsTotal: number;
  reviewsLoading: boolean;
  reviewsHasMore: boolean;
  loadingMoreReviews: boolean;
  averageRating?: number;
  ratingCount?: number;
  onLoadMore: () => void;
}

export default function ProjectReviewsSection({
  reviews,
  reviewsTotal,
  reviewsLoading,
  reviewsHasMore,
  loadingMoreReviews,
  averageRating = 0,
  ratingCount = 0,
  onLoadMore,
}: ProjectReviewsSectionProps) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-lg font-semibold text-forest-900">
          Donor Reviews
        </h2>
        {ratingCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400 text-lg" aria-hidden="true">
              ★
            </span>
            <span className="font-bold text-forest-900 font-body">
              {averageRating.toFixed(1)}
            </span>
            <span className="text-xs text-[#8aaa8a] dark:text-forest-300 font-body">
              ({ratingCount} review{ratingCount === 1 ? "" : "s"})
            </span>
          </div>
        )}
      </div>

      {reviewsLoading && reviews.length === 0 ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse motion-reduce:animate-none h-12 bg-forest-100 rounded-xl"
            />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-[#4f6f4f] dark:text-[#8aaa8a] font-body">
          No reviews yet. Donate to this project and be the first to share your experience.
        </p>
      ) : (
        <>
          <div className="space-y-4">
            {reviews.map((r, i) => (
              <div
                key={`${r.donorAddress}-${i}`}
                className="pb-4 border-b border-forest-100 last:border-0 last:pb-0"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-amber-400 text-sm tracking-wide"
                      aria-label={`${r.rating} out of 5 stars`}
                    >
                      {"★".repeat(r.rating)}
                      <span className="text-forest-200">
                        {"★".repeat(5 - r.rating)}
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-forest-700 font-body">
                      {shortenAddress(r.donorAddress)}
                    </span>
                  </div>
                  <span className="text-xs text-[#8aaa8a] dark:text-forest-300 font-body">
                    {timeAgo(r.createdAt)}
                  </span>
                </div>
                {r.review && (
                  <p className="text-sm text-forest-900/90 leading-relaxed font-body">
                    {r.review}
                  </p>
                )}
              </div>
            ))}
          </div>
          {reviewsHasMore && (
            <button
              onClick={onLoadMore}
              disabled={loadingMoreReviews}
              className="btn-secondary text-sm py-2 px-4 mt-4 disabled:opacity-60"
            >
              {loadingMoreReviews
                ? "Loading…"
                : `Load more reviews (${reviewsTotal - reviews.length} remaining)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
