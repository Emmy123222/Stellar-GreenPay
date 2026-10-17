# contracts/Makefile
#
# Single source of truth for the contract build, test, and lint commands.
# .github/workflows/contracts.yml invokes these same targets, so the local
# and CI commands cannot drift.
#
# Usage (from contracts/):
#   make build            Compile the release WASM artifacts (wasm32v1-none)
#   make test             Build WASM, then run unit + integration tests
#   make lint             Build WASM, then run clippy with -D warnings
#   make fmt              Format all Rust sources
#   make fmt-check        Verify formatting without writing
#   make clean            Remove the target/ build directory
#   make deploy-testnet   Deploy to testnet via scripts/deploy-contract.sh
#                         (override the key with `make deploy-testnet IDENTITY=<name>`)

CARGO ?= cargo

# wasm32v1-none is the target contracts CI uses and the one whose release
# artifact path (target/wasm32v1-none/release/<crate>.wasm) the
# include_bytes! references in greenpay-contract/tests/integration.rs expect.
WASM_TARGET := wasm32v1-none

# soroban-sdk >= 22 refuses to compile a contract for a wasm target unless the
# build system declares that it supports spec shaking (normally `stellar
# contract build` v25.2.0+ sets this). We build with plain cargo — as CI does —
# so declare support here; this keeps `cargo build`/`cargo test` working without
# requiring the Stellar CLI to be installed.
export SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2 ?= 1

# Identity (configured stellar key) used by scripts/deploy-contract.sh.
IDENTITY ?= alice

.PHONY: build test test-unit test-integration lint fmt fmt-check clean deploy-testnet

build:
	$(CARGO) build --workspace --target $(WASM_TARGET) --release

# The integration test crate embeds the release WASM via include_bytes! at
# compile time, so the artifact must exist before cargo test or cargo clippy
# attempt to compile it. That ordering is why `test` and `lint` depend on
# `build` — the same ordering contracts CI follows.
test: build test-unit test-integration

test-unit:
	$(CARGO) test --workspace

test-integration:
	$(CARGO) test --features testutils --test integration --manifest-path greenpay-contract/Cargo.toml

lint: build
	$(CARGO) clippy --workspace -- -D warnings

fmt:
	$(CARGO) fmt --all

fmt-check:
	$(CARGO) fmt --all -- --check

clean:
	$(CARGO) clean

deploy-testnet:
	bash ../scripts/deploy-contract.sh testnet $(IDENTITY)
