/**
 * pages/donors/[publicKey].tsx
 * Donor public profile page — resolves issue #13
 * Route: /donors/:publicKey
 */

import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useCallback } from "react";
import { fetchProfile, fetchDonorHistory } from "@/lib/api";
import type { DonorProfile, Donation, BadgeTier } from "@/utils/types";

// ── Badge helpers ─────────────────────────────────────────────────────────────

const BADGE_META: Record<
  BadgeTier,
  { emoji: string; label: string; color: string; bg: string; border: string }
> = {
  seedling: {
    emoji: "🌱",
    label: "Seedling",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
  },
  tree: {
    emoji: "🌳",
    label: "Tree",
    color: "text-green-700",
    bg: "bg-green-50",
    border: "border-green-200",
  },
  forest: {
    emoji: "🌲",
    label: "Forest",
    color: "text-teal-700",
    bg: "bg-teal-50",
    border: "border-teal-200",
  },
  earth: {
    emoji: "🌍",
    label: "Earth Guardian",
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
};

function shortenKey(pk: string): string {
  if (!pk || pk.length < 12) return pk;
  return `${pk.slice(0, 6)}…${pk.slice(-6)}`;
}

function formatXLM(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BadgePill({ tier, earnedAt }: { tier: BadgeTier; earnedAt: string }) {
  const meta = BADGE_META[tier];
  return (
    <div
      title={`${meta.label} — earned ${formatDate(earnedAt)}`}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${meta.bg} ${meta.color} ${meta.border}`}
    >
      <span role="img" aria-label={meta.label} className="text-base leading-none">
        {meta.emoji}
      </span>
      {meta.label}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="stat-card flex flex-col gap-1">
      <p className="label">{label}</p>
      <p className="font-display text-2xl font-semibold text-[#227239]">
        {value}
      </p>
      {sub && <p className="text-xs text-[#5a7a5a] font-body">{sub}</p>}
    </div>
  );
}

function DonationRow({ donation }: { donation: Donation }) {
  const amount =
    donation.amount ?? donation.amountXLM ?? "0";
  const currency = donation.currency ?? "XLM";

  return (
    <div className="flex items-center justify-between py-3 border-b border-[rgba(34,114,57,0.07)] last:border-0 gap-3">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="address-tag truncate max-w-[160px] sm:max-w-xs">
          Project {shortenKey(donation.projectId)}
        </span>
        {donation.message && (
          <p className="text-xs text-[#5a7a5a] italic truncate max-w-[200px] sm:max-w-sm">
            "{donation.message}"
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="font-semibold text-[#227239] font-body text-sm">
          {formatXLM(amount)}{" "}
          <span className="text-xs font-normal text-[#5a7a5a]">{currency}</span>
        </span>
        <span className="text-[10px] text-[#5a7a5a]">
          {formatDate(donation.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ── 404 state ─────────────────────────────────────────────────────────────────

function ProfileNotFound({ publicKey }: { publicKey: string }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 gap-6">
      <div className="text-6xl">🌿</div>
      <div>
        <h1 className="font-display text-2xl font-semibold text-[#1a2e1a] mb-2">
          Profile not set up yet
        </h1>
        <p className="text-[#5a7a5a] font-body max-w-sm mx-auto text-sm leading-relaxed">
          The donor at{" "}
          <span className="address-tag">{shortenKey(publicKey)}</span> hasn't
          created a public profile yet.
        </p>
      </div>
      <Link href="/projects" className="btn-primary text-sm">
        Browse Projects
      </Link>
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="animate-pulse space-y-6 max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-[#c8dfc8]" />
        <div className="space-y-2 flex-1">
          <div className="h-5 bg-[#c8dfc8] rounded w-1/3" />
          <div className="h-3 bg-[#c8dfc8] rounded w-1/2" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="stat-card h-20" />
        ))}
      </div>
      <div className="card space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-4 bg-[#c8dfc8] rounded w-full" />
        ))}
      </div>
    </div>
  );
}

// ── Share button ──────────────────────────────────────────────────────────────

function ShareButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // fallback for older browsers
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  }, [url]);

  return (
    <button
      onClick={handleCopy}
      className="btn-secondary text-sm flex items-center gap-2"
      aria-label="Copy profile URL to clipboard"
    >
      {copied ? (
        <>
          <span>✅</span> Copied!
        </>
      ) : (
        <>
          <span>🔗</span> Share my impact
        </>
      )}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DonorProfilePage() {
  const router = useRouter();
  const { publicKey } = router.query as { publicKey?: string };

  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!publicKey) return;

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    (async () => {
      try {
        const [prof, hist] = await Promise.all([
          fetchProfile(publicKey),
          fetchDonorHistory(publicKey),
        ]);
        if (!cancelled) {
          setProfile(prof);
          setDonations(hist.slice(0, 10));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          // Treat 404 or any error fetching the profile as "not found"
          const status =
            (err as { response?: { status?: number } })?.response?.status;
          if (!status || status === 404) {
            setNotFound(true);
          } else {
            setNotFound(true); // graceful fallback for other errors
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  // ── Derived values ───────────────────────────────────────────────────────

  const displayName =
    profile?.displayName || (publicKey ? shortenKey(publicKey) : "Donor");

  const profileUrl =
    typeof window !== "undefined" ? window.location.href : "";

  const ogTitle = `${displayName} — Stellar GreenPay Donor`;
  const ogDescription = profile
    ? `${displayName} has donated ${formatXLM(profile.totalDonatedXLM)} XLM to ${profile.projectsSupported} climate project${profile.projectsSupported !== 1 ? "s" : ""} on Stellar GreenPay.`
    : "View this donor's climate impact on Stellar GreenPay.";

  // ── Render ───────────────────────────────────────────────────────────────

  if (!publicKey || loading) return <ProfileSkeleton />;
  if (notFound) return <ProfileNotFound publicKey={publicKey} />;
  if (!profile) return null;

  return (
    <>
      <Head>
        <title>{ogTitle}</title>
        <meta name="description" content={ogDescription} />
        {/* Open Graph */}
        <meta property="og:title" content={ogTitle} />
        <meta property="og:description" content={ogDescription} />
        <meta property="og:type" content="profile" />
        {profileUrl && <meta property="og:url" content={profileUrl} />}
        {/* Twitter card */}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={ogTitle} />
        <meta name="twitter:description" content={ogDescription} />
      </Head>

      <div className="min-h-screen bg-leaf">
        <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">

          {/* ── Header card ─────────────────────────────────────────────── */}
          <div className="card shadow-green">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              {/* Avatar + name */}
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-[#e8f3e8] border-2 border-[rgba(34,114,57,0.20)] flex items-center justify-center text-2xl select-none">
                  🌿
                </div>
                <div>
                  <h1 className="font-display text-xl font-semibold text-[#1a2e1a] leading-tight">
                    {displayName}
                  </h1>
                  <span className="address-tag mt-1 inline-block">
                    {shortenKey(profile.publicKey)}
                  </span>
                </div>
              </div>
              <ShareButton url={profileUrl} />
            </div>

            {profile.bio && (
              <p className="mt-4 text-sm text-[#5a7a5a] font-body leading-relaxed border-t border-[rgba(34,114,57,0.08)] pt-4">
                {profile.bio}
              </p>
            )}
          </div>

          {/* ── Stats row ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              label="Total Donated"
              value={`${formatXLM(profile.totalDonatedXLM)} XLM`}
            />
            <StatCard
              label="Projects Supported"
              value={String(profile.projectsSupported)}
            />
            <StatCard
              label="Member Since"
              value={formatDate(profile.createdAt)}
            />
          </div>

          {/* ── Badges ──────────────────────────────────────────────────── */}
          {profile.badges.length > 0 && (
            <div className="card">
              <h2 className="label mb-3">Earned Badges</h2>
              <div className="flex flex-wrap gap-2">
                {profile.badges.map((b, i) => (
                  <BadgePill key={i} tier={b.tier} earnedAt={b.earnedAt} />
                ))}
              </div>
            </div>
          )}

          {/* ── Donation history ────────────────────────────────────────── */}
          <div className="card">
            <h2 className="label mb-1">Recent Donations</h2>
            {donations.length === 0 ? (
              <p className="text-sm text-[#5a7a5a] py-4 text-center font-body">
                No donations recorded yet.
              </p>
            ) : (
              <div>
                {donations.map((d) => (
                  <DonationRow key={d.id} donation={d} />
                ))}
              </div>
            )}
          </div>

          {/* ── Footer CTA ──────────────────────────────────────────────── */}
          <div className="text-center pb-4">
            <Link href="/projects" className="btn-ghost text-sm">
              ← Browse all projects
            </Link>
          </div>

        </div>
      </div>
    </>
  );
}