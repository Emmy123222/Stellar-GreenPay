#!/usr/bin/env node
/**
 * Minimal Horizon stub for the load test.
 *
 * `POST /api/donations` verifies the transaction hash against Horizon before it
 * writes anything (`server.getTransaction()` in `src/services/stellar.js`), so a
 * load test built on synthetic payloads measures the rejection path and nothing
 * else — no row is written, no socket event is broadcast, and the DB contention the
 * issue asks about never happens.
 *
 * Pointing `HORIZON_URL` at this process in CI makes every well-formed hash a
 * confirmed transaction, which lets the nightly run exercise the real write path
 * against an ephemeral database. Production is untouched: this is only ever started
 * by `.github/workflows/load-test.yml`.
 *
 * It answers the one endpoint the donation path calls and 404s everything else, so a
 * test that starts depending on other Horizon calls fails loudly instead of being
 * quietly satisfied by this process.
 */
"use strict";

const http = require("node:http");

const PORT = Number(process.env.STUB_HORIZON_PORT || 8081);

function transactionRecord(hash) {
  return {
    id: hash,
    hash,
    paging_token: "1",
    successful: true,
    ledger: 1,
    created_at: new Date(0).toISOString(),
    source_account: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3A73ZFMZE",
    fee_charged: "100",
    max_fee: "100",
    operation_count: 1,
    memo_type: "none",
    memo: null,
    signatures: [],
    // The donation path only reads `successful`, but these are the fields a caller
    // reading a Horizon record would expect to exist.
    envelope_xdr: "",
    result_xdr: "",
    result_meta_xdr: "",
    fee_meta_xdr: "",
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // GET /transactions/<64 hex> — Horizon.Server#getTransaction
  const match = url.pathname.match(/^\/transactions\/([0-9a-fA-F]{64})$/);
  if (req.method === "GET" && match) {
    res.writeHead(200, { "content-type": "application/hal+json" });
    res.end(JSON.stringify(transactionRecord(match[1])));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: 404, title: "Resource Missing" }));
});

server.listen(PORT, () => {
  process.stdout.write(`stub horizon listening on http://127.0.0.1:${PORT}\n`);
});
