/**
 * WalletAddressQRCode.tsx
 *
 * Renders a compact, inline QR code for a Stellar project wallet address
 * encoded as a SEP-0007 `web+stellar:pay` URI. Intended for the project detail
 * page so donors on Freighter mobile can scan-to-donate without copying the
 * address manually.
 *
 * Usage:
 *   <WalletAddressQRCode
 *     walletAddress="G..."
 *     projectName="Amazon Reforestation"
 *   />
 */
import React, { useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

interface WalletAddressQRCodeProps {
  /** Stellar public key of the project's receiving wallet */
  walletAddress: string;
  /** Human-readable project name – used in the SEP-0007 memo */
  projectName: string;
  /**
   * Pixel size of the QR canvas. Defaults to 160 — small enough for a sidebar
   * card but crisp enough for a phone camera at arm's length.
   */
  size?: number;
}

/**
 * Builds a SEP-0007 payment URI:
 *   web+stellar:pay?destination=<address>&memo=GreenPay:<name>&memo_type=MEMO_TEXT
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */
function buildSep0007Uri(walletAddress: string, projectName: string): string {
  const params = new URLSearchParams();
  params.set("destination", walletAddress);
  // Keep the memo short — Stellar text memos are limited to 28 bytes
  const memoText = `GreenPay:${projectName}`.slice(0, 28);
  params.set("memo", memoText);
  params.set("memo_type", "MEMO_TEXT");
  return `web+stellar:pay?${params.toString()}`;
}

const WalletAddressQRCode: React.FC<WalletAddressQRCodeProps> = ({
  walletAddress,
  projectName,
  size = 160,
}) => {
  const [expanded, setExpanded] = useState(false);
  const stellarUri = buildSep0007Uri(walletAddress, projectName);

  return (
    <div className="wallet-qr">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2 text-xs font-semibold text-forest-700 hover:text-forest-900 transition-colors focus:outline-none focus:ring-2 focus:ring-forest-400 rounded"
        aria-expanded={expanded}
        aria-controls="wallet-qr-panel"
      >
        <span className="text-base" aria-hidden="true">
          {expanded ? "▲" : "▼"}
        </span>
        {expanded ? "Hide QR" : "📱 Scan to donate"}
      </button>

      {/* Collapsible panel */}
      {expanded && (
        <div
          id="wallet-qr-panel"
          role="region"
          aria-label={`QR code to donate to ${projectName}`}
          className="mt-3 flex flex-col items-center gap-2 animate-fade-in"
        >
          {/* White border so the QR has adequate quiet zone on coloured backgrounds */}
          <div className="bg-white p-2 rounded-lg shadow-sm border border-forest-100 inline-block">
            <QRCodeCanvas
              value={stellarUri}
              size={size}
              level="H"
              includeMargin={false}
              style={{ display: "block" }}
            />
          </div>

          <p className="text-[11px] text-[#5a7a5a] font-body text-center leading-snug max-w-[200px]">
            Open <strong>Freighter</strong> or any Stellar wallet and scan to
            send XLM directly on-chain.
          </p>

          <p className="text-[10px] text-[#8aaa8a] font-body font-mono break-all text-center max-w-[200px]">
            {walletAddress}
          </p>
        </div>
      )}
    </div>
  );
};

export default WalletAddressQRCode;
export { buildSep0007Uri };
