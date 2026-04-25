/**
 * app/donate/[id].tsx
 * Donate screen with wallet integration
 */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Linking } from 'expo-linking';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const HORIZON_URL = process.env.EXPO_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';

interface ClimateProject {
  id: string;
  name: string;
  walletAddress: string;
}

export default function DonateScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [project, setProject] = useState<ClimateProject | null>(null);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [currency, setCurrency] = useState<'XLM' | 'USDC'>('XLM');
  const [loading, setLoading] = useState(false);
  const [publicKey, setPublicKey] = useState('');

  useEffect(() => {
    if (id) loadProject(id as string);
  }, [id]);

  const loadProject = async (projectId: string) => {
    try {
      const res = await axios.get(`${API_URL}/api/projects/${projectId}`);
      setProject(res.data.data);
    } catch (error) {
      console.error('Error loading project:', error);
    }
  };

  const handleDonate = async () => {
    if (!project || !amount || parseFloat(amount) < 1) {
      Alert.alert('Error', 'Please enter a valid amount (minimum 1)');
      return;
    }

    if (!publicKey) {
      Alert.alert('Wallet Required', 'Please connect your Stellar wallet first');
      return;
    }

    setLoading(true);

    try {
      // Build transaction using Stellar SDK
      const { Server, TransactionBuilder, Networks, Operation, Asset } = require('@stellar/stellar-sdk');
      const server = new Server(HORIZON_URL);
      const sourceAccount = await server.loadAccount(publicKey);

      const asset = currency === 'USDC'
        ? new Asset('USDC', process.env.EXPO_PUBLIC_USDC_ISSUER)
        : Asset.native();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: project.walletAddress,
            asset,
            amount: currency === 'XLM' ? parseFloat(amount).toFixed(7) : parseFloat(amount).toFixed(2),
          })
        )
        .addMemo(Operation.memo({ type: 'text', value: `GreenPay:${project.id.slice(0, 16)}` }))
        .setTimeout(60)
        .build();

      // Open Freighter mobile app via deep link
      const xdr = transaction.toXDR();
      const freighterUrl = `freighter://tx?xdr=${encodeURIComponent(xdr)}`;

      const supported = await Linking.canOpenURL(freighterUrl);
      if (supported) {
        await Linking.openURL(freighterUrl);
      } else {
        Alert.alert(
          'Wallet Not Found',
          'Please install Freighter mobile app to sign transactions'
        );
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to build transaction');
    } finally {
      setLoading(false);
    }
  };

  const connectWallet = async () => {
    // For mobile, we'll use a simple input for now
    // In production, integrate with Freighter mobile SDK
    Alert.alert(
      'Connect Wallet',
      'Enter your Stellar public key:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'OK',
          onPress: (input: any) => {
            if (input && /^G[A-Z0-9]{55}$/.test(input)) {
              setPublicKey(input);
            } else {
              Alert.alert('Invalid Key', 'Please enter a valid Stellar public key');
            }
          },
        },
      ],
      'plain-text-input'
    );
  };

  if (!project) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading project...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Donate to {project.name}</Text>
        <Text style={styles.subtitle}>100% goes directly to the project</Text>
      </View>

      {!publicKey ? (
        <TouchableOpacity style={styles.connectButton} onPress={connectWallet}>
          <Text style={styles.connectButtonText}>Connect Wallet</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.walletCard}>
          <Text style={styles.walletLabel}>Connected as:</Text>
          <Text style={styles.walletAddress}>{publicKey.slice(0, 8)}...{publicKey.slice(-4)}</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.label}>Currency</Text>
        <View style={styles.currencySelector}>
          <TouchableOpacity
            style={[styles.currencyButton, currency === 'XLM' && styles.currencyButtonActive]}
            onPress={() => setCurrency('XLM')}
          >
            <Text style={[styles.currencyButtonText, currency === 'XLM' && styles.currencyButtonTextActive]}>
              XLM
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.currencyButton, currency === 'USDC' && styles.currencyButtonActive]}
            onPress={() => setCurrency('USDC')}
          >
            <Text style={[styles.currencyButtonText, currency === 'USDC' && styles.currencyButtonTextActive]}>
              USDC
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Amount ({currency})</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter amount..."
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
        />

        <View style={styles.presets}>
          {['5', '10', '25', '50', '100'].map(preset => (
            <TouchableOpacity
              key={preset}
              style={[styles.presetButton, amount === preset && styles.presetButtonActive]}
              onPress={() => setAmount(preset)}
            >
              <Text style={[styles.presetButtonText, amount === preset && styles.presetButtonTextActive]}>
                {preset} {currency}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Message (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Leave a message of support..."
          value={message}
          onChangeText={setMessage}
          maxLength={100}
        />
      </View>

      <TouchableOpacity
        style={[styles.donateButton, loading && styles.donateButtonDisabled]}
        onPress={handleDonate}
        disabled={loading}
      >
        <Text style={styles.donateButtonText}>
          {loading ? 'Building...' : `🌱 Donate ${amount || currency}`}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f7f0',
  },
  loadingText: {
    fontSize: 18,
    color: '#5a7a5a',
    textAlign: 'center',
    marginTop: 40,
  },
  header: {
    padding: 24,
    backgroundColor: '#227239',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#e8f3e8',
    marginTop: 4,
  },
  connectButton: {
    backgroundColor: '#227239',
    padding: 16,
    margin: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  walletCard: {
    margin: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
  },
  walletLabel: {
    fontSize: 12,
    color: '#8aaa8a',
  },
  walletAddress: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#227239',
    marginTop: 4,
  },
  card: {
    margin: 16,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a2e1a',
    marginBottom: 8,
  },
  currencySelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  currencyButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f0f7f0',
    alignItems: 'center',
  },
  currencyButtonActive: {
    backgroundColor: '#227239',
  },
  currencyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5a7a5a',
  },
  currencyButtonTextActive: {
    color: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e8f3e8',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  presetButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f7f0',
  },
  presetButtonActive: {
    backgroundColor: '#227239',
  },
  presetButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5a7a5a',
  },
  presetButtonTextActive: {
    color: '#fff',
  },
  donateButton: {
    backgroundColor: '#227239',
    padding: 16,
    margin: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  donateButtonDisabled: {
    opacity: 0.6,
  },
  donateButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
