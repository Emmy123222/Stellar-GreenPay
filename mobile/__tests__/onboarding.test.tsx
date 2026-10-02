/**
 * Tests for the first-launch onboarding flow (issue #1292).
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { OnboardingScreen, ONBOARDING_SLIDES } from '../src/screens/OnboardingScreen';
import {
  hasCompletedOnboarding,
  markOnboardingComplete,
  ONBOARDING_STORAGE_KEY,
} from '../utils/onboarding';

const store = (AsyncStorage as unknown as { __store: Record<string, string> }).__store;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('onboarding persistence', () => {
  it('reports not-onboarded before the flag is set', async () => {
    expect(await hasCompletedOnboarding()).toBe(false);
  });

  it('writes the greenpay:onboarded flag', async () => {
    await markOnboardingComplete();

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONBOARDING_STORAGE_KEY, 'true');
    expect(await hasCompletedOnboarding()).toBe(true);
  });

  it('defaults to not-onboarded when storage read fails', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));

    expect(await hasCompletedOnboarding()).toBe(false);
  });
});

describe('OnboardingScreen', () => {
  it('renders the three slides in order', () => {
    expect(ONBOARDING_SLIDES).toHaveLength(3);

    const { getByText, queryByText } = render(<OnboardingScreen onDone={jest.fn()} />);
    expect(getByText('Welcome to GreenPay')).toBeTruthy();
    expect(queryByText('Connect your wallet')).toBeNull();
  });

  it('advances through the slides and shows the Get Started CTA last', () => {
    const { getByText } = render(<OnboardingScreen onDone={jest.fn()} />);

    fireEvent.press(getByText('Next'));
    expect(getByText('How donations work')).toBeTruthy();

    fireEvent.press(getByText('Next'));
    expect(getByText('Connect your wallet')).toBeTruthy();
    expect(getByText('Get Started')).toBeTruthy();
  });

  it('marks onboarding complete and calls onDone from Get Started', async () => {
    const onDone = jest.fn();
    const { getByText } = render(<OnboardingScreen onDone={onDone} />);

    fireEvent.press(getByText('Next'));
    fireEvent.press(getByText('Next'));
    fireEvent.press(getByText('Get Started'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(store[ONBOARDING_STORAGE_KEY]).toBe('true');
  });

  it('lets the user skip from any slide', async () => {
    const onDone = jest.fn();
    const { getByText } = render(<OnboardingScreen onDone={onDone} />);

    await act(async () => {
      fireEvent.press(getByText('Skip'));
    });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(store[ONBOARDING_STORAGE_KEY]).toBe('true');
  });
});
