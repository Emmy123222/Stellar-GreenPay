/**
 * lib/stellar.ts — Stellar SDK helpers for GreenPay
 *
 * Utilities for interacting with the Stellar network (Horizon) and Soroban (RPC)
 * from the frontend.
 *
 * @see https://developers.stellar.org/docs/data/horizon
 * @see https://soroban.stellar.org/docs
 */
import { Horizon, Networks, Asset, Operation, TransactionBuilder, Transaction, Memo, rpc, Contract, scValToNative, Address, nativeToScVal, Account } from "@stellar/stellar-sdk";

export const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as "testnet" | "mainnet";
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
const RPC_URL     = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
export const server = new Horizon.Server(HORIZON_URL);
export const rpcServer = new rpc.Server(RPC_URL);
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "";

/** Soroban escrow contract (deploy `contracts/escrow-contract`). */
export const ESCROW_CONTRACT_ID = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID || "";

/**
 * Fetch an account's native XLM balance using Horizon.
 *
 * @param publicKey - Stellar account public key.
 * @returns XLM balance as a string (decimal).
 * @throws If the account does not exist, is not funded, or Horizon is unreachable.
 *
 * @see https://developers.stellar.org/docs/data/horizon/api-reference/resources/accounts
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

/**
 * Funds a testnet account via Stellar Friendbot.
 * Returns the credited XLM balance after funding.
 * Only works on testnet — throws on mainnet.
 *
 * @param publicKey - Stellar account public key to fund.
 * @returns The account's XLM balance after funding.
 * @throws If called on mainnet, the request fails, or the account is already funded.
 *
 * @see https://friendbot.stellar.org
 */
export async function getFriendBotFunding(publicKey: string): Promise<string> {
  if (NETWORK === "mainnet") {
    throw new Error("Friendbot is only available on testnet.");
  }
  const response = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // A 400 with "createAccountAlreadyExist" means it was already funded
    if (response.status === 400 && body.includes("createAccountAlreadyExist")) {
      throw new Error("Account is already funded.");
    }
    throw new Error(`Friendbot request failed (${response.status}).`);
  }
  // Wait briefly for Horizon to process the account creation
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return getXLMBalance(publicKey);
}

/**
 * Fetch a non-native asset balance (e.g., USDC) for an account.
 *
 * @param publicKey - Stellar account public key.
 * @param assetCode - Asset code (e.g., "USDC").
 * @param assetIssuer - Issuer account public key.
 * @returns Balance string, or `null` when the trustline is missing.
 * @throws If the account does not exist, is not funded, or Horizon is unreachable.
 */
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

/**
 * Build an unsigned payment transaction for a donation (native XLM or a custom asset).
 *
 * @param params - Transaction builder parameters.
 * @param params.fromPublicKey - Source account public key (donor).
 * @param params.toPublicKey - Destination account public key (project).
 * @param params.amount - Amount as a decimal string.
 * @param params.memo - Optional text memo (trimmed to 28 chars).
 * @param params.asset - Optional asset. Omit to send native XLM.
 * @returns Unsigned Stellar transaction ready to be signed by the wallet.
 * @throws If Horizon fails to load the source account or parameters are invalid.
 *
 * @example
 * const tx = await buildDonationTransaction({
 *   fromPublicKey: "G...DONOR...",
 *   toPublicKey: "G...PROJECT...",
 *   amount: "5",
 *   memo: "GreenPay donation",
 * });
 * // Sign and submit with your wallet provider.
 *
 * @see https://developers.stellar.org/docs/data/horizon/api-reference/resources/accounts
 */
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

/**
 * Builds a Soroban contract donation transaction.
 * Invokes the contract's donate() function which transfers XLM and records the donation on-chain.
 *
 * @param params - Contract call parameters.
 * @param params.contractId - Target Soroban contract id.
 * @param params.tokenAddress - Token contract address (for token-based donations).
 * @param params.donor - Donor Stellar public key.
 * @param params.projectId - Project id (string) recorded by the contract.
 * @param params.amount - Amount as a decimal string in XLM units.
 * @param params.msgHash - Message hash (u32) recorded by the contract.
 * @returns Unsigned assembled transaction ready to be signed by the wallet.
 * @throws If simulation fails, the account is unfunded, or the contract rejects the call.
 *
 * @see https://soroban.stellar.org/docs
 */
export async function buildContractDonationTransaction({
  contractId,
  tokenAddress,
  donor,
  projectId,
  amount,
  msgHash,
}: {
  contractId: string;
  tokenAddress: string;
  donor: string;
  projectId: string;
  amount: string;
  msgHash: number;
}) {
  const source = await server.loadAccount(donor);
  const contract = new Contract(contractId);

  // Convert parameters to Soroban types
  const donorAddress = new Address(donor);
  const tokenAddr = new Address(tokenAddress);
  const amountInStroops = Math.floor(parseFloat(amount) * 10_000_000);

  // Build the contract invocation transaction
  const builder = new TransactionBuilder(source, {
    fee: "1000000", // Higher fee for contract calls
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "donate",
        tokenAddr.toScVal(),
        donorAddress.toScVal(),
        nativeToScVal(projectId, { type: "string" }),
        nativeToScVal(amountInStroops, { type: "i128" }),
        nativeToScVal(msgHash, { type: "u32" })
      )
    )
    .setTimeout(60);

  const tx = builder.build();

  // Simulate to get the resource fees
  const simulated = await rpcServer.simulateTransaction(tx);

  if (rpc.Api.isSimulationSuccess(simulated)) {
    // Prepare the transaction with simulation results
    return rpc.assembleTransaction(tx, simulated).build();
  } else {
    throw formatSimulationFailure(simulated);
  }
}

/**
 * Builds a Soroban transaction that calls `release_escrow(client, job_id)` on the escrow contract.
 * The client account must match the job’s client and must have funded this job via `create_job` on-chain.
 *
 * @param params - Escrow release parameters.
 * @param params.contractId - Escrow contract id.
 * @param params.jobId - Job id used when the job was created on-chain.
 * @param params.clientAddress - Client (payer) Stellar public key.
 * @returns Unsigned assembled transaction ready to be signed by the wallet.
 * @throws If the escrow contract is not configured, simulation fails, or the contract rejects the call.
 */
export async function buildReleaseEscrowTransaction({
  contractId,
  jobId,
  clientAddress,
}: {
  contractId: string;
  jobId: string;
  clientAddress: string;
}) {
  if (!contractId.trim()) {
    throw new Error("Escrow contract is not configured (set NEXT_PUBLIC_ESCROW_CONTRACT_ID).");
  }
  const source = await server.loadAccount(clientAddress);
  const contract = new Contract(contractId);
  const clientAddr = new Address(clientAddress);
  const tx = new TransactionBuilder(source, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "release_escrow",
        clientAddr.toScVal(),
        nativeToScVal(jobId, { type: "string" }),
      ),
    )
    .setTimeout(60)
    .build();

  const simulated = await rpcServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(simulated)) {
    return rpc.assembleTransaction(tx, simulated).build();
  }
  throw formatSimulationFailure(simulated);
}

/** Maps Soroban simulation errors to short, user-facing messages. */
/**
 * Convert a Soroban simulation result into a user-friendly `Error`.
 *
 * @param simulated - RPC simulation response (success or failure).
 * @returns An `Error` describing the likely cause.
 * @throws Never; this function always returns an `Error` instance.
 */
export function formatSimulationFailure(simulated: unknown): Error {
  const raw = JSON.stringify(simulated);
  if (/underfunded|insufficient/i.test(raw) && /balance|fee|Fund/i.test(raw)) {
    return new Error(
      "Insufficient XLM to pay Soroban fees or complete the release. Add test XLM to this account.",
    );
  }
  if (raw.includes("Job not found")) {
    return new Error(
      "This job ID is not on the escrow contract. Fund it first with create_job using the same job ID.",
    );
  }
  if (raw.includes("Only the client can release")) {
    return new Error("Connect the client wallet — only the client can release escrow.");
  }
  if (raw.includes("Already released")) {
    return new Error("This escrow was already released on-chain.");
  }
  if (raw.includes("HostError") || raw.includes("VmValidation")) {
    return new Error(
      "The contract rejected this call. Check network (testnet/mainnet) and contract ID.",
    );
  }
  return new Error(
    "Could not simulate release_escrow. Verify NEXT_PUBLIC_ESCROW_CONTRACT_ID and that the job exists on-chain.",
  );
}

/** Maps Horizon submission errors to user-friendly text. */
/**
 * Convert a Horizon submission error into a short user-facing message.
 *
 * @param err - Error thrown by `server.submitTransaction`.
 * @returns Friendly error text.
 * @throws Never; this function always returns a string.
 */
export function formatTransactionError(err: unknown): string {
  const e = err as {
    response?: {
      data?: {
        extras?: { result_codes?: { transaction?: string; operations?: string[] } };
        detail?: string;
      };
    };
    message?: string;
  };
  const codes = e?.response?.data?.extras?.result_codes;
  const ops = (codes?.operations ?? []).join(" ");
  const txc = codes?.transaction ?? "";
  const blob = `${txc} ${ops}`.toLowerCase();
  if (blob.includes("underfunded") || blob.includes("op_underfunded")) {
    return "Insufficient XLM balance for network fees or the payment.";
  }
  if (blob.includes("insufficient_fee") || blob.includes("tx_insufficient_fee")) {
    return "Network fee too low. Wait and try again, or use a higher fee.";
  }
  if (blob.includes("bad_auth") || blob.includes("op_bad_auth")) {
    return "Transaction was not authorized. Use Freighter with the client account.";
  }
  if (e?.response?.data?.detail && typeof e.response.data.detail === "string") {
    return e.response.data.detail;
  }
  const msg = e?.message || String(err);
  return msg.length > 280 ? `${msg.slice(0, 280)}…` : msg;
}

/**
 * Submit a signed transaction XDR to Horizon.
 *
 * @param signedXDR - Signed transaction XDR (base64).
 * @returns Horizon submission response.
 * @throws If Horizon rejects the transaction; the error message is formatted for display.
 */
export async function submitTransaction(signedXDR: string) {
  const tx = new Transaction(signedXDR, NETWORK_PASSPHRASE);
  try {
    return await server.submitTransaction(tx);
  } catch (err: unknown) {
    throw new Error(formatTransactionError(err));
  }
}

/**
 * Validate a Stellar account public key (G...).
 *
 * @param a - Candidate public key string.
 * @returns `true` if the string matches the basic public-key format.
 * @throws Never.
 */
export function isValidStellarAddress(a: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(a);
}

/**
 * Build a Stellar Expert transaction URL for the current network.
 *
 * @param hash - Transaction hash.
 * @returns Explorer URL.
 * @throws Never.
 */
export function explorerUrl(hash: string): string {
  return `https://stellar.expert/explorer/${NETWORK === "mainnet" ? "public" : "testnet"}/tx/${hash}`;
}

/**
 * Build a Stellar Expert account URL for the current network.
 *
 * @param addr - Account public key.
 * @returns Explorer URL.
 * @throws Never.
 */
export function accountUrl(addr: string): string {
  return `https://stellar.expert/explorer/${NETWORK === "mainnet" ? "public" : "testnet"}/account/${addr}`;
}

/**
 * Queries the Soroban contract for global impact metrics.
 *
 * @returns Global impact metrics. Returns zeroed values when the contract is not configured or on errors.
 * @throws Never; errors are caught and converted to zeroed values.
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

/**
 * Queries the contract for donor statistics including badge tier.
 *
 * @param donorAddress - Donor Stellar public key.
 * @returns Donor stats, or `null` when the contract is not configured or on errors.
 * @throws Never; errors are caught and converted to `null`.
 */
export async function getDonorStats(donorAddress: string) {
  if (!CONTRACT_ID) {
    return null;
  }

  const contract = new Contract(CONTRACT_ID);

  try {
    const donor = new Address(donorAddress);
    const stats = await simulateCall(contract, "get_donor_stats", [donor.toScVal()]);

    return {
      totalDonated: Number(stats.total_donated) / 10_000_000,
      donationCount: Number(stats.donation_count),
      badge: stats.badge,
      co2OffsetGrams: Number(stats.co2_offset_grams),
    };
  } catch (err) {
    console.error("Failed to fetch donor stats:", err);
    return null;
  }
}

/**
 * Simple djb2 hash function for donation messages.
 * Returns a 32-bit unsigned integer hash.
 *
 * @param message - Message to hash.
 * @returns Unsigned 32-bit hash.
 * @throws Never.
 */
export function hashMessage(message: string): number {
  let hash = 5381;
  for (let i = 0; i < message.length; i++) {
    hash = ((hash << 5) + hash) + message.charCodeAt(i);
    hash = hash >>> 0; // Convert to unsigned 32-bit integer
  }
  return hash;
}

/**
 * Stream real-time payments to a wallet address using Horizon SSE.
 * Returns a cleanup function to close the stream.
 *
 * @param walletAddress - Account to stream payments for.
 * @param onPayment - Callback invoked for each matching payment event.
 * @param cursor - Optional cursor value; defaults to "now".
 * @returns Cleanup function to stop streaming.
 * @throws Never; stream errors are surfaced via the Horizon SDK `onerror` callback.
 */
export function streamProjectPayments(
  walletAddress: string,
  onPayment: (payment: {
    id: string;
    from: string;
    amount: string;
    asset: string;
    createdAt: string;
    transactionHash: string;
  }) => void,
  cursor?: string,
): () => void {
  const builder = server
    .payments()
    .forAccount(walletAddress)
    .order("asc")
    .cursor(cursor || "now");

  const closeStream = builder.stream({
    onmessage: (record: any) => {
      if (record.type !== "payment" && record.type !== "create_account") return;
      onPayment({
        id: record.id,
        from: record.from || record.funder || record.source_account,
        amount: record.amount || record.starting_balance || "0",
        asset: record.asset_code || "XLM",
        createdAt: record.created_at,
        transactionHash: record.transaction_hash,
      });
    },
    onerror: (err: any) => {
      console.error("Horizon SSE stream error:", err);
    },
  });

  return closeStream;
}

/**
 * Stream global XLM donations and map destination accounts to known projects.
 * Returns a cleanup function to close the Horizon SSE stream.
 */
export function streamGlobalProjectDonations(
  projects: Array<{ id: string; name: string; walletAddress: string }>,
  onDonation: (donation: {
    id: string;
    projectId: string;
    projectName: string;
    amountXLM: string;
    from: string;
    createdAt: string;
    transactionHash: string;
  }) => void,
  cursor?: string,
): () => void {
  const projectByWallet = new Map(
    projects.map((project) => [project.walletAddress.toUpperCase(), project]),
  );

  const closeStream = server
    .payments()
    .cursor(cursor || "now")
    .stream({
      onmessage: (record: any) => {
        if (record.type !== "payment" && record.type !== "create_account") return;
        const destination = String(
          record.to || record.account || record.destination || "",
        ).toUpperCase();
        if (!destination || !projectByWallet.has(destination)) return;

        const project = projectByWallet.get(destination);
        if (!project) return;

        const isNativeXLM =
          record.asset_type === "native" || !record.asset_type || record.asset_code === "XLM";
        if (!isNativeXLM) return;

        const amountRaw = record.amount || record.starting_balance || "0";
        const amount = Number.parseFloat(amountRaw);
        if (!Number.isFinite(amount) || amount <= 0) return;

        onDonation({
          id: String(record.id),
          projectId: project.id,
          projectName: project.name,
          amountXLM: amount.toFixed(7),
          from: record.from || record.funder || record.source_account || "Unknown",
          createdAt: record.created_at || new Date().toISOString(),
          transactionHash: record.transaction_hash || "",
        });
      },
      onerror: (err: any) => {
        console.error("Global Horizon stream error:", err);
      },
    });

  return closeStream;
}

async function simulateCall(contract: Contract, method: string, args: any[] = []) {
  // We use a dummy account for simulation
  const dummyAccount = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "-1");
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
