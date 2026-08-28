/**
 * pages/admin/index.tsx — Admin dashboard listing all projects with status.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { fetchProjects, updateProjectStatus, registerProjectOnChain, confirmProjectRegistration } from "@/lib/api";
import { formatXLM, shortenAddress } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";

interface AdminIndexProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function AdminIndex({ publicKey, onConnect }: AdminIndexProps) {
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The initial, wallet-driven load is tracked by comparing the wallet the
  // project list was loaded for to the currently connected wallet (derived,
  // rather than toggled synchronously inside an effect). Approve/reject
  // actions run from event handlers, so they can set `manualLoading`
  // directly.
  const [loadedForKey, setLoadedForKey] = useState<string | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const loading = manualLoading || loadedForKey !== publicKey;

  const loadProjects = () => {
    return fetchProjects({ limit: 100 })
      .then((data) => {
        setProjects(data);
        setError(null);
      })
      .catch((e: unknown) => setError((e as Error).message || "Failed to load projects"));
  };

  useEffect(() => {
    if (!publicKey) return;
    loadProjects().finally(() => setLoadedForKey(publicKey));
  }, [publicKey]);

  const handleApprove = async (p: ClimateProject) => {
    if (!publicKey) return;
    try {
      setManualLoading(true);
      const reg = await registerProjectOnChain({
        projectId: p.id,
        name: p.name,
        wallet: p.walletAddress,
        co2PerXLM: 1, // default or fetch from project
        adminAddress: publicKey,
      });
      // Mock signing step since auto-confirm is requested
      await confirmProjectRegistration({
        projectId: p.id,
        transactionHash: "mock-tx-hash-auto-confirmed", // MOCK since no real wallet sign requested in issue
      });
      await updateProjectStatus(p.id, "active");
      await loadProjects();
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to approve project");
    } finally {
      setManualLoading(false);
    }
  };

  const handleReject = async (p: ClimateProject) => {
    const reason = window.prompt("Enter rejection reason:");
    if (reason === null) return;
    try {
      setManualLoading(true);
      await updateProjectStatus(p.id, "rejected", reason);
      await loadProjects();
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to reject project");
    } finally {
      setManualLoading(false);
    }
  };

  const pendingProjects = projects.filter(p => (p.status as string) === 'pending');
  const otherProjects = projects.filter(p => (p.status as string) !== 'pending');

  if (!publicKey) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-forest-900 mb-3">Admin Dashboard</h1>
          <p className="text-[#5a7a5a] dark:text-[#8aaa8a] font-body">Connect your wallet to manage projects.</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <div className="mb-8">
        <p className="text-xs tracking-[0.22em] uppercase text-[#8aaa8a] dark:text-forest-300 font-body">Admin</p>
        <h1 className="font-display text-3xl font-bold text-forest-900 mb-1">All Projects</h1>
        <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
          Manage project approvals, registrations, and match funds.
        </p>
      </div>

      {loading && (
        <div className="card animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-forest-100 rounded" />
          ))}
        </div>
      )}

      {error && (
        <div className="card">
          <p className="text-red-600 font-body">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-8">
          {pendingProjects.length > 0 && (
            <div>
              <h2 className="font-display text-xl font-bold text-forest-900 mb-4">Pending Verification</h2>
              <div className="space-y-3">
                {pendingProjects.map((p) => (
                  <div key={p.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-l-4 border-amber-400">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Link href={`/admin/${p.id}`} className="font-display font-semibold text-forest-900 hover:underline truncate">
                          {p.name}
                        </Link>
                        <span className="badge bg-amber-50 text-amber-700 border-amber-200 text-xs flex-shrink-0">
                          pending
                        </span>
                      </div>
                      <p className="text-xs text-[#8aaa8a] font-body mb-2">
                        {p.category} • {p.location} • {formatXLM(p.raisedXLM)} goal
                      </p>
                      {/* Note: In a real app we'd display org details from the database here. Assuming standard project details for now. */}
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => handleApprove(p)}
                        className="btn-primary text-xs px-3 py-1.5"
                      >
                        Approve
                      </button>
                      <button 
                        onClick={() => handleReject(p)}
                        className="btn-secondary text-xs px-3 py-1.5 text-red-600 border-red-200 hover:bg-red-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="font-display text-xl font-bold text-forest-900 mb-4">All Projects</h2>
            <div className="space-y-3">
              {otherProjects.map((p) => (
                <Link
                  key={p.id}
                  href={`/admin/${p.id}`}
                  className="card-hover flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="font-display font-semibold text-forest-900 truncate">{p.name}</h2>
                      <span
                        className={`badge text-xs flex-shrink-0 ${
                          p.status === "active"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : p.status === "rejected"
                              ? "bg-red-50 text-red-700 border-red-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {p.status}
                      </span>
                      {p.onChainVerified && (
                        <span className="badge-verified text-xs flex-shrink-0">On-chain ✓</span>
                      )}
                    </div>
                    <p className="text-xs text-[#8aaa8a] font-body">
                      {p.category} • {p.location} • {formatXLM(p.raisedXLM)} raised
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#5a7a5a] font-body">
                    <span>{p.donorCount} donors</span>
                    <span>→</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
