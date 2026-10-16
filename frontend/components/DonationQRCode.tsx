import React, { useRef, useCallback, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

export interface DonationQRCodeProps {
  stellarUri: string;
  projectName: string;
  projectId?: string;
  donationUrl?: string;
  size?: number;
  showActions?: boolean;
}

/**
 * Renders a QR code for a SEP-0007 stellar:pay URI and provides
 * built-in "Download PNG" and "Copy Link" action buttons, while
 * also exposing downloadPNG via an imperative ref.
 */
export interface DonationQRCodeHandle {
  downloadPNG: () => void;
}

const DonationQRCode = React.forwardRef<DonationQRCodeHandle, DonationQRCodeProps>(
  (
    {
      stellarUri,
      projectName,
      projectId,
      donationUrl,
      size = 280,
      showActions = true,
    },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [copied, setCopied] = useState(false);

    const getCanvas = useCallback((): HTMLCanvasElement | null => {
      if (canvasRef.current) return canvasRef.current;
      if (wrapperRef.current) {
        return wrapperRef.current.querySelector("canvas");
      }
      return null;
    }, []);

    const handleDownloadPNG = useCallback(() => {
      const canvas = getCanvas();
      if (!canvas) return;

      const slug = projectId || projectName.toLowerCase().replace(/\s+/g, "-");
      const filename = `greenpay-donate-${slug}.png`;

      const link = document.createElement("a");
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      link.click();
    }, [getCanvas, projectId, projectName]);

    const handleCopyLink = useCallback(async () => {
      const targetUrl =
        donationUrl ||
        (typeof window !== "undefined" && window.location.href ? window.location.href : stellarUri);

      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(targetUrl);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      } catch {
        // Fallback for older browsers or permission rejection
      }
    }, [donationUrl, stellarUri]);

    // Expose downloadPNG to parent via ref
    React.useImperativeHandle(ref, () => ({
      downloadPNG: handleDownloadPNG,
    }));

    const onCanvasRef = useCallback((node: HTMLElement | null) => {
      if (node) {
        wrapperRef.current = node as HTMLDivElement;
        const canvas = node.querySelector("canvas");
        if (canvas) canvasRef.current = canvas;
      }
    }, []);

    return (
      <div
        ref={onCanvasRef}
        className="donation-qr-wrapper"
        style={{ display: "inline-block", textAlign: "center" }}
        aria-label={`QR code to donate to ${projectName}`}
      >
        <div style={{ display: "inline-block", padding: "8px", background: "#ffffff", borderRadius: "12px" }}>
          <QRCodeCanvas
            value={stellarUri}
            size={size}
            level="H"
            includeMargin={true}
            imageSettings={{
              src: "/logo-mark.png",
              height: Math.round(size * 0.18),
              width: Math.round(size * 0.18),
              excavate: true,
            }}
            style={{ display: "block" }}
          />
        </div>

        {showActions && (
          <div
            className="donation-qr-actions"
            style={{
              marginTop: "1rem",
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="donation-qr-download-btn"
              onClick={handleDownloadPNG}
              aria-label="Download PNG"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 1rem",
                backgroundColor: "#2e7d32",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background-color 0.2s",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PNG
            </button>

            <button
              type="button"
              className="donation-qr-copy-btn"
              onClick={handleCopyLink}
              aria-label="Copy Link"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 1rem",
                backgroundColor: "rgba(255, 255, 255, 0.08)",
                color: "#e8f5e9",
                border: "1px solid rgba(129, 199, 132, 0.3)",
                borderRadius: "8px",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>
        )}
      </div>
    );
  }
);

DonationQRCode.displayName = "DonationQRCode";
export default DonationQRCode;