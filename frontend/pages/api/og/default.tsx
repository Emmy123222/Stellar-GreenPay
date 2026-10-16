import { ImageResponse } from "@vercel/og";
import type { NextRequest } from "next/server";

export const config = { runtime: "edge" };

export default async function handler(req: NextRequest) {
  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "48px", background: "linear-gradient(135deg, #0a1628 0%, #0f2847 50%, #0d3b2e 100%)", color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
          <div style={{ width: "64px", height: "64px", borderRadius: "16px", background: "linear-gradient(135deg, #10b981, #059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px" }}>🌿</div>
          <span style={{ fontSize: "28px", color: "#94a3b8", fontWeight: 500 }}>Stellar GreenPay</span>
        </div>
        <h1 style={{ fontSize: "56px", fontWeight: 700, margin: 0, lineHeight: 1.1, textAlign: "center" }}>Compare Climate Projects</h1>
        <p style={{ fontSize: "24px", color: "#94a3b8", marginTop: "16px", textAlign: "center" }}>Side-by-side impact comparison</p>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
