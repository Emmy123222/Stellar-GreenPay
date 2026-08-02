/**
 * pages/admin/verifications.tsx — Admin Verification Requests Queue
 * Lists all pending and in-review verification requests for approval.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { fetchVerificationRequests, updateVerificationRequestStatus, VerificationRequestResponse } from "@/lib/api";
import { formatDate } from "@/utils/format";

interface AdminVerificationsProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function AdminVerifications({ publicKey, onConnect }: AdminVerificationsProps) {
  const [requests, setRequests] = useState<VerificationRequestResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRequests = () => {
    setLoading(true);
    fetchVerificationRequests()
      .then(data => {
        // Only show pending and in_review
        const filtered = data.filter(r => r.status === 'pending' || r.status === 'in_review');
        setRequests(filtered);
      })
      .catch((e: unknown) => setError((e as Error).message || "Failed to load requests"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!publicKey) return;
    loadRequests();
  }, [publicKey]);

  const handleApprove = async (id: string) => {
    const reason = window.prompt("Enter approval note (optional):");
    if (reason === null) return;
    try {
      setLoading(true);
      await updateVerificationRequestStatus(id, "approved", reason);
      loadRequests();
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to approve request");
      setLoading(false);
    }
  };

  const handleReject = async (id: string) => {
    const reason = window.prompt("Enter rejection reason:");
    if (reason === null) return;
    try {
      setLoading(true);
      await updateVerificationRequestStatus(id, "rejected", reason);
      loadRequests();
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to reject request");
      setLoading(false);
    }
  };

  if (!publicKey) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-forest-900 mb-3">Admin Verifications</h1>
          <p className="text-[#5a7a5a] dark:text-[#8aaa8a] font-body">Connect your wallet to manage verification requests.</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <div className="mb-8">
        <p className="text-xs tracking-[0.22em] uppercase text-[#8aaa8a] dark:text-forest-300 font-body">Admin</p>
        <h1 className="font-display text-3xl font-bold text-forest-900 mb-1">Verification Queue</h1>
        <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
          Review pending and in-review organization requests.
        </p>
      </div>

      {loading && (
        <div className="card animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-forest-100 rounded" />
          ))}
        </div>
      )}

      {error && (
        <div className="card">
          <p className="text-red-600 font-body">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {requests.length === 0 ? (
            <div className="card text-center text-[#8aaa8a] font-body py-10">
              No pending or in-review requests.
            </div>
          ) : (
            requests.map((req) => (
              <div key={req.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-l-4 border-amber-400">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="font-display font-semibold text-forest-900 truncate">
                      {req.organizationName}
                    </h2>
                    <span className={`badge text-xs flex-shrink-0 ${req.status === 'in_review' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                      {req.status === 'in_review' ? 'in review' : req.status}
                    </span>
                  </div>
                  <p className="text-sm text-forest-800 font-body mb-1">
                    <span className="font-semibold">Project:</span> {req.projectName}
                  </p>
                  <p className="text-xs text-[#8aaa8a] font-body">
                    {req.projectCategory} • Submitted: {formatDate(req.submittedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link href={`/admin/verifications/${req.id}`} className="text-xs text-forest-600 hover:text-forest-800 underline font-body mr-2">
                    View details &rarr;
                  </Link>
                  <button 
                    onClick={() => handleApprove(req.id)}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    Approve
                  </button>
                  <button 
                    onClick={() => handleReject(req.id)}
                    className="btn-secondary text-xs px-3 py-1.5 text-red-600 border-red-200 hover:bg-red-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
