/**
 * __tests__/useDeepLink.test.ts
 * Tests for the useDeepLink hook.
 */
import { renderHook, act } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockGetInitialURL = jest.fn(() => Promise.resolve(null));
const mockAddEventListener = jest.fn(() => ({ remove: jest.fn() }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('expo-linking', () => ({
  getInitialURL: () => mockGetInitialURL(),
  addEventListener: (...args: unknown[]) => mockAddEventListener(...args),
  parse: (url: string) => {
    const match = url.match(/^greenpay:\/\/(.+)/);
    return { path: match ? match[1] : null };
  },
}));

import { useDeepLink } from '../hooks/useDeepLink';

beforeEach(() => {
  mockPush.mockClear();
});

test('navigates to project screen on cold start', async () => {
  mockGetInitialURL.mockResolvedValueOnce('greenpay://project/42');
  const { unmount } = renderHook(() => useDeepLink());
  await act(async () => {});
  expect(mockPush).toHaveBeenCalledWith('/projects/42');
  unmount();
});

test('navigates to donate screen on cold start', async () => {
  mockGetInitialURL.mockResolvedValueOnce('greenpay://donate/GABCXYZ');
  const { unmount } = renderHook(() => useDeepLink());
  await act(async () => {});
  expect(mockPush).toHaveBeenCalledWith('/donate/GABCXYZ');
  unmount();
});

test('handles warm-start url event for project', async () => {
  let urlHandler: ((e: { url: string }) => void) | undefined;
  mockAddEventListener.mockImplementationOnce((_event: string, handler: (e: { url: string }) => void) => {
    urlHandler = handler;
    return { remove: jest.fn() };
  });

  const { unmount } = renderHook(() => useDeepLink());
  await act(async () => {
    urlHandler?.({ url: 'greenpay://project/99' });
  });
  expect(mockPush).toHaveBeenCalledWith('/projects/99');
  unmount();
});

test('does not navigate for unknown path segments', async () => {
  mockGetInitialURL.mockResolvedValueOnce('greenpay://unknown/123');
  const { unmount } = renderHook(() => useDeepLink());
  await act(async () => {});
  expect(mockPush).not.toHaveBeenCalled();
  unmount();
});
