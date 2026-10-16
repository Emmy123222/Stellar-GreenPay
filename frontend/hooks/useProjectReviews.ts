import { useState, useEffect } from "react";
import { fetchProjectReviews } from "@/lib/api";
import type { ProjectReview } from "@/utils/types";

export function useProjectReviews(projectId?: string, refreshKey = 0) {
  const [reviews, setReviews] = useState<ProjectReview[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [reviewsOffset, setReviewsOffset] = useState(0);
  const [reviewsHasMore, setReviewsHasMore] = useState(false);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const [reviewsLoadedKey, setReviewsLoadedKey] = useState<string | null>(null);

  const reviewsRequestKey = `${projectId}:${refreshKey}`;
  const reviewsLoading = reviewsLoadedKey !== reviewsRequestKey;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchProjectReviews(projectId, { limit: 5, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        setReviews(res.data);
        setReviewsTotal(res.pagination.total);
        setReviewsOffset(res.data.length);
        setReviewsHasMore(res.pagination.has_more);
      })
      .catch(() => {
        if (cancelled) return;
        setReviews([]);
        setReviewsTotal(0);
        setReviewsHasMore(false);
      })
      .finally(() => {
        if (!cancelled) setReviewsLoadedKey(reviewsRequestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey, reviewsRequestKey]);

  const handleLoadMoreReviews = async () => {
    if (!projectId || reviewsLoading || loadingMoreReviews) return;
    setLoadingMoreReviews(true);
    try {
      const res = await fetchProjectReviews(projectId, { limit: 5, offset: reviewsOffset });
      setReviews((prev) => [...prev, ...res.data]);
      setReviewsTotal(res.pagination.total);
      setReviewsOffset((prev) => prev + res.data.length);
      setReviewsHasMore(res.pagination.has_more);
    } catch {
      // keep the already-loaded reviews on failure
    } finally {
      setLoadingMoreReviews(false);
    }
  };

  return {
    reviews,
    reviewsTotal,
    reviewsLoading,
    reviewsHasMore,
    loadingMoreReviews,
    handleLoadMoreReviews,
  };
}
