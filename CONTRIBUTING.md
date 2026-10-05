# Contributing to GreenPay

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## Getting started

1. Fork and clone the repo.
2. Install dependencies: `pnpm install` (root workspace).
3. Copy `.env.example` to `.env` and fill in the required values.
4. Start the backend: `pnpm --filter backend dev`.
5. Start the mobile app: `pnpm --filter mobile start`.

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

