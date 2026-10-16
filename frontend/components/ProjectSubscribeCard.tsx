import React, { useState, useEffect } from "react";
import { fetchSubscriberCount, subscribeToProject } from "@/lib/api";
import { formatAmount } from "@/utils/format";

export interface ProjectSubscribeCardProps {
  projectId: string;
  publicKey: string | null;
}

export default function ProjectSubscribeCard({
  projectId,
  publicKey,
}: ProjectSubscribeCardProps) {
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [subState, setSubState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [subError, setSubError] = useState<string | null>(null);
  const [subEmail, setSubEmail] = useState("");

  useEffect(() => {
    if (!projectId) return;
    fetchSubscriberCount(projectId)
      .then(setSubscriberCount)
      .catch(() => null);
  }, [projectId]);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !subEmail) return;
    setSubState("loading");
    setSubError(null);
    try {
      await subscribeToProject({
        projectId,
        email: subEmail,
        donorAddress: publicKey || undefined,
      });
      setSubState("success");
      setSubEmail("");
      setSubscriberCount((c) => (c !== null ? c + 1 : null));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSubError(msg || "Could not subscribe. Try again.");
      setSubState("error");
    }
  };

  return (
    <div className="card bg-forest-50 border-forest-200">
      <p className="font-display font-semibold text-forest-900 mb-1">
        Get project updates 🔔
      </p>
      <p className="text-xs text-[var(--text-secondary)] dark:text-[#8aaa8a] mb-3 font-body">
        Receive an email when this project posts new updates.
      </p>
      {subscriberCount !== null && (
        <p className="text-xs text-[var(--text-secondary)] dark:text-forest-300 font-body mb-3">
          📬 {formatAmount(subscriberCount, 0)}{" "}
          {subscriberCount === 1 ? "subscriber" : "subscribers"}
        </p>
      )}
      {subState === "success" ? (
        <p className="text-sm text-green-700 font-body text-center py-2 font-semibold">
          ✓ Thank you for subscribing!
        </p>
      ) : (
        <form onSubmit={handleSubscribe} className="space-y-2">
          <input
            type="email"
            required
            placeholder="your@email.com"
            value={subEmail}
            onChange={(e) => setSubEmail(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-forest-200 bg-white focus:outline-none focus:ring-2 focus:ring-forest-400 font-body"
          />
          {subError && (
            <p className="text-xs text-red-600 font-body">{subError}</p>
          )}
          <button
            type="submit"
            disabled={subState === "loading"}
            className="btn-primary text-sm py-2 px-4 w-full disabled:opacity-60"
          >
            {subState === "loading" ? "Subscribing…" : "Subscribe"}
          </button>
        </form>
      )}
    </div>
  );
}
