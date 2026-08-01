/**
 * __tests__/HomeScreen.test.tsx
 * Unit tests for the Home screen component.
 *
 * Mocks: axios (API calls), expo-router (navigation), react-native
 * modules that require a native environment.
 */
import React from 'react';
import { render, waitFor, screen } from '@testing-library/react-native';
import axios from 'axios';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('../utils/notifications', () => ({
  getPushToken: jest.fn().mockResolvedValue(null),
  getUnreadNotificationCount: jest.fn().mockResolvedValue(0),
  setupNotificationListener: jest.fn(() => ({ remove: jest.fn() })),
  setupNotificationResponseListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-notifications', () => ({
  setBadgeCountAsync: jest.fn().mockResolvedValue(true),
  getBadgeCountAsync: jest.fn().mockResolvedValue(0),
}));

import HomeScreen from '../app/index';
import { ThemeProvider } from '../app/theme';

function wrap(element: React.ReactElement) {
  return <ThemeProvider>{element}</ThemeProvider>;
}

const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'Amazon Reforestation Initiative',
  description: 'Planting trees in the Amazon basin.',
  category: 'Reforestation',
  goalXLM: '50000',
  raisedXLM: '18420',
  donorCount: 147,
};

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the header before data arrives', () => {
    (axios.get as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    const { getByText, queryByText } = render(wrap(<HomeScreen />));
    // Header renders during the initial load...
    expect(getByText('Stellar GreenPay')).toBeTruthy();
    // ...but no project card is shown until data arrives.
    expect(queryByText('Amazon Reforestation Initiative')).toBeNull();
  });

  it('renders the app title', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });

    const { getByText } = render(wrap(<HomeScreen />));
    await waitFor(() => expect(getByText('Stellar GreenPay')).toBeTruthy());
  });

  it('renders project cards with progress after data loads', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });

    const { getByText } = render(wrap(<HomeScreen />));
    await waitFor(() => {
      expect(getByText('Amazon Reforestation Initiative')).toBeTruthy();
      expect(getByText('18420 / 50000 XLM')).toBeTruthy();
      expect(getByText('147 donors')).toBeTruthy();
    });
  });

  it('renders the project name after data loads', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });

    const { getByText } = render(wrap(<HomeScreen />));
    await waitFor(() =>
      expect(getByText('Amazon Reforestation Initiative')).toBeTruthy()
    );
  });

  it('renders project cards with an accessible label', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });

    const { getByLabelText } = render(wrap(<HomeScreen />));
    await waitFor(() =>
      expect(getByLabelText('View Amazon Reforestation Initiative project')).toBeTruthy()
    );
  });

  it('still renders the title when the API call fails', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('network error'));

    const { getByText } = render(wrap(<HomeScreen />));
    await waitFor(() => expect(getByText('Stellar GreenPay')).toBeTruthy());
  });
});
