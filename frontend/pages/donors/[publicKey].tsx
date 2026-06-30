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
import {
  buildMintImpactNftTransaction,
  submitSorobanTransaction,
  explorerUrl,
  CONTRACT_ID,
} from "@/lib/stellar";
import {
  connectWallet,
  getConnectedPublicKey,
  signTransactionWithWallet,
} from "@/lib/wallet";

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
      {sub && <p className="text-xs text-[#5a7a5a] dark:text-[#8aaa8a] font-body">{sub}</p>}
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
          <p className="text-xs text-[#5a7a5a] dark:text-[#8aaa8a] italic truncate max-w-[200px] sm:max-w-sm">
            &quot;{donation.message}&quot;
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="font-semibold text-[#227239] font-body text-sm">
          {formatXLM(amount)}{" "}
          <span className="text-xs font-normal text-[#5a7a5a] dark:text-[#8aaa8a]">{currency}</span>
        </span>
        <span className="text-[10px] text-[#5a7a5a] dark:text-[#8aaa8a]">
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
        <p className="text-[#5a7a5a] dark:text-[#8aaa8a] font-body max-w-sm mx-auto text-sm leading-relaxed">
          The donor at{" "}
          <span className="address-tag">{shortenKey(publicKey)}</span> hasn&apos;t
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

// ── Claim NFT card ────────────────────────────────────────────────────────────

/** Order of badge tiers, lowest → highest, used to pick the donor's top tier. */
const TIER_ORDER: BadgeTier[] = ["seedling", "tree", "forest", "earth"];

/**
 * Returns the highest badge tier the donor has earned, or null if none.
 * The issue asks us to "check current badge tier"; the current tier is the
 * highest one reflected by the profile (which mirrors the on-chain badge).
 */
function highestTier(badges: { tier: BadgeTier }[]): BadgeTier | null {
  let best: BadgeTier | null = null;
  let bestIdx = -1;
  for (const b of badges) {
    const idx = TIER_ORDER.indexOf(b.tier);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = b.tier;
    }
  }
  return best;
}

type ClaimStep =
  | "idle"
  | "checking"
  | "building"
  | "signing"
  | "submitting"
  | "success"
  | "error";

interface MintedNft {
  tier: BadgeTier;
  ledger: number;
  hash: string;
}

function ClaimNftCard({ profile }: { profile: DonorProfile }) {
  const [connectedKey, setConnectedKey] = useState<string | null>(null);
  const [step, setStep] = useState<ClaimStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedNft | null>(null);

  // The tier the donor is eligible to claim (their current/highest badge).
  const tier = highestTier(profile.badges);

  // On mount, see if a wallet is already authorised so we can match it to the
  // profile owner (the contract's `mint_impact_nft` requires the donor to sign).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pk = await getConnectedPublicKey();
      if (!cancelled) setConnectedKey(pk);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isOwner = Boolean(connectedKey && connectedKey === profile.publicKey);
  const busy =
    step === "checking" ||
    step === "building" ||
    step === "signing" ||
    step === "submitting";

  const handleConnect = useCallback(async () => {
    setError(null);
    const { publicKey, error: e } = await connectWallet();
    if (e) {
      setError(e);
      return;
    }
    setConnectedKey(publicKey);
  }, []);

  const handleClaim = useCallback(async () => {
    setError(null);
    setMinted(null);

    if (!CONTRACT_ID) {
      setError("Impact NFT contract is not configured (set NEXT_PUBLIC_CONTRACT_ID).");
      setStep("error");
      return;
    }
    if (!connectedKey || connectedKey !== profile.publicKey) {
      setError("Connect the wallet that owns this profile to claim its NFT.");
      setStep("error");
      return;
    }

    try {
      // 1. Re-check the current badge tier from the API right before minting.
      setStep("checking");
      const fresh = await fetchProfile(profile.publicKey);
      const currentTier = highestTier(fresh.badges);
      if (!currentTier) {
        throw new Error("No badge tier reached yet — donate more to unlock an Impact NFT.");
      }

      // 2. Build the Soroban mint_impact_nft(donor, tier) transaction.
      setStep("building");
      const tx = await buildMintImpactNftTransaction({
        contractId: CONTRACT_ID,
        donor: profile.publicKey,
        tier: currentTier,
      });

      // 3. Prompt Freighter to sign.
      setStep("signing");
      const { signedXDR, error: signErr } = await signTransactionWithWallet(
        tx.toXDR(),
      );
      if (signErr || !signedXDR) {
        throw new Error(signErr || "Wallet did not return a signed transaction.");
      }

      // 4. Submit via Soroban RPC and wait for the mint ledger.
      setStep("submitting");
      const { hash, ledger } = await submitSorobanTransaction(signedXDR);

      setMinted({ tier: currentTier, ledger, hash });
      setStep("success");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(msg);
      setStep("error");
    }
  }, [connectedKey, profile.publicKey]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Successfully minted: show the NFT with its tier name and mint ledger.
  if (minted) {
    const meta = BADGE_META[minted.tier];
    return (
      <div className={`card border ${meta.border} ${meta.bg}`}>
        <h2 className="label mb-3">Impact NFT Minted 🎉</h2>
        <div className="flex items-center gap-4">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center text-4xl border ${meta.border} bg-white/70 select-none`}
          >
            {meta.emoji}
          </div>
          <div className="min-w-0">
            <p className={`font-display text-lg font-semibold ${meta.color}`}>
              {meta.label} Impact NFT
            </p>
            <p className="text-xs text-[#5a7a5a] font-body">
              Minted at ledger{" "}
              <span className="font-semibold text-[#227239]">
                #{minted.ledger.toLocaleString()}
              </span>
            </p>
            <a
              href={explorerUrl(minted.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-forest-600 hover:underline font-body break-all"
            >
              View transaction ↗
            </a>
          </div>
        </div>
      </div>
    );
  }

  // No badge tier yet — nothing to claim.
  if (!tier) return null;

  const meta = BADGE_META[tier];

  return (
    <div className="card">
      <h2 className="label mb-1">Claim your Impact NFT</h2>
      <p className="text-sm text-[#5a7a5a] font-body mb-4">
        Mint an on-chain{" "}
        <span className={`font-semibold ${meta.color}`}>
          {meta.emoji} {meta.label}
        </span>{" "}
        Impact NFT for your contributions.
      </p>

      {error && (
        <div
          role="alert"
          className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-body"
        >
          {error}
        </div>
      )}

      {!connectedKey ? (
        <button onClick={handleConnect} className="btn-primary text-sm">
          🔗 Connect Freighter to claim
        </button>
      ) : !isOwner ? (
        <p className="text-xs text-[#8aaa8a] font-body">
          Connect the wallet that owns this profile ({shortenKey(profile.publicKey)})
          to claim its Impact NFT.
        </p>
      ) : (
        <button
          onClick={handleClaim}
          disabled={busy}
          className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60"
          aria-busy={busy}
        >
          {step === "checking" && "Checking tier…"}
          {step === "building" && "Building transaction…"}
          {step === "signing" && "Confirm in Freighter…"}
          {step === "submitting" && "Minting on-chain…"}
          {(step === "idle" || step === "error" || step === "success") &&
            `Claim ${meta.label} NFT`}
        </button>
      )}
    </div>
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
              <p className="mt-4 text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body leading-relaxed border-t border-[rgba(34,114,57,0.08)] pt-4">
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

          {/* ── Claim Impact NFT ────────────────────────────────────────── */}
          <ClaimNftCard profile={profile} />

          {/* ── Donation history ────────────────────────────────────────── */}
          <div className="card">
            <h2 className="label mb-1">Recent Donations</h2>
            {donations.length === 0 ? (
              <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] py-4 text-center font-body">
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