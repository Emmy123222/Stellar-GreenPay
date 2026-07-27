import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import axios from 'axios';
import { useTheme } from './theme';
import {
  loadRecurringDonations,
  cancelRecurringDonation,
  type RecurringDonation,
} from '../utils/recurringDonations';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function DonationCard({
  donation,
  onCancel,
  colors,
}: {
  donation: RecurringDonation;
  onCancel: (id: string) => void;
  colors: ReturnType<typeof useTheme>['colors'];
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
    <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.projectName, { color: colors.primaryText }]} numberOfLines={1}>
          {donation.projectName}
        </Text>
        <Text style={[styles.amount, { color: colors.primary }]}>{donation.amountXLM} XLM/mo</Text>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.secondaryText }]}>Next payment</Text>
          <Text style={[styles.metaValue, { color: colors.primaryText }]}>{formatDate(donation.nextDueDate)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.secondaryText }]}>Duration</Text>
          <Text style={[styles.metaValue, { color: colors.primaryText }]}>{durationText}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7} accessibilityLabel={`Cancel recurring donation to ${donation.projectName}`} accessibilityRole="button">
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

function HistoryCard({
  donation,
  colors,
}: {
  donation: RecurringDonation;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const statusLabel = donation.status === 'cancelled' ? 'Cancelled' : 'Completed';
  const statusColor = donation.status === 'cancelled' ? '#c62828' : colors.secondaryText;

  return (
    <View style={[styles.historyRow, { borderBottomColor: colors.border }]}>
      <View style={styles.historyInfo}>
        <Text style={[styles.historyProject, { color: colors.primaryText }]}>
          {donation.projectName}
        </Text>
        <Text style={[styles.historyMeta, { color: colors.secondaryText }]}>
          {formatDate(donation.startDate)} &middot; {donation.remainingMonths !== null ? `${donation.remainingMonths} mo` : 'Ongoing'}
        </Text>
      </View>
      <View style={styles.historyRight}>
        <Text style={[styles.historyAmount, { color: colors.primary }]}>
          {donation.amountXLM} XLM/mo
        </Text>
        <Text style={[styles.historyStatus, { color: statusColor }]}>
          {statusLabel}
        </Text>
      </View>
    </View>
  );
}

export default function RecurringScreen() {
  const { colors } = useTheme();
  const [donations, setDonations] = useState<RecurringDonation[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/recurring-donations`, {
        params: { donorAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890' },
      });
      const data: RecurringDonation[] = res.data.data ?? [];
      setDonations(data);
    } catch {
      const all = await loadRecurringDonations();
      setDonations(all);
    }
    setLoading(false);
  }, []);

  useFocusEffect(refresh);

  const handleCancel = async (id: string) => {
    await cancelRecurringDonation(id);
    setDonations((prev) => prev.filter((d) => d.id !== id));
  };

  const active = donations.filter((d) => d.status === 'active');
  const history = donations.filter((d) => d.status === 'cancelled' || d.status === 'completed');

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <Text style={[styles.headerTitle, { color: colors.headerText }]}>Monthly Giving</Text>
        <Text style={[styles.headerSub, { color: colors.headerText, opacity: 0.8 }]}>Manage your recurring donations</Text>
      </View>

      {active.length === 0 && history.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🌱</Text>
          <Text style={[styles.emptyTitle, { color: colors.primaryText }]}>No recurring donations</Text>
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
            Set up a monthly donation from any project page to support ongoing impact.
          </Text>
        </View>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.primaryText }]}>
                Active ({active.length})
              </Text>
              {active.map((donation) => (
                <DonationCard key={donation.id} donation={donation} onCancel={handleCancel} colors={colors} />
              ))}
            </>
          )}

          {history.length > 0 && (
            <View style={[styles.historyCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <Text style={[styles.historyTitle, { color: colors.primaryText }]}>
                Payment History ({history.length})
              </Text>
              {history.map((donation) => (
                <HistoryCard key={donation.id} donation={donation} colors={colors} />
              ))}
            </View>
          )}
        </>
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
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 4,
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
    borderWidth: 1,
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
  historyCard: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    elevation: 2,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    borderWidth: 1,
  },
  historyTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 14,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  historyInfo: {
    flex: 1,
  },
  historyProject: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  historyMeta: {
    fontSize: 12,
  },
  historyRight: {
    alignItems: 'flex-end',
  },
  historyAmount: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  historyStatus: {
    fontSize: 12,
    marginTop: 2,
  },
});