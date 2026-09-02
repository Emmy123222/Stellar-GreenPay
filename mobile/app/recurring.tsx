/**
 * app/recurring.tsx
 * Monthly recurring donation management screen.
 * Lists active recurring donations stored in AsyncStorage and allows
 * the user to cancel individual entries.
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
import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import axios from 'axios';
import {
  loadRecurringDonations,
  createRecurringDonation,
  cancelRecurringDonation,
  type RecurringDonation,
} from '../utils/recurringDonations';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const MIN_RECURRING_AMOUNT_XLM = 1;
const RECURRING_ERROR_MESSAGE = 'Minimum recurring donation is 1 XLM';

interface ClimateProject {
  id: string;
  name: string;
}

function formatNextDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function DonationCard({
  donation,
  onCancel,
}: {
  donation: RecurringDonation;
  onCancel: (id: string) => void;
}) {
  const handleCancel = () => {
    Alert.alert(
      'Cancel Recurring Donation',
      `Stop the monthly ${donation.amountXLM} XLM donation to ${donation.projectName}?`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel donation',
          style: 'destructive',
          onPress: () => onCancel(donation.id),
        },
      ],
    );
  };

  const durationText =
    donation.remainingMonths !== null
      ? `${donation.remainingMonths} month${donation.remainingMonths !== 1 ? 's' : ''} remaining`
      : 'Ongoing';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.projectName} numberOfLines={1}>
          {donation.projectName}
        </Text>
        <Text style={styles.amount}>{donation.amountXLM} XLM/mo</Text>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Next payment</Text>
          <Text style={styles.metaValue}>{formatNextDate(donation.nextDueDate)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Duration</Text>
          <Text style={styles.metaValue}>{durationText}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7} accessibilityLabel={`Cancel recurring donation to ${donation.projectName}`} accessibilityRole="button">
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function RecurringScreen() {
  const [donations, setDonations] = useState<RecurringDonation[]>([]);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [amountXLM, setAmountXLM] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const amount = parseFloat(amountXLM);
  const amountValid = amountXLM !== '' && !isNaN(amount) && amount >= MIN_RECURRING_AMOUNT_XLM;

  const refresh = useCallback(async () => {
    setLoading(true);
    const all = await loadRecurringDonations();
    setDonations(all.filter((d) => d.status === 'active'));
    setLoading(false);
  }, []);

  useFocusEffect(refresh);

  useEffect(() => {
    if (showForm && projects.length === 0) {
      axios
        .get(`${API_URL}/api/projects`)
        .then((res) => {
          const list: ClimateProject[] = Array.isArray(res.data?.data) ? res.data.data : [];
          setProjects(list);
          if (list.length > 0 && !selectedProjectId) {
            setSelectedProjectId(list[0].id);
          }
        })
        .catch(() => {});
    }
  }, [showForm]);

  const handleCancel = async (id: string) => {
    await cancelRecurringDonation(id);
    setDonations((prev) => prev.filter((d) => d.id !== id));
  };

  const handleCreate = async () => {
    if (!amountValid || !selectedProjectId) return;

    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project) return;

    setCreating(true);
    try {
      await createRecurringDonation({
        projectId: selectedProjectId,
        projectName: project.name,
        amountXLM: amount.toFixed(7),
        durationMonths: null,
      });
      setShowForm(false);
      setAmountXLM('');
      await refresh();
    } catch {
      Alert.alert('Error', 'Failed to create recurring donation. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  if (loading && !showForm) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#227239" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Monthly Giving</Text>
        <Text style={styles.headerSub}>Manage your recurring donations</Text>
      </View>

      {!showForm && (
        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => setShowForm(true)}
          activeOpacity={0.7}
          accessibilityLabel="Set up a new recurring donation"
          accessibilityRole="button"
          testID="create-recurring-button"
        >
          <Text style={styles.createBtnText}>+ New Recurring Donation</Text>
        </TouchableOpacity>
      )}

      {showForm && (
        <View style={styles.formCard} testID="recurring-form">
          <Text style={styles.formTitle}>New Recurring Donation</Text>

          <Text style={styles.label}>Project</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectRow}>
            {projects.map((project) => {
              const isActive = project.id === selectedProjectId;
              return (
                <TouchableOpacity
                  key={project.id}
                  style={[styles.projectChip, isActive && styles.projectChipActive]}
                  onPress={() => setSelectedProjectId(project.id)}
                  accessibilityLabel={`Select ${project.name}`}
                  accessibilityRole="button"
                >
                  <Text style={[styles.projectChipText, isActive && styles.projectChipTextActive]}>
                    {project.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.label}>Amount (XLM)</Text>
          <TextInput
            style={[styles.input, !amountValid && amountXLM !== '' && styles.inputError]}
            placeholder="e.g. 10"
            placeholderTextColor="#8aaa8a"
            value={amountXLM}
            onChangeText={setAmountXLM}
            keyboardType="decimal-pad"
            accessibilityLabel="Recurring donation amount in XLM"
            testID="recurring-amount-input"
          />

          {!amountValid && amountXLM !== '' && (
            <Text style={styles.errorText} testID="recurring-amount-error">
              {RECURRING_ERROR_MESSAGE}
            </Text>
          )}

          <View style={styles.formActions}>
            <TouchableOpacity
              style={styles.cancelFormBtn}
              onPress={() => { setShowForm(false); setAmountXLM(''); }}
              activeOpacity={0.7}
              accessibilityLabel="Cancel creating recurring donation"
              accessibilityRole="button"
            >
              <Text style={styles.cancelFormBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, (!amountValid || creating) && styles.submitBtnDisabled]}
              onPress={handleCreate}
              disabled={!amountValid || creating}
              activeOpacity={0.7}
              accessibilityLabel="Save recurring donation"
              accessibilityRole="button"
              testID="recurring-submit-button"
            >
              {creating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {donations.length === 0 && !showForm ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🌱</Text>
          <Text style={styles.emptyTitle}>No active recurring donations</Text>
          <Text style={styles.emptyText}>
            Set up a monthly donation to support ongoing impact.
          </Text>
        </View>
      ) : (
        donations.map((donation) => (
          <DonationCard key={donation.id} donation={donation} onCancel={handleCancel} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f7f0',
  },
  content: {
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#227239',
    padding: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSub: {
    fontSize: 13,
    color: '#c8e6c9',
    marginTop: 4,
  },
  createBtn: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#227239',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  createBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  formCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a2e1a',
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a2e1a',
    marginBottom: 8,
  },
  projectRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  projectChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d8e4d8',
    backgroundColor: '#f0f7f0',
    marginRight: 8,
  },
  projectChipActive: {
    backgroundColor: '#227239',
    borderColor: '#227239',
  },
  projectChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a2e1a',
  },
  projectChipTextActive: {
    color: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d8e4d8',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#1a2e1a',
    backgroundColor: '#fff',
  },
  inputError: {
    borderColor: '#c62828',
  },
  errorText: {
    color: '#c62828',
    fontSize: 13,
    marginTop: 6,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  cancelFormBtn: {
    borderWidth: 1.5,
    borderColor: '#d8e4d8',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  cancelFormBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5a7a5a',
  },
  submitBtn: {
    backgroundColor: '#227239',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignItems: 'center',
    minWidth: 80,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a2e1a',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#5a7a5a',
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  projectName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a2e1a',
    marginRight: 8,
  },
  amount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#227239',
  },
  cardBody: {
    gap: 6,
    marginBottom: 14,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaLabel: {
    fontSize: 13,
    color: '#5a7a5a',
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a2e1a',
  },
  cancelBtn: {
    borderWidth: 1.5,
    borderColor: '#c62828',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#c62828',
  },
});
