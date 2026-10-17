/**
 * __tests__/RecurringScreen.test.tsx
 *
 * Tests for issue #1119 — confirmation dialog before cancelling a recurring
 * donation (mobile/app/recurring.tsx).
 *
 * Coverage:
 *  1. Tapping "Cancel" on a DonationCard shows Alert.alert with the exact
 *     interpolated title/message from the acceptance criteria.
 *  2. Pressing "Keep donation" (the 'cancel'-styled button) does NOT call
 *     cancelRecurringDonation.
 *  3. Pressing "Cancel donation" (the destructive button) calls
 *     cancelRecurringDonation with the correct id and removes the card
 *     from the list on success.
 *  4. A failed cancelRecurringDonation surfaces an error alert and does NOT
 *     remove the item from the list.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => {
  // `jest.mock` factories are hoisted above the module scope, so `React`
  // is not in scope here — require it inside the factory.
  const ReactLib = require('react');
  return {
    useFocusEffect: (cb: () => void) => {
      // Run synchronously so data loads before the first render.
      ReactLib.useEffect(cb, []);
    },
  };
});

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

// Mock the recurringDonations utility so we can control async behaviour and
// spy on cancelRecurringDonation without hitting AsyncStorage. The screen is
// driven by `useRecurringDonations`, so the mock has to provide a stateful
// hook too — otherwise the screen renders no cards at all.
jest.mock('../utils/recurringDonations', () => {
  const ReactLib = require('react');
  const MOCK_DONATION = {
    id: 'rec-test-001',
    projectId: 'proj-001',
    projectName: 'Amazon Reforestation',
    amountXLM: '25',
    startDate: new Date().toISOString(),
    nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    durationMonths: null,
    remainingMonths: null,
    status: 'active' as const,
    createdAt: new Date().toISOString(),
  };

  const cancelRecurringDonation = jest.fn().mockResolvedValue(undefined);

  return {
    loadRecurringDonations: jest.fn().mockResolvedValue([MOCK_DONATION]),
    loadPaymentHistory: jest.fn().mockResolvedValue([]),
    cancelRecurringDonation,
    createRecurringDonation: jest.fn(),
    saveRecurringDonations: jest.fn(),
    useRecurringDonations: () => {
      const [donations, setDonations] = ReactLib.useState([MOCK_DONATION]);
      const cancel = ReactLib.useCallback(async (id: string) => {
        // Mirrors the real hook: the backend call is authoritative, and only
        // a successful response removes the card.
        await cancelRecurringDonation(id);
        setDonations((prev: typeof donations) => prev.filter((d) => d.id !== id));
      }, []);
      return {
        donations,
        isSyncing: false,
        error: null,
        refresh: jest.fn(),
        create: jest.fn(),
        cancel,
      };
    },
  };
});

import {
  loadRecurringDonations,
  loadPaymentHistory,
  cancelRecurringDonation,
} from '../utils/recurringDonations';
import RecurringScreen from '../app/recurring';
import { ThemeProvider } from '../app/theme';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cancelRecurringMock = cancelRecurringDonation as jest.Mock;
const loadDonationsMock = loadRecurringDonations as jest.Mock;

// Capture Alert.alert calls so we can inspect title, message and simulate
// button presses without a real native dialog.
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert');

  // Restore default success behaviour for each test.
  cancelRecurringMock.mockResolvedValue(undefined);
  loadDonationsMock.mockResolvedValue([
    {
      id: 'rec-test-001',
      projectId: 'proj-001',
      projectName: 'Amazon Reforestation',
      amountXLM: '25',
      startDate: new Date().toISOString(),
      nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      durationMonths: null,
      remainingMonths: null,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
    },
  ]);
  (loadPaymentHistory as jest.Mock).mockResolvedValue([]);
  (axios.get as jest.Mock).mockResolvedValue({ data: { data: [] } });
});

afterEach(() => {
  alertSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecurringScreen — cancel confirmation dialog (#1119)', () => {
  test('tapping Cancel shows Alert.alert with the correct interpolated message', async () => {
    const { getByLabelText } = await render(
      <ThemeProvider>
        <RecurringScreen />
      </ThemeProvider>,
    );

    // Wait for donation card to appear after async loadRecurringDonations.
    await waitFor(() => {
      getByLabelText('Cancel recurring donation to Amazon Reforestation');
    });

    fireEvent.press(
      getByLabelText('Cancel recurring donation to Amazon Reforestation'),
    );

    expect(alertSpy).toHaveBeenCalledWith(
      'Cancel Recurring Donation',
      'Cancel monthly donation of 25 XLM to Amazon Reforestation? This cannot be undone.',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Keep donation', style: 'cancel' }),
        expect.objectContaining({ text: 'Cancel donation', style: 'destructive' }),
      ]),
    );
  });

  test('pressing "Keep donation" does NOT call cancelRecurringDonation', async () => {
    const { getByLabelText } = await render(
      <ThemeProvider>
        <RecurringScreen />
      </ThemeProvider>,
    );
    await waitFor(() =>
      getByLabelText('Cancel recurring donation to Amazon Reforestation'),
    );

    fireEvent.press(
      getByLabelText('Cancel recurring donation to Amazon Reforestation'),
    );

    // Find the "Keep donation" button in the alert and confirm it has no onPress
    // (style:'cancel' means native dismissal — no onPress handler needed).
    const alertCall = alertSpy.mock.calls[0];
    const buttons: { text: string; style?: string; onPress?: () => void }[] =
      alertCall[2];
    const keepBtn = buttons.find((b) => b.text === 'Keep donation');

    expect(keepBtn).toBeDefined();
    // Calling the Keep handler (if any) must not trigger a delete.
    keepBtn?.onPress?.();

    expect(cancelRecurringMock).not.toHaveBeenCalled();
  });

  test('confirming "Cancel donation" calls cancelRecurringDonation with the correct id', async () => {
    const { getByLabelText } = await render(
      <ThemeProvider>
        <RecurringScreen />
      </ThemeProvider>,
    );
    await waitFor(() =>
      getByLabelText('Cancel recurring donation to Amazon Reforestation'),
    );

    fireEvent.press(
      getByLabelText('Cancel recurring donation to Amazon Reforestation'),
    );

    const alertCall = alertSpy.mock.calls[0];
    const buttons: { text: string; style?: string; onPress?: () => void }[] =
      alertCall[2];
    const confirmBtn = buttons.find((b) => b.text === 'Cancel donation');

    expect(confirmBtn).toBeDefined();

    await act(async () => {
      confirmBtn?.onPress?.();
    });

    expect(cancelRecurringMock).toHaveBeenCalledWith('rec-test-001');
  });

  test('on success the donation card is removed from the list', async () => {
    const { getByLabelText, queryByLabelText } = await render(
      <ThemeProvider>
        <RecurringScreen />
      </ThemeProvider>,
    );
    await waitFor(() =>
      getByLabelText('Cancel recurring donation to Amazon Reforestation'),
    );

    fireEvent.press(
      getByLabelText('Cancel recurring donation to Amazon Reforestation'),
    );

    const alertCall = alertSpy.mock.calls[0];
    const buttons: { text: string; style?: string; onPress?: () => void }[] =
      alertCall[2];
    const confirmBtn = buttons.find((b) => b.text === 'Cancel donation');

    await act(async () => {
      confirmBtn?.onPress?.();
    });

    await waitFor(() => {
      expect(
        queryByLabelText(
          'Cancel recurring donation to Amazon Reforestation',
        ),
      ).toBeNull();
    });
  });

  test('on failed delete shows an error alert and keeps the card visible', async () => {
    cancelRecurringMock.mockRejectedValueOnce(new Error('Network error'));

    const { getByLabelText } = await render(
      <ThemeProvider>
        <RecurringScreen />
      </ThemeProvider>,
    );
    await waitFor(() =>
      getByLabelText('Cancel recurring donation to Amazon Reforestation'),
    );

    fireEvent.press(
      getByLabelText('Cancel recurring donation to Amazon Reforestation'),
    );

    const confirmationAlertCall = alertSpy.mock.calls[0];
    const buttons: { text: string; style?: string; onPress?: () => void }[] =
      confirmationAlertCall[2];
    const confirmBtn = buttons.find((b) => b.text === 'Cancel donation');

    await act(async () => {
      confirmBtn?.onPress?.();
    });

    // A second Alert should have been shown for the error.
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledTimes(2);
    });

    const errorAlertCall = alertSpy.mock.calls[1];
    expect(errorAlertCall[0]).toBe('Cancellation Failed');

    // The donation card must still be visible.
    expect(
      getByLabelText(
        'Cancel recurring donation to Amazon Reforestation',
      ),
    ).toBeTruthy();
  });
});
