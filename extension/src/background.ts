const tabProjects = new Map<number, string>();

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

function updateContextMenu(tabId: number) {
  const projectId = tabProjects.get(tabId);
  chrome.contextMenus.update('donate-project', { visible: !!projectId }, () => {
    if (chrome.runtime.lastError) {
      // Ignore error if menu item doesn't exist yet
    }
  });
}

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
