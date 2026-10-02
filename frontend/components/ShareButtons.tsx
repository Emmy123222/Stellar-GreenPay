/**
 * components/ShareButtons.tsx
 *
 * Renders a context-aware share UI for a project:
 *  - Mobile browsers that support the Web Share API → single native Share button
 *  - Everything else (desktop) → Twitter (𝕏), Facebook, and Copy-link buttons
 */
import { useEffect, useState } from "react";

interface ShareButtonsProps {
  /** Called when the Twitter/𝕏 share intent should open. */
  onTwitter: () => void;
  /** Called when the Facebook share dialog should open. */
  onFacebook: () => void;
  /** Called when the copy-link / Web Share action should run (async). */
  onCopyLink: () => void;
  /** Current copy-link button state — controlled by the parent. */
  copyState?: "idle" | "copied";
}

/**
 * Returns true only in the browser when navigator.share is available **and**
 * the current device matches a mobile user-agent string.  We check this
 * lazily (inside a useEffect) so SSR never throws on `navigator`.
 */
function useIsMobileShare(): boolean {
  const [isMobileShare, setIsMobileShare] = useState(false);
  useEffect(() => {
    setIsMobileShare(
      typeof navigator !== "undefined" &&
        Boolean(navigator.share) &&
        /mobile|android|iphone|ipad/i.test(navigator.userAgent),
    );
  }, []);
  return isMobileShare;
}

export default function ShareButtons({
  onTwitter,
  onFacebook,
  onCopyLink,
  copyState = "idle",
}: ShareButtonsProps) {
  const isMobileShare = useIsMobileShare();

  // ── Mobile: single native share button ──────────────────────────────────
  if (isMobileShare) {
    return (
      <button
        onClick={onCopyLink}
        className="btn-secondary text-xs py-1 px-3 inline-flex items-center gap-1.5"
        aria-label="Share this project"
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        Share
      </button>
    );
  }

  // ── Desktop: Twitter + Facebook + Copy-link ─────────────────────────────
  return (
    <div
      className="inline-flex items-center gap-1"
      role="group"
      aria-label="Share this project"
    >
      {/* Twitter / 𝕏 */}
      <button
        onClick={onTwitter}
        className="btn-secondary text-xs py-1 px-2.5 inline-flex items-center gap-1 hover:bg-black hover:text-white hover:border-black transition-colors"
        aria-label="Share on X (Twitter)"
        title="Share on X (Twitter)"
      >
        {/* X / Twitter logo */}
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        𝕏
      </button>

      {/* Facebook */}
      <button
        onClick={onFacebook}
        className="btn-secondary text-xs py-1 px-2.5 inline-flex items-center gap-1 hover:bg-[#1877F2] hover:text-white hover:border-[#1877F2] transition-colors"
        aria-label="Share on Facebook"
        title="Share on Facebook"
      >
        {/* Facebook logo */}
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
        </svg>
        fb
      </button>

      {/* Copy link */}
      <button
        onClick={onCopyLink}
        className={`btn-secondary text-xs py-1 px-2.5 inline-flex items-center gap-1 transition-colors ${
          copyState === "copied"
            ? "bg-green-50 text-green-700 border-green-300"
            : ""
        }`}
        aria-label={copyState === "copied" ? "Link copied!" : "Copy link"}
        title="Copy link"
      >
        {copyState === "copied" ? (
          <>
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Copied!
          </>
        ) : (
          <>
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            Copy
          </>
        )}
      </button>
    </div>
  );
}
