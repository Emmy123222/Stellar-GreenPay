"use strict";

/**
 * Tests for the Soroban transaction parsing helper
 * `getRegisteredProjectIdFromTransaction` in src/services/stellar.js.
 *
 * The XDR fixtures are built with the real stellar SDK so they exercise the
 * parser against byte-for-byte realistic transaction envelopes and result
 * metas (the same shapes Horizon returns for a successful `register_project`
 * transaction).
 */

const sdk = require("@stellar/stellar-sdk");

// The contract ID is read from the environment at module load time, so it must
// be set before requiring the service under test.
process.env.CONTRACT_ID = sdk.StrKey.encodeContract(Buffer.alloc(32, 7));
process.env.STELLAR_NETWORK = "testnet";

const {
  getRegisteredProjectIdFromTransaction,
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
} = require("./stellar");

const ADMIN = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const WALLET = "GBQQMBRVDJIBWVJYEYYOEL33BKBL24HRUNMQ6UM2TBEAHXI6E4NILEJL";
const OTHER_CONTRACT = sdk.StrKey.encodeContract(Buffer.alloc(32, 9));

/**
 * Build the base64 transaction-envelope XDR for a `register_project` call on
 * the given contract, with the project ID passed as the second argument
 * (mirroring the contract's register_project(admin, project_id, ...) ABI).
 *
 * Args are converted to explicit SCVals, which is what a correctly-built
 * registration transaction looks like on-chain.
 */
function buildRegisterEnvelope({
  projectId,
  contractId = CONTRACT_ID,
  functionName = "register_project",
}) {
  const contract = new sdk.Contract(contractId);
  const sourceAccount = new sdk.Account(ADMIN, "1");

  const tx = new sdk.TransactionBuilder(sourceAccount, {
    fee: "1000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        functionName,
        sdk.Address.fromString(ADMIN).toScVal(),
        sdk.nativeToScVal(projectId, { type: "string" }),
        sdk.nativeToScVal("Test Project", { type: "string" }),
        sdk.Address.fromString(WALLET).toScVal(),
        sdk.nativeToScVal(100, { type: "u32" }),
      ),
    )
    .setTimeout(30)
    .build();

  return tx.toEnvelope().toXDR("base64");
}

/**
 * Build the base64 TransactionMetaV3 XDR carrying the contract's `proj_reg`
 * event (topics: [symbol "proj_reg", admin address], data: project id).
 */
function buildProjRegMeta({
  projectId,
  contractId = CONTRACT_ID,
  topic = "proj_reg",
}) {
  const event = new sdk.xdr.ContractEvent({
    ext: new sdk.xdr.ExtensionPoint(0),
    contractId: sdk.StrKey.decodeContract(contractId),
    type: sdk.xdr.ContractEventType.contract(),
    body: new sdk.xdr.ContractEventBody(
      0,
      new sdk.xdr.ContractEventV0({
        topics: [sdk.xdr.ScVal.scvSymbol(topic), sdk.Address.fromString(ADMIN).toScVal()],
        data: sdk.xdr.ScVal.scvString(projectId),
      }),
    ),
  });

  const meta = new sdk.xdr.TransactionMeta(
    3,
    new sdk.xdr.TransactionMetaV3({
      ext: new sdk.xdr.ExtensionPoint(0),
      txChangesBefore: [],
      operations: [],
      txChangesAfter: [],
      sorobanMeta: new sdk.xdr.SorobanTransactionMeta({
        ext: new sdk.xdr.SorobanTransactionMetaExt(0),
        events: [event],
        returnValue: sdk.xdr.ScVal.scvVoid(),
        diagnosticEvents: [],
      }),
    }),
  );

  return meta.toXDR("base64");
}

describe("getRegisteredProjectIdFromTransaction", () => {
  test("returns the project ID for a valid register_project transaction", () => {
    const tx = {
      successful: true,
      envelope_xdr: buildRegisterEnvelope({ projectId: "proj-1" }),
      result_meta_xdr: buildProjRegMeta({ projectId: "proj-1" }),
    };
    expect(getRegisteredProjectIdFromTransaction(tx)).toBe("proj-1");
  });

  test("returns the project ID from the envelope when result meta is absent", () => {
    const tx = {
      successful: true,
      envelope_xdr: buildRegisterEnvelope({ projectId: "proj-1" }),
    };
    expect(getRegisteredProjectIdFromTransaction(tx)).toBe("proj-1");
  });

  test("returns the project ID from the proj_reg event when the envelope cannot be parsed", () => {
    const tx = {
      successful: true,
      envelope_xdr: "not-valid-envelope-xdr",
      result_meta_xdr: buildProjRegMeta({ projectId: "proj-1" }),
    };
    expect(getRegisteredProjectIdFromTransaction(tx)).toBe("proj-1");
  });

  test("returns null when the envelope and the event disagree", () => {
    const tx = {
      successful: true,
      envelope_xdr: buildRegisterEnvelope({ projectId: "proj-1" }),
      result_meta_xdr: buildProjRegMeta({ projectId: "proj-2" }),
    };
    expect(getRegisteredProjectIdFromTransaction(tx)).toBeNull();
  });

  test("returns null when the invoked function is not register_project", () => {
    const tx = {
      successful: true,
      envelope_xdr: buildRegisterEnvelope({
        projectId: "proj-1",
        functionName: "donate",
      }),
    };
    expect(getRegisteredProjectIdFromTransaction(tx)).toBeNull();
  });

  test("returns null when the invoked contract is not CONTRACT_ID", () => {
    const tx = {
      successful: true,
      envelope_xdr: buildRegisterEnvelope({
        projectId: "proj-1",
        contractId: OTHER_CONTRACT,
      }),
    };
    expect(getRegisteredProjectIdFromTransaction(tx)).toBeNull();
  });

  test("ignores proj_reg events emitted by a different contract", () => {
    const tx = {
      successful: true,
      envelope_xdr: buildRegisterEnvelope({ projectId: "proj-1" }),
      result_meta_xdr: buildProjRegMeta({
        projectId: "proj-1",
        contractId: OTHER_CONTRACT,
      }),
    };
    // The envelope is authoritative here; the foreign event is ignored.
    expect(getRegisteredProjectIdFromTransaction(tx)).toBe("proj-1");
  });

  test("returns null for classic (non-Soroban) transaction meta", () => {
    const tx = {
      successful: true,
      envelope_xdr: buildRegisterEnvelope({ projectId: "proj-1" }),
      result_meta_xdr: new sdk.xdr.TransactionMeta(
        3,
        new sdk.xdr.TransactionMetaV3({
          ext: new sdk.xdr.ExtensionPoint(0),
          txChangesBefore: [],
          operations: [],
          txChangesAfter: [],
          sorobanMeta: null,
        }),
      ).toXDR("base64"),
    };
    expect(getRegisteredProjectIdFromTransaction(tx)).toBe("proj-1");
  });

  test("returns null when no XDR is present or the transaction is missing", () => {
    expect(getRegisteredProjectIdFromTransaction({ successful: true })).toBeNull();
    expect(getRegisteredProjectIdFromTransaction(null)).toBeNull();
  });
});
