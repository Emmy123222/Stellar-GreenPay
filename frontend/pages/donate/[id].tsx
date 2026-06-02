import React, { useRef, useState } from "react";
import type { GetServerSideProps, NextPage } from "next";
import Head from "next/head";
import Link from "next/link";
import DonationQRCode, { DonationQRCodeHandle } from "../../components/DonationQRCode";
import type { DonateProject, DonatePageProps } from "../../utils/types";

//Category icons (matches the live site's category set)//

const CATEGORY_ICONS: Record<string, string> = {
  Reforestation: "🌳",
  "Solar Energy": "☀️",
  "Ocean Conservation": "🌊",
  "Clean Water": "💧",
  "Wildlife Protection": "🦁",
  "Carbon Capture": "♻️",
  "Wind Energy": "💨",
  "Sustainable Agriculture": "🌾",
  Other: "🌿",
};

function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? "🌱";
}

//  SEP-0007 URI builder //

function buildStellarUri(project: DonateProject, presetAmount: number | null): string {
  // Base: web+stellar:pay?destination=<address>&memo=GreenPay:<name>
  const params = new URLSearchParams();
  params.set("destination", project.walletAddress);
  params.set("memo", `GreenPay:${project.name}`);
  params.set("memo_type", "MEMO_TEXT");
  if (presetAmount && presetAmount > 0) {
    params.set("amount", String(presetAmount));
  }
  // SEP-0007 uses "web+stellar:pay?" (no double-encoding)
  return `web+stellar:pay?${params.toString()}`;
}

// Progress bar //

function GoalProgress({ raised, goal }: { raised: number; goal: number }) {
  const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0;
  return (
    <div className="goal-progress">
      <div className="goal-progress__bar-track">
        <div className="goal-progress__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="goal-progress__label">
        <strong>{raised.toLocaleString()} XLM</strong> raised of{" "}
        {goal.toLocaleString()} XLM goal &mdash; <strong>{pct}%</strong>
      </p>
    </div>
  );
}

//Page //

const DonatePage: NextPage<DonatePageProps> = ({ project, presetAmount }) => {
  const qrRef = useRef<DonationQRCodeHandle>(null);
  const [copied, setCopied] = useState(false);

  // Guard – project not found
  if (!project) {
    return (
      <div className="not-found">
        <h1>Project not found</h1>
        <Link href="/projects">← Browse projects</Link>
      </div>
    );
  }

  const stellarUri = buildStellarUri(project, presetAmount);
  const icon = categoryIcon(project.category);

  function handleDownload() {
    qrRef.current?.downloadPNG();
  }

  function handlePrint() {
    window.print();
  }

  async function handleCopyUri() {
    try {
      await navigator.clipboard.writeText(stellarUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available in older browsers */
    }
  }

  return (
    <>
      <Head>
        <title>Donate to {project.name} — Stellar GreenPay</title>
        <meta
          name="description"
          content={`Scan the QR code to donate XLM directly to ${project.name} on the Stellar blockchain.`}
        />
      </Head>

      <style>{`
        /* ─── Screen layout ─────────────────────────────── */
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }

        .donate-page {
          min-height: 100vh;
          background: linear-gradient(135deg, #0d1f0e 0%, #1a3a1b 60%, #0d2a1e 100%);
          color: #e8f5e9;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1.5rem;
        }

        /* top nav strip */
        .donate-page__nav {
          width: 100%;
          max-width: 680px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 2rem;
        }
        .donate-page__nav a {
          color: #81c784;
          text-decoration: none;
          font-size: 0.9rem;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          transition: color 0.2s;
        }
        .donate-page__nav a:hover { color: #a5d6a7; }

        /* card */
        .donate-card {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(129, 199, 132, 0.18);
          border-radius: 20px;
          padding: 2.5rem 2rem;
          width: 100%;
          max-width: 480px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.4rem;
          text-align: center;
          box-shadow: 0 8px 40px rgba(0,0,0,0.45);
        }

        .donate-card__badge {
          background: rgba(129, 199, 132, 0.12);
          border: 1px solid rgba(129, 199, 132, 0.3);
          border-radius: 999px;
          padding: 0.35rem 0.9rem;
          font-size: 0.78rem;
          color: #81c784;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .donate-card__icon {
          font-size: 2.8rem;
          line-height: 1;
        }

        .donate-card__category {
          font-size: 0.85rem;
          color: #81c784;
          margin-top: -0.5rem;
        }

        .donate-card__title {
          font-size: 1.7rem;
          font-weight: 700;
          line-height: 1.2;
          color: #fff;
        }

        .goal-progress { width: 100%; }
        .goal-progress__bar-track {
          width: 100%;
          height: 8px;
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 0.5rem;
        }
        .goal-progress__bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #43a047, #66bb6a);
          border-radius: 4px;
          transition: width 0.6s ease;
        }
        .goal-progress__label {
          font-size: 0.82rem;
          color: #a5d6a7;
        }

        /* QR wrapper */
        .donate-card__qr-wrap {
          background: #fff;
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.3);
        }

        /* instruction */
        .donate-card__instruction {
          font-size: 0.92rem;
          color: #c8e6c9;
          line-height: 1.5;
          max-width: 320px;
        }
        .donate-card__instruction strong {
          color: #fff;
        }

        /* preset amount chip */
        .donate-card__amount-chip {
          background: rgba(102, 187, 106, 0.15);
          border: 1px solid rgba(102, 187, 106, 0.35);
          border-radius: 999px;
          padding: 0.3rem 0.85rem;
          font-size: 0.84rem;
          color: #a5d6a7;
        }
        .donate-card__amount-chip span {
          font-weight: 700;
          color: #66bb6a;
        }

        /* URI copy row */
        .donate-card__uri-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          max-width: 360px;
        }
        .donate-card__uri-input {
          flex: 1;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px;
          padding: 0.45rem 0.75rem;
          font-size: 0.72rem;
          color: #81c784;
          font-family: monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          cursor: default;
          user-select: all;
        }
        .btn-copy {
          flex-shrink: 0;
          background: rgba(129,199,132,0.15);
          border: 1px solid rgba(129,199,132,0.3);
          color: #81c784;
          border-radius: 8px;
          padding: 0.45rem 0.75rem;
          font-size: 0.78rem;
          cursor: pointer;
          transition: background 0.2s;
          white-space: nowrap;
        }
        .btn-copy:hover { background: rgba(129,199,132,0.25); }
        .btn-copy--copied { color: #66bb6a; }

        /* action buttons */
        .donate-card__actions {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
          justify-content: center;
          width: 100%;
        }
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          padding: 0.65rem 1.3rem;
          border-radius: 10px;
          font-size: 0.88rem;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: transform 0.15s, box-shadow 0.15s;
          text-decoration: none;
        }
        .btn:active { transform: scale(0.97); }

        .btn--primary {
          background: linear-gradient(135deg, #2e7d32, #43a047);
          color: #fff;
          box-shadow: 0 2px 12px rgba(46,125,50,0.4);
        }
        .btn--primary:hover { box-shadow: 0 4px 20px rgba(46,125,50,0.55); }

        .btn--secondary {
          background: rgba(255,255,255,0.06);
          color: #c8e6c9;
          border: 1px solid rgba(255,255,255,0.14);
        }
        .btn--secondary:hover { background: rgba(255,255,255,0.1); }

        /* footer */
        .donate-page__footer {
          margin-top: 2rem;
          font-size: 0.78rem;
          color: rgba(255,255,255,0.3);
          text-align: center;
        }

        .not-found {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          font-family: system-ui, sans-serif;
        }

        //Print styles //
        @media print {
          body {
            background: #fff !important;
            color: #000 !important;
          }
          .donate-page {
            background: #fff !important;
            min-height: unset;
            padding: 0;
          }
          .donate-page__nav,
          .donate-card__actions,
          .donate-card__uri-row,
          .donate-card__badge {
            display: none !important;
          }
          .donate-card {
            background: #fff !important;
            border: none !important;
            box-shadow: none !important;
            max-width: 100% !important;
            padding: 1rem !important;
            gap: 0.8rem !important;
          }
          .donate-card__title { color: #000 !important; font-size: 1.5rem !important; }
          .donate-card__category { color: #2e7d32 !important; }
          .donate-card__instruction { color: #333 !important; }
          .donate-card__instruction strong { color: #000 !important; }
          .goal-progress__label { color: #444 !important; }
          .goal-progress__bar-track { background: #e0e0e0 !important; }
          /* Make QR large for printing */
          .donate-card__qr-wrap {
            padding: 12px !important;
            box-shadow: none !important;
            border: 2px solid #ddd !important;
          }
          .donate-card__qr-wrap canvas {
            width: 280px !important;
            height: 280px !important;
          }
          .donate-card__amount-chip {
            background: #f1f8e9 !important;
            border-color: #a5d6a7 !important;
            color: #2e7d32 !important;
          }
        }
      `}</style>

      <main className="donate-page">
        <nav className="donate-page__nav">
          <Link href={`/projects/${project.id}`}>← Back to project</Link>
          <Link href="/projects">Browse all projects</Link>
        </nav>
        <div className="donate-card">
          <div className="donate-card__badge">🌱 Climate Donation</div>
          <div className="donate-card__icon">{icon}</div>
          <p className="donate-card__category">{project.category}</p>

          <h1 className="donate-card__title">{project.name}</h1>
          <GoalProgress raised={project.raisedXLM} goal={project.goalXLM} />
          {presetAmount && presetAmount > 0 && (
            <p className="donate-card__amount-chip">
              Preset donation: <span>{presetAmount} XLM</span>
            </p>
          )}

          {/* QR code */}
          <div className="donate-card__qr-wrap">
            <DonationQRCode
              ref={qrRef}
              stellarUri={stellarUri}
              projectName={project.name}
              size={256}
            />
          </div>

          {/* Instruction */}
          <p className="donate-card__instruction">
            <strong>Scan to donate with Freighter</strong>
            <br />
            Open your Stellar wallet app and scan this QR code to send XLM
            directly on-chain — no sign-up required.
          </p>

          {/* Stellar URI copy row */}
          <div className="donate-card__uri-row">
            <div className="donate-card__uri-input" title={stellarUri}>
              {stellarUri}
            </div>
            <button
              className={`btn-copy${copied ? " btn-copy--copied" : ""}`}
              onClick={handleCopyUri}
              aria-label="Copy Stellar URI"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>

          {/* Action buttons */}
          <div className="donate-card__actions">
            <button className="btn btn--primary" onClick={handleDownload}>
              ⬇ Download QR
            </button>
            <button className="btn btn--secondary" onClick={handlePrint}>
              🖨 Print
            </button>
          </div>
        </div>

        <p className="donate-page__footer">
          Powered by Stellar · Stellar GreenPay · MIT License
        </p>
      </main>
    </>
  );
};

//  Data fetching //

export const getServerSideProps: GetServerSideProps<DonatePageProps> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const amountParam = ctx.query?.amount;
  const presetAmount =
    amountParam && !Array.isArray(amountParam) && Number(amountParam) > 0
      ? Number(amountParam)
      : null;

  // Fetch project from the GreenPay backend API
  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  try {
    const res = await fetch(`${apiBase}/api/v1/projects/${id}`);
    if (!res.ok) {
      return { props: { project: null, presetAmount } };
    }
    const data = await res.json();

    // Normalise API response shape to DonateProject
    const project: DonateProject = {
      id: data.id ?? id,
      name: data.name ?? data.title ?? "Untitled Project",
      category: data.category ?? "Other",
      walletAddress: data.walletAddress ?? data.wallet_address ?? "",
      goalXLM: Number(data.goalXLM ?? data.goal_xlm ?? 0),
      raisedXLM: Number(data.raisedXLM ?? data.raised_xlm ?? 0),
      description: data.description ?? null,
    };

    return { props: { project, presetAmount } };
  } catch {
    return { props: { project: null, presetAmount } };
  }
};

export default DonatePage;