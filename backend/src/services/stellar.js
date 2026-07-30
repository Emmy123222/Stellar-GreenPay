/**
 * src/services/stellar.js
 * Backend Stellar/Soroban service.
 */
"use strict";

const { Horizon, Networks, rpc, Contract, TransactionBuilder, scValToNative, xdr } = require("@stellar/stellar-sdk");

const NETWORK     = process.env.STELLAR_NETWORK || "testnet";
const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const RPC_URL     = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
const server = new Horizon.Server(HORIZON_URL);
const rpcServer = new rpc.Server(RPC_URL);
const CONTRACT_ID = process.env.CONTRACT_ID || "";

async function getOnChainProject(projectId) {
  if (!CONTRACT_ID) return null;
  
  const contract = new Contract(CONTRACT_ID);
  const dummyAccount = new Horizon.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "-1");
  
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

module.exports = {
  server,
  rpcServer,
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  getOnChainProject,
  getProjectDonationEvents
};
