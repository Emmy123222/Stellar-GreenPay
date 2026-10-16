/**
 * hooks/useKeyboardAvoidance.ts
 *
 * Keyboard-avoidance plumbing for form screens (issue #1127).
 *
 * On 5-inch Android handsets the software keyboard used to cover the
 * donation amount field completely — the user was typing into a box they
 * could not see. Fixing that needs two separate things, and this hook
 * owns both so every form screen can share one implementation:
 *
 *  1. A platform-correct `KeyboardAvoidingView` configuration. iOS never
 *     resizes the window for the keyboard, so the container has to be
 *     shrunk (`behavior="height"`) to leave the inner `ScrollView` room
 *     to scroll. Android resizes the window itself
 *     (`android:windowSoftInputMode="adjustResize"`, pinned in
 *     `app.json`), so `behavior="padding"` is what lines the form up
 *     with the shrunken window.
 *  2. Scroll-into-view geometry that keeps the *focused* input above the
 *     keyboard even when the form is taller than the visible viewport
 *     (which it always is on an iPhone SE / 5" Android screen).
 *
 * The geometry is exported as a pure function so it can be unit tested
 * without mounting a screen, and the platform lookup takes the OS name as
 * an argument so both branches are testable from a single test run.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

export type KeyboardAvoidingBehavior = 'height' | 'padding' | 'position';
export type KeyboardDismissMode = 'none' | 'on-drag' | 'interactive';

/** Breathing room (pt) left between the focused input and the viewport edge. */
export const KEYBOARD_INPUT_GAP = 24;

/**
 * Extra bottom padding (pt) added to the scrollable content while the
 * keyboard is open. Small and fixed on purpose: the
 * `KeyboardAvoidingView` has already moved/shrunk the viewport, so the
 * only thing left to guarantee is that the *last* field (and the Donate
 * button under it) can be scrolled clear of the keyboard.
 */
export const KEYBOARD_CONTENT_PADDING = 32;

/**
 * The subset of a `TextInput` / `ScrollView` ref we rely on. Typed
 * structurally rather than via `React.Ref<TextInput>` so the hook can be
 * unit tested with plain stub objects and so `measureInWindow` — which
 * is absent in some test renderers — degrades to a no-op instead of
 * throwing.
 */
export interface MeasurableNode {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void
  ) => void;
}

/**
 * `KeyboardAvoidingView` behaviour for a platform.
 *
 * Anything that is not iOS gets `padding` — that matches Android's
 * `adjustResize` window and is the safest default for web / desktop,
 * where no software keyboard is involved at all.
 */
export function getKeyboardAvoidingBehavior(os: string = Platform.OS): KeyboardAvoidingBehavior {
  return os === 'ios' ? 'height' : 'padding';
}

/**
 * Drag-to-dismiss mode for the scrollable form. iOS gets the
 * interactive (rubber-band) dismissal; Android only supports
 * `on-drag`.
 */
export function getKeyboardDismissMode(os: string = Platform.OS): KeyboardDismissMode {
  return os === 'ios' ? 'interactive' : 'on-drag';
}

export interface InputVisibilityGeometry {
  /** `y` of the focused input in window coordinates. */
  inputTop: number;
  /** `y` + `height` of the focused input in window coordinates. */
  inputBottom: number;
  /**
   * `y` of the scrollable viewport in window coordinates. Measured from
   * the live `ScrollView` rather than derived from the window size, so it
   * is correct on Android (where the window itself shrinks for the
   * keyboard) as well as on iOS.
   */
  viewportTop: number;
  /** `y` + `height` of the scrollable viewport in window coordinates. */
  viewportBottom: number;
  /** Current vertical scroll offset of the `ScrollView`. */
  scrollOffset: number;
  /** Breathing room (pt) to leave between the input and the viewport edge. */
  gap?: number;
}

/**
 * Work out the absolute `scrollTo` offset that brings the focused input
 * fully into the visible viewport, or `null` when it is already visible
 * and no scrolling is required.
 *
 * The keyboard only ever obscures the *bottom* of the viewport, so the
 * bottom edge is checked first. The top edge is only used to recover a
 * field the user has dragged completely off-screen.
 */
export function computeInputScrollTarget(geometry: InputVisibilityGeometry): number | null {
  const { inputTop, inputBottom, viewportTop, viewportBottom, scrollOffset } = geometry;
  const gap = geometry.gap ?? KEYBOARD_INPUT_GAP;

  const values = [inputTop, inputBottom, viewportTop, viewportBottom, scrollOffset, gap];
  if (!values.every((value) => Number.isFinite(value))) return null;

  let target = scrollOffset;

  const bottomOverflow = inputBottom - (viewportBottom - gap);
  if (bottomOverflow > 0) {
    const available = viewportBottom - viewportTop - gap;
    const inputHeight = inputBottom - inputTop;
    // A field taller than the usable viewport can never fully fit, so
    // align its top edge instead of chasing an unreachable bottom edge.
    target = inputHeight > available
      ? scrollOffset + (inputTop - viewportTop)
      : scrollOffset + bottomOverflow;
  } else if (inputBottom < viewportTop) {
    target = scrollOffset - (viewportTop - inputBottom);
  }

  if (target === scrollOffset) return null;
  return Math.max(0, target);
}

export interface UseKeyboardAvoidanceOptions {
  /** Override the gap left between the focused input and the viewport edge. */
  inputGap?: number;
  /** Override the extra bottom content padding used while the keyboard is open. */
  contentPadding?: number;
  /** `KeyboardAvoidingView` vertical offset — set this when a header sits above the form. */
  keyboardVerticalOffset?: number;
}

export interface UseKeyboardAvoidanceResult {
  /** `true` between `keyboardDidShow` and `keyboardDidHide`. */
  keyboardVisible: boolean;
  /** Height (pt) of the software keyboard, `0` while it is closed. */
  keyboardHeight: number;
  /** `KeyboardAvoidingView` behaviour for the current platform. */
  behavior: KeyboardAvoidingBehavior;
  /** `ScrollView` `keyboardDismissMode` for the current platform. */
  dismissMode: KeyboardDismissMode;
  /** Pass straight through to `KeyboardAvoidingView.keyboardVerticalOffset`. */
  keyboardVerticalOffset: number;
  /** Extra bottom padding for the scrollable content while the keyboard is open. */
  contentPaddingBottom: number;
  /** Attach to the form's `ScrollView`. */
  scrollRef: { current: ScrollView | null };
  /** Attach to the form's `ScrollView.onScroll` (with `scrollEventThrottle`). */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /**
   * Call from a `TextInput.onFocus` (or imperatively) with that input's
   * ref value to scroll it above the keyboard. Remembers the last focused
   * input and re-runs once the keyboard finishes animating, so a field
   * focused programmatically is also kept visible.
   */
  scrollInputIntoView: (input: MeasurableNode | null | undefined) => void;
}

/**
 * Teardown guard: some React Native versions (and several community
 * mocks) hand back a subscription object without a `remove()` method.
 * Calling it unconditionally crashes on unmount in those environments.
 */
function unsubscribe(subscription: { remove?: () => void } | undefined): void {
  if (subscription && typeof subscription.remove === 'function') {
    subscription.remove();
  }
}

export function useKeyboardAvoidance(
  options: UseKeyboardAvoidanceOptions = {}
): UseKeyboardAvoidanceResult {
  const { inputGap, contentPadding, keyboardVerticalOffset } = options;

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const scrollRef = useRef<ScrollView | null>(null);
  const scrollOffsetRef = useRef(0);
  const lastFocusedInputRef = useRef<MeasurableNode | null>(null);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event?.nativeEvent?.contentOffset?.y;
    scrollOffsetRef.current = typeof offset === 'number' ? offset : scrollOffsetRef.current;
  }, []);

  const scrollIntoView = useCallback(() => {
    const input = lastFocusedInputRef.current;
    const scrollNode = scrollRef.current as unknown as MeasurableNode | null;
    const measureInput = input?.measureInWindow;
    const measureViewport = scrollNode?.measureInWindow;

    if (typeof measureInput !== 'function' || typeof measureViewport !== 'function') return;

    try {
      measureInput.call(input, (_x, inputTop, _width, height) => {
        if (typeof inputTop !== 'number' || typeof height !== 'number') return;

        measureViewport.call(scrollNode, (_scrollX, viewportTop, _scrollWidth, viewportHeight) => {
          if (typeof viewportTop !== 'number' || typeof viewportHeight !== 'number') return;

          const target = computeInputScrollTarget({
            inputTop,
            inputBottom: inputTop + height,
            viewportTop,
            viewportBottom: viewportTop + viewportHeight,
            scrollOffset: scrollOffsetRef.current,
            gap: inputGap ?? KEYBOARD_INPUT_GAP,
          });
          if (target === null) return;

          scrollRef.current?.scrollTo({ y: target, animated: true });
        });
      });
    } catch {
      // The view is not laid out (or the test renderer has no measuring
      // bridge). KeyboardAvoidingView still does its job; the next focus
      // or keyboard event retries the scroll.
    }
  }, [inputGap]);

  /**
   * Wire to a `TextInput.onFocus`. Remembers the field so the
   * `keyboardDidShow` listener below can re-measure it once the keyboard
   * has finished animating.
   */
  const scrollInputIntoView = useCallback(
    (input: MeasurableNode | null | undefined) => {
      lastFocusedInputRef.current = input ?? null;
      scrollIntoView();
    },
    [scrollIntoView]
  );

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      const height = event?.endCoordinates?.height;
      setKeyboardHeight(typeof height === 'number' ? height : 0);
      setKeyboardVisible(true);
      // Re-measure now that the keyboard has finished animating: on the
      // focus event the viewport is still at its full height, so the
      // first measurement cannot know the field is covered.
      scrollIntoView();
    });

    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
      setKeyboardVisible(false);
    });

    return () => {
      unsubscribe(showSubscription);
      unsubscribe(hideSubscription);
    };
  }, [scrollIntoView]);

  const contentPaddingBottom = keyboardVisible
    ? contentPadding ?? KEYBOARD_CONTENT_PADDING
    : 0;

  return {
    keyboardVisible,
    keyboardHeight,
    behavior: getKeyboardAvoidingBehavior(Platform.OS),
    dismissMode: getKeyboardDismissMode(Platform.OS),
    keyboardVerticalOffset: keyboardVerticalOffset ?? 0,
    contentPaddingBottom,
    scrollRef,
    onScroll,
    scrollInputIntoView,
  };
}
