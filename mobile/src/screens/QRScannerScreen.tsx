import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { BarCodeScanner, BarCodeScannerResult } from 'expo-barcode-scanner';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../app/theme';

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
  const { colors } = useTheme();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    BarCodeScanner.requestPermissionsAsync().then(({ status }: { status: string }) => {
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
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.text }]}>Requesting camera permission…</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.text }]}>Camera access is required to scan QR codes.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backButton, { backgroundColor: colors.buttonBackground }]} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={[styles.backButtonText, { color: colors.buttonText }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <BarCodeScanner
        onBarCodeScanned={handleBarCodeScanned}
        style={StyleSheet.absoluteFillObject}
        barCodeTypes={[BarCodeScanner.Constants.BarCodeType.qr]}
      />

      <View style={styles.overlay}>
        <Text style={[styles.hint, { color: colors.headerText }]}>Point camera at a GreenPay QR code</Text>
        <View style={[styles.frame, { borderColor: colors.primary }]} />
        {scanned && (
          <TouchableOpacity style={[styles.rescanButton, { backgroundColor: colors.buttonBackground }]} onPress={() => setScanned(false)} accessibilityLabel="Tap to scan again" accessibilityRole="button">
            <Text style={[styles.rescanText, { color: colors.buttonText }]}>Tap to scan again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.cancelButton} accessibilityLabel="Cancel QR scanning" accessibilityRole="button">
          <Text style={[styles.cancelText, { color: colors.headerText }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  message: { fontSize: 15, textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center', padding: 32 },
  hint: { fontSize: 15, marginTop: 20, textAlign: 'center' },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderRadius: 16,
  },
  rescanButton: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  rescanText: { fontWeight: '600' },
  cancelButton: { paddingVertical: 12, paddingHorizontal: 24 },
  cancelText: { fontSize: 15 },
  backButton: { marginTop: 16, padding: 12, borderRadius: 8 },
  backButtonText: { fontWeight: '600' },
});
