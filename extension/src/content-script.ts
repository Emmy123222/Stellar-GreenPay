const STELLAR_ADDRESS_REGEX = /\bG[A-Z2-7]{55}\b/g;

function createTooltip(): HTMLDivElement {
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

function highlightAddresses(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (!text || !STELLAR_ADDRESS_REGEX.test(text)) return;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

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

      span.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          action: 'openDonatePopup',
          address: match![0]
        });
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
    node.childNodes.forEach(child => highlightAddresses(child));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  highlightAddresses(document.body);
});

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
        highlightAddresses(node);
      }
    });
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
