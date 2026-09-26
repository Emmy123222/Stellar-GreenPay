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
 *
 * Changes for issue #1122:
 *  - The map section only mounts a `MapView` when BOTH `latitude` and
 *    `longitude` are non-null. Projects without location data render a
 *    "Location not available" placeholder with a globe icon instead of
 *    crashing the screen with "Cannot read properties of null".
 */
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Share,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';

import * as Notifications from 'expo-notifications';
import MapView, { Marker } from 'react-native-maps';
import { useTheme } from '../theme';
import {
  getPushToken,
  followProject,
  unfollowProject,
  markNotificationsSeen,
} from '../../utils/notifications';
import {
  loadRecurringDonations,
  type RecurringDonation,
} from '../../utils/recurringDonations';

export function formatNextPaymentDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return isoDate;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

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
  /**
   * Optional map pin. The API leaves both `null` for projects that were created
   * before we started capturing coordinates, so both fields are nullable and
   * must never be dereferenced without the guard in the render (issue #1122).
   */
  latitude?: number | null;
  longitude?: number | null;
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
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  useEffect(() => {
    // Unmount-race hygiene for the toast's animation chain.
    //
    // Three things can race against an unmount:
    //   1. The fade-IN animation (`Animated.timing({duration: 200}).start(onFadeInDone)`)
    //      is still in flight when the component unmounts. Its start callback
    //      fires LATER, after the cleanup has already run — so any timer we
    //      set inside it would be unreachable from the cleanup return.
    //   2. The hold `setTimeout(2000)` queued by the fade-in callback.
    //   3. The fade-OUT animation the latter triggers, whose `onHide` is a
    //      `setToast(null)` on the (now unmounted) parent state.
    //
    // We track all three (`anim`, `holdTimer`, `mounted`) and tear them down
    // in the single cleanup return. Stopping the fade-in animation is the
    // load-bearing one — without it, the cleanup can run with `holdTimer`
    // still `undefined` and the start callback then queues a timer the
    // cleanup can no longer reach. The `mounted` guard is a belt-and-braces
    // defence for any future async path that updates the closure.
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;
    const anim = Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    });

    // Fade in
    anim.start(() => {
      // Bail if the component unmounted before fade-in finished.
      if (!mounted) return;
      // Hold for 2 s, then fade out
      holdTimer = setTimeout(() => {
        if (!mounted) return;

        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(onHideRef.current);
      }, 2000);
    });

    return () => {
      mounted = false;
      if (holdTimer !== undefined) clearTimeout(holdTimer);
      // `anim.stop()` halts the fade-in mid-flight so its start callback
      // never fires after unmount. (React Native's `Animated.CompositeAnimation`
      // exposes `.stop(callback?)`; we don't need a callback here.)
      anim.stop();
      opacity.stopAnimation();
    };
  }, [opacity]);

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
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [followLoading, setFollowLoading] = useState(false);
  const [activeDonation, setActiveDonation] = useState<RecurringDonation | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const checkRecurringDonation = useCallback(async (projectId: string) => {
    try {
      const donations = await loadRecurringDonations();
      const active = donations.find(
        (d) => d.projectId === projectId && d.status === 'active'
      );
      setActiveDonation(active || null);
    } catch {
      setActiveDonation(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (id) {
        checkRecurringDonation(id as string);
      }
    }, [id, checkRecurringDonation])
  );

  useEffect(() => {
    if (id) {
      loadProject(id as string);
      loadUpdates(id as string);
      initializeNotifications();
      // markNotificationsSeen / Notifications may be stripped from the
      // module mocks during tests; optional-chaining the call sites keeps
      // the badge reset truly non-critical (#168 follow-up cleanup).
      markNotificationsSeen?.()?.then?.(() => {
        Notifications.setBadgeCountAsync?.(0)?.catch?.(() => undefined);
      });
    }
  }, [id]);

  const loadUpdates = async (projectId: string) => {
    try {
      const res = await axios.get(`${API_URL}/api/updates/${projectId}`);
      setUpdates(res.data.data || []);
    } catch (error) {
      console.error('Error loading updates:', error);
    }
  };

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
        // Pass the wallet address so `unfollowProject` also hits the REST
        // DELETE on /api/projects/:id/follows (paired with the follow branch,
        // which always sends walletAddress via followProject). Without this
        // argument the REST unfollow endpoint would never be called.
        const ok = await unfollowProject(
          project.id,
          pushToken,
          project.walletAddress
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

  // ── share ──────────────────────────────────────────────────────────────────

  // Cross-platform share using RN's built-in `Share` (works for strings; the
  // platform share sheet is presented on iOS and Android).
  //
  // iOS-specific quirk: `Share.share` rejects with the literal message
  // "User did not share" when the user dismisses the sheet. That is a normal
  // user gesture, not a failure, so we swallow it silently. Real failures
  // (e.g. JS exception, Android SecurityException) bubble up the toast.
  //
  // The check intentionally matches on the iOS-shipped string rather than a
  // platform guard -- we want this to keep working should expo upgrade RN's
  // Share stub to behave identically. If RN ever changes that error string
  // we'll need to update both this filter and the matching test in
  // ProjectDetailScreen.test.tsx.
  const handleShare = async () => {
    if (!project) return;
    try {
      await Share.share({
        title: project.name,
        message:
          `🌱 Support "${project.name}" on Stellar GreenPay!\n\n` +
          `${project.description}\n\n` +
          `Category: ${project.category} · ${project.location}`,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      if (message.includes('User did not share')) {
        // User dismissed the share sheet — a normal, non-error interaction.
        return;
      }
      showToast('Could not open share dialog', 'error');
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

  // Single source of truth for both the visible Text and the
  // `accessibilityLabel`. The pushToken check sits BEFORE isFollowing so the
  // a11y label and the rendered text can never disagree.
  const followButtonLabel = (() => {
    if (followLoading) return '⏳ Loading…';
    if (!pushToken) return '🔔 Follow for Updates';
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

  // ── map availability (#1122) ──────────────────────────────────────────────

  // Single source of truth for "can we drop a pin on a map?", evaluated only
  // once `project` is known to be non-null by the early returns above.
  //
  // `latitude` / `longitude` are optional *and* nullable on the API's project
  // payload: projects created before coordinates were captured come back with
  // an explicit `null`, and the fields can also be missing entirely. Both must
  // be present before MapView is rendered — passing `null` through to the
  // native map threw "Cannot read properties of null" and took down the whole
  // screen. When either is missing we render a "Location not available"
  // placeholder instead.
  //
  // `!= null` (loose, not `!`) is deliberate: it rejects `null` *and*
  // `undefined` in one comparison, while still treating `0` as a legitimate
  // coordinate — a truthiness check would wrongly hide the map at lat/lng 0.
  const hasCoordinates = (
    project.latitude != null && project.longitude != null
  );

  return (
    <View style={[styles.wrapper, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.primary }]}>
          <View style={styles.headerRow}>
            <View style={styles.headerTextGroup}>
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
            <TouchableOpacity
              style={styles.shareButton}
              onPress={handleShare}
              activeOpacity={0.7}
              testID="share-button"
              accessibilityRole="button"
              accessibilityLabel={`Share ${project.name}`}
              accessibilityHint="Opens the system share sheet so you can send this project to others"
            >
              <Text style={styles.shareIcon}>↗</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Active Recurring Donation Banner */}
        {activeDonation && (
          <View
            testID="recurring-donation-banner"
            style={[
              styles.recurringBanner,
              {
                backgroundColor: colors.surface,
                borderColor: '#227239',
                shadowColor: colors.cardShadow,
              },
            ]}
            accessibilityRole="region"
            accessibilityLabel={`Active recurring donation banner for ${project.name}`}
          >
            <View style={styles.recurringBannerContent}>
              <Text
                style={[styles.recurringBannerText, { color: colors.primaryText }]}
                accessibilityLabel={`You have an active ${(activeDonation as any).frequency || 'monthly'} donation of ${activeDonation.amountXLM} XLM, next payment: ${formatNextPaymentDate(activeDonation.nextDueDate)}`}
              >
                You have an active {(activeDonation as any).frequency || 'monthly'} donation of{' '}
                <Text style={styles.recurringBannerBold}>{activeDonation.amountXLM} XLM</Text> — next payment:{' '}
                <Text style={styles.recurringBannerBold}>
                  {formatNextPaymentDate(activeDonation.nextDueDate)}
                </Text>
              </Text>
            </View>
            <TouchableOpacity
              testID="manage-recurring-button"
              style={styles.manageButton}
              onPress={() => router.push('/recurring')}
              accessibilityRole="button"
              accessibilityLabel="Manage recurring donations"
            >
              <Text style={styles.manageButtonText}>Manage</Text>
            </TouchableOpacity>
          </View>
        )}

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

        {/* Updates — recent project activity derived from existing fields.
            Real implementation of the "Display: ... updates" line in
            issue-168 (closes the AC gap that the original ticket flagged but
            the first pass omitted). */}
        <View
          style={[
            styles.updatesCard,
            {
              backgroundColor: colors.surface,
              shadowColor: colors.cardShadow,
              borderColor: colors.cardBorder,
            },
          ]}
          accessibilityRole="summary"
          accessibilityLabel={`Updates for ${project.name}`}
        >
          <Text style={[styles.sectionTitle, { color: colors.primaryText }]}>
            📰 Updates
          </Text>

          {project.donorCount > 0 && (
            <View style={styles.updateRow}>
              <Text style={styles.updateBullet} accessibilityElementsHidden>
                🎉
              </Text>
              <View style={styles.updateText}>
                <Text style={[styles.updateTitle, { color: colors.primaryText }]}>
                  {project.donorCount}{' '}
                  {project.donorCount === 1 ? 'donor has' : 'donors have'} contributed
                </Text>
                <Text style={[styles.updateSubtitle, { color: colors.secondaryText }]}>
                  The project is actively receiving community support.
                </Text>
              </View>
            </View>
          )}

          {project.co2OffsetKg > 0 && (
            <View style={styles.updateRow}>
              <Text style={styles.updateBullet} accessibilityElementsHidden>
                🌱
              </Text>
              <View style={styles.updateText}>
                <Text style={[styles.updateTitle, { color: colors.primaryText }]}>
                  {project.co2OffsetKg.toLocaleString()} kg CO₂ offset
                </Text>
                <Text style={[styles.updateSubtitle, { color: colors.secondaryText }]}>
                  Estimated environmental impact to date.
                </Text>
              </View>
            </View>
          )}

          {pct >= 25 && pct < 50 && (
            <View style={styles.updateRow}>
              <Text style={styles.updateBullet} accessibilityElementsHidden>
                ⭐
              </Text>
              <View style={styles.updateText}>
                <Text style={[styles.updateTitle, { color: colors.primaryText }]}>
                  25% milestone reached
                </Text>
                <Text style={[styles.updateSubtitle, { color: colors.secondaryText }]}>
                  {parseFloat(project.raisedXLM).toFixed(0)} of{' '}
                  {parseFloat(project.goalXLM).toFixed(0)} XLM raised to date.
                </Text>
              </View>
            </View>
          )}

          {pct >= 50 && pct < 75 && (
            <View style={styles.updateRow}>
              <Text style={styles.updateBullet} accessibilityElementsHidden>
                ⭐⭐
              </Text>
              <View style={styles.updateText}>
                <Text style={[styles.updateTitle, { color: colors.primaryText }]}>
                  50% milestone reached — halfway!
                </Text>
                <Text style={[styles.updateSubtitle, { color: colors.secondaryText }]}>
                  {parseFloat(project.raisedXLM).toFixed(0)} of{' '}
                  {parseFloat(project.goalXLM).toFixed(0)} XLM raised to date.
                </Text>
              </View>
            </View>
          )}

          {pct >= 75 && pct < 100 && (
            <View style={styles.updateRow}>
              <Text style={styles.updateBullet} accessibilityElementsHidden>
                🔥
              </Text>
              <View style={styles.updateText}>
                <Text style={[styles.updateTitle, { color: colors.primaryText }]}>
                  75% milestone — almost there
                </Text>
                <Text style={[styles.updateSubtitle, { color: colors.secondaryText }]}>
                  {parseFloat(project.raisedXLM).toFixed(0)} of{' '}
                  {parseFloat(project.goalXLM).toFixed(0)} XLM raised to date.
                </Text>
              </View>
            </View>
          )}

          {pct >= 100 && (
            <View style={styles.updateRow}>
              <Text style={styles.updateBullet} accessibilityElementsHidden>
                🏆
              </Text>
              <View style={styles.updateText}>
                <Text style={[styles.updateTitle, { color: colors.primaryText }]}>
                  Goal fully funded
                </Text>
                <Text style={[styles.updateSubtitle, { color: colors.secondaryText }]}>
                  {project.donorCount}{' '}
                  {project.donorCount === 1 ? 'donor has' : 'donors have'} hit the{' '}
                  {parseFloat(project.goalXLM).toFixed(0)} XLM goal.
                </Text>
              </View>
            </View>
          )}

          <View style={styles.updateRow}>
            <Text style={styles.updateBullet} accessibilityElementsHidden>
              {project.status === 'active'
                ? '✅'
                : project.status === 'completed'
                ? '🏁'
                : '⏸️'}
            </Text>
            <View style={styles.updateText}>
              <Text
                style={[styles.updateTitle, { color: colors.primaryText }]}
                accessibilityLabel={`Project status ${project.status}`}
              >
                Project {project.status}
              </Text>
              <Text style={[styles.updateSubtitle, { color: colors.secondaryText }]}>
                Verified {project.category.toLowerCase()} project.
              </Text>
            </View>
          </View>
        </View>

        {/* Map — guarded on both coordinates being present. Projects created
            before we started capturing coordinates come back from the API with
            `latitude`/`longitude` set to `null`, and handing those straight to
            MapView threw "Cannot read properties of null" and took the whole
            screen down with it. When either value is missing we fall back to a
            static placeholder instead (issue #1122). */}
        {hasCoordinates ? (
          <View
            style={[
              styles.mapCard,
              {
                backgroundColor: colors.surface,
                shadowColor: colors.cardShadow,
                borderColor: colors.cardBorder,
              },
            ]}
          >
            <MapView
              testID="project-map"
              style={styles.map}
              // `latitude`/`longitude` are non-null here: `hasCoordinates` is
              // the guard above, and React only re-evaluates the tree when
              // `project` changes identity.
              region={{
                latitude: project.latitude as number,
                longitude: project.longitude as number,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
              scrollEnabled={false}
              zoomEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
              accessibilityLabel={`Map showing the location of ${project.name}`}
            >
              <Marker
                coordinate={{
                  latitude: project.latitude as number,
                  longitude: project.longitude as number,
                }}
                title={project.name}
                description={project.location}
              />
            </MapView>
          </View>
        ) : (
          <View
            style={[
              styles.mapCard,
              {
                backgroundColor: colors.surface,
                shadowColor: colors.cardShadow,
                borderColor: colors.cardBorder,
              },
            ]}
          >
            <View
              testID="map-unavailable"
              accessibilityRole="text"
              accessibilityLabel={`Location not available for ${project.name}`}
              style={[
                styles.mapPlaceholder,
                { backgroundColor: colors.inputBackground, borderColor: colors.border },
              ]}
            >
              <Text style={styles.mapPlaceholderIcon}>🌐</Text>
              <Text style={[styles.mapPlaceholderText, { color: colors.secondaryText }]}>
                Location not available
              </Text>
            </View>
          </View>
        )}

        {updates.length > 0 && (
          <View
            style={[
              styles.updatesCard,
              {
                backgroundColor: colors.surface,
                shadowColor: colors.cardShadow,
                borderColor: colors.cardBorder,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.primaryText }]}>
              Latest Updates
            </Text>
            {updates.map((update) => (
              <View
                key={update.id}
                style={[styles.updateItem, { borderTopColor: colors.border }]}
              >
                <Text style={[styles.updateTitle, { color: colors.primaryText }]}>
                  {update.title}
                </Text>
                <Text style={[styles.updateDate, { color: colors.muted }]}>
                  {new Date(update.createdAt).toLocaleDateString()}
                </Text>
                <Text style={[styles.updateBody, { color: colors.secondaryText }]}>
                  {update.body}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Follow button — always rendered. Without a push token we show a
            dimmed "soft prompt" so the user knows the feature exists; pressing
            it then surfaces the "Enable notifications" toast from
            handleToggleFollow. */}
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
            {followButtonLabel}
          </Text>
          {isFollowing && (
            <Text style={styles.unfollowHint}>Tap again to unfollow</Text>
          )}
        </TouchableOpacity>

        {/* Donate button */}
        <TouchableOpacity
          style={[styles.donateButton, { backgroundColor: colors.buttonBackground }]}
          onPress={() => router.push(`/donate/${project.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Donate to ${project.name}`}
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
  recurringBanner: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 2,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  recurringBannerContent: {
    flex: 1,
    marginRight: 12,
  },
  recurringBannerText: {
    fontSize: 14,
    lineHeight: 20,
  },
  recurringBannerBold: {
    fontWeight: 'bold',
  },
  manageButton: {
    backgroundColor: '#227239',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  manageButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  mapCard: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  map: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    overflow: 'hidden',
  },
  mapPlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  mapPlaceholderIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  mapPlaceholderText: {
    fontSize: 14,
    fontWeight: '600',
  },
  updatesCard: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  updateItem: {
    marginTop: 16,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  updateTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  updateDate: {
    fontSize: 12,
    marginTop: 2,
    marginBottom: 6,
  },
  updateBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  updateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 14,
  },
  updateBullet: {
    fontSize: 16,
    marginRight: 10,
  },
  updateText: {
    flex: 1,
  },
  updateSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});

