/**
 * lib/auth.ts — Wallet-signature authentication for mutating API calls.
 *
 * Donors prove control of their Stellar wallet by signing a one-time
 * challenge (see POST /api/auth/challenge and POST /api/auth/token on the
 * backend). The resulting JWT is cached in localStorage until shortly before
 * it expires, so repeated authenticated calls don't re-prompt the wallet.
 */
import {
  Account,
  Asset,
  Memo,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { getConnectedPublicKey, signTransactionWithWallet } from "./wallet";
import { NETWORK_PASSPHRASE } from "./stellar";

const TOKEN_STORAGE_KEY = "greenpay_wallet_auth_token";
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000; // refresh 1 min before expiry

interface CachedToken {
  token: string;
  expiresAt: number;
}

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || "";
}

function readCachedToken(): CachedToken | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedToken;
    if (!parsed.token || !parsed.expiresAt) return null;
    // Treat tokens within the buffer window as expired.
    if (Date.now() >= parsed.expiresAt - TOKEN_EXPIRY_BUFFER_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedToken(token: string, expiresInSeconds: number): void {
  if (typeof window === "undefined") return;
  const cached: CachedToken = {
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
  window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(cached));
}

export function clearWalletAuthToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

/**
 * Fetch a wallet-authentication JWT, using a cached token when still valid.
 *
 * The signed transaction is never submitted to the network — it exists only
 * as an authentication artifact (the backend verifies the memo and the
 * signature, then discards it).
 *
 * @returns The JWT, or null when no wallet is connected or signing failed.
 */
export async function getWalletAuthToken(): Promise<string | null> {
  const cached = readCachedToken();
  if (cached) return cached.token;

  const publicKey = await getConnectedPublicKey();
  if (!publicKey) return null;

  const base = getApiBase();

  // 1. Request a one-time challenge.
  const challengeRes = await fetch(`${base}/api/v1/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: publicKey }),
  });
  if (!challengeRes.ok) return null;
  const challengeBody = (await challengeRes.json()) as {
    success: boolean;
    data?: { challenge: string; expiresAt: string };
  };
  const challenge = challengeBody.data?.challenge;
  if (!challenge) return null;

  // 2. Build a transaction whose memo is the challenge and sign it with
  //    Freighter. A 1-stroop payment to self is used because every
  //    transaction needs at least one operation; it is never submitted.
  const source = new Account(publicKey, "-1");
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: publicKey,
        amount: "0.0000001",
        asset: Asset.native(),
      }),
    )
    .addMemo(Memo.text(challenge))
    .setTimeout(30)
    .build();

  const { signedXDR, error } = await signTransactionWithWallet(tx.toXDR());
  if (error || !signedXDR) return null;

  // 3. Exchange the signed transaction for a JWT.
  const tokenRes = await fetch(`${base}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: publicKey, signedXdr: signedXDR }),
  });
  if (!tokenRes.ok) return null;
  const tokenBody = (await tokenRes.json()) as {
    success: boolean;
    data?: { token: string; tokenType: string; expiresIn: number };
  };
  const token = tokenBody.data?.token;
  if (!token) return null;

  writeCachedToken(token, tokenBody.data?.expiresIn ?? 3600);
  return token;
}

/**
 * fetch() wrapper that attaches the wallet-authentication JWT. Use for
 * endpoints that require an authenticated donor (e.g. POST /api/ratings).
 */
export async function authedFetch(
  input: RequestInfo,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getWalletAuthToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
