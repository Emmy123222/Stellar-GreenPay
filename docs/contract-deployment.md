# Contract Deployment Guide

The GreenPay Soroban contract lives in `contracts/greenpay-contract`. This guide
covers building, deploying and wiring up the contract, and — importantly — how
to recover when a deployment goes wrong.

For the first Mainnet launch, follow the full runbook in
[`deployment-mainnet.md`](./deployment-mainnet.md). This document is the
quick-reference companion and the home of the **Rollback and Recovery**
procedure.

## 1. Prerequisites

- `Rust + Cargo` with the WebAssembly target:
  ```bash
  rustup target add wasm32v1-none
  ```
- `stellar-cli`:
  ```bash
  cargo install --locked stellar-cli
  ```
- A funded Stellar identity for the chosen network (`stellar keys generate <name> --network testnet|mainnet`).

## 2. Build the contract

```bash
cd contracts/greenpay-contract
cargo build --target wasm32-unknown-unknown --release
```

## 3. Deploy

The repository ships `scripts/deploy-contract.sh`, which builds the WASM,
deploys it, and initializes the contract with the deployer as admin:

```bash
chmod +x scripts/deploy-contract.sh
./scripts/deploy-contract.sh testnet <identity>   # or: mainnet <identity>
```

On success the script prints the new contract ID.

## 4. Register initial projects

The contract requires an admin call to `register_project(...)` for each verified
climate project. See
[section 5 of the Mainnet runbook](./deployment-mainnet.md#5-register-initial-projects-on-chain)
for the exact `stellar contract invoke` command.

## 5. Configure the applications

Point the frontend and backend at the freshly deployed contract:

```env
# frontend/.env.local
NEXT_PUBLIC_CONTRACT_ID=<contract-id>

# backend/.env
CONTRACT_ID=<contract-id>
```

## 6. Record the contract ID

`contracts/addresses.json` is the source of truth for deployed contract IDs per
network. Update it whenever you deploy, so a testnet reset or a rollback has a
single place to correct. Pair it with the env files above — the running
services read the env vars, not the JSON.

## 7. Verify the deployment

- Confirm the contract ID exists on the network (explorer or `stellar contract invoke ... -- is_paused`).
- Confirm a registered project is readable through the backend API.
- Start the backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`).

---

## Rollback and Recovery

Deployments fail in three common ways: the network resets, the database
migration fails half-applied, or the wrong contract ID is wired into the apps.
Each has a defined recovery path.

### Re-deploying after a testnet reset

Stellar Testnet is periodically reset, which wipes all contract state and makes
previously deployed contract IDs unresolvable. Any client still pointing at the
old ID will fail with "contract not found".

1. Rebuild and re-deploy the contract:
   ```bash
   ./scripts/deploy-contract.sh testnet <identity>
   ```
2. Re-run the contract initialization and `register_project(...)` calls — a
   reset contract has no admin or projects ([runbook](./deployment-mainnet.md#5-register-initial-projects-on-chain)).
3. Update `contracts/addresses.json` with the new `testnet.contractId`.
4. Update every environment that referenced the old ID:
   - `frontend/.env.local` → `NEXT_PUBLIC_CONTRACT_ID`
   - `backend/.env` → `CONTRACT_ID`
   - CI/CD secrets or Kubernetes ConfigMaps/Secrets used in staging
5. Restart the backend and frontend so they pick up the new ID, then verify a
   read call succeeds before resuming donations.

> Tip: `grep -rn "<old-contract-id>" .` finds stale references across config,
> docs, and deployment manifests.

### Handling a failed migration

Database migrations are applied on deploy (see
[DEPLOYMENT.md](./DEPLOYMENT.md#running-database-migrations-post-deploy)). If a
migration fails mid-deploy:

1. **Stop writes** — scale the backend down or enable maintenance mode so no
   requests hit a half-migrated schema.
2. **Inspect the migration history** to see which migrations committed and
   which did not.
3. **Clean up partial state** manually. Migrations that create indexes
   `CONCURRENTLY` cannot run inside a transaction, so a failure can leave a
   partially built index behind — drop it before retrying:
   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS <index_name>;
   ```
4. **Roll back application code** to the previous release if the new code
   depends on schema that is not yet present.
5. **Fix the underlying issue**, then re-run migrations. Prefer forward fixes;
   only use a migration's `down()` when it is safe and reversible.
6. If data was corrupted, restore from the most recent verified backup
   ([database.md](./database.md#database-restore-procedures)) and re-run
   migrations from a clean state.

### Recovering from a wrong contract ID

Symptom: `Contract ID not configured`, contract-not-found errors, or donations
landing at the wrong address.

1. Confirm the intended ID in `contracts/addresses.json`.
2. Correct `CONTRACT_ID` (backend) and `NEXT_PUBLIC_CONTRACT_ID` (frontend).
3. Restart the affected services and re-run the verification steps above.
4. If funds were sent to the wrong project wallet, follow the incident process
   in [`SECURITY.md`](../SECURITY.md) — contract calls are immutable, so
   recovery is handled off-chain with the project owner.

### Emergency pause procedure

The contract exposes admin-gated `pause` / `unpause` (and per-project
`pause_project`) entrypoints in `contracts/greenpay-contract/src/lib.rs`. Use
them to stop contract activity without redeploying:

```bash
# Pause all contract activity
stellar contract invoke \
  --id <contract-id> --source <admin-identity> --network <network> \
  -- pause --admin <admin-public-key>

# Confirm the paused state
stellar contract invoke \
  --id <contract-id> --source <admin-identity> --network <network> \
  -- is_paused

# Resume once the incident is resolved
stellar contract invoke \
  --id <contract-id> --source <admin-identity> --network <network> \
  -- unpause --admin <admin-public-key>
```

Pausing the contract does not pause the backend. While paused, also disable
donation endpoints or put the API in maintenance mode so users are not left
with failed on-chain submissions, and post a status update.

### Rollback checklist

- [ ] Root cause identified and documented
- [ ] Contract paused (if funds are at risk)
- [ ] Backend scaled down / maintenance mode enabled
- [ ] Contract ID or env configuration corrected
- [ ] Failed migrations cleaned up and re-applied
- [ ] `contracts/addresses.json` and env files in sync
- [ ] Services restarted and health checks green
- [ ] A test donation verified end-to-end
- [ ] Post-mortem written and runbook updated

## Related documentation

- [Mainnet deployment runbook](./deployment-mainnet.md)
- [Production deployment guide](./DEPLOYMENT.md)
- [Mainnet deployment checklist](./deployment-checklist.md)
- [Contract integration](./contract-integration.md)
- [Database backups and restore](./database.md)
