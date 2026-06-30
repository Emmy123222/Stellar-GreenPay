/**
 * utils/recurringDonations.ts
 * AsyncStorage-backed utility for managing monthly recurring donations on mobile.
 * Mirrors the structure used by the web app's monthlyGiving.ts (localStorage).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const RECURRING_DONATIONS_KEY = 'greenpay_recurring_donations';

export interface RecurringDonation {
  id: string;
  projectId: string;
  projectName: string;
  amountXLM: string;
  startDate: string;
  nextDueDate: string;
  durationMonths: number | null;
  remainingMonths: number | null;
  status: 'active' | 'cancelled' | 'completed';
  createdAt: string;
}

export async function loadRecurringDonations(): Promise<RecurringDonation[]> {
  try {
    const raw = await AsyncStorage.getItem(RECURRING_DONATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveRecurringDonations(donations: RecurringDonation[]): Promise<void> {
  await AsyncStorage.setItem(RECURRING_DONATIONS_KEY, JSON.stringify(donations));
}

export async function createRecurringDonation(input: {
  projectId: string;
  projectName: string;
  amountXLM: string;
  durationMonths: number | null;
}): Promise<RecurringDonation> {
  const now = new Date().toISOString();
  const donation: RecurringDonation = {
    id: `rec_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`,
    projectId: input.projectId,
    projectName: input.projectName,
    amountXLM: input.amountXLM,
    startDate: now,
    nextDueDate: now,
    durationMonths: input.durationMonths,
    remainingMonths: input.durationMonths,
    status: 'active',
    createdAt: now,
  };
  const all = await loadRecurringDonations();
  await saveRecurringDonations([donation, ...all]);
  return donation;
}

export async function cancelRecurringDonation(id: string): Promise<void> {
  const all = await loadRecurringDonations();
  const updated = all.map((d) =>
    d.id === id ? { ...d, status: 'cancelled' as const } : d,
  );
  await saveRecurringDonations(updated);
}
