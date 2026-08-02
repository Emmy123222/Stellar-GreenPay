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

jest.mock('../app/theme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      surface: '#ffffff',
      primary: '#000000',
      accent: '#000000',
      header: '#000000',
      headerText: '#ffffff',
      buttonBackground: '#000000',
      buttonText: '#ffffff',
      cardBorder: '#eeeeee',
      cardShadow: '#000000',
      primaryText: '#000000',
      secondaryText: '#555555',
      muted: '#888888',
      inputBackground: '#ffffff',
      inputBorder: '#eeeeee',
      placeholder: '#888888',
      border: '#dddddd',
      statusBarStyle: 'dark',
    },
  }),
}));


import HomeScreen from '../app/index';

const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'Amazon Reforestation Initiative',
  description: 'Planting trees in the Amazon basin.',
  category: 'Reforestation',
  goalXLM: '50000',
  raisedXLM: '18420',
  donorCount: 147,
  verified: true,
  status: 'active',
};

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading indicator before data arrives', () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });
    const { getByText } = render(<HomeScreen />);
    expect(getByText('Loading...')).toBeTruthy();
  });

  it('renders the app title', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });

    const { getByText } = render(<HomeScreen />);
    await waitFor(() => expect(getByText('Stellar GreenPay')).toBeTruthy());
  });

  it('renders live projects list after data loads', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: [MOCK_PROJECT] } });

    const { getByText } = render(<HomeScreen />);
    await waitFor(() => {
      expect(getByText('Amazon Reforestation Initiative')).toBeTruthy();
      expect(getByText('18420 / 50000 XLM')).toBeTruthy();
      expect(getByText('147 donors')).toBeTruthy();
    });
  });

  it('still renders the title when the API call fails', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('network error'));

    const { getByText } = render(<HomeScreen />);
    await waitFor(() => expect(getByText('Stellar GreenPay')).toBeTruthy());
  });
});

