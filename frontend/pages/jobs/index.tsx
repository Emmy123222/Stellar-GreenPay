/**
 * pages/jobs/index.tsx — List escrow jobs
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJobs } from "@/lib/api";
import type { EscrowJob } from "@/utils/types";

export default function JobsIndexPage() {
  const [jobs, setJobs] = useState<EscrowJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJobs()
      .then(setJobs)
      .catch(() => setError("Could not load jobs."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <h1 className="font-display text-3xl font-bold text-forest-900 mb-2">
        Jobs
      </h1>
      <p className="text-[#5a7a5a] font-body mb-8">
        Escrow work funded in XLM. Clients approve release after delivery.
      </p>

      {loading && (
        <p className="text-[#5a7a5a] font-body">Loading…</p>
      )}
      {error && <p className="text-red-600 font-body">{error}</p>}

      {!loading && !error && (
        <ul className="space-y-3">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link
                href={`/jobs/${j.id}`}
                className="block card border border-forest-100 hover:border-forest-300 transition-colors"
              >
                <span className="font-display font-semibold text-forest-900">
                  {j.title}
                </span>
                <span className="block text-xs text-[#8aaa8a] mt-1 capitalize">
                  {j.status.replace("_", " ")} · {j.amountEscrowXlm} XLM
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
