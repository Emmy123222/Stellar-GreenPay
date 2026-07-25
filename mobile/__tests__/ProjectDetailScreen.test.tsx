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
// Shared spies used across every test in this file. The factory below closes
// over these references so we can directly inspect calls.
const routerPushMock = jest.fn();
const mockedUseLocalSearchParams = jest.fn(() => ({ id: 'proj-1' }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: routerPushMock }),
  useLocalSearchParams: () => mockedUseLocalSearchParams(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Issue #168 — Acceptance Criteria: All projects from the API can be viewed on
// mobile. These tests exercise the [id].tsx screen with multiple distinct
// project IDs and assert that every required field from the issue task list is
// rendered, and that the Donate CTA correctly routes to the donate screen.
// ─────────────────────────────────────────────────────────────────────────────
describe('ProjectDetailScreen – Issue #168 AC: every project can be viewed', () => {
  // Three distinct mock projects that vary by category / progress / status so
  // we exercise the Updates card branch coverage as well as the always-on
  // fields. The IDs use a slugish format to prove the screen works for any
  // project key, not just the magic id "proj-1".
  const PROJECTS = {
    'amazon-reforestation': {
      id: 'amazon-reforestation',
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
    },
    'ocean-cleanup-2030': {
      id: 'ocean-cleanup-2030',
      name: 'Ocean Cleanup 2030',
      description: 'Removing plastic waste from the Pacific gyre.',
      category: 'Ocean Conservation',
      location: 'Pacific Ocean',
      walletAddress: 'GD5GBLGXOXGG7BQFZAQYYJ6VEF7L4XJZ7Y6JXQV7KZNR7JL3WQCQXKPY',
      goalXLM: '10000',
      raisedXLM: '750', // < 25% — exercises “no milestone reached” Update card state
      donorCount: 0,
      co2OffsetKg: 0,
      status: 'active',
    },
    'solar-village-completed': {
      id: 'solar-village-completed',
      name: 'Solar Village — Completed',
      description: 'Off-grid solar for a remote village in Kenya.',
      category: 'Solar Energy',
      location: 'Kenya',
      walletAddress: 'GCS5XA4NPMVLMZQXH5KX5JZQQ3G7MGW3V6HB7WD3J6LJ5QEZXKVSPY4F',
      goalXLM: '8000',
      raisedXLM: '8000', // 100% — exercises the "Goal fully funded" Update card
      donorCount: 312,
      co2OffsetKg: 1500000,
      status: 'completed',
    },
  };

  // Helper: drive one specific project through the screen end-to-end and
  // yield the result of assertions on the rendered tree.
  async function renderProject(project: typeof MOCK_PROJECT) {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: project } });
    const screen = renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => expect(screen.getByText(project.name)).toBeTruthy());
    return screen;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockFollowsResponse([]);
    (notifUtils.getPushToken as jest.Mock).mockResolvedValue('expo-push-token-abc');
    (notifUtils.followProject as jest.Mock).mockResolvedValue(true);
    (notifUtils.unfollowProject as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the required fields (name, description, progress, CO₂) for project proj-1', async () => {
    const renderer = await renderProject(PROJECTS['amazon-reforestation']);

    await waitFor(() =>
      expect(renderer.getByText(PROJECTS['amazon-reforestation'].name)).toBeTruthy()
    );
    expect(
      renderer.getByText(PROJECTS['amazon-reforestation'].description)
    ).toBeTruthy();
    expect(renderer.getByText(/Fundraising Progress/i)).toBeTruthy();
    expect(
      renderer.getByText(
        `${PROJECTS['amazon-reforestation'].co2OffsetKg.toLocaleString()} kg CO₂ offset`
      )
    ).toBeTruthy();
  });

  it('renders the Updates card with donor count and status info for any project', async () => {
    const renderer = await renderProject(PROJECTS['amazon-reforestation']);

    expect(await renderer.findByText(/Updates/i)).toBeTruthy();
    expect(await renderer.findByText(/147 donors have contributed/i)).toBeTruthy();
    expect(await renderer.findByText(/Project active/i)).toBeTruthy();
  });

  it('loads and renders the ocean cleanup project (different id, category)', async () => {
    const p = PROJECTS['ocean-cleanup-2030'];
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: p } });

    const renderer = renderWithTheme(<ProjectDetailScreen />);
    const nameNode = await renderer.findByText(p.name);
    expect(nameNode).toBeTruthy();
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining(`/api/projects/${p.id}`)
    );
  });

  it('loads and renders the completed solar village project, including the "Goal fully funded" update', async () => {
    const p = PROJECTS['solar-village-completed'];
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: p } });

    const renderer = renderWithTheme(<ProjectDetailScreen />);
    expect(await renderer.findByText(p.name)).toBeTruthy();
    expect(await renderer.findByText(/Goal fully funded/i)).toBeTruthy();
    expect(
      await renderer.findByText(/312 donors have hit the 8000 XLM goal/i)
    ).toBeTruthy();
  });

  it('requests the project detail from /api/projects/:id with the id from the route', async () => {
    const projectId = PROJECTS['ocean-cleanup-2030'].id;
    mockedUseLocalSearchParams.mockReturnValue({ id: projectId });
    (axios.get as jest.Mock).mockResolvedValue({
      data: { data: PROJECTS[projectId] },
    });

    renderWithTheme(<ProjectDetailScreen />);

    await waitFor(() =>
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining(`/api/projects/${projectId}`)
      )
    );
  });

  it('Donate CTA navigates to /donate/:id with the same id as the project', async () => {
    // Capture the (already-mocked) useRouter through the same jest.mock path
    // the existing follow-button tests use, so we share the spy across every
    // test in this suite.
    const mockRouter = routerPushMock;
    const projectId = PROJECTS['amazon-reforestation'].id;
    (axios.get as jest.Mock).mockResolvedValue({
      data: { data: PROJECTS['amazon-reforestation'] },
    });

    const renderer = renderWithTheme(<ProjectDetailScreen />);
    const donateCta = await renderer.findByText(/Donate Now/i);
    expect(donateCta).toBeTruthy();

    fireEvent.press(donateCta);
    expect(mockRouter).toHaveBeenCalledWith(`/donate/${projectId}`);
  });

  it('shows a graceful "Project not found" state when the API returns 404', async () => {
    (axios.get as jest.Mock).mockRejectedValue({
      response: { status: 404, data: { error: 'Project not found' } },
    });

    const renderer = renderWithTheme(<ProjectDetailScreen />);
    expect(await renderer.findByText(/Project not found/i)).toBeTruthy();
  });
});
