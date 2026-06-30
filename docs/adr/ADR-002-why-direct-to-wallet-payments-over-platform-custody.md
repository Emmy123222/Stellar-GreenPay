# ADR-002: Why Direct-to-Wallet Payments Over Platform Custody

## Status

Accepted

## Context and Problem Statement

GreenPay connects donors with verified climate projects. The platform needed to decide whether donations should go directly from donor wallets to project wallets, or whether GreenPay should receive, hold, and later disburse funds as a custodial intermediary.

This decision affects donor trust, operational risk, regulatory exposure, incident impact, and the architecture of the Soroban contract.

## Decision Drivers

- Donors should know that their donation reaches the project wallet directly.
- GreenPay should minimize custody, private-key, and treasury-management risk.
- The platform should avoid becoming the critical path for fund disbursement.
- Donation transparency should be available through Stellar transactions and Soroban impact records.
- Project wallets should be visible and auditable.
- The product promise is zero platform fees for the core donation flow.

## Considered Options

- Direct-to-wallet payments
- Platform-custodied donations
- Hybrid custody with periodic project payouts

## Decision Outcome

Chosen option: Direct-to-wallet payments.

Donations are sent from the donor wallet directly to the verified project wallet. GreenPay records donation metadata in the backend and donation-derived impact state in Soroban, but does not custody the donated funds.

## Positive Consequences

- GreenPay does not hold donor funds for the donation flow.
- A compromised platform backend cannot directly drain donated funds.
- Donors and projects can verify payment destination and transaction history on Stellar.
- The Soroban contract can remain focused on recording and aggregating impact state instead of managing balances.
- Operational burden is lower because GreenPay does not need payout scheduling, treasury reconciliation, or custody controls for donations.

## Negative Consequences

- GreenPay cannot reverse, pause, or recover a donation after the donor signs and submits it.
- Project wallet accuracy becomes critical before a project is listed or registered on-chain.
- Refunds and disputes must happen outside the core platform flow.
- Some matching, escrow, or conditional-release features require separate flows rather than changing the core donation path.

## Pros and Cons of the Options

### Direct-to-wallet payments

- Good, because it minimizes trust placed in GreenPay as an intermediary.
- Good, because it aligns with public Stellar payment records.
- Good, because Soroban can record impact without holding balances.
- Bad, because incorrect project wallet configuration has immediate payment consequences.

### Platform-custodied donations

- Good, because GreenPay could batch payouts, support refunds, and enforce extra controls before disbursement.
- Good, because the product could expose simpler accounting from one platform treasury.
- Bad, because custody creates a high-value attack target.
- Bad, because it increases operational, legal, and compliance complexity.
- Bad, because it weakens the product promise that donations go straight to projects.

### Hybrid custody with periodic project payouts

- Good, because it could combine some payout controls with later project settlement.
- Good, because matching and campaign mechanics may be easier to coordinate centrally.
- Bad, because users still need to trust GreenPay to hold and release funds.
- Bad, because payout delays and treasury operations become core system responsibilities.

## More Information

- [Architecture overview](../architecture.md)
- [Donation flow in the frontend](../../frontend/components/DonateForm.tsx)
- [GreenPay Soroban contract](../../contracts/greenpay-contract/src/lib.rs)
