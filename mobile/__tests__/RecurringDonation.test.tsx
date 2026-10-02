/**
 * __tests__/RecurringDonation.test.tsx
 *
 * Tests for the recurring donation creation form amount validation (issue #802).
 *
 * Verifies:
 * - Minimum amount of 1 XLM is enforced on the frontend
 * - Inline error "Minimum recurring donation is 1 XLM" is shown for invalid amounts
 * - Submit button is disabled when amount is invalid
 * - Submission does not occur for invalid amounts
 * - Exactly 1 XLM and above are accepted
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../hooks/useBiometricAuth', () => ({
  useBiometricAuth: () => ({
    available: true,
    enrolled: true,
    isAuthenticating: false,
    label: 'Biometrics',
    authenticate: jest.fn().mockResolvedValue({ success: true, outcome: 'success' }),
    refresh: jest.fn(),
  }),
}));

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
  useFocusEffect: (cb: () => void) => { /* no-op */ },
}));

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn().mockResolvedValue(false),
  openURL: jest.fn(),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({
    data: { data: [{ id: 'proj-1', name: 'Test Project' }] },
  }),
  post: jest.fn().mockResolvedValue({ data: { success: true } }),
}));

const mockCreateRecurringDonation = jest.fn();
jest.mock('../utils/recurringDonations', () => ({
  loadRecurringDonations: jest.fn().mockResolvedValue([]),
  createRecurringDonation: (...args: any[]) => mockCreateRecurringDonation(...args),
  cancelRecurringDonation: jest.fn().mockResolvedValue(undefined),
}));

import RecurringScreen from '../app/recurring';

describe('RecurringScreen – amount validation (issue #802)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateRecurringDonation.mockResolvedValue({
      id: 'rec_1',
      projectId: 'proj-1',
      projectName: 'Test Project',
      amountXLM: '10.0000000',
      startDate: new Date().toISOString(),
      nextDueDate: new Date().toISOString(),
      durationMonths: null,
      remainingMonths: null,
      status: 'active',
      createdAt: new Date().toISOString(),
    });
  });

  it('shows the create button initially', async () => {
    const { getByTestId } = render(<RecurringScreen />);
    await waitFor(() => {
      expect(getByTestId('create-recurring-button')).toBeTruthy();
    });
  });

  it('shows the form when the create button is pressed', async () => {
    const { getByTestId } = render(<RecurringScreen />);
    await waitFor(() => {
      expect(getByTestId('create-recurring-button')).toBeTruthy();
    });
    fireEvent.press(getByTestId('create-recurring-button'));
    await waitFor(() => {
      expect(getByTestId('recurring-form')).toBeTruthy();
    });
  });

  it('displays error and disables submit for amount below 1 XLM', async () => {
    const { getByTestId } = render(<RecurringScreen />);
    await waitFor(() => {
      expect(getByTestId('create-recurring-button')).toBeTruthy();
    });
    fireEvent.press(getByTestId('create-recurring-button'));

    const input = getByTestId('recurring-amount-input');
    fireEvent.changeText(input, '0.5');

    await waitFor(() => {
      expect(getByTestId('recurring-amount-error')).toBeTruthy();
      expect(getByTestId('recurring-amount-error').props.children).toBe(
        'Minimum recurring donation is 1 XLM'
      );
    });
  });

  it('disables submit button for amount below 1 XLM', async () => {
    const { getByTestId } = render(<RecurringScreen />);
    await waitFor(() => {
      expect(getByTestId('create-recurring-button')).toBeTruthy();
    });
    fireEvent.press(getByTestId('create-recurring-button'));

    const input = getByTestId('recurring-amount-input');
    fireEvent.changeText(input, '0.5');

    await waitFor(() => {
      const submitBtn = getByTestId('recurring-submit-button');
      expect(submitBtn.props.accessibilityState?.disabled).toBe(true);
    });
  });

  it('shows error for zero amount', async () => {
    const { getByTestId } = render(<RecurringScreen />);
    await waitFor(() => {
      expect(getByTestId('create-recurring-button')).toBeTruthy();
    });
    fireEvent.press(getByTestId('create-recurring-button'));

    const input = getByTestId('recurring-amount-input');
    fireEvent.changeText(input, '0');

    await waitFor(() => {
      expect(getByTestId('recurring-amount-error').props.children).toBe(
        'Minimum recurring donation is 1 XLM'
      );
    });
  });

  it('shows error for negative amount', async () => {
    const { getByTestId } = render(<RecurringScreen />);
    await waitFor(() => {
      expect(getByTestId('create-recurring-button')).toBeTruthy();
    });
    fireEvent.press(getByTestId('create-recurring-button'));

    const input = getByTestId('recurring-amount-input');
    fireEvent.changeText(input, '-5');

    await waitFor(() => {
      expect(getByTestId('recurring-amount-error').props.children).toBe(
        'Minimum recurring donation is 1 XLM'
      );
    });
  });

  it('does NOT show error for exactly 1 XLM', async () => {
    const { getByTestId, queryByTestId } = render(<RecurringScreen />);
    await waitFor(() => {
      expect(getByTestId('create-recurring-button')).toBeTruthy();
    });
    fireEvent.press(getByTestId('create-recurring-button'));

    const input = getByTestId('recurring-amount-input');
    fireEvent.changeText(input, '1');

    await waitFor(() => {
      expect(queryByTestId('recurring-amount-error')).toBeNull();
    });
  });

  it('does NOT show error for amount above 1 XLM', async () => {
    const { getByTestId, queryByTestId } = render(<RecurringScreen />);
    await waitFor(() => {
      expect(getByTestId('create-recurring-button')).toBeTruthy();
    });
    fireEvent.press(getByTestId('create-recurring-button'));

    const input = getByTestId('recurring-amount-input');
    fireEvent.changeText(input, '25');

    await waitFor(() => {
      expect(queryByTestId('recurring-amount-error')).toBeNull();
    });
  });

  it('enables submit button for valid amount', async () => {
    const { getByTestId } = render(<RecurringScreen />);
    await waitFor(() => {
      expect(getByTestId('create-recurring-button')).toBeTruthy();
    });
    fireEvent.press(getByTestId('create-recurring-button'));

    const input = getByTestId('recurring-amount-input');
    fireEvent.changeText(input, '10');

    await waitFor(() => {
      const submitBtn = getByTestId('recurring-submit-button');
      expect(submitBtn.props.accessibilityState?.disabled).toBe(false);
    });
  });

  it('does not call createRecurringDonation when amount is below minimum', async () => {
    const { getByTestId } = render(<RecurringScreen />);
    await waitFor(() => {
      expect(getByTestId('create-recurring-button')).toBeTruthy();
    });
    fireEvent.press(getByTestId('create-recurring-button'));

    const input = getByTestId('recurring-amount-input');
    fireEvent.changeText(input, '0.5');

    await waitFor(() => {
      const submitBtn = getByTestId('recurring-submit-button');
      expect(submitBtn.props.accessibilityState?.disabled).toBe(true);
    });

    fireEvent.press(getByTestId('recurring-submit-button'));
    expect(mockCreateRecurringDonation).not.toHaveBeenCalled();
  });
});
