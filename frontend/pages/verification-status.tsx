/**
 * pages/verification-status.tsx — check verification request status by wallet
 */
import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import {
  fetchMyVerificationRequests,
  type VerificationRequestResponse,
} from "@/lib/api";

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

const STATUS_STYLES: Record<VerificationRequestResponse["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  in_review: "bg-sky-100 text-sky-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

function StatusSkeleton() {
  return (
    <div
      className="rounded-xl border border-forest-100 bg-white p-6 space-y-4"
      aria-busy="true"
      aria-label="Loading verification status"
    >
      <div className="flex items-center gap-3">
        <div className="h-6 w-24 rounded-full bg-forest-100 animate-pulse" />
        <div className="h-4 w-40 rounded bg-forest-100 animate-pulse" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-28 rounded bg-forest-100 animate-pulse" />
        <div className="h-4 w-48 rounded bg-forest-100 animate-pulse" />
      </div>
      <div className="space-y-2 pt-2 border-t border-forest-50">
        <div className="h-3 w-32 rounded bg-forest-100 animate-pulse" />
        <div className="h-16 w-full rounded bg-forest-100 animate-pulse" />
      </div>
    </div>
  );
}

function StatusCard({ request }: { request: VerificationRequestResponse }) {
  const submitted = request.submittedAt
    ? new Date(request.submittedAt).toLocaleString()
    : "—";

  return (
    <div className="rounded-xl border border-forest-100 bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${STATUS_STYLES[request.status]}`}
        >
          {request.status.replace("_", " ")}
        </span>
        <span className="text-sm text-[#5a7a5a] font-body">{request.projectName}</span>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-[#8aaa8a] font-body">Submitted</p>
        <p className="text-sm text-forest-900 font-body">{submitted}</p>
      </div>

      <div className="pt-2 border-t border-forest-50">
        <p className="text-xs uppercase tracking-wider text-[#8aaa8a] font-body">Reviewer notes</p>
        <p className="mt-1 text-sm text-forest-900 font-body whitespace-pre-wrap min-h-[4rem]">
          {request.reviewerNotes || "No reviewer notes yet."}
        </p>
      </div>
    </div>
  );
}

export default function VerificationStatusPage() {
  const [wallet, setWallet] = useState("");
  const [queryWallet, setQueryWallet] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [requests, setRequests] = useState<VerificationRequestResponse[]>([]);

  const load = useCallback(async (addr: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMyVerificationRequests(addr);
      setRequests(data);
    } catch (err) {
      setRequests([]);
      setError(err instanceof Error ? err.message : "Failed to load verification requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = (params.get("wallet") || "").trim();
    if (STELLAR_ADDRESS_RE.test(fromQuery)) {
      setWallet(fromQuery);
      setQueryWallet(fromQuery);
      void load(fromQuery);
    }
  }, [load]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const addr = wallet.trim();
    if (!STELLAR_ADDRESS_RE.test(addr)) {
      setError("Enter a valid Stellar address (56 chars, starts with G)");
      return;
    }
    setQueryWallet(addr);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("wallet", addr);
      window.history.replaceState({}, "", url.toString());
    }
    void load(addr);
  }

  return (
    <>
      <Head>
        <title>Verification Status | Stellar GreenPay</title>
      </Head>
      <main className="min-h-screen bg-gradient-to-b from-[#f4faf4] to-white px-4 py-12">
        <div className="mx-auto max-w-xl space-y-6">
          <div>
            <h1 className="font-display text-3xl font-bold text-forest-900">
              Verification status
            </h1>
            <p className="mt-2 text-sm text-[#5a7a5a] font-body">
              Look up your project verification request by Stellar wallet address.
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="G..."
              className="input flex-1 font-mono text-sm"
              aria-label="Stellar wallet address"
            />
            <button type="submit" className="btn-primary whitespace-nowrap">
              Check status
            </button>
          </form>

          {error && <p className="text-sm text-red-500 font-body">{error}</p>}

          {loading && <StatusSkeleton />}

          {!loading && queryWallet && requests.length === 0 && !error && (
            <p className="text-sm text-[#5a7a5a] font-body">
              No verification requests found for this wallet.
            </p>
          )}

          {!loading &&
            requests.map((request) => (
              <StatusCard key={request.id} request={request} />
            ))}
        </div>
      </main>
    </>
  );
}
