/**
 * app/donate/[id].tsx
 *
 * Donate screen with project selector, amount input, biometric-protected
 * transaction submission.
 *
 * Security gate (issue #481): before signing and submitting any Stellar
 * (Soroban) payment transaction, we require a successful biometric
 * authentication via `useBiometricAuth()`. When the device has no
 * biometric hardware or the user hasn't enrolled, the hook falls back to
 * the device PIN/passcode prompt. If the user can't or won't authenticate
 * we surface a clear inline status message and abort submission — we
 * never sign a transaction without an explicit user confirmation.
 */
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Keypair,
  Server,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  Memo,
} from '@stellar/stellar-sdk';
import { useBiometricAuth } from '../../hooks/useBiometricAuth';
import type { BiometricAuthOutcome } from '../../hooks/useBiometricAuth';
import { useTheme } from '../theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const HORIZON_URL =
  process.env.EXPO_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';

const PRESET_AMOUNTS = ['5', '10', '25'];
const MIN_AMOUNT_XLM = 1;
const DONATE_PROMPT = 'Authenticate to send your donation';

interface ClimateProject {
  id: string;
  name: string;
  description: string;
  walletAddress: string;
}

type StatusKind = 'success' | 'error' | 'info' | null;

/**
 * Render-time hint shown above the Donate button. Reassures the user
 * that we'll either prompt for biometrics or fall back to their device
 * PIN/passcode — we never sign a transaction silently.
 */
function buildBioHint(
  available: boolean,
  enrolled: boolean,
  label: string
): string {
  if (!available) return 'No biometric sensor — donations will require your device PIN.';
  if (!enrolled) return 'No biometric enrolled — donations will require your device PIN.';
  return `You will be asked to authenticate with ${label} before signing.`;
}

export default function DonateScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams();

  const bio = useBiometricAuth();
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(
    id as string | undefined
  );
  const [amount, setAmount] = useState('1');
  const [message, setMessage] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<StatusKind>(null);

  useEffect(() => {
    loadProjects();
  }, [id]);

  const loadProjects = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await axios.get(`${API_URL}/api/projects`);
      const list: ClimateProject[] = Array.isArray(res.data?.data) ? res.data.data : [];
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

  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) || projects[0] || null;

  /**
   * Map a biometric auth outcome to a user-facing status message.
   */
  const surfaceAuthFailure = (outcome: BiometricAuthOutcome) => {
    switch (outcome) {
      case 'cancel':
        setStatusType('info');
        setStatusMessage('Authentication cancelled — donation not sent.');
        return;
      case 'fallback':
        setStatusType('info');
        setStatusMessage('Use your device PIN to confirm the donation next time.');
        return;
      case 'error':
        setStatusType('error');
        setStatusMessage(
          'Biometric authentication failed. Please try again or tap "Use Passcode" / "Cancel" and retry.'
        );
        return;
      default:
        setStatusType('error');
        setStatusMessage('Authentication required to send a donation.');
    }
  };

  const handleDonate = async () => {
    setStatusMessage(null);
    setStatusType(null);

    if (!selectedProject) {
      Alert.alert('Error', 'Please choose a project to donate to.');
      return;
    }

    const donationAmount = parseFloat(amount);
    if (!amount || Number.isNaN(donationAmount) || donationAmount < MIN_AMOUNT_XLM) {
      Alert.alert(
        'Error',
        `Please enter a valid amount (minimum ${MIN_AMOUNT_XLM} XLM).`
      );
      return;
    }

    if (!publicKey) {
      Alert.alert('Wallet Required', 'Please connect your Stellar wallet first.');
      return;
    }

    if (!secretKey.trim()) {
      Alert.alert(
        'Secret Required',
        'Please enter your Stellar secret key to sign the transaction.'
      );
      return;
    }

    let keypair;
    try {
      keypair = Keypair.fromSecret(secretKey.trim());
    } catch {
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

    /**
     * Issue #481: require biometric (or device-PIN) confirmation before
     * signing any Soroban / Stellar transaction. The hook also gracefully
     * handles devices that don't have biometric hardware — it drops
     * straight to the device PIN prompt. If the user navigates away
     * mid-prompt the `isMountedRef` guard prevents setState-after-unmount
     * noise.
     */
    const authResult = await bio.authenticate(DONATE_PROMPT);
    if (!isMountedRef.current) return;

    if (!authResult.success) {
      surfaceAuthFailure(authResult.outcome);
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
        error?.response?.data?.message ||
          error?.message ||
          'Donation failed. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const connectWallet = () => {
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
        <ActivityIndicator size="large" color={colors.primary ?? '#227239'} />
        <Text style={[styles.loadingText, { color: colors.primaryText }]}>
          Loading project...
        </Text>
      </View>
    );
  }

  const bioHint = buildBioHint(bio.available, bio.enrolled, bio.label);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.primaryText }]}>
          Donate to {selectedProject?.name || 'a project'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
          Choose a project and donate XLM on testnet.
        </Text>
      </View>

      <View style={styles.selectorCard}>
        <Text style={[styles.sectionTitle, { color: colors.primaryText }]}>
          Select a project
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.projectList}
        >
          {projects.map((project) => (
            <TouchableOpacity
              key={project.id}
              style={[
                styles.projectOption,
                {
                  backgroundColor:
                    project.id === selectedProjectId
                      ? colors.primary
                      : colors.surface,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => setSelectedProjectId(project.id)}
            >
              <Text
                style={[
                  styles.projectOptionText,
                  {
                    color:
                      project.id === selectedProjectId
                        ? colors.buttonText
                        : colors.primaryText,
                  },
                ]}
              >
                {project.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {!publicKey ? (
        <TouchableOpacity
          style={[
            styles.connectButton,
            { backgroundColor: colors.buttonBackground },
          ]}
          onPress={connectWallet}
        >
          <Text style={[styles.connectButtonText, { color: colors.buttonText }]}>
            Connect Wallet
          </Text>
        </TouchableOpacity>
      ) : (
        <View
          style={[
            styles.walletCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.cardBorder,
            },
          ]}
        >
          <Text style={[styles.walletLabel, { color: colors.secondaryText }]}>
            Connected wallet
          </Text>
          <Text style={[styles.walletAddress, { color: colors.primaryText }]}>
            {publicKey.slice(0, 8)}...{publicKey.slice(-4)}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.cardBorder },
        ]}
      >
        <Text style={[styles.label, { color: colors.primaryText }]}>Amount (XLM)</Text>
        <View style={styles.presetRow}>
          {PRESET_AMOUNTS.map((preset) => {
            const isActive = amount === preset;
            return (
              <TouchableOpacity
                key={preset}
                accessibilityRole="button"
                accessibilityLabel={`Donate ${preset} XLM`}
                style={[
                  styles.presetChip,
                  {
                    backgroundColor: isActive ? colors.primary : colors.surface,
                    borderColor: isActive ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setAmount(preset)}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    {
                      color: isActive ? colors.buttonText : colors.primaryText,
                    },
                  ]}
                >
                  {preset} XLM
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.primaryText,
            },
          ]}
          placeholder="Custom amount"
          placeholderTextColor={colors.placeholder}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          accessibilityLabel="Custom donation amount in XLM"
        />

        <Text style={[styles.label, { color: colors.primaryText }]}>Secret Key</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.primaryText,
            },
          ]}
          placeholder="S..."
          placeholderTextColor={colors.placeholder}
          value={secretKey}
          onChangeText={setSecretKey}
          autoCapitalize="none"
          secureTextEntry
          accessibilityLabel="Stellar secret key for signing"
        />

        <Text style={[styles.label, { color: colors.primaryText }]}>
          Message (optional)
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.primaryText,
            },
          ]}
          placeholder="Leave a message of support..."
          placeholderTextColor={colors.placeholder}
          value={message}
          onChangeText={setMessage}
          maxLength={100}
          accessibilityLabel="Optional donation message"
        />

        <View style={styles.bioHintRow}>
          <Text style={styles.bioHintIcon} accessibilityElementsHidden>
            🔒
          </Text>
          <Text style={[styles.bioHintText, { color: colors.secondaryText }]}>
            {bioHint}
          </Text>
        </View>
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
        style={[
          styles.donateButton,
          {
            backgroundColor:
              submitting || !publicKey || bio.isAuthenticating
                ? colors.muted
                : colors.buttonBackground,
          },
        ]}
        onPress={handleDonate}
        disabled={submitting || !publicKey || bio.isAuthenticating}
        accessibilityRole="button"
        accessibilityLabel={`Donate ${amount || '1'} XLM`}
      >
        {bio.isAuthenticating ? (
          <ActivityIndicator color={colors.buttonText} />
        ) : (
          <Text style={[styles.donateButtonText, { color: colors.buttonText }]}>
            {submitting ? 'Sending donation...' : `🌱 Donate ${amount || '1'} XLM`}
          </Text>
        )}
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
  selectorCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  projectList: {
    flexDirection: 'row',
  },
  projectOption: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
  },
  projectOptionText: {
    fontSize: 14,
    fontWeight: '600',
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
  },
  walletLabel: {
    fontSize: 12,
  },
  walletAddress: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  card: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  presetRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
  presetChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  presetChipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  bioHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  bioHintIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  bioHintText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
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
  donateButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});
