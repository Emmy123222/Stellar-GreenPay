/**
 * app/impact.tsx
 * My Impact screen - donor stats, history, and shareable certificate
 */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useTheme } from './theme';

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

interface ImpactStats {
  co2OffsetKg: number;
  projectsSupported: number;
}

export default function ImpactScreen() {
  const { colors } = useTheme();
  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [impactStats, setImpactStats] = useState<ImpactStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [publicKey, setPublicKey] = useState('');
  const certificateRef = useRef<any>(null);

  useEffect(() => {
    const demoKey = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
    setPublicKey(demoKey);
    loadImpactData(demoKey);
  }, []);

  const loadImpactData = async (pk: string) => {
    try {
      const [profileRes, donationsRes, impactRes] = await Promise.all([
        axios.get(`${API_URL}/api/profiles/${pk}`).catch(() => ({ data: { data: null } })),
        axios.get(`${API_URL}/api/donations/donor/${pk}`).catch(() => ({ data: { data: [] } })),
        axios.get(`${API_URL}/api/impact/donor/${pk}`).catch(() => ({ data: { data: null } })),
      ]);
      setProfile(profileRes.data.data);
      setDonations(donationsRes.data.data);
      setImpactStats(impactRes.data.data);
    } catch (error) {
      console.error('Error loading impact data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      const uri = await captureRef(certificateRef, { format: 'png', quality: 1.0 });
      // Prefix with file:// for Android compatibility
      const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
      await Sharing.shareAsync(fileUri, {
        mimeType: 'image/png',
        dialogTitle: 'Share your impact certificate',
      });
    } catch (err) {
      console.error('Share failed:', err);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.secondaryText }]}>Loading your impact...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <Text style={[styles.title, { color: colors.headerText }]}>My Impact</Text>
        <Text style={[styles.subtitle, { color: colors.headerText }]}>{publicKey.slice(0, 8)}...{publicKey.slice(-4)}</Text>
      </View>

      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
          <Text style={[styles.statIcon, { color: colors.accent }]}>💚</Text>
          <Text style={[styles.statValue, { color: colors.accent }]}>
            {profile ? parseFloat(profile.totalDonatedXLM).toFixed(2) : '0'}
          </Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>XLM Donated</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
          <Text style={[styles.statIcon, { color: colors.accent }]}>🌍</Text>
          <Text style={[styles.statValue, { color: colors.accent }]}>
            {profile ? profile.projectsSupported : 0}
          </Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Projects</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
          <Text style={[styles.statIcon, { color: colors.accent }]}>🏆</Text>
          <Text style={[styles.statValue, { color: colors.accent }]}>
            {profile ? profile.badges.length : 0}
          </Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Badges</Text>
        </View>
      </View>

      <View style={[styles.historyCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
        <Text style={[styles.sectionTitle, { color: colors.primaryText }]}>Donation History</Text>
        {donations.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No donations yet</Text>
        ) : (
          donations.map(donation => (
            <View key={donation.id} style={[styles.donationRow, { borderBottomColor: colors.border }]}>
              <View style={styles.donationInfo}>
                <Text style={[styles.donationProject, { color: colors.primaryText }]}>Project {donation.projectId.slice(0, 8)}</Text>
                {donation.message && (
                  <Text style={[styles.donationMessage, { color: colors.secondaryText }]}>"{donation.message}"</Text>
                )}
              </View>
              <View style={styles.donationAmount}>
                <Text style={[styles.amount, { color: colors.accent }]}>
                  {donation.currency === 'USDC'
                    ? `$${parseFloat(donation.amount).toFixed(2)} USDC`
                    : `${parseFloat(donation.amount).toFixed(2)} XLM`}
                </Text>
                <Text style={[styles.date, { color: colors.muted }]}>
                  {new Date(donation.createdAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Impact Certificate — captured as PNG for sharing */}
      <View
        ref={certificateRef}
        collapsable={false}
        style={styles.certificateCard}
      >
        <Text style={styles.certBrand}>Stellar GreenPay</Text>
        <Text style={styles.certTitle}>Climate Impact Certificate</Text>
        <Text style={styles.certRow}>
          {publicKey.slice(0, 8)}...{publicKey.slice(-4)}
        </Text>
        <Text style={styles.certRow}>
          CO₂ Offset: {impactStats?.co2OffsetKg ?? 0} kg
        </Text>
        <Text style={styles.certRow}>
          Total Donated: {profile ? parseFloat(profile.totalDonatedXLM).toFixed(2) : '0'} XLM
        </Text>
      </View>

      <TouchableOpacity
        onPress={handleShare}
        disabled={loading}
        style={styles.shareButton}
        accessibilityLabel="Share your climate impact certificate"
        accessibilityRole="button"
      >
        <Text style={styles.shareButtonText}>Share Certificate</Text>
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
    marginTop: 40,
  },
  header: {
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  statIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  historyCard: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  donationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  donationInfo: {
    flex: 1,
  },
  donationProject: {
    fontSize: 14,
    fontWeight: '600',
  },
  donationMessage: {
    fontSize: 12,
    marginTop: 2,
  },
  donationAmount: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  date: {
    fontSize: 10,
    marginTop: 2,
  },
  certificateCard: {
    margin: 16,
    padding: 24,
    borderRadius: 12,
    backgroundColor: '#227239',
  },
  certBrand: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  certTitle: {
    color: '#d4edda',
    fontSize: 14,
    marginBottom: 16,
  },
  certRow: {
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 8,
  },
  shareButton: {
    margin: 16,
    marginTop: 0,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#227239',
    alignItems: 'center',
  },
  shareButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
