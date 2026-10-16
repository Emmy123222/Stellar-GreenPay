/**
 * __tests__/recurringDonations.foreground.test.tsx
 *
 * #1059 acceptance criterion 3: on app mount and on every return to the
 * foreground, `useRecurringDonations()` re-fetches the schedule from
 * `GET /api/recurring-donations` and reconciles local state, instead of
 * trusting whatever AsyncStorage held. The cache is still what renders
 * first, so an offline device keeps showing its last known schedule.
 *
 * Follows the AppState-capture pattern used by
 * `__tests__/useBiometricAuth.background.test.tsx`.
 */
import React from 'react';
import { Text } from 'react-native';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, act, waitFor } from '@testing-library/react-native';
import axios from 'axios';
import {
  loadRecurringDonations,
  useRecurringDonations,
  RECURRING_DONATIONS_KEY,
  type RecurringDonation,
} from '../utils/recurringDonations';

const DONOR = 'G'.padEnd(56, 'A');
const SERVER_ID = '11111111-1111-4111-8111-111111111111';

function serverPledge(overrides: Record<string, unknown> = {}) {
  return {
    id: SERVER_ID,
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
    id: SERVER_ID,
    serverId: SERVER_ID,
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

type AppStateHandler = (state: string) => void;

let capturedHandler: AppStateHandler | null = null;
let addEventListenerSpy: jest.SpyInstance;

function ActiveCount() {
  const { donations } = useRecurringDonations({ donorAddress: DONOR });
  return (
    <Text testID="count">
      {String(donations.filter((d) => d.status === 'active').length)}
    </Text>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  capturedHandler = null;
  addEventListenerSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation(
    ((_event: string, handler: AppStateHandler) => {
      capturedHandler = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof AppState.addEventListener
  );
});

afterEach(() => {
  addEventListenerSpy.mockRestore();
});

describe('useRecurringDonations() foreground sync (#1059)', () => {
  it('fetches the schedule from the backend on mount', async () => {
    mockPledgeList([serverPledge()]);

    const { getByTestId } = render(<ActiveCount />);
    await waitFor(() => expect(getByTestId('count')).toHaveTextContent('1'));
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/recurring-donations'),
      { params: { donor: DONOR } },
    );
  });

  it('re-fetches and reconciles when the app returns to the foreground', async () => {
    mockPledgeList([serverPledge()]);
    const { getByTestId } = render(<ActiveCount />);
    await waitFor(() => expect(getByTestId('count')).toHaveTextContent('1'));

    // While backgrounded the server advanced the existing pledge and the
    // donor started a second one.
    mockPledgeList([
      serverPledge({ nextDueDate: '2027-01-05', remainingMonths: 3 }),
      serverPledge({
        id: '22222222-2222-4222-8222-222222222222',
        projectName: 'Solar Kenya',
        nextDueDate: '2027-02-05',
      }),
    ]);

    await act(async () => {
      capturedHandler?.('background');
      capturedHandler?.('active');
    });

    await waitFor(() => expect(getByTestId('count')).toHaveTextContent('2'));

    const cached = await loadRecurringDonations();
    expect(cached).toHaveLength(2);
    const advanced = cached.find((d) => d.serverId === SERVER_ID);
    expect(advanced?.nextDueDate).toBe('2027-01-05');
    expect(advanced?.remainingMonths).toBe(3);
  });

  it('ignores background → background transitions', async () => {
    mockPledgeList([serverPledge()]);
    const { getByTestId } = render(<ActiveCount />);
    await waitFor(() => expect(getByTestId('count')).toHaveTextContent('1'));
    expect(axios.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      capturedHandler?.('background');
      capturedHandler?.('background');
    });

    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('removes the AppState listener on unmount', () => {
    const { unmount } = render(<ActiveCount />);
    unmount();
    expect(addEventListenerSpy).toHaveBeenCalled();
  });

  it('renders the cached schedule and keeps it when the backend is unreachable', async () => {
    await AsyncStorage.setItem(
      RECURRING_DONATIONS_KEY,
      JSON.stringify([localDonation({ nextDueDate: '2026-11-05' })]),
    );
    (axios.get as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    const { getByTestId } = render(<ActiveCount />);
    await waitFor(() => expect(getByTestId('count')).toHaveTextContent('1'));

    const [donation] = await loadRecurringDonations();
    expect(donation.nextDueDate).toBe('2026-11-05');
  });
});
