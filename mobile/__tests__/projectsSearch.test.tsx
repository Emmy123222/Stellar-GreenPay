/**
 * __tests__/projectsSearch.test.tsx
 *
 * Tests for the debounced / abortable project search (#1129).
 *
 * The search box must not fire `GET /api/projects?search=` on every keystroke:
 * a burst of input has to collapse into a single request, a request that is
 * superseded by a newer one has to be aborted, and the UI has to say that a
 * search is in flight.
 *
 * These tests use real timers. Under jest fake timers, React 18 flushes
 * effects on its own captured `setTimeout`, so the debounce effect lands
 * *after* the clock has already been advanced and the timer fires one window
 * late — the assertions would measure React's scheduler, not the debounce.
 * Waiting slightly longer than the 300 ms window on the real clock keeps the
 * timing behaviour under test without that coupling.
 */
import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../app/theme';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

import ProjectsScreen from '../app/projects/index';

const DEBOUNCE_MS = 300;
const SETTLE_MS = DEBOUNCE_MS + 80;

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
  {
    id: 'proj-2',
    name: 'Rift Valley Solar',
    description: 'Solar arrays.',
    category: 'Solar Energy',
    goalXLM: '30000',
    raisedXLM: '9000',
    donorCount: 42,
    status: 'active',
  },
];

/** All URLs passed to axios.get since the last reset. */
const requestedUrls = () => (axios.get as jest.Mock).mock.calls.map((call) => String(call[0]));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('ProjectsScreen — debounced search (#1129)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (axios.get as jest.Mock).mockResolvedValue({ data: { data: MOCK_PROJECTS } });
  });

  /** Renders the screen and flushes the initial (empty-query) load. */
  const renderScreen = async () => {
    const utils = await render(
      <ThemeProvider>
        <ProjectsScreen />
      </ThemeProvider>
    );
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(1));
    return utils;
  };

  /**
   * Types `text` into the search box one character at a time, like a real user.
   * The controlled input keeps its own value, so the caller tracks the string.
   */
  const typeSearch = (input: any, current: string, text: string) => {
    let value = current;
    for (const char of text) {
      value += char;
      fireEvent.changeText(input, value);
    }
    return value;
  };

  /** Types `text` and lets the debounce window elapse. */
  const typeAndSettle = async (input: any, current: string, text: string) => {
    let value = '';
    await act(async () => {
      value = typeSearch(input, current, text);
      await sleep(SETTLE_MS);
    });
    return value;
  };

  it('collapses a burst of keystrokes into a single request', async () => {
    const { getByLabelText } = await renderScreen();
    const search = getByLabelText('Search projects');

    (axios.get as jest.Mock).mockClear();

    await act(async () => {
      typeSearch(search, '', 'solar');
      // Nothing may leave the component before the debounce window closes.
      await sleep(DEBOUNCE_MS - 100);
    });
    expect(axios.get).not.toHaveBeenCalled();

    await act(async () => {
      await sleep(150);
    });

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(requestedUrls()[0]).toContain('search=solar');
  });

  it('aborts the in-flight request when a new search starts', async () => {
    const { getByLabelText } = await renderScreen();
    const search = getByLabelText('Search projects');

    // First search never settles until it is aborted.
    let firstSignal: AbortSignal | undefined;
    (axios.get as jest.Mock).mockImplementationOnce((_url: string, config: any) => {
      firstSignal = config?.signal;
      return new Promise(() => {});
    });

    const typed = await typeAndSettle(search, '', 'solar');
    expect(firstSignal).toBeDefined();
    expect(firstSignal?.aborted).toBe(false);

    // A newer query supersedes it.
    await typeAndSettle(search, typed, ' energy');

    expect(firstSignal?.aborted).toBe(true);
    const urls = requestedUrls();
    expect(urls[urls.length - 1]).toContain('search=solar%20energy');
  });

  it('shows a loading indicator while a debounced search is in flight', async () => {
    const { getByLabelText, queryByLabelText } = await renderScreen();
    const search = getByLabelText('Search projects');

    (axios.get as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
    expect(queryByLabelText('Searching projects')).toBeNull();

    await typeAndSettle(search, '', 'solar');

    expect(queryByLabelText('Searching projects')).not.toBeNull();
  });

  it('hides the loading indicator once the search resolves', async () => {
    const { getByLabelText, queryByLabelText } = await renderScreen();
    const search = getByLabelText('Search projects');

    await typeAndSettle(search, '', 'solar');

    await waitFor(() => expect(queryByLabelText('Searching projects')).toBeNull());
  });
});
