/**
 * __tests__/LeaderboardScreen.test.tsx
 *
 * Unit tests for LeaderboardScreen component paginated list behavior.
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import axios from 'axios';
import LeaderboardScreen from '../app/leaderboard';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('LeaderboardScreen component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetches first page with page size 20 and renders items', async () => {
    const mockEntries = Array.from({ length: 20 }, (_, i) => ({
      rank: i + 1,
      publicKey: `GB3K6Z4P${i.toString().padStart(4, '0')}`,
      displayName: `Donor ${i + 1}`,
      totalDonatedXLM: `${(20 - i) * 10}`,
      projectsSupported: 2,
      topBadge: 'tree',
    }));

    (axios.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: mockEntries,
        has_more: true,
        next_cursor: 'cursor-page-2',
      },
    });

    const { getByText } = render(<LeaderboardScreen />);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/leaderboard'),
        expect.objectContaining({
          params: expect.objectContaining({ limit: 20 }),
        })
      );
      expect(getByText('Donor 1')).toBeTruthy();
      expect(getByText('Donor 20')).toBeTruthy();
    });
  });

  test('loads next page on end reached and appends items', async () => {
    const page1Entries = Array.from({ length: 20 }, (_, i) => ({
      rank: i + 1,
      publicKey: `GB3K6Z4P${i.toString().padStart(4, '0')}`,
      displayName: `Donor ${i + 1}`,
      totalDonatedXLM: `${(40 - i) * 10}`,
      projectsSupported: 2,
      topBadge: 'tree',
    }));

    const page2Entries = Array.from({ length: 5 }, (_, i) => ({
      rank: i + 21,
      publicKey: `GB3K6Z4P${(i + 20).toString().padStart(4, '0')}`,
      displayName: `Donor ${i + 21}`,
      totalDonatedXLM: `${(20 - i) * 10}`,
      projectsSupported: 1,
      topBadge: 'seedling',
    }));

    (axios.get as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: page1Entries,
          has_more: true,
          next_cursor: 'cursor-page-2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: page2Entries,
          has_more: false,
          next_cursor: null,
        },
      });

    const { getByText, UNSAFE_getByType } = render(<LeaderboardScreen />);

    await waitFor(() => {
      expect(getByText('Donor 1')).toBeTruthy();
    });

    const flatList = UNSAFE_getByType(FlatList);

    await act(async () => {
      flatList.props.onEndReached();
    });

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(axios.get).toHaveBeenLastCalledWith(
        expect.stringContaining('/api/leaderboard'),
        expect.objectContaining({
          params: expect.objectContaining({ limit: 20, cursor: 'cursor-page-2' }),
        })
      );
      expect(getByText('Donor 21')).toBeTruthy();
    });
  });

  test('does not trigger more requests after last page (has_more: false)', async () => {
    const page1Entries = [
      {
        rank: 1,
        publicKey: 'GB3K6Z4P0001',
        displayName: 'Only Donor',
        totalDonatedXLM: '500',
        projectsSupported: 5,
        topBadge: 'earth',
      },
    ];

    (axios.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: page1Entries,
        has_more: false,
        next_cursor: null,
      },
    });

    const { getByText, UNSAFE_getByType } = render(<LeaderboardScreen />);

    await waitFor(() => {
      expect(getByText('Only Donor')).toBeTruthy();
    });

    const flatList = UNSAFE_getByType(FlatList);

    await act(async () => {
      flatList.props.onEndReached();
    });

    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
