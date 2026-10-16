/**
 * __mocks__/expo-camera.js
 *
 * Shared Jest mock for `expo-camera`, the package that now owns QR scanning
 * after `expo-barcode-scanner` was removed (#1652).
 *
 * The scanner suites (`__tests__/QRScannerScreen.test.tsx`,
 * `__tests__/ScanScreen.test.tsx`, `__tests__/scan.test.tsx`,
 * `__tests__/darkMode.test.tsx`, `__tests__/accessibility.test.tsx`) each
 * declare their own `jest.mock('expo-camera', …)` factory when they need to
 * drive permission/hardware state per test — those factories still win. This
 * module is the default surface for every other suite (and for new tests) so
 * the native camera module is never loaded under Jest:
 *
 *   - `CameraView` renders a `View` tagged `camera-view` and always reports
 *     itself as available via `isAvailableAsync()`
 *   - `useCameraPermissions()` returns a granted permission tuple
 *
 * Tests can override the returned permission/availability by importing
 * `jest.mock('expo-camera', …)` themselves, or by re-mocking the exported
 * jest fns (`CameraView.isAvailableAsync`, `useCameraPermissions`).
 */
const React = require('react');
const { View } = require('react-native');

const GRANTED_PERMISSION = { granted: true, canAskAgain: true, status: 'granted' };

const CameraView = Object.assign(
  React.forwardRef(function CameraView(props, ref) {
    // Scanner-related props (`facing`, `onBarcodeScanned`,
    // `barcodeScannerSettings`, `onMountError`) are forwarded so tests can
    // read them off the rendered `camera-view` host node.
    return React.createElement(View, { testID: 'camera-view', ...props, ref });
  }),
  {
    isAvailableAsync: jest.fn(() => Promise.resolve(true)),
    getAvailableCameraTypesAsync: jest.fn(() => Promise.resolve(['back', 'front'])),
  }
);

const requestCameraPermissionsAsync = jest.fn(() => Promise.resolve(GRANTED_PERMISSION));
const useCameraPermissions = jest.fn(() => [GRANTED_PERMISSION, requestCameraPermissionsAsync]);
const getCameraPermissionsAsync = jest.fn(() => Promise.resolve(GRANTED_PERMISSION));

module.exports = {
  __esModule: true,
  CameraView,
  CameraType: { back: 'back', front: 'front' },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  useCameraPermissions,
  requestCameraPermissionsAsync,
  getCameraPermissionsAsync,
};
