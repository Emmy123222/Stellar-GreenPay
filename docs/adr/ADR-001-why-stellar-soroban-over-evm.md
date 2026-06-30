# ADR-001: Why Stellar/Soroban Over EVM

## Status

Accepted

## Context and Problem Statement

Stellar GreenPay needs a blockchain layer for transparent climate donations. Donors should be able to send small XLM-denominated donations directly to verified project wallets, while the platform records donation totals, donor impact, badges, and CO2 offset metrics in a way that can be audited outside the backend.

The project needed to choose whether to build this on Stellar/Soroban, an EVM chain, or an off-chain-only backend.

## Decision Drivers

- Donations should remain practical for small amounts, so transaction fees must be low and predictable.
- The payment path should be simple: donor wallet to project wallet, with minimal platform involvement.
- On-chain impact records should be auditable without making the backend the source of truth.
- The contract layer should integrate with the existing Stellar payment flow and Freighter wallet UX.
- The platform should avoid forcing donors through cross-chain bridging or chain-specific gas-token complexity for the core flow.
- The implementation should support future features such as donation badges, verified project registration, matching, and governance.

## Considered Options

- Stellar payments plus Soroban contracts
- EVM smart contracts
- Off-chain-only backend records

## Decision Outcome

Chosen option: Stellar payments plus Soroban contracts.

Stellar is a better fit for GreenPay's payment-first donation model because donations can be sent directly to project wallets while Soroban records project, donor, and impact state on-chain. This keeps funds out of platform custody, keeps small donations viable, and makes donation-derived impact data independently verifiable.

## Positive Consequences

- Direct Stellar payments remain the core donation path.
- Soroban can track donation totals, donor stats, badges, and project verification without holding funds.
- Freighter provides a clear browser-wallet integration for signing Stellar transactions.
- Lower and more predictable fees make small climate donations more practical.
- The backend can focus on metadata, feeds, and aggregation instead of being the authority for donation truth.

## Negative Consequences

- Soroban has a smaller ecosystem than EVM and fewer reusable contract libraries.
- Some donors may already be more familiar with EVM wallets than Stellar wallets.
- Cross-chain donors may need a bridge or separate Stellar funding flow before donating.
- Tooling and operational knowledge must stay aligned with Soroban-specific SDKs, Horizon, and RPC services.

## Pros and Cons of the Options

### Stellar payments plus Soroban contracts

- Good, because it matches GreenPay's direct-to-project payment model.
- Good, because Soroban records impact data without requiring custodial donation contracts.
- Good, because Freighter and Horizon support a straightforward browser payment flow.
- Bad, because ecosystem maturity and wallet familiarity are narrower than EVM.

### EVM smart contracts

- Good, because EVM has mature tooling, many wallets, and a large developer ecosystem.
- Good, because Solidity contract patterns are well documented.
- Bad, because gas costs and L2 fragmentation add friction for small recurring donations.
- Bad, because an EVM-first flow would not naturally match GreenPay's existing Stellar wallet, Horizon, and Soroban code paths.

### Off-chain-only backend records

- Good, because it would be simpler to build and operate initially.
- Good, because it would avoid smart contract deployment and upgrade concerns.
- Bad, because donors would need to trust backend records for impact totals.
- Bad, because fake or disputed donation records would be harder for the public to audit independently.

## More Information

- [Architecture overview](../architecture.md)
- [GreenPay Soroban contract README](../../contracts/greenpay-contract/README.md)
- [GreenPay Soroban contract security notes](../../contracts/greenpay-contract/SECURITY.md)
