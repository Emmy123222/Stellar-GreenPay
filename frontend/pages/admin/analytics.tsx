/**
 * pages/admin/analytics.tsx — Admin Analytics Dashboard
 * Shows donation stats by category in a donut chart.
 */
import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fetchCategoryStats, CategoryStats } from "@/lib/api";
import { formatXLM } from "@/utils/format";
import WalletConnect from "@/components/WalletConnect";

interface AdminAnalyticsProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

const COLORS = [
  "#005f73", // Dark Blue-Green
  "#0a9396", // Teal
  "#94d2bd", // Light Teal
  "#e9d8a6", // Pale Yellow
  "#ee9b00", // Orange
  "#ca6702", // Dark Orange
  "#bb3e03", // Rust
  "#ae2012", // Red
  "#9b2226"  // Dark Red
];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white border border-forest-200 p-3 rounded shadow-md text-sm">
        <p className="font-bold text-forest-900 mb-1">{data.category}</p>
        <p className="text-forest-700">Donations: {data.total_donations}</p>
        <p className="text-forest-700">Total XLM: {formatXLM(data.total_xlm)}</p>
      </div>
    );
  }
  return null;
};

export default function AdminAnalytics({ publicKey, onConnect }: AdminAnalyticsProps) {
  const [data, setData] = useState<CategoryStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    (async () => {
      setLoading(true);
      try {
        setData(await fetchCategoryStats());
      } catch (e: unknown) {
        setError((e as Error).message || "Failed to load analytics");
      } finally {
        setLoading(false);
      }
    })();
  }, [publicKey]);

  if (!publicKey) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-forest-900 mb-3">Admin Analytics</h1>
          <p className="text-[#5a7a5a] dark:text-[#8aaa8a] font-body">Connect your wallet to view analytics.</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <div className="mb-8">
        <p className="text-xs tracking-[0.22em] uppercase text-[#8aaa8a] dark:text-forest-300 font-body">Admin</p>
        <h1 className="font-display text-3xl font-bold text-forest-900 mb-1">Analytics Dashboard</h1>
        <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
          Donations and project statistics by category.
        </p>
      </div>

      {loading && (
        <div className="card animate-pulse h-64 flex items-center justify-center">
          <p className="text-[#8aaa8a]">Loading data...</p>
        </div>
      )}

      {error && (
        <div className="card">
          <p className="text-red-600 font-body">{error}</p>
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="card w-full h-[500px]">
          <h2 className="font-display text-xl font-bold text-forest-900 mb-6 text-center">Donations by Category</h2>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                {COLORS.map((color, index) => (
                  <pattern key={`pattern-${index}`} id={`pattern-${index}`} patternUnits="userSpaceOnUse" width="8" height="8">
                    <rect width="8" height="8" fill={color} />
                    {index % 3 === 0 && <path d="M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4" stroke="#ffffff" strokeWidth="2" strokeOpacity={0.3} />}
                    {index % 3 === 1 && <circle cx="4" cy="4" r="2" fill="#ffffff" fillOpacity={0.3} />}
                    {index % 3 === 2 && <path d="M0,0 l8,8 Z" stroke="#ffffff" strokeWidth="2" strokeOpacity={0.3} />}
                  </pattern>
                ))}
              </defs>
              <Pie
                data={data}
                dataKey="total_donations"
                nameKey="category"
                cx="50%"
                cy="50%"
                innerRadius={80}
                outerRadius={150}
                paddingAngle={2}
                stroke="#fff"
                strokeWidth={2}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={`url(#pattern-${index % COLORS.length})`} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="bottom" height={36} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <div className="card h-64 flex items-center justify-center">
          <p className="text-[#8aaa8a]">No analytics data available.</p>
        </div>
      )}
    </div>
  );
}
