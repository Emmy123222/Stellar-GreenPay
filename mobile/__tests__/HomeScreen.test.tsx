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


jest.mock('../utils/notifications', () => ({
  getPushToken: jest.fn().mockResolvedValue(null),
  getUnreadNotificationCount: jest.fn().mockResolvedValue(0),
  setupNotificationListener: jest.fn(() => ({ remove: jest.fn() })),
  setupNotificationResponseListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-notifications', () => ({
  setBadgeCountAsync: jest.fn().mockResolvedValue(true),
  getBadgeCountAsync: jest.fn().mockResolvedValue(0),
}));


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

function wrap(element: React.ReactElement) {
  return <ThemeProvider>{element}</ThemeProvider>;
}

/** Wrap in ThemeProvider so useTheme() doesn't throw. */
async function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

/**
 * Match the production API shape: GET /api/projects
 *   → { data: ClimateProject[] }
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
    jest.clearAllMocks();
    (axios.get as jest.Mock).mockReset();
  });

  it('shows the header before data arrives', () => {
    (axios.get as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    const { getByText, queryByText } = render(wrap(<HomeScreen />));
    expect(getByText('Stellar GreenPay')).toBeTruthy();
    expect(queryByText('Amazon Reforestation Initiative')).toBeNull();
  });

  it('renders the app title', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });

    const { getByText } = render(wrap(<HomeScreen />));
    await waitFor(() => expect(getByText('Stellar GreenPay')).toBeTruthy());
  });

  it('renders project cards with progress after data loads', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });

    const { getByText } = render(wrap(<HomeScreen />));
    await waitFor(() => {
      expect(getByText('Amazon Reforestation Initiative')).toBeTruthy();
      expect(getByText('18420 / 50000 XLM')).toBeTruthy();
      expect(getByText('147 donors')).toBeTruthy();
    });
  });

  it('renders the header chrome while projects are loading', async () => {
    (axios.get as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { getByText, queryByText } = await act(async () =>
      renderWithTheme(<HomeScreen />)
    );

    expect(getByText('Stellar GreenPay')).toBeTruthy();
    expect(getByText('Climate donations on Stellar')).toBeTruthy();
    expect(queryByText(MOCK_PROJECT.name)).toBeNull();
  });

  it('renders project cards once /api/projects responds', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });

    const { getByText } = await act(async () => renderWithTheme(<HomeScreen />));

    await waitFor(() =>
      expect(getByText(MOCK_PROJECT.name)).toBeTruthy()
    );
    await waitFor(() =>
      expect(getByText(`${MOCK_PROJECT.donorCount} donors`)).toBeTruthy()
    );
  });

  it('renders project cards with an accessible label', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });

    const { getByLabelText } = render(wrap(<HomeScreen />));
    await waitFor(() =>
      expect(getByLabelText('View Amazon Reforestation Initiative project')).toBeTruthy()
    );
  });

  it('survives a network failure without rendering project data', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('network error'));

    const { queryByText, findByText } = await act(async () =>
      renderWithTheme(<HomeScreen />)
    );

    await findByText('Stellar GreenPay');
    await findByText('Climate donations on Stellar');
    expect(queryByText(MOCK_PROJECT.name)).toBeNull();
  });

  it('does not crash when subscriptions are torn down on unmount', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });

    const view = await act(async () => renderWithTheme(<HomeScreen />));
    await waitFor(() => expect(view.getByText(MOCK_PROJECT.name)).toBeTruthy());

    expect(() => view.unmount()).not.toThrow();
  });
});

