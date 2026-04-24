import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { createProjectUpdate, fetchProject, fetchProjectDonations } from "@/lib/api";
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

  useEffect(() => {
    if (!projectId || typeof projectId !== "string") return;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchProject(projectId),
      fetchProjectDonations(projectId, 200).then((r) => r.donations),
    ])
      .then(([p, d]) => {
        setProject(p);
        setDonations(d);
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
    </div>
  );
}
