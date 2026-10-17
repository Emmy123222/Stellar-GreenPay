/**
 * @jest-environment node
 */
import { apiOrigins, buildCsp, sentryOrigins } from "../middleware";

const ORIGINAL_ENV = { ...process.env };

function connectSrc(csp: string): string {
  const directive = csp
    .split("; ")
    .find((part) => part.startsWith("connect-src "));
  if (!directive) throw new Error("connect-src directive missing from CSP");
  return directive;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("middleware CSP", () => {
  it("locks down the directives that do not depend on configuration", () => {
    const csp = buildCsp("test-nonce", false);

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'nonce-test-nonce'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("allows framing only for widget pages", () => {
    expect(buildCsp("n", true)).toContain("frame-ancestors *");
    expect(buildCsp("n", true)).not.toContain("frame-ancestors 'none'");
    expect(buildCsp("n", false)).not.toContain("frame-ancestors *");
  });

  it("keeps the Stellar, tile and avatar integrations working", () => {
    const csp = buildCsp("n", false);

    expect(connectSrc(csp)).toContain("https://horizon-testnet.stellar.org");
    expect(connectSrc(csp)).toContain("https://horizon.stellar.org");
    expect(connectSrc(csp)).toContain("https://soroban-testnet.stellar.org");
    expect(connectSrc(csp)).toContain("https://friendbot.stellar.org");
    expect(connectSrc(csp)).toContain("https://api.coingecko.com");
    expect(csp).toContain("https://a.tile.openstreetmap.org");
    expect(csp).toContain("https://avatars.githubusercontent.com");
  });

  it("allows the configured API origin so cross-origin backends are not blocked", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.stellar-greenpay.app";

    expect(apiOrigins()).toEqual(["https://api.stellar-greenpay.app"]);
    expect(connectSrc(buildCsp("n", false))).toContain("https://api.stellar-greenpay.app");
  });

  it("derives the Sentry origin from the DSN", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public-key@o123.ingest.sentry.io/42";

    expect(sentryOrigins()).toEqual(["https://o123.ingest.sentry.io"]);
    expect(connectSrc(buildCsp("n", false))).toContain("https://o123.ingest.sentry.io");
  });

  it("allows Sentry's SaaS ingest domains when no DSN is configured", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    expect(sentryOrigins()).toEqual([
      "https://*.ingest.sentry.io",
      "https://*.ingest.us.sentry.io",
    ]);
    const csp = connectSrc(buildCsp("n", false));
    expect(csp).toContain("https://*.ingest.sentry.io");
  });

  it("ignores malformed env values instead of emitting broken directives", () => {
    process.env.NEXT_PUBLIC_API_URL = "not a url";
    process.env.NEXT_PUBLIC_SENTRY_DSN = "://nope";

    expect(apiOrigins()).toEqual([]);
    expect(sentryOrigins()).toEqual([
      "https://*.ingest.sentry.io",
      "https://*.ingest.us.sentry.io",
    ]);
    const csp = buildCsp("n", false);
    expect(csp).not.toContain("not a url");
    expect(connectSrc(csp)).toContain("https://*.ingest.sentry.io");
  });

  it("ignores non-http(s) API URLs", () => {
    process.env.NEXT_PUBLIC_API_URL = "javascript:alert(1)";

    expect(apiOrigins()).toEqual([]);
  });
});
