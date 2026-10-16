/**
 * utils/onboarding.ts
 * Persistence for the first-launch onboarding flow (issue #1292).
 *
 * AsyncStorage holds a single flag under `greenpay:onboarded`. Reading is
 * best-effort: if storage is unavailable we default to "not onboarded" so a
 * fresh install still sees the explanation rather than a blank Home screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_STORAGE_KEY = 'greenpay:onboarded';

/** True once the user has completed (or skipped) the onboarding flow. */
export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)) === 'true';
  } catch {
    // Storage failure — treat as a first launch so the user still gets context.
    return false;
  }
}

/**
 * Records that onboarding has been seen. Failures are swallowed: the in-memory
 * navigation still proceeds, and the worst case is the flow showing once more.
 */
export async function markOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
  } catch {
    // Non-critical — see comment above.
  }
}
