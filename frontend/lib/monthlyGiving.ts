import type { MonthlySubscription } from "@/utils/types";

export const MONTHLY_GIVING_STORAGE_KEY = "greenpay_monthly_subscriptions";

function addMonths(isoDate: string, months: number) {
  const date = new Date(isoDate);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const maxDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, maxDay));
  return date.toISOString();
}

export function loadMonthlySubscriptions(): MonthlySubscription[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MONTHLY_GIVING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMonthlySubscriptions(subscriptions: MonthlySubscription[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MONTHLY_GIVING_STORAGE_KEY, JSON.stringify(subscriptions));
}

export function createMonthlySubscription(input: {
  projectId: string;
  projectName: string;
  amountXLM: string;
  startDate: string;
  durationMonths: number | null;
}) {
  const nowIso = new Date().toISOString();
  const subscription: MonthlySubscription = {
    id: `sub_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`,
    projectId: input.projectId,
    projectName: input.projectName,
    amountXLM: input.amountXLM,
    startDate: input.startDate,
    durationMonths: input.durationMonths,
    nextDueDate: input.startDate,
    remainingMonths: input.durationMonths,
    status: "active",
    createdAt: nowIso,
    history: [],
  };

  const all = loadMonthlySubscriptions();
  saveMonthlySubscriptions([subscription, ...all]);
  return subscription;
}

export function markMonthlySubscriptionPaid(subscriptionId: string, amountXLM: string) {
  const all = loadMonthlySubscriptions();
  const updated = all.map((sub) => {
    if (sub.id !== subscriptionId || sub.status !== "active") return sub;

    const nextRemaining =
      sub.remainingMonths === null ? null : Math.max(sub.remainingMonths - 1, 0);
    const completed = nextRemaining === 0;
    const nextStatus: MonthlySubscription["status"] = completed ? "completed" : "active";

    return {
      ...sub,
      history: [{ paidAt: new Date().toISOString(), amountXLM }, ...sub.history],
      remainingMonths: nextRemaining,
      status: nextStatus,
      nextDueDate: completed ? sub.nextDueDate : addMonths(sub.nextDueDate, 1),
    };
  });
  saveMonthlySubscriptions(updated);
}

export function getDueMonthlySubscriptions() {
  const now = new Date();
  return loadMonthlySubscriptions().filter((sub) => {
    if (sub.status !== "active") return false;
    return new Date(sub.nextDueDate).getTime() <= now.getTime();
  });
}
