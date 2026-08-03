/**
 * utils/recurringDonations.ts
 * AsyncStorage-backed utility for managing monthly recurring donations on mobile.
 * Mirrors the structure used by the web app's monthlyGiving.ts (localStorage).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

export const RECURRING_DONATIONS_KEY = 'greenpay_recurring_donations';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

export class RecurringDonationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurringDonationValidationError';
  }
}

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
  if (typeof input.projectId !== 'string' || input.projectId.trim().length === 0) {
    throw new RecurringDonationValidationError('projectId must be a non-empty string');
  }

  const parsedAmount = Number(input.amountXLM);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new RecurringDonationValidationError('amountXLM must be a valid positive number');
  }

  try {
    await axios.get(`${API_URL}/api/projects/${input.projectId}`);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      throw new RecurringDonationValidationError(`Project ${input.projectId} does not exist`);
    }
    throw new RecurringDonationValidationError('Unable to verify project before creating recurring donation');
  }

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

export interface PaymentRecord {
  id: string;
  donationId: string;
  amountXLM: string;
  projectName: string;
  date: string;
  status: 'completed' | 'failed' | 'pending';
}

export async function loadPaymentHistory(): Promise<PaymentRecord[]> {
  try {
    const raw = await AsyncStorage.getItem('greenpay_payment_history');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function savePaymentHistory(records: PaymentRecord[]): Promise<void> {
  await AsyncStorage.setItem('greenpay_payment_history', JSON.stringify(records));
}

export async function recordPayment(
  donationId: string,
  amountXLM: string,
  projectName: string
): Promise<PaymentRecord> {
  const record: PaymentRecord = {
    id: `pay_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`,
    donationId,
    amountXLM,
    projectName,
    date: new Date().toISOString(),
    status: 'completed',
  };
  const all = await loadPaymentHistory();
  await savePaymentHistory([record, ...all]);
  return record;
}
