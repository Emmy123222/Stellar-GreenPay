# Contract Upgrade

The `upgrade` function lets the admin replace the contract WASM without redeploying to a new address. All on-chain state (projects, donations, donor stats) is preserved.

## How it works

```rust
pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>)
```

The function reads the admin from storage and calls `require_auth()` on it, so only the stored admin can invoke it. It then calls `env.deployer().update_current_contract_wasm(new_wasm_hash)` which atomically replaces the contract executable on the ledger.

## Steps

### 1. Build the new binary

```sh
cargo build --target wasm32-unknown-unknown --release
```

The compiled artifact is at `target/wasm32-unknown-unknown/release/greenpay_contract.wasm`.

### 2. Get the WASM hash

```sh
stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/greenpay_contract.wasm \
  --source admin-account \
  --network testnet
```

`stellar contract install` uploads the binary to the ledger and prints the 32-byte hash (hex). Keep this — it's the value you pass to `upgrade`.

### 3. Stage on testnet first

```sh
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin-account \
  --network testnet \
  -- upgrade \
  --new_wasm_hash <HEX_HASH>
```

Confirm that existing storage keys still resolve correctly after the upgrade (query a project, check a donor's stats, etc.) before repeating on mainnet.

### 4. Upgrade on mainnet

Same command, swap `--network testnet` for `--network mainnet`.

## Notes

- The admin address is verified on-chain; no one else can call `upgrade`.
- If the new WASM changes `DataKey` variants or existing struct layouts in a breaking way, writes will succeed but reads of old data will panic. Test on testnet with production-like state first.
- To rotate the admin before an upgrade use `propose_new_admin` / `accept_admin`.
