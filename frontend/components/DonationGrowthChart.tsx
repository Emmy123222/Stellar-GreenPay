/**
 * components/DonationGrowthChart.tsx
 *
 * Weekly donation growth line chart. Fetches its series from
 * `GET /api/stats/growth` on mount (optionally scoped to a project), showing a
 * loading skeleton while in flight and an error state if the request fails.
 *
 * A `data` prop may still be supplied by callers that already have the series
 * (e.g. SSR or tests); when present, no network request is made.
 */
import { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { fetchDonationGrowth, type DonationGrowthPoint } from "@/lib/api";

export type { DonationGrowthPoint };

interface DonationGrowthChartProps {
  /** Optional project UUID to scope the series to a single project. */
  projectId?: string;
  /** Pre-loaded series. When provided, the component does not fetch. */
  data?: Array<DonationGrowthPoint>;
}

export default function DonationGrowthChart({ projectId, data: initialData }: DonationGrowthChartProps) {
  const [data, setData] = useState<Array<DonationGrowthPoint> | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchDonationGrowth(projectId)
      .then((points) => {
        if (cancelled) return;
        setData(points);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load donation growth data");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, initialData]);

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading donation growth chart"
        className="h-full w-full animate-pulse rounded-xl bg-forest-100/60 dark:bg-forest-900/30"
      />
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-red-200 bg-red-50 p-4 text-center"
      >
        <p className="text-sm font-medium text-red-600">Could not load donation growth</p>
        <p className="text-xs text-red-500">{error}</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border border-forest-100 bg-forest-50 p-4 text-center">
        <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
          No donations recorded yet.
        </p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(34,114,57,0.15)" />
        <XAxis dataKey="week" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Line type="monotone" dataKey="totalXLM" stroke="#227239" strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
