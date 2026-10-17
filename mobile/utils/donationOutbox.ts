/**
 * utils/donationOutbox.ts
 *
 * Offline donation queue (issue #1655).
 *
 * A donation attempted while the device has no connectivity is *not* retried
 * automatically: the intent (project, amount, memo, donor address) is written
 * to AsyncStorage so it survives an app restart, and the user reviews and signs
 * it explicitly once they are back online.
 *
 * Only the intent is stored — never a secret key, a signed envelope or a
 * built transaction. Stellar transactions carry a source-account sequence and
 * a fee, so a transaction built offline is stale the moment any other
 * transaction lands on the account; rebuilding at signing time is mandatory.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Single AsyncStorage key holding the whole queue as a JSON array. */
export const DONATION_OUTBOX_KEY = 'greenpay:donationOutbox';

export interface QueuedDonation {
  id: string;
  projectId: string;
  projectName: string;
  /** Project wallet the donation will be sent to. */
  destination: string;
  /** XLM amount as typed by the donor. */
  amountXLM: string;
  memo?: string;
  donorPublicKey?: string;
  queuedAt: number;
}

export interface QueuedDonationInput {
  projectId: string;
  projectName: string;
  destination: string;
  amountXLM: string;
  memo?: string;
  donorPublicKey?: string;
}

function newQueueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isQueuedDonation(value: unknown): value is QueuedDonation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<QueuedDonation>;
  return (
    typeof item.id === 'string' &&
    typeof item.projectId === 'string' &&
    typeof item.destination === 'string' &&
    typeof item.amountXLM === 'string' &&
    parseFloat(item.amountXLM) > 0
  );
}

/**
 * Read the pending queue. A missing, unreadable or corrupt entry yields an
 * empty queue rather than throwing — an offline donor must not be blocked by
 * a bad cache.
 */
export async function readDonationOutbox(): Promise<QueuedDonation[]> {
  try {
    const raw = await AsyncStorage.getItem(DONATION_OUTBOX_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isQueuedDonation).map((item) => ({
      ...item,
      projectName: typeof item.projectName === 'string' ? item.projectName : 'Project',
      memo: typeof item.memo === 'string' ? item.memo : undefined,
      donorPublicKey:
        typeof item.donorPublicKey === 'string' ? item.donorPublicKey : undefined,
      queuedAt: typeof item.queuedAt === 'number' ? item.queuedAt : 0,
    }));
  } catch {
    return [];
  }
}

async function writeDonationOutbox(queue: QueuedDonation[]): Promise<void> {
  if (queue.length === 0) {
    await AsyncStorage.removeItem(DONATION_OUTBOX_KEY);
    return;
  }
  await AsyncStorage.setItem(DONATION_OUTBOX_KEY, JSON.stringify(queue));
}

/**
 * Append a donation intent to the queue.
 *
 * @returns the stored intent, or null when the intent is incomplete
 *          (no project, no destination, or a non-positive amount).
 */
export async function queueDonation(
  input: QueuedDonationInput
): Promise<QueuedDonation | null> {
  const projectId = input.projectId?.trim();
  const destination = input.destination?.trim();
  const amount = Number.parseFloat(input.amountXLM ?? '');

  if (!projectId || !destination || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const item: QueuedDonation = {
    id: newQueueId(),
    projectId,
    projectName: input.projectName?.trim() || 'Project',
    destination,
    amountXLM: amount.toFixed(7),
    memo: input.memo?.trim() || undefined,
    donorPublicKey: input.donorPublicKey?.trim() || undefined,
    queuedAt: Date.now(),
  };

  const queue = await readDonationOutbox();
  queue.push(item);
  await writeDonationOutbox(queue);
  return item;
}

/**
 * Remove one intent — after it has been signed and sent, or when the donor
 * discards it. Always call this with the id the donor acted on, never with a
 * guessed one.
 */
export async function removeQueuedDonation(id: string): Promise<QueuedDonation[]> {
  const queue = await readDonationOutbox();
  const remaining = queue.filter((item) => item.id !== id);
  if (remaining.length !== queue.length) {
    await writeDonationOutbox(remaining);
  }
  return remaining;
}

/**
 * Drop every queued intent for a project, used when a fresh donation to that
 * project succeeded, and return how many were removed.
 */
export async function removeQueuedDonationsForProject(
  projectId: string
): Promise<number> {
  const queue = await readDonationOutbox();
  const remaining = queue.filter((item) => item.projectId !== projectId);
  if (remaining.length === queue.length) return 0;

  await writeDonationOutbox(remaining);
  return queue.length - remaining.length;
}
