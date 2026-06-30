import type { Page } from "@playwright/test";

/**
 * Inject a connected-wallet state into the GreenPay frontend.
 *
 * The runtime cooperates via a small test seam in `pages/_app.tsx` that
 * prefers `window.__test_publicKey__` over the real Freighter handshake.
 * The `@stellar/freighter-api` v2 library otherwise routes most calls
 * (`requestAccess`, `getPublicKey`, `signTransaction`, …) through
 * `window.postMessage` to the extension, which is brittle and race-prone
 * to mock from a Playwright init script. Setting this global
 * short-circuits the entire handshake while leaving production behavior
 * untouched (the global is never set in production builds).
 *
 * Combine with `page.route(...)` mocks for `/api/**` and Horizon if the
 * page under test reads balances or fetches data.
 */
export async function mockFreighter(
  page: Page,
  publicKey = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP",
) {
  await page.addInitScript((pk) => {
    (window as unknown as Record<string, unknown>).__test_publicKey__ = pk;
    // Keep window.freighter present so any code that does an
    // `isFreighterInstalled` check still sees a wallet.
    (window as unknown as Record<string, unknown>).freighter = {
      isConnected: () => Promise.resolve({ isConnected: true }),
    };
  }, publicKey);
}
