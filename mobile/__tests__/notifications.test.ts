/**
 * __tests__/notifications.test.ts
 * Tests for push-notification tap navigation (#1121):
 * cold start, warm start, payload contract, and duplicate-response guard.
 */
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  getBadgeCountAsync: jest.fn(() => Promise.resolve(0)),
  setBadgeCountAsync: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve(undefined)),
  },
}));

import * as Notifications from 'expo-notifications';
import {
  pathForNotificationData,
  setupNotificationResponseListener,
  navigateFromInitialNotification,
} from '../utils/notifications';

const mockAddResponseListener =
  Notifications.addNotificationResponseReceivedListener as unknown as jest.Mock;
const mockGetLastNotificationResponse =
  Notifications.getLastNotificationResponseAsync as unknown as jest.Mock;

function makeResponse(data: Record<string, unknown>, identifier: string) {
  return {
    notification: { request: { identifier, content: { data } } },
    actionIdentifier: 'expo.notifications.onPress',
  } as any;
}

beforeEach(() => {
  mockAddResponseListener.mockClear();
  mockGetLastNotificationResponse.mockClear();
  mockGetLastNotificationResponse.mockResolvedValue(null);
});

describe('pathForNotificationData', () => {
  test('maps the screen/params contract to the project detail route', () => {
    expect(
      pathForNotificationData({ screen: 'ProjectDetail', params: { projectId: '42' } })
    ).toBe('/projects/42');
  });

  test('falls back to a bare projectId for legacy payloads', () => {
    expect(pathForNotificationData({ projectId: '7', type: 'project_update' })).toBe('/projects/7');
  });

  test('ignores payloads for unknown screens', () => {
    expect(
      pathForNotificationData({ screen: 'Settings', params: { projectId: '42' } })
    ).toBeNull();
  });

  test('ignores payloads without a projectId', () => {
    expect(pathForNotificationData({ screen: 'ProjectDetail', params: {} })).toBeNull();
    expect(pathForNotificationData(null)).toBeNull();
  });
});

describe('warm-start tap (addNotificationResponseReceivedListener)', () => {
  test('navigates to the project screen from the screen/params payload', () => {
    const push = jest.fn();
    setupNotificationResponseListener(push);

    const handler = mockAddResponseListener.mock.calls[0][0];
    handler(makeResponse({ screen: 'ProjectDetail', params: { projectId: '42' } }, 'warm-1'));

    expect(push).toHaveBeenCalledWith('/projects/42');
  });

  test('navigates for a legacy projectId-only payload', () => {
    const push = jest.fn();
    setupNotificationResponseListener(push);

    const handler = mockAddResponseListener.mock.calls[0][0];
    handler(makeResponse({ projectId: '9', type: 'project_update' }, 'warm-2'));

    expect(push).toHaveBeenCalledWith('/projects/9');
  });

  test('does not navigate for notifications without navigation data', () => {
    const push = jest.fn();
    setupNotificationResponseListener(push);

    const handler = mockAddResponseListener.mock.calls[0][0];
    handler(makeResponse({ misc: true }, 'warm-3'));

    expect(push).not.toHaveBeenCalled();
  });
});

describe('cold-start tap (getLastNotificationResponseAsync)', () => {
  test('launches on the relevant project screen', async () => {
    mockGetLastNotificationResponse.mockResolvedValue(
      makeResponse({ screen: 'ProjectDetail', params: { projectId: '55' } }, 'cold-1')
    );
    const push = jest.fn();

    await navigateFromInitialNotification(push);

    expect(push).toHaveBeenCalledWith('/projects/55');
  });

  test('stays on Home when the app was not opened by a notification', async () => {
    mockGetLastNotificationResponse.mockResolvedValue(null);
    const push = jest.fn();

    await navigateFromInitialNotification(push);

    expect(push).not.toHaveBeenCalled();
  });

  test('a cold-start response also delivered to the warm listener navigates once', async () => {
    mockGetLastNotificationResponse.mockResolvedValue(
      makeResponse({ screen: 'ProjectDetail', params: { projectId: '60' } }, 'dup-1')
    );
    const push = jest.fn();
    setupNotificationResponseListener(push);

    await navigateFromInitialNotification(push);
    const handler = mockAddResponseListener.mock.calls[0][0];
    handler(makeResponse({ screen: 'ProjectDetail', params: { projectId: '60' } }, 'dup-1'));

    expect(push).toHaveBeenCalledTimes(1);
  });

  test('swallows native errors from getLastNotificationResponseAsync', async () => {
    mockGetLastNotificationResponse.mockRejectedValue(new Error('boom'));
    const push = jest.fn();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(navigateFromInitialNotification(push)).resolves.toBeUndefined();
    expect(push).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
