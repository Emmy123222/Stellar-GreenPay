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
cargo build --workspace --target wasm32v1-none --release
```

The compiled artifact is at `target/wasm32v1-none/release/greenpay_contract.wasm` (run from `contracts/`). This is the same target and profile CI uses (`.github/workflows/contracts.yml`).

### 2. Get the WASM hash

```sh
stellar contract install \
  --wasm target/wasm32v1-none/release/greenpay_contract.wasm \
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

## Testing the upgrade procedure

The procedure above is verified by automated tests. Run them from `contracts/`:

```sh
# 1. Build the WASM artifact first — the upgrade tests embed it at
#    compile time via include_bytes! (same ordering as contracts CI).
cargo build --workspace --target wasm32v1-none --release

# 2. Unit tests (contract test module in greenpay-contract/src/lib.rs)
cargo test --workspace

# 3. Integration tests, including the full upgrade flow
cargo test --features testutils --test integration --manifest-path greenpay-contract/Cargo.toml
```

What the tests cover:

| Test | Location | Verifies |
| --- | --- | --- |
| `test_upgrade_rejects_non_admin_caller` | `greenpay-contract/src/lib.rs` (`mod tests`) | Passing a non-stored-admin address to `upgrade()` panics with "Only admin can upgrade", even when authorization is otherwise satisfied. |
| `test_upgrade_requires_admin_authorization` | `greenpay-contract/src/lib.rs` (`mod tests`) | Without a matching `require_auth()`, even the genuine stored admin address is rejected and no WASM hash is persisted. |
| `test_upgrade_preserves_donation_state_and_storage_keys` | `greenpay-contract/src/lib.rs` (`mod tests`) | Projects, donor stats, per-donor keys, donation count, and global totals survive an executable swap at the same contract ID (test env's upgrade support). |
| `test_admin_upgrade_preserves_state_and_stores_wasm_hash` | `greenpay-contract/tests/integration.rs` | The real entrypoint end-to-end: uploads the compiled WASM (`upload_contract_wasm`), calls `upgrade()` as the admin, asserts the stored hash, state preservation, and that the contract keeps accepting donations afterwards. |
| `test_upgrade_rejects_non_admin_caller` | `greenpay-contract/tests/integration.rs` | Same non-admin rejection as the unit test, exercised through the compiled client. |

The escrow contract (`escrow-contract`) does **not** expose an `upgrade` entrypoint — it has no admin-gated WASM replacement function — so there is no mirrored upgrade procedure to test there. If one is added, it must replicate both the guard layers (require_auth + stored-admin comparison) and the test coverage listed above.

## Notes

- The admin address is verified on-chain; no one else can call `upgrade`.
- If the new WASM changes `DataKey` variants or existing struct layouts in a breaking way, writes will succeed but reads of old data will panic. Test on testnet with production-like state first.
- To rotate the admin before an upgrade use `propose_new_admin` / `accept_admin`.
