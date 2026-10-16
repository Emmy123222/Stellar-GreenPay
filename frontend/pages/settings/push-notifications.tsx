/**
 * pages/settings/push-notifications.tsx — Mobile push notification preferences
 *
 * Persists toggle prefs to localStorage. The mobile app and frontend components
 * read these via loadNotificationPreferences() from lib/api.ts.
 */
import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/api";

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-forest-900 font-body">{label}</p>
        <p className="text-xs text-[#5a7a5a] dark:text-[#8aaa8a] font-body mt-0.5">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent",
          "transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-500 focus-visible:ring-offset-2",
          checked ? "bg-forest-500" : "bg-gray-200 dark:bg-gray-700",
        ].join(" ")}
      >
        <span className="sr-only">Toggle {label}</span>
        <span
          aria-hidden="true"
          className={[
            "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200",
            checked ? "translate-x-5" : "translate-x-0",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

export default function PushNotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    projectUpdates: true,
    donations: true,
    milestones: true,
  });
  const [saved, setSaved] = useState(false);

  // Load persisted preferences on mount (client-side only)
  useEffect(() => {
    setPrefs(loadNotificationPreferences());
  }, []);

  function update(key: keyof NotificationPreferences, value: boolean) {
    setSaved(false);
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveNotificationPreferences(prefs);
    setSaved(true);
  }

  return (
    <>
      <Head>
        <title>Push Notification Settings — Stellar GreenPay</title>
      </Head>

      <div className="max-w-xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-6">
          <Link
            href="/settings/notifications"
            className="text-xs font-semibold uppercase tracking-widest text-forest-500 hover:text-forest-700 transition-colors"
          >
            ← Email &amp; Milestone Notifications
          </Link>
        </div>

        <h1 className="font-display text-2xl font-bold text-forest-900 mb-1">
          Push Notification Settings
        </h1>
        <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body mb-8">
          Choose which push notifications you receive from the GreenPay mobile app.
        </p>

        <div className="card divide-y divide-forest-100">
          <ToggleRow
            label="Project Updates"
            description="Get notified when projects you follow post new updates."
            checked={prefs.projectUpdates}
            onChange={(v) => update("projectUpdates", v)}
          />
          <ToggleRow
            label="Donation Confirmations"
            description="Receive a push when your donation is confirmed on-chain."
            checked={prefs.donations}
            onChange={(v) => update("donations", v)}
          />
          <ToggleRow
            label="Milestones"
            description="Be the first to know when a project you support hits a funding milestone."
            checked={prefs.milestones}
            onChange={(v) => update("milestones", v)}
          />
        </div>

        <div className="mt-6 flex items-center gap-4">
          <button onClick={handleSave} className="btn-primary text-sm py-2.5 px-6">
            Save Preferences
          </button>
          {saved && (
            <span className="text-sm text-forest-600 font-semibold animate-fade-in">
              ✓ Saved
            </span>
          )}
        </div>
      </div>
    </>
  );
}
