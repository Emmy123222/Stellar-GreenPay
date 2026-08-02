/**
 * __tests__/HomeScreen.test.tsx
 *
 * Unit tests for the Home screen component (rebuilt for issue #168 follow-up
 * as a list of project cards rather than a single featured project).
 *
 * Suite contract:
 *  - `app/index.tsx` exposes a header ("Stellar GreenPay"), a FlatList of
 *    project cards, a skeleton fallback during load, and an
 *    "Unable to load projects" error state.
 *  - The backend `/api/projects` returns `{ data: Project[] }`. The test
 *    must therefore wrap its mock project in an array.
 *  - Mocks: axios (API calls), expo-router (navigation), expo-status-bar,
 *    the shared notifications auto-mock (factory-less jest.mock for the
 *    HomeScreen cleanup subscription), and the React Native Animated
 *    helper so animation-driven seeds don't leak act() warnings.
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import axios from 'axios';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

// Opt into the shared auto-mock at `__mocks__/utils/notifications.js`. Jest
// does NOT auto-apply sibling `__mocks__/foo.js` for application-scoped
// (non-`node_modules`) modules — the test must explicitly call
// `jest.mock(path)` (factory-less) to opt in. Without this mock every
// HomeScreen cleanup crashes with
// `TypeError: subscription.remove is not a function`.
jest.mock('../utils/notifications');

// Mock AsyncStorage at the storage layer (NOT the cache.ts wrapper) so the
// production offline-fallback path runs end-to-end: `getCachedData` ↔
// AsyncStorage path executes against an empty store, which means
// cross-test contamination is impossible (every test sees an empty
// AsyncStorage) while still exercising the real `loadProjects` catch-block
// and the future-improvement surface (TTL, stale flag, etc.).
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

import { ThemeProvider } from '../app/theme';
import HomeScreen from '../app/index';

/** Wrap in ThemeProvider so useTheme() doesn't throw. */
async function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

/**
 * Match the production API shape: GET /api/projects
 *   → { data: ClimateProject[] }
 *
 * Earlier revisions of this file mocked `{ data: MOCK_PROJECT }` (a single
 * object). Because the source uses `res.data.data ?? res.data` and the
 * FlatList expects an array, the screen rendered the empty-state UI and
 * every "after data loads" assertion failed even though the network path
 * was wired correctly.
 */
const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'Amazon Reforestation Initiative',
  description: 'Planting trees in the Amazon basin.',
  category: 'Reforestation',
  goalXLM: '50000',
  raisedXLM: '18420',
  donorCount: 147,
  verified: true,
  status: 'active',
};

const MOCK_PROJECTS = [MOCK_PROJECT];

// ── Animated mock ────────────────────────────────────────────────────────────
// Silences warnIfUpdatesNotWrappedWithActDEV from React Native Animated. The
// animation module's update path uses rAF/setTimeout which fires outside any
// act() block, so the only reliable fix is to stub the native helper at the
// bridge level. Mirrors ProjectDetailScreen.test.tsx.
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

describe('HomeScreen', () => {
  beforeEach(() => {
    // `jest.clearAllMocks()` preserves implementations, so a previous
    // test's `mockReturnValue(new Promise(() => {}))` would bleed forward
    // and starve later tests. `mockReset()` clears implementation too.
    jest.clearAllMocks();
    (axios.get as jest.Mock).mockReset();
  });

  it('renders the header chrome while projects are loading', async () => {
    // Make the API never resolve so `loading` stays true and the skeleton
    // branch is rendered. The header is always visible above the skeleton,
    // so we assert via the header text instead of the (deliberately
    // text-free) skeleton placeholders.
    (axios.get as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { getByText, queryByText } = await act(async () =>
      renderWithTheme(<HomeScreen />)
    );

    // Header is part of the FlatList's ListHeaderComponent, which the
    // skeleton branch mounts with the placeholder rows.
    expect(getByText('Stellar GreenPay')).toBeTruthy();
    expect(getByText('Climate donations on Stellar')).toBeTruthy();
    // The project data hasn't arrived, so the card must NOT be present.
    expect(queryByText(MOCK_PROJECT.name)).toBeNull();
  });

  it('renders project cards once /api/projects responds', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });

    const { getByText } = await act(async () => renderWithTheme(<HomeScreen />));

    await waitFor(() =>
      expect(getByText(MOCK_PROJECT.name)).toBeTruthy()
    );
    // Category upper-cased label and donor-count sub-line are rendered for
    // each card; presence of both confirms we are on the loaded branch
    // (not the skeleton or empty-state).
    await waitFor(() =>
      expect(getByText(`${MOCK_PROJECT.donorCount} donors`)).toBeTruthy()
    );
  });

  it('survives a network failure without rendering project data', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('network error'));

    const { queryByText, findByText } = await act(async () =>
      renderWithTheme(<HomeScreen />)
    );

    // Source has two failure branches: `networkError: true` shows
    // "Unable to load projects. Check your connection." with a Retry
    // button. If AsyncStorage holds a stale cache entry the catch-block
    // falls back to that cached data instead of erroring out. The test
    // must NOT depend on which branch fires — assert on the universal
    // invariants instead.
    await findByText('Stellar GreenPay');
    await findByText('Climate donations on Stellar');
    expect(queryByText(MOCK_PROJECT.name)).toBeNull();
  });

  it('does not crash when subscriptions are torn down on unmount', async () => {
    // Regression guard for the `subscription.remove is not a function`
    // cleanup crash that surfaced under the old jest-expo@57 + RNTL@14 +
    // expo-modules-core stacking. The auto-mock provides a fresh
    // `{ remove: jest.fn() }` per call so the cleanup is a no-op.
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });

    const view = await act(async () => renderWithTheme(<HomeScreen />));
    await waitFor(() => expect(view.getByText(MOCK_PROJECT.name)).toBeTruthy());

    expect(() => view.unmount()).not.toThrow();
  });
});
