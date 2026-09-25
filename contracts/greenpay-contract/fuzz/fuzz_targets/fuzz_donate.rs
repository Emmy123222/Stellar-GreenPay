#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    testutils::Address as _,
    Address, Env, String as SorobanString,
};
use greenpay_contract::{GreenPayContract, GreenPayContractClient};

fuzz_target!(|data: &[u8]| {
    if data.len() < 8 {
        return;
    }

    // First 8 bytes define the u64 amount
    let amount_bytes: [u8; 8] = data[0..8].try_into().unwrap();
    let amount = u64::from_le_bytes(amount_bytes);

    // Remaining bytes define the project_id string
    let project_id_str = match std::str::from_utf8(&data[8..]) {
        Ok(s) => s,
        Err(_) => return,
    };

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, GreenPayContract);
    let client = GreenPayContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let valid_proj = SorobanString::from_str(&env, "proj-1");
    let wallet = Address::generate(&env);
    client.register_project(
        &admin,
        &valid_proj,
        &SorobanString::from_str(&env, "Project 1"),
        &wallet,
        &100u32,
        &1i128,
    );

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let donor = Address::generate(&env);

    // Also attempt registering the fuzzed project_id if it's non-empty and valid
    if !project_id_str.is_empty() {
        let fuzzed_id = SorobanString::from_str(&env, project_id_str);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.register_project(
                &admin,
                &fuzzed_id,
                &SorobanString::from_str(&env, "Fuzzed Project"),
                &wallet,
                &100u32,
                &1i128,
            );
        }));
    }

    let target_proj_id = SorobanString::from_str(&env, project_id_str);

    // Execute donate() call with fuzzed input parameters.
    // Business logic errors (e.g., amount == 0, project not found, below minimum)
    // trigger contract panics that are caught; arithmetic overflows or unexpected
    // fatal panics will bubble up and surface as fuzzer failures.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.donate(
            &token,
            &donor,
            &target_proj_id,
            &(amount as i128),
            &0u32,
        );
    }));
});
