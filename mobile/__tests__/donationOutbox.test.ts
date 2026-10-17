/**
 * __tests__/donationOutbox.test.ts
 *
 * Offline donation queue (issue #1655): store, restore and discard paths,
 * plus the guarantee that a corrupt or unreadable queue never throws.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DONATION_OUTBOX_KEY,
  queueDonation,
  readDonationOutbox,
  removeQueuedDonation,
  removeQueuedDonationsForProject,
} from '../utils/donationOutbox';

const store = (AsyncStorage as unknown as { __store: Record<string, string> }).__store;

const INTENT = {
  projectId: 'proj-1',
  projectName: 'Amazon Reforestation',
  destination: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
  amountXLM: '10.0000000',
  memo: 'For the trees',
  donorPublicKey: 'GDONOR'.padEnd(56, 'X'),
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('queueDonation (store)', () => {
  it('persists the intent under a single AsyncStorage key', async () => {
    const queued = await queueDonation(INTENT);

    expect(queued).not.toBeNull();
    expect(queued?.amountXLM).toBe('10.0000000');
    expect(queued?.projectName).toBe('Amazon Reforestation');

    const raw = store[DONATION_OUTBOX_KEY];
    expect(typeof raw).toBe('string');
    expect(JSON.parse(raw)).toHaveLength(1);
  });

  it('persists only the intent fields, never a signing secret', async () => {
    const withSecret = { ...INTENT, secretKey: 'SBW3THISISANEXAMPLESECRETKEY' } as typeof INTENT & {
      secretKey: string;
    };
    const queued = await queueDonation(withSecret);

    expect(store[DONATION_OUTBOX_KEY]).not.toContain('SBW3T');
    expect(queued).not.toHaveProperty('secretKey');
  });

  it('rejects an incomplete intent and writes nothing', async () => {
    await expect(queueDonation({ ...INTENT, amountXLM: '0' })).resolves.toBeNull();
    await expect(queueDonation({ ...INTENT, destination: '  ' })).resolves.toBeNull();
    await expect(queueDonation({ ...INTENT, projectId: '' })).resolves.toBeNull();
    expect(store[DONATION_OUTBOX_KEY]).toBeUndefined();
  });

  it('appends to an existing queue', async () => {
    await queueDonation(INTENT);
    await queueDonation({ ...INTENT, projectName: 'Coastal Cleanup', amountXLM: '5.0000000' });

    const queue = await readDonationOutbox();
    expect(queue).toHaveLength(2);
    expect(queue[1].projectName).toBe('Coastal Cleanup');
  });
});

describe('readDonationOutbox (restore)', () => {
  it('returns an empty queue when nothing was stored', async () => {
    expect(await readDonationOutbox()).toEqual([]);
  });

  it('restores intents written by an earlier session', async () => {
    await queueDonation(INTENT);

    const restored = await readDonationOutbox();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      projectId: INTENT.projectId,
      destination: INTENT.destination,
      amountXLM: INTENT.amountXLM,
      memo: INTENT.memo,
      donorPublicKey: INTENT.donorPublicKey,
    });
  });

  it('tolerates a corrupt payload and malformed entries', async () => {
    await AsyncStorage.setItem(DONATION_OUTBOX_KEY, '{ not json');
    expect(await readDonationOutbox()).toEqual([]);

    await AsyncStorage.setItem(
      DONATION_OUTBOX_KEY,
      JSON.stringify([{ id: 'x' }, { ...INTENT, id: 'ok', amountXLM: '3' }])
    );
    const queue = await readDonationOutbox();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe('ok');
  });

  it('tolerates a storage read failure', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    expect(await readDonationOutbox()).toEqual([]);
  });
});

describe('discard paths', () => {
  it('removeQueuedDonation drops only the selected intent', async () => {
    const first = await queueDonation(INTENT);
    const second = await queueDonation({ ...INTENT, projectName: 'Solar Schools' });

    const remaining = await removeQueuedDonation(first!.id);
    expect(remaining.map((item) => item.id)).toEqual([second!.id]);
  });

  it('clears the storage key once the queue is empty', async () => {
    const queued = await queueDonation(INTENT);
    await removeQueuedDonation(queued!.id);

    expect(store[DONATION_OUTBOX_KEY]).toBeUndefined();
    expect(await readDonationOutbox()).toEqual([]);
  });

  it('removeQueuedDonationsForProject clears every intent for a project', async () => {
    await queueDonation(INTENT);
    await queueDonation({ ...INTENT, projectName: 'Another donation' });
    await queueDonation({ ...INTENT, projectId: 'proj-2' });

    await expect(removeQueuedDonationsForProject('proj-1')).resolves.toBe(2);
    const queue = await readDonationOutbox();
    expect(queue).toHaveLength(1);
    expect(queue[0].projectId).toBe('proj-2');
  });
});
