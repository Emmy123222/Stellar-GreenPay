import { useMemo } from "react";
import { badgeEmoji, badgeLabel, formatCO2, formatDate, formatXLM, shortenAddress } from "@/utils/format";
import type { BadgeTier } from "@/utils/types";

export default function ImpactCertificate(props: {
  donorAddress: string;
  donorName?: string | null;
  totalDonatedXLM: string;
  totalCO2OffsetKg: number;
  badgeTier: BadgeTier | null;
  projectsSupported: Array<{ id: string; name: string }>;
}) {
  const {
    donorAddress,
    donorName,
    totalDonatedXLM,
    totalCO2OffsetKg,
    badgeTier,
    projectsSupported,
  } = props;

  const issuedDate = useMemo(() => formatDate(new Date().toISOString()), []);

  return (
    <div
      id="impact-certificate"
      className="bg-white border border-forest-200 rounded-3xl overflow-hidden shadow-lg"
    >
      <div className="bg-gradient-to-r from-forest-900 to-forest-800 text-white px-8 py-8">
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="text-xs tracking-[0.22em] uppercase text-forest-100 font-body">
              Stellar GreenPay
            </p>
            <h2 className="font-display text-3xl font-bold leading-tight">
              Impact Certificate
            </h2>
            <p className="text-forest-100 text-sm mt-2 font-body">
              This certificate recognizes climate impact achieved through on-chain donations.
            </p>
          </div>
          <div className="text-5xl">🌿</div>
        </div>
      </div>

      <div className="px-8 py-8">
        <div className="text-center mb-8">
          <p className="text-sm text-[#5a7a5a] font-body">Presented to</p>
          <p className="font-display text-3xl font-bold text-forest-900 mt-2">
            {donorName?.trim() ? donorName : shortenAddress(donorAddress)}
          </p>
          <p className="text-xs text-[#8aaa8a] mt-2 font-body">
            Donor Address: {shortenAddress(donorAddress, 10)}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="card text-center border-forest-100/50">
            <p className="text-2xl mb-2">💚</p>
            <p className="font-display font-bold text-forest-900 text-lg">
              {formatXLM(totalDonatedXLM)}
            </p>
            <p className="text-xs text-[#8aaa8a] mt-1 font-body uppercase tracking-wider font-bold opacity-60">
              Total Donated
            </p>
          </div>
          <div className="card text-center border-forest-100/50">
            <p className="text-2xl mb-2">♻️</p>
            <p className="font-display font-bold text-forest-900 text-lg">
              {formatCO2(totalCO2OffsetKg)}
            </p>
            <p className="text-xs text-[#8aaa8a] mt-1 font-body uppercase tracking-wider font-bold opacity-60">
              CO₂ Offset
            </p>
          </div>
          <div className="card text-center border-forest-100/50">
            <p className="text-2xl mb-2">{badgeTier ? badgeEmoji(badgeTier) : "🏅"}</p>
            <p className="font-display font-bold text-forest-900 text-lg">
              {badgeTier ? badgeLabel(badgeTier) : "Supporter"}
            </p>
            <p className="text-xs text-[#8aaa8a] mt-1 font-body uppercase tracking-wider font-bold opacity-60">
              Badge Tier
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-forest-100 bg-forest-50 p-5">
          <h3 className="font-display font-bold text-forest-900 mb-2">
            Projects Supported
          </h3>
          {projectsSupported.length === 0 ? (
            <p className="text-sm text-[#5a7a5a] font-body">
              Your supported projects will appear here after your first donation.
            </p>
          ) : (
            <ul className="text-sm text-forest-900 font-body grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {projectsSupported.slice(0, 8).map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="text-forest-600">•</span>
                  <span className="font-semibold">{p.name}</span>
                </li>
              ))}
            </ul>
          )}
          {projectsSupported.length > 8 && (
            <p className="text-xs text-[#5a7a5a] mt-2 font-body">
              +{projectsSupported.length - 8} more
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-8 pt-6 border-t border-forest-100">
          <p className="text-xs text-[#8aaa8a] font-body">
            Issued on {issuedDate}
          </p>
          <p className="text-xs text-[#8aaa8a] font-body">
            Verified by on-chain donation history
          </p>
        </div>
      </div>
    </div>
  );
}

