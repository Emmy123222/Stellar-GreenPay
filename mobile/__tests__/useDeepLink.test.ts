/**
 * __tests__/useDeepLink.test.ts
 * Tests for the useDeepLink hook.
 *
 * Covers:
 *  - Valid deep links navigate to the correct screen
 *  - Invalid projectId format is rejected with an alert
 *  - Path traversal and oversized inputs are blocked
 */
import { renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockPush = jest.fn();
const mockGetInitialURL = jest.fn((): Promise<string | null> => Promise.resolve(null));
const mockAddEventListener = jest.fn((_event: string, _handler: any) => ({ remove: jest.fn() }));

// Mock Alert.alert to verify it's called for invalid links
const mockAlert = jest.fn();
jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  Alert: {
    alert: mockAlert,
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('expo-linking', () => ({
  getInitialURL: () => mockGetInitialURL(),
  addEventListener: (event: string, handler: any) => mockAddEventListener(event, handler),
  parse: (url: string) => {
    const match = url.match(/^greenpay:\/\/(.+)/);
    return { path: match ? match[1] : null };
  },
}));

import { useDeepLink } from '../src/hooks/useDeepLink';

beforeEach(() => {
  mockPush.mockClear();
  mockAlert.mockClear();
});

test('navigates to project screen on cold start', async () => {
  mockGetInitialURL.mockResolvedValueOnce('greenpay://project/42');
  const { unmount } = await renderHook(() => useDeepLink());
  expect(mockPush).toHaveBeenCalledWith('/projects/42');
  unmount();
});

test('navigates to donate screen on cold start', async () => {
  mockGetInitialURL.mockResolvedValueOnce('greenpay://donate/GABCXYZ');
  const { unmount } = await renderHook(() => useDeepLink());
  expect(mockPush).toHaveBeenCalledWith('/donate/GABCXYZ');
  unmount();
});

test('handles warm-start url event for project', async () => {
  let urlHandler: ((e: { url: string }) => void) | undefined;
  mockAddEventListener.mockImplementationOnce((_event: string, handler: (e: { url: string }) => void) => {
    urlHandler = handler;
    return { remove: jest.fn() };
  });

  const { unmount } = await renderHook(() => useDeepLink());
  urlHandler?.({ url: 'greenpay://project/99' });
  expect(mockPush).toHaveBeenCalledWith('/projects/99');
  unmount();
});

test('does not navigate for unknown path segments', async () => {
  mockGetInitialURL.mockResolvedValueOnce('greenpay://unknown/123');
  const { unmount } = await renderHook(() => useDeepLink());
  expect(mockPush).not.toHaveBeenCalled();
  unmount();
});

// ─── Project ID validation tests ──────────────────────────────────────────────

describe('projectId validation', () => {
  // Valid projectId formats
  const VALID_PROJECT_IDS = [
    'GABCXYZ',                    // Simple alphanumeric
    'project-123',                // With hyphen
    'my_project',                 // With underscore
    'A'.repeat(64),               // Max length (64 chars)
    'abc-123_ABC',                // Mixed valid chars
    'G'.repeat(56),               // Stellar key-like (56 chars)
  ];

  // Invalid projectId formats - should be rejected
  const INVALID_PROJECT_IDS = [
    '../etc/passwd',              // Path traversal attempt
    '../../../secret',            // Path traversal
    'GABC/XYZ',                   // Contains slash
    'GABC\XYZ',                  // Contains backslash
    'GABC>XYZ',                   // Contains special char
    'GABC<XYZ',                   // Contains special char
    'GABC|XYZ',                   // Contains pipe
    'GABC&XYZ',                   // Contains ampersand
    'GABC$XYZ',                   // Contains dollar sign
    'GABC XYZ',                   // Contains space
    'GABC"XYZ',                   // Contains quote
    "GABC'XYZ",                  // Contains single quote
    'GABC`XYZ',                   // Contains backtick
    'GABC;.XYZ',                  // Contains semicolon/dot
    'GABC\nXYZ',                  // Contains newline
    'GABC\rXYZ',                  // Contains carriage return
    '💰'.repeat(10),               // Unicode characters
    'a'.repeat(65),               // Too long (>64 chars)
    '',                            // Empty string
    'GABC XYZ',                   // Contains space
  ];

  VALID_PROJECT_IDS.forEach((projectId) => {
    test(`validates projectId: "${projectId.slice(0, 20)}${projectId.length > 20 ? '...' : ''}" (${projectId.length} chars) → navigation`, async () => {
      mockGetInitialURL.mockResolvedValueOnce(`greenpay://donate/${projectId}`);
      const { unmount } = await renderHook(() => useDeepLink());
      expect(mockPush).toHaveBeenCalledWith(`/donate/${projectId}`);
      expect(mockAlert).not.toHaveBeenCalled();
      unmount();
    });
  });

  INVALID_PROJECT_IDS.forEach((projectId) => {
    test(`rejects invalid projectId: "${projectId.slice(0, 30)}${projectId.length > 30 ? '...' : ''}" → alert shown`, async () => {
      mockGetInitialURL.mockResolvedValueOnce(`greenpay://donate/${projectId}`);
      const { unmount } = await renderHook(() => useDeepLink());
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockAlert).toHaveBeenCalledWith('Invalid link format', expect.any(String));
      unmount();
    });
  });

  test('validates project deep links with valid projectId', async () => {
    mockGetInitialURL.mockResolvedValueOnce('greenpay://project/valid-project-123');
    const { unmount } = await renderHook(() => useDeepLink());
    expect(mockPush).toHaveBeenCalledWith('/projects/valid-project-123');
    expect(mockAlert).not.toHaveBeenCalled();
    unmount();
  });

  test('rejects project deep links with invalid projectId', async () => {
    mockGetInitialURL.mockResolvedValueOnce('greenpay://project/../../../etc/passwd');
    const { unmount } = await renderHook(() => useDeepLink());
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('Invalid link format', expect.any(String));
    unmount();
  });

  test('handles warm-start url event with valid projectId', async () => {
    let urlHandler: ((e: { url: string }) => void) | undefined;
    mockAddEventListener.mockImplementationOnce((_event: string, handler: (e: { url: string }) => void) => {
      urlHandler = handler;
      return { remove: jest.fn() };
    });

    const { unmount } = await renderHook(() => useDeepLink());
    urlHandler?.({ url: 'greenpay://donate/valid-project' });
    expect(mockPush).toHaveBeenCalledWith('/donate/valid-project');
    expect(mockAlert).not.toHaveBeenCalled();
    unmount();
  });

  test('handles warm-start url event with invalid projectId', async () => {
    let urlHandler: ((e: { url: string }) => void) | undefined;
    mockAddEventListener.mockImplementationOnce((_event: string, handler: (e: { url: string }) => void) => {
      urlHandler = handler;
      return { remove: jest.fn() };
    });

    const { unmount } = await renderHook(() => useDeepLink());
    urlHandler?.({ url: 'greenpay://donate/invalid/project' });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('Invalid link format', expect.any(String));
    unmount();
  });
});
