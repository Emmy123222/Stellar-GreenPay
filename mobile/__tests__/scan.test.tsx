import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';

const mockPush = jest.fn();
let capturedBarcodeHandler: ((e: { data: string }) => void) | null = null;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('expo-camera', () => {
  const React = require('react');
  return {
    CameraView: (props: { onBarcodeScanned?: (e: { data: string }) => void }) => {
      capturedBarcodeHandler = props.onBarcodeScanned ?? null;
      return <React.Fragment />;
    },
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
  };
});

jest.mock('@stellar/stellar-sdk', () => ({
  StrKey: {
    isValidEd25519PublicKey: (key: string) =>
      typeof key === 'string' && key.startsWith('G') && key.length === 56,
  },
}));

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

import ScanScreen, { INVALID_QR_MESSAGE, parseScan } from '../app/scan';

const VALID_KEY = `G${'A'.repeat(55)}`;
const OTHER_VALID_KEY = `G${'B'.repeat(55)}`;

beforeEach(() => {
  jest.clearAllMocks();
  capturedBarcodeHandler = null;
});

describe('parseScan', () => {
  it('accepts a raw Stellar address', () => {
    expect(parseScan(VALID_KEY)).toEqual({ wallet: VALID_KEY });
  });

  it('rejects a URL or random string', () => {
    expect(parseScan('https://example.com')).toBeNull();
    expect(parseScan('business card text')).toBeNull();
  });

  it('accepts a deep-link wallet via StrKey', () => {
    expect(
      parseScan(`greenpay://donate?wallet=${VALID_KEY}&project=abc`)
    ).toEqual({ wallet: VALID_KEY, projectId: 'abc' });
  });

  it('rejects a deep-link with an invalid wallet', () => {
    expect(parseScan('greenpay://donate?wallet=NOT_A_KEY&project=abc')).toBeNull();
  });
});

describe('ScanScreen', () => {
  it('navigates to donate on a valid scan', async () => {
    await act(async () => render(<ScanScreen />));
    await waitFor(() => expect(capturedBarcodeHandler).not.toBeNull());

    act(() => {
      capturedBarcodeHandler?.({ data: VALID_KEY });
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        `/donate/scan?wallet=${encodeURIComponent(VALID_KEY)}`
      )
    );
  });

  it('shows an error toast and resumes on dismissal', async () => {
    const { getByText, queryByText } = await act(async () =>
      render(<ScanScreen />)
    );
    await waitFor(() => expect(capturedBarcodeHandler).not.toBeNull());

    act(() => {
      capturedBarcodeHandler?.({ data: 'https://example.com' });
    });

    await waitFor(() => expect(getByText(INVALID_QR_MESSAGE)).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(getByText(INVALID_QR_MESSAGE));
    await waitFor(() => expect(queryByText(INVALID_QR_MESSAGE)).toBeNull());

    act(() => {
      capturedBarcodeHandler?.({ data: OTHER_VALID_KEY });
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        `/donate/scan?wallet=${encodeURIComponent(OTHER_VALID_KEY)}`
      )
    );
  });
});
