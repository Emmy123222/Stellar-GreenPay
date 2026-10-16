import React from "react";
import Link from "next/link";

export interface ProjectShareCardProps {
  projectId: string;
  shareState: "idle" | "copied";
  shareCount: number;
  onTwitterShare: () => void;
  onWhatsappShare: () => void;
  onCopyLink: () => void;
}

export default function ProjectShareCard({
  projectId,
  shareState,
  shareCount,
  onTwitterShare,
  onWhatsappShare,
  onCopyLink,
}: ProjectShareCardProps) {
  return (
    <div className="card text-center bg-forest-50 border-forest-200">
      <p className="font-display font-semibold text-forest-900 mb-2">
        Spread the word 🌍
      </p>
      <p className="text-xs text-[var(--text-secondary)] dark:text-[#8aaa8a] mb-3 font-body">
        Share this project with friends and family to increase its impact.
      </p>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <button
          onClick={onTwitterShare}
          className="btn-secondary flex items-center justify-center py-2 px-0 text-[#1DA1F2] hover:bg-forest-100/50"
          title="Share on Twitter"
          aria-label="Share on Twitter"
        >
          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
            <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
          </svg>
        </button>
        <button
          onClick={onWhatsappShare}
          className="btn-secondary flex items-center justify-center py-2 px-0 text-[#25D366] hover:bg-forest-100/50"
          title="Share on WhatsApp"
          aria-label="Share on WhatsApp"
        >
          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
          </svg>
        </button>
        <button
          onClick={onCopyLink}
          className="btn-secondary flex items-center justify-center py-2 px-0 text-forest-700 hover:bg-forest-100/50"
          title="Copy Link"
          aria-label="Copy Link"
        >
          {shareState === "copied" ? (
            "✓"
          ) : (
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
          )}
        </button>
      </div>
      {shareCount > 0 && (
        <p className="text-xs text-forest-700 font-semibold mb-3">
          {shareCount} shares so far!
        </p>
      )}

      <Link
        href={`/donate/${projectId}`}
        className="btn-secondary text-sm py-2 px-4 w-full mt-2 inline-flex items-center justify-center gap-2"
      >
        📱 Generate Donation QR
      </Link>
    </div>
  );
}
