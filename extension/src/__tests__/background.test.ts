import {
  LIGHT_ICONS,
  DARK_ICONS,
  updateExtensionIcon,
  initDarkModeIconListener
} from '../background';

describe('Background Script Dark Mode Icon', () => {
  let originalChrome: any;
  let originalWindow: any;
  let listeners: Array<(e: { matches: boolean }) => void> = [];

  beforeEach(() => {
    listeners = [];
    originalChrome = (global as any).chrome;
    originalWindow = (global as any).window;

    (global as any).chrome = {
      action: {
        setIcon: jest.fn()
      },
      runtime: {
        onInstalled: { addListener: jest.fn() },
        onMessage: { addListener: jest.fn() }
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
      }
    };
  });

  afterEach(() => {
    (global as any).chrome = originalChrome;
    (global as any).window = originalWindow;
    jest.clearAllMocks();
  });

  test('calls chrome.action.setIcon with light icons when dark mode is false', () => {
    updateExtensionIcon(false);
    expect((global as any).chrome.action.setIcon).toHaveBeenCalledWith({
      path: LIGHT_ICONS
    });
  });

  test('calls chrome.action.setIcon with dark icons when dark mode is true', () => {
    updateExtensionIcon(true);
    expect((global as any).chrome.action.setIcon).toHaveBeenCalledWith({
      path: DARK_ICONS
    });
  });

  test('falls back to chrome.browserAction.setIcon if chrome.action is unavailable', () => {
    const setIconMock = jest.fn();
    delete (global as any).chrome.action;
    (global as any).chrome.browserAction = { setIcon: setIconMock };

    updateExtensionIcon(true);
    expect(setIconMock).toHaveBeenCalledWith({ path: DARK_ICONS });
  });

  test('sets correct icon on initial load and on prefers-color-scheme change event', () => {
    let matchesValue = true;
    const addEventListenerMock = jest.fn((event: string, callback: any) => {
      if (event === 'change') {
        listeners.push(callback);
      }
    });

    (global as any).window = {
      matchMedia: jest.fn().mockImplementation((query: string) => ({
        matches: matchesValue,
        media: query,
        addEventListener: addEventListenerMock,
        removeEventListener: jest.fn()
      }))
    };

    initDarkModeIconListener();

    // Verify initial load set dark mode icon
    expect((global as any).chrome.action.setIcon).toHaveBeenCalledWith({
      path: DARK_ICONS
    });

    // Simulate change event to light mode
    listeners.forEach((listener) => listener({ matches: false }));
    expect((global as any).chrome.action.setIcon).toHaveBeenLastCalledWith({
      path: LIGHT_ICONS
    });
  });
});
