/**
 * Tests for utils/recurringDonations.ts
 *
 * Uses the in-memory AsyncStorage mock at
 * __mocks__/@react-native-async-storage/async-storage.js so no real
 * device storage is touched. Each test starts with a clean store.
 *
 * The backend-facing tests mock the shared axios module
 * (`__mocks__/axios.js`) directly: the utility talks to
 * `GET/POST/DELETE /api/recurring-donations`, which per #1059 is the
 * source of truth for schedules while AsyncStorage is only a cache.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {
  createRecurringDonation,
  loadRecurringDonations,
  cancelRecurringDonation,
  syncRecurringDonations,
  mapServerPledge,
  RECURRING_DONATIONS_KEY,
  type RecurringDonation,
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

// ---------------------------------------------------------------------------
// 5. #1059 — backend is the source of truth for schedules
// ---------------------------------------------------------------------------

const DONOR = 'G'.padEnd(56, 'A');
const OTHER_DONOR = 'G'.padEnd(56, 'B');

function serverPledge(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    donorAddress: DONOR,
    projectId: 'proj-001',
    projectName: 'Amazon Reforestation',
    amountXlm: 50,
    currency: 'XLM',
    nextDueDate: '2026-12-05',
    durationMonths: 6,
    remainingMonths: 4,
    status: 'active',
    createdAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

function mockPledgeList(pledges: unknown[]) {
  (axios.get as jest.Mock).mockResolvedValue({
    status: 200,
    data: { success: true, data: pledges },
  });
}

function localDonation(overrides: Partial<RecurringDonation> = {}): RecurringDonation {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    serverId: '11111111-1111-4111-8111-111111111111',
    projectId: 'proj-001',
    projectName: 'Amazon Reforestation',
    amountXLM: '50',
    startDate: '2026-01-05',
    nextDueDate: '2026-11-05',
    durationMonths: 6,
    remainingMonths: 5,
    status: 'active',
    createdAt: '2026-01-05T00:00:00.000Z',
    donorAddress: DONOR,
    ...overrides,
  };
}

describe('syncRecurringDonations() — backend as source of truth (#1059)', () => {
  test('queries GET /api/recurring-donations scoped to the donor', async () => {
    mockPledgeList([]);
    await syncRecurringDonations(DONOR);

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/recurring-donations'),
      { params: { donor: DONOR } },
    );
  });

  test('the server schedule wins over a stale local nextDueDate', async () => {
    // Simulates a device whose clock was reset: the cached copy drifted back
    // a month, the server copy is correct.
    await AsyncStorage.setItem(
      RECURRING_DONATIONS_KEY,
      JSON.stringify([localDonation({ nextDueDate: '2026-09-05', remainingMonths: 9 })]),
    );
    mockPledgeList([serverPledge({ nextDueDate: '2026-12-05', remainingMonths: 4 })]);

    const { donations, remoteAvailable } = await syncRecurringDonations(DONOR);

    expect(remoteAvailable).toBe(true);
    expect(donations).toHaveLength(1);
    expect(donations[0].nextDueDate).toBe('2026-12-05');
    expect(donations[0].remainingMonths).toBe(4);
  });

  test('writes the reconciled schedule through to the AsyncStorage cache', async () => {
    mockPledgeList([serverPledge()]);
    await syncRecurringDonations(DONOR);

    const cached = await loadRecurringDonations();
    expect(cached).toHaveLength(1);
    expect(cached[0].serverId).toBe('11111111-1111-4111-8111-111111111111');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      RECURRING_DONATIONS_KEY,
      expect.any(String),
    );
  });

  test('a fresh install with an empty cache restores the full schedule from the backend', async () => {
    // Reinstall case: nothing in AsyncStorage, so the backend is all we have.
    mockPledgeList([serverPledge(), serverPledge({ id: '22222222-2222-4222-8222-222222222222' })]);

    const { donations } = await syncRecurringDonations(DONOR);

    expect(donations).toHaveLength(2);
    expect(donations.map((d) => d.serverId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(donations[0].nextDueDate).toBe('2026-12-05');
  });

  test('does not duplicate a pledge that is both cached locally and on the server', async () => {
    await AsyncStorage.setItem(
      RECURRING_DONATIONS_KEY,
      JSON.stringify([localDonation()]),
    );
    mockPledgeList([serverPledge()]);

    const { donations } = await syncRecurringDonations(DONOR);
    expect(donations).toHaveLength(1);
  });

  test('drops a local pledge the server no longer returns (deleted upstream)', async () => {
    await AsyncStorage.setItem(RECURRING_DONATIONS_KEY, JSON.stringify([localDonation()]));
    mockPledgeList([]);

    const { donations } = await syncRecurringDonations(DONOR);
    expect(donations).toEqual([]);
  });

  test('honours a cancellation made on another device', async () => {
    await AsyncStorage.setItem(RECURRING_DONATIONS_KEY, JSON.stringify([localDonation()]));
    mockPledgeList([serverPledge({ status: 'cancelled' })]);

    const { donations } = await syncRecurringDonations(DONOR);
    expect(donations).toEqual([]);
  });

  test('keeps a local cancellation that has not reached the server yet', async () => {
    await AsyncStorage.setItem(
      RECURRING_DONATIONS_KEY,
      JSON.stringify([localDonation({ status: 'cancelled' })]),
    );
    mockPledgeList([serverPledge({ status: 'active' })]);

    const { donations } = await syncRecurringDonations(DONOR);
    expect(donations).toHaveLength(1);
    expect(donations[0].status).toBe('cancelled');
  });

  test('falls back to the cache without throwing when the backend is unreachable', async () => {
    await AsyncStorage.setItem(RECURRING_DONATIONS_KEY, JSON.stringify([localDonation()]));
    (axios.get as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    const { donations, remoteAvailable } = await syncRecurringDonations(DONOR);

    expect(remoteAvailable).toBe(false);
    expect(donations).toHaveLength(1);
    expect(donations[0].nextDueDate).toBe('2026-11-05');
  });

  test('treats a non-2xx or malformed response as offline rather than wiping the cache', async () => {
    await AsyncStorage.setItem(RECURRING_DONATIONS_KEY, JSON.stringify([localDonation()]));
    (axios.get as jest.Mock).mockResolvedValue({ status: 500, data: { success: false } });

    const { donations, remoteAvailable } = await syncRecurringDonations(DONOR);

    expect(remoteAvailable).toBe(false);
    expect(donations).toHaveLength(1);
  });

  test('stays local-only when no donor address is known yet', async () => {
    await AsyncStorage.setItem(
      RECURRING_DONATIONS_KEY,
      JSON.stringify([localDonation({ donorAddress: undefined })]),
    );

    const { donations, remoteAvailable } = await syncRecurringDonations();

    expect(remoteAvailable).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
    expect(donations).toHaveLength(1);
  });

  test('pushes an offline-created local pledge on the next successful sync', async () => {
    const localOnly = localDonation({
      id: 'rec_local_1',
      serverId: undefined,
      donorAddress: DONOR,
    });
    await AsyncStorage.setItem(RECURRING_DONATIONS_KEY, JSON.stringify([localOnly]));
    mockPledgeList([]);
    (axios.post as jest.Mock).mockResolvedValue({
      status: 201,
      data: { success: true, data: serverPledge() },
    });

    const { donations, pushed } = await syncRecurringDonations(DONOR);

    expect(pushed).toBe(1);
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/recurring-donations'),
      expect.objectContaining({ donorAddress: DONOR, projectId: 'proj-001', durationMonths: 6 }),
    );
    // The local id is preserved so existing UI keys stay stable.
    expect(donations[0].id).toBe('rec_local_1');
    expect(donations[0].serverId).toBe('11111111-1111-4111-8111-111111111111');
  });

  test('ignores a donor address belonging to a different account', async () => {
    mockPledgeList([serverPledge({ donorAddress: OTHER_DONOR })]);

    const { donations } = await syncRecurringDonations(DONOR);
    // The GET is scoped by `donor=DONOR`, and the map keeps the API's own
    // address, so no cross-account merging happens.
    expect(donations[0].donorAddress).toBe(OTHER_DONOR);
  });
});

// ---------------------------------------------------------------------------
// 6. #1059 — create / cancel persist to the backend
// ---------------------------------------------------------------------------

describe('createRecurringDonation() backend persistence', () => {
  const PROJECT = { status: 200, data: { success: true, data: { id: 'proj-001' } } };

  test('posts the pledge to the backend when a donor address and a term are given', async () => {
    (axios.get as jest.Mock).mockResolvedValue(PROJECT);
    (axios.post as jest.Mock).mockResolvedValue({
      status: 201,
      data: { success: true, data: serverPledge() },
    });

    const created = await createRecurringDonation({
      projectId: 'proj-001',
      projectName: 'Amazon Reforestation',
      amountXLM: '50',
      durationMonths: 6,
      donorAddress: DONOR,
    });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/recurring-donations'),
      expect.objectContaining({ donorAddress: DONOR, projectId: 'proj-001', amountXlm: 50 }),
    );
    expect(created.serverId).toBe('11111111-1111-4111-8111-111111111111');
    // Schedule fields come from the server, not from the device clock.
    expect(created.nextDueDate).toBe('2026-12-05');
  });

  test('keeps the donation local-only when the backend POST fails', async () => {
    (axios.get as jest.Mock).mockResolvedValue(PROJECT);
    (axios.post as jest.Mock).mockRejectedValue(new Error('offline'));

    const created = await createRecurringDonation({
      projectId: 'proj-001',
      projectName: 'Amazon Reforestation',
      amountXLM: '50',
      durationMonths: 6,
      donorAddress: DONOR,
    });

    expect(created.serverId).toBeUndefined();
    const all = await loadRecurringDonations();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(created.id);
  });

  test('open-ended pledges are not posted (the API requires a fixed term)', async () => {
    (axios.get as jest.Mock).mockResolvedValue(PROJECT);

    const created = await createRecurringDonation({
      projectId: 'proj-001',
      projectName: 'Amazon Reforestation',
      amountXLM: '50',
      durationMonths: null,
      donorAddress: DONOR,
    });

    expect(axios.post).not.toHaveBeenCalled();
    expect(created.serverId).toBeUndefined();
  });
});

describe('cancelRecurringDonation() backend cancellation', () => {
  test('issues DELETE /api/recurring-donations/:serverId and marks the local copy', async () => {
    await AsyncStorage.setItem(RECURRING_DONATIONS_KEY, JSON.stringify([localDonation()]));
    (axios.delete as jest.Mock).mockResolvedValue({
      status: 200,
      data: { success: true, data: serverPledge({ status: 'cancelled' }) },
    });

    await cancelRecurringDonation('11111111-1111-4111-8111-111111111111');

    expect(axios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/api/recurring-donations/11111111-1111-4111-8111-111111111111'),
    );
    const [donation] = await loadRecurringDonations();
    expect(donation.status).toBe('cancelled');
  });

  test('still cancels locally when the DELETE fails', async () => {
    await AsyncStorage.setItem(RECURRING_DONATIONS_KEY, JSON.stringify([localDonation()]));
    (axios.delete as jest.Mock).mockRejectedValue(new Error('offline'));

    await cancelRecurringDonation('11111111-1111-4111-8111-111111111111');

    const [donation] = await loadRecurringDonations();
    expect(donation.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// 7. mapServerPledge()
// ---------------------------------------------------------------------------

describe('mapServerPledge()', () => {
  test('maps API fields onto the local shape without reading the device clock', () => {
    const mapped = mapServerPledge(serverPledge());

    expect(mapped).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      serverId: '11111111-1111-4111-8111-111111111111',
      projectId: 'proj-001',
      projectName: 'Amazon Reforestation',
      amountXLM: '50',
      nextDueDate: '2026-12-05',
      durationMonths: 6,
      remainingMonths: 4,
      status: 'active',
    });
  });

  test('survives a pledge row with a missing project name', () => {
    const mapped = mapServerPledge(serverPledge({ projectName: undefined }));
    expect(mapped.projectName).toBe('Recurring donation');
  });
});
