/**
 * __tests__/useKeyboardAvoidance.test.tsx
 *
 * Covers the keyboard-avoidance plumbing added for issue #1127 — the
 * software keyboard used to cover the donation amount field on small
 * (5-inch Android / iPhone SE) screens.
 *
 * Two layers are exercised:
 *
 *  1. The pure helpers (`getKeyboardAvoidingBehavior`,
 *     `getKeyboardDismissMode`, `computeInputScrollTarget`). These own
 *     the geometry, so the "is the focused field actually visible?"
 *     decision is testable without a device, and the iOS *and* Android
 *     branches are reachable from a single test run because the platform
 *     is an argument rather than a module-level constant.
 *  2. The `useKeyboardAvoidance` hook itself — keyboard listeners,
 *     scroll-offset tracking, and the `scrollTo` call that keeps the
 *     focused input above the keyboard.
 *
 * The geometry fixtures use real small-screen numbers (a 375 pt tall
 * viewport with a ~291 pt iPhone SE keyboard, a 640 pt Android screen
 * with a ~300 pt keyboard) so a regression here is a regression a user
 * would actually have hit.
 */
import { act, render } from '@testing-library/react-native';
import * as React from 'react';
import { Keyboard, Platform, type ScrollView } from 'react-native';

import {
  computeInputScrollTarget,
  getKeyboardAvoidingBehavior,
  getKeyboardDismissMode,
  KEYBOARD_CONTENT_PADDING,
  KEYBOARD_INPUT_GAP,
  useKeyboardAvoidance,
  type MeasurableNode,
  type UseKeyboardAvoidanceOptions,
  type UseKeyboardAvoidanceResult,
} from '../hooks/useKeyboardAvoidance';

jest.setTimeout(30000);

type KeyboardCallback = (event: never) => void;

const listeners: Record<string, KeyboardCallback[]> = {};

/**
 * `Keyboard.addListener` returns a full `EmitterSubscription`; the fake only
 * needs `remove()`. The cast keeps the mock honest without hand-rolling the
 * six other subscription fields.
 */
function recordListener(eventName: string, callback: KeyboardCallback) {
  (listeners[eventName] = listeners[eventName] || []).push(callback);
  return { remove: jest.fn() } as unknown as ReturnType<typeof Keyboard.addListener>;
}

const addListenerSpy = jest
  .spyOn(Keyboard, 'addListener')
  .mockImplementation(recordListener as unknown as typeof Keyboard.addListener);

/** Fire a synthetic `Keyboard` event at every registered listener. */
function emitKeyboardEvent(eventName: string, payload?: unknown): void {
  act(() => {
    (listeners[eventName] || []).forEach((callback) =>
      (callback as (event: unknown) => void)(payload)
    );
  });
}

const KEYBOARD_SHOW_EVENT = {
  duration: 250,
  easing: 'keyboard',
  endCoordinates: { screenX: 0, screenY: 46, width: 375, height: 291 },
};

beforeEach(() => {
  for (const key of Object.keys(listeners)) delete listeners[key];
  jest.clearAllMocks();
  addListenerSpy.mockImplementation(
    recordListener as unknown as typeof Keyboard.addListener
  );
});

afterAll(() => {
  addListenerSpy.mockRestore();
});

// ── Platform configuration ───────────────────────────────────────────────────

describe('keyboard avoidance platform configuration (issue #1127)', () => {
  it("uses behavior='height' on iOS", () => {
    // iOS never resizes the window for the keyboard, so the container has
    // to shrink to leave the inner ScrollView room to scroll.
    expect(getKeyboardAvoidingBehavior('ios')).toBe('height');
  });

  it("uses behavior='padding' on Android", () => {
    // Android resizes the window itself (adjustResize, pinned in
    // app.json), so padding is what lines the form up with it.
    expect(getKeyboardAvoidingBehavior('android')).toBe('padding');
  });

  it("uses behavior='padding' on every other platform", () => {
    // Web / macOS / windows have no software keyboard to avoid, and
    // `padding` is the safe no-op there.
    expect(getKeyboardAvoidingBehavior('web')).toBe('padding');
    expect(getKeyboardAvoidingBehavior('windows')).toBe('padding');
    expect(getKeyboardAvoidingBehavior('macos')).toBe('padding');
  });

  it('defaults to the current Platform.OS when no argument is given', () => {
    expect(getKeyboardAvoidingBehavior()).toBe(Platform.OS === 'ios' ? 'height' : 'padding');
    expect(getKeyboardDismissMode()).toBe(Platform.OS === 'ios' ? 'interactive' : 'on-drag');
  });

  it("uses keyboardDismissMode='interactive' on iOS and 'on-drag' on Android", () => {
    expect(getKeyboardDismissMode('ios')).toBe('interactive');
    expect(getKeyboardDismissMode('android')).toBe('on-drag');
    expect(getKeyboardDismissMode('web')).toBe('on-drag');
  });
});

// ── Scroll-into-view geometry ────────────────────────────────────────────────

describe('computeInputScrollTarget', () => {
  it('returns null when the focused input is already fully visible', () => {
    // Viewport 0..600 (keyboard open, KeyboardAvoidingView shrank it),
    // input at 300..350 with 24 pt of room to spare.
    expect(
      computeInputScrollTarget({
        inputTop: 300,
        inputBottom: 350,
        viewportTop: 0,
        viewportBottom: 600,
        scrollOffset: 120,
      })
    ).toBeNull();
  });

  it('returns null when the input bottom lands exactly on the gap line', () => {
    expect(
      computeInputScrollTarget({
        inputTop: 100,
        inputBottom: 100 + 50,
        viewportTop: 0,
        viewportBottom: 174,
        scrollOffset: 0,
      })
    ).toBeNull();
  });

  it('scrolls down just enough to lift a keyboard-covered input into view', () => {
    // Small Android device: 640 pt screen, ~300 pt keyboard, so the
    // KeyboardAvoidingView leaves a 0..340 viewport. The amount field
    // measures 300..350 in window coordinates, i.e. the bottom 10 pt sit
    // behind the keyboard.
    // overflow = 350 - (340 - 24) = 34
    expect(
      computeInputScrollTarget({
        inputTop: 300,
        inputBottom: 350,
        viewportTop: 0,
        viewportBottom: 340,
        scrollOffset: 0,
      })
    ).toBe(34);
  });

  it('adds to the current scroll offset instead of replacing it', () => {
    expect(
      computeInputScrollTarget({
        inputTop: 900,
        inputBottom: 950,
        viewportTop: 0,
        viewportBottom: 600,
        scrollOffset: 400,
      })
    ).toBe(774);
  });

  it('honours a caller-supplied gap', () => {
    const geometry = {
      inputTop: 500,
      inputBottom: 550,
      viewportTop: 0,
      viewportBottom: 600,
      scrollOffset: 0,
    };
    // 550 - (600 - 100) = 50 with a 100 pt gap …
    expect(computeInputScrollTarget({ ...geometry, gap: 100 })).toBe(50);
    // … and 550 - (600 - 8) = 0 with an 8 pt gap (already clear).
    expect(computeInputScrollTarget({ ...geometry, gap: 8 })).toBeNull();
  });

  it('aligns the top edge when the input is taller than the usable viewport', () => {
    // A 500 pt tall field inside a 200 pt usable viewport can never fully
    // fit, so the top edge is anchored (250) instead of chasing the
    // unreachable bottom edge.
    expect(
      computeInputScrollTarget({
        inputTop: 150,
        inputBottom: 650,
        viewportTop: 0,
        viewportBottom: 224,
        scrollOffset: 0,
      })
    ).toBe(150);
  });

  it('scrolls back up when the input has been dragged off the top edge', () => {
    // The whole field (‑60..‑10) sits above the viewport, so it is
    // scrolled back by exactly the 10 pt that is missing.
    expect(
      computeInputScrollTarget({
        inputTop: -60,
        inputBottom: -10,
        viewportTop: 0,
        viewportBottom: 400,
        scrollOffset: 300,
      })
    ).toBe(290);
  });

  it('never returns a negative scroll offset', () => {
    // Would ask for -10; the ScrollView clamps to 0 instead.
    expect(
      computeInputScrollTarget({
        inputTop: -60,
        inputBottom: -10,
        viewportTop: 0,
        viewportBottom: 100,
        scrollOffset: 10,
      })
    ).toBe(0);
  });

  it('returns null for non-finite measurements', () => {
    expect(
      computeInputScrollTarget({
        inputTop: Number.NaN,
        inputBottom: 350,
        viewportTop: 0,
        viewportBottom: 340,
        scrollOffset: 0,
      })
    ).toBeNull();
    expect(
      computeInputScrollTarget({
        inputTop: 300,
        inputBottom: 350,
        viewportTop: 0,
        viewportBottom: Number.POSITIVE_INFINITY,
        scrollOffset: 0,
      })
    ).toBeNull();
  });

  it('defaults the gap to KEYBOARD_INPUT_GAP', () => {
    // 350 - (340 - KEYBOARD_INPUT_GAP)
    expect(
      computeInputScrollTarget({
        inputTop: 300,
        inputBottom: 350,
        viewportTop: 0,
        viewportBottom: 340,
        scrollOffset: 0,
      })
    ).toBe(10 + KEYBOARD_INPUT_GAP);
  });
});

// ── Hook ─────────────────────────────────────────────────────────────────────

/** Stub that reports fixed window coordinates, like `measureInWindow`. */
function makeMeasurable(
  x: number,
  y: number,
  width: number,
  height: number
): MeasurableNode {
  return {
    measureInWindow: (callback) => callback(x, y, width, height),
  };
}

function attachFakeScrollView(
  ref: { current: ScrollView | null },
  { top, height }: { top: number; height: number }
) {
  const scrollTo = jest.fn();
  const fake = {
    measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) =>
      callback(0, top, 375, height),
    scrollTo,
  };
  ref.current = fake as unknown as ScrollView;
  return scrollTo;
}

/**
 * `renderHook` is unusable in this repo's Jest rig: RNTL 12's
 * `render-hook` does `_interopRequireDefault(require('react')).default`,
 * and `mobile/jest.globals-polyfill.js` sets `React.__esModule = true`
 * (so `act` resolves), which makes `_interopRequireDefault` return the
 * module itself and leaves `.default` undefined. Rendering a null-return
 * harness that stashes the hook result sidesteps it entirely.
 *
 * The result is handed back through a `read()` closure rather than a
 * destructured value on purpose: `const { result } = renderHook()` would
 * evaluate a getter exactly once and then never observe a later render.
 */
function renderKeyboardAvoidance(options?: UseKeyboardAvoidanceOptions) {
  const store: { current: UseKeyboardAvoidanceResult | null } = { current: null };

  function Harness() {
    store.current = useKeyboardAvoidance(options);
    return null;
  }

  const { unmount } = render(<Harness />);
  return {
    read: (): UseKeyboardAvoidanceResult => {
      if (!store.current) throw new Error('useKeyboardAvoidance did not render');
      return store.current;
    },
    unmount,
  };
}

describe('useKeyboardAvoidance', () => {
  it('starts with the keyboard closed and no extra content padding', () => {
    const { read } = renderKeyboardAvoidance();

    expect(read().keyboardVisible).toBe(false);
    expect(read().keyboardHeight).toBe(0);
    expect(read().contentPaddingBottom).toBe(0);
    expect(read().keyboardVerticalOffset).toBe(0);
  });

  it('exposes the platform-correct behaviour for KeyboardAvoidingView', () => {
    const { read } = renderKeyboardAvoidance();

    expect(read().behavior).toBe(
      Platform.OS === 'ios' ? 'height' : 'padding'
    );
    expect(read().dismissMode).toBe(
      Platform.OS === 'ios' ? 'interactive' : 'on-drag'
    );
  });

  it('registers keyboardDidShow / keyboardDidHide listeners and removes them on unmount', () => {
    const { unmount } = renderKeyboardAvoidance();

    expect(listeners.keyboardDidShow).toHaveLength(1);
    expect(listeners.keyboardDidHide).toHaveLength(1);

    const removeShow = (addListenerSpy.mock.results[0]?.value as { remove: jest.Mock })?.remove;
    const removeHide = (addListenerSpy.mock.results[1]?.value as { remove: jest.Mock })?.remove;
    unmount();
    expect(removeShow).toHaveBeenCalled();
    expect(removeHide).toHaveBeenCalled();
  });

  it('tracks keyboard height and adds content padding while the keyboard is open', () => {
    const { read } = renderKeyboardAvoidance();

    emitKeyboardEvent('keyboardDidShow', KEYBOARD_SHOW_EVENT);

    expect(read().keyboardVisible).toBe(true);
    expect(read().keyboardHeight).toBe(291);
    expect(read().contentPaddingBottom).toBe(KEYBOARD_CONTENT_PADDING);
  });

  it('falls back to a zero height when the event carries no coordinates', () => {
    const { read } = renderKeyboardAvoidance();

    emitKeyboardEvent('keyboardDidShow', undefined);
    emitKeyboardEvent('keyboardDidHide', undefined);

    expect(read().keyboardVisible).toBe(false);
    expect(read().keyboardHeight).toBe(0);
  });

  it('honours contentPadding / keyboardVerticalOffset overrides', () => {
    const { read } = renderKeyboardAvoidance({
      contentPadding: 120,
      keyboardVerticalOffset: 64,
    });

    expect(read().keyboardVerticalOffset).toBe(64);
    emitKeyboardEvent('keyboardDidShow', KEYBOARD_SHOW_EVENT);
    expect(read().contentPaddingBottom).toBe(120);
  });

  it('resets the keyboard state on keyboardDidHide', () => {
    const { read } = renderKeyboardAvoidance();

    emitKeyboardEvent('keyboardDidShow', KEYBOARD_SHOW_EVENT);
    emitKeyboardEvent('keyboardDidHide', { endCoordinates: { height: 0 } });

    expect(read().keyboardVisible).toBe(false);
    expect(read().keyboardHeight).toBe(0);
    expect(read().contentPaddingBottom).toBe(0);
  });

  it('scrolls a focused, keyboard-covered input into view', () => {
    const { read } = renderKeyboardAvoidance();
    const scrollTo = attachFakeScrollView(read().scrollRef, { top: 0, height: 340 });

    act(() => {
      read().scrollInputIntoView(makeMeasurable(16, 300, 343, 50));
    });

    expect(scrollTo).toHaveBeenCalledWith({ y: 34, animated: true });
  });

  it('does not scroll when the focused input is already visible', () => {
    const { read } = renderKeyboardAvoidance();
    const scrollTo = attachFakeScrollView(read().scrollRef, { top: 0, height: 600 });

    act(() => {
      read().scrollInputIntoView(makeMeasurable(16, 300, 343, 50));
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('re-scrolls the last focused input once the keyboard finishes animating', () => {
    const { read } = renderKeyboardAvoidance();
    // Before the keyboard opens the viewport is the full 640 pt screen,
    // so the amount field at 300..350 needs no scrolling …
    const scrollTo = attachFakeScrollView(read().scrollRef, { top: 0, height: 640 });

    act(() => {
      read().scrollInputIntoView(makeMeasurable(16, 300, 343, 50));
    });
    expect(scrollTo).not.toHaveBeenCalled();

    // … but once KeyboardAvoidingView has shrunk the viewport to 340 pt
    // the very same field is behind the keyboard and must be lifted.
    (read().scrollRef.current as unknown as MeasurableNode).measureInWindow = (
      callback: (x: number, y: number, w: number, h: number) => void
    ) => callback(0, 0, 375, 340);

    emitKeyboardEvent('keyboardDidShow', KEYBOARD_SHOW_EVENT);

    expect(scrollTo).toHaveBeenCalledWith({ y: 34, animated: true });
  });

  it('uses the tracked scroll offset when computing the next target', () => {
    const { read } = renderKeyboardAvoidance();
    const scrollTo = attachFakeScrollView(read().scrollRef, { top: 0, height: 600 });

    act(() => {
      read().onScroll({
        nativeEvent: {
          contentOffset: { x: 0, y: 250 },
          contentSize: { width: 375, height: 2000 },
          layoutMeasurement: { width: 375, height: 600 },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      read().scrollInputIntoView(makeMeasurable(16, 500, 343, 50));
    });

    // 550 - (600 - 24) = -26 → no overflow, but the top overflow check
    // must not fire either, so nothing scrolls.
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => {
      read().scrollInputIntoView(makeMeasurable(16, 560, 343, 50));
    });
    // 610 - (600 - 24) = 34, applied on top of the tracked 250 offset.
    expect(scrollTo).toHaveBeenCalledWith({ y: 284, animated: true });
  });

  it('ignores scroll events without a usable contentOffset', () => {
    const { read } = renderKeyboardAvoidance();
    const scrollTo = attachFakeScrollView(read().scrollRef, { top: 0, height: 600 });

    act(() => {
      read().onScroll({} as never);
      read().onScroll({ nativeEvent: { contentOffset: { y: 'nope' } } } as never);
      read().scrollInputIntoView(makeMeasurable(16, 560, 343, 50));
    });

    // The tracked offset stayed 0, so the target is the un-offset 34.
    expect(scrollTo).toHaveBeenCalledWith({ y: 34, animated: true });
  });

  it('is a no-op when no ScrollView ref or no measuring bridge is available', () => {
    const { read } = renderKeyboardAvoidance();

    // No ScrollView attached yet (first layout pass).
    act(() => {
      read().scrollInputIntoView(makeMeasurable(16, 300, 343, 50));
    });

    // A ref without `measureInWindow` — some test renderers, and
    // unmounted components, hand back exactly this.
    const scrollTo = jest.fn();
    read().scrollRef.current = { scrollTo } as unknown as ScrollView;
    act(() => {
      read().scrollInputIntoView(makeMeasurable(16, 300, 343, 50));
    });

    // A ScrollView attached, but the input cannot be measured.
    attachFakeScrollView(read().scrollRef, { top: 0, height: 340 });
    act(() => {
      read().scrollInputIntoView({});
      read().scrollInputIntoView(null);
      read().scrollInputIntoView(undefined);
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('survives a measuring bridge that throws', () => {
    const { read } = renderKeyboardAvoidance();
    attachFakeScrollView(read().scrollRef, { top: 0, height: 340 });

    act(() => {
      expect(() =>
        read().scrollInputIntoView({
          measureInWindow: () => {
            throw new Error('view not laid out');
          },
        })
      ).not.toThrow();
    });
  });

  it('unmounts cleanly when a listener subscription has no remove() method', () => {
    // Regression guard for the mock-shape trap documented in
    // mobile/TEST-SETUP.md: some community mocks return a bare object from
    // `Keyboard.addListener`, and calling `remove()` on it would throw
    // during RNTL's afterEach unmount.
    addListenerSpy.mockImplementation(
      (() => ({})) as unknown as typeof Keyboard.addListener
    );

    const { unmount } = renderKeyboardAvoidance();
    expect(() => unmount()).not.toThrow();
  });
});
