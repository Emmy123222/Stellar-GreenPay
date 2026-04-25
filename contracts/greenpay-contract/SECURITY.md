# GreenPay Contract — Security Audit

Scope: [`contracts/greenpay-contract/src/lib.rs`](src/lib.rs) (Soroban SDK 21.7.7).
This document records the audit methodology, findings, severity, fix status,
and the regression tests that lock each fix in place.

## Methodology

The audit walked the contract surface looking for the classes of issues
called out in the task brief and the standard Soroban / Stellar threat
model:

1. **Reentrancy** — every external call (`token::Client::transfer`,
   cross-contract invocations) was checked against the
   Checks-Effects-Interactions (CEI) ordering so that contract state is
   durable before control leaves the contract.
2. **Integer arithmetic** — every `+`, `-`, `*` on `i128` / `u32` was
   inspected for overflow risk, even though the release profile sets
   `overflow-checks = true`. Checked operations are preferred so the
   failure mode is an explicit, named panic rather than reliance on the
   profile (downstream consumers may compile with a different profile).
3. **Access control** — every `pub fn` was checked for a matching
   `require_auth`, an admin equality check where appropriate, and
   eligibility predicates (e.g. badge holding for governance votes).
4. **Front-running / MEV** — donation and governance flows were
   inspected for transaction-ordering exploits.
5. **Event safety** — published events were checked for spoofable
   topics and dropped data fields.
6. **Edge cases** — badge boundaries, zero/negative amounts, and
   boundary ledger sequences were enumerated.
7. **Storage lifecycle** — `instance` storage TTL implications and
   archive behavior were noted as operational considerations.

The methodology pairs each substantive finding with a regression test
in [`src/lib.rs`](src/lib.rs#L654) so reverts are caught by `cargo test`.

## Severity scale

| Severity | Definition |
| --- | --- |
| **Critical** | Funds at risk now, no preconditions. |
| **High**     | Funds or accounting integrity at risk under realistic conditions. |
| **Medium**   | State corruption or DoS under unusual but plausible inputs. |
| **Low**      | Cosmetic, inaccurate metrics, or requires implausible inputs. |
| **Info**     | Documentation / hygiene; no exploit. |

## Findings

### H-01 — `donate()` violated Checks-Effects-Interactions  *(Fixed)*

**Severity:** High.
**Location (pre-fix):** [`src/lib.rs:190-256`](src/lib.rs#L190).

Previously `token_client.transfer(&donor, &project.wallet, &amount)` ran
**before** every state mutation (project totals, donor stats, NFT mint,
global counters). The token contract is supplied by the caller, so a
malicious or wrapped token could re-enter `donate` (or any other
contract function) before `total_raised`, `donor_count`,
`donor_stats.total_donated`, the badge, the NFT, and global counters
were written. Reentry could over-credit the donor (claiming multiple
NFT tiers on a single payment) or inflate global stats.

**Fix.** All effects are now applied first; the external token transfer
is the last meaningful operation in `donate`. The trailing `donated`
event is the only post-interaction step and reads only data computed
before the transfer. See [`src/lib.rs`](src/lib.rs#L195-L274) — the
"Effects" / "Interaction" boundary is marked with comments.

**Regression test:** `test_donate_basic_flow_after_cei_reorder`
exercises the full happy path post-reorder and asserts both contract
state and the SAC token balances are correct (proving the transfer is
still wired up after every state write).

### H-02 — Unchecked arithmetic in donation accounting  *(Fixed)*

**Severity:** High (defense-in-depth).
**Location (pre-fix):** every `+=` / `+` / `*` in
[`donate()`](src/lib.rs#L190), [`register_project`](src/lib.rs#L151),
[`create_proposal`](src/lib.rs#L337), and
[`vote_verify_project`](src/lib.rs#L360).

`Project.total_raised`, `DonorStats.total_donated`,
`DonorStats.co2_offset_grams`, `GlobalTotalRaised`, and
`GlobalCO2OffsetGrams` are `i128`. `donor_count`, `donation_count`,
`votes_for`, `votes_against`, `ProjectCount`, `DonationCount`, and
`deadline_ledger` are `u32`. All were updated with bare `+`, relying
on the release profile's `overflow-checks = true` to avoid silent
wrap. That guard is profile-scoped and easy to lose in a refactor;
the multiplication `(amount / STROOP) * project.co2_per_xlm as i128`
in particular can be driven to overflow by an admin who registers a
project with a very large `co2_per_xlm`.

**Fix.** Every arithmetic site uses `checked_add` / `checked_mul` and
calls `.expect(...)` with a named message so a regression produces a
diagnosable error rather than silent corruption.

**Regression tests:**

* `test_donate_total_raised_overflow_protected` injects a near-`i128::MAX`
  `total_raised` into project storage and asserts the next donation
  panics with `"Project total_raised overflow"` rather than wrapping.
* `test_donate_co2_overflow_protected` registers a project with
  `co2_per_xlm = u32::MAX` and donates an amount large enough that the
  CO2 multiplication would overflow `i128`, asserting the named panic.
* `test_voting_deadline_checked_add_guard` asserts the
  `ledger + VOTING_WINDOW_LEDGERS` add panics near `u32::MAX` instead
  of wrapping into the past (which would let `resolve_proposal` run
  immediately).

### M-01 — `Project.donor_count` was a donation counter  *(Fixed)*

**Severity:** Medium (data integrity / public-metric inflation).
**Location (pre-fix):** [`src/lib.rs:209`](src/lib.rs#L209) — `project.donor_count += 1` ran on every donation.

The contract header advertises "donor count, CO2 offset per project" as
a public metric. The implementation incremented `donor_count` on every
`donate` call, so a single donor making 100 small donations made the
project look like it had 100 supporters. This is a trust/UX defect for
a transparency-first protocol and was directly exploitable for
reputation inflation — including by the project owner, since the wallet
they receive into can also act as a donor.

**Fix.** A new `DataKey::HasDonated(project_id, donor)` flag tracks
first-time donors per project. `donor_count` only increments the first
time a particular donor pays the project; subsequent donations
increment `donation_count` (donor-scoped) and `DonationCount` (global)
but leave `donor_count` alone.

**Regression tests:**

* `test_donate_unique_donor_count_not_inflated` — same donor donates 3
  times to the same project, expects `donor_count == 1` and
  `donation_count == 3`.
* `test_donate_distinct_donors_increment_count` — three distinct donors
  each make one donation, expects `donor_count == 3`.

### L-01 — Voting deadline `u32` overflow  *(Fixed)*

**Severity:** Low (only triggers in ~680 years of Stellar uptime).
**Location (pre-fix):** [`src/lib.rs:352`](src/lib.rs#L352) —
`env.ledger().sequence() + VOTING_WINDOW_LEDGERS`.

A wrap would set `deadline_ledger` to a small number, allowing
`resolve_proposal` to run immediately and bypass the voting window.

**Fix.** `checked_add` with named panic — see H-02 regression test.

### M-02 — `mint_impact_nft` cannot mint earlier tiers  *(Documented, not fixed)*

**Severity:** Medium (logic bug, no fund risk).
**Location:** [`src/lib.rs:300-328`](src/lib.rs#L300).

`mint_impact_nft` requires `stats.badge == tier`. The auto-mint inside
`donate()` only mints the **current** badge after a tier change, so a
donor who jumps multiple tiers in one donation (e.g. None → Forest by
sending 500 XLM in one transaction) ends up with only the Forest NFT
and can never mint the Seedling or Tree NFTs they would have qualified
for. The right fix is either (a) auto-mint every tier crossed in
`donate`, or (b) change the gate to
`tier_rank(tier) <= tier_rank(stats.badge)` and let the donor claim
backwards. The current design is documented here so it is fixed in a
dedicated change with its own UX review (claim-back vs. auto-mint) —
out of scope for a security audit fix.

### L-02 — `DonationRecord` constructed but never stored  *(Documented)*

**Severity:** Low / Info (no exploit; misleading dead code).
**Location (pre-fix):** [`src/lib.rs:238-241`](src/lib.rs#L238).

The pre-fix `donate()` built a `DonationRecord { ... message_hash: msg_hash }`
into a `_donation` binding and dropped it. Donation history is **not**
persisted on-chain — only the global `DonationCount` is. The fix
removed the dead allocation and instead surfaces the `msg_hash` in the
`donated` event payload so off-chain indexers can attest to the
donor's message without paying for on-chain storage. Persisting the
full record is a separate product decision (storage cost vs. on-chain
queryability).

### L-03 — `deactivate_project` emits no event  *(Documented)*

**Severity:** Low (observability gap, not a security flaw).
**Location:** [`src/lib.rs:177-186`](src/lib.rs#L177).

Other admin actions (`register_project`, `create_proposal`) emit
events; deactivation does not, so off-chain indexers cannot detect a
project going inactive without polling. Recommend emitting a
`(symbol_short!("proj_off"), admin), project_id` topic.

### L-04 — No admin rotation function  *(Documented)*

**Severity:** Low (operational risk).
**Location:** the admin set in `initialize` is permanent.

Loss of admin keys means no new projects, deactivations, or proposals
forever. Recommend a `transfer_admin(current_admin, new_admin)` with
both `require_auth` checks. Out of scope for this audit pass.

## Front-running analysis

* **Donations** — non-exploitable in the usual sense. A donor's credit
  is bound to their authenticated address; an MEV searcher cannot
  steal credit by reordering. The only ordering effect is who
  *first* crosses a badge threshold — by design.
* **Project deactivation vs. donate** — an admin could `deactivate_project`
  ahead of a victim's `donate`. The donor's transaction would revert
  (project not active), so funds are not lost, only the donation
  attempt fails. Acceptable.
* **Proposal resolution** — `resolve_proposal` is callable by anyone
  after the deadline, so there is no race for the resolution call
  itself (idempotent).
* **Vote ordering** — votes are fungible; there is no benefit to being
  first in a block.

## Access control audit

| Function | Auth required | Role check | Notes |
| --- | --- | --- | --- |
| `initialize` | none | one-shot guard via `has(Admin)` | OK |
| `register_project` | `admin.require_auth` | `stored_admin == admin` | OK |
| `deactivate_project` | `admin.require_auth` | `stored_admin == admin` | OK; missing event (L-03) |
| `donate` | `donor.require_auth` | n/a (open) | OK |
| `mint_impact_nft` | `donor.require_auth` | tier == current badge | Logic bug (M-02) |
| `create_proposal` | `admin.require_auth` | `stored_admin == admin` | OK |
| `vote_verify_project` | `voter.require_auth` | badge ≥ Seedling, no double-vote, deadline alive | OK |
| `resolve_proposal` | none | deadline passed, not yet resolved | OK (idempotent) |
| getter functions | none | n/a | OK |

## Badge boundary edge cases

`calculate_badge` is called with `total_stroops` and uses integer
division `total_stroops / STROOP` then `>=` comparisons. The boundary
behavior is exact:

| Stroops | XLM (truncated) | Tier |
| --- | --- | --- |
| `9 * STROOP` | 9 | None |
| `10 * STROOP` | 10 | Seedling |
| `99 * STROOP` | 99 | Seedling |
| `100 * STROOP` | 100 | Tree |
| `499 * STROOP` | 499 | Tree |
| `500 * STROOP` | 500 | Forest |
| `1999 * STROOP` | 1999 | Forest |
| `2000 * STROOP` | 2000 | EarthGuardian |

This is locked in by `test_calculate_badge_thresholds` in
[`src/lib.rs`](src/lib.rs#L491). The integer truncation means
sub-1-XLM donations contribute zero to CO2 offset; this is by design
and documented here so it is not "fixed" by an unrelated rounding
change later.

## Test results

```
cargo test -p greenpay-contract --lib
running 19 tests
... 19 passed; 0 failed; 0 ignored
```

13 pre-audit tests + 6 new regression tests (one per finding fixed
above) all pass.
