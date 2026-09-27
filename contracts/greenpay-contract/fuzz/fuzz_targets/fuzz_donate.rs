#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig},
    Address, Env, String as SorobanString,
};
use greenpay_contract::{GreenPayContract, GreenPayContractClient};

fuzz_target!(|data: &[u8]| {
    let (amount, project_id) = if data.len() >= 8 {
        let amt_bytes: [u8; 8] = data[0..8].try_into().unwrap();
        let amount = u64::from_le_bytes(amt_bytes);
        let project_id = match core::str::from_utf8(&data[8..]) {
            Ok(s) => s.to_string(),
            Err(_) => String::from_utf8_lossy(&data[8..]).into_owned(),
        };
        (amount, project_id)
    } else {
        let amount = 0u64;
        let project_id = String::from_utf8_lossy(data).into_owned();
        (amount, project_id)
    };

    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();

    let contract_id = env.register(GreenPayContract, ());
    let client = GreenPayContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let _ = client.try_initialize(&admin);

    let registered_project_id = SorobanString::from_str(&env, "proj-1");
    let wallet = Address::generate(&env);
    let _ = client.try_register_project(
        &admin,
        &registered_project_id,
        &SorobanString::from_str(&env, "Project One"),
        &wallet,
        &100u32,
        &10_000_000i128,
    );

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let donor = Address::generate(&env);

    // 1. Test donate() call with random project_id and random amount
    if let Ok(pid) = SorobanString::from_str(&env, &project_id) {
        let _ = client.try_donate(&token, &donor, &pid, &(amount as i128), &0u32);
    }

    // 2. Test donate() call with existing valid project_id and random amount
    let _ = client.try_donate(&token, &donor, &registered_project_id, &(amount as i128), &0u32);
});
