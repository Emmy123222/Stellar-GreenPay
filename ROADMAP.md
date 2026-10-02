# 🗺 Stellar GreenPay — Roadmap

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

- [ ] Docker Compose one-command setup
- [ ] GitHub Actions CI for all layers
- [ ] Unit tests for backend services
- [ ] Playwright e2e tests

---

## 🌿 v1.2 — Verified Projects

> **Placeholder** — Contribute here!

- [ ] Project verification submission form
- [ ] Admin review and approval flow
- [ ] Verified badge with on-chain proof
- [ ] Project registration via Soroban contract

---

## 🏆 v1.3 — Impact NFT Badges

> **Placeholder** — Contribute here!

- [ ] Mint an impact NFT when donation threshold is reached
- [ ] Badge tiers: Seedling 🌱, Tree 🌳, Forest 🌲
- [ ] Display badges on donor profile
- [ ] Share badge on social media

---

## 💬 v1.4 — Community Features

> **Placeholder** — Contribute here!

- [ ] Donor comments on project pages
- [ ] Project update notifications
- [ ] Follow a project
- [ ] Monthly impact digest email

---

## 📊 v1.5 — Impact Dashboard

> **Placeholder** — Contribute here!

- [ ] Total CO₂ offset tracker
- [ ] Real-time donation stream
- [ ] Project completion percentage
- [ ] Global impact map

---

## 💱 v2.0 — Multi-Currency

> **Placeholder** — Contribute here!

- [ ] USDC donations alongside XLM
- [ ] Automatic XLM/USDC conversion via Stellar DEX
- [ ] Show donation value in local fiat currency

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

> **Placeholder** — Contribute here!

- [ ] Community vote on which projects get verified
- [ ] Donor voting power proportional to total donated
- [ ] Governance token issued via Soroban
- [ ] On-chain proposal and voting contract
