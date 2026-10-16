/**
 * app/onboarding.tsx
 * First-launch onboarding route (issue #1292). Renders the three-slide
 * walkthrough and sends the user to Home when they finish or skip.
 */
import { useRouter } from 'expo-router';
import { OnboardingScreen } from '../src/screens/OnboardingScreen';

export default function OnboardingRoute() {
  const router = useRouter();

  return <OnboardingScreen onDone={() => router.replace('/')} />;
}
