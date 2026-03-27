/**
 * src/services/stellar.js
 * Backend Stellar/Soroban service.
 */
"use strict";

const { Horizon, Networks, rpc, Contract, TransactionBuilder, scValToNative } = require("@stellar/stellar-sdk");

const NETWORK     = process.env.STELLAR_NETWORK || "testnet";
const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const RPC_URL     = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
const server = new Horizon.Server(HORIZON_URL);
const rpcServer = new rpc.Server(RPC_URL);
const CONTRACT_ID = process.env.CONTRACT_ID || "";

async function getOnChainProject(projectId) {
  if (!CONTRACT_ID) throw new Error("CONTRACT_ID not configured");
  
  const contract = new Contract(CONTRACT_ID);
  const dummyAccount = new Horizon.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "-1");
  
  const tx = new TransactionBuilder(dummyAccount, { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call("get_project", projectId))
    .setTimeout(30)
    .build();

  const result = await rpcServer.simulateTransaction(tx);

  if (rpc.Api.isSimulationSuccess(result)) {
    return scValToNative(result.result.retval);
  }
  return null;
}

module.exports = {
  server,
  rpcServer,
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  getOnChainProject
};
