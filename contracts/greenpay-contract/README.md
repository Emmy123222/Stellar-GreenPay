# GreenPay Soroban Contract

This Soroban smart contract provides **on-chain transparency** for every climate donation on Stellar GreenPay.

## What it does

Every donation is recorded permanently on the Stellar blockchain. Anyone can query project totals, donor statistics, CO₂ offsets, and badge tiers — with no central authority controlling the data.

## Functions

| Function | Who calls it | Description |
|----------|-------------|-------------|
| `initialize(admin)` | Deployer | One-time setup |
| `propose_new_admin(admin, new_admin)` | Admin | Start a two-step admin rotation |
| `accept_admin(new_admin)` | Pending admin | Accept the proposed admin role |
| `register_project(admin, id, name, wallet, co2_per_xlm)` | Admin | Register a verified project |
| `deactivate_project(admin, id)` | Admin | Stop new donations to a project |
| `donate(token, donor, project_id, amount, msg_hash)` | Donor | Send XLM + record donation |
| `get_project(id)` | Anyone | Read project stats |
| `get_donor_stats(donor)` | Anyone | Read donor stats + badge |
| `get_badge(donor)` | Anyone | Get current badge tier |
| `get_global_total()` | Anyone | Total XLM raised platform-wide |
| `get_global_co2()` | Anyone | Total CO₂ offset in grams |
| `get_donation_count()` | Anyone | Total donations recorded |

## Admin Rotation

Admin rotation is a two-step flow to avoid accidental lockout:

1. Current admin calls `propose_new_admin(admin, new_admin)`
2. Proposed admin calls `accept_admin(new_admin)`

The current admin remains unchanged until the second step succeeds.

## Badge Tiers

| Badge | Emoji | Threshold |
|-------|-------|-----------|
| Seedling | 🌱 | ≥ 10 XLM |
| Tree | 🌳 | ≥ 100 XLM |
| Forest | 🌲 | ≥ 500 XLM |
| Earth Guardian | 🌍 | ≥ 2,000 XLM |

## Build & Test

```bash
cargo build --target wasm32v1-none --release
cargo test
```

## Deploy

```bash
chmod +x ../../scripts/deploy-contract.sh
../../scripts/deploy-contract.sh testnet alice
```

## Register a Project

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- register_project \
  --admin <ADMIN_ADDRESS> \
  --project_id "amazon-001" \
  --name "Amazon Reforestation" \
  --wallet <PROJECT_WALLET> \
  --co2_per_xlm 8500
```

`co2_per_xlm` = estimated grams of CO₂ offset per XLM donated (8,500 ≈ 8.5 kg per XLM)

## Roadmap

- **v1.3** — Impact NFT minting on badge achievement
- **v2.1** — DAO governance voting for project verification
