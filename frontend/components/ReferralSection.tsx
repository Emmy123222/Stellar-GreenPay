/**
 * components/ReferralSection.tsx
 * Referral program section for donor dashboard
 */
import { useState, useEffect } from "react";
import { fetchReferralStats, createReferral } from "@/lib/api";
import { formatXLM, shortenAddress } from "@/utils/format";

interface ReferralSectionProps {
  publicKey: string;
}

export default function ReferralSection({ publicKey }: ReferralSectionProps) {
  const [referralStats, setReferralStats] = useState<{
    referralCount: number;
    referralBonusXLM: string;
    referredBy: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!publicKey) return;
    fetchReferralStats(publicKey)
      .then(setReferralStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [publicKey]);

  // Check for referral code in URL
  useEffect(() => {
    if (typeof window === "undefined" || !publicKey) return;
    const urlParams = new URLSearchParams(window.location.search);
    const referrer = urlParams.get("ref");
    if (referrer && referrer !== publicKey) {
      createReferral(referrer, publicKey).catch(console.error);
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [publicKey]);

  const referralLink = `${window.location.origin}/?ref=${publicKey}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (loading) {
    return (
      <div className="card animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3"></div>
        <div className="h-8 bg-gray-200 rounded w-full mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="font-display text-lg font-semibold text-forest-900 mb-3">
        🎁 Your Referrals
      </h3>
      
      {referralStats?.referredBy && (
        <div className="mb-3 p-2 bg-forest-50 border border-forest-200 rounded-lg text-sm">
          <span className="text-forest-600">Referred by: </span>
          <span className="font-medium text-forest-900">
            {shortenAddress(referralStats.referredBy)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="text-center p-3 bg-forest-50 rounded-xl">
          <div className="text-2xl font-bold text-forest-700">
            {referralStats?.referralCount || 0}
          </div>
          <div className="text-xs text-forest-600 mt-1">Successful Referrals</div>
        </div>
        <div className="text-center p-3 bg-forest-50 rounded-xl">
          <div className="text-2xl font-bold text-forest-700">
            {formatXLM(parseFloat(referralStats?.referralBonusXLM || "0"))}
          </div>
          <div className="text-xs text-forest-600 mt-1">Bonus Earned (5 XLM each)</div>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-forest-900">Your Referral Link</label>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={referralLink}
            className="input-field text-sm"
            aria-label="Your referral link"
          />
          <button
            onClick={handleCopyLink}
            className="px-4 py-2 bg-forest-500 text-white rounded-xl text-sm font-medium hover:bg-forest-600 transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Share your link and earn 5 XLM badge XP for each new donor who makes their first donation!
      </p>
    </div>
  );
}
