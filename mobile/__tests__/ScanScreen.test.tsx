/**
 * __tests__/ScanScreen.test.tsx
 *
 * Scan to Donate screen (app/scan.tsx): expo-camera with QR-only scanning,
 * 500ms scan throttling, duplicate suppression and manual-entry fallback.
 */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';

let mockPermission: any = { granted: true, canAskAgain: true, status: 'granted' };
let mockIsAvailable = true;
let mockCameraProps: any = null;
const mockRequestPermission = jest.fn(() => {
  mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
  return Promise.resolve(mockPermission);
});
const mockPush = jest.fn();

jest.mock('expo-camera', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  return {
    useCameraPermissions: jest.fn(() => [mockPermission, mockRequestPermission]),
    CameraView: Object.assign(
      function CameraView(props: any) {
        mockCameraProps = props;
        return ReactLib.createElement(View, { testID: 'camera-view' });
      },
      { isAvailableAsync: jest.fn(() => Promise.resolve(mockIsAvailable)) }
    ),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import ScanScreen from '../app/scan';

const WALLET = `G${'A'.repeat(55)}`;

let lastScanHandler: ((p: { data: string }) => void) | null = null;
function scan(data: string) {
  if (typeof mockCameraProps?.onBarcodeScanned === 'function') {
    lastScanHandler = mockCameraProps.onBarcodeScanned;
  }
  if (!lastScanHandler) throw new Error('camera not ready');
  lastScanHandler({ data });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
  mockIsAvailable = true;
  mockCameraProps = null;
  lastScanHandler = null;
  jest.spyOn(Date, 'now').mockReturnValue(20_000);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ScanScreen (expo-camera)', () => {
  it('scans QR codes only', async () => {
    await render(<ScanScreen />);
    expect(await screen.findByTestId('camera-view')).toBeTruthy();
    expect(mockCameraProps.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
  });

  it('keeps the existing wallet-scanning behaviour', async () => {
    await render(<ScanScreen />);
    await screen.findByTestId('camera-view');

    scan(WALLET);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('wallet='));
  });

  it('does not trigger duplicate actions for rapid successive scans', async () => {
    await render(<ScanScreen />);
    await screen.findByTestId('camera-view');

    scan(WALLET);
    scan(WALLET);
    scan(WALLET);

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('throttles scans to one per 500ms and ignores invalid codes', async () => {
    await render(<ScanScreen />);
    await screen.findByTestId('camera-view');

    scan('not-a-wallet');
    scan('not-a-wallet');

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText(/not a valid GreenPay wallet address/i)).toBeTruthy();

    // Still inside the 500ms window → no navigation even for a valid code.
    scan(WALLET);
    expect(mockPush).not.toHaveBeenCalled();

    // After the window, the gate opens again.
    (Date.now as jest.Mock).mockReturnValue(20_600);
    scan(WALLET);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('shows "Type address manually" when the camera permission is denied', async () => {
    mockPermission = { granted: false, canAskAgain: false, status: 'denied' };
    await render(<ScanScreen />);

    const link = await screen.findByTestId('manual-entry-link');
    expect(link).toBeTruthy();
    expect(screen.getByText('Type address manually')).toBeTruthy();
  });

  it('completes the flow from manual address entry without camera access', async () => {
    mockPermission = { granted: false, canAskAgain: false, status: 'denied' };
    await render(<ScanScreen />);

    fireEvent.press(await screen.findByTestId('manual-entry-link'));
    fireEvent.changeText(await screen.findByTestId('manual-address-input'), WALLET);
    fireEvent.press(screen.getByLabelText('Continue with typed address'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining(`wallet=${WALLET}`));
  });

  it('falls back to manual entry when the camera hardware is unavailable', async () => {
    mockIsAvailable = false;
    await render(<ScanScreen />);

    expect(await screen.findByTestId('manual-entry-link')).toBeTruthy();
  });

  it('falls back when the camera fails to mount', async () => {
    await render(<ScanScreen />);
    await screen.findByTestId('camera-view');

    mockCameraProps.onMountError({ nativeEvent: { message: 'camera died' } });

    expect(await screen.findByTestId('manual-entry-link')).toBeTruthy();
    expect(screen.getByText('Camera could not be started.')).toBeTruthy();
  });
});

