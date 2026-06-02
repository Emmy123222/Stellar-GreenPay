# 🌱 Stellar GreenPay

> Donate directly to verified climate projects using XLM — every transaction tracked on-chain.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Stellar](https://img.shields.io/badge/Stellar-Testnet-blue)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Soroban-Smart%20Contracts-green)](https://soroban.stellar.org)

Stellar GreenPay is an open-source climate donation platform where donors give XLM directly to verified environmental projects. Every donation is recorded on the Stellar blockchain via Soroban smart contracts — providing radical transparency and zero platform fees.

---

## ✨ Features (v1)

- 🔗 **Wallet Connect** — Freighter browser wallet integration
- 🌍 **Browse Projects** — Verified climate projects with impact metrics
- 💚 **Donate XLM** — Direct on-chain donations to project wallets
- 📊 **Impact Tracking** — Soroban contract tracks every donation and CO₂ offset
- 🏆 **Leaderboard** — Top donors ranked by total XLM given
- 💬 **Project Updates** — Organisations post progress updates to donors

---

## 🗂 Project Structure

```
stellar-greenpay/
├── frontend/          # Next.js + React + Tailwind CSS
├── backend/           # Node.js + Express API
├── contracts/         # Stellar Soroban smart contracts (Rust)
├── docs/              # Architecture & API documentation
├── scripts/           # Deployment & utility scripts
├── .github/           # CI/CD workflows & issue templates
├── CONTRIBUTING.md
├── ROADMAP.md
└── LICENSE
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18.x |
| npm | Latest |
| Rust + Cargo | ≥ 1.74 (for contracts) |
| Freighter Wallet | Browser extension |

### 1. Clone & Setup

```bash
git clone https://github.com/your-org/stellar-greenpay.git
cd stellar-greenpay
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

### 2. Start Frontend

```bash
cd frontend && npm run dev
# → http://localhost:3000
```

### 3. Start Backend

```bash
cd backend && npm run dev
# → http://localhost:4000
```

### Docker Hot-Reload Development

Use the development override when you want frontend and backend source edits to refresh inside Docker without rebuilding:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

The override mounts `backend/src` directly into the API container and runs Nodemon in legacy watch mode for Docker Desktop file-event reliability. It mounts the frontend workspace into the Next.js container, keeps container-owned `node_modules`/`.next` directories, and enables polling for Next/Webpack watchers.

---

## 🔑 Environment Variables

### Frontend (`frontend/.env.local`)
```env
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_CONTRACT_ID=
```

### Backend (`backend/.env`)
```env
PORT=4000
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
CONTRACT_ID=
ALLOWED_ORIGINS=http://localhost:3000
```

---

## 🧪 Get Testnet XLM

1. Install [Freighter Wallet](https://freighter.app) and switch to **Testnet**
2. Visit [Stellar Friendbot](https://friendbot.stellar.org) with your public key
3. Receive 10,000 test XLM instantly

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All skill levels welcome!

Please note that this project is governed by a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold its terms.

## 🗺 Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features.

## 📄 License

MIT — see [LICENSE](LICENSE)
