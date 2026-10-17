# Soroban Contracts Developer Guide

This guide provides instructions for compiling, testing, and building the Soroban smart contracts locally.

## Prerequisites

Ensure you have the Rust toolchain installed. You will also need to add the WebAssembly target.

```bash
# Install Rust toolchain target for WebAssembly
rustup target add wasm32v1-none
```

## Running Tests

### Unit Tests

To run the standard unit tests with the testutils feature enabled:

```bash
# Run unit tests
cargo test --features testutils
```

### Fuzz Tests

To run fuzz tests, use the following command:

```bash
# Run fuzz tests
cargo test --features testutils fuzz
```

### Expected Output

When running tests successfully, you should see output similar to the following:

```
running 10 tests
test test_initialization ... ok
test test_balance ... ok
...
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
```

## Building the Contract

To build the contract into a WebAssembly (.wasm) file ready for deployment:

```bash
# Build WASM
cargo build --target wasm32v1-none --release
```

The compiled WASM file will be located at `target/wasm32v1-none/release/<contract_name>.wasm`.

## Emergency deactivation limits (issue #1635)

`deactivate_all_projects` rewrites every project record. To keep the emergency
stop inside Soroban's per-transaction limits, the contract now exposes a bounded
chunked variant alongside it:

- `deactivate_all_projects(admin)` — single invocation, refuses to run when the
  registry exceeds `MAX_DEACTIVATION_BATCH` and tells the caller to paginate.
- `deactivate_projects_range(admin, offset, limit)` — deactivates at most
  `limit` projects starting at `offset` and returns how many were actually
  changed. `limit` must be `<= MAX_DEACTIVATION_BATCH` (currently `25`).

Drive the range variant until it returns `0`:

```rust
let mut offset = 0;
loop {
    let n = client.deactivate_projects_range(&admin, &offset, &MAX_DEACTIVATION_BATCH);
    if n == 0 { break; }
    offset += n;
}
```

### Recorded benchmark

Measured with the Soroban test environment (`cargo test --features testutils
--test deactivation -- --nocapture`). "Single invocation" figures were taken by
temporarily lifting the batch guard so the legacy all-in-one path could be
measured for comparison. CPU is in instructions, memory in bytes.

| Registry size | Chunked txs (limit 25) | Total CPU | Max CPU / tx | Total memory | Max memory / tx | Single-invocation CPU | Single-invocation memory |
| ------------- | ---------------------: | --------: | -----------: | -----------: | --------------: | --------------------: | -----------------------: |
| 10            |                      1 |   955,716 |      955,716 |      358,616 |         358,616 |               955,067 |                  355,936 |
| 100           |                      4 | 31,218,117 |    7,808,156 |   12,312,056 |       3,078,422 |            14,481,260 |                3,325,756 |
| 150           |                      6 |  —        |       —      |       —      |             —   |            26,456,607 |                5,107,956 |
| 500           | **not reachable**     |       —   |       —      |       —      |             —   |                    —  |                       —  |

`MAX_DEACTIVATION_BATCH = 25` keeps the largest measured batch (~7.8M CPU,
~3.1MB) at well under 10% of the default 100M-instruction transaction budget,
leaving headroom for the rest of the call and for future record growth.

### Why 500 projects cannot be benchmarked

Projects, the `ProjectIds` index vector and the counters all live in the
contract's **instance storage**, which the Soroban host stores as a single
`LedgerKeyContractInstance` entry capped at 64 KiB (`MAX_INSTANCE_ENTRY_BYTES`).
That entry grows with every registered project, so `register_project` itself
aborts before the registry can get large:

```
Error(Budget, ExceededLimit)
contract data entry ... LedgerKeyContractInstance ... size: 65804 > 65536
```

The measured ceiling is roughly **150–160 projects** (depending on how large
each `Project` record is; the `should_panic` test
`registry_cannot_reach_500_projects` demonstrates the abort with the benchmark's
record shape). This is a *storage* limit, not a CPU/memory one — at 150 projects
a single unbounded pass still costs only ~26M instructions.

Implications:

- An unbounded deactivation cannot currently exceed the ~150-project ceiling, so
  the range API is defence-in-depth: it keeps every invocation small and stays
  correct if project storage is later moved to `persistent()` storage (each key
  its own ≤64 KiB entry) to lift the registry cap.
- **Prefer the global `pause` as the primary emergency kill switch.** It is
  O(1), blocks the relevant inflows immediately, and does not rewrite project
  records. Use `deactivate_projects_range` when you specifically need individual
  projects to stop accepting direct donations while `pause` is off, and walk the
  registry in batches rather than expecting a single call to cover everything.

## Troubleshooting Common Errors

### Error: `target wasm32v1-none not found`
*   **Cause**: The WebAssembly target is not installed for your active Rust toolchain.
*   **Fix**: Run `rustup target add wasm32v1-none`.

### Stale artifacts from the old `wasm32-unknown-unknown` target
*   **Cause**: This workspace standardizes on `wasm32v1-none` (soroban-sdk 28 / Contracts CI). Older checkouts, docs, and `scripts/` used `wasm32-unknown-unknown`; `.wasm` files under `target/wasm32-unknown-unknown/release/` are dead leftovers and deployment tooling (`scripts/deploy-contract.sh`, docs) now resolves artifacts under `target/wasm32v1-none/release/` only.
*   **Fix**: Rebuild with the current target (`cargo build --target wasm32v1-none --release`) and delete the stale directory to avoid confusion: `rm -rf target/wasm32-unknown-unknown`. You can also drop the old target from your toolchain with `rustup target remove wasm32-unknown-unknown` if nothing else in your work needs it.

### Error: `unresolved import` or `cannot find value` during tests
*   **Cause**: You might be running tests without the `testutils` feature enabled, which provides mock data and utilities.
*   **Fix**: Ensure you append `--features testutils` when running `cargo test`.

### Error: `linker 'rust-lld' not found`
*   **Cause**: The required linker is missing from your environment.
*   **Fix**: Install the `lld` package for your operating system (e.g., `apt install lld` on Ubuntu, `brew install lld` on macOS).

### Warning: `unused import` or `dead code`
*   **Cause**: The codebase contains unused variables or imports, which Rust flags aggressively by default.
*   **Fix**: While not blocking the build, you can prefix unused variables with an underscore (e.g., `_my_var`) or clean up the code.
