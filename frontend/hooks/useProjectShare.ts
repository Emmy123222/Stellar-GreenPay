import { useState } from "react";
import { copyToClipboard } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";

export function useProjectShare(project: ClimateProject | null) {
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const [shareCount, setShareCount] = useState<number>(0);

  const incrementShare = () => setShareCount((prev) => prev + 1);

  const canonicalShareUrl = (utmSource: string): string => {
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://stellar-greenpay.app";
    const params = new URLSearchParams({
      utm_source: utmSource,
      utm_medium: "social",
      utm_campaign: "project-share",
    });
    return `${base}/projects/${project?.id}?${params.toString()}`;
  };

  const handleTwitterShare = () => {
    if (!project) return;
    incrementShare();
    const url = canonicalShareUrl("twitter");
    const text = `Support ${project.name} on Stellar GreenPay and help offset CO₂! 🌍`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleFacebookShare = () => {
    if (!project) return;
    incrementShare();
    const url = canonicalShareUrl("facebook");
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleWhatsappShare = () => {
    if (!project) return;
    incrementShare();
    const url = canonicalShareUrl("whatsapp");
    window.open(
      `https://api.whatsapp.com/send?text=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleCopyLink = async () => {
    if (!project) return;
    incrementShare();
    const url = canonicalShareUrl("copy-link");
    const shareData = {
      title: `${project.name} — Stellar GreenPay`,
      text: `Support ${project.name} on Stellar GreenPay — ${project.description.slice(0, 100)}…`,
      url,
    };

    if (navigator.share && /mobile|android|iphone|ipad/i.test(navigator.userAgent)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }

    const success = await copyToClipboard(url);
    if (success) {
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 2000);
    }
  };

  return {
    shareState,
    shareCount,
    handleTwitterShare,
    handleFacebookShare,
    handleWhatsappShare,
    handleCopyLink,
  };
}
