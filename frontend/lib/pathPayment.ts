/**
 * lib/pathPayment.ts — pure helpers for DEX path-payment donations (#1660).
 *
 * Amounts are 7-decimal strings, as Stellar uses; all math is done in stroops
 * (bigint) so a slippage bound is never off by a rounding error.
 */

export interface AssetRef {
  code: string;
  /** null/undefined = native XLM */
  issuer?: string | null;
}

export const DEFAULT_SLIPPAGE_BPS = 100; // 1%
export const MIN_SLIPPAGE_BPS = 10; // 0.1%
export const MAX_SLIPPAGE_BPS = 500; // 5%
export const SLIPPAGE_OPTIONS_BPS = [50, 100, 200] as const;

const STROOPS = BigInt(10_000_000);
const BPS = BigInt(10_000);

export function isNative(asset: AssetRef | null | undefined): boolean {
  return !asset || !asset.issuer;
}

export function assetKey(asset: AssetRef | null | undefined): string {
  return isNative(asset) ? "XLM" : `${asset!.code}:${asset!.issuer}`;
}

export function sameAsset(a: AssetRef | null | undefined, b: AssetRef | null | undefined): boolean {
  return assetKey(a) === assetKey(b);
}

export function toStroops(amount: string): bigint {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: ${amount}`);
  const [whole, frac = ""] = s.split(".");
  // Truncate past 7 dp (Stellar's precision) rather than round up.
  return BigInt(whole) * STROOPS + BigInt(frac.slice(0, 7).padEnd(7, "0"));
}

export function fromStroops(stroops: bigint): string {
  const whole = stroops / STROOPS;
  const frac = (stroops % STROOPS).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

/** Clamp a user-chosen slippage into the allowed band. */
export function clampSlippageBps(bps: number): number {
  if (!Number.isFinite(bps)) return DEFAULT_SLIPPAGE_BPS;
  return Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.round(bps)));
}

/**
 * Lowest destination amount acceptable for a strict-send quote: the quote
 * minus slippage, rounded DOWN to the stroop. This becomes `destMin` in the
 * signed operation, so the network itself refuses a worse fill.
 */
export function minReceived(quotedDestAmount: string, slippageBps: number): string {
  const bps = BigInt(clampSlippageBps(slippageBps));
  const quoted = toStroops(quotedDestAmount);
  return fromStroops((quoted * (BPS - bps)) / BPS);
}

/**
 * Highest source amount acceptable for a strict-receive quote: the quote plus
 * slippage, rounded UP to the stroop. This becomes `sendMax`.
 */
export function maxSent(quotedSourceAmount: string, slippageBps: number): string {
  const bps = BigInt(clampSlippageBps(slippageBps));
  const quoted = toStroops(quotedSourceAmount);
  const scaled = quoted * (BPS + bps);
  return fromStroops(scaled / BPS + (scaled % BPS === BigInt(0) ? BigInt(0) : BigInt(1)));
}

/**
 * True when a fresh quote would still satisfy the bound the donor approved —
 * used to re-check right before signing so a stale preview can't be signed.
 */
export function quoteWithinBound(freshDestAmount: string, approvedDestMin: string): boolean {
  return toStroops(freshDestAmount) >= toStroops(approvedDestMin);
}

export interface PathRecord {
  source_amount: string;
  destination_amount: string;
  path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>;
}

/** Pick the path that delivers the most for a strict-send query. */
export function bestStrictSendPath<T extends PathRecord>(records: T[]): T | null {
  let best: T | null = null;
  for (const r of records) {
    if (!best || toStroops(r.destination_amount) > toStroops(best.destination_amount)) best = r;
  }
  return best;
}

/** Effective rate, destination units per source unit, for display. */
export function effectiveRate(sourceAmount: string, destAmount: string): number {
  const src = Number(sourceAmount);
  return src > 0 ? Number(destAmount) / src : 0;
}
