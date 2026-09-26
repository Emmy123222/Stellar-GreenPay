import React from 'react';
import { Text, Pressable, View } from 'react-native';
import { AppState } from 'react-native';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  useBiometricAuth,
  _resetBiometricReauthTimeoutForTests,
} from '../hooks/useBiometricAuth';

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

const LA = LocalAuthentication as unknown as {
  hasHardwareAsync: jest.Mock;
  isEnrolledAsync: jest.Mock;
  authenticateAsync: jest.Mock;
  supportedAuthenticationTypesAsync: jest.Mock;
};

type AppStateHandler = (state: string) => void;

let capturedHandler: AppStateHandler | null = null;
let removeMock: jest.Mock;

function Probe({ timeoutSeconds }: { timeoutSeconds?: number }) {
  const { authenticate: trigger } = useBiometricAuth(
    timeoutSeconds != null ? { timeoutSeconds } : undefined
  );
  return (
    <View>
      <Pressable
        testID="trigger"
        accessibilityRole="button"
        onPress={() => {
          void trigger('Send donation');
        }}
      >
        <Text>trigger</Text>
      </Pressable>
    </View>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetBiometricReauthTimeoutForTests();
  capturedHandler = null;
  removeMock = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((((
    _event: string,
    handler: AppStateHandler
  ) => {
    capturedHandler = handler;
    return { remove: removeMock };
  }) as unknown) as typeof AppState.addEventListener);
  LA.hasHardwareAsync.mockResolvedValue(true);
  LA.isEnrolledAsync.mockResolvedValue(true);
  LA.supportedAuthenticationTypesAsync.mockResolvedValue([
    LocalAuthentication.AuthenticationType.FINGERPRINT,
  ]);
  LA.authenticateAsync.mockResolvedValue({ success: true });
});

afterEach(() => {
  jest.restoreAllMocks();
  _resetBiometricReauthTimeoutForTests();
});

function fireAppState(prev: string, next: string) {
  act(() => {
    capturedHandler?.(prev);
  });
  act(() => {
    capturedHandler?.(next);
  });
}

describe('useBiometricAuth background re-auth', () => {
  it('does not prompt when returning within 30s', async () => {
    const t0 = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    await act(async () => render(<Probe />));
    await waitFor(() => expect(LA.hasHardwareAsync).toHaveBeenCalled());
    expect(LA.authenticateAsync).not.toHaveBeenCalled();

    (Date.now as jest.Mock).mockReturnValue(t0 + 10_000);
    fireAppState('background', 'active');

    await waitFor(() => expect(capturedHandler).not.toBeNull());
    expect(LA.authenticateAsync).not.toHaveBeenCalled();
  });

  it('prompts re-auth when returning after 30s', async () => {
    const t0 = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    await act(async () => render(<Probe />));
    await waitFor(() => expect(LA.hasHardwareAsync).toHaveBeenCalled());

    (Date.now as jest.Mock).mockReturnValue(t0 + 31_000);
    fireAppState('background', 'active');

    await waitFor(() => expect(LA.authenticateAsync).toHaveBeenCalledTimes(1));
  });

  it('respects a custom timeout threshold', async () => {
    const t0 = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    await act(async () => render(<Probe timeoutSeconds={60} />));
    await waitFor(() => expect(LA.hasHardwareAsync).toHaveBeenCalled());

    (Date.now as jest.Mock).mockReturnValue(t0 + 31_000);
    fireAppState('background', 'active');
    await waitFor(() => expect(capturedHandler).not.toBeNull());
    expect(LA.authenticateAsync).not.toHaveBeenCalled();

    (Date.now as jest.Mock).mockReturnValue(t0 + 61_000);
    fireAppState('background', 'active');
    await waitFor(() => expect(LA.authenticateAsync).toHaveBeenCalledTimes(1));
  });

  it('ignores modal-induced transitions while authenticating', async () => {
    let resolveAuth: (r: unknown) => void = () => {};
    LA.authenticateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve as (r: unknown) => void;
        })
    );
    const t0 = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 60_000);

    const { getByTestId } = await act(async () => render(<Probe />));
    await waitFor(() => expect(LA.hasHardwareAsync).toHaveBeenCalled());

    fireEvent.press(getByTestId('trigger'));
    await waitFor(() => expect(LA.authenticateAsync).toHaveBeenCalledTimes(1));

    fireAppState('inactive', 'active');
    expect(LA.authenticateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAuth({ success: true });
      await new Promise((r) => setImmediate(r));
    });
  });
});
