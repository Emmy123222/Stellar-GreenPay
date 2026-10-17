// Set up chrome mock before importing background.ts because Jest hoists imports
(globalThis as any).chrome = {
  action: {
    setIcon: jest.fn()
  },
  browserAction: {
    setIcon: jest.fn()
  },
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onStartup: { addListener: jest.fn() },
    onSuspend: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    lastError: null
  },
  tabs: {
    onActivated: { addListener: jest.fn() },
    onUpdated: { addListener: jest.fn() },
    onRemoved: { addListener: jest.fn() }
  },
  contextMenus: {
    create: jest.fn(),
    update: jest.fn(),
    onClicked: { addListener: jest.fn() }
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    clearAll: jest.fn(),
    onAlarm: { addListener: jest.fn() }
  },
  storage: {
    onChanged: { addListener: jest.fn() },
    local: { set: jest.fn() }
  }
};

import {
  LIGHT_ICONS,
  DARK_ICONS,
  updateExtensionIcon,
  initDarkModeIconListener
} from '../background';

describe('Background Script Dark Mode Icon', () => {
  let listeners: Array<(e: { matches: boolean }) => void> = [];

  beforeEach(() => {
    listeners = [];
    jest.clearAllMocks();
  });

  test('calls chrome.action.setIcon with light icons when dark mode is false', () => {
    updateExtensionIcon(false);
    expect((globalThis as any).chrome.action.setIcon).toHaveBeenCalledWith({
      path: LIGHT_ICONS
    });
  });

  test('calls chrome.action.setIcon with dark icons when dark mode is true', () => {
    updateExtensionIcon(true);
    expect((globalThis as any).chrome.action.setIcon).toHaveBeenCalledWith({
      path: DARK_ICONS
    });
  });

  test('falls back to chrome.browserAction.setIcon if chrome.action is unavailable', () => {
    const originalAction = (globalThis as any).chrome.action;
    delete (globalThis as any).chrome.action;

    updateExtensionIcon(true);
    expect((globalThis as any).chrome.browserAction.setIcon).toHaveBeenCalledWith({
      path: DARK_ICONS
    });

    (globalThis as any).chrome.action = originalAction;
  });

  test('sets correct icon on initial load and on prefers-color-scheme change event', () => {
    let matchesValue = true;
    const addEventListenerMock = jest.fn((event: string, callback: any) => {
      if (event === 'change') {
        listeners.push(callback);
      }
    });

    (window as any).matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: matchesValue,
      media: query,
      addEventListener: addEventListenerMock,
      removeEventListener: jest.fn()
    }));

    initDarkModeIconListener();

    // Verify initial load set dark mode icon
    expect((globalThis as any).chrome.action.setIcon).toHaveBeenCalledWith({
      path: DARK_ICONS
    });

    // Simulate change event to light mode
    listeners.forEach((listener) => listener({ matches: false }));
    expect((globalThis as any).chrome.action.setIcon).toHaveBeenLastCalledWith({
      path: LIGHT_ICONS
    });
  });
});
