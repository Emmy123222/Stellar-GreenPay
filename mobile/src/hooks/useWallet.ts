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
      .finally(() => setLoading(false));
  }, []);

  const connect = useCallback(async (address: string) => {
    setError(null);
    const trimmed = address.trim();

    if (!StrKey.isValidEd25519PublicKey(trimmed)) {
      setError('Invalid Stellar address. Must start with G and be 56 characters.');
      return false;
    }

    await SecureStore.setItemAsync(WALLET_KEY, trimmed);
    setPublicKey(trimmed);
    return true;
  }, []);

  const disconnect = useCallback(async () => {
    await SecureStore.deleteItemAsync(WALLET_KEY);
    setPublicKey(null);
  }, []);

  return { publicKey, loading, error, connect, disconnect };
}
