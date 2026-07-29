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
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  loadRecurringDonations,
  cancelRecurringDonation,
  loadPaymentHistory,
  type RecurringDonation,
  type PaymentRecord,
} from '../utils/recurringDonations';

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
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

  const refresh = useCallback(async () => {
    setLoading(true);
    const all = await loadRecurringDonations();
    setDonations(all.filter((d) => d.status === 'active'));
    const h = await loadPaymentHistory();
    setHistory(h);
    setLoading(false);
  }, []);

  useFocusEffect(refresh);

  const handleCancel = async (id: string) => {
    await cancelRecurringDonation(id);
    setDonations((prev) => prev.filter((d) => d.id !== id));
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

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'active' && styles.tabActive]}
          onPress={() => setActiveTab('active')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === 'active' && styles.tabTextActive]}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && styles.tabActive]}
          onPress={() => setActiveTab('history')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>History</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'active' ? (
        donations.length === 0 ? (
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
        )
      ) : history.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No payment history</Text>
          <Text style={styles.emptyText}>
            Your past donation payments will appear here.
          </Text>
        </View>
      ) : (
        history.map((record) => (
          <View key={record.id} style={styles.historyCard}>
            <View style={styles.historyCardHeader}>
              <Text style={styles.historyProjectName} numberOfLines={1}>
                {record.projectName}
              </Text>
              <Text style={styles.historyAmount}>{record.amountXLM} XLM</Text>
            </View>
            <View style={styles.historyMeta}>
              <Text style={styles.historyDate}>{formatNextDate(record.date)}</Text>
              <Text style={[styles.historyStatus, record.status === 'completed' && styles.historyStatusSuccess]}>
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
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#227239',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5a7a5a',
  },
  tabTextActive: {
    color: '#fff',
  },
  historyCard: {
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
    color: '#1a2e1a',
    marginRight: 8,
  },
  historyAmount: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#227239',
  },
  historyMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyDate: {
    fontSize: 13,
    color: '#5a7a5a',
  },
  historyStatus: {
    fontSize: 13,
    fontWeight: '600',
    color: '#c62828',
    textTransform: 'capitalize',
  },
  historyStatusSuccess: {
    color: '#227239',
  },
});
