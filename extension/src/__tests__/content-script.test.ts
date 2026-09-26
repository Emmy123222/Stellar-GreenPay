import {
  checkAndInject,
  injectWidget,
  cleanupWidget,
  isWidgetActive,
} from '../content-script';
import { DEFAULT_ALLOWLIST } from '../allowlist';

const VALID_STELLAR_ADDRESS =
  'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPYWKHQ3QAR6ACXNO';

describe('Content Script Injection & Allowlist', () => {
  let mockStorage: Record<string, any> = {};

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = `
      <div id="content">
        <p id="donation-text">Please send donations to ${VALID_STELLAR_ADDRESS} to support our tree planting.</p>
      </div>
    `;

    // Reset injected state
    cleanupWidget();

    // Setup chrome API mocks
    mockStorage = {
      allowlist: [...DEFAULT_ALLOWLIST],
      backendUrl: 'https://api.stellar-greenpay.app',
      network: 'testnet',
      defaultDonationAmount: '5',
    };

    (globalThis as any).chrome = {
      storage: {
        sync: {
          get: jest.fn((defaults, callback) => {
            callback({ ...defaults, ...mockStorage });
          }),
          set: jest.fn((data, callback) => {
            Object.assign(mockStorage, data);
            if (callback) callback();
          }),
        },
        local: {
          get: jest.fn((_keys, callback) => callback({})),
          set: jest.fn((_data, callback) => callback && callback()),
          remove: jest.fn((_key, callback) => callback && callback()),
        },
        onChanged: {
          addListener: jest.fn(),
        },
      },
      runtime: {
        sendMessage: jest.fn().mockResolvedValue(undefined),
        onMessage: {
          addListener: jest.fn(),
        },
        lastError: null,
      },
    };
  });

  afterEach(() => {
    cleanupWidget();
    jest.clearAllMocks();
  });

  describe('Acceptance Criteria: Unit test: non-allowlisted page → content script does not inject widget', () => {
    it('does not inject widget on non-allowlisted external pages', async () => {
      // Non-allowlisted external URL
      const nonAllowlistedUrl = 'https://random-blog.com/posts/stellar-donations';

      const injected = await checkAndInject(nonAllowlistedUrl);

      // Must return false
      expect(injected).toBe(false);
      expect(isWidgetActive()).toBe(false);

      // Must not create any greenpay-address elements
      const injectedSpans = document.querySelectorAll('.greenpay-address');
      expect(injectedSpans.length).toBe(0);

      // Must not create any tooltip elements
      const tooltips = document.querySelectorAll('.greenpay-tooltip');
      expect(tooltips.length).toBe(0);

      // The text containing the Stellar address remains untouched
      const paragraph = document.getElementById('donation-text');
      expect(paragraph?.textContent).toContain(VALID_STELLAR_ADDRESS);
      expect(paragraph?.innerHTML).not.toContain('greenpay-address');
    });

    it('does not inject widget by default on external domains even if Stellar address is present', async () => {
      // Check multiple popular external websites
      const testSites = [
        'https://example.org/about',
        'https://github.com/stellar/stellar-sdk',
        'https://en.wikipedia.org/wiki/Stellar_(payment_network)',
        'https://medium.com/@someone/green-tech',
      ];

      for (const site of testSites) {
        document.body.innerHTML = `<p>Address: ${VALID_STELLAR_ADDRESS}</p>`;
        cleanupWidget();

        const injected = await checkAndInject(site);
        expect(injected).toBe(false);
        expect(document.querySelectorAll('.greenpay-address').length).toBe(0);
      }
    });
  });

  describe('Allowlisted pages injection', () => {
    it('injects widget on allowlisted GreenPay internal pages', async () => {
      const allowlistedUrl = 'https://greenpay.io/projects/reforestation';

      const injected = await checkAndInject(allowlistedUrl);

      expect(injected).toBe(true);
      expect(isWidgetActive()).toBe(true);

      const injectedSpans = document.querySelectorAll('.greenpay-address');
      expect(injectedSpans.length).toBe(1);
      expect(injectedSpans[0].textContent).toBe(VALID_STELLAR_ADDRESS);
    });

    it('injects widget on user-added allowlisted pages', async () => {
      // User opted-in to 'my-clean-earth.org/*'
      mockStorage.allowlist = [...DEFAULT_ALLOWLIST, 'my-clean-earth.org/*'];

      const userSiteUrl = 'https://my-clean-earth.org/donate';
      const injected = await checkAndInject(userSiteUrl);

      expect(injected).toBe(true);
      expect(isWidgetActive()).toBe(true);

      const injectedSpans = document.querySelectorAll('.greenpay-address');
      expect(injectedSpans.length).toBe(1);
      expect(injectedSpans[0].textContent).toBe(VALID_STELLAR_ADDRESS);
    });

    it('creates tooltip on hover and sends message on click for injected address', async () => {
      const allowlistedUrl = 'https://greenpay.io/donate';
      await checkAndInject(allowlistedUrl);

      const span = document.querySelector('.greenpay-address') as HTMLSpanElement;
      expect(span).not.toBeNull();

      // Trigger hover (mouseenter)
      span.dispatchEvent(new MouseEvent('mouseenter'));
      const tooltip = document.querySelector('.greenpay-tooltip');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toBe('Donate to this address via GreenPay');

      // Trigger leave (mouseleave)
      span.dispatchEvent(new MouseEvent('mouseleave'));
      expect(document.querySelector('.greenpay-tooltip')).toBeNull();

      // Trigger click
      span.dispatchEvent(new MouseEvent('click'));
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'openDonatePopup',
        address: VALID_STELLAR_ADDRESS,
      });
    });
  });

  describe('Dynamic opt-in and cleanup', () => {
    it('cleans up previously injected widget when page is removed from allowlist', async () => {
      // First allow and inject
      mockStorage.allowlist = ['example.com/*'];
      await checkAndInject('https://example.com/home');
      expect(document.querySelectorAll('.greenpay-address').length).toBe(1);

      // Now remove from allowlist and re-check
      mockStorage.allowlist = [];
      const stillActive = await checkAndInject('https://example.com/home');

      expect(stillActive).toBe(false);
      expect(isWidgetActive()).toBe(false);
      expect(document.querySelectorAll('.greenpay-address').length).toBe(0);
      expect(document.getElementById('donation-text')?.textContent).toContain(
        VALID_STELLAR_ADDRESS
      );
    });
  });
});
