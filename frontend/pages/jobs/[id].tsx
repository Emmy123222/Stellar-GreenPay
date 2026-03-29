/**
 * pages/jobs/[id].tsx — Job detail; client approves on-chain release_escrow then backend syncs.
 */
import { useRouter } from "next/router";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { fetchJob, completeJobRelease } from "@/lib/api";
import {
  buildReleaseEscrowTransaction,
  submitTransaction,
  explorerUrl,
  ESCROW_CONTRACT_ID,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { shortenAddress } from "@/utils/format";
import type { EscrowJob } from "@/utils/types";

interface JobPageProps {
  publicKey: string | null;
  onConnect: () => void;
}

type Step =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "recording"
  | "success"
  | "error";

export default function JobDetailPage({ publicKey, onConnect }: JobPageProps) {
  const router = useRouter();
  const rawId = router.query.id;
  const jobId = typeof rawId === "string" ? rawId : undefined;

  const [job, setJob] = useState<EscrowJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [releaseHash, setReleaseHash] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const j = await fetchJob(jobId);
      setJob(j);
    } catch {
      setLoadError("Could not load this job. Check the link or try again later.");
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!router.isReady || !jobId) return;
    load();
  }, [router.isReady, jobId, load]);

  const isClient =
    Boolean(publicKey && job && publicKey === job.clientPublicKey);
  const canRelease =
    Boolean(
      job &&
        job.status === "in_escrow" &&
        isClient &&
        ESCROW_CONTRACT_ID,
    );

  const handleApproveRelease = async () => {
    if (!job || !publicKey || !ESCROW_CONTRACT_ID) return;
    if (step !== "idle") return;
    setActionError(null);
    setReleaseHash(null);
    setSyncWarning(null);

    try {
      setStep("building");
      const tx = await buildReleaseEscrowTransaction({
        contractId: ESCROW_CONTRACT_ID,
        jobId: job.id,
        clientAddress: publicKey,
      });

      setStep("signing");
      const { signedXDR, error: signErr } = await signTransactionWithWallet(
        tx.toXDR(),
      );
      if (signErr || !signedXDR) {
        throw new Error(signErr || "Wallet did not return a signed transaction.");
      }

      setStep("submitting");
      const result = await submitTransaction(signedXDR);
      const hash = result.hash;
      setReleaseHash(hash);

      setStep("recording");
      try {
        const updated = await completeJobRelease(job.id, hash);
        setJob(updated);
      } catch {
        setJob((prev) =>
          prev
            ? {
                ...prev,
                status: "completed",
                releaseTransactionHash: hash,
              }
            : prev,
        );
        setSyncWarning(
          "Funds were released on-chain, but the server could not be updated. Save this transaction hash.",
        );
      }
      setStep("success");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setActionError(msg);
      setStep("error");
      setTimeout(() => {
        setStep("idle");
        setActionError(null);
      }, 5000);
    }
  };

  if (!router.isReady || loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center text-[#5a7a5a] font-body">
        Loading job…
      </div>
    );
  }

  if (!jobId || loadError || !job) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <p className="text-red-600 mb-4 font-body">{loadError || "Job not found."}</p>
        <Link href="/jobs" className="text-forest-600 hover:underline font-body">
          ← Back to jobs
        </Link>
      </div>
    );
  }

  const showSuccessBanner =
    step === "success" || job.status === "completed";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <nav className="mb-6 text-sm font-body">
        <Link href="/jobs" className="text-forest-600 hover:underline">
          Jobs
        </Link>
        <span className="text-[#8aaa8a] mx-2">/</span>
        <span className="text-forest-900">{job.title}</span>
      </nav>

      <div className="card border border-forest-100/80 shadow-sm">
        <h1 className="font-display text-2xl font-bold text-forest-900 mb-2">
          {job.title}
        </h1>
        <p className="text-[#5a7a5a] font-body whitespace-pre-wrap mb-6">
          {job.description}
        </p>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm font-body mb-6">
          <div>
            <dt className="text-[#8aaa8a] uppercase tracking-wide text-xs font-bold mb-1">
              Client
            </dt>
            <dd className="font-mono text-forest-800 break-all">
              {shortenAddress(job.clientPublicKey)}
            </dd>
          </div>
          <div>
            <dt className="text-[#8aaa8a] uppercase tracking-wide text-xs font-bold mb-1">
              Freelancer
            </dt>
            <dd className="font-mono text-forest-800 break-all">
              {shortenAddress(job.freelancerPublicKey)}
            </dd>
          </div>
          <div>
            <dt className="text-[#8aaa8a] uppercase tracking-wide text-xs font-bold mb-1">
              Escrow (XLM)
            </dt>
            <dd className="font-semibold text-forest-900">{job.amountEscrowXlm}</dd>
          </div>
          <div>
            <dt className="text-[#8aaa8a] uppercase tracking-wide text-xs font-bold mb-1">
              Status
            </dt>
            <dd className="font-semibold text-forest-900 capitalize">
              {job.status.replace("_", " ")}
            </dd>
          </div>
        </dl>

        {!publicKey && (
          <div className="mb-6 p-4 rounded-xl bg-forest-50 border border-forest-100">
            <p className="text-sm text-forest-800 font-body mb-3">
              Connect your wallet to approve release if you are the client.
            </p>
            <WalletConnect onConnect={onConnect} />
          </div>
        )}

        {publicKey && !isClient && job.status === "in_escrow" && (
          <p className="text-sm text-[#5a7a5a] font-body mb-4">
            Connected as {shortenAddress(publicKey)}. Only the client wallet can
            release this escrow.
          </p>
        )}

        {!ESCROW_CONTRACT_ID && job.status === "in_escrow" && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm font-body mb-4">
            Escrow contract is not configured. Set{" "}
            <code className="text-xs bg-amber-100 px-1 rounded">
              NEXT_PUBLIC_ESCROW_CONTRACT_ID
            </code>{" "}
            after deploying the escrow contract.
          </div>
        )}

        {canRelease && (
          <div className="space-y-3">
            {actionError && step === "error" && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-body">
                {actionError}
              </div>
            )}

            <button
              type="button"
              onClick={handleApproveRelease}
              disabled={step !== "idle"}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {step === "building" && "Building transaction…"}
              {step === "signing" && "Sign in Freighter…"}
              {step === "submitting" && "Submitting to network…"}
              {step === "recording" && "Updating job status…"}
              {step === "idle" && "Approve & release payment"}
              {step === "success" && "Done"}
              {step === "error" && "Try again"}
            </button>

            {step === "signing" && (
              <p className="text-center text-xs text-[#5a7a5a] animate-pulse font-body">
                Confirm the transaction in Freighter…
              </p>
            )}
          </div>
        )}

        {syncWarning && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm font-body">
            {syncWarning}
          </div>
        )}

        {showSuccessBanner && (releaseHash || job.releaseTransactionHash) && (
          <div className="mt-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
            <p className="font-semibold text-emerald-900 font-body mb-2">
              Payment released on-chain
            </p>
            <p className="text-sm text-emerald-800 font-mono break-all mb-2">
              {(releaseHash || job.releaseTransactionHash) ?? ""}
            </p>
            <a
              href={explorerUrl(
                (releaseHash || job.releaseTransactionHash) as string,
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-emerald-700 hover:underline font-body"
            >
              View on Stellar Expert ↗
            </a>
          </div>
        )}

        {job.status === "completed" && !job.releaseTransactionHash && (
          <p className="text-sm text-[#5a7a5a] mt-4 font-body">
            This job is marked completed.
          </p>
        )}
      </div>
    </div>
  );
}
