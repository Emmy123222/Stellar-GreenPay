import { isUrlAllowed } from './allowlist';
import { loadSettings, DEFAULT_SETTINGS } from './settings';

const STELLAR_ADDRESS_REGEX = /\bG[A-Z2-7]{55}\b/g;

let isWidgetInjected = false;
let mutationObserver: MutationObserver | null = null;
let currentProjectId: string | null = null;

export function isWidgetActive(): boolean {
  return isWidgetInjected;
}

export function createTooltip(): HTMLDivElement {
  const tooltip = document.createElement('div');
  tooltip.className = 'greenpay-tooltip';
  tooltip.textContent = 'Donate to this address via GreenPay';
  tooltip.style.cssText = `
    position: absolute;
    background: #1a1a1a;
    color: #fff;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    z-index: 10000;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 8px;
  `;
  return tooltip;
}

export function highlightAddresses(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (!text || !STELLAR_ADDRESS_REGEX.test(text)) return;

    // Do not re-process text inside an already created greenpay-address span or tooltip
    if (
      node.parentElement &&
      (node.parentElement.classList.contains('greenpay-address') ||
        node.parentElement.classList.contains('greenpay-tooltip'))
    ) {
      return;
    }

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    STELLAR_ADDRESS_REGEX.lastIndex = 0;
    while ((match = STELLAR_ADDRESS_REGEX.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(
          document.createTextNode(text.substring(lastIndex, match.index))
        );
      }

      const span = document.createElement('span');
      span.className = 'greenpay-address';
      span.textContent = match[0];
      span.style.cssText = `
        background: linear-gradient(135deg, #4CAF50, #2E7D32);
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 600;
        display: inline-block;
        position: relative;
        margin: 0 2px;
        transition: all 0.2s ease;
      `;

      let tooltip: HTMLDivElement | null = null;

      span.addEventListener('mouseenter', () => {
        tooltip = createTooltip();
        const rect = span.getBoundingClientRect();
        tooltip.style.left = rect.left + rect.width / 2 + 'px';
        tooltip.style.top = rect.top + window.scrollY + 'px';
        document.body.appendChild(tooltip);
      });

      span.addEventListener('mouseleave', () => {
        if (tooltip && tooltip.parentNode) {
          tooltip.parentNode.removeChild(tooltip);
        }
        tooltip = null;
      });

      const matchedAddress = match[0];
      span.addEventListener('click', () => {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'openDonatePopup',
            address: matchedAddress,
          });
        }
      });

      fragment.appendChild(span);
      lastIndex = STELLAR_ADDRESS_REGEX.lastIndex;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    if (node.parentNode) {
      node.parentNode.replaceChild(fragment, node);
    }
  } else if (
    node.nodeType === Node.ELEMENT_NODE &&
    !['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(
      (node as HTMLElement).tagName
    )
  ) {
    if (
      (node as HTMLElement).classList?.contains('greenpay-address') ||
      (node as HTMLElement).classList?.contains('greenpay-tooltip')
    ) {
      return;
    }
    const children = Array.from(node.childNodes);
    children.forEach((child) => highlightAddresses(child));
  }
}

export function checkProjectContext() {
  if (typeof document === 'undefined') return;

  const metaTag =
    document.querySelector('meta[name="greenpay:project:id"]') ||
    document.querySelector('meta[property="greenpay:project:id"]');
  let projectId = metaTag ? metaTag.getAttribute('content') : null;

  if (!projectId && typeof window !== 'undefined' && window.location?.pathname) {
    const match = window.location.pathname.match(/\/projects\/([a-zA-Z0-9_-]+)/);
    if (match) projectId = match[1];
  }

  if (projectId !== currentProjectId) {
    currentProjectId = projectId;
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: 'setProjectContext', projectId }).catch(() => {});
    }
  }
}

export function injectWidget() {
  if (isWidgetInjected) return;
  isWidgetInjected = true;

  if (typeof document !== 'undefined' && document.body) {
    highlightAddresses(document.body);
    checkProjectContext();

    mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            highlightAddresses(node);
          }
        });
      });
      checkProjectContext();
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', checkProjectContext);
  }
}

export function cleanupWidget() {
  if (!isWidgetInjected) return;
  isWidgetInjected = false;

  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }

  if (typeof window !== 'undefined') {
    window.removeEventListener('popstate', checkProjectContext);
  }

  if (typeof document !== 'undefined') {
    // Remove tooltips
    document.querySelectorAll('.greenpay-tooltip').forEach((el) => el.remove());

    // Unwrap greenpay-address spans back to text
    document.querySelectorAll('.greenpay-address').forEach((span) => {
      const parent = span.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(span.textContent || ''), span);
        parent.normalize();
      }
    });
  }
}

export async function checkAndInject(currentUrl?: string): Promise<boolean> {
  const targetUrl =
    currentUrl ||
    (typeof window !== 'undefined' && window.location?.href ? window.location.href : '');

  let settings;
  try {
    settings = await loadSettings();
  } catch {
    settings = DEFAULT_SETTINGS;
  }

  const allowed = isUrlAllowed(targetUrl, settings.allowlist || []);
  if (!allowed) {
    if (isWidgetInjected) {
      cleanupWidget();
    }
    return false;
  }

  injectWidget();
  return true;
}

// Auto-initialize when running in browser content script context
const isTestEnv =
  typeof (globalThis as any).process !== 'undefined' &&
  (globalThis as any).process?.env?.NODE_ENV === 'test';

if (!isTestEnv) {
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        checkAndInject();
      });
    } else {
      checkAndInject();
    }
  }

  // Listen for storage changes (e.g. allowlist updated in popup or settings)
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.allowlist) {
        checkAndInject();
      }
    });
  }

  // Listen for runtime messages from popup
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === 'checkAllowlist') {
        checkAndInject().then((active) => sendResponse({ active }));
        return true;
      }
      if (message.action === 'getWidgetStatus') {
        sendResponse({ active: isWidgetInjected });
      }
    });
  }
}
