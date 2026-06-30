/**
 * app/projects/[id].tsx
 * Project detail screen
 *
 * Changes for issue #399:
 *  - Follow button now wired to POST /api/projects/:id/follows (via
 *    followProject / unfollowProject in utils/notifications.ts which call
 *    both the push-notification and REST endpoints in parallel).
 *  - Toast component shows confirmation / error messages above the tab bar.
 *  - Button renders three distinct states:
 *      • "🔔 Follow for Updates"  — not following, push token available
 *      • "✓ Following · Tap to unfollow" — actively following
 *      • Loading spinner text while the request is in-flight
 *  - Errors (network failure, missing push token) surface as a red toast
 *    rather than being silently swallowed.
 */
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useTheme } from '../theme';
import {
  getPushToken,
  followProject,
  unfollowProject,
} from '../../utils/notifications';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

// ─── Types ────────────────────────────────────────────────────────────────────

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

type ToastVariant = 'success' | 'error';

interface ToastState {
  message: string;
  variant: ToastVariant;
}

// ─── Toast component ──────────────────────────────────────────────────────────

/**
 * Lightweight animated toast. Appears for ~2.5 s then fades out.
 * Kept inline so the screen has no additional import dependencies.
 */
function Toast({
  message,
  variant,
  onHide,
}: {
  message: string;
  variant: ToastVariant;
  onHide: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      // Hold for 2 s, then fade out
      setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(onHide);
      }, 2000);
    });
  }, []);

  const bg = variant === 'success' ? '#227239' : '#b91c1c';

  return (
    <Animated.View
      style={[toastStyles.container, { backgroundColor: bg, opacity }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={toastStyles.text}>
        {variant === 'success' ? '✓ ' : '✕ '}
        {message}
      </Text>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 96,
    left: 16,
    right: 16,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    zIndex: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 8,
  },
  text: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProjectDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();

  const [project, setProject] = useState<ClimateProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [followLoading, setFollowLoading] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (id) {
      loadProject(id as string);
      initializeNotifications();
      markNotificationsSeen().then(() => {
        Notifications.setBadgeCountAsync(0).catch(() => undefined);
      });
    }
  }, [id]);

  // ── helpers ────────────────────────────────────────────────────────────────

  const showToast = (message: string, variant: ToastVariant = 'success') => {
    setToast({ message, variant });
  };

  const initializeNotifications = async () => {
    try {
      const token = await getPushToken();
      if (token) {
        setPushToken(token);
        checkFollowStatus(id as string, token);
      }
    } catch {
      // Non-critical — the screen still works without push
    }
  };

  const checkFollowStatus = async (projectId: string, token: string) => {
    try {
      const response = await fetch(
        `${API_URL}/api/notifications/follows?token=${encodeURIComponent(token)}`
      );
      const data = await response.json();
      if (data.success) {
        setIsFollowing(data.data.some((p: { id: string }) => p.id === projectId));
      }
    } catch {
      // Silently ignore — follow state will default to false
    }
  };

  const loadProject = async (projectId: string) => {
    try {
      const res = await axios.get(`${API_URL}/api/projects/${projectId}`);
      setProject(res.data.data);
    } catch {
      // Project not found — handled in render
    } finally {
      setLoading(false);
    }
  };

  // ── follow / unfollow ─────────────────────────────────────────────────────

  const handleToggleFollow = async () => {
    if (!project) return;

    if (!pushToken) {
      showToast('Enable notifications to follow projects', 'error');
      return;
    }

    setFollowLoading(true);
    try {
      if (isFollowing) {
        const ok = await unfollowProject(
          project.id,
          pushToken,
          project.walletAddress ? undefined : undefined  // no wallet on device
        );
        if (ok) {
          setIsFollowing(false);
          showToast(`Unfollowed ${project.name}`);
        } else {
          showToast('Could not unfollow. Please try again.', 'error');
        }
      } else {
        const ok = await followProject(project.id, pushToken);
        if (ok) {
          setIsFollowing(true);
          showToast(`You're now following ${project.name}! 🔔`);
        } else {
          showToast('Could not follow project. Please try again.', 'error');
        }
      }
    } catch {
      showToast('Something went wrong. Please try again.', 'error');
    } finally {
      setFollowLoading(false);
    }
  };

  // ── utilities ──────────────────────────────────────────────────────────────

  const progressPercent = (raised: string, goal: string) => {
    const r = parseFloat(raised);
    const g = parseFloat(goal);
    if (!g || isNaN(r) || isNaN(g)) return 0;
    return Math.min(100, Math.round((r / g) * 100));
  };

  // ── follow button label ───────────────────────────────────────────────────

  const followButtonLabel = (() => {
    if (followLoading) return '⏳ Loading…';
    if (isFollowing) return '✓ Following · Tap to unfollow';
    return '🔔 Follow for Updates';
  })();

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.secondaryText }]}>
          Loading project...
        </Text>
      </View>
    );
  }

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.secondaryText }]}>
          Project not found
        </Text>
      </View>
    );
  }

  const pct = progressPercent(project.raisedXLM, project.goalXLM);

  return (
    <View style={[styles.wrapper, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.primary }]}>
          <Text style={[styles.category, { color: colors.headerText }]}>
            {project.category}
          </Text>
          <Text style={[styles.name, { color: colors.headerText }]}>
            {project.name}
          </Text>
          <Text style={[styles.location, { color: colors.headerText }]}>
            📍 {project.location}
          </Text>
        </View>

        {/* Stats */}
        <View
          style={[
            styles.statsCard,
            {
              backgroundColor: colors.surface,
              shadowColor: colors.cardShadow,
              borderColor: colors.cardBorder,
            },
          ]}
        >
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.accent }]}>
                {parseFloat(project.raisedXLM).toFixed(2)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                XLM Raised
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.accent }]}>
                {project.donorCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Donors</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.accent }]}>
                {project.co2OffsetKg.toFixed(0)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>kg CO₂</Text>
            </View>
          </View>
        </View>

        {/* Progress */}
        <View
          style={[
            styles.progressCard,
            {
              backgroundColor: colors.surface,
              shadowColor: colors.cardShadow,
              borderColor: colors.cardBorder,
            },
          ]}
        >
          <Text style={[styles.progressTitle, { color: colors.primaryText }]}>
            Fundraising Progress
          </Text>
          <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${pct}%`, backgroundColor: colors.primary },
              ]}
            />
          </View>
          <Text style={[styles.progressText, { color: colors.secondaryText }]}>
            {pct}% complete
          </Text>
          <Text style={[styles.goalText, { color: colors.muted }]}>
            Goal: {parseFloat(project.goalXLM).toFixed(2)} XLM
          </Text>
        </View>

        {/* Description */}
        <View
          style={[
            styles.descriptionCard,
            {
              backgroundColor: colors.surface,
              shadowColor: colors.cardShadow,
              borderColor: colors.cardBorder,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.primaryText }]}>
            About this project
          </Text>
          <Text style={[styles.description, { color: colors.secondaryText }]}>
            {project.description}
          </Text>
        </View>

        {/* Follow button — visible whenever we have a push token, OR show a
            softer prompt when we don't so the user knows the feature exists */}
        <TouchableOpacity
          testID="follow-button"
          style={[
            styles.followButton,
            isFollowing && styles.followButtonActive,
            !pushToken && styles.followButtonDisabled,
          ]}
          onPress={handleToggleFollow}
          disabled={followLoading}
          accessibilityRole="button"
          accessibilityLabel={followButtonLabel}
          accessibilityState={{ selected: isFollowing, busy: followLoading }}
        >
          <Text
            style={[
              styles.followButtonText,
              isFollowing && styles.followButtonTextActive,
            ]}
          >
            {pushToken
              ? followButtonLabel
              : '🔔 Follow for Updates'}
          </Text>
          {isFollowing && (
            <Text style={styles.unfollowHint}>Tap again to unfollow</Text>
          )}
        </TouchableOpacity>

        {/* Donate button */}
        <TouchableOpacity
          style={[styles.donateButton, { backgroundColor: colors.buttonBackground }]}
          onPress={() => router.push(`/donate/${project.id}`)}
        >
          <Text style={[styles.donateButtonText, { color: colors.buttonText }]}>
            🌱 Donate Now
          </Text>
        </TouchableOpacity>

        {/* Bottom padding so content clears the toast */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Toast overlay — rendered outside ScrollView so it stays fixed */}
      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          onHide={() => setToast(null)}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    position: 'relative',
  },
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
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#227239',
  },
  followButtonActive: {
    backgroundColor: '#227239',
  },
  followButtonDisabled: {
    opacity: 0.6,
  },
  followButtonText: {
    color: '#227239',
    fontSize: 16,
    fontWeight: 'bold',
  },
  followButtonTextActive: {
    color: '#fff',
  },
  unfollowHint: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    marginTop: 3,
  },
  donateButton: {
    paddingVertical: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  donateButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});
