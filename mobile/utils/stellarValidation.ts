/**
 * utils/stellarValidation.ts
 * Lightweight Stellar address validation for the mobile app.
 * Mirrors the regex used in the backend donations route.
 */

/** Returns true when `address` is a valid Stellar Ed25519 public key (G…). */
export function isValidStellarAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  return /^G[A-Z0-9]{55}$/.test(address);
}
