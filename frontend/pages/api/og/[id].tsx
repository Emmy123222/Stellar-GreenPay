import { ImageResponse } from "@vercel/og";
import type { NextRequest } from "next/server";

export const config = { runtime: "edge" };

export default async function handler(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  let project: any;
  try {
    const res = await fetch(`${apiUrl}/api/projects/${encodeURIComponent(id)}`);
    const body = await res.json();
    project = body.data || body;
  } catch {
    return new Response("Project not found", { status: 404 });
  }
  if (!project) return new Response("Project not found", { status: 404 });

  const name = project.name || "Stellar GreenPay";
  const category = project.category || "";
  const location = project.location || "";
  const raised = project.totalRaised || project.total_raised || 0;
  const goal = project.goalAmount || project.goal_amount || 0;
  const progress = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0;

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "48px", background: "linear-gradient(135deg, #0a1628 0%, #0f2847 50%, #0d3b2e 100%)", color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "linear-gradient(135deg, #10b981, #059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>🌿</div>
            <span style={{ fontSize: "20px", color: "#94a3b8", fontWeight: 500 }}>Stellar GreenPay</span>
          </div>
          <h1 style={{ fontSize: "48px", fontWeight: 700, margin: 0, lineHeight: 1.1 }}>{name}</h1>
          <div style={{ display: "flex", gap: "16px", fontSize: "20px", color: "#94a3b8" }}>
            {category && <span>🌍 {category}</span>}
            {location && <span>📍 {location}</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ width: "100%", height: "16px", borderRadius: "8px", background: "#1e293b", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", borderRadius: "8px", background: "linear-gradient(90deg, #10b981, #34d399)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "22px" }}>
            <span style={{ fontWeight: 600 }}>{raised.toLocaleString()} XLM raised</span>
            <span style={{ color: "#10b981", fontWeight: 600 }}>{progress}% funded</span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
