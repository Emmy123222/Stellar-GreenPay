# Contributing to GreenPay

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## 💬 Community & Discussion

We welcome contributors from all backgrounds! Connect with the core maintainers and fellow developers:
- **Discord**: Join our [#greenpay](https://discord.gg/greenpay) Discord channel for questions, pairing, and real-time project discussions.
- **Telegram**: Join our [GreenPay Community](https://t.me/greenpay_stellar) on Telegram for community announcements and Q&A.

## Getting started

1. Fork and clone the repo.
2. Install dependencies: `pnpm install` (root workspace).
3. Copy `.env.example` to `.env` and fill in the required values.
4. Start the backend: `pnpm --filter backend dev`.
5. Start the mobile app: `pnpm --filter mobile start`.

## Backend coverage

Run the backend suite with coverage from the `backend/` directory:

```bash
npm test -- --coverage
```

Jest writes the HTML report to `backend/coverage/lcov-report/index.html` and
prints the summary in the terminal. The backend Jest configuration enforces a
global floor of 30% statements and lines, 25% functions, and 20% branches;
coverage below any floor fails locally and in Backend CI.

## ✅ Prerequisites

Install the following before cloning:

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18.x | [nodejs.org](https://nodejs.org) or `nvm install 18` |
| npm | latest | bundled with Node |
| Docker | latest | [docs.docker.com/get-docker](https://docs.docker.com/get-docker/) |
| Rust + Cargo | ≥ 1.74 | `curl https://sh.rustup.rs -sSf \| sh` |
| Soroban CLI | latest | `cargo install --locked soroban-cli` |
| Freighter Wallet | latest | See below |

### 🦊 Install Freighter & Switch to Testnet

Freighter is the Stellar browser wallet needed to sign transactions in the app.

1. Install the extension for [Chrome](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/freighter-an-stellar-wallet/).
2. Open Freighter, create or import a wallet, and save your seed phrase securely.
3. Click the network dropdown (top of the popup) and select **Testnet**.
4. Copy your public key — you'll need it to fund the account.

### 💧 Fund Your Testnet Account (Free XLM)

The Stellar Friendbot instantly credits 10,000 test XLM to any new Testnet account.

**Option A — browser:**
```
https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY
```

**Option B — curl:**
```bash
curl "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"
```

A `{"hash": "..."}` response confirms success. Refresh Freighter to see the balance.

---

## 🍴 Fork & Set Up

```bash
git clone https://github.com/YOUR_USERNAME/stellar-greenpay.git
cd stellar-greenpay
git remote add upstream https://github.com/your-org/stellar-greenpay.git
chmod +x scripts/setup-dev.sh && ./scripts/setup-dev.sh
```

Copy the env files and fill in your values:

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Start the app:

```bash
# terminal 1
cd backend && npm run dev   # → http://localhost:4000

# terminal 2
cd frontend && npm run dev  # → http://localhost:3000
```

Or run both services with Docker hot reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

The Docker override watches backend changes through `backend/src` with Nodemon and runs the frontend Next.js dev server with polling enabled, so source edits are picked up without rebuilding images.

### 🎯 Make Your First Testnet Donation

1. Open `http://localhost:3000` in your browser.
2. Click **Connect Wallet** and approve the Freighter prompt.
3. Browse to any listed climate project and click **Donate**.
4. Enter an XLM amount and confirm the transaction in Freighter.
5. The on-chain transaction hash appears in the UI — paste it into [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet) to verify.

> 💡 A Loom walkthrough of this flow is available in [`docs/walkthrough.md`](docs/walkthrough.md).

---

---

## Performance expectations

The donations API **must** sustain 100 concurrent users with a **p95 latency
under 500 ms**. This is validated by the k6 load test.

Before merging any change to `POST /api/donations` or the Stellar submission
pipeline:

```bash
# Requires k6 — brew install k6
k6 run scripts/load-test.js
```

The test enforces the p95 threshold as a hard check. A failed threshold means
the PR is not mergeable until the regression is resolved.

See [docs/performance.md](docs/performance.md) for the full target table and
how to record baseline numbers.

## Wallet & Stellar guidelines

- Never log or persist private keys anywhere in the codebase.
- Mobile: use `expo-secure-store` for all key-adjacent data (see
  `mobile/src/hooks/useWallet.ts`).
- Extension: use `window.freighter.signTransaction` — never ask the user for
  their secret key.
- All Stellar transactions target the **testnet** unless `NETWORK=mainnet` is
  explicitly set in the environment.

### Changelog

Every PR must include an update to [CHANGELOG.md](CHANGELOG.md) under the `[Unreleased]` section describing the change. This keeps the release history accurate and simplifies the release process.

### Translations (i18n)

Every UI string must exist in **all** locale files in `frontend/locales/` (`en.json`, `es.json`, `fr.json`, ...). CI runs `node scripts/check-locale-keys.js` on every PR and fails if any locale has keys missing from, or extra to, `en.json`. The log lists each offending key. If you can't translate a string yet, add the English text as a stub in the other locales. Run the check locally before pushing:

```bash
node scripts/check-locale-keys.js
```

### README translations

The README is also available in [Spanish](docs/README.es.md) and [French](docs/README.fr.md). If your PR makes a substantive change to `README.md` (features, project structure, quick start or prerequisites), please mention it in the PR description so the translations can be flagged for update. Perfect sync is not required: the translations carry a "may lag behind the English README" notice, and the English `README.md` is always the source of truth. Translation-only PRs are welcome.

## Testing

```bash
pnpm test          # unit + integration
pnpm test:e2e      # end-to-end (requires running backend + Horizon testnet)
```

## Smart Contracts (Soroban)

The on-chain layer lives in [`contracts/`](contracts/) — a Cargo workspace with
`greenpay-contract` and `escrow-contract`. The full developer guide is
[`contracts/README.md`](contracts/README.md).

### Prerequisites

```bash
# Rust toolchain (stable)
curl https://sh.rustup.rs -sSf | sh

# WebAssembly target used by this repo
rustup target add wasm32v1-none
```

### Run the contract tests

```bash
cd contracts

# Everything CI runs (both contracts, unit + integration tests)
cargo test --workspace

# Unit tests with the soroban-sdk testutils feature enabled
cargo test --features testutils

# Fuzz tests only
cargo test --features testutils fuzz

# A single integration test (example: upgrade regression test)
cargo test -p greenpay-contract --lib test_upgrade_preserves_donation_state_and_storage_keys
```

Contract tests execute inside the Soroban test host — no testnet account or
network access is needed. Snapshot fixtures live in
`contracts/greenpay-contract/test_snapshots/` and are compared on every run, so
an intentional behavior change requires updating them (`cargo insta review`).

Lint before pushing:

```bash
cargo clippy --workspace -- -D warnings
```

### Build the WASM

```bash
cd contracts
cargo build --workspace --target wasm32v1-none --release
```

Artifacts are written to `contracts/<crate>/target/wasm32v1-none/release/*.wasm`.

> **Note on targets:** this workspace builds for `wasm32v1-none`. The older
> `cargo build --target wasm32-unknown-unknown` command found in some legacy
> docs no longer compiles with `soroban-sdk` 26 on Rust ≥ 1.82 (the build script
> rejects `reference-types`/`multi-value` on that target), so always use
> `wasm32v1-none` — it is also the target Contracts CI uses.

### Deploy to testnet

```bash
# From the repo root — builds and deploys in one step
./scripts/deploy-contract.sh testnet alice

# Or deploy an already-built WASM with the Stellar CLI directly
cd contracts
stellar contract deploy \
  --wasm greenpay-contract/target/wasm32v1-none/release/greenpay_contract.wasm \
  --source alice \
  --network testnet
```

`alice` is a [Stellar CLI](https://developers.stellar.org/docs/tools/cli)
identity that must be funded on the target network (Friendbot for testnet).
See [`scripts/deploy-contract.sh`](scripts/deploy-contract.sh) for the full
flow, including post-deploy configuration.

### Further reading

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — registering the contract on
  mainnet and updating the app configuration with the new contract ID.
- [`docs/contract-integration.md`](docs/contract-integration.md) — how the
  backend and frontend call the contract.
- [`contracts/greenpay-contract/UPGRADE.md`](contracts/greenpay-contract/UPGRADE.md)
  — state-migration test requirements for contract upgrades.

## Sentry (Error monitoring)

We use Sentry to capture unhandled exceptions and performance traces.

- Frontend: add `NEXT_PUBLIC_SENTRY_DSN` (or `SENTRY_DSN`) to `frontend/.env.local`.
- Backend: add `SENTRY_DSN` to `backend/.env`.
- Traces sampling: set to 10% (configured by default in the repo).

Quick test (backend): throw an error in any route and confirm it appears in your Sentry project within ~30s.

If you don't have a Sentry project, create one at https://sentry.io and copy the DSN into the env files above.

## 🎃 Hacktoberfest

GreenPay actively participates in [Hacktoberfest](https://hacktoberfest.com)! During September and October, we welcome global open-source contributors to help build, improve, and document the Stellar GreenPay climate donation platform.

### How to Participate

1. **Register**: Sign up at [hacktoberfest.com](https://hacktoberfest.com) between September 26 and October 31.
2. **Find an Issue**: Browse open issues with the `hacktoberfest` or `good-first-issue` labels. Check the table below for curated beginner and intermediate issues.
3. **Claim an Issue**: Leave a comment on the issue requesting assignment before starting work to avoid duplicate efforts.
4. **Follow Project Standards**:
   - Write clean, minimal code following existing architecture and conventions.
   - Run unit tests, type checks, and linters before submitting your PR.
   - If adding UI strings, ensure all locale files (`en.json`, `es.json`, `fr.json`, `ar.json`) remain in parity (`node scripts/check-locale-keys.js`).
5. **Submit Your Pull Request**:
   - Target the `main` branch (or specified dev branch).
   - Reference the issue number (e.g. `Closes #1234`).
   - Fill out the PR template completely with verification evidence.
6. **PR Review & `hacktoberfest-accepted` Label**:
   - Maintainers will review your PR and provide constructive feedback.
   - Once approved and verified, maintainers will apply the `hacktoberfest-accepted` label to count toward your Hacktoberfest badge.

### Quality Standards & Spam Policy

- **No spam or low-effort PRs**: PRs that merely fix a single typo, add whitespace, or copy-paste AI-generated hallucinated code will be marked `invalid`/`spam` and excluded.
- **Commit discipline**: Use conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`).
- **Automated CI**: All GitHub Actions checks (lint, build, tests, locale parity) must pass.

### Curated Hacktoberfest Issues (Beginner & Intermediate)

| # | Issue Title | Track | Difficulty | Labels |
|---|-------------|-------|------------|--------|
| 1 | Add Hebrew (`he`) locale file and RTL alignment test | Frontend | Beginner | `hacktoberfest`, `good-first-issue`, `i18n` |
| 2 | Add sound/haptic feedback toggle in donation flow | Frontend | Beginner | `hacktoberfest`, `good-first-issue`, `frontend` |
| 3 | Add copy-to-clipboard button for transaction hashes on donation success | Frontend | Beginner | `hacktoberfest`, `good-first-issue`, `ux` |
| 4 | Add dark mode toggle keyboard shortcut (`Cmd/Ctrl + Shift + D`) | Frontend | Beginner | `hacktoberfest`, `good-first-issue`, `accessibility` |
| 5 | Implement skeleton loaders for project cards while data fetches | Frontend | Beginner | `hacktoberfest`, `good-first-issue`, `frontend` |
| 6 | Add tooltips explaining Soroban on-chain verification badges | Frontend | Beginner | `hacktoberfest`, `good-first-issue`, `ux` |
| 7 | Add QR code generator modal for project donation address | Frontend | Intermediate | `hacktoberfest`, `intermediate`, `frontend` |
| 8 | Filter climate projects by SDG (Sustainable Development Goals) | Frontend | Intermediate | `hacktoberfest`, `intermediate`, `frontend` |
| 9 | Add pagination or infinite scroll to donor discussion memos | Frontend | Intermediate | `hacktoberfest`, `intermediate`, `frontend` |
| 10 | Add export certificate as PDF using HTML Canvas/jsPDF | Frontend | Intermediate | `hacktoberfest`, `intermediate`, `frontend` |
| 11 | Add rate limiting headers (`RateLimit-Limit`, `RateLimit-Remaining`) | Backend | Beginner | `hacktoberfest`, `good-first-issue`, `backend` |
| 12 | Add health check endpoint (`/api/health/stellar`) checking Horizon status | Backend | Beginner | `hacktoberfest`, `good-first-issue`, `backend` |
| 13 | Add validation schema for project application webhook notifications | Backend | Beginner | `hacktoberfest`, `good-first-issue`, `backend` |
| 14 | Add Prometheus metrics exporter for donation transaction counts | Backend | Intermediate | `hacktoberfest`, `intermediate`, `backend` |
| 15 | Implement caching layer for top donors leaderboard with Redis/TTL | Backend | Intermediate | `hacktoberfest`, `intermediate`, `performance` |
| 16 | Add automated retry with exponential backoff for Horizon RPC timeouts | Backend | Intermediate | `hacktoberfest`, `intermediate`, `backend` |
| 17 | Add event emission on project milestone status updates | Contracts | Intermediate | `hacktoberfest`, `intermediate`, `contracts` |
| 18 | Add unit tests for donation memo length boundary checks | Contracts | Beginner | `hacktoberfest`, `good-first-issue`, `contracts` |
| 19 | Add interactive API reference using Swagger/OpenAPI spec | Docs | Beginner | `hacktoberfest`, `good-first-issue`, `docs` |
| 20 | Add local offline development guide using Soroban sandbox network | Docs | Beginner | `hacktoberfest`, `good-first-issue`, `docs` |
| 21 | Add GitHub Action to auto-label issues based on title prefixes | DevOps | Beginner | `hacktoberfest`, `good-first-issue`, `ci` |
| 22 | Add Lighthouse accessibility and SEO audit check to frontend PRs | DevOps | Intermediate | `hacktoberfest`, `intermediate`, `ci` |


