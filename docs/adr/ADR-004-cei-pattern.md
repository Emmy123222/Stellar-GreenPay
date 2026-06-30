# ADR-004: Checks-Effects-Interactions (CEI) Pattern in Donation Functions

## Status

Accepted

## Context

`donate()` and `donate_usdc()` accept a caller-supplied token address (`token` / `usdc_token`) and call `token::Client::transfer()` to move funds. If the token contract is malicious or a reentrancy-enabled wrapper, it can call back into the GreenPay contract during the transfer before any state has been written. Without CEI ordering, a reentrant call could:

- Over-credit a donor (multiple badge tier upgrades from one payment)
- Inflate `project.total_raised`, `donor_count`, or global counters
- Mint duplicate Impact NFTs

The Soroban security guidance (Stellar docs) emphasizes minimizing token contract surface and avoiding unnecessary external calls. Every cross-contract invocation transfers control to untrusted code.

## Decision

Apply the Checks-Effects-Interactions pattern in both `donate()` and `donate_usdc()`:

1. **Checks** — `require_auth`, amount validation, project active check, USDC token whitelist check
2. **Effects** — all state mutations: project totals, donor stats, badge computation, NFT mint, global counters
3. **Interactions** — `token.transfer()` as the last meaningful operation before the event emit

No state write occurs after the external transfer. The `donated` event is the only post-interaction step and reads only data already computed before the transfer.

## Consequences

- A reentrant call from a malicious token will find all state already committed, making any state-based reentrancy (badge tiers, duplicate counting) harmless.
- The contract minimizes its token interaction to exactly one `transfer` call — no unnecessary `balance_of`, `allowance`, or other token queries.
- The code is slightly longer because all effects are written out before the transfer, but the safety gain outweighs the readability cost.
- This pattern is enforced by CI tests that verify end-to-end state correctness after the CEI ordering.

## Soroban Security References

- [Soroban Token Interface docs](https://developers.stellar.org/docs/soroban/token-interface) — minimize cross-contract calls
- [GreenPay SECURITY.md](../../contracts/greenpay-contract/SECURITY.md) — finding H-01 documents the pre-fix violation and fix
- [contract-integration.md](../contract-integration.md) — CEI best practices for cross-contract callers
