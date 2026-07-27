import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { StrKey } from '@stellar/stellar-sdk';

const WALLET_KEY = 'greenpay_stellar_public_key';

export function useWallet() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(WALLET_KEY)
      .then((stored) => setPublicKey(stored))
      // `finally` alone does not consume the rejection — without `.catch`,
      // any storage error (e.g. Keychain unavailable on a stale device)
      // would surface as an `UnhandledPromiseRejection`, which Jest treats
      // as a test failure even when we set `loading=false` correctly. Swallow
      // the error here; production code still sees the next render cycle
      // with `loading=false` and can fall back to "Connect wallet" UI.
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const connect = useCallback(async (address: string) => {
    setError(null);
    const trimmed = address.trim();

    if (!StrKey.isValidEd25519PublicKey(trimmed)) {
      setError('Invalid Stellar address. Must start with G and be 56 characters.');
      return false;
    }

    // Storage write is best-effort — same posture as `disconnect`. If the
    // Keychain entry can't be written (stale device, OS-level migration,
    // or spoofed CI test rejection) we surface the failure to the caller
    // and refuse to flip `publicKey` so the UI stays on "Connect wallet".
    try {
      await SecureStore.setItemAsync(WALLET_KEY, trimmed);
    } catch {
      // intentionally unused — see comment block above; UI surfaces
      // the failure via `error` and the returned `false`.
      setError('Could not save wallet to secure storage. Please try again.');
      return false;
    }

    setPublicKey(trimmed);
    return true;
  }, []);

  const disconnect = useCallback(async () => {
    // Storage delete is best-effort — local state must still reset so the
    // "Connect wallet" UI becomes reachable even if the Keychain entry
    // couldn't be removed (stale device, OS-level migration, etc.).
    try {
      await SecureStore.deleteItemAsync(WALLET_KEY);
    } catch {
      // intentionally swallowed; see comment above
    }
    setPublicKey(null);
  }, []);

  return { publicKey, loading, error, connect, disconnect };
}
