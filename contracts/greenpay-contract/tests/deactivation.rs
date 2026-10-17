#![cfg(feature = "testutils")]

use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig}, Address, Env, String, Vec,
};
use greenpay_contract::{
    ContractError, DataKey, GreenPayContract, GreenPayContractClient,
    MAX_DEACTIVATION_BATCH,
};

fn setup_projects(
    count: u32,
) -> (Env, GreenPayContractClient<'static>, Address, Address) {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();
    let contract_id = env.register_contract(None, GreenPayContract);
    let client = GreenPayContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    for index in 0..count {
        let project_id = String::from_str(&env, &format!("project-{index}"));
        client.register_project(
            &admin,
            &project_id,
            &String::from_str(&env, "Benchmark project"),
            &Address::generate(&env),
            &100u32,
            &1i128,
        );
    }

    (env, client, admin, contract_id)
}

#[test]
fn deactivate_projects_range_handles_bounds_and_repeats() {
    let (env, client, admin, _) = setup_projects(2);
    let first = String::from_str(&env, "project-0");
    let second = String::from_str(&env, "project-1");

    assert_eq!(client.deactivate_projects_range(&admin, &0, &1), 1);
    assert!(!client.get_project(&first).active);
    assert!(client.get_project(&second).active);
    assert_eq!(
        client.deactivate_projects_range(&admin, &1, &MAX_DEACTIVATION_BATCH),
        1,
    );
    assert_eq!(
        client.deactivate_projects_range(&admin, &0, &MAX_DEACTIVATION_BATCH),
        0,
    );
    assert_eq!(client.deactivate_projects_range(&admin, &u32::MAX, &1), 0);
    assert_eq!(
        client.try_deactivate_projects_range(&admin, &0, &(MAX_DEACTIVATION_BATCH + 1)),
        Err(Ok(ContractError::InvalidPageSize)),
    );
}

#[test]
fn range_reads_project_ids_from_legacy_vector_storage() {
    let (env, client, admin, contract_id) = setup_projects(2);
    let ids = Vec::from_array(
        &env,
        [
            String::from_str(&env, "project-0"),
            String::from_str(&env, "project-1"),
        ],
    );
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::ProjectIds, &ids);
        env.storage().instance().remove(&DataKey::ProjectId(0));
        env.storage().instance().remove(&DataKey::ProjectId(1));
    });

    assert_eq!(client.get_all_projects_paginated(&0, &10).len(), 2);
    assert_eq!(
        client.deactivate_projects_range(&admin, &0, &MAX_DEACTIVATION_BATCH),
        2,
    );
}

#[test]
fn benchmark_deactivate_projects_range_at_growing_registry_sizes() {
    for project_count in [10u32, 100, 500] {
        let (env, client, admin, _) = setup_projects(project_count);
        if project_count > MAX_DEACTIVATION_BATCH {
            assert!(client.try_deactivate_all_projects(&admin).is_err());
        }
        let mut total_cpu = 0u64;
        let mut total_memory = 0u64;
        let mut max_cpu = 0u64;
        let mut max_memory = 0u64;
        let mut transactions = 0u32;
        let mut offset = 0u32;

        while offset < project_count {
            let expected = (project_count - offset).min(MAX_DEACTIVATION_BATCH);
            env.budget().reset_default();
            assert_eq!(
                client.deactivate_projects_range(&admin, &offset, &MAX_DEACTIVATION_BATCH),
                expected,
            );
            let cpu = env.budget().cpu_instruction_cost();
            let memory = env.budget().memory_bytes_cost();
            total_cpu += cpu;
            total_memory += memory;
            max_cpu = max_cpu.max(cpu);
            max_memory = max_memory.max(memory);
            transactions += 1;
            offset += expected;
        }

        println!(
            "projects={project_count} transactions={transactions} total_cpu={total_cpu} max_tx_cpu={max_cpu} total_memory={total_memory} max_tx_memory={max_memory}"
        );
    }
}