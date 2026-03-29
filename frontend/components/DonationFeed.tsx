/**
 * components/DonationFeed.tsx
 * Recent donations for a project — live community feed.
 */
import { useState, useEffect } from "react";
import { fetchProjectDonations } from "@/lib/api";
import { formatXLM, timeAgo, shortenAddress } from "@/utils/format";
import { explorerUrl } from "@/lib/stellar";
import type { Donation } from "@/utils/types";

interface DonationFeedProps { projectId: string; refreshKey?: number; }

export default function DonationFeed({ projectId, refreshKey = 0 }: DonationFeedProps) {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetchProjectDonations(projectId, 10)
      .then(({ donations: data, nextCursor: cursor }) => {
        setDonations(data);
        setNextCursor(cursor);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId, refreshKey]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { donations: newDonations, nextCursor: cursor } = await fetchProjectDonations(projectId, 10, nextCursor);
      setDonations(prev => [...prev, ...newDonations]);
      setNextCursor(cursor);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="animate-pulse flex gap-3 p-3 rounded-xl bg-forest-50">
          <div className="w-8 h-8 rounded-full bg-forest-200 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-forest-200 rounded w-1/2" />
            <div className="h-2 bg-forest-100 rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );

  if (donations.length === 0) return (
    <p className="text-center text-[#5a7a5a] text-sm py-6 font-body">No donations yet — be the first! 🌱</p>
  );

  return (
    <div className="space-y-2">
      {donations.map((d) => (
        <div key={d.id} className="flex items-start gap-3 p-3 rounded-xl bg-forest-50 hover:bg-forest-100 transition-colors">
          <div className="w-9 h-9 rounded-full bg-forest-200 flex items-center justify-center flex-shrink-0 text-base">
            🌱
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-forest-900 text-sm font-body">{shortenAddress(d.donorAddress, 5)}</span>
              <span className="font-mono font-bold text-forest-600 text-sm">{formatXLM(d.amountXLM ?? d.amount ?? "0")}</span>
            </div>
            {d.message && <p className="text-xs text-[#5a7a5a] mt-0.5 italic font-body">"{d.message}"</p>}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-[#8aaa8a] font-body">{timeAgo(d.createdAt)}</span>
              <a href={explorerUrl(d.transactionHash)} target="_blank" rel="noopener noreferrer"
                className="text-xs text-forest-500 hover:text-forest-700 transition-colors font-body">
                View tx ↗
              </a>
            </div>
          </div>
        </div>
      ))}
      {nextCursor && (
        <button
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="w-full mt-4 px-4 py-2 bg-forest-100 hover:bg-forest-200 text-forest-700 rounded-lg transition-colors font-body text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loadingMore ? "Loading..." : "Load more donations"}
        </button>
      )}
    </div>
  );
}
