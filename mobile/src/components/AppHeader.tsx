import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WalletConnect } from './WalletConnect';

export function AppHeader() {
  return (
    <View style={styles.header}>
      <Text style={styles.logo}>🌱 GreenPay</Text>
      <WalletConnect />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  logo: { fontSize: 18, fontWeight: '700', color: '#15803d' },
});
