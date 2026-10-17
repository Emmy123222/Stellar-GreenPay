# Getting Started

Welcome! This guide will walk you step-by-step from zero to making your first testnet donation on the platform — no prior blockchain experience required.

---

## 1. Prerequisites

Before you begin, make sure you have the following installed:
| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| npm | Latest |
| Freighter Wallet | Browser extension |

### ✅ Node.js

- Install Node.js **v20 or higher** — this is what the repo standardises on via `.nvmrc` (`20`) and the backend's `engines` requirement (`node >=20`). Staying on v18 will lead to unsupported builds.
- If you use [nvm](https://github.com/nvm-sh/nvm), pin the correct version from the repo root with:

```bash
nvm install && nvm use
```

- Verify installation:

```
node -v
npm -v
```

### ✅ Freighter Wallet

Freighter is a browser extension wallet for the Stellar network.

- Install Freighter from: https://freighter.app/
- Create a new wallet (or import an existing one)
- Save your secret key securely (very important!)
- 🔁 Switch Freighter to Testnet

## 2. Clone and Run Locally

### Run the development stack with Docker

The frontend uses a dedicated development image target with Next.js hot reload. From the repository root, run:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

The development compose override mounts the frontend source and enables polling so file changes are detected inside Docker. The production `runner` image target is unchanged.

- 📥 Clone the Repository

```
git clone <your-repo-url>
cd <your-project-folder>
```

- ⚙️ Run Setup Script

```
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

### Backend environment

Before starting the API, copy `backend/.env.example` to `backend/.env` and set
`DATABASE_URL` to a reachable PostgreSQL database. That file groups each
backend variable by subsystem, marks required and optional settings, and lists
defaults. Most integrations (Redis, Stellar, email, S3/IPFS, Sentry, and
Turrets) are optional for a basic local setup.

Start Backend

```
cd backend
npm install
npm run dev
```

Start Frontend

```
cd frontend
npm install
npm run dev
```

🌐 Open the App

```
http://localhost:3000
```

## 3. Fund Your Testnet Wallet

- Open Freighter Wallet and and ensure you are using Testnet
- Visit [Stellar Friendbot](https://friendbot.stellar.org) with your public key
- Refresh Freighter — your balance should now show test XLM

## 4. Make Your First Donation

- Find a Project
- Open the app in your browser: http://localhost:3000
- Browse projects and select: “Amazon Reforestation”
- Donate 10 XLM
- Approve in Freighter

## 5. Check Your Impact

### After donating:

- Go to: http://localhost:3000/dashboard
- You should see:
    - A donation badge
    - Your CO₂ offset contribution

## 6. View on the Blockchain

### View Transaction

- After donating
- Click the Stellar Expert link from your donation

## Troubleshooting

### Problem: App says wallet not detected

- Ensure Freighter extension is installed
- Refresh the page
- Make sure it’s enabled in your browser

### Problem: Wallet shows 0 XLM

- Ensure your Freighter wallet is set to in Testnet
- Use Friendbot again:
- https://friendbot.stellar.org/?addr=YOUR_PUBLIC_ADDRESS
- Refresh the wallet

### Problem: Donation fails or is rejected

- Not enough balance → fund wallet again
- Wrong network → switch Freighter to Testnet
- User rejected → retry and approve in Freighter
- Backend not running → ensure backend server is active

### Problem: Page doesn’t load or API fails

- Confirm both frontend and backend are running
- Check terminal logs for errors
- Restart both servers
- For more issues, see [Troubleshooting](troubleshooting.md)

Start Backend

```
cd backend
npm install
npm run dev
```

Start Frontend

```
cd frontend
npm install
npm run dev
```

---

## 7. Running without Docker

If you prefer to run services locally (or if the Docker Compose setup is problematic in your environment), follow this bare-metal path. This setup requires:

- [PostgreSQL](https://www.postgresql.org/) **16**
- [Redis](https://redis.io/) **7**
- [Node.js](https://nodejs.org/) **≥ 20** and npm (match `.nvmrc` with `nvm install && nvm use` from the repo root)

### 7.1 Install dependencies (per OS)

| Service | macOS (Homebrew) | Ubuntu/Debian | Windows (Chocolatey) |
|---|---|---|---|
| PostgreSQL 16 | `brew install postgresql@16` | `sudo apt install postgresql-16` | `choco install postgresql --version=16.9.0` (or latest 16.x) |
| Redis 7 | `brew install redis@7` | `sudo apt install redis-server` | `choco install redis-64` (or WSL recommended for Linux tooling) |

**Notes:**
- On Linux, ensure services are enabled: `sudo systemctl enable --now postgresql redis-server` (or equivalent for your distro).
- On macOS, start with `brew services start postgresql@16` and `brew services start redis@7`.
- On Windows, start PostgreSQL/Redis from the installed services or use WSL2 for a smoother Unix-like experience.

### 7.2 Create the database

Connect to PostgreSQL and create the app database/user if needed. Default values match `.env.example`:

```bash
# Connect as postgres superuser
psql -U postgres
```

Then run in `psql`:

```sql
CREATE DATABASE greenpay;
-- Optionally create a dedicated user if you prefer
-- CREATE USER greenpay_user WITH PASSWORD 'your_password';
-- GRANT ALL PRIVILEGES ON DATABASE greenpay TO greenpay_user;
\q
```

### 7.3 Set up environment variables

#### Backend (`backend/.env`)

Create `backend/.env` (or copy from example). Minimal required values for local dev:

```bash
PORT=4000
NODE_ENV=development
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
DATABASE_URL=postgres://postgres:postgres@localhost:5432/greenpay
REDIS_URL=redis://localhost:6379
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
APP_URL=http://localhost:3000
JWT_SECRET=dev-only-secret-change-in-prod-min-32-chars
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
STORAGE_BACKEND=local
UPLOAD_DIR=backend/uploads
```

> **Note:** If you created a custom DB user, update `DATABASE_URL` accordingly. For optional pieces (Sentry, Resend, Anthropic, IPFS/S3 moderation), see [backend/.env.example](../backend/.env.example) for full reference.

#### Frontend (`frontend/.env.local`)

Next.js reads `.env.local` for local overrides. Minimal required:

```bash
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_API_URL=http://localhost:4000
```

The contract IDs are populated automatically by the `predev` hook (`scripts/set-contract-env.js`) when you run `npm run dev`. If you need to populate them manually: `node scripts/set-contract-env.js`.

### 7.4 Install dependencies

From repo root:

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 7.5 Run database migrations

From `backend/`:

```bash
npm run migrate
```

This runs [`backend/src/db/migrate.js`](../backend/src/db/migrate.js) against `DATABASE_URL`.

### 7.6 Start services

Open two terminals from repo root:

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Frontend’s `predev` script automatically runs `node ../scripts/set-contract-env.js` to sync contract env vars before starting Next.js.

Open [http://localhost:3000](http://localhost:3000). API runs on [http://localhost:4000](http://localhost:4000).

### 7.7 Optional pieces

#### Use a stub Horizon (for local testing/load flows)

If you need to simulate confirmed transactions without hitting real Horizon (e.g. local testing), start the stub:

```bash
node scripts/stub-horizon.js
```

By default it listens on `http://127.0.0.1:8081`. Point backend to it:
```bash
# in backend/.env
HORIZON_URL=http://127.0.0.1:8081
```

See [`scripts/stub-horizon.js`](../scripts/stub-horizon.js) for details (it answers only `GET /transactions/:hash`).

#### Use IPFS for document storage

To store uploaded documents on IPFS (instead of local disk), set in `backend/.env`:
```bash
STORAGE_BACKEND=ipfs
IPFS_API_URL=https://api.pinata.cloud/api/v0/add  # or your IPFS API
IPFS_GATEWAY_URL=https://ipfs.io/ipfs
PINATA_JWT=your_pinata_jwt_here
```

If credentials are missing/invalid for S3/IPFS, the app falls back to local storage per `.env.example`.

### 7.8 Troubleshooting

- If migrations fail, verify `DATABASE_URL` and that Postgres is accepting connections.
- If Redis cache is unavailable, it’s silently bypassed (ok for local dev). Check `REDIS_URL`/service status.
- For digest email, wallet detection, network, and general issues, see [docs/troubleshooting.md](troubleshooting.md).
- If you see contract ID errors, ensure frontend env is populated (run `node scripts/set-contract-env.js` manually).
