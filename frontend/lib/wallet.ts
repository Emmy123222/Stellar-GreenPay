/**
 * lib/wallet.ts — Freighter wallet integration
 */
import { isConnected, getAddress, signTransaction, requestAccess, isAllowed } from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "./stellar";

export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const result: any = await isConnected();
    // Handle both boolean and object return types
    return typeof result === 'boolean' ? result : result.isConnected;
  }
  catch { return false; }
}

export async function connectWallet(): Promise<{ publicKey: string | null; error: string | null }> {
  const installed = await isFreighterInstalled();
  if (!installed) return { publicKey: null, error: "Freighter not installed. Visit https://freighter.app" };
  try {
    await requestAccess();
    const result: any = await getAddress();
    // Handle both string and object return types
    const publicKey = typeof result === 'string' ? result : result?.address || result?.publicKey;
    return { publicKey: publicKey || null, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("User declined")) return { publicKey: null, error: "Connection rejected." };
    return { publicKey: null, error: `Connection failed: ${msg}` };
  }
}

export async function getConnectedPublicKey(): Promise<string | null> {
  try {
    const allowedResult: any = await isAllowed();
    // Handle both boolean and object return types
    const isUserAllowed = typeof allowedResult === 'boolean' ? allowedResult : allowedResult.isAllowed;
    if (!isUserAllowed) return null;

    const result: any = await getAddress();
    // Handle both string and object return types
    const publicKey = typeof result === 'string' ? result : result?.publicKey || result?.address;
    return publicKey || null;
  } catch { return null; }
}

export async function signTransactionWithWallet(xdr: string): Promise<{ signedXDR: string | null; error: string | null }> {
  try {
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "MAINNET" : "TESTNET";
    const result: any = await (signTransaction as any)(xdr, { networkPassphrase: NETWORK_PASSPHRASE, network });
    // Handle both string and object return types
    const signedXDR = typeof result === 'string' ? result : result?.signedTransaction;
    return { signedXDR: signedXDR, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("User declined") || msg.includes("rejected")) return { signedXDR: null, error: "Transaction rejected." };
    return { signedXDR: null, error: `Signing failed: ${msg}` };
  }
}
