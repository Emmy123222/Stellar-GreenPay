/**
 * __tests__/useBiometricAuth.test.ts
 *
 * Tests for `useBiometricAuth.ts` — covers both the standalone
 * `authenticate()` helper and the React hook `useBiometricAuth()`.
 *
 * The hook's purpose: require a biometric (Face ID / Touch ID /
 * fingerprint) confirmation before signing or submitting a Soroban /
 * Stellar transaction, with a graceful device-PIN fallback when the
 * device has no biometric hardware or the user hasn't enrolled.
 */
import React from 'react';
import { Text, Pressable, View } from 'react-native';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { authenticate, useBiometricAuth } from '../hooks/useBiometricAuth';

const LA = LocalAuthentication as unknown as {
  hasHardwareAsync: jest.Mock;
  isEnrolledAsync: jest.Mock;
  authenticateAsync: jest.Mock;
  supportedAuthenticationTypesAsync: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  LA.hasHardwareAsync.mockResolvedValue(true);
  LA.isEnrolledAsync.mockResolvedValue(true);
  LA.supportedAuthenticationTypesAsync.mockResolvedValue([
    LocalAuthentication.AuthenticationType.FINGERPRINT,
  ]);
  LA.authenticateAsync.mockResolvedValue({ success: true });
});

describe('authenticate (standalone helper)', () => {
  it('returns true when biometrics succeed', async () => {
    LA.authenticateAsync.mockResolvedValue({ success: true });
    expect(await authenticate()).toBe(true);
    expect(LA.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false })
    );
  });

  it('returns false when the user cancels the prompt', async () => {
    LA.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' });
    expect(await authenticate()).toBe(false);
  });

  it('routes to the PIN prompt when the device has no biometric hardware', async () => {
    LA.hasHardwareAsync.mockResolvedValue(false);
    LA.isEnrolledAsync.mockResolvedValue(false);
    LA.authenticateAsync.mockResolvedValue({ success: true });

    expect(await authenticate()).toBe(true);
    expect(LA.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: 'Enter your device PIN to proceed' })
    );
  });

  it('routes to the PIN prompt when biometrics are not enrolled', async () => {
    LA.hasHardwareAsync.mockResolvedValue(true);
    LA.isEnrolledAsync.mockResolvedValue(false);
    LA.authenticateAsync.mockResolvedValue({ success: true });

    expect(await authenticate()).toBe(true);
    expect(LA.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: 'Enter your device PIN to proceed' })
    );
  });

  it('uses the supplied prompt message verbatim', async () => {
    await authenticate('Confirm donation with biometrics or PIN');
    expect(LA.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: 'Confirm donation with biometrics or PIN' })
    );
  });

  it('reports false (rather than throwing) when capability probing itself fails', async () => {
    LA.hasHardwareAsync.mockRejectedValue(new Error('hardware probe failed'));
    expect(await authenticate()).toBe(false);
  });
});

describe('useBiometricAuth (React hook)', () => {
  function Probe() {
    const {
      available,
      enrolled,
      label,
      isAuthenticating,
      lastResult,
      authenticate: trigger,
    } = useBiometricAuth();

    // Render two siblings instead of nesting <Text><Text onPress=.../></Text>
    // so each can be queried independently by the test harness.
    const status = [
      `available=${available}`,
      `enrolled=${enrolled}`,
      `label=${label}`,
      `busy=${isAuthenticating}`,
      `last=${lastResult?.outcome ?? 'none'}`,
      `success=${lastResult?.success ?? 'n/a'}`,
    ].join('|');

    return (
      <View>
        <Text testID="status">{status}</Text>
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

  function triggerAuth(getByTestId: ReturnType<typeof render>['getByTestId']) {
    fireEvent.press(getByTestId('trigger'));
  }

  it('probes the device for biometric capabilities on mount', async () => {
    LA.supportedAuthenticationTypesAsync.mockResolvedValue([
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    ]);
    const { getByTestId } = render(<Probe />);

    await waitFor(() => {
      const status = getByTestId('status').props.children;
      expect(status).toMatch(/available=true/);
      expect(status).toMatch(/enrolled=true/);
      expect(status).toMatch(/label=Face ID/);
    });
  });

  it('reports absent hardware correctly when no sensor exists', async () => {
    LA.hasHardwareAsync.mockResolvedValue(false);
    LA.isEnrolledAsync.mockResolvedValue(false);
    const { getByTestId } = render(<Probe />);

    await waitFor(() => {
      const status = getByTestId('status').props.children;
      expect(status).toMatch(/available=false/);
      expect(status).toMatch(/enrolled=false/);
    });
  });

  it('resolves authenticate() and clears isAuthenticating afterwards', async () => {
    let resolveAuth: (r: any) => void = () => {};
    LA.authenticateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        })
    );

    const { getByTestId } = render(<Probe />);
    await waitFor(() => {
      expect(getByTestId('status').props.children).toMatch(/available=true/);
    });

    triggerAuth(getByTestId);

    await waitFor(() => {
      expect(getByTestId('status').props.children).toMatch(/busy=true/);
    });

    await act(async () => {
      resolveAuth({ success: true });
      // Yield so React applies the resolved state before we assert.
      await new Promise((r) => setImmediate(r));
    });

    await waitFor(() => {
      const status = getByTestId('status').props.children;
      expect(status).toMatch(/busy=false/);
      expect(status).toMatch(/last=success/);
      expect(status).toMatch(/success=true/);
    });
  });

  it('captures cancellation as outcome=cancel', async () => {
    LA.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' });

    const { getByTestId } = render(<Probe />);
    await waitFor(() => {
      expect(getByTestId('status').props.children).toMatch(/available=true/);
    });

    await act(async () => {
      triggerAuth(getByTestId);
      await new Promise((r) => setImmediate(r));
    });

    await waitFor(() => {
      const status = getByTestId('status').props.children;
      expect(status).toMatch(/last=cancel/);
      expect(status).toMatch(/success=false/);
    });
  });

  it('captures system cancel as outcome=cancel', async () => {
    LA.authenticateAsync.mockResolvedValue({ success: false, error: 'system_cancel' });

    const { getByTestId } = render(<Probe />);
    await waitFor(() => {
      expect(getByTestId('status').props.children).toMatch(/available=true/);
    });

    await act(async () => {
      triggerAuth(getByTestId);
      await new Promise((r) => setImmediate(r));
    });

    await waitFor(() =>
      expect(getByTestId('status').props.children).toMatch(/last=cancel/)
    );
  });

  it('captures fallback to PIN as outcome=fallback', async () => {
    LA.authenticateAsync.mockResolvedValue({ success: false, error: 'user_fallback' });

    const { getByTestId } = render(<Probe />);
    await waitFor(() => {
      expect(getByTestId('status').props.children).toMatch(/available=true/);
    });

    await act(async () => {
      triggerAuth(getByTestId);
      await new Promise((r) => setImmediate(r));
    });

    await waitFor(() =>
      expect(getByTestId('status').props.children).toMatch(/last=fallback/)
    );
  });

  it('captures any other failure as outcome=error', async () => {
    LA.authenticateAsync.mockResolvedValue({ success: false, error: 'lockout' });

    const { getByTestId } = render(<Probe />);
    await waitFor(() => {
      expect(getByTestId('status').props.children).toMatch(/available=true/);
    });

    await act(async () => {
      triggerAuth(getByTestId);
      await new Promise((r) => setImmediate(r));
    });

    await waitFor(() =>
      expect(getByTestId('status').props.children).toMatch(/last=error/)
    );
  });

  it('blocks Soroban submission when authentication fails — outcome=error surfaces', async () => {
    // Behavior verification: a failing auth must NOT be reported as
    // `success: true` under any circumstance; callers rely on this to
    // decide whether to sign/submit a transaction.
    LA.authenticateAsync.mockResolvedValue({ success: false, error: 'lockout' });

    // Confirm outcome mapping is correct by exercising the standalone
    // call path (same `runAuthentication` core as the hook uses)
    // rather than re-firing through React to avoid double-promise
    // bookkeeping in the test harness.
    const result = await authenticate('Send donation');
    expect(result).toBe(false);
  });
});
