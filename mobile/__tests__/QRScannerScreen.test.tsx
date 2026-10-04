/**
 * __tests__/QRScannerScreen.test.tsx
 *
 * QRScannerScreen is now backed by expo-camera (expo-barcode-scanner removed).
 * Covers: QR-only settings, scan throttling / duplicate suppression, permission
 * and camera-failure fallback, and manual address entry.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, screen } from '@testing-library/react-native';

let mockPermission: any = { granted: true, canAskAgain: true, status: 'granted' };
let mockIsAvailable = true;
let mockCameraProps: any = null;
const mockRequestPermission = jest.fn(() => {
  mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
  return Promise.resolve(mockPermission);
});
const mockNavigation = { replace: jest.fn(), goBack: jest.fn() };

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

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

import { QRScannerScreen } from '../src/screens/QRScannerScreen';

const QR_URL = 'https://greenpay.app/donate?projectId=proj-42';

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
  jest.restoreAllMocks();
  mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
  mockIsAvailable = true;
  mockCameraProps = null;
  lastScanHandler = null;
  jest.spyOn(Date, 'now').mockReturnValue(10_000);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('QRScannerScreen (expo-camera)', () => {
  it('scans QR codes only', async () => {
    await render(<QRScannerScreen />);
    expect(await screen.findByTestId('camera-view')).toBeTruthy();
    expect(mockCameraProps.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
    expect(mockCameraProps.facing).toBe('back');
    expect(mockCameraProps.onBarcodeScanned).toEqual(expect.any(Function));
  });

  it('navigates to the Donation screen for a valid GreenPay QR code', async () => {
    await render(<QRScannerScreen />);
    await screen.findByTestId('camera-view');

    scan(QR_URL);

    expect(mockNavigation.replace).toHaveBeenCalledTimes(1);
    expect(mockNavigation.replace).toHaveBeenCalledWith('Donation', { projectId: 'proj-42' });
  });

  it('does not trigger duplicate actions for rapid successive scans', async () => {
    await render(<QRScannerScreen />);
    await screen.findByTestId('camera-view');

    // Same code still in front of the camera → frames keep arriving.
    scan(QR_URL);
    scan(QR_URL);
    scan(QR_URL);

    expect(mockNavigation.replace).toHaveBeenCalledTimes(1);
  });

  it('throttles scans to at most one per 500ms window', async () => {
    await render(<QRScannerScreen />);
    await screen.findByTestId('camera-view');

    scan(QR_URL);
    expect(mockNavigation.replace).toHaveBeenCalledTimes(1);

    // 300ms later the code changes — still inside the throttle window and
    // latched by the in-flight navigation, so nothing new fires.
    (Date.now as jest.Mock).mockReturnValue(10_300);
    scan('https://greenpay.app/donate?projectId=proj-99');
    expect(mockNavigation.replace).toHaveBeenCalledTimes(1);
  });

  it('shows an alert for unrecognized codes and keeps scanning disabled until rescan', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    await render(<QRScannerScreen />);
    await screen.findByTestId('camera-view');

    scan('https://example.com/not-greenpay');
    scan('https://example.com/not-greenpay');

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Unrecognized QR code');
    expect(mockNavigation.replace).not.toHaveBeenCalled();

    // User picks "Scan again" → gate re-opens after the 500ms interval.
    const scanAgain = alertSpy.mock.calls[0][2]?.find((a: any) => a.text === 'Scan again');
    scanAgain?.onPress?.();
    (Date.now as jest.Mock).mockReturnValue(11_000);
    scan(QR_URL);
    expect(mockNavigation.replace).toHaveBeenCalledTimes(1);
  });

  it('offers "Type address manually" when the camera permission is denied', async () => {
    mockPermission = { granted: false, canAskAgain: false, status: 'denied' };
    await render(<QRScannerScreen />);

    const link = await screen.findByTestId('manual-entry-link');
    expect(link).toBeTruthy();

    fireEvent.press(link);
    expect(await screen.findByTestId('manual-address-input')).toBeTruthy();
    expect(screen.getByText('Type address manually')).toBeTruthy();
  });

  it('completes the flow from manual entry without camera access', async () => {
    mockPermission = { granted: false, canAskAgain: false, status: 'denied' };
    await render(<QRScannerScreen />);

    fireEvent.press(await screen.findByTestId('manual-entry-link'));
    fireEvent.changeText(await screen.findByTestId('manual-address-input'), QR_URL);
    fireEvent.press(screen.getByLabelText('Continue'));

    expect(mockNavigation.replace).toHaveBeenCalledWith('Donation', { projectId: 'proj-42' });
  });

  it('falls back to manual entry when the camera hardware is unavailable', async () => {
    mockIsAvailable = false;
    await render(<QRScannerScreen />);

    expect(await screen.findByTestId('manual-entry-link')).toBeTruthy();
    expect(screen.getByText('Camera could not be started.')).toBeTruthy();
  });

  it('falls back when the camera fails to mount', async () => {
    await render(<QRScannerScreen />);
    await screen.findByTestId('camera-view');

    mockCameraProps.onMountError({ nativeEvent: { message: 'camera died' } });

    expect(await screen.findByTestId('manual-entry-link')).toBeTruthy();
    expect(screen.getByText('Camera could not be started.')).toBeTruthy();
  });
});
