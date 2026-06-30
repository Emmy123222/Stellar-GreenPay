import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { useWallet } from '../hooks/useWallet';

// Lobstr deep-links only support payment requests, not wallet connection.
// WalletConnect for Stellar (SEP-43) is still in draft and has no stable
// mobile SDK. Manual public-key entry with SecureStore is the reliable choice.
export function WalletConnect() {
  const { publicKey, loading, error, connect, disconnect } = useWallet();
  const [modalVisible, setModalVisible] = useState(false);
  const [inputAddress, setInputAddress] = useState('');
  const [connecting, setConnecting] = useState(false);

  if (loading) return <ActivityIndicator size="small" color="#22c55e" />;

  if (publicKey) {
    return (
      <TouchableOpacity
        style={styles.connectedBadge}
        onLongPress={() =>
          Alert.alert('Disconnect wallet?', truncateAddress(publicKey), [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Disconnect', style: 'destructive', onPress: disconnect },
          ])
        }
        accessibilityLabel={`Connected wallet ${truncateAddress(publicKey)}, long press to disconnect`}
        accessibilityRole="button"
      >
        <View style={styles.dot} />
        <Text style={styles.addressText}>{truncateAddress(publicKey)}</Text>
      </TouchableOpacity>
    );
  }

  const handleConnect = async () => {
    setConnecting(true);
    const ok = await connect(inputAddress);
    setConnecting(false);
    if (ok) {
      setModalVisible(false);
      setInputAddress('');
    }
  };

  return (
    <>
      <TouchableOpacity style={styles.connectButton} onPress={() => setModalVisible(true)} accessibilityLabel="Connect Stellar wallet" accessibilityRole="button">
        <Text style={styles.connectButtonText}>Connect Wallet</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Connect Stellar Wallet</Text>
            <Text style={styles.sheetSubtitle}>
              Enter your Stellar public key (starts with G)
            </Text>

            <TextInput
              style={styles.input}
              placeholder="GABC...XYZ"
              placeholderTextColor="#9ca3af"
              value={inputAddress}
              onChangeText={setInputAddress}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.confirmButton, connecting && styles.disabled]}
              onPress={handleConnect}
              disabled={connecting || !inputAddress.trim()}
              accessibilityLabel="Confirm wallet connection"
              accessibilityRole="button"
            >
              {connecting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.confirmButtonText}>Connect</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setModalVisible(false)} accessibilityLabel="Cancel wallet connection" accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const styles = StyleSheet.create({
  connectButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  connectButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e', marginRight: 6 },
  addressText: { color: '#15803d', fontWeight: '600', fontSize: 13 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  sheetSubtitle: { color: '#6b7280', marginBottom: 16, fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  errorText: { color: '#ef4444', fontSize: 12, marginBottom: 10 },
  confirmButton: {
    backgroundColor: '#22c55e',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  confirmButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  cancelText: { color: '#6b7280', textAlign: 'center', fontSize: 14 },
});
