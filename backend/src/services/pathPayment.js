/**
 * src/services/pathPayment.js — delivered-amount verification for DEX
 * path-payment donations (#1660).
 *
 * A path payment's *sent* amount and asset say nothing about what the project
 * received: the DEX converts in between, and strict-send only guarantees the
 * destination gets at least `destMin`. So the donation ledger must record what
 * Horizon reports was actually credited to the project wallet, never what the
 * client claims it sent.
 *
 * Everything here is pure (Horizon operation records in, plain objects out);
 * src/services/stellar.js does the fetching.
 */
"use strict";

const STROOPS_PER_UNIT = 10_000_000n;
const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const ACCOUNT_RE = /^G[A-Z2-7]{55}$/;

const PAYMENT_OP_TYPES = new Set([
  "payment",
  "path_payment_strict_send",
  "path_payment_strict_receive",
]);

class DeliveryVerificationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "DeliveryVerificationError";
    this.code = code;
    this.status = 400;
  }
}

/** "1.2345678" → 12345678n. Throws on anything that isn't a 7-dp decimal. */
function toStroops(amount) {
  const s = String(amount).trim();
  if (!/^\d+(\.\d{1,7})?$/.test(s)) {
    throw new DeliveryVerificationError(`Invalid amount: ${amount}`, "invalid_amount");
  }
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(frac.padEnd(7, "0"));
}

/** 12345678n → "1.2345678" */
function fromStroops(stroops) {
  const whole = stroops / STROOPS_PER_UNIT;
  const frac = (stroops % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

/**
 * Normalise an asset to { code, issuer } where native XLM is
 * { code: "XLM", issuer: null }.
 */
function normaliseAsset(asset) {
  if (!asset || asset.type === "native" || !asset.code || (asset.code === "XLM" && !asset.issuer)) {
    return { code: "XLM", issuer: null };
  }
  return { code: asset.code, issuer: asset.issuer || null };
}

/** "XLM" or "CODE:ISSUER" — the string stored in donations.currency/source_asset. */
function assetId(asset) {
  const a = normaliseAsset(asset);
  return a.issuer ? `${a.code}:${a.issuer}` : "XLM";
}

function sameAsset(a, b) {
  return assetId(a) === assetId(b);
}

/** Horizon record fields → asset. prefix is "" (destination) or "source_". */
function recordAsset(record, prefix = "") {
  if (record[`${prefix}asset_type`] === "native") return { code: "XLM", issuer: null };
  return {
    code: record[`${prefix}asset_code`],
    issuer: record[`${prefix}asset_issuer`],
  };
}

/**
 * Validate a project's preferred asset. `null` (or a missing code) means
 * native XLM. Returns the normalised value or throws.
 */
function validatePreferredAsset(input) {
  if (input === null || input === undefined || input.code === null || input.code === undefined) {
    return null;
  }
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const issuer = typeof input.issuer === "string" ? input.issuer.trim() : "";
  if (code.toUpperCase() === "XLM" && !issuer) return null;
  if (!ASSET_CODE_RE.test(code)) {
    throw new DeliveryVerificationError("preferredAsset.code must be 1-12 alphanumeric characters", "invalid_asset");
  }
  if (!ACCOUNT_RE.test(issuer)) {
    throw new DeliveryVerificationError("preferredAsset.issuer must be a Stellar public key", "invalid_asset");
  }
  return { code, issuer };
}

/**
 * Work out what a transaction delivered to `destination` from `source`.
 *
 * Horizon's operation record for a path payment carries the destination asset
 * in asset_* and, for strict-send, the amount actually credited in `amount`
 * (filled from the transaction result, not the requested destMin). Plain
 * payments deliver exactly `amount`. All matching operations are summed in
 * stroops; a transaction delivering two different assets to the project is
 * rejected as ambiguous.
 *
 * @param {Array<object>} records Horizon operation records for one transaction
 * @param {{destination: string, source: string}} parties
 * @returns {{
 *   asset: {code: string, issuer: string|null}, amount: string,
 *   sourceAsset: {code: string, issuer: string|null}|null, sourceAmount: string|null,
 *   isPathPayment: boolean, destinationMin: string|null
 * } | null} null when nothing was paid to the destination
 */
function extractDelivery(records, { destination, source }) {
  const matching = (records || []).filter((r) =>
    r
    && PAYMENT_OP_TYPES.has(r.type)
    && r.transaction_successful !== false
    && r.to === destination
    && (r.from || r.source_account) === source,
  );
  if (matching.length === 0) return null;

  const asset = recordAsset(matching[0]);
  let delivered = 0n;
  let sourceAsset = null;
  let sent = 0n;
  let destinationMin = null;
  let isPathPayment = false;

  for (const r of matching) {
    if (!sameAsset(recordAsset(r), asset)) {
      throw new DeliveryVerificationError(
        "Transaction delivers more than one asset to the project",
        "ambiguous_delivery",
      );
    }
    delivered += toStroops(r.amount);

    if (r.type === "payment") {
      const a = recordAsset(r);
      if (sourceAsset && !sameAsset(sourceAsset, a)) {
        throw new DeliveryVerificationError("Transaction spends more than one asset", "ambiguous_delivery");
      }
      sourceAsset = a;
      sent += toStroops(r.amount);
    } else {
      isPathPayment = true;
      const a = recordAsset(r, "source_");
      if (sourceAsset && !sameAsset(sourceAsset, a)) {
        throw new DeliveryVerificationError("Transaction spends more than one asset", "ambiguous_delivery");
      }
      sourceAsset = a;
      sent += toStroops(r.source_amount);
      if (r.type === "path_payment_strict_send" && r.destination_min != null) {
        const min = toStroops(r.destination_min);
        // The network guarantees this; seeing otherwise means the record is
        // not a real successful strict-send result.
        if (toStroops(r.amount) < min) {
          throw new DeliveryVerificationError("Delivered amount is below the signed minimum", "slippage_exceeded");
        }
        destinationMin = fromStroops((destinationMin ? toStroops(destinationMin) : 0n) + min);
      }
    }
  }

  return {
    asset: normaliseAsset(asset),
    amount: fromStroops(delivered),
    sourceAsset: sourceAsset ? normaliseAsset(sourceAsset) : null,
    sourceAmount: sourceAsset ? fromStroops(sent) : null,
    isPathPayment,
    destinationMin,
  };
}

/**
 * Throw unless the delivery exists and is in the project's preferred asset
 * (native XLM when the project has none).
 */
function assertDeliveryMatchesProject(delivery, preferredAsset) {
  if (!delivery) {
    throw new DeliveryVerificationError(
      "Transaction does not pay the project wallet from the donor account",
      "no_delivery",
    );
  }
  const expected = normaliseAsset(preferredAsset || null);
  if (!sameAsset(delivery.asset, expected)) {
    throw new DeliveryVerificationError(
      `Project expects ${assetId(expected)} but the transaction delivered ${assetId(delivery.asset)}`,
      "asset_mismatch",
    );
  }
  if (toStroops(delivery.amount) <= 0n) {
    throw new DeliveryVerificationError("Delivered amount must be positive", "invalid_amount");
  }
  return delivery;
}

module.exports = {
  DeliveryVerificationError,
  toStroops,
  fromStroops,
  normaliseAsset,
  assetId,
  sameAsset,
  validatePreferredAsset,
  extractDelivery,
  assertDeliveryMatchesProject,
};
