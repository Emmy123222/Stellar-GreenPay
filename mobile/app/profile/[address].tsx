/**
 * app/profile/[address].tsx
 * Donor profile screen — shows stats, badge tier, donation history,
 * and avatar upload with client-side image compression.
 */
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Alert,
} from 'react-native';
import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';
import { processAvatarImage, uploadAvatar } from '../../utils/avatar';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

interface Badge {
  tier: 'seedling' | 'tree' | 'forest' | 'earth';
  earnedAt: string;
}

export interface DonorProfile {
  publicKey: string;
  displayName?: string;
  avatarUrl?: string | null;
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

export default function ProfileScreen({ address: propAddress }: { address?: string } = {}) {
  const routeParams = useLocalSearchParams<{ address?: string }>();
  const address = propAddress || routeParams.address;

  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Avatar upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  const handlePickAndUploadAvatar = async () => {
    if (!address || isUploading) return;

    try {
      setUploadError(null);
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Denied', 'Permission to access gallery is required to upload an avatar.');
        return;
      }

      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const asset = pickerResult.assets[0];
      setIsUploading(true);
      setUploadProgress(0);

      // Compress and resize image to max 512x512 with JPEG 0.7 quality
      const processed = await processAvatarImage(asset.uri, {
        width: asset.width,
        height: asset.height,
      });

      // Upload the compressed image with progress reporting
      const avatarUrl = await uploadAvatar(
        processed.uri,
        (progress) => setUploadProgress(progress),
        API_URL
      );

      // Save avatarUrl to profile on backend
      try {
        await axios.patch(`${API_URL}/api/profiles/${address}`, { avatarUrl });
      } catch {
        await axios.post(`${API_URL}/api/profiles`, {
          publicKey: address,
          avatarUrl,
        });
      }

      // Update state
      setProfile((prev) => (prev ? { ...prev, avatarUrl } : null));
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload avatar');
      Alert.alert('Upload Failed', err.message || 'Unable to upload avatar. Please try again.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered} testID="profile-loading">
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
        {/* Avatar Container with Upload trigger */}
        <View style={styles.avatarWrapper}>
          <TouchableOpacity
            style={styles.avatarButton}
            onPress={handlePickAndUploadAvatar}
            disabled={isUploading}
            accessibilityLabel="Upload profile avatar"
            accessibilityRole="button"
            testID="avatar-upload-button"
          >
            {profile?.avatarUrl ? (
              <Image
                source={{ uri: profile.avatarUrl }}
                style={styles.avatarImage}
                testID="profile-avatar-image"
              />
            ) : topBadge ? (
              <Text style={styles.headerBadgeIcon}>
                {BADGE_CONFIG[topBadge.tier]?.icon ?? '🌱'}
              </Text>
            ) : (
              <Text style={styles.headerBadgeIcon}>👤</Text>
            )}

            <View style={styles.avatarEditBadge}>
              <Text style={styles.avatarEditIcon}>📷</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Progress Bar during Upload */}
        {isUploading && (
          <View style={styles.progressContainer} testID="avatar-upload-progress">
            <Text style={styles.progressText}>
              Uploading avatar... {Math.round(uploadProgress * 100)}%
            </Text>
            <View style={styles.progressBarBackground}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.max(5, Math.round(uploadProgress * 100))}%` },
                ]}
                testID="upload-progress-fill"
              />
            </View>
          </View>
        )}

        {uploadError && (
          <Text style={styles.uploadErrorText}>{uploadError}</Text>
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
  avatarWrapper: {
    marginBottom: 12,
    position: 'relative',
  },
  avatarButton: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#a5d6a7',
    overflow: 'visible',
  },
  avatarImage: {
    width: 86,
    height: 86,
    borderRadius: 43,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#2e7d32',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarEditIcon: {
    fontSize: 13,
  },
  headerBadgeIcon: {
    fontSize: 44,
  },
  progressContainer: {
    width: '80%',
    marginVertical: 10,
    alignItems: 'center',
  },
  progressText: {
    color: '#c8e6c9',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#81c784',
    borderRadius: 4,
  },
  uploadErrorText: {
    color: '#ffcdd2',
    fontSize: 12,
    marginTop: 4,
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
  emptyText: {
    fontSize: 14,
    color: '#8aaa8a',
    textAlign: 'center',
    paddingVertical: 20,
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

