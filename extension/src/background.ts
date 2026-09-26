const tabProjects = new Map<number, string>();

export const LIGHT_ICONS = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png'
};
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'donate-project',
    title: 'Donate to this GreenPay project',
    contexts: ['all'],
    visible: false,
    documentUrlPatterns: ['*://*/*']
  });
});

// Clear scheduled work when the extension is suspended or removed so a stale
// recurring donation check cannot run against an invalid extension context.
chrome.runtime.onSuspend.addListener(() => {
  chrome.alarms.clearAll();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'setProjectContext' && sender.tab?.id) {
    if (message.projectId) {
      tabProjects.set(sender.tab.id, message.projectId);
      updateContextMenu(sender.tab.id);
    } else {
      tabProjects.delete(sender.tab.id);
      updateContextMenu(sender.tab.id);
    }
  }

export const DARK_ICONS = {
  16: 'icons/icon-dark-16.png',
  32: 'icons/icon-dark-32.png',
  48: 'icons/icon-dark-48.png',
  128: 'icons/icon-dark-128.png'
};

export function updateExtensionIcon(isDark: boolean) {
  const path = isDark ? DARK_ICONS : LIGHT_ICONS;
  if (typeof chrome !== 'undefined' && chrome.action && chrome.action.setIcon) {
    chrome.action.setIcon({ path });
  } else if (typeof chrome !== 'undefined' && (chrome as any).browserAction && (chrome as any).browserAction.setIcon) {
    (chrome as any).browserAction.setIcon({ path });
  }
}

export function initDarkModeIconListener() {
  const win = typeof window !== 'undefined' ? window : (globalThis as any).window;
  if (win && typeof win.matchMedia === 'function') {
    const mediaQuery = win.matchMedia('(prefers-color-scheme: dark)');
    updateExtensionIcon(mediaQuery.matches);

    const listener = (e: MediaQueryListEvent) => {
      updateExtensionIcon(e.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', listener);
    } else if ((mediaQuery as any).addListener) {
      (mediaQuery as any).addListener(listener);
    }
  }
}

// Set initial icon and listen for prefers-color-scheme change events
initDarkModeIconListener();

if (typeof chrome !== 'undefined') {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'donate-project',
      title: 'Donate to this GreenPay project',
      contexts: ['all'],
      visible: false,
      documentUrlPatterns: ['*://*/*']
    });
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.action === 'setProjectContext' && sender.tab?.id) {
      if (message.projectId) {
        tabProjects.set(sender.tab.id, message.projectId);
        updateContextMenu(sender.tab.id);
      } else {
        tabProjects.delete(sender.tab.id);
        updateContextMenu(sender.tab.id);
      }
    }

    // Handle the click action on a Stellar address from the content script
    if (message.action === 'openDonatePopup' && message.address) {
      chrome.storage.local.set({ pendingDonationAddress: message.address }, () => {
        openPopup();
      });
    }
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    updateContextMenu(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      // The content script will re-evaluate and send 'setProjectContext',
      // but we can ensure it's hidden during navigation if desired.
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    tabProjects.delete(tabId);
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'donate-project' && tab?.id) {
      const projectId = tabProjects.get(tab.id);
      if (projectId) {
        chrome.storage.local.set({ pendingDonationProjectId: projectId }, () => {
          openPopup();
        });
      }
    }
  });
}

function updateContextMenu(tabId: number) {
  if (typeof chrome !== 'undefined' && chrome.contextMenus && chrome.contextMenus.update) {
    const projectId = tabProjects.get(tabId);
    chrome.contextMenus.update('donate-project', { visible: !!projectId }, () => {
      if (chrome.runtime.lastError) {
        // Ignore error if menu item doesn't exist yet
      }
    });
  }
}

function openPopup() {
  if (chrome.action && chrome.action.openPopup) {
    chrome.action.openPopup().catch(console.error);
  } else if ((globalThis as any).browser?.action?.openPopup) {
    (globalThis as any).browser.action.openPopup().catch(console.error);
  } else if ((globalThis as any).browser?.browserAction?.openPopup) {
    (globalThis as any).browser.browserAction.openPopup().catch(console.error);
  } else {
    console.error('Cannot programmatically open popup in this browser environment.');
  }
}
