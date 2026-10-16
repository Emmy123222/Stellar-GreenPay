/**
 * __tests__/DonateScreen.keyboard.test.tsx
 *
 * Issue #1127 — the software keyboard covered the donation amount field
 * on small screens (5" Android handsets, iPhone SE), so the user typed
 * into a box they could not see.
 *
 * This file pins the *wiring* on the screen: the form is wrapped in a
 * `KeyboardAvoidingView` with the platform-correct `behavior`, the
 * `ScrollView` is configured so its tap targets survive the keyboard, and
 * every field asks `useKeyboardAvoidance()` to scroll itself into view.
 * The scroll geometry itself is covered by
 * `__tests__/useKeyboardAvoidance.test.tsx`.
 *
 * It lives next to (rather than inside) `DonateScreen.test.tsx` on
 * purpose: that file has pre-existing failures that are unrelated to
 * this issue, and a reviewer should be able to see this suite go green
 * in isolation.
 */
import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import axios from 'axios';

jest.mock('../hooks/useBiometricAuth', () => {
  const state = {
    available: true,
    enrolled: true,
    isAuthenticating: false,
    lastResult: null as null | { success: boolean; outcome: string },
    label: 'Biometrics',
    authenticate: jest.fn(),
    refresh: jest.fn(),
  };
  return {
    __esModule: true,
    useBiometricAuth: () => state,
    authenticate: jest.fn(),
  };
});

// Stub the theme so the screen doesn't pull in the ThemeProvider chain.
jest.mock('../app/theme', () => ({
  useTheme: () => ({
    mode: 'light',
    colors: {
      background: '#f0f7f0',
      surface: '#ffffff',
      primary: '#227239',
      accent: '#1a2e1a',
      header: '#227239',
      headerText: '#ffffff',
      buttonBackground: '#227239',
      buttonText: '#ffffff',
      cardBorder: '#e8f3e8',
      cardShadow: '#000000',
      primaryText: '#1a2e1a',
      secondaryText: '#5a7a5a',
      muted: '#8aaa8a',
      inputBackground: '#ffffff',
      inputBorder: '#e8f3e8',
      placeholder: '#8aaa8a',
      border: '#d8e4d8',
      statusBarStyle: 'dark',
    },
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'proj-1' }),
}));

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn().mockResolvedValue(false),
  openURL: jest.fn(),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

// Silences the React Native Animated `act()` warnings (see
// ProjectDetailScreen.test.tsx for the same pattern).
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'Amazon Reforestation',
  walletAddress: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
};

import DonateScreen from '../app/donate/[id]';
import * as keyboardAvoidanceHook from '../hooks/useKeyboardAvoidance';

/**
 * `expo-notifications` runs a slow module-init path under our
 * `expo-modules-core` Proxy stub, and the default 5 s Jest timeout is too
 * tight for a suite that re-renders DonateScreen per test.
 */
jest.setTimeout(30000);

const originalOS = Platform.OS;

/** Swap the platform `Platform.OS` reports, restoring it in `afterEach`. */
function setPlatform(os: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });
});

afterEach(() => {
  setPlatform(originalOS as 'ios' | 'android');
});

async function renderScreen() {
  // `render` is synchronous in RNTL 12 — wrapping it in `act()` (as some
  // older suites here do) makes RNTL's host-component probe unmount the
  // renderer before it can inspect it, so it is called bare.
  const utils = render(<DonateScreen />);
  await waitFor(() =>
    expect(utils.getByText('Donate to Amazon Reforestation')).toBeTruthy()
  );
  return utils;
}

describe('DonateScreen – keyboard avoidance (issue #1127)', () => {
  it('wraps the donation form in a KeyboardAvoidingView', async () => {
    const { UNSAFE_getByType, getByTestId } = await renderScreen();

    const avoiding = UNSAFE_getByType(KeyboardAvoidingView);
    expect(avoiding).toBeTruthy();
    expect(avoiding.props.testID).toBe('donate-keyboard-avoiding-view');
    // The scrollable form is the KAV's only child, so the whole form
    // shifts out from under the keyboard rather than just one field.
    expect(getByTestId('donate-form-scroll')).toBeTruthy();
  });

  it("uses behavior='height' on iOS", async () => {
    setPlatform('ios');
    const { UNSAFE_getByType } = await renderScreen();

    // iOS never resizes the window for the keyboard, so the container has
    // to shrink and the inner ScrollView scrolls within it.
    expect(UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('height');
  });

  it("uses behavior='padding' on Android", async () => {
    setPlatform('android');
    const { UNSAFE_getByType } = await renderScreen();

    // Android resizes the window itself (softwareKeyboardLayoutMode:
    // "resize" in app.json), so padding is what lines the form up with it.
    expect(UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
  });

  it('keeps the first tap on preset chips / the Donate button working with the keyboard open', async () => {
    const { getByTestId } = await renderScreen();

    // Without `handled`, the keyboard swallows the first tap on any
    // TouchableOpacity inside the ScrollView — the user would tap
    // "🌱 Donate" and nothing would happen.
    expect(getByTestId('donate-form-scroll').props.keyboardShouldPersistTaps).toBe(
      'handled'
    );
  });

  it("uses the platform drag-to-dismiss mode ('interactive' on iOS, 'on-drag' on Android)", async () => {
    setPlatform('ios');
    const ios = await renderScreen();
    expect(ios.getByTestId('donate-form-scroll').props.keyboardDismissMode).toBe(
      'interactive'
    );
    ios.unmount();

    setPlatform('android');
    const android = await renderScreen();
    expect(android.getByTestId('donate-form-scroll').props.keyboardDismissMode).toBe(
      'on-drag'
    );
  });

  it('reports scroll events so the hook can keep the focused field visible', async () => {
    const { getByTestId } = await renderScreen();

    const form = getByTestId('donate-form-scroll');
    expect(typeof form.props.onScroll).toBe('function');
    // Without a throttle RN only fires onScroll on scroll-end, which is
    // too late to know where the field is when the keyboard opens.
    expect(form.props.scrollEventThrottle).toBeGreaterThan(0);
  });

  it('scrolls the amount, secret and message fields into view when they are focused', async () => {
    const scrollInputIntoView = jest.fn();
    const useRealHook = keyboardAvoidanceHook.useKeyboardAvoidance;
    const spy = jest
      .spyOn(keyboardAvoidanceHook, 'useKeyboardAvoidance')
      .mockImplementation((options) => ({
        ...useRealHook(options),
        scrollInputIntoView,
      }));

    try {
      const { getByLabelText } = await renderScreen();

      const amount = getByLabelText('Custom donation amount in XLM');
      const secret = getByLabelText('Stellar secret key for signing');
      const message = getByLabelText('Optional donation message');

      // The amount field is the one the issue is about; the other two are
      // wired the same way so the whole form behaves consistently.
      fireEvent(amount, 'focus');
      fireEvent(secret, 'focus');
      fireEvent(message, 'focus');

      expect(scrollInputIntoView).toHaveBeenCalledTimes(3);
      // Each call must hand over that input's own ref so the hook can
      // measure it — a `null` would silently skip the scroll.
      expect(
        scrollInputIntoView.mock.calls.every(([node]) => node != null)
      ).toBe(true);
      // …and the three fields must not all resolve to the same node.
      expect(new Set(scrollInputIntoView.mock.calls).size).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

  it('grows the scrollable content while the keyboard is open', async () => {
    const listeners: Record<string, Array<(event: never) => void>> = {};
    const addListener = jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation(((eventName: string, callback: (event: never) => void) => {
        (listeners[eventName] = listeners[eventName] || []).push(callback);
        return { remove: jest.fn() };
      }) as unknown as typeof Keyboard.addListener);

    try {
      const { getByTestId } = await renderScreen();
      const paddingWhileClosed = StyleSheet.flatten(
        getByTestId('donate-form-scroll').props.contentContainerStyle
      ).paddingBottom;

      await act(async () => {
        (listeners.keyboardDidShow || []).forEach((callback) =>
          (callback as (event: unknown) => void)({ endCoordinates: { height: 291 } })
        );
      });

      const paddingWhileOpen = StyleSheet.flatten(
        getByTestId('donate-form-scroll').props.contentContainerStyle
      ).paddingBottom;

      // The extra room at the bottom is what lets the last field — and the
      // Donate button under it — scroll clear of the keyboard.
      expect(paddingWhileClosed).toBe(16);
      expect(paddingWhileOpen).toBeGreaterThan(paddingWhileClosed);
    } finally {
      addListener.mockRestore();
    }
  });
});
