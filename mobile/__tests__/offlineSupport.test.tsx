/**
 * __tests__/offlineSupport.test.tsx
 * Tests for offline caching behaviour in the ProjectsScreen.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

import ProjectsScreen from '../app/projects/index';
import { ThemeProvider } from '../app/theme';

const MOCK_PROJECTS = [
  {
    id: 'proj-1',
    name: 'Amazon Reforestation',
    description: 'Planting trees.',
    category: 'Reforestation',
    goalXLM: '50000',
    raisedXLM: '18420',
    donorCount: 147,
    status: 'active',
  },
];

describe('ProjectsScreen — offline support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.clear as jest.Mock)();
  });

  it('shows cached project list with Offline banner when network fails', async () => {
    // Seed cache with project data
    const entry = JSON.stringify({ data: MOCK_PROJECTS, timestamp: Date.now() });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(entry);
    (axios.get as jest.Mock).mockRejectedValue(new Error('Network Error'));

    const { getByText } = render(<ThemeProvider><ProjectsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(getByText('Amazon Reforestation')).toBeTruthy();
      expect(getByText('Offline — showing cached data')).toBeTruthy();
    });
  });

  it('does not show Offline banner when network succeeds', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });

    const { queryByText } = render(<ThemeProvider><ProjectsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(queryByText('Offline — showing cached data')).toBeNull();
      expect(queryByText('Amazon Reforestation')).toBeTruthy();
    });
  });

  it('writes fresh data to cache on successful load', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });

    render(<ThemeProvider><ProjectsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'projects:list',
        expect.stringContaining('Amazon Reforestation')
      );
    });
  });
});
