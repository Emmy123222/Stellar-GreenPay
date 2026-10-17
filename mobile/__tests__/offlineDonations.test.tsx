/**
 * __tests__/offlineDonations.test.tsx
 *
 * Offline donation outbox on the donate screen (issue #1655):
 *  - a donation attempted offline is queued and shown as pending
 *  - reconnecting prompts the donor to review; nothing is signed
 *  - review loads the intent into the form after explicit confirmation
 *  - discard removes it from storage
 *  - an intent from a previous session is restored on mount
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

jest.mock('../hooks/useBiometricAuth', () => {
  const state = {
    available: true,
    enrolled: true,
    isAuthenticating: false,
    label: 'Biometrics',
    authenticate: jest.fn(),
    refresh: jest.fn(),
  };
  return { __esModule: true, useBiometricAuth: () => state, authenticate: jest.fn() };
});

import { useBiometricAuth } from '../hooks/useBiometricAuth';

jest.mock('../app/theme', () => ({
  useTheme: () => ({
    mode: 'light',
    colors: {
      background: '#f0f7f0',
      surface: '#ffffff',
      primary: '#227239',
      accent: '#1a2e1a',
      header: '#227239',
      headerText: '#ffffff',
      buttonBackground: '#227239',
      buttonText: '#ffffff',
      cardBorder: '#e8f3e8',
      cardShadow: '#000000',
      primaryText: '#1a2e1a',
      secondaryText: '#5a7a5a',
      muted: '#8aaa8a',
      inputBackground: '#ffffff',
      inputBorder: '#e8f3e8',
      placeholder: '#8aaa8a',
      border: '#d8e4d8',
      statusBarStyle: 'dark',
    },
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'proj-1' }),
}));

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn().mockResolvedValue(false),
  openURL: jest.fn(),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('@stellar/stellar-sdk', () => {
  class FakeServer {
    loadAccount = jest.fn(() => Promise.resolve({}));
    submitTransaction = jest.fn(() => Promise.resolve({ hash: 'fake-hash' }));
  }
  const chainable = () => ({
    addOperation: jest.fn().mockImplementation(chainable),
    addMemo: jest.fn().mockImplementation(chainable),
    setTimeout: jest.fn().mockImplementation(chainable),
    build: jest.fn(() => ({ sign: jest.fn(), toXDR: jest.fn(() => 'xdr') })),
  });
  return {
    __esModule: true,
    Keypair: { fromSecret: (seed: string) => ({ publicKey: () => `G${String(seed).slice(1, 55)}` }) },
    Horizon: { Server: FakeServer },
    TransactionBuilder: jest.fn(() => chainable()),
    Networks: { TESTNET: 'Test SDF Network ; September 2015' },
    Operation: { payment: jest.fn(() => ({})) },
    Asset: { native: jest.fn(() => ({})) },
    Memo: { text: jest.fn(() => ({})) },
    StrKey: { isValidEd25519PublicKey: (key: string) => typeof key === 'string' && key.startsWith('G') },
  };
});

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

const NetInfo = require('@react-native-community/netinfo').default;

import DonateScreen from '../app/donate/[id]';
import {
  DONATION_OUTBOX_KEY,
  queueDonation,
  readDonationOutbox,
} from '../utils/donationOutbox';

const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'Amazon Reforestation',
  walletAddress: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
};

const bio = (useBiometricAuth as unknown as () => { authenticate: jest.Mock })();

function pressAlertButton(title: string, label: string): void {
  // The most recent alert with this title: a test may show the same dialog
  // twice (decline, then accept) and only the latest buttons are live.
  const calls = (Alert.alert as jest.Mock).mock.calls;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    if (calls[index][0] !== title) continue;
    const buttons = (calls[index][2] ?? []) as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const button = buttons.find((entry) => entry.text === label);
    if (!button) break;
    button.onPress?.();
    return;
  }
  throw new Error(`No "${label}" button on the latest alert "${title}"`);
}

/** `confirmAlert` adds an options bag, so match on the args that matter. */
function alertWasShown(title: string, contains: string): boolean {
  return (Alert.alert as jest.Mock).mock.calls.some(
    (args) => args[0] === title && String(args[1]).includes(contains),
  );
}

function connectivityListener(): (state: { isConnected: boolean }) => void {
  const call = (NetInfo.addEventListener as jest.Mock).mock.calls[0];
  if (!call) throw new Error('the donate screen never subscribed to NetInfo');
  return call[0];
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await AsyncStorage.clear();

  (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });
  NetInfo.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('donation queued while offline', () => {
  it('stores the intent and lists it as pending instead of failing', async () => {
    NetInfo.fetch.mockResolvedValue({ isConnected: false });

    await render(<DonateScreen />);
    await screen.findByText('Donate to Amazon Reforestation');

    fireEvent.press(screen.getByLabelText('Donate 10 XLM'));
    fireEvent.press(screen.getByLabelText('Confirm donation of 10 XLM'));

    await waitFor(() =>
      expect(screen.getByText(/Saved offline/i)).toBeTruthy()
    );
    expect(screen.getByTestId('offline-outbox')).toBeTruthy();
    expect(screen.getByText('10.0000000 XLM · Amazon Reforestation')).toBeTruthy();

    const queue = await readDonationOutbox();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ projectId: 'proj-1', amountXLM: '10.0000000' });

    // Nothing was signed or submitted while offline.
    expect(bio.authenticate).not.toHaveBeenCalled();
    expect(axios.post as jest.Mock).not.toHaveBeenCalled();
  });

  it('restores a queued donation written in an earlier session', async () => {
    await queueDonation({
      projectId: MOCK_PROJECT.id,
      projectName: MOCK_PROJECT.name,
      destination: MOCK_PROJECT.walletAddress,
      amountXLM: '5.0000000',
      memo: 'From last week',
    });

    await render(<DonateScreen />);

    expect(await screen.findByTestId('offline-outbox')).toBeTruthy();
    expect(screen.getByText('5.0000000 XLM · Amazon Reforestation')).toBeTruthy();
    expect(screen.getByText('"From last week"')).toBeTruthy();
  });
});

describe('reconnecting', () => {
  it('prompts for review and does not sign anything on its own', async () => {
    await queueDonation({
      projectId: MOCK_PROJECT.id,
      projectName: MOCK_PROJECT.name,
      destination: MOCK_PROJECT.walletAddress,
      amountXLM: '7.0000000',
    });

    await render(<DonateScreen />);
    await screen.findByText('Donate to Amazon Reforestation');

    const listener = connectivityListener();
    (Alert.alert as jest.Mock).mockClear();

    // Offline first, then back online — only the transition prompts.
    listener({ isConnected: false });
    expect(Alert.alert).not.toHaveBeenCalled();

    NetInfo.fetch.mockResolvedValueOnce({ isConnected: true });
    listener({ isConnected: true });

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Back online',
        expect.stringContaining('never sent automatically'),
        expect.any(Array),
      )
    );
    expect(bio.authenticate).not.toHaveBeenCalled();
    expect(axios.post as jest.Mock).not.toHaveBeenCalled();
  });

  it('loading the queued intent requires an explicit confirmation', async () => {
    await queueDonation({
      projectId: MOCK_PROJECT.id,
      projectName: MOCK_PROJECT.name,
      destination: MOCK_PROJECT.walletAddress,
      amountXLM: '7.0000000',
      memo: 'Plant more',
    });

    await render(<DonateScreen />);
    await screen.findByText('Donate to Amazon Reforestation');

    fireEvent.press(screen.getByLabelText(/Review queued donation of 7\.0000000 XLM/));

    await waitFor(() =>
      expect(
        alertWasShown(
          'Review queued donation',
          'nothing is signed until you press Donate'
        )
      ).toBe(true)
    );

    // Declining leaves the intent queued and the form untouched.
    pressAlertButton('Review queued donation', 'Keep queued');
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Review queued donation of 7\.0000000 XLM/)
      ).toBeTruthy()
    );
    expect(screen.getByLabelText('Custom donation amount in XLM').props.value).toBe('1');

    fireEvent.press(screen.getByLabelText(/Review queued donation of 7\.0000000 XLM/));
    // The second dialog only appears after the review path has re-checked
    // connectivity, so wait for it before answering it.
    await waitFor(() =>
      expect((Alert.alert as jest.Mock).mock.calls.length).toBe(2)
    );
    pressAlertButton('Review queued donation', 'Load into form');

    await waitFor(() =>
      expect(screen.getByText(/Queued donation loaded/i)).toBeTruthy()
    );
    expect(screen.getByLabelText('Custom donation amount in XLM').props.value).toBe('7');
    expect(screen.getByLabelText('Optional donation message').props.value).toBe('Plant more');
    expect(bio.authenticate).not.toHaveBeenCalled();
    expect(axios.post as jest.Mock).not.toHaveBeenCalled();

    // The queued item stays visible until the donation actually goes out.
    expect(screen.getByTestId('offline-outbox')).toBeTruthy();
  });

  it('discarding a queued donation clears it from storage', async () => {
    const queued = await queueDonation({
      projectId: MOCK_PROJECT.id,
      projectName: MOCK_PROJECT.name,
      destination: MOCK_PROJECT.walletAddress,
      amountXLM: '9.0000000',
    });

    await render(<DonateScreen />);
    await screen.findByTestId('offline-outbox');

    fireEvent.press(screen.getByLabelText(/Discard queued donation to Amazon Reforestation/));

    await waitFor(() =>
      expect(
        alertWasShown('Discard queued donation', 'It will not be sent')
      ).toBe(true)
    );
    pressAlertButton('Discard queued donation', 'Discard');

    await waitFor(() => expect(screen.queryByTestId('offline-outbox')).toBeNull());
    expect(await readDonationOutbox()).toEqual([]);
    expect(queued?.id).toBeTruthy();
    expect((AsyncStorage as any).__store[DONATION_OUTBOX_KEY]).toBeUndefined();
  });
});
