/**
 * __tests__/useWallet.test.ts
 * Tests for the useWallet hook (Freighter wallet connect functionality).
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { useWallet } from '../src/hooks/useWallet';

const VALID_PUBLIC_KEY = 'GABCXYZ1234567890123456789012345678901234567890123456789012345';
const INVALID_PUBLIC_KEY = 'INVALID';
const SHORT_PUBLIC_KEY = 'GABCXYZ';

describe('useWallet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with loading state and no public key', () => {
    const { result } = renderHook(() => useWallet());
    
    expect(result.current.loading).toBe(true);
    expect(result.current.publicKey).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('loads stored public key on mount', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(VALID_PUBLIC_KEY);
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('greenpay_stellar_public_key');
    expect(result.current.publicKey).toBe(VALID_PUBLIC_KEY);
  });

  it('handles no stored public key on mount', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    expect(result.current.publicKey).toBe(null);
  });

  it('connects with a valid Stellar public key', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValueOnce(undefined);
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    let connectResult;
    await act(async () => {
      connectResult = await result.current.connect(VALID_PUBLIC_KEY);
    });
    
    expect(connectResult).toBe(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('greenpay_stellar_public_key', VALID_PUBLIC_KEY);
    expect(result.current.publicKey).toBe(VALID_PUBLIC_KEY);
    expect(result.current.error).toBe(null);
  });

  it('trims whitespace from address before validation', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValueOnce(undefined);
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    const addressWithSpaces = `  ${VALID_PUBLIC_KEY}  `;
    
    await act(async () => {
      await result.current.connect(addressWithSpaces);
    });
    
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('greenpay_stellar_public_key', VALID_PUBLIC_KEY);
    expect(result.current.publicKey).toBe(VALID_PUBLIC_KEY);
  });

  it('rejects invalid Stellar public key', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    let connectResult;
    await act(async () => {
      connectResult = await result.current.connect(INVALID_PUBLIC_KEY);
    });
    
    expect(connectResult).toBe(false);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(result.current.publicKey).toBe(null);
    expect(result.current.error).toBe('Invalid Stellar address. Must start with G and be 56 characters.');
  });

  it('rejects public key that is too short', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    let connectResult;
    await act(async () => {
      connectResult = await result.current.connect(SHORT_PUBLIC_KEY);
    });
    
    expect(connectResult).toBe(false);
    expect(result.current.error).toBe('Invalid Stellar address. Must start with G and be 56 characters.');
  });

  it('rejects public key that does not start with G', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    const invalidPrefixKey = 'A' + VALID_PUBLIC_KEY.slice(1);
    
    let connectResult;
    await act(async () => {
      connectResult = await result.current.connect(invalidPrefixKey);
    });
    
    expect(connectResult).toBe(false);
    expect(result.current.error).toBe('Invalid Stellar address. Must start with G and be 56 characters.');
  });

  it('clears previous error when attempting new connection', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    // First failed connection
    await act(async () => {
      await result.current.connect(INVALID_PUBLIC_KEY);
    });
    
    expect(result.current.error).not.toBe(null);
    
    // Second successful connection
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValueOnce(undefined);
    
    await act(async () => {
      await result.current.connect(VALID_PUBLIC_KEY);
    });
    
    expect(result.current.error).toBe(null);
  });

  it('disconnects and clears public key', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(VALID_PUBLIC_KEY);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValueOnce(undefined);
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    expect(result.current.publicKey).toBe(VALID_PUBLIC_KEY);
    
    await act(async () => {
      await result.current.disconnect();
    });
    
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('greenpay_stellar_public_key');
    expect(result.current.publicKey).toBe(null);
  });

  it('handles SecureStore errors gracefully on load', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Storage error'));
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    expect(result.current.publicKey).toBe(null);
  });

  it('handles SecureStore errors gracefully on connect', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Storage error'));
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    await act(async () => {
      await result.current.connect(VALID_PUBLIC_KEY);
    });
    
    expect(result.current.publicKey).toBe(null);
  });

  it('handles SecureStore errors gracefully on disconnect', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(VALID_PUBLIC_KEY);
    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Storage error'));
    
    const { result } = renderHook(() => useWallet());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    await act(async () => {
      await result.current.disconnect();
    });
    
    // Public key should still be cleared even if storage fails
    expect(result.current.publicKey).toBe(null);
  });
});
