import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { BarcodeType } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import { createScanGate } from '../../utils/scanThrottle';

// QR codes only — expo-camera equivalent of the old
// `barCodeTypes: [BarCodeScanner.Constants.BarCodeType.qr]`.
const QR_BARCODE_SETTINGS = { barcodeTypes: ['qr'] as BarcodeType[] };

// Expected QR URL format: https://greenpay.app/donate?projectId=<id>
// or the short form:      greenpay://donate/<id>
function extractProjectId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.searchParams.has('projectId')) {
      return url.searchParams.get('projectId');
    }
    // greenpay://donate/<id>
    if (url.protocol === 'greenpay:' && url.pathname.startsWith('//donate/')) {
      return url.pathname.replace('//donate/', '');
    }
  } catch {
    // not a valid URL
  }
  return null;
}

/** Bare project ids are accepted from the manual-entry field. */
function parseManualInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const fromUrl = extractProjectId(value);
  if (fromUrl) return fromUrl;
  if (/^[A-Za-z0-9_-]{3,}$/.test(value)) return value;
  return null;
}

export function QRScannerScreen() {
  const navigation = useNavigation<any>();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualValue, setManualValue] = useState('');

  // Ref-based guards: scanning rules change without re-rendering the screen.
  const gate = useRef(createScanGate()).current;
  const processingRef = useRef(false);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (requestedRef.current) return;
    if (permission && permission.granted) return;
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

  const goManual = () => setManualEntry(true);

  const submitManual = () => {
    const projectId = parseManualInput(manualValue);
    if (!projectId) {
      Alert.alert('Unrecognized value', 'Enter a GreenPay donation link or project id.');
      return;
    }
    processingRef.current = true;
    setScanned(true);
    navigation.replace('Donation', { projectId });
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    // Duplicate frames while a scan is being processed are dropped outright.
    if (processingRef.current) return;
    // At most one accepted scan every 500ms.
    if (!gate.tryAcquire()) return;

    const projectId = extractProjectId(data);
    if (!projectId) {
      Alert.alert('Unrecognized QR code', 'This QR code is not a GreenPay donation link.', [
        {
          text: 'Scan again',
          onPress: () => {
            gate.release();
            setScanned(false);
          },
        },
        { text: 'Cancel', onPress: () => navigation.goBack() },
      ]);
      return;
    }

    processingRef.current = true;
    setScanned(true);
    navigation.replace('Donation', { projectId });
  };

  if (permission === null) {
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
          onPress={goManual}
          style={styles.manualLink}
          accessibilityLabel="Type address manually"
          accessibilityRole="button"
          testID="manual-entry-link"
        >
          <Text style={styles.manualLinkText}>Type address manually</Text>
        </TouchableOpacity>
        {!permission.granted && permission.canAskAgain !== false && (
          <TouchableOpacity onPress={() => requestPermission()} style={styles.backButton} accessibilityLabel="Grant camera permission" accessibilityRole="button">
            <Text style={styles.backButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={styles.backButtonText}>Go back</Text>
        </TouchableOpacity>
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
          placeholder="https://greenpay.app/donate?projectId=…"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Address input"
          testID="manual-address-input"
        />
        <TouchableOpacity onPress={submitManual} style={styles.backButton} accessibilityLabel="Continue" accessibilityRole="button">
          <Text style={styles.backButtonText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setManualEntry(false)} style={styles.backButton} accessibilityLabel="Back to QR scanning" accessibilityRole="button">
          <Text style={styles.backButtonText}>Back to QR scanning</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={QR_BARCODE_SETTINGS}
        onMountError={() => setCameraFailed(true)}
      />

      <View style={styles.overlay}>
        <Text style={styles.hint}>Point camera at a GreenPay QR code</Text>
        <View style={styles.frame} />
        {scanned && (
          <TouchableOpacity style={styles.rescanButton} onPress={() => { processingRef.current = false; gate.reset(); setScanned(false); }} accessibilityLabel="Tap to scan again" accessibilityRole="button">
            <Text style={styles.rescanText}>Tap to scan again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.cancelButton} accessibilityLabel="Cancel QR scanning" accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  message: { fontSize: 15, color: '#374151', textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center', padding: 32 },
  hint: { color: '#fff', fontSize: 15, marginTop: 20, textAlign: 'center' },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#22c55e',
    borderRadius: 16,
  },
  rescanButton: { backgroundColor: '#22c55e', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  rescanText: { color: '#fff', fontWeight: '600' },
  cancelButton: { paddingVertical: 12, paddingHorizontal: 24 },
  cancelText: { color: '#fff', fontSize: 15 },
  backButton: { marginTop: 16, backgroundColor: '#22c55e', padding: 12, borderRadius: 8 },
  backButtonText: { color: '#fff', fontWeight: '600' },
  manualLink: { marginTop: 16, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#22c55e' },
  manualLinkText: { color: '#22c55e', fontWeight: '600' },
  input: {
    marginTop: 16,
    width: '100%',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
  },
});
