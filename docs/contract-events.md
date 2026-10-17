# Contract Events (Canonical Reference)

This is the **canonical** event reference for the Stellar GreenPay Soroban
contracts. It replaces the former `contracts/EVENTS.md` (issue #1605), which
now contains only a pointer to this file.

Every event below was verified against the `env.events().publish(...)` calls in
`contracts/greenpay-contract/src/lib.rs` and `contracts/escrow-contract/src/lib.rs`.
Consumers (`docs/indexer.md`, `backend/src/services/indexerService.js`, the
frontend) should treat this document — and the source it is verified against —
as the source of truth. When an event is added or changed in a contract, update
this file in the same PR.

Event shape reminder (Soroban): each event has `topics` (a Vec of small values,
typically `(event_symbol, address...)`) and one `data` value. Indexers normally
filter on the contract ID plus the first topic (the event symbol).

---

## GreenPay contract (`contracts/greenpay-contract`)

### Donations and impact

| Event | Topics | Data | Emitted by / when |
|-------|--------|------|-------------------|
| `donated` | `["donated", donor: Address, project_id: String]` | `(amount: i128, badge: String, msg_hash: u32)` | `donate()` after a successful XLM donation. For USDC donations (`donate_usdc()`) the same symbol is reused and the data is `(usdc_amount: i128, "USDC": Symbol, msg_hash: u32)`. `msg_hash` is the on-chain pointer to the donor's off-chain message digest. |
| `donate` | `["donate"]` | `DonateEvent` struct (see below) | `donate()`, emitted alongside the legacy `donated` event with the typed payload. |
| `batch_donated` | `["batch_donated", donor: Address]` | `(total_amount: i128, count: u32)` | `batch_donate()` after all donations in the batch are applied. |
| `matched` | `["matched", matcher: Address, project_id: String]` | `(matched_amount: i128, donor: Address)` | `donate()` when a donation is matched by an active 2x match pledge and the matcher's funds are transferred. |
| `donation_refunded` | `["donation_refunded", donor: Address, project_id: String]` | `(amount: i128, project_wallet: Address)` | `refund_donation()` when a donation is refunded to the donor. |
| `MilestoneReached` | `["MilestoneReached", project_id: String, milestone_pct: u32]` | `total_raised: i128` | Internal `emit_funding_milestones` helper during donations, once per funding milestone (25/50/75/100 % of the project goal) that is newly crossed. |
| `nft_mint` | `["nft_mint", donor: Address]` | `tier: String` (badge tier symbol) | `donate()`, `batch_donate()` and `mint_impact_nft()` when a donor mints an impact NFT for a new badge tier. |
| `BadgeUpgraded` | `["BadgeUpgraded", donor: Address]` | `badge: String` | `donate()` / `batch_donate()` when the donor's badge tier increases. |
| `pnft_mnt` | `["pnft_mnt", donor: Address]` | `(project_id: String, amount_donated: i128)` | `mint_project_nft()` when a per-project milestone NFT is minted. |

### `DonateEvent` payload

The `donate` event is emitted after a successful XLM donation and token
transfer. Its topic is `("donate",)` and its data is the following Soroban
contract type (defined in `contracts/greenpay-contract/src/lib.rs`):

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DonateEvent {
    pub donor: Address,
    pub project_id: String,
    pub amount: i128,
    pub co2_offset: i128,
    pub timestamp: u64,
}
```

`amount` is denominated in stroops. `co2_offset` is the calculated CO2 offset
in grams, and `timestamp` is the ledger timestamp in seconds. The existing
`donated` event remains available for consumers of the legacy topic and
payload.

### Projects

| Event | Topics | Data | Emitted by / when |
|-------|--------|------|-------------------|
| `proj_reg` | `["proj_reg", admin: Address]` | `project_id: String` | `register_project()` and `batch_register_projects()` when a climate project is registered. |
| `ProjectDeactivated` | `["ProjectDeactivated", admin: Address]` | `project_id: String` | `deactivate_project()` when a project is deactivated. |
| `co2_rate_updated` | `["co2_rate_updated", admin: Address]` | `(project_id: String, rate: u64)` | `set_co2_rate()` when a project's CO2-per-XLM rate changes. |
| `meta_updated` | `["meta_updated", project_id: String]` | `(admin: Address, ipfs_cid: String)` | `set_project_metadata()` when the off-chain metadata pointer (IPFS CID) is set or updated. The CID is stored under `DataKey::ProjectMetadata(project_id)` and readable via `get_project_metadata`. |

### Match pledges (2x donation matching)

| Event | Topics | Data | Emitted by / when |
|-------|--------|------|-------------------|
| `pledge_cr` | `["pledge_cr", matcher: Address, project_id: String]` | `(cap_xlm: i128, deadline_ledger: u32)` | `create_match_pledge()` when a matcher funds a 2x match pledge for a project. |
| `pledge_cn` | `["pledge_cn", caller: Address, project_id: String]` | `matched_amount: i128` (amount matched so far) | `cancel_match_pledge()` when the matcher or admin cancels a pledge. |
| `pledge_st` | `["pledge_st", admin: Address, project_id: String]` | `active: bool` | `set_match_pledge_status()` when the admin activates/deactivates a pledge. |

### Governance (badge-holder project verification)

| Event | Topics | Data | Emitted by / when |
|-------|--------|------|-------------------|
| `prop_new` | `["prop_new", admin: Address]` | `(project_id: String, window: u32)` | `create_proposal()` when a verification proposal opens. |
| `voted` | `["voted", voter: Address, project_id: String]` | `approve: bool` | `vote_verify_project()` on each vote cast. |
| `proj_ver` | `["proj_ver"]` | `project_id: String` | `resolve_proposal()` when a proposal passes and the project is verified. |
| `prop_rej` | `["prop_rej"]` | `project_id: String` | `resolve_proposal()` when a proposal is rejected. |
| `prop_veto` | `["prop_veto", admin: Address]` | `project_id: String` | `veto_proposal()` when the admin vetoes a proposal. |

### Admin, config, and upgrades

| Event | Topics | Data | Emitted by / when |
|-------|--------|------|-------------------|
| `paused` | `["paused", admin: Address]` | `()` | `pause()` — emergency circuit breaker engaged. |
| `unpaused` | `["unpaused", admin: Address]` | `()` | `unpause()` — circuit breaker released. |
| `adm_prop` | `["adm_prop", admin: Address]` | `new_admin: Address` | `propose_new_admin()`. |
| `adm_cncl` | `["adm_cncl", admin: Address]` | `()` | `cancel_admin_proposal()`. |
| `adm_acpt` | `["adm_acpt", previous_admin: Address]` | `new_admin: Address` | `accept_admin()` when the proposed admin takes over. |
| `usdc_set` | `["usdc_set"]` | `(usdc_token: Address, oracle: Address)` | `set_usdc_token()` when the USDC token / oracle pair is configured. |
| `maxage` | `["maxage"]` | `max_age_secs: u64` | `set_max_price_age()` when the maximum oracle price age changes. |
| `upgrade` | `["upgrade"]` | `admin: Address` | `upgrade()` after the contract WASM is replaced. |

Note: `initialize()` does **not** emit an event.

---

## Escrow contract (`contracts/escrow-contract`)

| Event | Topics | Data | Emitted by / when |
|-------|--------|------|-------------------|
| `funds_rel` | `["funds_rel", job_id: String]` | `FundsReleased` struct (see below) | `release_funds()` when the admin or client releases all remaining escrow funds against a verified completion report. |

```rust
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FundsReleased {
    pub project_id: String,     // job_id
    pub report_hash: BytesN<32>, // SHA-256 of the off-chain completion report
    pub amount: i128,            // total unreleased amount paid out
}
```

All other escrow operations (`create_job`, `release_milestone`, `claim_milestone`,
`raise_dispute`, `resolve_dispute`) currently emit no events; clients should
re-read job state via `get_job` after a successful call.

---

## Escrow error codes (`ContractError`)

The escrow contract returns typed errors instead of panicking (issue #1638).
Clients (frontend job board, `backend/src/routes/jobs.js`) can branch on the
numeric code surfaced in the transaction failure. Codes:

| Code | Variant | Meaning |
|------|---------|---------|
| 1 | `NotInitialized` | `initialize` was never called (no admin in storage). |
| 2 | `AlreadyInitialized` | `initialize` called again after initialization. |
| 3 | `Unauthorized` | Caller is not the admin/client/matcher/job party required by the entrypoint. |
| 4 | `JobNotFound` | No job stored under the requested `job_id`. |
| 5 | `JobAlreadyExists` | `create_job` called with an existing `job_id`. |
| 6 | `InvalidAmount` | Escrow `amount` must be strictly positive. |
| 7 | `InvalidMilestoneSplit` | Milestone percentages must sum to exactly 100. |
| 8 | `InvalidMilestoneIndex` | `milestone_index` out of range for the job. |
| 9 | `MilestoneAlreadyReleased` | Milestone has already been released. |
| 10 | `DisputeActive` | Job is disputed; an admin must resolve it before funds move. |
| 11 | `NotDisputed` | `resolve_dispute` called on a job that is not disputed. |
| 12 | `NoProposedAdmin` | No pending admin proposal to accept. |
| 13 | `NotProposedAdmin` | Caller is not the address proposed as the new admin. |
| 14 | `ReleasePeriodNotReached` | Freelancer `claim_milestone` called before the `release_after` ledger window elapsed. |
| 15 | `NoUnreleasedFunds` | `release_funds` called when every milestone is already released. |
| 16 | `GreenPayPaused` | The linked GreenPay contract is paused, blocking escrow operations. |
| 17 | `Overflow` | Arithmetic overflow in milestone split / release tally. |

---

## Usage notes for indexers and clients

- All events follow Soroban's standard format: `topics: Vec<Val>`, `data: Val`.
- Symbols shortened via `symbol_short!` are at most 8-9 characters; longer
  names (`MilestoneReached`, `BadgeUpgraded`, `ProjectDeactivated`,
  `co2_rate_updated`, `meta_updated`, `batch_donated`, `donation_refunded`) are
  full `Symbol::new` values. Decode the first topic as a string to key on.
- The same symbol can carry different payloads per entrypoint (see `donated`
  for XLM vs USDC); check the operation type before decoding the data.
- Events can be queried via Horizon operation results or Soroban RPC
  (`getTransaction` → `events`). The backend indexer
  (`backend/src/services/indexerService.js`) should keep this file as the
  schema reference.
