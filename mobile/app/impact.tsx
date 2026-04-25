/**
 * app/impact.tsx
 * My Impact screen - donor stats and history
 */
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

interface Donation {
  id: string;
  projectId: string;
  amount: string;
  currency: string;
  createdAt: string;
  message?: string;
}

interface DonorProfile {
  publicKey: string;
  displayName?: string;
  totalDonatedXLM: string;
  projectsSupported: number;
  badges: any[];
}

export default function ImpactScreen() {
  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [loading, setLoading] = useState(true);
  const [publicKey, setPublicKey] = useState('');

  // For demo purposes, using a hardcoded key
  // In production, this would come from wallet connection
  useEffect(() => {
    const demoKey = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
    setPublicKey(demoKey);
    loadImpactData(demoKey);
  }, []);

  const loadImpactData = async (pk: string) => {
    try {
      const [profileRes, donationsRes] = await Promise.all([
        axios.get(`${API_URL}/api/profiles/${pk}`).catch(() => ({ data: { data: null } })),
        axios.get(`${API_URL}/api/donations/donor/${pk}`).catch(() => ({ data: { data: [] } })),
      ]);
      setProfile(profileRes.data.data);
      setDonations(donationsRes.data.data);
    } catch (error) {
      console.error('Error loading impact data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading your impact...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Impact</Text>
        <Text style={styles.subtitle}>{publicKey.slice(0, 8)}...{publicKey.slice(-4)}</Text>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statIcon}>💚</Text>
          <Text style={styles.statValue}>
            {profile ? parseFloat(profile.totalDonatedXLM).toFixed(2) : '0'}
          </Text>
          <Text style={styles.statLabel}>XLM Donated</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statIcon}>🌍</Text>
          <Text style={styles.statValue}>
            {profile ? profile.projectsSupported : 0}
          </Text>
          <Text style={styles.statLabel}>Projects</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statIcon}>🏆</Text>
          <Text style={styles.statValue}>
            {profile ? profile.badges.length : 0}
          </Text>
          <Text style={styles.statLabel}>Badges</Text>
        </View>
      </View>

      <View style={styles.historyCard}>
        <Text style={styles.sectionTitle}>Donation History</Text>
        {donations.length === 0 ? (
          <Text style={styles.emptyText}>No donations yet</Text>
        ) : (
          donations.map(donation => (
            <View key={donation.id} style={styles.donationRow}>
              <View style={styles.donationInfo}>
                <Text style={styles.donationProject}>Project {donation.projectId.slice(0, 8)}</Text>
                {donation.message && (
                  <Text style={styles.donationMessage}>"{donation.message}"</Text>
                )}
              </View>
              <View style={styles.donationAmount}>
                <Text style={styles.amount}>
                  {donation.currency === 'USDC'
                    ? `$${parseFloat(donation.amount).toFixed(2)} USDC`
                    : `${parseFloat(donation.amount).toFixed(2)} XLM`}
                </Text>
                <Text style={styles.date}>
                  {new Date(donation.createdAt).toLocaleDateString()}
                </Text>
              </View>
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
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#e8f3e8',
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#227239',
  },
  statLabel: {
    fontSize: 12,
    color: '#8aaa8a',
    marginTop: 4,
  },
  historyCard: {
    margin: 16,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a2e1a',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#5a7a5a',
    textAlign: 'center',
    paddingVertical: 20,
  },
  donationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e8f3e8',
  },
  donationInfo: {
    flex: 1,
  },
  donationProject: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a2e1a',
  },
  donationMessage: {
    fontSize: 12,
    color: '#5a7a5a',
    marginTop: 2,
  },
  donationAmount: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#227239',
  },
  date: {
    fontSize: 10,
    color: '#8aaa8a',
    marginTop: 2,
  },
});
