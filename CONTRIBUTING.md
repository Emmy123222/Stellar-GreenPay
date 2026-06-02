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

## Testing

```bash
pnpm test          # unit + integration
pnpm test:e2e      # end-to-end (requires running backend + Horizon testnet)
```
