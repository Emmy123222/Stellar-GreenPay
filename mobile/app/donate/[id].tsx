/**
 * app/donate/[id].tsx
 * Donate screen with project selector, amount input, and Stellar transaction submission.
 */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { authenticate } from '../../hooks/useBiometricAuth';
import { Keypair, Server, TransactionBuilder, Networks, Operation, Asset, Memo } from '@stellar/stellar-sdk';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const HORIZON_URL = process.env.EXPO_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';

interface ClimateProject {
  id: string;
  name: string;
  description: string;
  walletAddress: string;
}

export default function DonateScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id, wallet: scannedWallet } = useLocalSearchParams();
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(
    id && id !== 'scan' ? (id as string) : undefined
  );
  const [amount, setAmount] = useState('1');
  const [message, setMessage] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'success' | 'error' | 'info' | null>(null);

  useEffect(() => {
    loadProjects();
  }, [id]);

  const loadProjects = async () => {
    setLoading(true);
    setStatusMessage(null);

    try {
      const res = await axios.get(`${API_URL}/api/projects`);
      const list: ClimateProject[] = Array.isArray(res.data.data) ? res.data.data : [];
      setProjects(list);
      const initialProjectId = (id as string | undefined) || list[0]?.id;
      setSelectedProjectId(initialProjectId);
    } catch (error) {
      console.error('Error loading projects:', error);
      setStatusType('error');
      setStatusMessage('Unable to load projects. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  // When arriving from the QR scanner, prefer the project whose wallet matches
  // the scanned address; fall back to id-based or first project selection.
  const scannedAddr = typeof scannedWallet === 'string' ? scannedWallet : null;
  const selectedProject =
    (scannedAddr
      ? projects.find((p) => p.walletAddress === scannedAddr)
      : undefined) ??
    projects.find((project) => project.id === selectedProjectId) ??
    projects[0] ??
    null;

  const handleDonate = async () => {
    if (!selectedProject) {
      Alert.alert('Error', 'Please choose a project to donate to.');
      return;
    }

    const donationAmount = parseFloat(amount);
    if (!amount || Number.isNaN(donationAmount) || donationAmount < 1) {
      Alert.alert('Error', 'Please enter a valid amount (minimum 1 XLM).');
      return;
    }

    if (!publicKey) {
      Alert.alert('Wallet Required', 'Please connect your Stellar wallet first.');
      return;
    }

    if (!secretKey.trim()) {
      Alert.alert('Secret Required', 'Please enter your Stellar secret key to sign the transaction.');
      return;
    }

    let keypair;
    try {
      keypair = Keypair.fromSecret(secretKey.trim());
    } catch (error) {
      Alert.alert('Invalid Secret Key', 'The secret key you entered is not valid.');
      return;
    }

    if (keypair.publicKey() !== publicKey) {
      Alert.alert(
        'Key Mismatch',
        'The secret key does not match the connected public key. Please use the same account.'
      );
      return;
    }

    const authenticated = await authenticate('Confirm donation with biometrics or PIN');
    if (!authenticated) {
      Alert.alert('Authentication Required', 'You must authenticate to sign the transaction.');
      return;
    }

    setSubmitting(true);
    setStatusType('info');
    setStatusMessage('Signing and submitting your donation...');

    try {
      const server = new Server(HORIZON_URL);
      const sourceAccount = await server.loadAccount(publicKey);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: selectedProject.walletAddress,
            asset: Asset.native(),
            amount: donationAmount.toFixed(7),
          })
        )
        .addMemo(Memo.text(`GreenPay:${selectedProject.id.slice(0, 16)}`))
        .setTimeout(60)
        .build();

      transaction.sign(keypair);
      const horizonResult = await server.submitTransaction(transaction);
      const transactionHash = horizonResult.hash;

      await axios.post(`${API_URL}/api/donations`, {
        projectId: selectedProject.id,
        donorAddress: publicKey,
        amountXLM: donationAmount.toFixed(7),
        amount: donationAmount.toFixed(7),
        currency: 'XLM',
        message: message.trim() || undefined,
        transactionHash,
      });

      setStatusType('success');
      setStatusMessage(`Donation successful! Transaction hash: ${transactionHash}`);
      setAmount('1');
      setMessage('');
      setSecretKey('');
    } catch (error: any) {
      console.error('Donation failed:', error);
      setStatusType('error');
      setStatusMessage(
        error?.response?.data?.message || error?.message || 'Donation failed. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const connectWallet = async () => {
    Alert.alert(
      'Connect Wallet',
      'Enter your Stellar public key:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'OK',
          onPress: (input: any) => {
            const trimmed = String(input || '').trim();
            if (/^G[A-Z0-9]{55}$/.test(trimmed)) {
              setPublicKey(trimmed);
            } else {
              Alert.alert('Invalid Key', 'Please enter a valid Stellar public key');
            }
          },
        },
      ],
      'plain-text-input'
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#227239" />
        <Text style={styles.loadingText}>Loading donation details...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Donate to {selectedProject?.name || 'a project'}</Text>
        <Text style={styles.subtitle}>Choose a project and donate XLM on testnet.</Text>
        {scannedAddr && (
          <View style={styles.scannedBanner}>
            <Text style={styles.scannedBannerText}>
              QR scanned: {scannedAddr.slice(0, 8)}…{scannedAddr.slice(-4)}
              {selectedProject ? ` — matched to ${selectedProject.name}` : ' (no matching project found)'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.selectorCard}>
        <Text style={styles.sectionTitle}>Select a project</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectList}>
          {projects.map((project) => (
            <TouchableOpacity
              key={project.id}
              style={[
                styles.projectOption,
                project.id === selectedProjectId && styles.projectOptionActive,
              ]}
              onPress={() => setSelectedProjectId(project.id)}
            >
              <Text
                style={[
                  styles.projectOptionText,
                  project.id === selectedProjectId && styles.projectOptionTextActive,
                ]}
              >
                {project.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {!publicKey ? (
        <TouchableOpacity style={[styles.connectButton, { backgroundColor: colors.buttonBackground }]}
          onPress={connectWallet}
        >
          <Text style={[styles.connectButtonText, { color: colors.buttonText }]}>Connect Wallet</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.walletCard}>
          <Text style={styles.walletLabel}>Connected wallet</Text>
          <Text style={styles.walletAddress}>{publicKey.slice(0, 8)}...{publicKey.slice(-4)}</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.label}>Amount (XLM)</Text>
        <TextInput
          style={styles.input}
          placeholder="1.00"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Secret Key</Text>
        <TextInput
          style={styles.input}
          placeholder="S..."
          value={secretKey}
          onChangeText={setSecretKey}
          autoCapitalize="none"
          secureTextEntry
        />

        <Text style={[styles.label, { color: colors.primaryText }]}>Message (optional)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.primaryText }]}
          placeholder="Leave a message of support..."
          placeholderTextColor={colors.placeholder}
          value={message}
          onChangeText={setMessage}
          maxLength={100}
        />
      </View>

      {statusMessage ? (
        <View
          style={[
            styles.statusBox,
            statusType === 'success'
              ? styles.successBox
              : statusType === 'error'
              ? styles.errorBox
              : styles.infoBox,
          ]}
        >
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.donateButton, (submitting || !publicKey) && styles.donateButtonDisabled]}
        onPress={handleDonate}
        disabled={submitting || !publicKey}
      >
        <Text style={styles.donateButtonText}>
          {submitting ? 'Sending donation...' : `🌱 Donate ${amount || '1'} XLM`}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 16,
  },
  header: {
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  scannedBanner: {
    marginTop: 10,
    backgroundColor: 'rgba(76,175,80,0.15)',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  scannedBannerText: {
    fontSize: 12,
    color: '#1b5e20',
  },
  selectorCard: {
    margin: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    color: '#1f5136',
  },
  projectList: {
    flexDirection: 'row',
  },
  projectOption: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#f0f7f0',
    marginRight: 10,
  },
  projectOptionActive: {
    backgroundColor: '#227239',
  },
  projectOptionText: {
    color: '#1f5136',
    fontSize: 14,
  },
  projectOptionTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  connectButton: {
    padding: 16,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    alignItems: 'center',
  },
  connectButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  walletCard: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1e7d1',
  },
  walletLabel: {
    fontSize: 12,
    color: '#6b8f6b',
  },
  walletAddress: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f5136',
    marginTop: 4,
  },
  card: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  statusBox: {
    marginHorizontal: 16,
    marginTop: 4,
    padding: 14,
    borderRadius: 12,
  },
  successBox: {
    backgroundColor: '#ecfdf5',
    borderColor: '#34d399',
    borderWidth: 1,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderColor: '#f87171',
    borderWidth: 1,
  },
  infoBox: {
    backgroundColor: '#eff6ff',
    borderColor: '#60a5fa',
    borderWidth: 1,
  },
  statusText: {
    color: '#0f172a',
  },
  donateButton: {
    padding: 16,
    margin: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  donateButtonDisabled: {
    backgroundColor: '#8aaa8a',
  },
  donateButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});
