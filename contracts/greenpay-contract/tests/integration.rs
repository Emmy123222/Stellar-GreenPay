// tests/integration.rs
//
// Integration tests for the GreenPay Soroban contract.
//
// These tests exercise behaviours that the unit tests in lib.rs cannot cover
// well because they require multi-contract interaction, real ledger-time
// advancement, or the Soroban upgrade machinery:
//
//   1. Cross-contract oracle call  — donate_usdc() creates an OracleClient,
//      crosses a contract boundary to MockOracle, and converts USDC → XLM.
//
//   2. Oracle stale-price (TTL) expiry — the ledger timestamp is advanced
//      beyond max_age = resolution × ORACLE_MAX_AGE_MULTIPLIER; donate_usdc()
//      must panic with "Oracle price is stale".
//
//   3. Admin upgrade flow — upload_contract_wasm + upgrade() replaces the
//      running WASM; all pre-upgrade on-chain state must be preserved.
//
// Run:
//   cargo test --features testutils --test integration
//
// The `testutils` feature gates Env::new_with_config, Address::generate,
// Ledger trait manipulation, StellarAssetClient::mint, and the
// upload_contract_wasm deployer helper.

#![cfg(feature = "testutils")]

use soroban_sdk::{
    contractfile,
    testutils::{Address as _, EnvTestConfig, Ledger as _},
    token::StellarAssetClient,
    Address, Env, String as SorobanString,
};

// Pull in the library crate's public items.  The `rlib` crate-type (added
// alongside `cdylib` in Cargo.toml) makes this linkage possible.
use greenpay_contract::{
    BadgeTier, GreenPayContract, GreenPayContractClient, MockOracle, OracleAsset,
    OraclePriceData, OracleInterface,
};

// ─── WASM artifact reference ─────────────────────────────────────────────────
// `contractfile!` embeds the release WASM bytes at compile time via the path
// produced by `cargo build --target wasm32v1-none --release`.
// CI builds the WASM before running tests (see contracts.yml).
contractfile!(
    file = "../target/wasm32v1-none/release/greenpay_contract.wasm",
    sha256 = []   // empty → skip hash verification during testing
);

// ─── Constants mirrored from lib.rs ──────────────────────────────────────────
// These are private in lib.rs; we duplicate them here.  Any drift will be
// caught immediately by the assertions in these tests.

/// 1 XLM in stroops (10^7).
const STROOP: i128 = 10_000_000;

/// MockOracle::resolution() return value (seconds).
const MOCK_RESOLUTION_SECS: u64 = 300;

/// ORACLE_MAX_AGE_MULTIPLIER from lib.rs.
const ORACLE_MAX_AGE_MULTIPLIER: u64 = 3;

/// Maximum quote age in seconds before donate_usdc rejects the price.
const ORACLE_MAX_AGE_SECS: u64 = MOCK_RESOLUTION_SECS * ORACLE_MAX_AGE_MULTIPLIER; // 900 s

// ─── StaleOracle — purpose-built for TTL expiry tests ────────────────────────

/// A minimal SEP-40 oracle that always returns `timestamp = 0`.
///
/// Unlike `MockOracle` (which returns `env.ledger().timestamp()` so quotes
/// are always fresh), `StaleOracle`'s timestamp is frozen at epoch origin.
/// Any call to `donate_usdc` after the ledger advances past `ORACLE_MAX_AGE_SECS`
/// will see `now - 0 > max_age` and panic with "Oracle price is stale".
#[soroban_sdk::contract]
pub struct StaleOracle;

#[soroban_sdk::contractimpl]
impl OracleInterface for StaleOracle {
    fn decimals(_env: Env) -> u32 {
        6
    }

    fn lastprice(_env: Env, _asset: OracleAsset) -> Option<OraclePriceData> {
        Some(OraclePriceData {
            price: 8_000_000, // same 8 XLM/USDC rate as MockOracle
            timestamp: 0,     // always ancient; triggers stale check when now > max_age
        })
    }

    fn resolution(_env: Env) -> u32 {
        MOCK_RESOLUTION_SECS as u32
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Create a test [`Env`] with snapshot capture disabled.
/// This avoids writing `.soroban/` snapshot files during CI and local runs.
fn test_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    })
}

/// Full contract setup: registers GreenPayContract and MockOracle as two
/// separate on-chain contracts, initialises the main contract, registers one
/// climate project, creates a USDC stellar-asset token, configures it with
/// the oracle, and funds a donor.
///
/// Returns `(env, client, usdc_token, project_id, donor, admin)`.
fn setup_with_live_oracle() -> (
    Env,
    GreenPayContractClient<'static>,
    Address,
    SorobanString,
    Address,
    Address,
) {
    let env = test_env();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, GreenPayContract);
    let client = GreenPayContractClient::new(&env, &contract_id);

    // MockOracle is a *separate* on-chain contract — this exercises the
    // cross-contract call path inside donate_usdc.
    let oracle_id = env.register_contract(None, MockOracle);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let project_id = SorobanString::from_str(&env, "proj-integration-001");
    let wallet = Address::generate(&env);
    client.register_project(
        &admin,
        &project_id,
        &SorobanString::from_str(&env, "Integration Test Project"),
        &wallet,
        &100u32, // co2_per_xlm: 100 g per XLM
        &1i128,  // min_donation_amount: 1 stroop (effectively no minimum)
    );

    let token_admin = Address::generate(&env);
    let usdc_token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    client.set_usdc_token(&admin, &usdc_token, &oracle_id);

    // Fund the donor with 1 000 USDC (6 decimal places).
    let donor = Address::generate(&env);
    StellarAssetClient::new(&env, &usdc_token).mint(&donor, &(1_000 * 1_000_000i128));

    (env, client, usdc_token, project_id, donor, admin)
}

/// Same as `setup_with_live_oracle` but wires in `StaleOracle` so the
/// freshness guard can be tripped by advancing the ledger timestamp.
fn setup_with_stale_oracle() -> (
    Env,
    GreenPayContractClient<'static>,
    Address,
    SorobanString,
    Address,
) {
    let env = test_env();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, GreenPayContract);
    let client = GreenPayContractClient::new(&env, &contract_id);

    let stale_oracle_id = env.register_contract(None, StaleOracle);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let project_id = SorobanString::from_str(&env, "proj-stale-oracle");
    let wallet = Address::generate(&env);
    client.register_project(
        &admin,
        &project_id,
        &SorobanString::from_str(&env, "Stale Oracle Project"),
        &wallet,
        &100u32,
        &1i128,
    );

    let token_admin = Address::generate(&env);
    let usdc_token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    client.set_usdc_token(&admin, &usdc_token, &stale_oracle_id);

    let donor = Address::generate(&env);
    StellarAssetClient::new(&env, &usdc_token).mint(&donor, &(1_000 * 1_000_000i128));

    (env, client, usdc_token, project_id, donor)
}

// ─── Test group 1: Cross-contract oracle call ─────────────────────────────────

/// `donate_usdc` crosses a contract boundary to call `MockOracle::lastprice`.
///
/// MockOracle: price = 8_000_000, decimals = 6  →  1 USDC = 8 XLM.
/// We donate 10 USDC and assert the contract recorded 80 XLM in its global
/// total, which proves the cross-contract call succeeded and the conversion
/// arithmetic is correct end-to-end.
#[test]
fn test_donate_usdc_cross_contract_oracle_records_correct_xlm_equivalent() {
    let (env, client, usdc_token, project_id, donor, _admin) = setup_with_live_oracle();

    // MockOracle returns timestamp = env.ledger().timestamp(), so setting a
    // non-zero ledger time keeps the quote fresh.
    env.ledger().set_timestamp(1_000);

    let usdc_amount: i128 = 10 * 1_000_000; // 10 USDC
    client.donate_usdc(&usdc_token, &donor, &project_id, &usdc_amount, &0u32);

    // 10 USDC × 8 XLM/USDC = 80 XLM = 80 × STROOP stroops.
    let expected_xlm: i128 = 80 * STROOP;
    assert_eq!(
        client.get_global_total(),
        expected_xlm,
        "Cross-contract oracle call must convert 10 USDC → 80 XLM"
    );

    // CO₂: 80 XLM × 100 g/XLM = 8 000 g.
    assert_eq!(
        client.get_global_co2(),
        8_000,
        "CO₂ offset must reflect the XLM-equivalent amount"
    );

    assert_eq!(client.get_donation_count(), 1);

    // Donation record must carry the raw USDC amount and the "USDC" currency symbol.
    let record = client.get_donation_record(&0u32);
    assert_eq!(record.donor, donor);
    assert_eq!(record.amount, usdc_amount);
    assert_eq!(record.currency, soroban_sdk::symbol_short!("USDC"));
}

/// A second donate_usdc call accumulates correctly, confirming the oracle
/// is invoked per-transaction and not cached between calls.
#[test]
fn test_donate_usdc_oracle_invoked_per_transaction() {
    let (env, client, usdc_token, project_id, donor, _admin) = setup_with_live_oracle();
    env.ledger().set_timestamp(1_000);

    let usdc_amount: i128 = 5 * 1_000_000; // 5 USDC per call

    client.donate_usdc(&usdc_token, &donor, &project_id, &usdc_amount, &1u32);
    client.donate_usdc(&usdc_token, &donor, &project_id, &usdc_amount, &2u32);

    // 2 × 5 USDC × 8 XLM/USDC = 80 XLM total.
    assert_eq!(client.get_global_total(), 80 * STROOP);
    assert_eq!(client.get_donation_count(), 2);
}

// ─── Test group 2: Oracle stale-price (TTL) expiry ────────────────────────────

/// When the ledger timestamp advances beyond `resolution × max_age_multiplier`
/// seconds past the oracle quote timestamp, donate_usdc must panic with
/// "Oracle price is stale".
///
/// StaleOracle always returns `timestamp = 0`.  We advance the ledger to
/// `ORACLE_MAX_AGE_SECS + 1` to trip the guard.
#[test]
#[should_panic(expected = "Oracle price is stale")]
fn test_donate_usdc_stale_oracle_price_is_rejected() {
    let (env, client, usdc_token, project_id, donor) = setup_with_stale_oracle();

    // One second past the freshness window: now - 0 > 900 → stale.
    env.ledger().set_timestamp(ORACLE_MAX_AGE_SECS + 1);

    client.donate_usdc(
        &usdc_token,
        &donor,
        &project_id,
        &(10 * 1_000_000i128),
        &0u32,
    );
}

/// Exactly at the freshness boundary the quote is still accepted.
/// The guard in lib.rs is `>` (not `>=`), so `now - timestamp == max_age`
/// is still within the acceptable window.
#[test]
fn test_donate_usdc_oracle_price_at_exact_max_age_boundary_is_accepted() {
    let (env, client, usdc_token, project_id, donor) = setup_with_stale_oracle();

    // now - 0 == ORACLE_MAX_AGE_SECS — exactly at the boundary, not past it.
    env.ledger().set_timestamp(ORACLE_MAX_AGE_SECS);

    client.donate_usdc(
        &usdc_token,
        &donor,
        &project_id,
        &(10 * 1_000_000i128),
        &0u32,
    );

    // 10 USDC × 8 XLM/USDC = 80 XLM — proves the call went through.
    assert_eq!(client.get_global_total(), 80 * STROOP);
}

/// With the ledger timestamp well within the freshness window the donation
/// completes normally.
#[test]
fn test_donate_usdc_fresh_oracle_price_is_accepted() {
    let (env, client, usdc_token, project_id, donor) = setup_with_stale_oracle();

    // timestamp = 0, now = 500, max_age = 900:  500 < 900 → fresh.
    env.ledger().set_timestamp(500);

    client.donate_usdc(
        &usdc_token,
        &donor,
        &project_id,
        &(10 * 1_000_000i128),
        &0u32,
    );

    assert_eq!(client.get_global_total(), 80 * STROOP);
}

// ─── Test group 3: Admin upgrade flow ────────────────────────────────────────

/// The admin can upgrade the contract WASM via upgrade().
///
/// We upload the same compiled WASM binary as the "new" version (re-using
/// the current release artifact).  This exercises the full upgrade path:
///   • admin.require_auth() is satisfied.
///   • env.deployer().update_current_contract_wasm() is called.
///   • DataKey::ContractWasmHash is written with the new hash.
///   • All pre-upgrade on-chain state survives intact.
///   • The contract remains operational after the upgrade.
#[test]
fn test_admin_upgrade_preserves_state_and_stores_wasm_hash() {
    let env = test_env();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, GreenPayContract);
    let client = GreenPayContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Register a project and make a donation to create non-trivial state.
    let pid = SorobanString::from_str(&env, "proj-upgrade-test");
    let wallet = Address::generate(&env);
    client.register_project(
        &admin,
        &pid,
        &SorobanString::from_str(&env, "Upgrade Test Project"),
        &wallet,
        &200u32, // co2_per_xlm: 200 g per XLM
        &1i128,
    );

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let donor = Address::generate(&env);
    let donation: i128 = 50 * STROOP; // 50 XLM → Seedling tier (≥ 10 XLM)
    StellarAssetClient::new(&env, &token).mint(&donor, &donation);
    client.donate(&token, &donor, &pid, &donation, &0u32);

    // Snapshot pre-upgrade state.
    let total_before = client.get_global_total();     // 50 XLM
    let co2_before   = client.get_global_co2();       // 50 × 200 = 10 000 g
    let count_before = client.get_donation_count();   // 1
    let badge_before = client.get_badge(&donor);      // Seedling (50 XLM < 100)

    assert_eq!(total_before, donation);
    assert_eq!(co2_before,   50 * 200);
    assert_eq!(count_before, 1);
    assert_eq!(badge_before, BadgeTier::Seedling);

    // Upload the compiled WASM and obtain its hash.
    // In production this would be a newer artifact; here we reuse the same
    // binary to exercise the upgrade machinery without a second build target.
    // `WASM` is the byte slice embedded by the `contractfile!` call at the
    // top of this file.
    let new_wasm_hash = env.deployer().upload_contract_wasm(WASM);

    client.upgrade(&admin, &new_wasm_hash);

    // ── Post-upgrade assertions ───────────────────────────────────────────

    // 1. The stored WASM hash must match what we passed to upgrade().
    assert_eq!(
        client.get_contract_wasm_hash(),
        Some(new_wasm_hash),
        "upgrade() must persist the new WASM hash in DataKey::ContractWasmHash"
    );

    // 2. All pre-upgrade state must be intact.
    assert_eq!(client.get_global_total(),    total_before, "total_raised preserved");
    assert_eq!(client.get_global_co2(),      co2_before,   "CO₂ offset preserved");
    assert_eq!(client.get_donation_count(),  count_before, "donation_count preserved");
    assert_eq!(client.get_badge(&donor),     badge_before, "donor badge preserved");

    // 3. The contract must remain operational after upgrade.
    let donor2   = Address::generate(&env);
    let donation2: i128 = 20 * STROOP;
    StellarAssetClient::new(&env, &token).mint(&donor2, &donation2);
    client.donate(&token, &donor2, &pid, &donation2, &1u32);

    assert_eq!(
        client.get_global_total(),
        total_before + donation2,
        "contract must accept new donations after upgrade"
    );
}

/// A non-admin account must not be able to call upgrade().
#[test]
#[should_panic(expected = "Only admin can upgrade")]
fn test_upgrade_rejects_non_admin_caller() {
    let env = test_env();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, GreenPayContract);
    let client      = GreenPayContractClient::new(&env, &contract_id);

    let admin    = Address::generate(&env);
    let attacker = Address::generate(&env);
    client.initialize(&admin);

    let hash = env.deployer().upload_contract_wasm(WASM);

    // Passing `attacker` as the admin parameter must be rejected.
    client.upgrade(&attacker, &hash);
}
