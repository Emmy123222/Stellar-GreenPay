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
 * Follow a project for push notifications
 */
export async function followProject(
  projectId: string,
  token: string,
  walletAddress?: string
): Promise<boolean> {
  try {
    const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
    
    await fetch(`${API_URL}/api/notifications/follow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        token,
        walletAddress,
      }),
    });
    
    console.log(`Followed project ${projectId}`);
    return true;
  } catch (error) {
    console.error('Error following project:', error);
    return false;
  }
}

/**
 * Unfollow a project
 */
export async function unfollowProject(
  projectId: string,
  token: string
): Promise<boolean> {
  try {
    const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
    
    await fetch(`${API_URL}/api/notifications/unfollow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        token,
      }),
    });
    
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
