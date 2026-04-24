import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function DonationGrowthChart(props: {
  data: Array<{ week: string; totalXLM: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={props.data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(34,114,57,0.15)" />
        <XAxis dataKey="week" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Line type="monotone" dataKey="totalXLM" stroke="#227239" strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

