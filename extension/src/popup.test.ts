/**
 * Tests for popup.ts Freighter wallet integration
 */

jest.mock('@stellar/stellar-sdk', () => ({
  Asset: { native: jest.fn() },
  Horizon: { Server: jest.fn().mockImplementation(() => ({})) },
  Memo: { text: jest.fn() },
  Networks: { PUBLIC: 'public', TESTNET: 'testnet' },
  Operation: { payment: jest.fn() },
  TransactionBuilder: { fromXDR: jest.fn() },
}));

import './popup';

describe("GreenPay Popup - Freighter Integration", () => {
  beforeEach(() => {
    // Clean up DOM before each test
    document.body.innerHTML = `
      <form id="donation-form"></form>
      <div id="wallet-address"></div>
      <div id="wallet-info"></div>
      <button id="connect-btn">Connect Wallet</button>
      <div id="status-message"></div>
      <input id="custom-amount-input" />
      <button id="settings-btn">Settings</button>
    `;
    delete (window as any).freighter;

    const storageArea = {
      get: jest.fn((keys: any, callback?: (result: Record<string, unknown>) => void) => {
        const result = Array.isArray(keys)
          ? Object.fromEntries(keys.map((key: string) => [
              key,
              key === "onboarded" ? true : key === "pendingDonations" ? [] : undefined,
            ]))
          : typeof keys === "string"
            ? { [keys]: keys === "network" ? "testnet" : [] }
            : { ...keys };
        callback?.(result);
        return Promise.resolve(result);
      }),
      set: jest.fn((_items: unknown, callback?: () => void) => {
        callback?.();
        return Promise.resolve();
      }),
      remove: jest.fn((_keys: unknown, callback?: () => void) => {
        callback?.();
        return Promise.resolve();
      }),
    };
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: storageArea,
          sync: storageArea,
          session: storageArea,
          onChanged: { addListener: jest.fn() },
        },
        runtime: {},
        tabs: { query: jest.fn().mockResolvedValue([]) },
        action: {
          setBadgeText: jest.fn(),
          setBadgeBackgroundColor: jest.fn(),
        },
      },
    });
    jest.spyOn(window, "setInterval").mockReturnValue(0);
  });

  describe("Freighter Missing on DOMContentLoaded", () => {
    test("should render error message when Freighter is not installed", (done: jest.DoneCallback) => {
      // Simulate Freighter not being installed
      (window as any).freighter = undefined;

      // Trigger the DOMContentLoaded event
      const event = new Event("DOMContentLoaded");
      document.dispatchEvent(event);

      // Wait a tick for async operations
      setTimeout(() => {
        const form = document.getElementById("donation-form");
        expect(form).toBeTruthy();

        // Check that the form contains the error message
        const html = form!.innerHTML;
        expect(html).toContain("Freighter Wallet Required");
        expect(html).toContain("Install Freighter Wallet");
        expect(html).toContain("https://www.freighter.app/");
        done();
      }, 100);
    });

    test("should not crash when Freighter is undefined", (done: jest.DoneCallback) => {
      (window as any).freighter = undefined;

      expect(() => {
        const event = new Event("DOMContentLoaded");
        document.dispatchEvent(event);
      }).not.toThrow();

      setTimeout(() => {
        // If we get here without crashing, the test passes
        done();
      }, 100);
    });
  });

  describe("Freighter Present", () => {
    beforeEach(() => {
      // Mock Freighter extension
      (window as any).freighter = {
        getPublicKey: jest
          .fn()
          .mockResolvedValue(
            "GBZXN3XVFC2TYZF7PJKX5CZRFF7YXLMPG7D5VVPYP3AJXTD32HV2D3",
          ),
        signTransaction: jest.fn(),
      };
    });

    test("should allow popup to load without error when Freighter is available", (done: jest.DoneCallback) => {
      expect(() => {
        const event = new Event("DOMContentLoaded");
        document.dispatchEvent(event);
      }).not.toThrow();

      setTimeout(() => {
        const form = document.getElementById("donation-form");
        // Form should exist and should NOT contain error message
        expect(form).toBeTruthy();
        expect(form!.innerHTML).not.toContain("Freighter Wallet Required");
        done();
      }, 100);
    });
  });
});
