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
import { Share } from 'react-native';
import axios from 'axios';

// ── Router / Expo mocks ────────────────────────────────────────────────────────
// Shared spies used across every test in this file. The factory below closes
// over these references so we can directly inspect calls.
const mockRouterPush = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({ id: 'proj-1' }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  // The screen re-checks the active recurring donation whenever the route is
  // focused, so the mock has to invoke the callback on mount (matching
  // __tests__/accessibility.test.tsx).
  useFocusEffect: (cb: () => void) => {
    cb();
  },
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

// ── Notification utility mocks ─────────────────────────────────────────────────
jest.mock('../utils/notifications', () => ({
  getPushToken: jest.fn(),
  followProject: jest.fn(),
  unfollowProject: jest.fn(),
  markNotificationsSeen: jest.fn().mockResolvedValue(''),
}));

jest.mock('expo-notifications', () => ({
  setBadgeCountAsync: jest.fn().mockResolvedValue(true),
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

/**
 * expo-notifications is imported by the screen and runs a slow module-init
 * path under our `expo-modules-core` Proxy stub (~2s on cold start). The
 * default 5s Jest test timeout is too tight once we add several
 * repeatedly-rendered tests to a single file, so we extend it for this
 * suite specifically.
 */
jest.setTimeout(30000);

/**
 * Wrap in ThemeProvider so useTheme() doesn't throw, then flush the mount
 * effects (the project fetch, notification init, …) inside an empty `act()`.
 *
 * Callers must invoke this DIRECTLY — never as `await act(async () =>
 * renderWithTheme(…))`. `render()` from RNTL already wraps `TestRenderer.create`
 * in its own `act()`; nesting that inside an outer *async* `act()` defers the
 * renderer's root past the point where RNTL reads it, so `renderer.root` throws
 * "Can't access .root on unmounted test renderer" and every test in the file
 * fails before it can assert anything. The empty `act()` below gives the same
 * "let mount effects settle" behaviour without wrapping the render call.
 */
async function renderWithTheme(ui: React.ReactElement) {
  const screen = render(<ThemeProvider>{ui}</ThemeProvider>);
  await act(async () => {});
  return screen;
}

describe('ProjectDetailScreen – Follow button', () => {
  beforeEach(() => {
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

  // see file header: fake timers removed (broke waitFor() polling)

  // ── Initial render ───────────────────────────────────────────────────────────

  it('renders the Follow button after the project loads', async () => {
    const { getByTestId } = await renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => expect(getByTestId('follow-button')).toBeTruthy());
  });

  it('shows "Follow for Updates" text when not following', async () => {
    const { getByTestId } = await renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() =>
      expect(getByTestId('follow-button')).toBeTruthy()
    );
    const btn = await waitFor(() => getByTestId('follow-button'));
    expect(btn.props.accessibilityLabel).toMatch(/follow for updates/i);
  });

  // ── Follow action ────────────────────────────────────────────────────────────

  it('calls followProject with the project id and push token on press', async () => {
    const { getByTestId } = await renderWithTheme(<ProjectDetailScreen />);
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
    const { getByTestId } = await renderWithTheme(<ProjectDetailScreen />);
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
    const { getByTestId, findByText } = await renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    const toast = await findByText(/following.*Amazon Reforestation/i);
    expect(toast).toBeTruthy();
  });

  // ── Unfollow action ──────────────────────────────────────────────────────────

  it('calls unfollowProject with the wallet address when pressing the button while following', async () => {
    // Start in "already following" state
    mockFollowsResponse([{ id: 'proj-1' }]);

    const { getByTestId } = await renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => {
      expect(getByTestId('follow-button').props.accessibilityLabel).toMatch(
        /following/i
      );
    });

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    // Regression for the walletAddress ternary bug: the third arg must be
    // the project's Stellar wallet address, NOT `undefined`. The screen
    // forwards it to `unfollowProject`, which in turn hits the REST DELETE
    // on /api/projects/:id/follows. Without this argument, the unfollow
    // would silently fail at the wallet-level follow record.
    expect(notifUtils.unfollowProject).toHaveBeenCalledWith(
      'proj-1',
      'expo-push-token-abc',
      MOCK_PROJECT.walletAddress
    );
  });

  it('resets button to "Follow for Updates" after unfollowing', async () => {
    mockFollowsResponse([{ id: 'proj-1' }]);

    const { getByTestId } = await renderWithTheme(<ProjectDetailScreen />);
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

    const { getByTestId, findByText } = await renderWithTheme(<ProjectDetailScreen />);
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

    const { getByTestId, findByText } = await renderWithTheme(<ProjectDetailScreen />);
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

    const { getByTestId, findByText } = await renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    const toast = await findByText(/something went wrong/i);
    expect(toast).toBeTruthy();
  });

  it('does not toggle follow state when followProject fails', async () => {
    (notifUtils.followProject as jest.Mock).mockResolvedValue(false);

    const { getByTestId } = await renderWithTheme(<ProjectDetailScreen />);
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

    const { getByTestId, findByText } = await renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => getByTestId('follow-button'));

    await act(async () => {
      fireEvent.press(getByTestId('follow-button'));
    });

    const toast = await findByText(/enable notifications/i);
    expect(toast).toBeTruthy();
  });

  // ── Share button ─────────────────────────────────────────────────────────────

  it('opens the system share sheet with the project name and description when the share button is pressed', async () => {
    // RN's Share is a real native API under jest-expo, so the screen must
    // observe it being called. We spy on the existing stub rather than
    // re-mocking the module via jest.mock — keeps test ordering independent.
    // Each share-related test wraps the body in try/finally so the spy is
    // restored even if an earlier assertion throws; otherwise a leaked spy
    // could carry stale resolved/rejected values into the next test.
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' as const });
    try {
      const { getByTestId } = await renderWithTheme(<ProjectDetailScreen />);
      const shareButton = await waitFor(() => getByTestId('share-button'));

      await act(async () => {
        fireEvent.press(shareButton);
      });

      expect(shareSpy).toHaveBeenCalledTimes(1);
      const callArgs = shareSpy.mock.calls[0][0];
      expect(callArgs.title).toBe(MOCK_PROJECT.name);
      expect(callArgs.message).toContain(MOCK_PROJECT.name);
      expect(callArgs.message).toContain(MOCK_PROJECT.description);
    } finally {
      shareSpy.mockRestore();
    }
  });

  it('does NOT show an error toast when the user dismisses the share sheet on iOS', async () => {
    // iOS surfaces a literal `Error: User did not share` when the user
    // dismisses the share sheet — that's normal behavior and must NOT be
    // reported as a failure.
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockRejectedValueOnce(new Error('User did not share'));
    try {
      const { getByTestId, queryByText } = await renderWithTheme(<ProjectDetailScreen />);
      const shareButton = await waitFor(() => getByTestId('share-button'));

      await act(async () => {
        fireEvent.press(shareButton);
      });

      // Give the rejection a tick to propagate; no error toast should appear.
      await waitFor(() => {
        expect(queryByText(/could not open share dialog/i)).toBeNull();
      });
      // Sanity: the spy was actually called (so the rejection path ran).
      expect(shareSpy).toHaveBeenCalledTimes(1);
    } finally {
      shareSpy.mockRestore();
    }
  });

  it('shows an error toast when the share sheet fails with a non-dismissal error', async () => {
    // A real failure (JS exception, Android SecurityException, etc.) should
    // surface as the existing error toast.
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockRejectedValueOnce(new Error('System share unavailable'));
    try {
      const { getByTestId, findByText } = await renderWithTheme(<ProjectDetailScreen />);
      const shareButton = await waitFor(() => getByTestId('share-button'));

      await act(async () => {
        fireEvent.press(shareButton);
      });

      const toast = await findByText(/could not open share dialog/i);
      expect(toast).toBeTruthy();
    } finally {
      shareSpy.mockRestore();
    }
  });

  // ── Loading state ────────────────────────────────────────────────────────────

  it('disables the button while the follow request is in-flight', async () => {
    // Never resolve so we stay in loading state
    (notifUtils.followProject as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { getByTestId } = await renderWithTheme(<ProjectDetailScreen />);
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
    const screen = await renderWithTheme(<ProjectDetailScreen />);
    await waitFor(() => expect(screen.getByText(project.name)).toBeTruthy());
    return screen;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockFollowsResponse([]);
    (notifUtils.getPushToken as jest.Mock).mockResolvedValue('expo-push-token-abc');
    (notifUtils.followProject as jest.Mock).mockResolvedValue(true);
    (notifUtils.unfollowProject as jest.Mock).mockResolvedValue(true);
  });

  // see file header: fake timers removed (broke waitFor() polling)

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

    // Match the 📰 emoji prefix to disambiguate from the
    // "🔔 Follow for Updates" button which also contains the
    // word "Updates".
    expect(await renderer.findByText(/📰 Updates/)).toBeTruthy();
    expect(await renderer.findByText(/147 donors have contributed/i)).toBeTruthy();
    expect(await renderer.findByText(/Project active/i)).toBeTruthy();
  });

  it('loads and renders the ocean cleanup project (different id, category)', async () => {
    const p = PROJECTS['ocean-cleanup-2030'];
    // The screen reads `id` from `useLocalSearchParams()`; without this
    // override the file-level mock returns `proj-1` and the screen fetches
    // the wrong project. Mirrors the same override pattern the
    // `requests the project detail from /api/projects/:id` test uses.
    mockUseLocalSearchParams.mockReturnValue({ id: p.id });
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: p } });

    const renderer = await renderWithTheme(<ProjectDetailScreen />);
    const nameNode = await renderer.findByText(p.name);
    expect(nameNode).toBeTruthy();
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining(`/api/projects/${p.id}`)
    );
  });

  it('loads and renders the completed solar village project, including the "Goal fully funded" update', async () => {
    const p = PROJECTS['solar-village-completed'];
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: p } });

    const renderer = await renderWithTheme(<ProjectDetailScreen />);
    expect(await renderer.findByText(p.name)).toBeTruthy();
    expect(await renderer.findByText(/Goal fully funded/i)).toBeTruthy();
    expect(
      await renderer.findByText(/312 donors have hit the 8000 XLM goal/i)
    ).toBeTruthy();
  });

  it('requests the project detail from /api/projects/:id with the id from the route', async () => {
    const projectId = PROJECTS['ocean-cleanup-2030'].id;
    mockUseLocalSearchParams.mockReturnValue({ id: projectId });
    (axios.get as jest.Mock).mockResolvedValue({
      data: { data: PROJECTS[projectId] },
    });

    await renderWithTheme(<ProjectDetailScreen />);

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
    const mockRouter = mockRouterPush;
    const projectId = PROJECTS['amazon-reforestation'].id;
    (axios.get as jest.Mock).mockResolvedValue({
      data: { data: PROJECTS['amazon-reforestation'] },
    });

    const renderer = await renderWithTheme(<ProjectDetailScreen />);
    const donateCta = await renderer.findByText(/Donate Now/i);
    expect(donateCta).toBeTruthy();

    fireEvent.press(donateCta);
    expect(mockRouter).toHaveBeenCalledWith(`/donate/${projectId}`);
  });

  it('shows a graceful "Project not found" state when the API returns 404', async () => {
    (axios.get as jest.Mock).mockRejectedValue({
      response: { status: 404, data: { error: 'Project not found' } },
    });

    const renderer = await renderWithTheme(<ProjectDetailScreen />);
    expect(await renderer.findByText(/Project not found/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1122 — Acceptance Criteria: the project map must not crash when the
// project has no coordinates. The API returns `latitude`/`longitude` as
// `null` for projects created before coordinates were captured; feeding those
// straight into the MapView threw "Cannot read properties of null" and took the
// whole screen down. Instead the screen must render a map-unavailable
// placeholder with a globe icon.
// ─────────────────────────────────────────────────────────────────────────────
describe('ProjectDetailScreen – Issue #1122 AC: map pin with null coordinates', () => {
  /** Base project; each test overrides only the coordinate fields. */
  const baseProject = {
    ...MOCK_PROJECT,
    id: 'map-project',
    name: 'Mangrove Restoration Bay',
    description: 'Restoring coastal mangrove habitat.',
    location: 'Sundarbans',
  };

  /** Render the screen with the given coordinate fields merged onto the project. */
  async function renderWithCoords(
    coords: Partial<{ latitude: number | null; longitude: number | null }>
  ) {
    (axios.get as jest.Mock).mockResolvedValue({
      data: { data: { ...baseProject, ...coords } },
    });
    const renderer = await renderWithTheme(<ProjectDetailScreen />);
    // Wait for the project payload to land so the map branch has been decided.
    await waitFor(() => expect(renderer.getByText(baseProject.name)).toBeTruthy());
    return renderer;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockFollowsResponse([]);
    (notifUtils.getPushToken as jest.Mock).mockResolvedValue('expo-push-token-abc');
    (notifUtils.followProject as jest.Mock).mockResolvedValue(true);
    (notifUtils.unfollowProject as jest.Mock).mockResolvedValue(true);
    (loadRecurringDonations as jest.Mock).mockResolvedValue([]);
  });

  // ── Coordinates present ─────────────────────────────────────────────────────

  it('renders the map instead of the placeholder when both coordinates are set', async () => {
    const renderer = await renderWithCoords({ latitude: 21.9497, longitude: 89.1833 });

    expect(renderer.getByTestId('project-map')).toBeTruthy();
    expect(renderer.queryByTestId('map-unavailable')).toBeNull();
    expect(renderer.queryByText(/Location not available/i)).toBeNull();
  });

  it('centres the map on the project coordinates', async () => {
    const renderer = await renderWithCoords({ latitude: 21.9497, longitude: 89.1833 });

    expect(renderer.getByTestId('project-map').props.region).toMatchObject({
      latitude: 21.9497,
      longitude: 89.1833,
    });
  });

  it('treats 0 as a valid coordinate instead of hiding the map', async () => {
    // A truthiness guard (`project.latitude && ...`) would wrongly treat 0 as
    // "missing" — the Gulf of Guinea is a perfectly valid place to put a pin.
    const renderer = await renderWithCoords({ latitude: 0, longitude: 0 });

    expect(renderer.getByTestId('project-map')).toBeTruthy();
    expect(renderer.queryByTestId('map-unavailable')).toBeNull();
  });

  // ── Coordinates missing / null (#1122 regression) ───────────────────────────

  it('shows the "Location not available" placeholder when latitude is null', async () => {
    const renderer = await renderWithCoords({ latitude: null, longitude: 89.1833 });

    expect(renderer.getByTestId('map-unavailable')).toBeTruthy();
    expect(renderer.getByText(/Location not available/i)).toBeTruthy();
    expect(renderer.queryByTestId('project-map')).toBeNull();
  });

  it('shows the "Location not available" placeholder when longitude is null', async () => {
    const renderer = await renderWithCoords({ latitude: 21.9497, longitude: null });

    expect(renderer.getByTestId('map-unavailable')).toBeTruthy();
    expect(renderer.getByText(/Location not available/i)).toBeTruthy();
    expect(renderer.queryByTestId('project-map')).toBeNull();
  });

  it('shows the "Location not available" placeholder when both coordinates are null', async () => {
    const renderer = await renderWithCoords({ latitude: null, longitude: null });

    expect(renderer.getByTestId('map-unavailable')).toBeTruthy();
    expect(renderer.getByText(/Location not available/i)).toBeTruthy();
    expect(renderer.queryByTestId('project-map')).toBeNull();
  });

  it('shows the placeholder when the coordinate fields are absent entirely', async () => {
    // Older API payloads omit the fields rather than sending explicit nulls.
    const renderer = await renderWithCoords({});

    expect(renderer.getByTestId('map-unavailable')).toBeTruthy();
    expect(renderer.getByText(/Location not available/i)).toBeTruthy();
    expect(renderer.queryByTestId('project-map')).toBeNull();
  });

  it('renders a globe icon alongside the placeholder text', async () => {
    const renderer = await renderWithCoords({ latitude: null, longitude: null });

    expect(renderer.getByText('🌐')).toBeTruthy();
  });

  it('does not crash and still renders the rest of the screen on null coordinates', async () => {
    // The regression: null coordinates used to reach the map section and throw
    // "Cannot read properties of null" out of it, blanking the entire screen.
    // The observable proxy is that the map never mounts — the real native
    // MapView throws when handed a null coordinate, so leaving it unmounted is
    // precisely what keeps the screen alive.
    const renderer = await renderWithCoords({ latitude: null, longitude: null });

    expect(renderer.queryByTestId('project-map')).toBeNull();
    expect(renderer.getByText(baseProject.name)).toBeTruthy();
    expect(renderer.getByText(baseProject.description)).toBeTruthy();
    expect(renderer.getByText(/Fundraising Progress/i)).toBeTruthy();
    expect(renderer.getByText(/Donate Now/i)).toBeTruthy();
    expect(renderer.getByTestId('share-button')).toBeTruthy();
  });

  it('exposes an accessible label on the map-unavailable placeholder', async () => {
    const renderer = await renderWithCoords({ latitude: null, longitude: null });

    expect(renderer.getByTestId('map-unavailable').props.accessibilityLabel).toBe(
      `Location not available for ${baseProject.name}`
    );
  });
});
