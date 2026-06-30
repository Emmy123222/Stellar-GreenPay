/**
 * app/projects/[id].tsx
 * Project detail screen — with share button (#484) and accessibility (#485)
 */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Share } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useTheme } from '../theme';
import { getPushToken, followProject, unfollowProject } from '../../utils/notifications';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

interface ClimateProject {
  id: string;
  name: string;
  description: string;
  category: string;
  location: string;
  imageUrl?: string;
  goalXLM: string;
  raisedXLM: string;
  donorCount: number;
  co2OffsetKg: number;
  walletAddress: string;
  status: string;
}

export default function ProjectDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [project, setProject] = useState<ClimateProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    if (id) {
      loadProject(id as string);
      initializeNotifications();
    }
  }, [id]);

  const initializeNotifications = async () => {
    try {
      const token = await getPushToken();
      if (token) {
        setPushToken(token);
        // Check if already following this project
        checkFollowStatus(id as string, token);
      }
    } catch (error) {
      console.error('Error initializing notifications:', error);
    }
  };

  const checkFollowStatus = async (projectId: string, token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/notifications/follows?token=${token}`);
      const data = await response.json();
      if (data.success) {
        const followedProjects = data.data;
        const isFollowed = followedProjects.some((p: any) => p.id === projectId);
        setIsFollowing(isFollowed);
      }
    } catch (error) {
      console.error('Error checking follow status:', error);
    }
  };

  const loadProject = async (projectId: string) => {
    try {
      const res = await axios.get(`${API_URL}/api/projects/${projectId}`);
      setProject(res.data.data);
    } catch (error) {
      console.error('Error loading project:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFollow = async () => {
    if (!pushToken || !project) return;

    setFollowLoading(true);
    try {
      if (isFollowing) {
        await unfollowProject(project.id, pushToken);
        setIsFollowing(false);
      } else {
        await followProject(project.id, pushToken);
        setIsFollowing(true);
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
    } finally {
      setFollowLoading(false);
    }
  };

  const handleShare = async () => {
    if (!project) return;
    const APP_URL = process.env.EXPO_PUBLIC_APP_URL || 'https://greenpay.app';
    const url = `${APP_URL}/projects/${project.id}`;
    const co2 = project.co2OffsetKg ? `${project.co2OffsetKg.toFixed(0)} kg CO₂ offset` : '';
    const message =
      `Support ${project.name} on GreenPay: ${url}\n` +
      `Category: ${project.category}\n` +
      (co2 ? `Impact: ${co2}\n` : '') +
      `${parseFloat(project.raisedXLM).toFixed(2)} XLM raised of ${parseFloat(project.goalXLM).toFixed(2)} XLM goal`;
    try {
      await Share.share({ message, url });
    } catch (error) {
      console.error('Share failed:', error);
    }
  };

  const progressPercent = (raised: string, goal: string) => {
    const r = parseFloat(raised);
    const g = parseFloat(goal);
    if (!g || isNaN(r) || isNaN(g)) return 0;
    return Math.min(100, Math.round((r / g) * 100));
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}> 
        <Text style={[styles.loadingText, { color: colors.secondaryText }]}>Loading project...</Text>
      </View>
    );
  }

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}> 
        <Text style={[styles.errorText, { color: colors.secondaryText }]}>Project not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}> 
      <View style={[styles.header, { backgroundColor: colors.primary }]}> 
        <View style={styles.headerRow}>
          <View style={styles.headerTextGroup}>
            <Text style={[styles.category, { color: colors.headerText }]}>{project.category}</Text>
            <Text style={[styles.name, { color: colors.headerText }]}>{project.name}</Text>
            <Text style={[styles.location, { color: colors.headerText }]}>📍 {project.location}</Text>
          </View>
          <TouchableOpacity
            style={styles.shareButton}
            onPress={handleShare}
            accessibilityLabel={`Share ${project.name}`}
            accessibilityRole="button"
          >
            <Text style={styles.shareIcon}>⬆️</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.statsCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}> 
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.accent }]}>{parseFloat(project.raisedXLM).toFixed(2)}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>XLM Raised</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.accent }]}>{project.donorCount}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Donors</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.accent }]}>{project.co2OffsetKg.toFixed(0)}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>kg CO₂</Text>
          </View>
        </View>
      </View>

      <View style={[styles.progressCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}> 
        <Text style={[styles.progressTitle, { color: colors.primaryText }]}>Fundraising Progress</Text>
        <View style={[styles.progressBar, { backgroundColor: colors.border }]}> 
          <View
            style={[
              styles.progressFill,
              { width: `${progressPercent(project.raisedXLM, project.goalXLM)}%`, backgroundColor: colors.primary }
            ]}
          />
        </View>
        <Text style={[styles.progressText, { color: colors.secondaryText }]}> 
          {progressPercent(project.raisedXLM, project.goalXLM)}% complete
        </Text>
        <Text style={[styles.goalText, { color: colors.muted }]}> 
          Goal: {parseFloat(project.goalXLM).toFixed(2)} XLM
        </Text>
      </View>

      <View style={[styles.descriptionCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: colors.primaryText }]}>About this project</Text>
        <Text style={[styles.description, { color: colors.secondaryText }]}>{project.description}</Text>
      </View>

      {pushToken && (
        <TouchableOpacity
          style={[styles.followButton, isFollowing && styles.followButtonActive]}
          onPress={handleToggleFollow}
          disabled={followLoading}
          accessibilityLabel={isFollowing ? `Unfollow ${project.name} for updates` : `Follow ${project.name} for updates`}
          accessibilityRole="button"
        >
          <Text style={styles.followButtonText}>
            {followLoading ? 'Loading...' : isFollowing ? '🔔 Following' : '🔔 Follow for Updates'}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.donateButton, { backgroundColor: colors.buttonBackground }]}
        onPress={() => router.push(`/donate/${project.id}`)}
        accessibilityLabel={`Donate to ${project.name}`}
        accessibilityRole="button"
      >
        <Text style={[styles.donateButtonText, { color: colors.buttonText }]}>🌱 Donate Now</Text>
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
  errorText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 40,
  },
  header: {
    padding: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerTextGroup: {
    flex: 1,
    marginRight: 12,
  },
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  shareIcon: {
    fontSize: 18,
  },
  category: {
    fontSize: 14,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
  },
  location: {
    fontSize: 14,
    marginTop: 4,
  },
  statsCard: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  progressCard: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  progressBar: {
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  progressText: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  goalText: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  descriptionCard: {
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
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  followButton: {
    backgroundColor: '#fff',
    padding: 16,
    margin: 16,
    marginTop: 0,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#227239',
  },
  followButtonActive: {
    backgroundColor: '#227239',
  },
  followButtonText: {
    color: '#227239',
    fontSize: 16,
    fontWeight: 'bold',
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
