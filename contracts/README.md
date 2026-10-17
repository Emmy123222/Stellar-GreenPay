# Soroban Contracts Developer Guide

This guide provides instructions for compiling, testing, and building the Soroban smart contracts locally.

## Prerequisites

Ensure you have the Rust toolchain installed. You will also need to add the WebAssembly target.

```bash
# Install Rust toolchain target for WebAssembly
rustup target add wasm32v1-none
```

## Quick Start (Makefile)

Common tasks are wrapped by the [`Makefile`](./Makefile) — the same targets
CI runs (see `.github/workflows/contracts.yml`), so local and CI commands
cannot drift. Run these from `contracts/`:

```bash
make build            # Compile the release WASM artifacts (wasm32v1-none)
make test             # Build WASM, then run unit + integration tests
make lint             # Build WASM, then run clippy with warnings denied
make fmt              # Format all Rust sources (make fmt-check to verify only)
make clean            # Remove the target/ build directory
make deploy-testnet   # Deploy to testnet via ../scripts/deploy-contract.sh
```

`make test` and `make lint` depend on `make build` because the integration
test crate embeds the release WASM via `include_bytes!` at compile time —
the artifact must exist before `cargo test` or `cargo clippy` compile it.

## Running Tests

To run the full suite the same way CI does:

```bash
make test
```

This builds the WASM artifacts, runs the unit tests, and then runs the
integration tests (which require the `testutils` feature and the compiled
WASM, built first by the `build` dependency).

### Unit Tests

To run only the standard unit tests:

```bash
# Run unit tests
make test-unit
# Equivalent to: cargo test --workspace
```

### Integration Tests

Multi-contract interaction, oracle TTL expiry, and the admin upgrade flow
(require the compiled WASM from `make build`):

```bash
make test-integration
# Equivalent to:
# cargo test --features testutils --test integration --manifest-path greenpay-contract/Cargo.toml
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
# Build WASM (both contracts, release profile)
make build
# Equivalent to: cargo build --workspace --target wasm32v1-none --release
```

The compiled WASM file will be located at `target/wasm32v1-none/release/<contract_name>.wasm`.

## Linting

```bash
make lint
# Equivalent to: cargo clippy --workspace -- -D warnings
```

Note: CI runs `make lint || true`, i.e. clippy findings are reported but do
not fail the pipeline; the local target is strict so you can catch warnings
before pushing.

## Deploying to Testnet

```bash
make deploy-testnet
# Delegates to ../scripts/deploy-contract.sh testnet (override the key with
# IDENTITY=<name>, e.g. `make deploy-testnet IDENTITY=alice`)
```

## Troubleshooting Common Errors

### Error: `target wasm32v1-none not found`
*   **Cause**: The WebAssembly target is not installed for your active Rust toolchain.
*   **Fix**: Run `rustup target add wasm32v1-none`.

### Error: `soroban-sdk requires stellar-cli v25.2.0+ to build a contract`
*   **Cause**: Building a contract for a wasm target requires the build system to declare spec-shaking support (normally set by `stellar contract build`).
*   **Fix**: Use the Makefile (`make build` / `make test` / `make lint`), which sets `SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1` for you, or install the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) and build with `stellar contract build`.

### Error: `couldn't read .../greenpay_contract.wasm` when running tests or clippy
*   **Cause**: The integration tests embed the release WASM via `include_bytes!` at compile time, and it has not been built yet.
*   **Fix**: Run `make build` first (the `test` and `lint` targets do this automatically).

### Error: `unresolved import` or `cannot find value` during tests
*   **Cause**: You might be running tests without the `testutils` feature enabled, which provides mock data and utilities.
*   **Fix**: Ensure you append `--features testutils` when running `cargo test`.

### Error: `linker 'rust-lld' not found`
*   **Cause**: The required linker is missing from your environment.
*   **Fix**: Install the `lld` package for your operating system (e.g., `apt install lld` on Ubuntu, `brew install lld` on macOS).

### Warning: `unused import` or `dead code`
*   **Cause**: The codebase contains unused variables or imports, which Rust flags aggressively by default.
*   **Fix**: While not blocking the build, you can prefix unused variables with an underscore (e.g., `_my_var`) or clean up the code.
