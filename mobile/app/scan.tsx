/**
 * app/scan.tsx
 * Scan to Donate — reads a project QR code and navigates to the donate screen
 * with the scanned wallet address and/or project id pre-populated.
 *
 * QR formats accepted:
 *   - a bare Stellar public key (G…)
 *   - greenpay://donate?wallet=G…&project=<projectId>
 *   - greenpay://donate/<projectId>
 *   - any link carrying an explicit `?projectId=` (e.g.
 *     https://greenpay.app/donate?projectId=proj-42)
 * The manual-entry field additionally accepts a bare project id.
 *
 * Scanning goes through expo-camera's `CameraView` (`onBarcodeScanned` +
 * `barcodeScannerSettings`) — the deprecated `expo-barcode-scanner` package is
 * no longer used. Wallet validation is delegated to
 * `utils/stellarValidation.ts` and repeat frames are suppressed by
 * `utils/scanThrottle.ts`.
 */
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Linking,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { BarcodeType } from 'expo-camera';
import { useThemeOrDefault } from './theme';
import { isValidStellarAddress } from '../utils/stellarValidation';
import { createScanGate } from '../utils/scanThrottle';

const DEEP_LINK_RE   = /greenpay:\/\/donate\?(.+)/;
// greenpay://donate/<projectId> — the form printed on project QR codes.
const DONATE_PATH_RE = /^greenpay:\/\/(?:[^/]+\/)?donate\/([^/?#\s]+)$/i;
const PROJECT_ID_QUERY_RE = /[?&]projectId=([^&#\s]+)/i;
// Same grammar the deep-link handler accepts (hooks/useDeepLink.ts).
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// QR codes only — the expo-camera equivalent of the old
// `barCodeTypes: [BarCodeScanner.Constants.BarCodeType.qr]`.
const QR_BARCODE_SETTINGS = { barcodeTypes: ['qr'] as BarcodeType[] };

export const INVALID_QR_MESSAGE = 'This QR code is not a valid GreenPay wallet address. Try again.';
export const INVALID_MANUAL_MESSAGE =
  'Enter a GreenPay donation link, project id or Stellar address.';

/** What a scan (or manual entry) resolved to; at least one field is set. */
export interface ScanPayload {
  wallet?: string;
  projectId?: string;
}

function takeProjectId(raw: string): string | null {
  const pathMatch = raw.match(DONATE_PATH_RE);
  const candidate = pathMatch
    ? pathMatch[1]
    : raw.match(PROJECT_ID_QUERY_RE)?.[1];
  if (!candidate) return null;

  let value = candidate;
  try {
    value = decodeURIComponent(candidate);
  } catch {
    // Keep the raw value when it is not valid percent-encoding.
  }
  return PROJECT_ID_RE.test(value) ? value : null;
}

export function parseScan(data: string): ScanPayload | null {
  const deepMatch = data.match(DEEP_LINK_RE);
  if (deepMatch) {
    const params = new URLSearchParams(deepMatch[1]);
    const wallet = (params.get('wallet') ?? '').trim();
    if (wallet && isValidStellarAddress(wallet)) {
      return { wallet, projectId: params.get('project') ?? undefined };
    }
    return null;
  }

  const projectId = takeProjectId(data);
  if (projectId) return { projectId };

  const candidate = data.trim();
  if (candidate && isValidStellarAddress(candidate)) {
    return { wallet: candidate };
  }
  return null;
}

/** Manual entry accepts everything a scan does, plus a bare project id. */
export function parseManualEntry(raw: string): ScanPayload | null {
  const value = raw.trim();
  if (!value) return null;

  return parseScan(value) ?? (PROJECT_ID_RE.test(value) ? { projectId: value } : null);
}

export default function ScanScreen() {
  const router = useRouter();
  const { colors } = useThemeOrDefault();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualValue, setManualValue] = useState('');
  // Ref-based scan gate: 500ms interval + processing latch, no re-renders.
  const gate = useRef(createScanGate()).current;
  const processingRef = useRef(false);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (requestedRef.current || permission?.granted) return;
    requestedRef.current = true;
    requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  // Hardware unavailable (web, emulator, broken camera) → manual fallback.
  useEffect(() => {
    let alive = true;
    const check = CameraView as unknown as { isAvailableAsync?: () => Promise<boolean> };
    if (typeof check.isAvailableAsync === 'function') {
      check
        .isAvailableAsync()
        .then((available) => {
          if (alive && !available) setCameraFailed(true);
        })
        .catch(() => {
          if (alive) setCameraFailed(true);
        });
    }
    return () => {
      alive = false;
    };
  }, []);

  const dismissError = () => {
    setError(null);
    // An explicit dismissal means "scan again now": clear the 500ms interval
    // as well as the latch so the next frame is accepted immediately.
    gate.reset();
  };

  const goToDonate = (payload: ScanPayload) => {
    const walletQuery = payload.wallet
      ? `?wallet=${encodeURIComponent(payload.wallet)}`
      : '';
    // The donate/[id] screen reads `wallet` from params to pre-fill the destination.
    const target = payload.projectId
      ? `/donate/${payload.projectId}${walletQuery}`
      : `/donate/scan?wallet=${encodeURIComponent(payload.wallet ?? '')}`;
    router.push(target as `${string}`);
  };

  const handleBarcode = ({ data }: { data: string }) => {
    if (processingRef.current) return;
    if (!gate.tryAcquire()) return;

    const parsed = parseScan(data);
    if (!parsed) {
      // Not processing anything for an invalid frame: release the latch
      // immediately (the 500ms interval still suppresses repeat frames) so a
      // valid code right afterwards is accepted once the window elapses.
      gate.release();
      setError(INVALID_QR_MESSAGE);
      return;
    }

    processingRef.current = true;
    setScanned(true);
    goToDonate(parsed);
  };

  const submitManual = () => {
    const parsed = parseManualEntry(manualValue);
    if (!parsed) {
      setError(INVALID_MANUAL_MESSAGE);
      return;
    }
    processingRef.current = true;
    setScanned(true);
    setManualEntry(false);
    goToDonate(parsed);
  };

  if (!permission) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.text }]}>Requesting camera permission…</Text>
      </View>
    );
  }

  const cameraUnavailable = cameraFailed || !permission.granted;

  if (cameraUnavailable && !manualEntry) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.text }]}>
          {permission.granted
            ? 'Camera could not be started.'
            : 'Camera access is required to scan QR codes.'}
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.buttonBackground }]}
          onPress={() => setManualEntry(true)}
          accessibilityRole="button"
          accessibilityLabel="Type address manually"
          accessibilityHint="Continue by typing the destination Stellar address yourself"
          testID="manual-entry-link"
        >
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Type address manually</Text>
        </TouchableOpacity>
        {!permission.granted && (
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.buttonBackground }]}
            onPress={requestPermission}
            accessibilityRole="button"
            accessibilityLabel="Grant camera permission"
            accessibilityHint="Lets GreenPay use the camera to scan project QR codes"
          >
            <Text style={[styles.buttonText, { color: colors.buttonText }]}>Grant Permission</Text>
          </TouchableOpacity>
        )}
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            style={[styles.button, styles.buttonSecondary, { backgroundColor: colors.secondaryText }]}
            onPress={() => Linking.openSettings()}
            accessibilityRole="link"
            accessibilityLabel="Open device settings"
            accessibilityHint="Opens system settings so you can allow camera access"
          >
            <Text style={[styles.buttonText, { color: colors.buttonText }]}>Open Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (manualEntry) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.text }]} accessibilityRole="header">Type address manually</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
          value={manualValue}
          onChangeText={setManualValue}
          placeholder="Stellar address, project id or GreenPay link"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Wallet address input"
          testID="manual-address-input"
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.buttonBackground }]}
          onPress={submitManual}
          accessibilityLabel="Continue with typed address"
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary, { backgroundColor: colors.secondaryText }]}
          onPress={() => {
            setManualEntry(false);
            setError(null);
          }}
          accessibilityLabel="Back to QR scanning"
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Back to QR scanning</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarcode}
        barcodeScannerSettings={QR_BARCODE_SETTINGS}
        onMountError={() => setCameraFailed(true)}
      />

      {/* Viewfinder overlay */}
      <View style={styles.overlay}>
        <View style={styles.topOverlay} />
        <View style={styles.middleRow}>
          <View style={styles.sideOverlay} />
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.topLeft, { borderColor: colors.primary }]} />
            <View style={[styles.corner, styles.topRight, { borderColor: colors.primary }]} />
            <View style={[styles.corner, styles.bottomLeft, { borderColor: colors.primary }]} />
            <View style={[styles.corner, styles.bottomRight, { borderColor: colors.primary }]} />
          </View>
          <View style={styles.sideOverlay} />
        </View>
        <View style={styles.bottomOverlay}>
          {error ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLiveRegion="assertive"
              accessibilityLabel={`Invalid QR code error: ${error}`}
              accessibilityHint="Dismisses the error and resumes scanning"
              onPress={dismissError}
              style={styles.errorTouchable}
            >
              <Text style={styles.errorText}>{error}</Text>
            </TouchableOpacity>
          ) : scanned ? (
            <Text style={styles.successText}>QR scanned — opening donation screen…</Text>
          ) : (
            <Text style={[styles.hint, { color: colors.headerText }]}>
              Point the camera at a project wallet QR code
            </Text>
          )}

          {scanned && (
            <TouchableOpacity
              style={[styles.button, { marginTop: 16, backgroundColor: colors.buttonBackground }]}
              onPress={() => { setScanned(false); processingRef.current = false; gate.reset(); }}
              accessibilityRole="button"
              accessibilityLabel="Scan another QR code"
            >
              <Text style={[styles.buttonText, { color: colors.buttonText }]}>Scan Again</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const CORNER = 24;
const BORDER = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 10,
    marginTop: 8,
  },
  buttonSecondary: {},
  errorTouchable: { minHeight: 44, justifyContent: 'center' },
  buttonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#1a2e1a',
    backgroundColor: '#fff',
    marginTop: 8,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  topOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  middleRow: {
    flexDirection: 'row',
    height: 260,
  },
  sideOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  viewfinder: {
    width: 260,
    height: 260,
  },
  bottomOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    paddingTop: 20,
    paddingHorizontal: 24,
  },
  hint: {
    fontSize: 14,
    textAlign: 'center',
  },
  errorText: {
    color: '#ff8a80',
    fontSize: 14,
    textAlign: 'center',
  },
  successText: {
    color: '#a5d6a7',
    fontSize: 14,
    textAlign: 'center',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: BORDER,
    borderLeftWidth: BORDER,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: BORDER,
    borderRightWidth: BORDER,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: BORDER,
    borderLeftWidth: BORDER,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: BORDER,
    borderRightWidth: BORDER,
  },
});
