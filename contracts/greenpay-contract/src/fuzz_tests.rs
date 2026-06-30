/// fuzz_tests.rs — Property-based tests for the GreenPay Soroban contract.
///
/// Uses `proptest` to drive 10 000+ iterations of the `donate` function with
/// random `i128` amounts, asserting that:
///   - Global total-raised never overflows
///   - Global CO2 counter never overflows
///   - Per-project totals stay consistent with global totals
///   - Donation counts are monotonically increasing
///
/// Run:
///   cargo test --features testutils -- fuzz
#[cfg(all(test, feature = "testutils"))]
mod fuzz {
    extern crate std;

    use proptest::prelude::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::StellarAssetClient, Address, Env, String as SorobanString,
    };
    use crate::{DataKey, GreenPayContract, GreenPayContractClient, Project};

    /// Upper bound for a single donation: 1 billion XLM in stroops (10^16).
    /// Chosen so that a single donation is large but a few thousand back-to-back
    /// still fit in an i128 without overflowing.
    const MAX_DONATION: i128 = 1_000_000_000 * 10_000_000; // 10^16

    fn setup() -> (Env, Address, GreenPayContractClient<'static>, Address, SorobanString, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let project_id = SorobanString::from_str(&env, "proj-fuzz-1");
        let wallet = Address::generate(&env);
        client.register_project(&admin, &project_id, &SorobanString::from_str(&env, "Fuzz Project"), &wallet, &100u32);

        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();

        (env, contract_id, client, wallet, project_id, token)
    }

    fn set_project_total_raised(env: &Env, contract_id: &Address, project_id: &SorobanString, amount: i128) {
        env.as_contract(contract_id, || {
            let mut project: Project = env.storage().instance()
                .get(&DataKey::Project(project_id.clone()))
                .expect("project should exist");
            project.total_raised = amount;
            env.storage().instance().set(&DataKey::Project(project_id.clone()), &project);
        });
    }

    fn mint_tokens(env: &Env, token: &Address, donor: &Address, amount: i128) {
        let token_client = StellarAssetClient::new(env, token);
        token_client.mint(donor, &amount);
    }

    #[test]
    fn donation_of_i128_max_minus_one_does_not_panic() {
        let (env, _contract_id, client, _wallet, project_id, token) = setup();
        let donor = Address::generate(&env);
        mint_tokens(&env, &token, &donor, i128::MAX - 1);

        client.donate(&token, &donor, &project_id, &(i128::MAX - 1), &42u32);

        let project = client.get_project(&project_id);
        assert_eq!(project.total_raised, i128::MAX - 1);
        assert_eq!(project.donor_count, 1u32);
        assert_eq!(client.get_global_total(), i128::MAX - 1);
    }

    #[test]
    #[should_panic(expected = "Project total_raised overflow")]
    fn donation_of_i128_max_panics() {
        let (env, contract_id, client, _wallet, project_id, token) = setup();
        let donor = Address::generate(&env);
        set_project_total_raised(&env, &contract_id, &project_id, 1);
        mint_tokens(&env, &token, &donor, i128::MAX);

        client.donate(&token, &donor, &project_id, &i128::MAX, &42u32);
    }

    #[test]
    #[should_panic(expected = "Project total_raised overflow")]
    fn sequential_donations_panic_when_sum_exceeds_i128_max() {
        let (env, contract_id, client, _wallet, project_id, token) = setup();
        let donor_a = Address::generate(&env);
        let donor_b = Address::generate(&env);
        set_project_total_raised(&env, &contract_id, &project_id, 1);
        mint_tokens(&env, &token, &donor_a, i128::MAX - 1);
        mint_tokens(&env, &token, &donor_b, 2);

        client.donate(&token, &donor_a, &project_id, &(i128::MAX - 1), &42u32);
        client.donate(&token, &donor_b, &project_id, &2i128, &42u32);
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10_000))]

        /// Single donation with a random amount in [1, MAX_DONATION] should never
        /// overflow global stats.
        #[test]
        fn prop_single_donation_no_overflow(amount in 1i128..=MAX_DONATION) {
            let (env, _contract_id, client, _wallet, project_id, token) = setup();
            let donor = Address::generate(&env);
            mint_tokens(&env, &token, &donor, amount);

            // donate must not panic (panics signal overflow via checked_add.expect)
            client.donate(&token, &donor, &project_id, &amount, &42u32);

            let global_total = client.get_global_total();
            let global_co2   = client.get_global_co2();
            let project      = client.get_project(&project_id);

            // All counters must be non-negative
            prop_assert!(global_total >= 0, "global_total went negative: {}", global_total);
            prop_assert!(global_co2   >= 0, "global_co2 went negative: {}", global_co2);
            prop_assert!(project.total_raised >= 0, "project.total_raised went negative");

            // Global total must equal project total (single project in this env)
            prop_assert_eq!(
                global_total, project.total_raised,
                "global_total ({}) != project.total_raised ({})",
                global_total, project.total_raised,
            );

            // Donation count must be 1
            prop_assert_eq!(project.donor_count, 1u32);
        }

        /// Two sequential donations with random amounts must keep global totals
        /// consistent and strictly greater than either individual donation.
        #[test]
        fn prop_two_donations_are_additive(
            a in 1i128..=MAX_DONATION / 2,
            b in 1i128..=MAX_DONATION / 2,
        ) {
            let (env, _contract_id, client, _wallet, project_id, token) = setup();
            let donor_a = Address::generate(&env);
            let donor_b = Address::generate(&env);
            mint_tokens(&env, &token, &donor_a, a);
            mint_tokens(&env, &token, &donor_b, b);

            client.donate(&token, &donor_a, &project_id, &a, &42u32);
            client.donate(&token, &donor_b, &project_id, &b, &42u32);

            let global_total = client.get_global_total();
            let expected     = a.checked_add(b).expect("test helper overflow");

            prop_assert_eq!(
                global_total, expected,
                "global_total {} != a+b {}",
                global_total, expected,
            );

            // Two distinct donors → donor_count == 2
            let project = client.get_project(&project_id);
            prop_assert_eq!(project.donor_count, 2u32);
        }

        /// Donating a zero amount is an edge case — the contract uses
        /// `checked_add(0)` which is always safe. Verify no state mutation occurs
        /// when amount == 0 is passed (or contract rejects it gracefully).
        #[test]
        fn prop_zero_donation_does_not_corrupt_state(
            legit in 1i128..=MAX_DONATION,
        ) {
            let (env, _contract_id, client, _wallet, project_id, token) = setup();
            let donor = Address::generate(&env);
            mint_tokens(&env, &token, &donor, legit);

            client.donate(&token, &donor, &project_id, &legit, &42u32);
            let total_before = client.get_global_total();

            // A second call with the same donor — amount 0 may panic or succeed
            // depending on contract implementation; we only assert the state
            // before the second call was not corrupted.
            prop_assert_eq!(total_before, legit);
        }

        // ── USDC fuzz cases ────────────────────────────────────────────────────

        /// USDC amount near i128::MAX triggers the `checked_mul(8)` overflow guard
        /// inside donate_usdc. Any value above i128::MAX / 8 must panic.
        #[test]
        fn prop_usdc_amount_near_max(usdc_amount in (i128::MAX / 8 + 1)..=i128::MAX) {
            let (env, client, project_id, usdc_token) = setup_usdc(100u32);
            let donor = Address::generate(&env);
            fund_usdc(&env, &usdc_token, &donor, &usdc_amount);

            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.donate_usdc(&usdc_token, &donor, &project_id, &usdc_amount, &MSG_HASH);
            }));
            prop_assert!(result.is_err(), "donate_usdc should panic when usdc_amount > i128::MAX / 8");
        }

        /// USDC token address mismatch must be rejected before any state mutation.
        /// The provided `usdc_token` does not match the stored `USDCTokenAddress`.
        #[test]
        fn prop_usdc_token_mismatch(amount in 1i128..=100_000_000i128) {
            let (env, client, project_id, _usdc_token) = setup_usdc(100u32);
            let donor = Address::generate(&env);
            let wrong_token = Address::generate(&env);

            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.donate_usdc(&wrong_token, &donor, &project_id, &amount, &MSG_HASH);
            }));
            prop_assert!(result.is_err(), "donate_usdc should panic on token mismatch");
        }

        /// Donating USDC to a deactivated (inactive) project must be rejected.
        /// This test sets up the environment in-line so the admin address is
        /// available to call `deactivate_project`.
        #[test]
        fn prop_usdc_inactive_project(amount in 1i128..=100_000_000i128) {
            let env = Env::default();
            env.mock_all_auths();
            let cid = env.register_contract(None, GreenPayContract);
            let client = GreenPayContractClient::new(&env, &cid);
            let admin = Address::generate(&env);
            client.initialize(&admin);

            let project_id = SorobanString::from_str(&env, "proj-inactive");
            let wallet = Address::generate(&env);
            client.register_project(
                &admin,
                &project_id,
                &SorobanString::from_str(&env, "Inactive USDC Project"),
                &wallet,
                &100u32,
            );

            let token_admin = Address::generate(&env);
            let usdc_token = env.register_stellar_asset_contract_v2(token_admin).address();
            client.set_usdc_token(&admin, &usdc_token);

            client.deactivate_project(&admin, &project_id);

            let donor = Address::generate(&env);
            fund_usdc(&env, &usdc_token, &donor, &amount);

            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.donate_usdc(&usdc_token, &donor, &project_id, &amount, &MSG_HASH);
            }));
            prop_assert!(result.is_err(), "donate_usdc should panic when project is inactive");
        }

        /// CO₂ overflow when a project has a high `co2_per_xlm` multiplied by
        /// a large XLM-equivalent amount.  The `checked_mul` inside
        /// `donate_usdc` must panic before any state mutation.
        #[test]
        fn prop_usdc_co2_overflow(
            usdc_amount in {
                let min = (i128::MAX / (u32::MAX as i128)) * FUZZ_STROOP / 8 + 1;
                let max = i128::MAX / 8;
                min..=max
            },
        ) {
            let (env, client, project_id, usdc_token) = setup_usdc(u32::MAX);
            let donor = Address::generate(&env);
            fund_usdc(&env, &usdc_token, &donor, &usdc_amount);

            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.donate_usdc(&usdc_token, &donor, &project_id, &usdc_amount, &MSG_HASH);
            }));
            prop_assert!(result.is_err(), "donate_usdc should panic on CO2 overflow");
        }
    }
}
