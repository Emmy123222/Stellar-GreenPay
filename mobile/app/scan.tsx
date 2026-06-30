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
  Linking,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';

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
  const cooldown = useRef(false);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  const handleBarcode = ({ data }: { data: string }) => {
    if (cooldown.current || scanned) return;
    cooldown.current = true;

    const parsed = parseScan(data);
    if (!parsed) {
      setError('QR code is not a valid GreenPay wallet address. Try again.');
      setTimeout(() => {
        setError(null);
        cooldown.current = false;
      }, 2000);
      return;
    }

    setScanned(true);

    // Build the donate route with the scanned wallet as a query param.
    // The donate/[id] screen reads `wallet` from params to pre-fill the destination.
    const target = parsed.projectId
      ? `/donate/${parsed.projectId}?wallet=${encodeURIComponent(parsed.wallet)}`
      : `/donate/scan?wallet=${encodeURIComponent(parsed.wallet)}`;

    router.push(target as `${string}`);
  };

  if (!permission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Requesting camera permission…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Camera access is required to scan QR codes.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
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

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarcode}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
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
              onPress={() => { setScanned(false); cooldown.current = false; }}
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
