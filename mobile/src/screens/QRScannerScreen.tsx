import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { BarCodeScanner, BarCodeScannerResult } from 'expo-barcode-scanner';
import { useNavigation } from '@react-navigation/native';

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

export function QRScannerScreen() {
  const navigation = useNavigation<any>();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    BarCodeScanner.requestPermissionsAsync().then(({ status }) => {
      setHasPermission(status === 'granted');
    });
  }, []);

  const handleBarCodeScanned = ({ data }: BarCodeScannerResult) => {
    if (scanned) return;
    setScanned(true);

    const projectId = extractProjectId(data);
    if (!projectId) {
      Alert.alert('Unrecognized QR code', 'This QR code is not a GreenPay donation link.', [
        { text: 'Scan again', onPress: () => setScanned(false) },
        { text: 'Cancel', onPress: () => navigation.goBack() },
      ]);
      return;
    }

    navigation.replace('Donation', { projectId });
  };

  if (hasPermission === null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Requesting camera permission…</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Camera access is required to scan QR codes.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={styles.backButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BarCodeScanner
        onBarCodeScanned={handleBarCodeScanned}
        style={StyleSheet.absoluteFillObject}
        barCodeTypes={[BarCodeScanner.Constants.BarCodeType.qr]}
      />

      <View style={styles.overlay}>
        <Text style={styles.hint}>Point camera at a GreenPay QR code</Text>
        <View style={styles.frame} />
        {scanned && (
          <TouchableOpacity style={styles.rescanButton} onPress={() => setScanned(false)} accessibilityLabel="Tap to scan again" accessibilityRole="button">
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
});
