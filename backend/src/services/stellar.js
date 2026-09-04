/**
 * src/services/stellar.js
 * Backend Stellar/Soroban service.
 */
"use strict";

const { Horizon, Networks, rpc, Contract, TransactionBuilder, scValToNative, xdr, Address, StrKey, Account } = require("@stellar/stellar-sdk");

const NETWORK     = process.env.STELLAR_NETWORK || "testnet";
const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const RPC_URL     = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
const server = new Horizon.Server(HORIZON_URL);
const rpcServer = new rpc.Server(RPC_URL);
const CONTRACT_ID = process.env.CONTRACT_ID || "";

// Contract function invoked (with the project ID as its second argument) when
// a project is registered on-chain, and the topic symbol of the event the
// contract publishes with the registered project ID as its data payload.
const REGISTER_PROJECT_FUNCTION = "register_project";
const PROJ_REG_EVENT_TOPIC = "proj_reg";

async function getOnChainProject(projectId) {
  if (!CONTRACT_ID) return null;
  
  const contract = new Contract(CONTRACT_ID);
  const dummyAccount = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "-1");
  
  const tx = new TransactionBuilder(dummyAccount, { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call("get_project", projectId))
    .setTimeout(30)
    .build();

  let result;
  try {
    result = await rpcServer.simulateTransaction(tx);
  } catch {
    return null;
  }

  if (rpc.Api.isSimulationSuccess(result)) {
    return scValToNative(result.result.retval);
  }
  return null;
}

/**
 * Fetch donated events emitted by Soroban contract directly from Horizon/RPC event streaming API.
 * @param {string} projectId
 * @param {object} options
 * @returns {Promise<Array>}
 */
async function getProjectDonationEvents(projectId, { limit = 20, cursor } = {}) {
  if (!CONTRACT_ID) return [];

  const pageSize = Math.min(Number.parseInt(limit, 10) || 20, 100);
  const request = {
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
        topics: [
          [
            xdr.ScVal.scvSymbol("donated").toXDR("base64"),
            "*",
            xdr.ScVal.scvString(projectId).toXDR("base64"),
          ],
        ],
      },
    ],
    limit: pageSize,
  };
  if (cursor) {
    request.cursor = cursor;
  }

  let response;
  try {
    response = await rpcServer.getEvents(request);
  } catch (err) {
    return [];
  }

  if (!response || !response.events) return [];

  return response.events
    .filter((evt) => {
      try {
        if (!evt.topic || evt.topic.length < 3) return false;
        const topic0 =
          typeof evt.topic[0] === "string"
            ? scValToNative(xdr.ScVal.fromXDR(evt.topic[0], "base64"))
            : scValToNative(evt.topic[0]);
        if (topic0 !== "donated") return false;
        const topic2 =
          typeof evt.topic[2] === "string"
            ? scValToNative(xdr.ScVal.fromXDR(evt.topic[2], "base64"))
            : scValToNative(evt.topic[2]);
        return topic2 === projectId;
      } catch {
        return true;
      }
    })
    .map((evt) => {
      let donor = "";
      try {
        if (evt.topic && evt.topic[1]) {
          if (typeof evt.topic[1] === "string") {
            try {
              donor = scValToNative(xdr.ScVal.fromXDR(evt.topic[1], "base64"));
            } catch {
              donor = evt.topic[1];
            }
          } else {
            donor = scValToNative(evt.topic[1]);
          }
        }
      } catch {
        // ignore
      }

      let amount = "0";
      let badge = "None";
      let msgHash = null;

      try {
        if (evt.value) {
          const valSc =
            typeof evt.value === "string"
              ? xdr.ScVal.fromXDR(evt.value, "base64")
              : evt.value;
          const decoded = scValToNative(valSc);
          if (Array.isArray(decoded)) {
            if (decoded[0] !== undefined && decoded[0] !== null) {
              amount = decoded[0].toString();
            }
            if (decoded[1] !== undefined && decoded[1] !== null) {
              if (
                decoded[1] === "USDC" ||
                (Array.isArray(decoded[1]) && decoded[1][0] === "USDC")
              ) {
                badge = "None";
              } else {
                const rawBadge = decoded[1];
                badge = Array.isArray(rawBadge)
                  ? rawBadge[0] || "None"
                  : rawBadge.toString();
              }
            }
            if (
              decoded.length > 2 &&
              decoded[2] !== undefined &&
              decoded[2] !== null
            ) {
              msgHash =
                typeof decoded[2] === "bigint"
                  ? Number(decoded[2])
                  : Number(decoded[2]);
              if (Number.isNaN(msgHash)) msgHash = decoded[2].toString();
            }
          } else if (decoded && typeof decoded === "object") {
            if (decoded.amount !== undefined && decoded.amount !== null)
              amount = decoded.amount.toString();
            if (decoded.badge !== undefined && decoded.badge !== null)
              badge = decoded.badge.toString();
            if (decoded.msgHash !== undefined || decoded.msg_hash !== undefined) {
              msgHash = decoded.msgHash ?? decoded.msg_hash;
            }
          }
        }
      } catch {
        // ignore
      }

      return {
        donor: donor || "",
        amount,
        ledger: evt.ledger || 0,
        badge,
        msgHash,
        pagingToken: evt.pagingToken || null,
      };
    });
}

/**
 * Retrieve a project's on-chain representation from the Soroban contract.
 *
 * @param {string} projectId - The on-chain project identifier passed to the contract.
 * @returns {Promise<null|object>} Resolves to the native JS value returned by the contract, or `null` when
 * the contract is not configured or the call fails.
 * @throws {Error} When the RPC simulation fails with an unexpected error.
 */
// Exported below as `getOnChainProject`

/**
 * Extract the project ID that a successful Soroban registration transaction
 * registered on-chain, or `null` when the transaction is not a GreenPay
 * `register_project` invocation for `CONTRACT_ID`.
 *
 * Two independent on-chain facts are verified:
 *
 *   1. The transaction envelope invokes `register_project` on `CONTRACT_ID`
 *      and passes the project ID as its second argument.
 *   2. The transaction result meta carries the contract's `proj_reg` event,
 *      whose data payload is the registered project ID (the Soroban
 *      operation's result / return value area for a `register_project` call).
 *
 * When both are present they must agree. This lets the admin confirm endpoint
 * prove that a given transaction hash actually registered the project being
 * confirmed, instead of trusting the `projectId` supplied in the request body.
 *
 * @param {object} tx - Horizon transaction record for a successful transaction.
 * @returns {string|null} The project ID registered on-chain, or `null`.
 */
function getRegisteredProjectIdFromTransaction(tx) {
  if (!tx || !CONTRACT_ID) return null;

  const fromEnvelope = getProjectIdFromEnvelope(tx);
  const fromEvent = getProjectIdFromProjRegEvent(tx);

  // Both sources must agree when both are present; a mismatch means the
  // transaction cannot be trusted as a registration for a single project.
  if (fromEnvelope && fromEvent && fromEnvelope !== fromEvent) return null;

  return fromEnvelope || fromEvent || null;
}

/**
 * Read the project ID passed as the `register_project` argument in the
 * transaction envelope. The envelope is committed to by the transaction hash,
 * so this cannot be forged by a caller.
 *
 * @param {object} tx - Horizon transaction record.
 * @returns {string|null} The project ID, or `null` when no matching operation.
 */
function getProjectIdFromEnvelope(tx) {
  if (typeof tx.envelope_xdr !== "string") return null;

  let envelope;
  try {
    envelope = xdr.TransactionEnvelope.fromXDR(tx.envelope_xdr, "base64");
  } catch {
    return null;
  }

  let innerTx;
  if (envelope.switch() === xdr.EnvelopeType.envelopeTypeTx()) {
    innerTx = envelope.v1().tx();
  } else if (envelope.switch() === xdr.EnvelopeType.envelopeTypeTxV0()) {
    innerTx = envelope.v0().tx();
  } else {
    // Fee-bump envelopes never carry our registration call.
    return null;
  }

  for (const operation of innerTx.operations()) {
    const body = operation.body();
    if (body.switch() !== xdr.OperationType.invokeHostFunction()) continue;

    const hostFunction = body.invokeHostFunctionOp().hostFunction();
    if (hostFunction.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
      continue;
    }

    const invokeArgs = hostFunction.invokeContract();

    let contractId;
    try {
      contractId = Address.fromScAddress(invokeArgs.contractAddress()).toString();
    } catch {
      continue;
    }
    if (contractId !== CONTRACT_ID) continue;

    if (invokeArgs.functionName().toString() !== REGISTER_PROJECT_FUNCTION) continue;

    // register_project(admin, project_id, name, wallet, co2_per_xlm, ...)
    const args = invokeArgs.args();
    if (args.length < 2) continue;

    let projectId;
    try {
      projectId = scValToNative(args[1]);
    } catch {
      continue;
    }
    if (typeof projectId === "string" && projectId.length > 0) return projectId;
  }

  return null;
}

/**
 * Read the project ID published by the contract's `proj_reg` event in the
 * transaction result meta (the Soroban operation result data for a
 * `register_project` call).
 *
 * @param {object} tx - Horizon transaction record.
 * @returns {string|null} The project ID, or `null` when no matching event.
 */
function getProjectIdFromProjRegEvent(tx) {
  const metaXdr = tx.result_meta_xdr || tx.meta_xdr;
  if (typeof metaXdr !== "string") return null;

  let meta;
  try {
    meta = xdr.TransactionMeta.fromXDR(metaXdr, "base64");
  } catch {
    return null;
  }
  if (meta.switch() !== 3) return null; // TransactionMetaV3

  const sorobanMeta = meta.v3().sorobanMeta();
  if (!sorobanMeta) return null; // classic (non-Soroban) transaction

  for (const event of sorobanMeta.events()) {
    if (event.type() !== xdr.ContractEventType.contract()) continue;
    if (!event.contractId()) continue;

    // Only accept events emitted by our contract.
    let eventContractId;
    try {
      eventContractId = StrKey.encodeContract(event.contractId());
    } catch {
      continue;
    }
    if (eventContractId !== CONTRACT_ID) continue;

    const body = event.body();
    if (body.switch() !== 0) continue; // ContractEventV0

    const topics = body.v0().topics();
    if (topics.length === 0) continue;

    let topic0;
    try {
      topic0 = scValToNative(topics[0]);
    } catch {
      continue;
    }
    if (topic0 !== PROJ_REG_EVENT_TOPIC) continue;

    let projectId;
    try {
      projectId = scValToNative(body.v0().data());
    } catch {
      continue;
    }
    if (typeof projectId === "string" && projectId.length > 0) return projectId;
  }

  return null;
}

module.exports = {
  server,
  rpcServer,
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  getOnChainProject,
  getProjectDonationEvents,
  getRegisteredProjectIdFromTransaction
};
