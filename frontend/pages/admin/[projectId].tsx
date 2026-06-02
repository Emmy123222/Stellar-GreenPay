import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { createProjectUpdate, fetchProject, fetchProjectDonations, updateProjectStatus, registerProjectOnChain, confirmProjectRegistration, fetchProjectMatches, csrfFetch } from "@/lib/api";
import { buildMilestoneTransaction, submitTransaction } from "@/lib/stellar";
import { formatCO2, formatXLM, shortenAddress, timeAgo } from "@/utils/format";
import type { ClimateProject, Donation } from "@/utils/types";

const DonationGrowthChartNoSSR = dynamic(
  () => import("@/components/DonationGrowthChart"),
  { ssr: false },
);

interface AdminProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

function weekKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  // ISO week-like key (YYYY-WW) using UTC week start (Mon)
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export default function ProjectAdmin({ publicKey, onConnect }: AdminProps) {
  const router = useRouter();
  const { projectId } = router.query;

  const [project, setProject] = useState<ClimateProject | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [updateTitle, setUpdateTitle] = useState("");
  const [updateBody, setUpdateBody] = useState("");
  const [postingState, setPostingState] = useState<"idle" | "posting" | "success" | "error">("idle");
  const [postingError, setPostingError] = useState<string | null>(null);

  const [milestones, setMilestones] = useState<any[]>([]);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState("");
  const [newMilestonePercentage, setNewMilestonePercentage] = useState<number>(25);
  const [milestoneActionState, setMilestoneActionState] = useState<"idle" | "loading" | "success" | "error">("idle");

  const [approvalState, setApprovalState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const [onChainState, setOnChainState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [onChainMessage, setOnChainMessage] = useState<string | null>(null);

  const [matches, setMatches] = useState<any[]>([]);

  useEffect(() => {
    if (!projectId || typeof projectId !== "string") return;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchProject(projectId),
      fetchProjectDonations(projectId, 200).then((r) => r.donations),
      fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/projects/${projectId}/milestones`).then(r => r.json()),
      fetchProjectMatches(projectId).catch(() => []),
    ])
      .then(([p, d, m, mt]) => {
        setProject(p);
        setDonations(d);
        setMilestones(m.data || []);
        setMatches(mt);
      })
      .catch((e: unknown) => setError((e as Error).message || "Failed to load project"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const isOwner = !!publicKey && !!project && publicKey === project.walletAddress;

  const donorBreakdown = useMemo(() => {
    const byDonor = new Map<string, { donorAddress: string; total: number; count: number }>();
    for (const d of donations) {
      const donorAddress = d.donorAddress;
      const amount = parseFloat(d.amountXLM || d.amount || "0");
      const curr = byDonor.get(donorAddress) || { donorAddress, total: 0, count: 0 };
      curr.total += Number.isFinite(amount) ? amount : 0;
      curr.count += 1;
      byDonor.set(donorAddress, curr);
    }
    return Array.from(byDonor.values()).sort((a, b) => b.total - a.total);
  }, [donations]);

  const weeklyGrowth = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const d of donations) {
      const key = weekKey(d.createdAt);
      const amount = parseFloat(d.amountXLM || d.amount || "0");
      byWeek.set(key, (byWeek.get(key) || 0) + (Number.isFinite(amount) ? amount : 0));
    }
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, totalXLM]) => ({ week, totalXLM: Number(totalXLM.toFixed(2)) }));
  }, [donations]);

  const downloadCsv = () => {
    const header = ["donorAddress", "totalXLM", "donationCount"];
    const lines = donorBreakdown.map((d) => [d.donorAddress, d.total.toFixed(7), String(d.count)]);
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/\"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `donor-report-${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const postUpdate = async () => {
    if (!project) return;
    if (!updateTitle.trim() || !updateBody.trim()) {
      setPostingError("Title and body are required.");
      setPostingState("error");
      return;
    }
    setPostingState("posting");
    setPostingError(null);
    try {
      await createProjectUpdate({
        projectId: project.id,
        title: updateTitle.trim(),
        body: updateBody.trim(),
      });
      setUpdateTitle("");
      setUpdateBody("");
      setPostingState("success");
      setTimeout(() => setPostingState("idle"), 2000);
    } catch (e: unknown) {
      setPostingError((e as Error).message || "Failed to post update");
      setPostingState("error");
    }
  };

  const addMilestone = async () => {
    if (!project || !newMilestoneTitle.trim()) return;
    setMilestoneActionState("loading");
    try {
      const res = await csrfFetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/projects/${project.id}/milestones`, {
        method: "POST",
        body: JSON.stringify({ title: newMilestoneTitle.trim(), percentage: newMilestonePercentage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add milestone");
      setMilestones([...milestones, data.data].sort((a, b) => a.percentage - b.percentage));
      setNewMilestoneTitle("");
      setMilestoneActionState("success");
      setTimeout(() => setMilestoneActionState("idle"), 2000);
    } catch (e: any) {
      alert(e.message);
      setMilestoneActionState("error");
    }
  };

  const recordMilestoneOnChain = async (milestone: any) => {
    if (!publicKey) return;
    setMilestoneActionState("loading");
    try {
      // 1. Build & Sign transaction
      const tx = await buildMilestoneTransaction({
        publicKey,
        milestoneTitle: milestone.title,
      });
      
      // Since we are in a browser, we'd normally use Freighter to sign.
      // For this demo, we'll assume the user signs via their wallet extension.
      const { signedXDR } = await (window as any).stellarWallets.signTransaction(tx.toXDR());
      
      // 2. Submit to Stellar
      const result = await submitTransaction(signedXDR);
      
      // 3. Update backend
      const res = await csrfFetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/projects/${project?.id}/milestones/${milestone.id}/reach`, {
        method: "POST",
        body: JSON.stringify({ transactionHash: result.hash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update milestone status");
      
      setMilestones(milestones.map(m => m.id === milestone.id ? data.data : m));
      setMilestoneActionState("success");
      setTimeout(() => setMilestoneActionState("idle"), 2000);
    } catch (e: any) {
      alert(e.message);
      setMilestoneActionState("error");
    }
  };

  const handleApprove = async () => {
    if (!project) return;
    setApprovalState("loading");
    setApprovalMessage(null);
    try {
      const updated = await updateProjectStatus(project.id, "active");
      setProject(updated);
      setApprovalMessage("Project approved successfully");
      setApprovalState("success");
      setTimeout(() => setApprovalState("idle"), 3000);
    } catch (e: any) {
      setApprovalMessage(e.message || "Failed to approve project");
      setApprovalState("error");
    }
  };

  const handleReject = async () => {
    if (!project || !rejectionReason.trim()) return;
    setApprovalState("loading");
    setApprovalMessage(null);
    try {
      const updated = await updateProjectStatus(project.id, "rejected", rejectionReason.trim());
      setProject(updated);
      setApprovalMessage("Project rejected");
      setApprovalState("success");
      setRejectionReason("");
      setTimeout(() => setApprovalState("idle"), 3000);
    } catch (e: any) {
      setApprovalMessage(e.message || "Failed to reject project");
      setApprovalState("error");
    }
  };

  const handleRegisterOnChain = async () => {
    if (!project || !publicKey) return;
    setOnChainState("loading");
    setOnChainMessage(null);
    try {
      const result = await registerProjectOnChain({
        projectId: project.id,
        name: project.name,
        wallet: project.walletAddress,
        co2PerXLM: project.co2_per_xlm || 0,
        adminAddress: publicKey,
      });
      // Sign the XDR with wallet
      const { signedXDR } = await (window as any).stellarWallets.signTransaction(result.xdr);
      const txResult = await (await import("@/lib/stellar")).submitTransaction(signedXDR);
      // Confirm registration on backend
      await confirmProjectRegistration({
        projectId: project.id,
        transactionHash: txResult.hash,
      });
      const refreshed = await fetchProject(project.id);
      setProject(refreshed);
      setOnChainMessage("Project registered on-chain");
      setOnChainState("success");
      setTimeout(() => setOnChainState("idle"), 3000);
    } catch (e: any) {
      setOnChainMessage(e.message || "Failed to register on-chain");
      setOnChainState("error");
    }
  };

  if (!publicKey) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-forest-900 mb-3">Project Admin</h1>
          <p className="text-[#5a7a5a] font-body">Connect the project wallet to access analytics and post updates.</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="card">Loading…</div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="card">
          <p className="text-red-600 font-body">{error || "Project not found"}</p>
          <div className="mt-4">
            <Link className="text-forest-700 font-semibold hover:underline" href="/projects">
              ← Back to projects
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="card">
          <h1 className="font-display text-xl font-bold text-forest-900 mb-2">Access denied</h1>
          <p className="text-sm text-[#5a7a5a] font-body">
            This admin dashboard is only accessible to the connected wallet that matches the project wallet address.
          </p>
          <div className="mt-4 text-xs text-[#8aaa8a] font-body">
            Connected: {shortenAddress(publicKey)} • Project wallet: {shortenAddress(project.walletAddress)}
          </div>
          <div className="mt-5">
            <Link className="text-forest-700 font-semibold hover:underline" href={`/projects/${project.id}`}>
              View project page →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <p className="text-xs tracking-[0.22em] uppercase text-[#8aaa8a] font-body">Project Admin</p>
          <h1 className="font-display text-3xl font-bold text-forest-900 mb-1">{project.name}</h1>
          <p className="text-sm text-[#5a7a5a] font-body">Wallet: {shortenAddress(project.walletAddress, 10)}</p>
        </div>
        <Link href={`/projects/${project.id}`} className="btn-primary text-sm py-2.5 px-5 flex-shrink-0">
          View Project
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { icon: "💚", label: "Total Raised", value: formatXLM(project.raisedXLM) },
          { icon: "👥", label: "Donors", value: String(project.donorCount) },
          { icon: "♻️", label: "CO₂ Offset", value: formatCO2(project.co2OffsetKg) },
          { icon: "🧾", label: "Recent Donations", value: String(donations.length) },
        ].map((stat) => (
          <div key={stat.label} className="card text-center shadow-sm border border-forest-100/50">
            <p className="text-2xl mb-2">{stat.icon}</p>
            <p className="font-display font-bold text-forest-900 text-lg leading-tight">{stat.value}</p>
            <p className="text-xs text-[#8aaa8a] mt-1 font-body uppercase tracking-wider font-bold opacity-60">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="card mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <h2 className="font-display text-xl font-bold text-forest-900">Donation Growth</h2>
          <button
            onClick={downloadCsv}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-forest-200 bg-forest-50 hover:bg-forest-100 transition-all"
          >
            Download donor report CSV
          </button>
        </div>
        <div className="h-64">
          <DonationGrowthChartNoSSR data={weeklyGrowth} />
        </div>
        <p className="text-xs text-[#8aaa8a] mt-3 font-body">
          Weekly totals based on recent donation history (up to 200 donations loaded).
        </p>
      </div>

      <div className="card mb-8">
        <h2 className="font-display text-xl font-bold text-forest-900 mb-4">Project Milestones</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {milestones.length === 0 ? (
              <p className="text-sm text-[#5a7a5a] font-body">No milestones defined yet.</p>
            ) : (
              milestones.map((m) => {
                const reached = parseFloat(project.raisedXLM) >= (parseFloat(project.goalXLM) * m.percentage / 100);
                return (
                  <div key={m.id} className={`p-4 rounded-xl border ${m.reachedAt ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-forest-100'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${m.reachedAt ? 'bg-emerald-500 text-white' : 'bg-forest-100 text-forest-700'}`}>
                          {m.percentage}%
                        </div>
                        <div>
                          <p className="font-semibold text-forest-900 font-body">{m.title}</p>
                          {m.reachedAt && <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">Reached {timeAgo(m.reachedAt)}</p>}
                        </div>
                      </div>
                      {reached && !m.reachedAt && (
                        <button
                          onClick={() => recordMilestoneOnChain(m)}
                          disabled={milestoneActionState === "loading"}
                          className="btn-primary text-xs py-1.5 px-3"
                        >
                          Record On-Chain
                        </button>
                      )}
                      {m.transactionHash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${m.transactionHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-emerald-600 hover:underline font-bold uppercase tracking-widest"
                        >
                          View Proof ↗
                        </a>
                      )}
                    </div>
                    <div className="w-full bg-forest-100 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-1000 ${m.reachedAt ? 'bg-emerald-500' : reached ? 'bg-amber-400' : 'bg-forest-300'}`}
                        style={{ width: `${Math.min(100, (parseFloat(project.raisedXLM) / (parseFloat(project.goalXLM) * m.percentage / 100)) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="bg-forest-50 p-5 rounded-2xl border border-forest-100">
            <h3 className="text-sm font-bold text-forest-900 mb-3 uppercase tracking-wider opacity-60">Add Milestone</h3>
            <div className="space-y-3">
              <input
                value={newMilestoneTitle}
                onChange={(e) => setNewMilestoneTitle(e.target.value)}
                placeholder="e.g. 25% Funded"
                className="input-field bg-white"
              />
              <div>
                <label className="block text-[10px] font-bold text-forest-800 uppercase tracking-widest mb-1 ml-1 opacity-50">Percentage of goal</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={newMilestonePercentage}
                    onChange={(e) => setNewMilestonePercentage(parseInt(e.target.value))}
                    className="flex-1 accent-forest-600"
                  />
                  <span className="text-sm font-bold text-forest-900 w-8">{newMilestonePercentage}%</span>
                </div>
              </div>
              <button
                onClick={addMilestone}
                disabled={milestoneActionState === "loading" || !newMilestoneTitle.trim()}
                className="btn-primary w-full text-sm py-2 disabled:opacity-50"
              >
                {milestoneActionState === "loading" ? "Adding..." : "Add Milestone"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-display text-xl font-bold text-forest-900 mb-4">Recent Donations</h2>
          {donations.length === 0 ? (
            <p className="text-sm text-[#5a7a5a] font-body">No donations yet.</p>
          ) : (
            <div className="space-y-3">
              {donations.slice(0, 10).map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-forest-100">
                  <div>
                    <p className="text-sm font-semibold text-forest-900 font-body">
                      {shortenAddress(d.donorAddress)} • {formatXLM(d.amountXLM || d.amount || "0", 2)}
                    </p>
                    <p className="text-xs text-[#8aaa8a] font-body">{timeAgo(d.createdAt)}</p>
                  </div>
                  {d.message && (
                    <p className="text-xs text-[#5a7a5a] font-body max-w-[220px] text-right">
                      “{d.message.slice(0, 60)}{d.message.length > 60 ? "…" : ""}”
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="font-display text-xl font-bold text-forest-900 mb-2">Post Update</h2>
          <p className="text-sm text-[#5a7a5a] font-body mb-4">
            Publish a project update to notify subscribers.
          </p>
          <div className="space-y-3">
            <input
              value={updateTitle}
              onChange={(e) => setUpdateTitle(e.target.value)}
              className="input-field"
              placeholder="Update title"
              maxLength={120}
            />
            <textarea
              value={updateBody}
              onChange={(e) => setUpdateBody(e.target.value)}
              className="input-field min-h-[140px]"
              placeholder="Write your update..."
              maxLength={2000}
            />
            {postingState === "error" && postingError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-body">
                {postingError}
              </div>
            )}
            {postingState === "success" && (
              <div className="p-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-body">
                Update posted.
              </div>
            )}
            <button
              onClick={postUpdate}
              disabled={postingState === "posting"}
              className="btn-primary w-full disabled:opacity-60"
            >
              {postingState === "posting" ? "Posting…" : "Post Update"}
            </button>
          </div>
        </div>
      </div>

      {/* Approval Workflow */}
      <div className="card mt-6">
        <h2 className="font-display text-xl font-bold text-forest-900 mb-2">Approval Workflow</h2>
        <p className="text-sm text-[#5a7a5a] font-body mb-4">
          Manage project status. Current status:{" "}
          <span className={`font-semibold ${project.status === "active" ? "text-emerald-600" : project.status === "rejected" ? "text-red-600" : "text-amber-600"}`}>
            {project.status}
          </span>
        </p>

        {project.rejectionReason && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-body mb-4">
            <strong>Rejection reason:</strong> {project.rejectionReason}
          </div>
        )}

        {approvalMessage && (
          <div className={`p-3 rounded-xl text-sm font-body mb-4 ${approvalState === "success" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"}`}>
            {approvalMessage}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-forest-800 uppercase tracking-widest mb-1 ml-1 opacity-50">
              Reason for rejection (required)
            </label>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="input-field min-h-[80px]"
              placeholder="Provide a reason for this decision..."
              maxLength={500}
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleApprove}
              disabled={approvalState === "loading" || project.status === "active"}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {approvalState === "loading" ? "Processing…" : "Approve"}
            </button>
            <button
              onClick={handleReject}
              disabled={approvalState === "loading" || !rejectionReason.trim() || project.status === "rejected"}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {approvalState === "loading" ? "Processing…" : "Reject"}
            </button>
          </div>
        </div>
      </div>

      {/* On-Chain Registration */}
      <div className="card mt-6">
        <h2 className="font-display text-xl font-bold text-forest-900 mb-2">On-Chain Registration</h2>
        <p className="text-sm text-[#5a7a5a] font-body mb-4">
          Register this project on the Stellar blockchain via Soroban smart contract.
        </p>

        {onChainMessage && (
          <div className={`p-3 rounded-xl text-sm font-body mb-4 ${onChainState === "success" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"}`}>
            {onChainMessage}
          </div>
        )}

        {project.onChainVerified ? (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-body">
            ✓ This project is registered on-chain.
          </div>
        ) : (
          <button
            onClick={handleRegisterOnChain}
            disabled={onChainState === "loading"}
            className="btn-primary w-full disabled:opacity-50"
          >
            {onChainState === "loading" ? "Registering…" : "Register On-Chain"}
          </button>
        )}
      </div>

      {/* Donation Match Funds */}
      <div className="card mt-6">
        <h2 className="font-display text-xl font-bold text-forest-900 mb-2">Donation Match Funds</h2>
        <p className="text-sm text-[#5a7a5a] font-body mb-4">
          View and manage donation matching for this project.
        </p>

        {matches.length === 0 ? (
          <p className="text-sm text-[#5a7a5a] font-body">No active donation matches.</p>
        ) : (
          <div className="space-y-3">
            {matches.map((m: any) => (
              <div key={m.id} className="p-4 rounded-xl border border-forest-100 bg-forest-50">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-forest-900 font-body">
                      {m.multiplier}x matching
                    </p>
                    <p className="text-xs text-[#8aaa8a] font-body">
                      Matcher: {shortenAddress(m.matcherAddress)}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-green-100 border border-green-200 text-green-700 font-body">
                    Active
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-forest-800 opacity-50">Cap (XLM)</p>
                    <p className="text-sm font-semibold text-forest-900 font-body">{formatXLM(m.capXLM)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-forest-800 opacity-50">Matched</p>
                    <p className="text-sm font-semibold text-forest-900 font-body">{formatXLM(m.matchedXLM)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-forest-800 opacity-50">Remaining</p>
                    <p className="text-sm font-semibold text-forest-900 font-body">{formatXLM(m.remainingXLM)}</p>
                  </div>
                </div>
                <p className="text-xs text-[#8aaa8a] font-body mt-2">
                  Expires: {new Date(m.expiresAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
