/**
 * app/recurring.tsx
 * Monthly recurring donation management screen.
 * Lists active recurring donations stored in AsyncStorage and allows
 * the user to set up new ones or cancel individual entries.
 *
 * Accessibility (#485):
 *  - Every touchable element (project chip, Confirm / Cancel buttons,
 *    per-donation Cancel button) carries a non-empty accessibilityLabel
 *    and a sensible accessibilityRole.
 *  - The amount field exposes a numeric, non-announced role so screen
 *    readers treat it as a plain numeric text field.
 *  - The "Cancel" control in the setup form is labelled distinctly from
 *    the "Confirm" control so screen-reader users never confuse the two.
 *  - Donation status changes (set up / cancelled) are announced to the
 *    screen reader via an accessibilityRole="alert" live region.
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
import { useEffect, useRef, useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import axios from 'axios';
import {
  loadRecurringDonations,
  cancelRecurringDonation,
  createRecurringDonation,
  type RecurringDonation,
} from '../utils/recurringDonations';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const MIN_AMOUNT_XLM = 1;

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

      <TouchableOpacity
        style={styles.cancelBtn}
        onPress={handleCancel}
        activeOpacity={0.7}
        accessibilityLabel={`Cancel recurring donation to ${donation.projectName}`}
        accessibilityRole="button"
      >
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function RecurringScreen() {
  const [donations, setDonations] = useState<RecurringDonation[]>([]);
  const [loading, setLoading] = useState(true);

  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [setupAmount, setSetupAmount] = useState('');

  // Donation status change, announced to screen readers as a live region.
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Guard so the initial load only runs once, even if the focus callback is
  // invoked repeatedly (e.g. under test mocks). List mutations after setup /
  // cancel update `donations` directly rather than re-fetching.
  const hasLoadedRef = useRef(false);

  const loadData = useCallback(async () => {
    const all = await loadRecurringDonations();
    setDonations(all.filter((d) => d.status === 'active'));
    setLoading(false);
  }, []);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/projects`);
      const list: ClimateProject[] = Array.isArray(res.data?.data) ? res.data.data : [];
      setProjects(list);
      setSelectedProjectId((prev) => prev ?? list[0]?.id);
    } catch {
      // Non-critical — the setup form is hidden when no projects are available.
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (hasLoadedRef.current) return;
      hasLoadedRef.current = true;
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCancel = async (id: string) => {
    await cancelRecurringDonation(id);
    setDonations((prev) => prev.filter((d) => d.id !== id));
    setStatusMessage('Recurring donation cancelled.');
  };

  const handleConfirmSetup = async () => {
    const amountNum = parseFloat(setupAmount);
    if (!setupAmount || Number.isNaN(amountNum) || amountNum < MIN_AMOUNT_XLM) {
      Alert.alert(
        'Invalid Amount',
        `Please enter a valid amount (minimum ${MIN_AMOUNT_XLM} XLM).`
      );
      return;
    }

    const project =
      projects.find((p) => p.id === selectedProjectId) || projects[0];
    if (!project) {
      Alert.alert('No Project', 'Please choose a project for the recurring donation.');
      return;
    }

    const created = await createRecurringDonation({
      projectId: project.id,
      projectName: project.name,
      amountXLM: setupAmount,
      durationMonths: null,
    });

    setDonations((prev) => [created, ...prev]);
    setSetupAmount('');
    setStatusMessage(
      `Recurring donation of ${setupAmount} XLM to ${project.name} set up.`
    );
  };

  const handleCancelSetup = () => {
    setSetupAmount('');
    setStatusMessage(null);
  };

  if (loading) {
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

      {/* Set up a new recurring donation */}
      {!projectsLoading && projects.length > 0 && (
        <View style={styles.setupCard}>
          <Text style={styles.setupTitle}>Set up a monthly donation</Text>

          <Text style={styles.label}>Project</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.projectList}
          >
            {projects.map((project) => {
              const isActive = project.id === selectedProjectId;
              return (
                <TouchableOpacity
                  key={project.id}
                  style={[
                    styles.projectChip,
                    isActive && styles.projectChipActive,
                  ]}
                  onPress={() => setSelectedProjectId(project.id)}
                  accessibilityLabel={`Select project ${project.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <Text
                    style={[
                      styles.projectChipText,
                      isActive && styles.projectChipTextActive,
                    ]}
                  >
                    {project.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.label}>Amount (XLM)</Text>
          <TextInput
            style={styles.input}
            value={setupAmount}
            onChangeText={setSetupAmount}
            placeholder="e.g. 25"
            placeholderTextColor="#8aaa8a"
            keyboardType="decimal-pad"
            accessibilityLabel="Recurring donation amount in XLM"
            accessibilityRole="none"
          />

          <View style={styles.setupActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.confirmBtn]}
              onPress={handleConfirmSetup}
              activeOpacity={0.7}
              accessibilityLabel="Confirm recurring donation"
              accessibilityRole="button"
            >
              <Text style={styles.confirmBtnText}>Confirm</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.setupCancelBtn]}
              onPress={handleCancelSetup}
              activeOpacity={0.7}
              accessibilityLabel="Cancel recurring donation setup"
              accessibilityRole="button"
            >
              <Text style={styles.setupCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Live region — announces donation status changes to the screen reader */}
      {statusMessage ? (
        <View
          style={styles.statusBox}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
      ) : null}

      {/* Active recurring donations */}
      {donations.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🌱</Text>
          <Text style={styles.emptyTitle}>No active recurring donations</Text>
          <Text style={styles.emptyText}>
            Set up a monthly donation from any project page to support ongoing impact.
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
  setupCard: {
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
  setupTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a2e1a',
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a2e1a',
    marginBottom: 6,
    marginTop: 4,
  },
  projectList: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  projectChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d8e4d8',
    backgroundColor: '#fff',
    marginRight: 8,
  },
  projectChipActive: {
    backgroundColor: '#227239',
    borderColor: '#227239',
  },
  projectChipText: {
    fontSize: 13,
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
    marginBottom: 14,
  },
  setupActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  confirmBtn: {
    backgroundColor: '#227239',
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  setupCancelBtn: {
    borderWidth: 1.5,
    borderColor: '#5a7a5a',
  },
  setupCancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#5a7a5a',
  },
  statusBox: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    borderColor: '#34d399',
    borderWidth: 1,
  },
  statusText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '600',
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
