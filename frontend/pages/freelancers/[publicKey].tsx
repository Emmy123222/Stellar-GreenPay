/**
 * pages/freelancers/[publicKey].tsx — Public freelancer profile page
 */
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { fetchFreelancerProfile } from "@/lib/api";
import { accountUrl } from "@/lib/stellar";
import { shortenAddress } from "@/utils/format";
import type { FreelancerProfile } from "@/utils/types";

export default function FreelancerProfilePage() {
  const router = useRouter();
  const raw = router.query.publicKey;
  const publicKey = typeof raw === "string" ? raw : undefined;

  const [profile, setProfile] = useState<FreelancerProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!router.isReady || !publicKey) return;
    setLoading(true);
    setNotFound(false);
    fetchFreelancerProfile(publicKey)
      .then(setProfile)
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 404) {
          setNotFound(true);
        } else {
          setNotFound(true);
        }
      })
      .finally(() => setLoading(false));
  }, [router.isReady, publicKey]);

  const displayName = profile?.displayName || shortenAddress(publicKey ?? "");
  const pageTitle = `${displayName} — Stellar GreenPay Freelancer`;

  if (!router.isReady || loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center text-[#5a7a5a] font-body">
        Loading profile…
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <>
        <Head>
          <title>Profile not found — Stellar GreenPay</title>
        </Head>
        <div className="max-w-2xl mx-auto px-4 py-16">
          <div className="card border border-forest-100/80 shadow-sm text-center py-12">
            <p className="text-4xl mb-4">🌿</p>
            <h1 className="font-display text-xl font-bold text-forest-900 mb-2">
              Profile not found
            </h1>
            <p className="text-[#5a7a5a] font-body mb-6">
              No freelancer profile exists for this address.
            </p>
            <Link href="/jobs" className="btn-primary inline-block">
              Browse jobs
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta property="og:title" content={pageTitle} />
        <meta
          property="og:description"
          content={
            profile.bio ||
            `${displayName} is a freelancer on Stellar GreenPay with ${profile.completedJobs} completed jobs.`
          }
        />
      </Head>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
        <nav className="mb-6 text-sm font-body">
          <Link href="/jobs" className="text-forest-600 hover:underline">
            Jobs
          </Link>
          <span className="text-[#8aaa8a] mx-2">/</span>
          <span className="text-forest-900">Profile</span>
        </nav>

        <div className="card border border-forest-100/80 shadow-sm space-y-6">
          {/* Header */}
          <div>
            <h1 className="font-display text-2xl font-bold text-forest-900 mb-1">
              {profile.displayName || "Anonymous Freelancer"}
            </h1>
            <p className="font-mono text-sm text-[#8aaa8a] break-all">
              {publicKey}
            </p>
          </div>

          {/* Bio */}
          {profile.bio && (
            <p className="text-[#5a7a5a] font-body whitespace-pre-wrap">
              {profile.bio}
            </p>
          )}

          {/* Stats */}
          <dl className="grid grid-cols-2 gap-4 text-sm font-body">
            <div className="bg-forest-50 rounded-xl p-4">
              <dt className="text-[#8aaa8a] uppercase tracking-wide text-xs font-bold mb-1">
                Completed Jobs
              </dt>
              <dd className="text-2xl font-bold text-forest-900">
                {profile.completedJobs}
              </dd>
            </div>
            <div className="bg-forest-50 rounded-xl p-4">
              <dt className="text-[#8aaa8a] uppercase tracking-wide text-xs font-bold mb-1">
                Total Earned
              </dt>
              <dd className="text-2xl font-bold text-forest-900">
                {profile.totalEarnedXLM}{" "}
                <span className="text-sm font-normal text-[#5a7a5a]">XLM</span>
              </dd>
            </div>
          </dl>

          {/* Skills */}
          {profile.skills.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wide text-[#8aaa8a] mb-2 font-body">
                Skills
              </h2>
              <div className="flex flex-wrap gap-2">
                {profile.skills.map((skill) => (
                  <span
                    key={skill}
                    className="px-3 py-1 rounded-full bg-forest-100 text-forest-800 text-sm font-body"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Stellar Expert link */}
          {publicKey && (
            <a
              href={accountUrl(publicKey)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              View on Stellar Expert ↗
            </a>
          )}
        </div>
      </div>
    </>
  );
}
