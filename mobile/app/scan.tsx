/**
 * app/scan.tsx
 * Scan to Donate — reads a project wallet QR code and navigates to the donate
 * screen with the scanned wallet address pre-populated as the destination.
 *
 * QR format expected: a Stellar public key (G…) or a deep-link of the form
 *   greenpay://donate?wallet=G...&project=<projectId>
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
import { createScanGate } from '../utils/scanThrottle';

const STELLAR_KEY_RE = /^G[A-Z2-7]{55}$/;
const DEEP_LINK_RE   = /greenpay:\/\/donate\?(.+)/;

function parseScan(data: string): { wallet: string; projectId?: string } | null {
  const deepMatch = data.match(DEEP_LINK_RE);
  if (deepMatch) {
    const params = new URLSearchParams(deepMatch[1]);
    const wallet = params.get('wallet') ?? '';
    if (STELLAR_KEY_RE.test(wallet)) {
      return { wallet, projectId: params.get('project') ?? undefined };
    }
    return null;
  }
  if (STELLAR_KEY_RE.test(data.trim())) {
    return { wallet: data.trim() };
  }
  return null;
}

export default function ScanScreen() {
  const router = useRouter();
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

  const goToDonate = (parsed: { wallet: string; projectId?: string }) => {
    // Build the donate route with the scanned wallet as a query param.
    // The donate/[id] screen reads `wallet` from params to pre-fill the destination.
    const target = parsed.projectId
      ? `/donate/${parsed.projectId}?wallet=${encodeURIComponent(parsed.wallet)}`
      : `/donate/scan?wallet=${encodeURIComponent(parsed.wallet)}`;
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
      setError('QR code is not a valid GreenPay wallet address. Try again.');
      setTimeout(() => setError(null), 2000);
      return;
    }

    processingRef.current = true;
    setScanned(true);
    goToDonate(parsed);
  };

  const submitManual = () => {
    const parsed = parseScan(manualValue);
    if (!parsed) {
      setError('Not a valid GreenPay wallet address. Try again.');
      return;
    }
    processingRef.current = true;
    setScanned(true);
    setManualEntry(false);
    goToDonate(parsed);
  };

  if (!permission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Requesting camera permission…</Text>
      </View>
    );
  }

  const cameraUnavailable = cameraFailed || !permission.granted;

  if (cameraUnavailable && !manualEntry) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>
          {permission.granted
            ? 'Camera could not be started.'
            : 'Camera access is required to scan QR codes.'}
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => setManualEntry(true)}
          accessibilityLabel="Type address manually"
          accessibilityRole="button"
          testID="manual-entry-link"
        >
          <Text style={styles.buttonText}>Type address manually</Text>
        </TouchableOpacity>
        {!permission.granted && (
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>
        )}
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            style={[styles.button, styles.buttonSecondary]}
            onPress={() => Linking.openSettings()}
          >
            <Text style={styles.buttonText}>Open Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (manualEntry) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Type address manually</Text>
        <TextInput
          style={styles.input}
          value={manualValue}
          onChangeText={setManualValue}
          placeholder="Stellar address (G…)"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Wallet address input"
          testID="manual-address-input"
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <TouchableOpacity
          style={styles.button}
          onPress={submitManual}
          accessibilityLabel="Continue with typed address"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary]}
          onPress={() => {
            setManualEntry(false);
            setError(null);
          }}
          accessibilityLabel="Back to QR scanning"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Back to QR scanning</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarcode}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onMountError={() => setCameraFailed(true)}
      />

      {/* Viewfinder overlay */}
      <View style={styles.overlay}>
        <View style={styles.topOverlay} />
        <View style={styles.middleRow}>
          <View style={styles.sideOverlay} />
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
          <View style={styles.sideOverlay} />
        </View>
        <View style={styles.bottomOverlay}>
          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : scanned ? (
            <Text style={styles.successText}>QR scanned — opening donation screen…</Text>
          ) : (
            <Text style={styles.hint}>
              Point the camera at a project wallet QR code
            </Text>
          )}

          {scanned && (
            <TouchableOpacity
              style={[styles.button, { marginTop: 16 }]}
              onPress={() => { processingRef.current = false; gate.reset(); setScanned(false); }}
            >
              <Text style={styles.buttonText}>Scan Again</Text>
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
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f0f7f0',
  },
  message: {
    fontSize: 16,
    color: '#1a2e1a',
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#227239',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  buttonSecondary: {
    backgroundColor: '#5a7a5a',
  },
  buttonText: {
    color: '#fff',
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
    color: '#c8e6c9',
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
    borderColor: '#4caf50',
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
