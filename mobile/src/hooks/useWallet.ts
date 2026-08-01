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
      .catch(() => {
        // Non-critical — default to a disconnected wallet if storage fails.
      })
      .finally(() => setLoading(false));
  }, []);

  const connect = useCallback(async (address: string) => {
    setError(null);
    const trimmed = address.trim();

    if (!StrKey.isValidEd25519PublicKey(trimmed)) {
      setError('Invalid Stellar address. Must start with G and be 56 characters.');
      return false;
    }

    try {
      await SecureStore.setItemAsync(WALLET_KEY, trimmed);
    } catch {
      // Persistence failed — stay disconnected rather than half-connected.
      return false;
    }
    setPublicKey(trimmed);
    return true;
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync(WALLET_KEY);
    } catch {
      // Storage failure is non-fatal; still clear the in-memory key below so
      // the user is never left "connected" after choosing to disconnect.
    } finally {
      setPublicKey(null);
    }
  }, []);

  return { publicKey, loading, error, connect, disconnect };
}
