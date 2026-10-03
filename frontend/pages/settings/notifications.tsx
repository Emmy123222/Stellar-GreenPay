import { FormEvent, useEffect, useState } from "react";
import Head from "next/head";
import { fetchNotificationSubscriptions, ProjectNotificationSubscription, updateNotificationSubscription, updateProfileMilestoneNotifications } from "@/lib/api";

export default function NotificationSettingsPage() {
  const [email, setEmail] = useState("");
  const [subscriptions, setSubscriptions] = useState<ProjectNotificationSubscription[]>([]);
  const [message, setMessage] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [milestonesEnabled, setMilestonesEnabled] = useState(true);
  const [profileMessage, setProfileMessage] = useState("");

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("email");
    if (value) { setEmail(value); void load(value); }
  }, []);

  async function load(value = email) {
    try { setSubscriptions(await fetchNotificationSubscriptions(value)); setMessage(""); }
    catch { setMessage("Enter the email address used to subscribe to project updates."); }
  }
  async function submit(event: FormEvent) { event.preventDefault(); await load(); }
  async function toggle(subscription: ProjectNotificationSubscription) {
    try {
      const updated = await updateNotificationSubscription(subscription.id, email, !subscription.subscribed);
      setSubscriptions((items) => items.map((item) => item.id === updated.id ? { ...item, subscribed: updated.subscribed } : item));
    } catch { setMessage("We could not update this subscription. Please try again."); }
  }
  async function saveMilestonePreference(event: FormEvent) {
    event.preventDefault();
    try {
      const profile = await updateProfileMilestoneNotifications(publicKey.trim(), milestonesEnabled);
      setMilestonesEnabled(profile.milestoneNotificationsEnabled !== false);
      setProfileMessage("Milestone notification preference saved.");
    } catch { setProfileMessage("Could not save this setting. Check the wallet address and try again."); }
  }

  return <main className="max-w-2xl mx-auto px-4 py-12 text-forest-900">
    <Head><title>Notification settings | Stellar GreenPay</title></Head>
    <h1 className="font-display text-3xl font-bold">Project update emails</h1>
    <p className="mt-2 text-forest-600">Choose which projects send you their weekly update digest.</p>
    <form onSubmit={submit} className="mt-7 flex gap-2">
      <label className="sr-only" htmlFor="email">Email address</label>
      <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="flex-1 rounded-lg border border-forest-200 px-3 py-2" />
      <button className="rounded-lg bg-forest-600 px-4 py-2 font-semibold text-white">Load settings</button>
    </form>
    <section className="mt-10 rounded-xl border border-forest-100 bg-white p-5">
      <h2 className="font-display text-xl font-bold">Funding milestone notifications</h2>
      <p className="mt-1 text-sm text-forest-600">Control milestone email and push updates for projects you have supported.</p>
      <form onSubmit={saveMilestonePreference} className="mt-4 space-y-3">
        <label className="block text-sm font-medium" htmlFor="wallet-public-key">Stellar wallet public key</label>
        <input id="wallet-public-key" required value={publicKey} onChange={(event) => setPublicKey(event.target.value)} className="w-full rounded-lg border border-forest-200 px-3 py-2" placeholder="G…" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={milestonesEnabled} onChange={(event) => setMilestonesEnabled(event.target.checked)} />
          Send me funding milestone notifications
        </label>
        <button className="rounded-lg bg-forest-600 px-4 py-2 font-semibold text-white">Save preference</button>
      </form>
      {profileMessage && <p className="mt-3 text-sm" role="status">{profileMessage}</p>}
    </section>
    {message && <p className="mt-4 text-sm text-red-700">{message}</p>}
    <section className="mt-8 space-y-3" aria-label="Project subscriptions">
      {subscriptions.map((subscription) => <div key={subscription.id} className="flex items-center justify-between rounded-xl border border-forest-100 bg-white p-4">
        <div><h2 className="font-semibold">{subscription.projectName}</h2><p className="text-sm text-forest-600">Weekly project updates</p></div>
        <button onClick={() => toggle(subscription)} className={`rounded-full px-4 py-2 text-sm font-semibold ${subscription.subscribed ? "bg-forest-600 text-white" : "bg-zinc-100 text-zinc-700"}`} aria-pressed={subscription.subscribed}>{subscription.subscribed ? "Subscribed" : "Unsubscribed"}</button>
      </div>)}
      {email && !subscriptions.length && !message && <p className="text-forest-600">No project update subscriptions found for this email.</p>}
    </section>
  </main>;
}
