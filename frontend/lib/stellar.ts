/**
 * lib/stellar.ts — Stellar SDK helpers for GreenPay
 */
import { Horizon, Networks, Asset, Operation, TransactionBuilder, Transaction, Memo, rpc, Contract, scValToNative } from "@stellar/stellar-sdk";

const NETWORK     = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as "testnet" | "mainnet";
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
const RPC_URL     = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
export const server = new Horizon.Server(HORIZON_URL);
export const rpcServer = new rpc.Server(RPC_URL);
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "";

export async function getXLMBalance(publicKey: string): Promise<string> {
  try {
    const account = await server.loadAccount(publicKey);
    const xlm = account.balances.find((b) => b.asset_type === "native");
    return xlm ? xlm.balance : "0";
  } catch {
    throw new Error("Account not found or not funded.");
  }
}

export async function getAssetBalance(publicKey: string, assetCode: string, assetIssuer: string): Promise<string | null> {
  try {
    const account = await server.loadAccount(publicKey);
    const asset = account.balances.find((b: any) => b.asset_code === assetCode && b.asset_issuer === assetIssuer);
    // If the asset is not present on the account, the user likely doesn't have the trustline.
    if (!asset) return null;
    return asset.balance;
  } catch {
    throw new Error("Account not found or not funded.");
  }
}

export async function buildDonationTransaction({
  fromPublicKey, toPublicKey, amount, memo, asset,
}: { fromPublicKey: string; toPublicKey: string; amount: string; memo?: string; asset?: { code: string; issuer?: string } }) {
  const source = await server.loadAccount(fromPublicKey);
  const paymentAsset = asset && asset.code && asset.issuer ? new Asset(asset.code, asset.issuer) : Asset.native();

  const builder = new TransactionBuilder(source, { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.payment({ destination: toPublicKey, asset: paymentAsset, amount }))
    .setTimeout(60);
  if (memo) builder.addMemo(Memo.text(memo.slice(0, 28)));
  return builder.build();
}

export async function submitTransaction(signedXDR: string) {
  const tx = new Transaction(signedXDR, NETWORK_PASSPHRASE);
  try { return await server.submitTransaction(tx); }
  catch (err: unknown) {
    const e = err as { response?: { data?: { extras?: { result_codes?: unknown } } } };
    if (e?.response?.data?.extras?.result_codes) throw new Error(`Transaction failed: ${JSON.stringify(e.response.data.extras.result_codes)}`);
    throw err;
  }
}

export function isValidStellarAddress(a: string): boolean { return /^G[A-Z0-9]{55}$/.test(a); }
export function explorerUrl(hash: string): string {
  return `https://stellar.expert/explorer/${NETWORK === "mainnet" ? "public" : "testnet"}/tx/${hash}`;
}
export function accountUrl(addr: string): string {
  return `https://stellar.expert/explorer/${NETWORK === "mainnet" ? "public" : "testnet"}/account/${addr}`;
}

/**
 * Queries the Soroban contract for global impact metrics.
 */
export async function getGlobalImpactStats() {
  if (!CONTRACT_ID) {
    console.warn("CONTRACT_ID not set, returning zero stats");
    return { totalRaisedXLM: "0", totalCO2OffsetGrams: "0", donationCount: 0 };
  }

  const contract = new Contract(CONTRACT_ID);
  
  try {
    const [totalRaised, totalCO2, donationCount] = await Promise.all([
      simulateCall(contract, "get_global_total"),
      simulateCall(contract, "get_global_co2"),
      simulateCall(contract, "get_donation_count")
    ]);

    // totalRaised is in stroops (i128), totalCO2 is in grams (i128)
    return {
      totalRaisedXLM: (Number(totalRaised) / 10_000_000).toLocaleString(undefined, { minimumFractionDigits: 2 }),
      totalCO2OffsetGrams: totalCO2.toString(),
      donationCount: Number(donationCount),
    };
  } catch (err) {
    console.error("Failed to fetch global impact stats:", err);
    return { totalRaisedXLM: "0", totalCO2OffsetGrams: "0", donationCount: 0 };
  }
}

async function simulateCall(contract: Contract, method: string, args: any[] = []) {
  // We use a dummy account for simulation
  const dummyAccount = new Horizon.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "-1");
  const tx = new TransactionBuilder(dummyAccount, { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await rpcServer.simulateTransaction(tx);

  if (rpc.Api.isSimulationSuccess(result)) {
    return scValToNative(result.result!.retval);
  }
  throw new Error(`Simulation failed for ${method}: ${JSON.stringify(result)}`);
}
