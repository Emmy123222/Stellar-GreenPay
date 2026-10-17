/**
 * __tests__/accessibility.test.tsx
 * Accessibility audit for all interactive components (#485).
 *
 * Verifies that every TouchableOpacity / Pressable / Button has:
 *   - accessibilityLabel (non-empty)
 *   - accessibilityRole
 *
 * Uses @testing-library/jest-native matchers via getAllByRole.
 *
 * #1658 adds a generic sweep (bottom of file): every screen and shared
 * component is rendered and its whole host tree is walked, so any new
 * touchable or text input without a label/role fails here without anyone
 * having to remember to add a per-screen assertion.
 */
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../app/theme';

// ─── Global mocks ──────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({
    id: 'proj-1',
    address: 'GDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  }),
  useFocusEffect: (cb: () => void) => { cb(); },
}));

// Camera permission is switched per test to reach every branch of scan.tsx.
let mockCameraPermission: { granted: boolean; canAskAgain?: boolean } | null = { granted: true };
jest.mock('expo-camera', () => {
  const { View } = require('react-native');
  const CameraView = (props: object) => <View testID="camera-view" {...props} />;
  CameraView.isAvailableAsync = () => Promise.resolve(true);
  return {
    CameraView,
    useCameraPermissions: () => [mockCameraPermission, jest.fn()],
  };
});

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', ios: { buildNumber: '1' } } },
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn(), createURL: jest.fn() }));
// Not declared in package.json on main; virtual so the profile screen loads.
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}), { virtual: true });
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}), { virtual: true });

// Wallet state for AppHeader / WalletConnect, switched per test.
let mockWallet: { publicKey: string | null; loading: boolean; error: string | null } = {
  publicKey: null,
  loading: false,
  error: null,
};
jest.mock('../src/hooks/useWallet', () => ({
  useWallet: () => ({
    ...mockWallet,
    connect: jest.fn().mockResolvedValue(true),
    disconnect: jest.fn(),
  }),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn(),
  isAvailableAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('file:///tmp/cert.png'),
}));


jest.mock('../utils/notifications', () => ({
  requestNotificationPermissions: jest.fn(),
  getPushToken: jest.fn().mockResolvedValue(null),
  registerDeviceToken: jest.fn(),
  followProject: jest.fn(),
  unfollowProject: jest.fn(),
  getFollowedProjects: jest.fn(),
  getNotificationLastSeen: jest.fn(),
  markNotificationsSeen: jest.fn().mockResolvedValue(''),
  getUnreadNotificationCount: jest.fn().mockResolvedValue(0),
  setupNotificationListener: jest.fn(() => ({ remove: jest.fn() })),
  setupNotificationResponseListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-notifications', () => ({
  setBadgeCountAsync: jest.fn().mockResolvedValue(true),
  getBadgeCountAsync: jest.fn().mockResolvedValue(0),
}));

// Opt into the shared auto-mock at `__mocks__/utils/notifications.js`.
// Jest does NOT auto-apply sibling `__mocks__/foo.js` for application-
// scoped (non-`node_modules`) modules — the test must explicitly call
// `jest.mock(path)` (factory-less) to opt in. Provides stable defaults
// including a `{ remove: jest.fn() }` subscription shape for HomeScreen's
// notification listener unmount.
jest.mock('../utils/notifications');


jest.mock('../hooks/useBiometricAuth', () => ({
  authenticate: jest.fn().mockResolvedValue(true),
  useBiometricAuth: () => ({
    available: true,
    enrolled: true,
    isAuthenticating: false,
    label: 'Face ID',
    lastResult: null,
    authenticate: jest.fn().mockResolvedValue({ success: true, outcome: 'success' }),
    refresh: jest.fn(),
  }),
}));

jest.mock('@stellar/stellar-sdk', () => ({
  Keypair: { fromSecret: jest.fn() },
  Server: jest.fn(() => ({
    loadAccount: jest.fn(),
    submitTransaction: jest.fn(),
  })),
  TransactionBuilder: jest.fn(() => ({
    addOperation: jest.fn().mockReturnThis(),
    addMemo: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnThis(),
  })),
  Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
  StrKey: { isValidEd25519PublicKey: (k: string) => typeof k === 'string' && /^G[A-Z2-7]{55}$/.test(k) },
  Operation: { payment: jest.fn() },
  Asset: { native: jest.fn() },
  Memo: { text: jest.fn() },
}));

const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'Amazon Reforestation',
  description: 'Planting trees.',
  category: 'Reforestation',
  location: 'Brazil',
  goalXLM: '50000',
  raisedXLM: '18420',
  donorCount: 147,
  co2OffsetKg: 1200,
  walletAddress: 'GABC123',
  status: 'active',
};

const MOCK_PROJECTS = [MOCK_PROJECT];

function wrap(element: React.ReactElement) {
  return <ThemeProvider>{element}</ThemeProvider>;
}

// ─── HomeScreen ─────────────────────────────────────────────────────────────


// ── Animated mock ──────────────────────────────────────────────────────────────
// Silences warnIfUpdatesNotWrappedWithActDEV from React Native Animated. The animation
// module's update path uses rAF/setTimeout which fires outside any act() block, so the
// only reliable fix is to stub the native helper at the bridge level. Mirrors
// ProjectDetailScreen.test.tsx.
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

describe('HomeScreen — accessibility', () => {
  beforeEach(() => jest.clearAllMocks());

  it('project cards have accessibilityLabel and role=button', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });
    const HomeScreen = require('../app/index').default;
    const { getAllByRole } = await render(wrap(<HomeScreen />));

    await waitFor(() => {
      const buttons = getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((btn) => {
        expect(btn.props.accessibilityLabel).toBeTruthy();
      });
    });
  });
});

// ─── ProjectsScreen ─────────────────────────────────────────────────────────

describe('ProjectsScreen — accessibility', () => {
  beforeEach(() => jest.clearAllMocks());

  it('project cards have accessibilityLabel and role=button', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });
    const ProjectsScreen = require('../app/projects/index').default;
    const { getAllByRole } = await render(wrap(<ProjectsScreen />));

    await waitFor(() => {
      const buttons = getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((btn) => {
        expect(btn.props.accessibilityLabel).toBeTruthy();
      });
    });
  });

  it('search input has accessibilityLabel', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });
    const ProjectsScreen = require('../app/projects/index').default;
    const { getByLabelText } = await render(wrap(<ProjectsScreen />));

    await waitFor(() => {
      expect(getByLabelText('Search projects')).toBeTruthy();
    });
  });
});

// ─── ProjectDetailScreen ────────────────────────────────────────────────────

describe('ProjectDetailScreen — accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECT } });
  });

  it('share button has accessibilityLabel and role=button', async () => {
    const ProjectDetailScreen = require('../app/projects/[id]').default;
    const { getByLabelText } = await render(wrap(<ProjectDetailScreen />));

    await waitFor(() => {
      const shareBtn = getByLabelText(`Share ${MOCK_PROJECT.name}`);
      expect(shareBtn).toBeTruthy();
      expect(shareBtn.props.accessibilityRole).toBe('button');
    });
  });

  it('donate button has accessibilityLabel and role=button', async () => {
    const ProjectDetailScreen = require('../app/projects/[id]').default;
    const { getByLabelText } = await render(wrap(<ProjectDetailScreen />));

    await waitFor(() => {
      const donateBtn = getByLabelText(`Donate to ${MOCK_PROJECT.name}`);
      expect(donateBtn).toBeTruthy();
      expect(donateBtn.props.accessibilityRole).toBe('button');
    });
  });

  it('all buttons have non-empty accessibilityLabel', async () => {
    const ProjectDetailScreen = require('../app/projects/[id]').default;
    const { getAllByRole } = await render(wrap(<ProjectDetailScreen />));

    await waitFor(() => {
      const buttons = getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((btn) => {
        expect(btn.props.accessibilityLabel).toBeTruthy();
      });
    });
  });
});

// ─── RecurringScreen ─────────────────────────────────────────────────────────

describe('RecurringScreen — accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });
  });

  it('every touchable element has a non-empty accessibilityLabel', async () => {
    const RecurringScreen = require('../app/recurring').default;
    const { getAllByRole } = await render(wrap(<RecurringScreen />));

    await waitFor(() => {
      const buttons = getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((btn) => {
        expect(btn.props.accessibilityLabel).toBeTruthy();
        expect(btn.props.accessibilityRole).toBe('button');
      });
    });
  });

  it('amount input exposes a non-announced / numeric accessibility role', async () => {
    const RecurringScreen = require('../app/recurring').default;
    const { getByLabelText, getByTestId } = await render(wrap(<RecurringScreen />));

    fireEvent.press(await waitFor(() => getByTestId('create-recurring-button')));

    await waitFor(() => {
      const input = getByLabelText('Recurring donation amount in XLM');
      // Either explicitly hidden from the reader ('none') or a numeric role.
      expect(['none', 'adjustable', 'spinbutton']).toContain(
        input.props.accessibilityRole
      );
    });
  });

  it('cancel button has a label distinct from the confirm button', async () => {
    const RecurringScreen = require('../app/recurring').default;
    const { getByLabelText, getByTestId } = await render(wrap(<RecurringScreen />));

    fireEvent.press(await waitFor(() => getByTestId('create-recurring-button')));

    await waitFor(() => {
      const confirmBtn = getByLabelText('Confirm recurring donation');
      const cancelBtn = getByLabelText('Cancel recurring donation setup');
      expect(confirmBtn.props.accessibilityLabel).toBeTruthy();
      expect(cancelBtn.props.accessibilityLabel).toBeTruthy();
      // The two controls must never share a label — screen-reader users rely
      // on the distinction to avoid accidentally confirming a donation.
      expect(confirmBtn.props.accessibilityLabel).not.toBe(
        cancelBtn.props.accessibilityLabel
      );
    });
  });

  it('announces donation status changes via an alert live region', async () => {
    const RecurringScreen = require('../app/recurring').default;
    const { getByLabelText, getByRole, getByTestId } = await render(
      wrap(<RecurringScreen />)
    );

    fireEvent.press(await waitFor(() => getByTestId('create-recurring-button')));

    await waitFor(() => {
      expect(getByLabelText('Confirm recurring donation')).toBeTruthy();
    });

    fireEvent.changeText(
      getByLabelText('Recurring donation amount in XLM'),
      '20'
    );
    fireEvent.press(getByLabelText('Confirm recurring donation'));

    await waitFor(() => {
      const alertRegion = getByRole('alert');
      expect(alertRegion).toBeTruthy();
      // Live region ensures the reader announces the status change without
      // the user navigating to it.
      expect(alertRegion.props.accessibilityLiveRegion).toBe('polite');
    });
  });
});

// ─── Offline banner accessibility ───────────────────────────────────────────

describe('ProjectsScreen — offline banner accessibility', () => {
  it('offline banner has accessibilityRole=alert and correct accessibilityLabel', async () => {
    const entry = JSON.stringify({ data: MOCK_PROJECTS, timestamp: Date.now() });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(entry);
    (axios.get as jest.Mock).mockRejectedValue(new Error('Network Error'));

    const ProjectsScreen = require('../app/projects/index').default;
    const { getByLabelText } = await render(wrap(<ProjectsScreen />));

    await waitFor(() => {
      const banner = getByLabelText('Offline — showing cached data');
      expect(banner).toBeTruthy();
      expect(banner.props.accessibilityRole).toBe('alert');
    });
  });
});

// ─── Generic sweep: every touchable on every screen is labelled (#1658) ─────

type HostNode = {
  type: string;
  props: Record<string, any>;
  children: Array<HostNode | string> | null;
};

/**
 * Walk the rendered host tree and collect every interactive element:
 * touchables (TouchableOpacity / Pressable / TouchableHighlight all render a
 * host View with an `onClick` handler), text inputs and switches.
 */
function collectInteractive(node: unknown, out: HostNode[] = []): HostNode[] {
  if (!node || typeof node === 'string') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => collectInteractive(child, out));
    return out;
  }
  const host = node as HostNode;
  const props = host.props || {};
  // Only host (native) nodes count: composite components can carry an
  // `onClick` prop through from a caller without rendering a control.
  if (
    typeof host.type === 'string' &&
    (typeof props.onClick === 'function' ||
      host.type === 'TextInput' ||
      host.type === 'RCTSwitch' ||
      host.type === 'AndroidSwitch')
  ) {
    out.push(host);
  }
  collectInteractive(host.children, out);
  return out;
}

function textOf(node: HostNode | string | null | undefined): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  return (node.children || []).map(textOf).join('');
}

/** Human-readable list of interactive elements missing a label or role. */
function unlabelledInteractive(tree: unknown): string[] {
  return collectInteractive(tree).flatMap((node) => {
    const p = node.props;
    const label = p.accessibilityLabel ?? p['aria-label'];
    const role = p.accessibilityRole ?? p.role;
    const what = `${node.type}${p.testID ? `#${p.testID}` : ''} "${textOf(node).trim().slice(0, 40)}"`;
    const problems: string[] = [];
    if (typeof label !== 'string' || !label.trim()) problems.push(`${what}: missing accessibilityLabel`);
    // Inputs are announced as text fields by default; touchables must say
    // what they are (button / link / tab / …).
    if (node.type !== 'TextInput' && !role) problems.push(`${what}: missing accessibilityRole`);
    return problems;
  });
}

async function expectAllInteractiveLabelled(
  element: React.ReactElement,
  { minInteractive = 1, before }: { minInteractive?: number; before?: (r: any) => Promise<void> | void } = {},
) {
  const utils = await render(element);
  await waitFor(() => {
    expect(collectInteractive(utils.root).length).toBeGreaterThanOrEqual(minInteractive);
  });
  if (before) await before(utils);
  expect(unlabelledInteractive(utils.root)).toEqual([]);
  return utils;
}

function mockApi() {
  (axios.get as jest.Mock).mockImplementation((url: string) => {
    if (/\/api\/projects\/[^/]+$/.test(url)) return Promise.resolve({ data: { data: MOCK_PROJECT } });
    if (url.includes('/api/projects')) return Promise.resolve({ data: { data: MOCK_PROJECTS } });
    if (url.includes('/api/leaderboard')) {
      return Promise.resolve({
        data: {
          data: [{
            rank: 1,
            publicKey: 'GDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            displayName: 'Ada',
            totalDonatedXLM: '120',
            projectsSupported: 2,
            topBadge: 'seedling',
          }],
          has_more: false,
          next_cursor: null,
        },
      });
    }
    if (url.includes('/api/profiles/')) {
      return Promise.resolve({ data: { data: { publicKey: 'GDONOR', totalDonatedXLM: '120', projectsSupported: 2, badges: [] } } });
    }
    if (url.includes('/api/donations/donor/')) return Promise.resolve({ data: { data: [] } });
    return Promise.resolve({ data: { data: [] } });
  });
}

describe('Every screen — every touchable exposes a label and role (#1658)', () => {
  jest.setTimeout(30000);

  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    mockApi();
    mockCameraPermission = { granted: true };
    mockWallet = { publicKey: null, loading: false, error: null };
  });

  const screens: Array<[string, () => React.ComponentType]> = [
    ['Home (app/index)', () => require('../app/index').default],
    ['Projects (app/projects/index)', () => require('../app/projects/index').default],
    ['Project detail (app/projects/[id])', () => require('../app/projects/[id]').default],
    ['Donate (app/donate/[id])', () => require('../app/donate/[id]').default],
    ['Recurring (app/recurring)', () => require('../app/recurring').default],
    ['Impact (app/impact)', () => require('../app/impact').default],
    ['Leaderboard (app/leaderboard)', () => require('../app/leaderboard').default],
    ['Settings (app/settings)', () => require('../app/settings').default],
    ['Profile (app/profile/[address])', () => require('../app/profile/[address]').default],
  ];

  it.each(screens)('%s', async (_name, load) => {
    const Screen = load();
    await expectAllInteractiveLabelled(wrap(<Screen />));
  });

  it('Scan — permission denied (grant / open settings)', async () => {
    mockCameraPermission = { granted: false, canAskAgain: true };
    const ScanScreen = require('../app/scan').default;
    await expectAllInteractiveLabelled(wrap(<ScanScreen />));
  });

  it('Scan — invalid QR error is a labelled, dismissible button', async () => {
    const ScanScreen = require('../app/scan').default;
    const utils = await render(wrap(<ScanScreen />));
    const { getByTestId } = utils;
    const camera = await waitFor(() => getByTestId('camera-view'));
    const { act } = require('@testing-library/react-native');
    await act(async () => {
      camera.props.onBarcodeScanned({ data: 'https://example.com' });
    });
    await waitFor(() => expect(collectInteractive(utils.root).length).toBeGreaterThan(0));
    expect(unlabelledInteractive(utils.root)).toEqual([]);
  });

  it('AppHeader — disconnected, with the connect sheet open', async () => {
    const { AppHeader } = require('../src/components/AppHeader');
    await expectAllInteractiveLabelled(<AppHeader />, {
      before: async ({ getByLabelText }) => {
        fireEvent.press(getByLabelText('Connect Stellar wallet'));
        await waitFor(() => expect(getByLabelText('Stellar public key')).toBeTruthy());
      },
    });
  });

  it('WalletConnect — connected badge exposes a disconnect action', async () => {
    mockWallet = { publicKey: 'GDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', loading: false, error: null };
    const { WalletConnect } = require('../src/components/WalletConnect');
    const { getByRole } = await expectAllInteractiveLabelled(<WalletConnect />);
    const badge = getByRole('button');
    expect(badge.props.accessibilityActions).toEqual([{ name: 'longpress', label: 'Disconnect wallet' }]);
  });

  it('the sweep itself flags an unlabelled touchable', async () => {
    const { TouchableOpacity, Text } = require('react-native');
    const utils = await render(
      <TouchableOpacity onPress={() => undefined}>
        <Text>↗</Text>
      </TouchableOpacity>,
    );
    console.log('DEBUG KEYS', Object.keys(utils));

    expect(unlabelledInteractive(utils.root)).toEqual([
      'View "↗": missing accessibilityLabel',
      'View "↗": missing accessibilityRole',
    ]);
  });
});

// ─── Selection / disabled state is exposed, not just drawn ──────────────────

describe('State is announced for selectable and disabled controls (#1658)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    mockApi();
  });

  it('recurring tabs use role=tab with selected state', async () => {
    const RecurringScreen = require('../app/recurring').default;
    const { getByLabelText } = await render(wrap(<RecurringScreen />));
    const active = await waitFor(() => getByLabelText('Active recurring donations'));
    const history = getByLabelText('Payment history');
    expect(active.props.accessibilityRole).toBe('tab');
    expect(active.props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(history);
    await waitFor(() => expect(getByLabelText('Payment history').props.accessibilityState).toEqual({ selected: true }));
    expect(getByLabelText('Active recurring donations').props.accessibilityState).toEqual({ selected: false });
  });

  it('donate preset amounts expose selected state', async () => {
    const DonateScreen = require('../app/donate/[id]').default;
    const { getByLabelText } = await render(wrap(<DonateScreen />));
    const preset = await waitFor(() => getByLabelText('Donate 10 XLM'));
    fireEvent.press(preset);
    await waitFor(() => expect(getByLabelText('Donate 10 XLM').props.accessibilityState).toMatchObject({ selected: true }));
  });

  it('screen titles are exposed as headers', async () => {
    const SettingsScreen = require('../app/settings').default;
    const { getAllByRole } = await render(wrap(<SettingsScreen />));
    await waitFor(() => expect(getAllByRole('header').length).toBeGreaterThan(0));
  });
});
