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

import HomeScreen from '../app/index';

const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'Amazon Reforestation Initiative',
  description: 'Planting trees in the Amazon basin.',
  category: 'Reforestation',
  goalXLM: '50000',
  raisedXLM: '18420',
  donorCount: 147,
};

const MOCK_STATS = {
  totalDonations: 320,
  totalXLMRaised: '45200',
};

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading indicator before data arrives', () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECT } });
    const { getByText } = render(<HomeScreen />);
    expect(getByText('Loading...')).toBeTruthy();
  });

  it('renders the app title', async () => {
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({ data: { data: MOCK_PROJECT } })
      .mockResolvedValueOnce({ data: { data: MOCK_STATS } });

    const { getByText } = render(<HomeScreen />);
    await waitFor(() => expect(getByText('Stellar GreenPay')).toBeTruthy());
  });

  it('renders global stats after data loads', async () => {
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({ data: { data: MOCK_PROJECT } })
      .mockResolvedValueOnce({ data: { data: MOCK_STATS } });

    const { getByText } = render(<HomeScreen />);
    await waitFor(() => {
      expect(getByText('320 donations')).toBeTruthy();
      expect(getByText('45200 XLM raised')).toBeTruthy();
    });
  });

  it('renders the featured project name after data loads', async () => {
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({ data: { data: MOCK_PROJECT } })
      .mockResolvedValueOnce({ data: { data: MOCK_STATS } });

    const { getByText } = render(<HomeScreen />);
    await waitFor(() =>
      expect(getByText('Amazon Reforestation Initiative')).toBeTruthy()
    );
  });

  it('renders the Browse All Projects button', async () => {
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({ data: { data: MOCK_PROJECT } })
      .mockResolvedValueOnce({ data: { data: MOCK_STATS } });

    const { getByText } = render(<HomeScreen />);
    await waitFor(() =>
      expect(getByText('Browse All Projects')).toBeTruthy()
    );
  });

  it('still renders the title when the API call fails', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('network error'));

    const { getByText } = render(<HomeScreen />);
    await waitFor(() => expect(getByText('Stellar GreenPay')).toBeTruthy());
  });
});
