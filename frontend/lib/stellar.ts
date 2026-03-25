/**
 * -----------------------------------------------------------------------------
 * lib/stellar.ts — Stellar SDK Helpers for GreenPay
 * -----------------------------------------------------------------------------
 * This module provides helper utilities for interacting with the Stellar
 * blockchain using the Stellar SDK.
 *
 * It includes:
 * - Account balance retrieval
 * - Transaction construction (donations)
 * - Transaction submission
 * - Address validation
 * - Explorer URL helpers
 *
 * These utilities abstract low-level Stellar SDK operations and provide a
 * cleaner interface for frontend usage.
 *
 * @see https://developers.stellar.org/api/introduction (Horizon API)
 * @see https://developers.stellar.org/docs/build/smart-contracts/overview (Soroban docs)
 * -----------------------------------------------------------------------------
 */

import {
  Horizon,
  Networks,
  Asset,
  Operation,
  TransactionBuilder,
  Transaction,
  Memo,
} from "@stellar/stellar-sdk";

/**
 * Current Stellar network (testnet or mainnet).
 */
const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as
  | "testnet"
  | "mainnet";

/**
 * Horizon API endpoint URL.
 */
const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";

/**
 * Network passphrase used for signing transactions.
 */
export const NETWORK_PASSPHRASE =
  NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

/**
 * Horizon server instance for interacting with the Stellar network.
 */
export const server = new Horizon.Server(HORIZON_URL);

// ── Account Utilities ─────────────────────────────────────────────────────────

/**
 * Fetch the XLM balance of a Stellar account.
 *
 * @param publicKey - Stellar public key (G...)
 *
 * @returns Promise resolving to the XLM balance as a string
 *
 * @throws Will throw an error if the account does not exist or is unfunded
 *
 * @example
 * ```ts
 * const balance = await getXLMBalance("GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
 * console.log(balance); // e.g. "100.5000000"
 * ```
 */
export async function getXLMBalance(publicKey: string): Promise<string> {
  try {
    const account = await server.loadAccount(publicKey);
    const xlm = account.balances.find((b) => b.asset_type === "native");
    return xlm ? xlm.balance : "0";
  } catch {
    throw new Error("Account not found or not funded.");
  }
}

// ── Transactions ──────────────────────────────────────────────────────────────

/**
 * Build a Stellar payment transaction for a donation.
 *
 * This function constructs (but does NOT sign or submit) a transaction
 * that transfers XLM from a donor to a recipient.
 *
 * @param params - Transaction parameters
 * @param params.fromPublicKey - Sender's Stellar public key
 * @param params.toPublicKey - Recipient's Stellar public key
 * @param params.amount - Amount of XLM to send (as string)
 * @param params.memo - Optional text memo (max 28 chars)
 *
 * @returns Promise resolving to an unsigned Transaction object
 *
 * @throws Will throw an error if the source account cannot be loaded
 *
 * @example
 * ```ts
 * const tx = await buildDonationTransaction({
 *   fromPublicKey: "GXXXX...",
 *   toPublicKey: "GYYYY...",
 *   amount: "10",
 *   memo: "Donation",
 * });
 *
 * const xdr = tx.toXDR(); // send to wallet for signing
 * ```
 */
export async function buildDonationTransaction({
  fromPublicKey,
  toPublicKey,
  amount,
  memo,
}: {
  fromPublicKey: string;
  toPublicKey: string;
  amount: string;
  memo?: string;
}) {
  const source = await server.loadAccount(fromPublicKey);

  const builder = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: toPublicKey,
        asset: Asset.native(),
        amount,
      })
    )
    .setTimeout(60);

  if (memo) builder.addMemo(Memo.text(memo.slice(0, 28)));

  return builder.build();
}

/**
 * Submit a signed Stellar transaction to the network.
 *
 * @param signedXDR - Signed transaction XDR string
 *
 * @returns Promise resolving to Horizon transaction response
 *
 * @throws Will throw a detailed error if the transaction fails
 *
 * @example
 * ```ts
 * const result = await submitTransaction(signedXDR);
 * console.log(result.hash);
 * ```
 */
export async function submitTransaction(signedXDR: string) {
  const tx = new Transaction(signedXDR, NETWORK_PASSPHRASE);

  try {
    return await server.submitTransaction(tx);
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { extras?: { result_codes?: unknown } } };
    };

    if (e?.response?.data?.extras?.result_codes) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(
          e.response.data.extras.result_codes
        )}`
      );
    }

    throw err;
  }
}

// ── Validation & Utilities ────────────────────────────────────────────────────

/**
 * Validate a Stellar public key.
 *
 * @param a - Stellar address string
 *
 * @returns True if valid, false otherwise
 *
 * @example
 * ```ts
 * const isValid = isValidStellarAddress("GXXXX...");
 * ```
 */
export function isValidStellarAddress(a: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(a);
}

/**
 * Generate a Stellar Expert transaction explorer URL.
 *
 * @param hash - Transaction hash
 *
 * @returns URL string to view transaction details
 *
 * @example
 * ```ts
 * const url = explorerUrl("TX_HASH");
 * window.open(url);
 * ```
 */
export function explorerUrl(hash: string): string {
  return `https://stellar.expert/explorer/${
    NETWORK === "mainnet" ? "public" : "testnet"
  }/tx/${hash}`;
}

/**
 * Generate a Stellar Expert account explorer URL.
 *
 * @param addr - Stellar public key
 *
 * @returns URL string to view account details
 *
 * @example
 * ```ts
 * const url = accountUrl("GXXXX...");
 * ```
 */
export function accountUrl(addr: string): string {
  return `https://stellar.expert/explorer/${
    NETWORK === "mainnet" ? "public" : "testnet"
  }/account/${addr}`;
}