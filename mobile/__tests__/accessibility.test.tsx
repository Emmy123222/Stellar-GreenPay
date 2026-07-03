/**
 * __tests__/accessibility.test.tsx
 * Accessibility audit for all interactive components (#485).
 *
 * Verifies that every TouchableOpacity / Pressable / Button has:
 *   - accessibilityLabel (non-empty)
 *   - accessibilityRole
 *
 * Uses @testing-library/jest-native matchers via getAllByRole.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../app/theme';

// ─── Global mocks ──────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'proj-1' }),
  useFocusEffect: (cb: () => void) => { cb(); },
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('file:///tmp/cert.png'),
}));

jest.mock('../utils/notifications', () => ({
  getPushToken: jest.fn().mockResolvedValue(null),
  followProject: jest.fn(),
  unfollowProject: jest.fn(),
}));

jest.mock('../hooks/useBiometricAuth', () => ({
  authenticate: jest.fn().mockResolvedValue(true),
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
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
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

describe('HomeScreen — accessibility', () => {
  beforeEach(() => jest.clearAllMocks());

  it('project cards have accessibilityLabel and role=button', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });
    const HomeScreen = require('../app/index').default;
    const { getAllByRole } = render(wrap(<HomeScreen />));

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
    const { getAllByRole } = render(wrap(<ProjectsScreen />));

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
    const { getByLabelText } = render(wrap(<ProjectsScreen />));

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
    const { getByLabelText } = render(wrap(<ProjectDetailScreen />));

    await waitFor(() => {
      const shareBtn = getByLabelText(`Share ${MOCK_PROJECT.name}`);
      expect(shareBtn).toBeTruthy();
      expect(shareBtn.props.accessibilityRole).toBe('button');
    });
  });

  it('donate button has accessibilityLabel and role=button', async () => {
    const ProjectDetailScreen = require('../app/projects/[id]').default;
    const { getByLabelText } = render(wrap(<ProjectDetailScreen />));

    await waitFor(() => {
      const donateBtn = getByLabelText(`Donate to ${MOCK_PROJECT.name}`);
      expect(donateBtn).toBeTruthy();
      expect(donateBtn.props.accessibilityRole).toBe('button');
    });
  });

  it('all buttons have non-empty accessibilityLabel', async () => {
    const ProjectDetailScreen = require('../app/projects/[id]').default;
    const { getAllByRole } = render(wrap(<ProjectDetailScreen />));

    await waitFor(() => {
      const buttons = getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((btn) => {
        expect(btn.props.accessibilityLabel).toBeTruthy();
      });
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
    const { getByLabelText } = render(wrap(<ProjectsScreen />));

    await waitFor(() => {
      const banner = getByLabelText('Offline — showing cached data');
      expect(banner).toBeTruthy();
      expect(banner.props.accessibilityRole).toBe('alert');
    });
  });
});
