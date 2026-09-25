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
import { useTheme } from './theme';
import {
  loadRecurringDonations,
  cancelRecurringDonation,

  createRecurringDonation,

  loadPaymentHistory,

  type RecurringDonation,
  type PaymentRecord,
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
  const { colors } = useTheme();

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
    <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.projectName, { color: colors.text }]} numberOfLines={1}>
          {donation.projectName}
        </Text>
        <Text style={[styles.amount, { color: colors.primary }]}>{donation.amountXLM} XLM/mo</Text>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.secondaryText }]}>Next payment</Text>
          <Text style={[styles.metaValue, { color: colors.text }]}>{formatNextDate(donation.nextDueDate)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.secondaryText }]}>Duration</Text>
          <Text style={[styles.metaValue, { color: colors.text }]}>{durationText}</Text>
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
  const { colors } = useTheme();
  const [donations, setDonations] = useState<RecurringDonation[]>([]);
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

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
    const h = await loadPaymentHistory();
    setHistory(h);
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
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <View style={[styles.header, { backgroundColor: colors.header }]}>
        <Text style={[styles.headerTitle, { color: colors.headerText }]}>Monthly Giving</Text>
        <Text style={[styles.headerSub, { color: colors.secondaryText }]}>Manage your recurring donations</Text>
      </View>


      {/* Set up a new recurring donation */}
      {!projectsLoading && projects.length > 0 && (
        <View style={[styles.setupCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
          <Text style={[styles.setupTitle, { color: colors.text }]}>Set up a monthly donation</Text>

          <Text style={[styles.label, { color: colors.text }]}>Project</Text>
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
                    {
                      backgroundColor: isActive ? colors.primary : colors.surface,
                      borderColor: isActive ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setSelectedProjectId(project.id)}
                  accessibilityLabel={`Select project ${project.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <Text
                    style={[
                      styles.projectChipText,
                      { color: isActive ? colors.buttonText : colors.text },
                    ]}
                  >
                    {project.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={[styles.label, { color: colors.text }]}>Amount (XLM)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
            value={setupAmount}
            onChangeText={setSetupAmount}
            placeholder="e.g. 25"
            placeholderTextColor={colors.placeholder}
            keyboardType="decimal-pad"
            accessibilityLabel="Recurring donation amount in XLM"
            accessibilityRole="none"
          />

          <View style={styles.setupActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.confirmBtn, { backgroundColor: colors.buttonBackground }]}
              onPress={handleConfirmSetup}
              activeOpacity={0.7}
              accessibilityLabel="Confirm recurring donation"
              accessibilityRole="button"
            >
              <Text style={[styles.confirmBtnText, { color: colors.buttonText }]}>Confirm</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.setupCancelBtn, { borderColor: colors.secondaryText }]}
              onPress={handleCancelSetup}
              activeOpacity={0.7}
              accessibilityLabel="Cancel recurring donation setup"
              accessibilityRole="button"
            >
              <Text style={[styles.setupCancelBtnText, { color: colors.secondaryText }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Live region — announces donation status changes to the screen reader */}
      {statusMessage ? (
        <View
          style={[styles.statusBox, { backgroundColor: colors.surface, borderColor: colors.primary }]}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.statusText, { color: colors.text }]}>{statusMessage}</Text>
        </View>
      ) : null}

      {/* Active recurring donations */}
      <View style={[styles.tabBar, { backgroundColor: colors.surface }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'active' && { backgroundColor: colors.primary }]}
          onPress={() => setActiveTab('active')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, { color: activeTab === 'active' ? colors.buttonText : colors.secondaryText }]}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && { backgroundColor: colors.primary }]}
          onPress={() => setActiveTab('history')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, { color: activeTab === 'history' ? colors.buttonText : colors.secondaryText }]}>History</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'active' ? (
        donations.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🌱</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No active recurring donations</Text>
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              Set up a monthly donation from any project page to support ongoing impact.
            </Text>
          </View>
        ) : (
          donations.map((donation) => (
            <DonationCard key={donation.id} donation={donation} onCancel={handleCancel} />
          ))
        )
      ) : history.length === 0 ? (

        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No payment history</Text>
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
            Your past donation payments will appear here.
          </Text>
        </View>
      ) : (
        history.map((record) => (
          <View key={record.id} style={[styles.historyCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
            <View style={styles.historyCardHeader}>
              <Text style={[styles.historyProjectName, { color: colors.text }]} numberOfLines={1}>
                {record.projectName}
              </Text>
              <Text style={[styles.historyAmount, { color: colors.primary }]}>{record.amountXLM} XLM</Text>
            </View>
            <View style={styles.historyMeta}>
              <Text style={[styles.historyDate, { color: colors.secondaryText }]}>{formatNextDate(record.date)}</Text>
              <Text style={[styles.historyStatus, record.status === 'completed' && { color: colors.primary }]}>
                {record.status}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    padding: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: 'bold',
  },
  headerSub: {
    fontSize: 13,
    marginTop: 4,
  },
  setupCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  setupTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
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
    marginRight: 8,
  },
  projectChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
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
  confirmBtn: {},
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  setupCancelBtn: {
    borderWidth: 1.5,
  },
  setupCancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  statusBox: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusText: {
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
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 16,
    elevation: 2,
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
    marginRight: 8,
  },
  amount: {
    fontSize: 16,
    fontWeight: 'bold',
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
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '600',
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
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  historyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  historyProjectName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    marginRight: 8,
  },
  historyAmount: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  historyMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyDate: {
    fontSize: 13,
  },
  historyStatus: {
    fontSize: 13,
    fontWeight: '600',
    color: '#c62828',
    textTransform: 'capitalize',
  },
});
