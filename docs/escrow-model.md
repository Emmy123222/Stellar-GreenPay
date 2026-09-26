# Escrow Evidence Anchoring Model

This document specifies the cryptographic evidence anchoring model for the Stellar GreenPay Escrow Contract.

---

## 🎯 Background & Motivation

In traditional decentralized escrow models, funds can often be released unilaterally by an admin or client without anchoring verifiable proof that the agreed project milestones or environmental deliverables were actually completed. This creates a single point of failure and centralizes trust in contract administrators.

To guarantee verifiable accountability on the Stellar blockchain, the GreenPay Escrow Contract implements **Evidence Anchoring**:
Every fund release invocation requires the caller to provide a cryptographic SHA-256 digest of the project completion report or audit evidence (`project_report_hash`).

---

## 🔐 Evidence Anchoring Mechanism

```
   Project Deliverable / Report
                 │
                 ▼
         SHA-256 Hashing
                 │
                 ▼
     project_report_hash (BytesN<32>)
                 │
                 ▼
    EscrowContract::release_funds()
                 │
                 ├─► Transfers escrowed tokens to Freelancer / Recipient
                 │
                 └─► Emits On-Chain Event:
                     FundsReleased {
                         project_id,
                         report_hash,
                         amount
                     }
```

### 1. Cryptographic Report Hash (`project_report_hash`)
- **Type**: `BytesN<32>` (32-byte array representing SHA-256 hash).
- **Format**: Pre-image is the canonical byte stream of the verified project completion report (e.g., photo evidence, satellite validation, or audit certification stored on IPFS or distributed storage).
- **Immutability**: Once recorded on-chain in the `FundsReleased` event, anyone can independently verify that the off-chain report matches the anchored hash.

### 2. Event Emission (`FundsReleased`)
When `release_funds` is successfully executed, the contract emits a topic-indexed event:

```rust
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FundsReleased {
    pub project_id: String,
    pub report_hash: BytesN<32>,
    pub amount: i128,
}
```

- **Topic**: `(symbol_short!("funds_rel"), job_id)`
- **Payload**: `FundsReleased` struct containing `project_id`, `report_hash`, and released `amount`.

---

## ⚙️ Contract Method Specification

```rust
pub fn release_funds(
    env: Env,
    caller: Address,
    job_id: String,
    project_report_hash: BytesN<32>,
) -> i128
```

### Parameters
- `caller`: Address of the admin or client executing the release. Must authenticate via `caller.require_auth()`.
- `job_id`: Unique identifier of the escrow job.
- `project_report_hash`: 32-byte SHA-256 hash of the milestone completion or final report.

### Invariants Enforced
1. **Authorization**: Caller must be either the designated contract admin or the job's client.
2. **Dispute Guard**: If `job.disputed == true`, release is blocked until disputes are formally resolved.
3. **Milestone Accounting**: Releases all unreleased milestones, marks milestones as released, and transitions job status to `JobStatus::Completed`.
4. **Non-Zero Balance**: Rejects release if no unreleased funds remain.
5. **Atomic Transfer**: Transfers the exact sum of unreleased tokens from contract storage to the freelancer address.
6. **Audit Trail**: Publishes the `FundsReleased` event anchoring the hash.

---

## 🔍 Verification by Donors & Auditors

Donors and external auditors can verify any fund release on Stellar Horizon or Soroban RPC:
1. Fetch the transaction events matching topic `funds_rel`.
2. Extract `report_hash` and `amount`.
3. Download the evidence report from IPFS or public storage.
4. Compute `SHA-256(report_data)` and confirm it matches `report_hash` byte-for-byte.
