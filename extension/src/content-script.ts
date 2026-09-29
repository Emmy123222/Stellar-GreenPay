import "./widget.css";

const STELLAR_ADDRESS_REGEX = /\bG[A-Z2-7]{55}\b/g;

function createTooltip(): HTMLDivElement {
  const tooltip = document.createElement("div");
  tooltip.className = "greenpay-tooltip";
  tooltip.textContent = "Donate to this address via GreenPay";
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
          document.createTextNode(text.substring(lastIndex, match.index)),
        );
      }

      const span = document.createElement("span");
      span.className = "greenpay-address";
      span.textContent = match[0];

      let tooltip: HTMLDivElement | null = null;

      span.addEventListener("mouseenter", () => {
        tooltip = createTooltip();
        const rect = span.getBoundingClientRect();
        tooltip.style.left = rect.left + rect.width / 2 + "px";
        tooltip.style.top = rect.top + window.scrollY + "px";
        document.body.appendChild(tooltip);
      });

      span.addEventListener("mouseleave", () => {
        if (tooltip && tooltip.parentNode) {
          tooltip.parentNode.removeChild(tooltip);
        }
        tooltip = null;
      });

      span.addEventListener("click", () => {
        chrome.runtime.sendMessage({
          action: "openDonatePopup",
          address: match![0],
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
    !["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME"].includes(
      (node as HTMLElement).tagName,
    )
  ) {
    node.childNodes.forEach((child) => highlightAddresses(child));
  }
}

let currentProjectId: string | null = null;

function checkProjectContext() {
  const metaTag =
    document.querySelector('meta[name="greenpay:project:id"]') ||
    document.querySelector('meta[property="greenpay:project:id"]');
  let projectId = metaTag ? metaTag.getAttribute("content") : null;

  if (!projectId) {
    const match = window.location.pathname.match(
      /\/projects\/([a-zA-Z0-9_-]+)/,
    );
    if (match) projectId = match[1];
  }

  if (projectId !== currentProjectId) {
    currentProjectId = projectId;
    chrome.runtime
      .sendMessage({ action: "setProjectContext", projectId })
      .catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", () => {
  highlightAddresses(document.body);
  checkProjectContext();
});

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (
        node.nodeType === Node.ELEMENT_NODE ||
        node.nodeType === Node.TEXT_NODE
      ) {
        highlightAddresses(node);
      }
    });
  });
  checkProjectContext();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

window.addEventListener("popstate", checkProjectContext);
// In case DOMContentLoaded already fired
checkProjectContext();
