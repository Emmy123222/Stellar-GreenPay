/**
 * hooks/useBiometricAuth.ts
 *
 * Biometric (Face ID / fingerprint) authentication for the React Native app.
 *
 * Exports two API shapes:
 *  - `authenticate(prompt)` — standalone async helper. Returns `true` when
 *    the user passes biometric or device-PIN authentication, `false`
 *    otherwise. Use this from imperative handlers (e.g. a "Send donation"
 *    button) where you only need a yes/no answer.
 *  - `useBiometricAuth()` — proper React hook that eagerly probes the
 *    device for biometric availability / enrollment on mount and exposes
 *    `available`, `enrolled`, `isAuthenticating`, and a memoised
 *    `authenticate(prompt)` action. Components that need to render
 *    different UI depending on hardware support should prefer the hook.
 *
 * Behavior:
 *  - If the device has biometric hardware AND the user has enrolled at
 *    least one biometric, we prompt with `promptMessage` and offer a
 *    "Use PIN" fallback label (iOS shows this automatically, Android
 *    falls through to device credential entry when `disableDeviceFallback`
 *    is `false`).
 *  - If biometrics are unavailable or unenrolled, we immediately prompt
 *    the device for the PIN / passcode with an explicit prompt message.
 *  - `authenticate()` resolves to `false` whenever the user cancels,
 *    dismisses, or fails the prompt — callers should treat `false` as a
 *    hard block and not submit any Stellar / Soroban transaction in that
 *    case.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricAuthOutcome = 'success' | 'cancel' | 'fallback' | 'error';

export interface BiometricAuthResult {
  /** `true` only when the user successfully authenticated. */
  success: boolean;
  /**
   * Why authentication ended the way it did. Useful for surfacing a
   * more specific message in the UI (e.g. "Authentication cancelled"
   * vs. "Authentication failed — please try again").
   */
  outcome: BiometricAuthOutcome;
  /** Underlying error message returned by expo-local-authentication, if any. */
  error?: string;
}

export interface BiometricCapabilities {
  /** `true` when the device exposes biometric hardware (Touch ID / Face ID sensor etc.). */
  available: boolean;
  /** `true` when the user has at least one biometric enrolled. */
  enrolled: boolean;
  /**
   * Human-readable label for the strongest supported biometric on this
   * device, e.g. "Face ID" or "Fingerprint". Falls back to "Biometrics".
   */
  label: string;
}

export interface UseBiometricAuthReturn extends BiometricCapabilities {
  isAuthenticating: boolean;
  lastResult: BiometricAuthResult | null;
  /**
   * Trigger an authentication prompt. Resolves to a
   * {@link BiometricAuthResult} — check `.success` before performing
   * sensitive operations like signing a Stellar / Soroban transaction.
   */
  authenticate: (prompt?: string) => Promise<BiometricAuthResult>;
  refresh: () => Promise<void>;
}

const DEFAULT_PROMPT = 'Confirm your identity to proceed';
const PIN_PROMPT = 'Enter your device PIN to proceed';

/**
 * Resolve the strongest biometric label available on the device so the
 * UI can render "Use Face ID" / "Use fingerprint" prompts accurately.
 */
async function resolveBiometricLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return 'Face ID';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return 'Fingerprint';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      return 'Iris';
    }
  } catch {
    // fall through to generic label
  }
  return 'Biometrics';
}

/**
 * Standalone imperative helper. Preserved for callers that don't want to
 * hold React state (e.g. inside async event handlers). Most components
 * should prefer {@link useBiometricAuth}.
 */
export async function authenticate(
  promptMessage: string = DEFAULT_PROMPT
): Promise<boolean> {
  const result = await runAuthentication(promptMessage);
  return result.success;
}

/**
 * Core authentication routine — shared by both the hook and the
 * standalone helper so behavior stays consistent.
 */
async function runAuthentication(
  promptMessage: string
): Promise<BiometricAuthResult> {
  let hasHardware = false;
  let enrolled = false;
  try {
    [hasHardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
  } catch (error: any) {
    return {
      success: false,
      outcome: 'error',
      error: error?.message ?? 'Unable to query biometric capabilities',
    };
  }

  const label = await resolveBiometricLabel();

  if (!hasHardware || !enrolled) {
    // No biometrics available — drop directly to device PIN/passcode.
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: PIN_PROMPT,
      fallbackLabel: '',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return mapResult(result);
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    fallbackLabel: `Use ${label === 'Face ID' ? 'Passcode' : 'PIN'}`,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return mapResult(result);
}

/**
 * Translate the SDK result object into our richer outcome enum.
 * `result.success === true` ⇒ `'success'`; otherwise we distinguish
 * cancel from error so downstream UI can show the right message.
 */
function mapResult(
  result: LocalAuthentication.LocalAuthenticationResult
): BiometricAuthResult {
  if (result.success) {
    return { success: true, outcome: 'success' };
  }
  const code = result.error;
  if (code === 'user_cancel' || code === 'system_cancel' || code === 'app_cancel') {
    return { success: false, outcome: 'cancel', error: code };
  }
  if (code === 'user_fallback') {
    return { success: false, outcome: 'fallback', error: code };
  }
  return { success: false, outcome: 'error', error: code };
}

/**
 * React hook that probes device biometric capabilities on mount and
 * exposes a memoised `authenticate` action that mirrors the standalone
 * helper.
 */
export function useBiometricAuth(): UseBiometricAuthReturn {
  const [available, setAvailable] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [label, setLabel] = useState('Biometrics');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [lastResult, setLastResult] = useState<BiometricAuthResult | null>(null);

  // Internal mount guard prevents setState-after-unmount warnings when the
  // consumer navigates away while the OS biometric prompt is open.
  const mountedRef = useRef(true);

  const safeSetAvailable = (next: boolean) => {
    if (mountedRef.current) setAvailable(next);
  };
  const safeSetEnrolled = (next: boolean) => {
    if (mountedRef.current) setEnrolled(next);
  };
  const safeSetLabel = (next: string) => {
    if (mountedRef.current) setLabel(next);
  };
  const safeSetIsAuthenticating = (next: boolean) => {
    if (mountedRef.current) setIsAuthenticating(next);
  };
  const safeSetLastResult = (next: BiometricAuthResult | null) => {
    if (mountedRef.current) setLastResult(next);
  };

  const refresh = useCallback(async () => {
    try {
      const [hasHardware, isEnrolled, resolvedLabel] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        resolveBiometricLabel(),
      ]);
      safeSetAvailable(hasHardware);
      safeSetEnrolled(isEnrolled);
      safeSetLabel(resolvedLabel);
    } catch {
      safeSetAvailable(false);
      safeSetEnrolled(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const authenticateFn = useCallback(
    async (prompt: string = DEFAULT_PROMPT): Promise<BiometricAuthResult> => {
      safeSetIsAuthenticating(true);
      try {
        // `runAuthentication` re-probes hardware capabilities on each
        // call. We accept that extra round-trip here so the same code
        // path is used for both the hook and the standalone helper —
        // keeps the security logic in one place and avoids drift.
        const result = await runAuthentication(prompt);
        safeSetLastResult(result);
        return result;
      } finally {
        safeSetIsAuthenticating(false);
      }
    },
    // No reactive deps — we deliberately use callback identity so
    // components can include `authenticate` in their own memo deps
    // without re-firing on every render.
    []
  );

  return {
    available,
    enrolled,
    label,
    isAuthenticating,
    lastResult,
    authenticate: authenticateFn,
    refresh,
  };
}
