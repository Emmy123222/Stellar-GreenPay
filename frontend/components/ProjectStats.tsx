import React from "react";
import WalletAddressQRCode from "@/components/WalletAddressQRCode";
import { formatAmount, formatCO2, formatXLM } from "@/utils/format";
import { accountUrl } from "@/lib/stellar";
import type { ClimateProject } from "@/utils/types";

export interface ProjectStatsProps {
  project: ClimateProject;
  copyState: "idle" | "copied" | "error";
  onCopyWallet: () => void;
}

export default function ProjectStats({
  project,
  copyState,
  onCopyWallet,
}: ProjectStatsProps) {
  const stats = [
    {
      icon: "👥",
      label: "Donors",
      value: project.donorCount.toString(),
    },
    {
      icon: "♻️",
      label: "CO₂ Offset",
      value: formatCO2(project.co2OffsetKg),
    },
    {
      icon: "🎯",
      label: "Goal",
      value: formatXLM(project.goalXLM),
    },
  ];

  return (
    <>
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="stat-card text-center">
            <p className="text-lg mb-1">{s.icon}</p>
            <div className="flex items-center justify-center gap-1 mb-1">
              <p className="font-semibold text-forest-900 text-sm font-body">
                {s.value}
              </p>
              {s.label === "CO₂ Offset" && (
                <span
                  className="tooltip"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <button
                    type="button"
                    className="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-forest-100 text-[8px] text-forest-600 border border-forest-200 hover:bg-forest-200 transition-colors focus:outline-none focus:ring-1 focus:ring-forest-400"
                    aria-label="CO2 offset estimate methodology info"
                  >
                    ℹ️
                  </button>
                  <span className="tooltip-text" role="tooltip">
                    Estimated CO₂ offset based on this project&apos;s declared
                    impact rate per XLM donated. Actual results may vary.
                  </span>
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)] dark:text-forest-300 font-body">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {/* Wallet link */}
      <div className="mt-4 pt-4 border-t border-forest-100 flex items-center gap-2 text-xs text-[var(--text-secondary)] dark:text-forest-300 font-body">
        <span>Project wallet:</span>
        <a
          href={accountUrl(project.walletAddress)}
          target="_blank"
          rel="noopener noreferrer"
          className="address-tag hover:border-forest-300 transition-colors"
        >
          {project.walletAddress.slice(0, 8)}...
          {project.walletAddress.slice(-6)} ↗
        </a>
        <button
          onClick={onCopyWallet}
          className="ml-1 p-1.5 rounded hover:bg-forest-100 transition-colors focus:outline-none focus:ring-2 focus:ring-forest-300"
          title="Copy wallet address"
          aria-label="Copy wallet address to clipboard"
        >
          {copyState === "copied" ? (
            <span className="flex items-center gap-1 text-green-600 font-semibold">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Copied!
            </span>
          ) : copyState === "error" ? (
            <span className="flex items-center gap-1 text-red-600 text-xs">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </span>
          ) : (
            <svg
              className="w-4 h-4 text-[var(--text-secondary)] dark:text-forest-300 hover:text-forest-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          )}
        </button>
      </div>

      {/* QR code */}
      <div className="mt-3">
        <WalletAddressQRCode
          walletAddress={project.walletAddress}
          projectName={project.name}
        />
      </div>
    </>
  );
}
