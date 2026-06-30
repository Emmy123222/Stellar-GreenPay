# Contract Events

Every donation, badge milestone, governance action, and admin operation
emits a structured Soroban contract event.  This document catalogs all
11 events emitted by the GreenPay contract.

Events are published via `env.events().publish(topics, data)`.  The
first element of the **topics** tuple is always a 4-7 byte `Symbol`
that identifies the event name.  Both **topics** and **data** are
`Vec<SCVal>` in the Soroban XDR encoding.

| # | Event | Topics | Data | Lines |
|---|-------|--------|------|-------|
| 1 | `proj_reg` | `(Symbol, Address)` | `String` | 191 |
| 2 | `donated` (XLM) | `(Symbol, Address, String)` | `(i128, BadgeTier, u32)` | 288 |
| 3 | `donated` (USDC) | `(Symbol, Address, String)` | `(i128, Symbol)` | 570 |
| 4 | `nft_mint` | `(Symbol, Address)` | `BadgeTier` | 268, 363, 550 |
| 5 | `prop_new` | `(Symbol, Address)` | `(String, u32)` | 418 |
| 6 | `voted` | `(Symbol, Address, String)` | `bool` | 454 |
| 7 | `proj_ver` | `(Symbol,)` | `String` | 468 |
| 8 | `prop_rej` | `(Symbol,)` | `String` | 470 |
| 9 | `prop_veto` | `(Symbol, Address)` | `String` | 474 |
| 10 | `usdc_set` | `(Symbol,)` | `Address` | 580 |
| 11 | `upgrade` | `(Symbol,)` | `Address` | 602 |

---

## 1. `proj_reg` — Project Registered

| Field | Value |
|-------|-------|
| **Emitted in** | `register_project()` (line 191) |
| **Topics** | `[Symbol("proj_reg"), Address(admin)]` |
| **Data** | `String(project_id)` |

**When emitted:** An admin successfully registers a new climate project.
The project is stored with `active = true`, zero balances, and a
`registered_at` ledger sequence.

**Decoding (JavaScript via `soroban-client`):**
```js
const topic = event.topic();           // [Symbol, Address]
const eventName = topic[0].sym();       // "proj_reg"
const admin     = topic[1].address();   // G…

const data = event.data();              // String
const projectId = data.str();           // e.g. "proj-001"
```

---

## 2. `donated` — XLM Donation

| Field | Value |
|-------|-------|
| **Emitted in** | `donate()` (line 288) |
| **Topics** | `[Symbol("donated"), Address(donor), String(project_id)]` |
| **Data** | `[i128(amount), BadgeTier(badge), u32(msg_hash)]` |

**When emitted:** A donor completes an XLM donation.  The token
transfer has already been executed before this event is published
(Checks-Effects-Interactions pattern).

**BadgeTier XDR mapping:** `0 → None`, `1 → Seedling`, `2 → Tree`,
`3 → Forest`, `4 → EarthGuardian`

**Decoding:**
```js
const topic = event.topic();
const eventName = topic[0].sym();       // "donated"
const donor     = topic[1].address();   // G…
const projectId = topic[2].str();       // e.g. "proj-001"

const data = event.data();
const amountXLM   = data[0].i128();     // stroops (1 XLM = 10^7 stroops)
const badgeTier   = data[1].u32();      // 0-4
const messageHash = data[2].u32();
```

---

## 3. `donated` — USDC Donation

| Field | Value |
|-------|-------|
| **Emitted in** | `donate_usdc()` (line 570) |
| **Topics** | `[Symbol("donated"), Address(donor), String(project_id)]` |
| **Data** | `[i128(usdc_amount), Symbol("USDC")]` |

**When emitted:** A donor completes a USDC donation.  The event name
matches the XLM `donated` event, but the data tuple differs — the
second element is the literal `Symbol("USDC")` rather than a badge
tier and message hash.

**Decoding:**
```js
const topic = event.topic();
const eventName = topic[0].sym();       // "donated"
const donor     = topic[1].address();
const projectId = topic[2].str();

const data = event.data();
const usdcAmount = data[0].i128();      // USDC units (7 decimals)
const currency   = data[1].sym();       // "USDC" — distinguishes from XLM
```

> **Tip:** Check `data[1]` — if it is a `Symbol("USDC")` the event
> is a USDC donation; if it is a `u32` it is an XLM donation (badge
> tier).  XLM events always have 3 data elements, USDC events have 2.

---

## 4. `nft_mint` — Impact NFT Minted

| Field | Value |
|-------|-------|
| **Emitted in** | `donate()` (line 268), `mint_impact_nft()` (line 363), `donate_usdc()` (line 550) |
| **Topics** | `[Symbol("nft_mint"), Address(donor)]` |
| **Data** | `BadgeTier(tier)` |

**When emitted:** A donor reaches a new badge tier for the first time
and an Impact NFT is automatically minted into storage.  This can
happen during either an XLM or USDC donation, or via the explicit
`mint_impact_nft()` helper.

**Decoding:**
```js
const topic = event.topic();
const eventName = topic[0].sym();       // "nft_mint"
const donor     = topic[1].address();

const tier  = event.data().u32();       // BadgeTier: 0-4
```

---

## 5. `prop_new` — Voting Proposal Created

| Field | Value |
|-------|-------|
| **Emitted in** | `create_proposal()` (line 418) |
| **Topics** | `[Symbol("prop_new"), Address(admin)]` |
| **Data** | `[String(project_id), u32(window)]` |

**When emitted:** An admin creates a community-voting proposal for a
project.  `window` is the voting duration in ledgers (≈5 s each);
`0` means the default 7-day window (120 960 ledgers).

**Decoding:**
```js
const topic = event.topic();
const eventName = topic[0].sym();       // "prop_new"
const admin     = topic[1].address();

const data = event.data();
const projectId   = data[0].str();
const windowLedgers = data[1].u32();    // 0 or 720..518400
```

---

## 6. `voted` — Vote Cast

| Field | Value |
|-------|-------|
| **Emitted in** | `vote_verify_project()` (line 454) |
| **Topics** | `[Symbol("voted"), Address(voter), String(project_id)]` |
| **Data** | `bool(approve)` |

**When emitted:** A badge-holder (Seedling or above) casts a vote
on a proposal.  One vote per address per proposal.

**Decoding:**
```js
const topic = event.topic();
const eventName = topic[0].sym();       // "voted"
const voter     = topic[1].address();
const projectId = topic[2].str();

const approve = event.data().bool();    // true = for, false = against
```

---

## 7. `proj_ver` — Proposal Approved (Project Verified)

| Field | Value |
|-------|-------|
| **Emitted in** | `resolve_proposal()` (line 468) |
| **Topics** | `[Symbol("proj_ver")]` |
| **Data** | `String(project_id)` |

**When emitted:** A proposal deadline passes and `resolve_proposal()`
finds `votes_for > votes_against`.  The project is community-verified
(the event is informational — the contract does not automatically
change project state on approval).

**Decoding:**
```js
const topic = event.topic();
const eventName = topic[0].sym();       // "proj_ver"

const projectId = event.data().str();
```

---

## 8. `prop_rej` — Proposal Rejected

| Field | Value |
|-------|-------|
| **Emitted in** | `resolve_proposal()` (line 470) |
| **Topics** | `[Symbol("prop_rej")]` |
| **Data** | `String(project_id)` |

**When emitted:** A proposal deadline passes and `resolve_proposal()`
finds `votes_for <= votes_against`.

**Decoding:**
```js
const topic = event.topic();
const eventName = topic[0].sym();       // "prop_rej"

const projectId = event.data().str();
```

---

## 9. `prop_veto` — Proposal Vetoed by Admin

| Field | Value |
|-------|-------|
| **Emitted in** | `veto_proposal()` (line 474) |
| **Topics** | `[Symbol("prop_veto"), Address(admin)]` |
| **Data** | `String(project_id)` |

**When emitted:** An admin immediately vetoes (rejects) a proposal
before the voting window closes.  This is an incident-response action
for proposals based on fraudulent project data.  The `admin` address
in the topics provides an audit trail.

**Decoding:**
```js
const topic = event.topic();
const eventName = topic[0].sym();       // "prop_veto"
const admin     = topic[1].address();   // G…

const projectId = event.data().str();
```

---

## 10. `usdc_set` — USDC Token Configured

| Field | Value |
|-------|-------|
| **Emitted in** | `set_usdc_token()` (line 580) |
| **Topics** | `[Symbol("usdc_set")]` |
| **Data** | `Address(usdc_token)` |

**When emitted:** An admin sets or changes the USDC token contract
address that `donate_usdc` validates against.

**Decoding:**
```js
const topic = event.topic();
const eventName = topic[0].sym();       // "usdc_set"

const usdcToken = event.data().address();  // C…
```

---

## 11. `upgrade` — Contract Upgraded

| Field | Value |
|-------|-------|
| **Emitted in** | `upgrade()` (line 602) |
| **Topics** | `[Symbol("upgrade")]` |
| **Data** | `Address(admin)` |

**When emitted:** An admin upgrades the contract WASM.  All on-chain
state is preserved.

**Decoding:**
```js
const topic = event.topic();
const eventName = topic[0].sym();       // "upgrade"

const admin = event.data().address();   // G…
```

---

## Consuming Events from Horizon / Soroban RPC

Events are returned by:

| Endpoint | Notes |
|----------|-------|
| `GET /operations/{id}/effects` | Filters to effects of type `contract_event` |
| `POST /rpc` `getEvents` | Paginated, filterable by contract ID and topic |

### Example: Polling for `donated` events with `soroban-client`

```js
import { SorobanRpc } from '@stellar/stellar-sdk';

const rpc = new SorobanRpc.Server('https://rpc.testnet.soroban.io');

const events = await rpc.getEvents({
  startLedger: 1000,
  filters: [{
    contractId: 'CONTRACT_ID',
    topics: [[Symbol.for('donated')]],
  }],
  pagination: { limit: 100 },
});

for (const event of events) {
  const topic = event.topic;
  const donor     = topic[1].address();
  const projectId = topic[2].str();

  const data = event.data;
  if (data.length === 3) {
    // XLM donation
    const amountStroops = data[0].i128();
    const badgeTier     = data[1].u32();
    console.log(`${donor} donated ${amountStroops} stroops to ${projectId}`);
  } else {
    // USDC donation
    const usdcAmount = data[0].i128();
    console.log(`${donor} donated ${usdcAmount} USDC to ${projectId}`);
  }
}
```

### XDR SCVal Reference

| SCVal type | Rust type | Notes |
|------------|-----------|-------|
| `SCV_Symbol` | `Symbol` | ≤10 byte ASCII string |
| `SCV_Address` | `Address` | 32-byte public key (`G…`) or contract (`C…`) |
| `SCV_String` | `String` | Variable-length byte string |
| `SCV_I128` | `i128` | Two `i64` halves (lo, hi) in XDR |
| `SCV_U32` | `u32` | 32-bit unsigned |
| `SCV_Bool` | `bool` | Boolean |
| `SCV_Vec` | tuple/vec | Dynamic-length vector of SCVals |
