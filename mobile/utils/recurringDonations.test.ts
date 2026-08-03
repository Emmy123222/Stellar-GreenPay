/**
 * Tests for utils/recurringDonations.ts
 *
 * Uses the in-memory AsyncStorage mock at
 * __mocks__/@react-native-async-storage/async-storage.js so no real
 * device storage is touched. Each test starts with a clean store.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createRecurringDonation,
  loadRecurringDonations,
  cancelRecurringDonation,
  RECURRING_DONATIONS_KEY,
} from './recurringDonations';

// Clear the mock store before every test so state never leaks between cases.
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DONATION_INPUT = {
  projectId: 'proj-001',
  projectName: 'Amazon Reforestation',
  amountXLM: '50',
  durationMonths: 6,
} as const;

const OPEN_ENDED_INPUT = {
  projectId: 'proj-002',
  projectName: 'Solar Kenya',
  amountXLM: '25',
  durationMonths: null,
} as const;

// ---------------------------------------------------------------------------
// 1. createRecurringDonation() — returned object
// ---------------------------------------------------------------------------

describe('createRecurringDonation()', () => {
  test('returns an object with the correct projectId', async () => {
    const result = await createRecurringDonation(DONATION_INPUT);
    expect(result.projectId).toBe(DONATION_INPUT.projectId);
  });

  test('returns an object with the correct projectName', async () => {
    const result = await createRecurringDonation(DONATION_INPUT);
    expect(result.projectName).toBe(DONATION_INPUT.projectName);
  });

  test('returns an object with the correct amountXLM', async () => {
    const result = await createRecurringDonation(DONATION_INPUT);
    expect(result.amountXLM).toBe(DONATION_INPUT.amountXLM);
  });

  test('returns status "active" immediately after creation', async () => {
    const result = await createRecurringDonation(DONATION_INPUT);
    expect(result.status).toBe('active');
  });

  test('returns a non-empty id string', async () => {
    const result = await createRecurringDonation(DONATION_INPUT);
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
  });

  test('generates unique ids for separate calls', async () => {
    const a = await createRecurringDonation(DONATION_INPUT);
    const b = await createRecurringDonation(DONATION_INPUT);
    expect(a.id).not.toBe(b.id);
  });

  test('sets durationMonths and remainingMonths from input', async () => {
    const result = await createRecurringDonation(DONATION_INPUT);
    expect(result.durationMonths).toBe(6);
    expect(result.remainingMonths).toBe(6);
  });

  test('sets durationMonths and remainingMonths to null for open-ended donations', async () => {
    const result = await createRecurringDonation(OPEN_ENDED_INPUT);
    expect(result.durationMonths).toBeNull();
    expect(result.remainingMonths).toBeNull();
  });

  test('sets createdAt and startDate to ISO timestamp strings', async () => {
    const result = await createRecurringDonation(DONATION_INPUT);
    expect(() => new Date(result.createdAt)).not.toThrow();
    expect(() => new Date(result.startDate)).not.toThrow();
  });

  test('persists the donation to AsyncStorage under RECURRING_DONATIONS_KEY', async () => {
    await createRecurringDonation(DONATION_INPUT);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      RECURRING_DONATIONS_KEY,
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. loadRecurringDonations() — retrieval after creation
// ---------------------------------------------------------------------------

describe('loadRecurringDonations()', () => {
  test('returns an empty array when no donations exist', async () => {
    const result = await loadRecurringDonations();
    expect(result).toEqual([]);
  });

  test('returns the created donation after createRecurringDonation()', async () => {
    const created = await createRecurringDonation(DONATION_INPUT);
    const all = await loadRecurringDonations();

    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(created.id);
  });

  test('returned donation has status "active"', async () => {
    await createRecurringDonation(DONATION_INPUT);
    const [donation] = await loadRecurringDonations();
    expect(donation.status).toBe('active');
  });

  test('returned donation fields match the input', async () => {
    await createRecurringDonation(DONATION_INPUT);
    const [donation] = await loadRecurringDonations();

    expect(donation.projectId).toBe(DONATION_INPUT.projectId);
    expect(donation.projectName).toBe(DONATION_INPUT.projectName);
    expect(donation.amountXLM).toBe(DONATION_INPUT.amountXLM);
  });

  test('returns multiple donations in creation order (newest first)', async () => {
    const first = await createRecurringDonation(DONATION_INPUT);
    const second = await createRecurringDonation(OPEN_ENDED_INPUT);
    const all = await loadRecurringDonations();

    expect(all).toHaveLength(2);
    // createRecurringDonation prepends, so newest is index 0
    expect(all[0].id).toBe(second.id);
    expect(all[1].id).toBe(first.id);
  });
});

// ---------------------------------------------------------------------------
// 3. cancelRecurringDonation(id) — cancellation
// ---------------------------------------------------------------------------

describe('cancelRecurringDonation()', () => {
  test('sets the target donation status to "cancelled"', async () => {
    const created = await createRecurringDonation(DONATION_INPUT);
    await cancelRecurringDonation(created.id);

    const all = await loadRecurringDonations();
    const found = all.find((d) => d.id === created.id);
    expect(found?.status).toBe('cancelled');
  });

  test('does not affect other donations when cancelling one', async () => {
    const keep = await createRecurringDonation(DONATION_INPUT);
    const cancel = await createRecurringDonation(OPEN_ENDED_INPUT);

    await cancelRecurringDonation(cancel.id);

    const all = await loadRecurringDonations();
    const keepDonation = all.find((d) => d.id === keep.id);
    expect(keepDonation?.status).toBe('active');
  });

  test('is idempotent — cancelling an already-cancelled donation is safe', async () => {
    const created = await createRecurringDonation(DONATION_INPUT);
    await cancelRecurringDonation(created.id);
    await cancelRecurringDonation(created.id); // second cancel

    const all = await loadRecurringDonations();
    const found = all.find((d) => d.id === created.id);
    expect(found?.status).toBe('cancelled');
  });

  test('does nothing when the id does not match any donation', async () => {
    await createRecurringDonation(DONATION_INPUT);
    await cancelRecurringDonation('nonexistent-id');

    const all = await loadRecurringDonations();
    expect(all[0].status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// 4. loadRecurringDonations() after cancel — reflects updated status
// ---------------------------------------------------------------------------

describe('loadRecurringDonations() after cancelRecurringDonation()', () => {
  test('shows cancelled status for the cancelled donation', async () => {
    const created = await createRecurringDonation(DONATION_INPUT);
    await cancelRecurringDonation(created.id);

    const all = await loadRecurringDonations();
    expect(all.find((d) => d.id === created.id)?.status).toBe('cancelled');
  });

  test('total number of donations is unchanged after cancellation', async () => {
    const a = await createRecurringDonation(DONATION_INPUT);
    const b = await createRecurringDonation(OPEN_ENDED_INPUT);

    await cancelRecurringDonation(a.id);

    const all = await loadRecurringDonations();
    expect(all).toHaveLength(2);
  });

  test('non-cancelled donations still show status "active" after a sibling is cancelled', async () => {
    const a = await createRecurringDonation(DONATION_INPUT);
    const b = await createRecurringDonation(OPEN_ENDED_INPUT);

    await cancelRecurringDonation(a.id);

    const all = await loadRecurringDonations();
    expect(all.find((d) => d.id === b.id)?.status).toBe('active');
  });
});
