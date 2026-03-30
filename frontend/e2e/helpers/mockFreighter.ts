import type { Page } from "@playwright/test";

/**
 * Injects a mock Freighter wallet into the page context.
 *
 * NOTE: wallet.ts uses statically bundled @stellar/freighter-api imports,
 * so this mock patches window.freighter (the extension injection point) and
 * stores the mock pk for any code that reads it. For tests that need a
 * fully connected wallet state, combine this with a page.route() mock for
 * the Horizon account endpoint.
 */
export async function mockFreighter(
  page: Page,
  publicKey = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP",
) {
  await page.addInitScript((pk) => {
    // Patch window.freighter — the surface the extension injects
    (window as unknown as Record<string, unknown>).freighter = {
      isConnected: () => Promise.resolve(true),
      getPublicKey: () => Promise.resolve(pk),
      signTransaction: (xdr: string) => Promise.resolve({ signedTxXdr: xdr }),
      getNetwork: () => Promise.resolve("TESTNET"),
      getNetworkDetails: () =>
        Promise.resolve({
          network: "TESTNET",
          networkUrl: "https://horizon-testnet.stellar.org",
          networkPassphrase: "Test SDF Network ; September 2015",
        }),
    };

    // Store the mock public key for test assertions
    (window as unknown as Record<string, unknown>).__mock_public_key__ = pk;
  }, publicKey);
}
