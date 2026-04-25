/**
 * components/DonationFeed.tsx
 * Recent donations for a project — live community feed with real-time SSE streaming.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { fetchProjectDonations } from "@/lib/api";
import { formatXLM, timeAgo, shortenAddress } from "@/utils/format";
import { explorerUrl, streamProjectPayments } from "@/lib/stellar";
import type { Donation } from "@/utils/types";

interface DonationFeedProps {
  projectId: string;
  walletAddress?: string;
  refreshKey?: number;
  onNewDonation?: (donation: Donation) => void;
}

export default function DonationFeed({ projectId, walletAddress, refreshKey = 0, onNewDonation }: DonationFeedProps) {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const latestIdRef = useRef<string | null>(null);

  // Load initial donation data from the backend API
  useEffect(() => {
    setLoading(true);
    fetchProjectDonations(projectId, 10)
      .then(({ donations: data, nextCursor: cursor }) => {
        setDonations(data);
        setNextCursor(cursor);
        if (data.length > 0) {
          latestIdRef.current = data[0].id;
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId, refreshKey]);

  // Handle incoming SSE payment
  const handleNewPayment = useCallback((payment: {
    id: string;
    from: string;
    amount: string;
    asset: string;
    createdAt: string;
    transactionHash: string;
  }) => {
    const newDonation: Donation = {
      id: payment.id,
      projectId,
      donorAddress: payment.from,
      amountXLM: payment.amount,
      amount: payment.amount,
      currency: (payment.asset === "XLM" ? "XLM" : "USDC") as "XLM" | "USDC",
      transactionHash: payment.transactionHash,
      createdAt: payment.createdAt,
    };

    setDonations((prev) => {
      if (prev.some((d) => d.id === newDonation.id)) return prev;
      return [newDonation, ...prev];
    });

    setNewIds((prev) => new Set(prev).add(payment.id));
    setTimeout(() => {
      setNewIds((prev) => {
        const next = new Set(prev);
        next.delete(payment.id);
        return next;
      });
    }, 2000);

    onNewDonation?.(newDonation);

    latestIdRef.current = payment.id;
  }, [projectId, onNewDonation]);

  // Start SSE stream once initial data is loaded
  useEffect(() => {
    if (loading || !walletAddress) return;

    const cursor = latestIdRef.current || undefined;
    const closeStream = streamProjectPayments(walletAddress, handleNewPayment, cursor);

    return () => {
      closeStream();
    };
  }, [loading, walletAddress, handleNewPayment]);

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
    <div>
      {walletAddress && (
        <div className="flex items-center gap-2 mb-3 text-xs text-forest-500 font-body">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Listening for live donations…
        </div>
      )}
      <p className="text-center text-[#5a7a5a] text-sm py-6 font-body">No donations yet — be the first! 🌱</p>
    </div>
  );

  return (
    <div className="space-y-2">
      {walletAddress && (
        <div className="flex items-center gap-2 mb-1 text-xs text-forest-500 font-body">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live — new donations appear automatically
        </div>
      )}
      {donations.map((d) => (
        <div
          key={d.id}
          className={`flex items-start gap-3 p-3 rounded-xl bg-forest-50 hover:bg-forest-100 transition-all duration-500 ${
            newIds.has(d.id)
              ? "animate-slide-in ring-2 ring-emerald-400/50 bg-emerald-50"
              : ""
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-forest-200 flex items-center justify-center flex-shrink-0 text-base">
            {newIds.has(d.id) ? "✨" : "🌱"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-forest-900 text-sm font-body">{shortenAddress(d.donorAddress, 5)}</span>
              <span className="font-mono font-bold text-forest-600 text-sm">
                {d.currency === "USDC" ? `$${parseFloat(d.amount || "0").toFixed(2)} USDC` : formatXLM(d.amountXLM || d.amount || "0")}
              </span>
              {d.isMatched && (
                <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-body font-semibold">
                  Matched!
                </span>
              )}
              {newIds.has(d.id) && (
                <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-body font-semibold">
                  NEW
                </span>
              )}
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

      <style jsx>{`
        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateY(-12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        :global(.animate-slide-in) {
          animation: slide-in 0.4s ease-out;
        }
      `}</style>
    </div>
  );
}
