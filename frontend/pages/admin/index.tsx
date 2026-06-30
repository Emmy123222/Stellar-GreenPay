/**
 * pages/admin/index.tsx — Admin dashboard listing all projects with status.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { fetchProjects } from "@/lib/api";
import { formatXLM, shortenAddress } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";

interface AdminIndexProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function AdminIndex({ publicKey, onConnect }: AdminIndexProps) {
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    setLoading(true);
    fetchProjects({ limit: 100 })
      .then(setProjects)
      .catch((e: unknown) => setError((e as Error).message || "Failed to load projects"))
      .finally(() => setLoading(false));
  }, [publicKey]);

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
        <div className="space-y-3">
          {projects.map((p) => (
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
                <p className="text-xs text-[#8aaa8a] dark:text-forest-300 font-body">
                  {p.category} • {p.location} • {formatXLM(p.raisedXLM)} raised
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
                <span>{p.donorCount} donors</span>
                <span>→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
