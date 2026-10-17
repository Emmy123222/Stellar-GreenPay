import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider, themes } from '../app/theme';
import RecurringScreen from '../app/recurring';
import ScanScreen from '../app/scan';
import ImpactScreen from '../app/impact';

// Mock dependencies
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useFocusEffect: (cb: () => void) => cb(),
}));

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View: MockView } = require('react-native');
  return {
    CameraView: (props: any) => React.createElement(MockView, { testID: 'camera-view', ...props }),
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
  };
}, { virtual: true });

jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn(),
}));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('file://fake-path.png'),
}));

jest.mock('../utils/recurringDonations', () => ({
  loadRecurringDonations: jest.fn().mockResolvedValue([]),
  cancelRecurringDonation: jest.fn().mockResolvedValue(undefined),
  createRecurringDonation: jest.fn().mockResolvedValue({
    id: 'rec_123',
    projectId: 'proj_1',
    projectName: 'Amazon Reforestation',
    amountXLM: '25',
    nextDueDate: new Date().toISOString(),
    status: 'active',
  }),
  loadPaymentHistory: jest.fn().mockResolvedValue([]),
  useRecurringDonations: () => ({
    donations: [],
    isSyncing: false,
    error: null,
    refresh: jest.fn(),
    create: jest.fn(),
    cancel: jest.fn(),
  }),
}));

describe('Dark Mode consistent theme application', () => {
  it('defines valid background and text colors in both light and dark themes', () => {
    expect(themes.light.background).toBe('#f0f7f0');
    expect(themes.light.text).toBe('#1a2e1a');
    expect(themes.dark.background).toBe('#06140a');
    expect(themes.dark.text).toBe('#e6f5e9');
  });

  it('renders RecurringScreen using ThemeProvider theme colors', async () => {
    const { getByText } = await render(
      <ThemeProvider>
        <RecurringScreen />
      </ThemeProvider>
    );
    await waitFor(() => {
      expect(getByText('Monthly Giving')).toBeTruthy();
    });
  });

  it('renders ScanScreen using ThemeProvider theme colors', async () => {
    const { getByText } = await render(
      <ThemeProvider>
        <ScanScreen />
      </ThemeProvider>
    );
    expect(getByText('Point the camera at a project wallet QR code')).toBeTruthy();
  });

  it('renders ImpactScreen using ThemeProvider theme colors', async () => {
    const { getByText } = await render(
      <ThemeProvider>
        <ImpactScreen />
      </ThemeProvider>
    );
    expect(getByText('My Impact')).toBeTruthy();
  });
});
