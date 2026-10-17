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

let localStore: Record<string, unknown>;

function createStorageArea(initial: Record<string, unknown> = {}): {
  area: any;
} {
  const store: Record<string, unknown> = { ...initial };

  const get = jest.fn(
    (
      keys: string | string[] | Record<string, unknown>,
      callback?: (result: Record<string, unknown>) => void,
    ) => {
      let result: Record<string, unknown> = {};
      if (typeof keys === 'string') {
        result = { [keys]: store[keys] };
      } else if (Array.isArray(keys)) {
        result = Object.fromEntries(keys.map((key) => [key, store[key]]));
      } else if (keys && typeof keys === 'object') {
        result = Object.fromEntries(
          Object.entries(keys).map(([key, fallback]) => [
            key,
            store[key] === undefined ? fallback : store[key],
          ]),
        );
      }
      callback?.(result);
      return Promise.resolve(result);
    },
  );

  const set = jest.fn(
    (items: Record<string, unknown>, callback?: () => void) => {
      Object.assign(store, items);
      callback?.();
      return Promise.resolve();
    },
  );

  const remove = jest.fn(
    (keys: string | string[], callback?: () => void) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      callback?.();
      return Promise.resolve();
    },
  );

  return { area: { get, set, remove, store } };
}

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
      <div class="search-wrapper">
        <input id="project-search" />
        <ul id="search-dropdown" class="search-dropdown hidden"></ul>
      </div>
    `;
    delete (window as any).freighter;

    const local = createStorageArea({
      onboarded: true,
      pendingDonations: [],
      network: 'testnet',
    });
    localStore = local.area.store;
    const sync = createStorageArea({ network: 'testnet' });
    const session = createStorageArea();

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: local.area,
          sync: sync.area,
          session: session.area,
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

  describe("Project search", () => {
    let fetchMock: jest.Mock;

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    async function waitFor(assertion: () => void, timeoutMs = 2000): Promise<void> {
      const started = Date.now();
      for (;;) {
        try {
          assertion();
          return;
        } catch (error) {
          if (Date.now() - started > timeoutMs) throw error;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    }

    async function openPopup(): Promise<void> {
      document.dispatchEvent(new Event("DOMContentLoaded"));
      await flush();
    }

    function typeQuery(query: string): void {
      const input = document.getElementById("project-search") as HTMLInputElement;
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function dropdown(): HTMLElement {
      return document.getElementById("search-dropdown") as HTMLElement;
    }

    beforeEach(() => {
      fetchMock = jest.fn();
      (globalThis as any).fetch = fetchMock;
    });

    afterEach(() => {
      delete (globalThis as any).fetch;
    });

    test("debounces input and renders name, category and impact snippet", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: "p1",
              name: "Solar for Schools",
              category: "Solar Energy",
              aiSummary: "Brings clean power to rural schools.",
            },
          ],
        }),
      });

      await openPopup();
      typeQuery("s");
      typeQuery("so");
      typeQuery("solar");

      await waitFor(() => {
        expect(document.querySelectorAll("#search-dropdown .search-result-item")).toHaveLength(1);
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain(
        "/api/projects?search=solar&limit=5",
      );

      const item = document.querySelector("#search-dropdown .search-result-item")!;
      expect(item.textContent).toContain("Solar for Schools");
      expect(item.textContent).toContain("Solar Energy");
      expect(item.textContent).toContain("Brings clean power to rural schools.");

      await waitFor(() => {
        expect(localStore.projectSearchCache).toBeTruthy();
      });
      expect((localStore.projectSearchCache as any).query).toBe("solar");
    });

    test("shows an empty-state message when no projects match", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      await openPopup();
      typeQuery("nothing-matches");

      await waitFor(() => {
        expect(dropdown().textContent).toContain("No projects found");
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(localStore.projectSearchCache).toBeUndefined();
    });

    test("shows an offline notice when the API fails and no cache exists", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));

      await openPopup();
      typeQuery("solar");

      await waitFor(() => {
        expect(dropdown().textContent).toContain(
          "Search unavailable. Check your connection and try again.",
        );
      });
      expect(dropdown().querySelector(".search-notice-error")).not.toBeNull();
      expect(dropdown().querySelectorAll(".search-result-item")).toHaveLength(0);
    });

    test("falls back to the cached results when the API is offline", async () => {
      localStore.projectSearchCache = {
        query: "wind",
        projects: [
          { id: "p2", name: "Wind Farm", category: "Wind Energy" },
        ],
        cachedAt: Date.now(),
      };
      fetchMock.mockRejectedValue(new Error("network down"));

      await openPopup();
      typeQuery("solar");

      await waitFor(() => {
        expect(dropdown().textContent).toContain(
          "Offline — showing cached results for “wind”",
        );
      });
      expect(dropdown().textContent).toContain("Wind Farm");
      expect(dropdown().querySelectorAll(".search-result-item")).toHaveLength(1);
    });
  });
});
