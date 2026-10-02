/**
 * pages/admin/verification/[id].tsx
 *
 * Protected admin page that displays the full details of a single verification
 * request and lets an admin approve or reject it.
 *
 * Route: /admin/verification/:id
 *
 * Auth model (matches backend middleware/auth.js):
 *   The page reads `adminToken` from sessionStorage (set by /admin/login).
 *   Every API call carries `Authorization: Bearer <token>` via the
 *   fetchVerificationRequestAdmin / updateVerificationRequestStatus helpers.
 *   If no token is present the user is redirected to /admin/login.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import {
  fetchVerificationRequestAdmin,
  fetchVerificationRequestDocuments,
  updateVerificationRequestStatus,
  type VerificationDocument,
  type VerificationRequestResponse,
} from "@/lib/api";
import { timeAgo } from "@/utils/format";

interface AdminVerificationDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  in_review: "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

// Which buttons are shown for each current status (mirrors backend VALID_TRANSITIONS)
const AVAILABLE_ACTIONS: Record<string, Array<"in_review" | "approved" | "rejected" | "pending">> = {
  pending: ["in_review", "rejected"],
  in_review: ["approved", "rejected", "pending"],
  approved: [],
  rejected: ["pending"],
};

// ── Detail row helper ──────────────────────────────────────────────────────────

// sessionStorage isn't available during SSR, so this renders null (matching
// the server) during SSR and initial hydration, then swaps to the real
// stored token right after mount — useSyncExternalStore is the
// React-recommended way to do this without a manual effect + setState.
function readAdminTokenFromStorage(): string | null {
  return sessionStorage.getItem("adminToken");
}
function subscribeToAdminToken() {
  return () => {};
}
function getServerAdminToken(): string | null {
  return null;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 py-2.5 border-b border-forest-100 last:border-0">
      <dt className="text-xs font-medium text-[#8aaa8a] uppercase tracking-wide w-48 flex-shrink-0 font-body">
        {label}
      </dt>
      <dd className="text-sm text-forest-900 font-body break-words min-w-0">{value ?? "—"}</dd>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminVerificationDetail({
  publicKey,
  onConnect,
}: AdminVerificationDetailProps) {
  const router = useRouter();
  const { id } = router.query;

  const adminToken = useSyncExternalStore(subscribeToAdminToken, readAdminTokenFromStorage, getServerAdminToken);
  const [request, setRequest] = useState<VerificationRequestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `loading` is derived by comparing the request that's currently in
  // flight to the last one that resolved, rather than toggled synchronously
  // inside the effect (which triggers a cascading render).
  const [loadedForKey, setLoadedForKey] = useState<string | null>(null);

  // Moderation state
  const [actionState, setActionState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  // Lazy-loaded supporting documents (fetched on scroll / expand).
  const [documents, setDocuments] = useState<VerificationDocument[] | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentsExpanded, setDocumentsExpanded] = useState(false);
  const documentsSectionRef = useRef<HTMLDivElement | null>(null);
  const documentsLoadedRef = useRef(false);

  // ── Redirect to login if there's no admin token ──────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!adminToken) {
      router.replace("/admin/login");
    }
  }, [adminToken, router]);

  // ── Fetch verification request ───────────────────────────────────────────────
  const requestKey = adminToken && typeof id === "string" ? `${adminToken}:${id}` : null;
  const loading = requestKey !== null && loadedForKey !== requestKey;

  useEffect(() => {
    if (!adminToken || !id || typeof id !== "string") return;

    fetchVerificationRequestAdmin(id, adminToken)
      .then((data) => {
        setRequest(data);
        setError(null);
      })
      .catch((e: unknown) => {
        const msg = (e as Error).message || "Failed to load verification request";
        setError(msg);
      })
      .finally(() => setLoadedForKey(`${adminToken}:${id}`));
  }, [adminToken, id]);

  // ── Lazy-load supporting documents once expanded ────────────────────────────
  const loadDocuments = useCallback(async () => {
    if (!request || documentsLoadedRef.current) return;
    documentsLoadedRef.current = true;
    setDocumentsLoading(true);
    setDocumentsError(null);
    try {
      const docs = await fetchVerificationRequestDocuments(request.id, adminToken as string);
      setDocuments(docs);
    } catch (e: unknown) {
      // Allow a retry on transient failures.
      documentsLoadedRef.current = false;
      setDocumentsError((e as Error).message || "Failed to load documents");
    } finally {
      setDocumentsLoading(false);
    }
  }, [request, adminToken]);

  useEffect(() => {
    if (documentsExpanded && request && request.documentCount > 0) {
      // Deferred via a microtask (rather than called synchronously) so this
      // effect doesn't itself perform a synchronous setState; loadDocuments
      // guards re-entrancy itself via documentsLoadedRef.
      queueMicrotask(() => {
        loadDocuments();
      });
    }
  }, [documentsExpanded, request, loadDocuments]);

  // Load automatically when the documents section is scrolled near the viewport.
  useEffect(() => {
    if (documentsExpanded || !request || request.documentCount === 0) return;
    const el = documentsSectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          setDocumentsExpanded(true);
        }
      },
      { rootMargin: "250px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [documentsExpanded, request]);

  // ── Status transition handler ────────────────────────────────────────────────
  const handleStatusChange = async (
    newStatus: "pending" | "in_review" | "approved" | "rejected",
  ) => {
    if (!adminToken || !request) return;

    const label = newStatus.replace("_", " ");
    const confirmMsg =
      newStatus === "approved"
        ? `Approve "${request.projectName}"? This cannot be undone without further action.`
        : newStatus === "rejected"
          ? `Reject "${request.projectName}"? The submitter will see the "rejected" status.`
          : `Move "${request.projectName}" to "${label}"?`;

    if (!window.confirm(confirmMsg)) return;

    setActionState("loading");
    setActionError(null);
    setPendingAction(newStatus);

    try {
      const updated = await updateVerificationRequestStatus(
        request.id,
        newStatus,
        adminToken,
        reviewerNotes.trim() || undefined,
      );
      setRequest(updated);
      setReviewerNotes("");
      setActionState("success");
      setTimeout(() => setActionState("idle"), 2500);
    } catch (e: unknown) {
      setActionError((e as Error).message || "Failed to update status");
      setActionState("error");
    } finally {
      setPendingAction(null);
    }
  };

  // ── Render guards ────────────────────────────────────────────────────────────

  if (!publicKey) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-3xl font-bold text-forest-900 mb-3">Admin</h1>
        <p className="text-[#5a7a5a] font-body mb-8">Connect your wallet to continue.</p>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-pulse space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-5 bg-forest-100 rounded" />
        ))}
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="card text-center">
          <p className="text-red-600 font-body mb-4">{error ?? "Verification request not found."}</p>
          <Link href="/admin" className="btn-secondary text-sm">
            ← Back to Admin
          </Link>
        </div>
      </div>
    );
  }

  const availableActions = AVAILABLE_ACTIONS[request.status] ?? [];

  // ── Main render ──────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-[#8aaa8a] font-body mb-6">
        <Link href="/admin" className="hover:text-forest-700 transition-colors">Admin</Link>
        <span>/</span>
        <span className="text-forest-900">Verification #{request.id.slice(0, 8)}</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.22em] uppercase text-[#8aaa8a] font-body">Verification Request</p>
          <h1 className="font-display text-2xl font-bold text-forest-900 mt-0.5">
            {request.projectName}
          </h1>
          <p className="text-sm text-[#5a7a5a] font-body mt-0.5">{request.organizationName}</p>
        </div>
        <span
          className={`badge text-sm px-3 py-1 self-start sm:self-center border rounded-full font-medium ${STATUS_CLASSES[request.status] ?? "bg-gray-50 text-gray-700 border-gray-200"}`}
        >
          {request.status.replace("_", " ")}
        </span>
      </div>

      {/* ── Organisation details ──────────────────────────────────────────────── */}
      <section className="card mb-6">
        <h2 className="font-display text-base font-semibold text-forest-900 mb-3">
          Organisation
        </h2>
        <dl>
          <DetailRow label="Organisation" value={request.organizationName} />
          <DetailRow
            label="Website"
            value={
              request.organizationWebsite ? (
                <a
                  href={request.organizationWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-forest-600 hover:underline break-all"
                >
                  {request.organizationWebsite}
                </a>
              ) : null
            }
          />
          <DetailRow label="Country" value={request.organizationCountry} />
          <DetailRow
            label="Contact email"
            value={
              <a href={`mailto:${request.contactEmail}`} className="text-forest-600 hover:underline">
                {request.contactEmail}
              </a>
            }
          />
          <DetailRow label="Wallet address" value={
            <span className="font-mono text-xs break-all">{request.walletAddress}</span>
          } />
        </dl>
      </section>

      {/* ── Project info ─────────────────────────────────────────────────────── */}
      <section className="card mb-6">
        <h2 className="font-display text-base font-semibold text-forest-900 mb-3">
          Project Info
        </h2>
        <dl>
          <DetailRow label="Project name" value={request.projectName} />
          <DetailRow label="Category" value={request.projectCategory} />
          <DetailRow label="Location" value={request.projectLocation} />
          <DetailRow
            label="CO₂ per XLM"
            value={
              <span>
                <strong>{Number(request.co2PerXLM).toFixed(4)}</strong>{" "}
                <span className="text-xs text-[#8aaa8a]">kg CO₂ / XLM</span>
              </span>
            }
          />
          <DetailRow
            label="Expected annual CO₂"
            value={
              request.expectedAnnualTonnesCO2
                ? `${Number(request.expectedAnnualTonnesCO2).toLocaleString()} tonnes / year`
                : null
            }
          />
          {request.projectDescription && (
            <DetailRow
              label="Description"
              value={
                <p className="whitespace-pre-line text-sm leading-relaxed">
                  {request.projectDescription}
                </p>
              }
            />
          )}
          {request.notes && (
            <DetailRow
              label="Applicant notes"
              value={<p className="whitespace-pre-line text-sm leading-relaxed">{request.notes}</p>}
            />
          )}
        </dl>
      </section>

      {/* ── Supporting documents (lazy-loaded on scroll / expand) ──────────── */}
      <section className="card mb-6" ref={documentsSectionRef}>
        <h2 className="font-display text-base font-semibold text-forest-900 mb-3">
          Supporting Documents
          {(request.documentCount ?? request.supportingDocuments.length) > 0 && (
            <span className="ml-2 text-xs font-normal text-[#8aaa8a]">
              ({(request.documentCount ?? request.supportingDocuments.length)})
            </span>
          )}
        </h2>

        {(() => {
          const docCount = request.documentCount ?? request.supportingDocuments.length;

          if (docCount === 0) {
            return (
              <p className="text-sm text-[#8aaa8a] font-body italic">No documents uploaded.</p>
            );
          }

          if (documents === null) {
            return (
              <div className="animate-fade-in">
                <p className="text-sm text-[#8aaa8a] font-body mb-3">
                  {docCount} supporting document{docCount === 1 ? "" : "s"} attached to this
                  submission.
                </p>
                {documentsError ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-red-600 font-body">{documentsError}</p>
                    <button
                      onClick={loadDocuments}
                      className="btn-secondary text-sm px-4 py-2"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDocumentsExpanded(true)}
                    disabled={documentsLoading}
                    className="btn-secondary text-sm px-4 py-2 disabled:opacity-60"
                  >
                    {documentsLoading ? "Loading documents…" : `Expand documents (${docCount})`}
                  </button>
                )}
              </div>
            );
          }

          return (
            <ul className="space-y-2">
              {documents.map((doc, index) => (
                <li key={index}>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 rounded-lg border border-forest-100 hover:border-forest-300 hover:bg-forest-50/50 transition-colors group"
                  >
                    {/* File icon */}
                    <span className="text-forest-400 group-hover:text-forest-600 transition-colors flex-shrink-0">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </span>

                    {/* Name + size */}
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-forest-900 group-hover:text-forest-700 truncate block">
                        {doc.name}
                      </span>
                      {doc.size !== undefined && (
                        <span className="text-xs text-[#8aaa8a]">
                          {doc.size < 1024 * 1024
                            ? `${(doc.size / 1024).toFixed(1)} KB`
                            : `${(doc.size / (1024 * 1024)).toFixed(1)} MB`}
                        </span>
                      )}
                    </span>

                    {/* Download arrow */}
                    <span className="text-forest-400 group-hover:text-forest-600 transition-colors flex-shrink-0">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          );
        })()}
      </section>

      {/* ── Review history ───────────────────────────────────────────────────── */}
      {(request.reviewerNotes || request.reviewedBy || request.reviewedAt) && (
        <section className="card mb-6">
          <h2 className="font-display text-base font-semibold text-forest-900 mb-3">
            Review History
          </h2>
          <dl>
            {request.reviewedBy && <DetailRow label="Reviewed by" value={request.reviewedBy} />}
            {request.reviewedAt && (
              <DetailRow
                label="Reviewed at"
                value={
                  <>
                    {new Date(request.reviewedAt).toLocaleString()}{" "}
                    <span className="text-xs text-[#8aaa8a]">({timeAgo(request.reviewedAt)})</span>
                  </>
                }
              />
            )}
            {request.reviewerNotes && (
              <DetailRow
                label="Reviewer notes"
                value={
                  <p className="whitespace-pre-line text-sm leading-relaxed">
                    {request.reviewerNotes}
                  </p>
                }
              />
            )}
          </dl>
        </section>
      )}

      {/* ── Moderation panel ─────────────────────────────────────────────────── */}
      {availableActions.length > 0 && (
        <section className="card border-2 border-forest-200">
          <h2 className="font-display text-base font-semibold text-forest-900 mb-4">
            Moderation
          </h2>

          {/* Reviewer notes */}
          <div className="mb-4">
            <label
              htmlFor="reviewer-notes"
              className="block text-xs font-medium text-[#5a7a5a] uppercase tracking-wide mb-1.5 font-body"
            >
              Reviewer notes <span className="normal-case text-[#8aaa8a]">(optional)</span>
            </label>
            <textarea
              id="reviewer-notes"
              rows={3}
              value={reviewerNotes}
              onChange={(e) => setReviewerNotes(e.target.value)}
              placeholder="Reason for decision, conditions, or follow-up notes…"
              maxLength={2000}
              className="w-full rounded-lg border border-forest-200 bg-white px-3 py-2 text-sm text-forest-900 placeholder-[#8aaa8a] focus:outline-none focus:ring-2 focus:ring-forest-400 font-body resize-none"
              disabled={actionState === "loading"}
            />
            <p className="text-right text-xs text-[#8aaa8a] mt-1 font-body">
              {reviewerNotes.length}/2000
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            {availableActions.includes("in_review") && (
              <button
                onClick={() => handleStatusChange("in_review")}
                disabled={actionState === "loading"}
                className="btn-secondary text-sm px-4 py-2 text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-50"
              >
                {pendingAction === "in_review" ? "Moving…" : "Mark In Review"}
              </button>
            )}
            {availableActions.includes("approved") && (
              <button
                onClick={() => handleStatusChange("approved")}
                disabled={actionState === "loading"}
                className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
              >
                {pendingAction === "approved" ? "Approving…" : "✓ Approve"}
              </button>
            )}
            {availableActions.includes("rejected") && (
              <button
                onClick={() => handleStatusChange("rejected")}
                disabled={actionState === "loading"}
                className="btn-secondary text-sm px-4 py-2 text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-50"
              >
                {pendingAction === "rejected" ? "Rejecting…" : "✕ Reject"}
              </button>
            )}
            {availableActions.includes("pending") && (
              <button
                onClick={() => handleStatusChange("pending")}
                disabled={actionState === "loading"}
                className="btn-secondary text-sm px-4 py-2 disabled:opacity-50"
              >
                {pendingAction === "pending" ? "Resetting…" : "Reset to Pending"}
              </button>
            )}
          </div>

          {/* Feedback messages */}
          {actionState === "success" && (
            <p className="mt-3 text-sm text-emerald-700 font-body animate-fade-in">
              ✓ Status updated successfully.
            </p>
          )}
          {actionState === "error" && actionError && (
            <p className="mt-3 text-sm text-red-600 font-body">{actionError}</p>
          )}
        </section>
      )}

      {/* Closed state — nothing more can be done */}
      {availableActions.length === 0 && request.status === "approved" && (
        <div className="card text-center bg-emerald-50 border-emerald-200">
          <p className="text-emerald-700 font-body text-sm">
            ✓ This request has been approved. No further action is required.
          </p>
        </div>
      )}

      {/* Submission metadata footer */}
      <p className="mt-6 text-xs text-[#8aaa8a] font-body text-center">
        Submitted {request.submittedAt ? timeAgo(request.submittedAt) : "—"}
        {request.storageBackend && (
          <span className="ml-2 opacity-60">· storage: {request.storageBackend}</span>
        )}
      </p>
    </div>
  );
}
