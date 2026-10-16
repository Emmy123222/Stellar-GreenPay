# 🗺 Stellar GreenPay — Roadmap

> Status reviewed against the repository on 2026-10-15. A checked item has a working
> implementation in the web, mobile, backend, or Soroban contract code. Unchecked
> items include work that is only partly implemented or lacks the feature named here.

---

## ✅ v1.0 — Foundation (Current)

- [x] Freighter wallet connection
- [x] Browse verified climate projects
- [x] Donate XLM to any project
- [x] On-chain donation tracking via Soroban
- [x] Donor leaderboard
- [x] Project update feed
- [x] Node.js backend API

---

## 🔄 v1.1 — Developer Experience

- [x] Docker Compose one-command setup
- [x] GitHub Actions CI for all layers
- [x] Unit tests for backend services
- [x] Playwright e2e tests

---

## 🌿 v1.2 — Verified Projects

- [x] Project verification submission form
- [x] Admin review and approval flow
- [x] Verified badge with on-chain proof
- [x] Project registration via Soroban contract

---

## 🏆 v1.3 — Impact NFT Badges

- [x] Mint an impact NFT when a donor reaches a new badge tier
- [x] Badge tiers: Seedling 🌱, Tree 🌳, Forest 🌲
- [x] Display badges on donor profile
- [ ] Share the badge itself on social media

> Impact certificates can be shared, but a badge-specific social share card is not implemented.

---

## 💬 v1.4 — Community Features

- [ ] Donor comments on project pages
- [x] Project update notifications
- [x] Follow a project
- [ ] Monthly impact digest email

> Project updates and follows are wired to notifications. The backend digest currently
> runs weekly; a monthly impact digest is not confirmed as a shipped schedule.

---

## 📊 v1.5 — Impact Dashboard

- [x] Total CO₂ offset tracker
- [x] Real-time donation stream
- [x] Project completion percentage
- [x] Global impact map

> The map plots project locations. It does not yet visualize a global CO₂ heatmap.

---

## 💱 v2.0 — Multi-Currency

- [x] USDC donations alongside XLM
- [ ] Automatic XLM/USDC conversion via Stellar DEX
- [ ] Show donation value in local fiat currency

> USDC donations are supported. The DEX price feed supplies an estimate; it does not
> execute a swap. USD estimates appear in some views, but localized fiat display is not
> implemented throughout the donation flow.

---

## 🌉 v2.0 — Bridge & On/Off-Ramp

> **Status:** partially shipped. The **USDC bridge is live** at `/bridge` — it moves USDC
> from Ethereum or Polygon to Stellar via [Circle CCTP](docs/bridge.md) (burn on the
> source chain, mint on Stellar, no wrapped token, no custody). What is *not* built is
> the fiat on/off-ramp.

### Shipped

- [x] `/bridge` page reachable from the main navigation
- [x] Explain in-page what bridging does for GreenPay, and what it does not do
- [x] Read-only EVM USDC balance check via injected wallet
- [x] Deep-link to Circle's CCTP interface with the Stellar destination pre-filled
- [x] Record a completed transfer as a donation to a chosen project
- [x] Local bridge history (`localStorage`, per browser)
- [x] Full page copy translated (en / es / fr)
- [x] Written documentation — [`docs/bridge.md`](docs/bridge.md)

### Not built

- [ ] **SEP-24 anchor deposit** — buy USDC with a bank card or bank transfer
- [ ] **SEP-24 anchor withdrawal** — cash out or move back to a bank account
- [ ] Anchor integration in the backend (none exists today: no SEP-6/24/31 routes)
- [ ] SEP-10 key authentication for the anchor
- [ ] `stellar.toml` + `/.well-known/stellar.toml` anchor declaration
- [ ] On-chain verification of bridge transfers (today the donation is recorded with a
      synthetic hash and is therefore **unverified**)
- [ ] Sync bridge history to the backend instead of `localStorage`

> **Note for contributors:** the CCTP route is a deep link by design — GreenPay never
> custodies funds. A SEP-24 implementation must keep that property. See the
> [Known limitations](docs/bridge.md#known-limitations) before picking up the unverified
> donation-record issue.

---

## 🗳 v2.1 — DAO Governance

- [x] Community vote on which projects get verified
- [ ] Donor voting power proportional to total donated
- [ ] Governance token issued via Soroban
- [x] On-chain proposal and voting contract

> Project proposals and votes run on Soroban and the web UI supports badge-holder voting.
> Voting is eligibility-based rather than weighted by donation total; no governance token
> is issued.
