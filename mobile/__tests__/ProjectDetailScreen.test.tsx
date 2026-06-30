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
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'proj-1' }),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

// ── Notification utility mocks ─────────────────────────────────────────────────
jest.mock('../utils/notifications', () => ({
  getPushToken: jest.fn(),
  followProject: jest.fn(),
  unfollowProject: jest.fn(),
}));

import * as notifUtils from '../utils/notifications';

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
import ProjectDetailScreen from '../app/projects/[id]';

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
