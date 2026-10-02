import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { markOnboardingComplete } from '../../utils/onboarding';

export interface OnboardingSlide {
  key: string;
  title: string;
  body: string;
  emoji: string;
}

/** The three slides shown on first launch (issue #1292). */
export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    key: 'mission',
    emoji: '🌱',
    title: 'Welcome to GreenPay',
    body:
      'GreenPay makes climate action simple. Donate XLM to verified reforestation and clean-energy projects on the Stellar network — every contribution is transparent and traceable on-chain.',
  },
  {
    key: 'donations',
    emoji: '🌍',
    title: 'How donations work',
    body:
      'Pick a project, choose an amount, and send XLM straight to the project wallet in seconds. Your impact is recorded on-chain and summarised in the My Impact tab.',
  },
  {
    key: 'wallet',
    emoji: '🔐',
    title: 'Connect your wallet',
    body:
      'Add your Stellar public key to start donating. GreenPay never stores your secret key, so you stay in full control of your funds at all times.',
  },
];

interface OnboardingScreenProps {
  /** Called after the user finishes or skips onboarding. */
  onDone: () => void;
}

export function OnboardingScreen({ onDone }: OnboardingScreenProps) {
  const [index, setIndex] = useState(0);
  const isLast = index === ONBOARDING_SLIDES.length - 1;
  const slide = ONBOARDING_SLIDES[index];

  const finish = async () => {
    await markOnboardingComplete();
    onDone();
  };

  const goNext = () => {
    if (isLast) {
      void finish();
      return;
    }
    setIndex((current) => current + 1);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => void finish()}
          accessibilityLabel="Skip onboarding"
          accessibilityRole="button"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">
          {slide.emoji}
        </Text>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.body}>{slide.body}</Text>
      </View>

      <View style={styles.dots} accessibilityLabel={`Slide ${index + 1} of ${ONBOARDING_SLIDES.length}`}>
        {ONBOARDING_SLIDES.map((s, i) => (
          <View
            key={s.key}
            style={[styles.dot, i === index ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={goNext}
          accessibilityLabel={isLast ? 'Get started' : 'Next slide'}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{isLast ? 'Get Started' : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f7f0',
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 40,
  },
  topBar: {
    alignItems: 'flex-end',
  },
  skipText: {
    color: '#5a7a5a',
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 64,
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a2e1a',
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#5a7a5a',
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: '#227239',
  },
  dotInactive: {
    backgroundColor: '#c3d8c3',
  },
  footer: {
    width: '100%',
  },
  primaryButton: {
    backgroundColor: '#227239',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
