/**
 * app/profile/[address].tsx
 * Donor profile screen — shows stats, badge tier, and donation history
 * for any Stellar address.
 */
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

interface Badge {
  tier: 'seedling' | 'tree' | 'forest' | 'earth';
  earnedAt: string;
}

interface DonorProfile {
  publicKey: string;
  displayName?: string;
  totalDonatedXLM: string;
  projectsSupported: number;
  badges: Badge[];
}

interface Donation {
  id: string;
  projectId: string;
  amount: string;
  currency: string;
  createdAt: string;
  message?: string;
}

const BADGE_CONFIG: Record<Badge['tier'], { icon: string; color: string; label: string }> = {
  seedling:  { icon: '🌱', color: '#4CAF50', label: 'Seedling'       },
  tree:      { icon: '🌳', color: '#2E7D32', label: 'Tree Planter'   },
  forest:    { icon: '🌲', color: '#1B5E20', label: 'Forest Guardian' },
  earth:     { icon: '🌍', color: '#0277BD', label: 'Earth Guardian'  },
};

function BadgePill({ tier }: { tier: Badge['tier'] }) {
  const cfg = BADGE_CONFIG[tier] ?? BADGE_CONFIG.seedling;
  return (
    <View style={[styles.badgePill, { backgroundColor: cfg.color }]}>
      <Text style={styles.badgeIcon}>{cfg.icon}</Text>
      <Text style={styles.badgeLabel}>{cfg.label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    loadProfile(address);
  }, [address]);

  const loadProfile = async (pk: string) => {
    try {
      const [profileRes, donationsRes] = await Promise.all([
        axios.get(`${API_URL}/api/profiles/${pk}`).catch(() => ({ data: { data: null } })),
        axios.get(`${API_URL}/api/donations/donor/${pk}`).catch(() => ({ data: { data: [] } })),
      ]);
      setProfile(profileRes.data.data);
      setDonations(donationsRes.data.data ?? []);
    } catch {
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#227239" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  const topBadge = profile?.badges?.[0];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        {topBadge && (
          <Text style={styles.headerBadgeIcon}>
            {BADGE_CONFIG[topBadge.tier]?.icon ?? '🌱'}
          </Text>
        )}
        <Text style={styles.displayName}>
          {profile?.displayName ?? 'Anonymous Donor'}
        </Text>
        <Text style={styles.address}>
          {address ? `${address.slice(0, 8)}...${address.slice(-4)}` : ''}
        </Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {profile ? parseFloat(profile.totalDonatedXLM).toFixed(2) : '0'}
          </Text>
          <Text style={styles.statLabel}>XLM Donated</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {profile?.projectsSupported ?? 0}
          </Text>
          <Text style={styles.statLabel}>Projects</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {profile?.badges?.length ?? 0}
          </Text>
          <Text style={styles.statLabel}>Badges</Text>
        </View>
      </View>

      {profile?.badges && profile.badges.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Badges Earned</Text>
          <View style={styles.badgesRow}>
            {profile.badges.map((badge) => (
              <BadgePill key={badge.tier} tier={badge.tier} />
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Donation History</Text>
        {donations.length === 0 ? (
          <Text style={styles.emptyText}>No donations yet</Text>
        ) : (
          donations.map((donation) => (
            <View key={donation.id} style={styles.donationRow}>
              <View style={styles.donationInfo}>
                <Text style={styles.donationProject}>
                  Project {donation.projectId.slice(0, 8)}
                </Text>
                {donation.message ? (
                  <Text style={styles.donationMessage}>"{donation.message}"</Text>
                ) : null}
                <Text style={styles.donationDate}>
                  {new Date(donation.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <Text style={styles.donationAmount}>
                {donation.currency === 'USDC'
                  ? `$${parseFloat(donation.amount).toFixed(2)} USDC`
                  : `${parseFloat(donation.amount).toFixed(2)} XLM`}
              </Text>
            </View>
          ))
        )}
      </View>
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
    backgroundColor: '#f0f7f0',
  },
  errorText: {
    fontSize: 16,
    color: '#c62828',
  },
  header: {
    backgroundColor: '#227239',
    padding: 24,
    alignItems: 'center',
  },
  headerBadgeIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  displayName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  address: {
    fontSize: 13,
    color: '#c8e6c9',
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#227239',
  },
  statLabel: {
    fontSize: 11,
    color: '#5a7a5a',
    marginTop: 3,
  },
  section: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a2e1a',
    marginBottom: 12,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  badgeIcon: {
    fontSize: 16,
  },
  badgeLabel: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  donationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e8f3e8',
  },
  donationInfo: {
    flex: 1,
    marginRight: 12,
  },
  donationProject: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a2e1a',
  },
  donationMessage: {
    fontSize: 12,
    color: '#5a7a5a',
    marginTop: 2,
    fontStyle: 'italic',
  },
  donationDate: {
    fontSize: 11,
    color: '#8aaa8a',
    marginTop: 2,
  },
  donationAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#227239',
  },
});
