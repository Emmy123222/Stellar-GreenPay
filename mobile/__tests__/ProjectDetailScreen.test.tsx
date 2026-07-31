/**
 * __tests__/ProjectDetailScreen.test.tsx
 *
 * Unit tests for the Follow button interactions on the project detail screen.
 * Covers issue #399:
 *  - Follow button wired to POST /api/projects/:id/follows
 *  - Toast confirmation shown on success and error
 *  - Button state updates to "Following · Tap to unfollow" after follow
 *  - Unfollow flow resets button to default state
 *  - Loading state shown during in-flight request
 *  - Error toast shown when followProject returns false
 *  - Error toast shown when push token is unavailable
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import axios from 'axios';

// ── Router / Expo mocks ────────────────────────────────────────────────────────
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({ id: 'proj-1' }),
  useFocusEffect: (cb: () => void) => cb(),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

// ── Notification utility mocks ─────────────────────────────────────────────────
jest.mock('../utils/notifications', () => ({
  getPushToken: jest.fn(),
  followProject: jest.fn(),
  unfollowProject: jest.fn(),
}));

jest.mock('../utils/recurringDonations', () => ({
  loadRecurringDonations: jest.fn(),
}));

import * as notifUtils from '../utils/notifications';
import { loadRecurringDonations } from '../utils/recurringDonations';

// ── Global fetch mock (used by checkFollowStatus) ──────────────────────────────
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// ── Animated mock (avoids act() warnings for native animations) ────────────────
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

// ── Sample data ────────────────────────────────────────────────────────────────
const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'Amazon Reforestation Initiative',
  description: 'Planting 1 million native trees in the Brazilian Amazon.',
  category: 'Reforestation',
  location: 'Brazil',
  walletAddress: 'GAUUCYNO24CCKKNOMT5AS6D73J6QMYC5IJI64H4ZBJL7NQUETW3KOO4J',
  goalXLM: '50000',
  raisedXLM: '18420',
  donorCount: 147,
  co2OffsetKg: 245000,
  status: 'active',
};

// Helper: make fetch return an empty follows list by default
function mockFollowsResponse(follows: object[] = []) {
  mockFetch.mockResolvedValue({
    json: () => Promise.resolve({ success: true, data: follows }),
  });
}

import { ThemeProvider } from '../app/theme';
import ProjectDetailScreen, { formatNextPaymentDate } from '../app/projects/[id]';

/** Wrap in ThemeProvider so useTheme() doesn't throw. */
function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('ProjectDetailScreen – Follow button', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    // Default: project loads successfully
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECT } });
    // Default: push token available
    (notifUtils.getPushToken as jest.Mock).mockResolvedValue('expo-push-token-abc');
    // Default: not currently following
    mockFollowsResponse([]);
    // Default: follow/unfollow succeed
    (notifUtils.followProject as jest.Mock).mockResolvedValue(true);
    (notifUtils.unfollowProject as jest.Mock).mockResolvedValue(true);
    (loadRecurringDonations as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Initial render ───────────────────────────────────────────────────────────

  it('renders the Follow button after the project loads', async () => {
    const { getByTestId } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => expect(getByTestId('follow-button')).toBeTruthy());
  });

  it('shows "Follow for Updates" text when not following', async () => {
    const { getByTestId } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() =>
      expect(getByTestId('follow-button')).toBeTruthy()
    );
    const btn = await waitFor(() => getByTestId('follow-button'));
    expect(btn.props.accessibilityLabel).toMatch(/follow for updates/i);
  });

  // ── Follow action ────────────────────────────────────────────────────────────

  it('calls followProject with the project id and push token on press', async () => {
    const { getByTestId } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    expect(notifUtils.followProject).toHaveBeenCalledWith(
      'proj-1',
      'expo-push-token-abc'
    );
  });

  it('updates button label to "Following · Tap to unfollow" after successful follow', async () => {
    const { getByTestId } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    await waitFor(() =>
      expect(getByTestId('follow-button').props.accessibilityLabel).toMatch(
        /following.*tap to unfollow/i
      )
    );
  });

  it('shows a success toast after following', async () => {
    const { getByTestId, findByText } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    const toast = await findByText(/following.*Amazon Reforestation/i);
    expect(toast).toBeTruthy();
  });

  // ── Unfollow action ──────────────────────────────────────────────────────────

  it('calls unfollowProject when pressing the button while following', async () => {
    // Start in "already following" state
    mockFollowsResponse([{ id: 'proj-1' }]);

    const { getByTestId } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => {
      expect(getByTestId('follow-button').props.accessibilityLabel).toMatch(
        /following/i
      );
    });

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    expect(notifUtils.unfollowProject).toHaveBeenCalledWith(
      'proj-1',
      'expo-push-token-abc',
      undefined
    );
  });

  it('resets button to "Follow for Updates" after unfollowing', async () => {
    mockFollowsResponse([{ id: 'proj-1' }]);

    const { getByTestId } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => {
      expect(getByTestId('follow-button').props.accessibilityLabel).toMatch(
        /following/i
      );
    });

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    await waitFor(() =>
      expect(getByTestId('follow-button').props.accessibilityLabel).toMatch(
        /follow for updates/i
      )
    );
  });

  it('shows an unfollow confirmation toast', async () => {
    mockFollowsResponse([{ id: 'proj-1' }]);

    const { getByTestId, findByText } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => {
      expect(getByTestId('follow-button').props.accessibilityLabel).toMatch(
        /following/i
      );
    });

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    const toast = await findByText(/unfollowed.*Amazon Reforestation/i);
    expect(toast).toBeTruthy();
  });

  // ── Error handling ───────────────────────────────────────────────────────────

  it('shows an error toast when followProject returns false', async () => {
    (notifUtils.followProject as jest.Mock).mockResolvedValue(false);

    const { getByTestId, findByText } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    const toast = await findByText(/could not follow/i);
    expect(toast).toBeTruthy();
  });

  it('shows an error toast when followProject throws', async () => {
    (notifUtils.followProject as jest.Mock).mockRejectedValue(
      new Error('network error')
    );

    const { getByTestId, findByText } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    const toast = await findByText(/something went wrong/i);
    expect(toast).toBeTruthy();
  });

  it('does not toggle follow state when followProject fails', async () => {
    (notifUtils.followProject as jest.Mock).mockResolvedValue(false);

    const { getByTestId } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    // Button should still read "Follow for Updates" — no state change
    await waitFor(() =>
      expect(getByTestId('follow-button').props.accessibilityLabel).toMatch(
        /follow for updates/i
      )
    );
  });

  it('shows an error toast when push token is unavailable', async () => {
    (notifUtils.getPushToken as jest.Mock).mockResolvedValue(null);

    const { getByTestId, findByText } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    const toast = await findByText(/enable notifications/i);
    expect(toast).toBeTruthy();
  });

  // ── Loading state ────────────────────────────────────────────────────────────

  it('disables the button while the follow request is in-flight', async () => {
    // Never resolve so we stay in loading state
    (notifUtils.followProject as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { getByTestId } = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    fireEvent.press(getByTestId('follow-button'));

    await waitFor(() =>
      expect(getByTestId('follow-button').props.accessibilityState.busy).toBe(true)
    );
  });
});

describe('ProjectDetailScreen – Recurring Donation Banner', () => {
  const mockActiveDonation = {
    id: 'rec-1',
    projectId: 'proj-1',
    projectName: 'Amazon Reforestation Initiative',
    amountXLM: '25',
    startDate: '2026-01-01T00:00:00.000Z',
    nextDueDate: '2026-02-01T00:00:00.000Z',
    durationMonths: null,
    remainingMonths: null,
    status: 'active' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECT } });
    (notifUtils.getPushToken as jest.Mock).mockResolvedValue('expo-push-token-abc');
    mockFollowsResponse([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders active recurring donation banner with amount, currency, frequency, and next date', async () => {
    (loadRecurringDonations as jest.Mock).mockResolvedValue([mockActiveDonation]);

    const { getByTestId, getByText } = renderWithTheme(<ProjectDetailScreen />);

    await waitFor(() => expect(getByTestId('recurring-donation-banner')).toBeTruthy());

    expect(getByText(/You have an active monthly donation of/i)).toBeTruthy();
    expect(getByText('25 XLM')).toBeTruthy();
    expect(getByText('Feb 1, 2026')).toBeTruthy();
  });

  it('navigates to recurring management screen when Manage button is pressed', async () => {
    (loadRecurringDonations as jest.Mock).mockResolvedValue([mockActiveDonation]);

    const { getByTestId } = renderWithTheme(<ProjectDetailScreen />);

    await waitFor(() => expect(getByTestId('manage-recurring-button')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('manage-recurring-button'));
    });

    expect(mockPush).toHaveBeenCalledWith('/recurring');
  });

  it('does not render banner when no recurring donations exist', async () => {
    (loadRecurringDonations as jest.Mock).mockResolvedValue([]);

    const { queryByTestId } = renderWithTheme(<ProjectDetailScreen />);

    await waitFor(() => expect(queryByTestId('follow-button')).toBeTruthy());
    expect(queryByTestId('recurring-donation-banner')).toBeNull();
  });

  it('does not render banner when recurring donation is cancelled or completed', async () => {
    const cancelledDonation = { ...mockActiveDonation, status: 'cancelled' as const };
    const completedDonation = { ...mockActiveDonation, status: 'completed' as const };
    (loadRecurringDonations as jest.Mock).mockResolvedValue([cancelledDonation, completedDonation]);

    const { queryByTestId } = renderWithTheme(<ProjectDetailScreen />);

    await waitFor(() => expect(queryByTestId('follow-button')).toBeTruthy());
    expect(queryByTestId('recurring-donation-banner')).toBeNull();
  });

  it('does not render banner when active donation is for a different project', async () => {
    const otherProjectDonation = { ...mockActiveDonation, projectId: 'proj-other' };
    (loadRecurringDonations as jest.Mock).mockResolvedValue([otherProjectDonation]);

    const { queryByTestId } = renderWithTheme(<ProjectDetailScreen />);

    await waitFor(() => expect(queryByTestId('follow-button')).toBeTruthy());
    expect(queryByTestId('recurring-donation-banner')).toBeNull();
  });

  it('satisfies accessibility requirements for banner and manage button', async () => {
    (loadRecurringDonations as jest.Mock).mockResolvedValue([mockActiveDonation]);

    const { getByTestId } = renderWithTheme(<ProjectDetailScreen />);

    await waitFor(() => expect(getByTestId('recurring-donation-banner')).toBeTruthy());

    const banner = getByTestId('recurring-donation-banner');
    const manageBtn = getByTestId('manage-recurring-button');

    expect(banner.props.accessibilityRole).toBe('region');
    expect(manageBtn.props.accessibilityRole).toBe('button');
    expect(manageBtn.props.accessibilityLabel).toBe('Manage recurring donations');
  });

  it('formats next payment date correctly', () => {
    expect(formatNextPaymentDate('2026-02-01T00:00:00.000Z')).toBe('Feb 1, 2026');
    expect(formatNextPaymentDate('invalid-date')).toBe('invalid-date');
  });
});
