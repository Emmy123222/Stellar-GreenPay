/**
 * utils/notifications.ts
 * Push notification setup and helpers
 */
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const LAST_SEEN_KEY = 'greenpay:notifications:lastSeen';

/**
 * Request notification permissions
 */
export async function requestNotificationPermissions(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    console.log('Failed to get push token for push notification!');
    return null;
  }
  
  return finalStatus;
}

/**
 * Get the device's push token
 */
export async function getPushToken(): Promise<string | null> {
  try {
    const permissionStatus = await requestNotificationPermissions();
    if (!permissionStatus) return null;
    
    const token = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID || '',
    });
    
    return token.data;
  } catch (error) {
    console.error('Error getting push token:', error);
    return null;
  }
}

/**
 * Register device token with backend
 */
export async function registerDeviceToken(
  token: string,
  walletAddress?: string
): Promise<boolean> {
  try {
    const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
    const platform = Platform.OS;
    
    await fetch(`${API_URL}/api/notifications/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        platform,
        walletAddress,
      }),
    });
    
    console.log('Device token registered successfully');
    return true;
  } catch (error) {
    console.error('Error registering device token:', error);
    return false;
  }
}

/**
 * Follow a project.
 *
 * Calls both endpoints in parallel:
 *  1. POST /api/notifications/follow  — registers the push-token follow so the
 *     device receives project update notifications.
 *  2. POST /api/projects/:id/follows  — wallet-address follow for the REST API
 *     (issue #399); only sent when walletAddress is provided.
 *
 * Returns true only when all attempted calls succeed.
 */
export async function followProject(
  projectId: string,
  token: string,
  walletAddress?: string
): Promise<boolean> {
  try {
    const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

    const calls: Promise<Response>[] = [
      fetch(`${API_URL}/api/notifications/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, token, walletAddress }),
      }),
    ];

    // Wire up the REST follows endpoint when we have a wallet address.
    if (walletAddress) {
      calls.push(
        fetch(`${API_URL}/api/projects/${encodeURIComponent(projectId)}/follows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress }),
        })
      );
    }

    await Promise.all(calls);
    console.log(`Followed project ${projectId}`);
    return true;
  } catch (error) {
    console.error('Error following project:', error);
    return false;
  }
}

/**
 * Unfollow a project.
 *
 * Mirrors followProject: calls both unfollow endpoints in parallel.
 */
export async function unfollowProject(
  projectId: string,
  token: string,
  walletAddress?: string
): Promise<boolean> {
  try {
    const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

    const calls: Promise<Response>[] = [
      fetch(`${API_URL}/api/notifications/unfollow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, token }),
      }),
    ];

    if (walletAddress) {
      calls.push(
        fetch(`${API_URL}/api/projects/${encodeURIComponent(projectId)}/follows`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress }),
        })
      );
    }

    await Promise.all(calls);
    console.log(`Unfollowed project ${projectId}`);
    return true;
  } catch (error) {
    console.error('Error unfollowing project:', error);
    return false;
  }
}

/**
 * Get all projects followed by the device
 */
export async function getFollowedProjects(token: string): Promise<any[]> {
  try {
    const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
    
    const response = await fetch(`${API_URL}/api/notifications/follows?token=${encodeURIComponent(token)}`);
    const data = await response.json();
    
    if (data.success) {
      return data.data;
    }
    
    return [];
  } catch (error) {
    console.error('Error getting followed projects:', error);
    return [];
  }
}

/**
 * Get the timestamp used as the unread notification cutoff.
 */
export async function getNotificationLastSeen(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SEEN_KEY);
}

export async function markNotificationsSeen(date = new Date()): Promise<string> {
  const timestamp = date.toISOString();
  await AsyncStorage.setItem(LAST_SEEN_KEY, timestamp);
  return timestamp;
}

export async function getUnreadNotificationCount(token: string): Promise<number> {
  try {
    const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
    const lastSeen = await getNotificationLastSeen();
    const params = new URLSearchParams({ token });
    if (lastSeen) params.set('lastSeen', lastSeen);

    const response = await fetch(`${API_URL}/api/notifications/unread-count?${params.toString()}`);
    if (!response.ok) return 0;

    const data = await response.json();
    const count = Number(data.unreadCount);
    return Number.isFinite(count) ? count : 0;
  } catch (error) {
    console.error('Error getting unread notification count:', error);
    return 0;
  }
}

/**
 * Set up notification listener
 */
export function setupNotificationListener(onUnreadCountChange?: (count: number) => void) {
  const subscription = Notifications.addNotificationReceivedListener(async notification => {
    console.log('Notification received:', notification);
    const currentBadge = await Notifications.getBadgeCountAsync().catch(() => 0);
    const nextBadge = currentBadge + 1;
    await Notifications.setBadgeCountAsync(nextBadge).catch(() => undefined);
    onUnreadCountChange?.(nextBadge);
  });
  
  return subscription;
}

/**
 * Set up notification response listener for deep-link navigation (#483).
 * When the user taps a push notification that contains a projectId, navigate
 * directly to that project's detail screen.
 *
 * @param push - router.push function from expo-router
 * @returns the subscription (call .remove() on cleanup)
 */
export function setupNotificationResponseListener(push: (path: string) => void) {
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data as Record<string, unknown>;
    const projectId = data?.projectId as string | undefined;
    if (projectId) {
      push(`/projects/${projectId}`);
    }
  });

  return subscription;
}
