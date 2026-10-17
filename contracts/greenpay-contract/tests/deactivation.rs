#![cfg(feature = "testutils")]

//! Bounded emergency deactivation tests.
//!
//! The contract stores every project (and the `ProjectIds` index vector) in its
//! single instance storage entry. The Soroban host caps that entry at 64 KiB,
//! so the registry can only grow to roughly `MAX_SAFE_REGISTRY_SIZE` projects
//! before `register_project` itself fails. These tests pin the chunked
//! deactivation API and record the measured resource costs used to pick
//! `MAX_DEACTIVATION_BATCH`. See `contracts/README.md` for the recorded
//! benchmark table.

use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig},
    Address, Env, String, Vec,
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
    assert_eq!(client.deactivate_projects_range(&admin, &0, &0), 0);
    assert_eq!(
        client.try_deactivate_projects_range(&admin, &0, &(MAX_DEACTIVATION_BATCH + 1)),
        Err(Ok(ContractError::InvalidPageSize)),
    );
}

#[test]
fn deactivate_all_projects_handles_a_single_batch() {
    let (env, client, admin, _) = setup_projects(MAX_DEACTIVATION_BATCH);
    client.deactivate_all_projects(&admin);
    for index in 0..MAX_DEACTIVATION_BATCH {
        let pid = String::from_str(&env, &format!("project-{index}"));
        assert!(!client.get_project(&pid).active);
    }
}

#[test]
fn deactivate_all_projects_rejects_registries_larger_than_one_batch() {
    let (env, client, admin, _) = setup_projects(MAX_DEACTIVATION_BATCH + 1);

    // The single-invocation entry point refuses to run once the registry would
    // exceed one batch, forcing callers onto the chunked range API.
    assert!(client.try_deactivate_all_projects(&admin).is_err());

    // Every project is still active because the call was rejected up front.
    let pid = String::from_str(&env, "project-0");
    assert!(client.get_project(&pid).active);

    // Walking the registry in batches succeeds.
    let mut offset = 0u32;
    let mut deactivated = 0u32;
    loop {
        let n = client.deactivate_projects_range(
            &admin,
            &offset,
            &MAX_DEACTIVATION_BATCH,
        );
        if n == 0 {
            break;
        }
        deactivated += n;
        offset += n;
    }
    assert_eq!(deactivated, MAX_DEACTIVATION_BATCH + 1);
}

/// Records the CPU/memory cost of the chunked emergency stop at growing
/// registry sizes. Values are printed and must be transcribed into the
/// benchmark table in `contracts/README.md`.
///
/// 500 projects is intentionally excluded: the contract instance entry exceeds
/// the 64 KiB host limit during registration well before that, so no registry
/// of that size can exist. See `registry_fails_before_500_projects`.
#[test]
fn benchmark_deactivate_projects_range_at_growing_registry_sizes() {
    for project_count in [10u32, 100] {
        let (env, client, admin, _) = setup_projects(project_count);

        let mut total_cpu = 0u64;
        let mut total_memory = 0u64;
        let mut max_cpu = 0u64;
        let mut max_memory = 0u64;
        let mut transactions = 0u32;
        let mut offset = 0u32;

        while offset < project_count {
            let expected = (project_count - offset).min(MAX_DEACTIVATION_BATCH);
            env.cost_estimate().budget().reset_default();
            assert_eq!(
                client.deactivate_projects_range(&admin, &offset, &MAX_DEACTIVATION_BATCH),
                expected,
            );
            let cpu = env.cost_estimate().budget().cpu_instruction_cost();
            let memory = env.cost_estimate().budget().memory_bytes_cost();
            total_cpu += cpu;
            total_memory += memory;
            max_cpu = max_cpu.max(cpu);
            max_memory = max_memory.max(memory);
            transactions += 1;
            offset += expected;
        }

        println!(
            "projects={project_count} transactions={transactions} \
             total_cpu={total_cpu} max_tx_cpu={max_cpu} \
             total_memory={total_memory} max_tx_memory={max_memory}"
        );
    }
}

/// Documents the hard ceiling discovered while benchmarking: projects live in
/// the 64 KiB instance entry, so a registry cannot reach 500.
///
/// The abort is a host `Error(Budget, ExceededLimit)` raised while registering
/// the 151st project (instance entry `size: 65804 > 65536`); with the longer
/// full project name used by `setup_projects` the ceiling is closer to 145.
/// This is a host-level budget error rather than a catchable contract error,
/// so the test asserts the panic directly.
#[test]
#[should_panic]
fn registry_cannot_reach_500_projects() {
    setup_projects(500);
}

/// Keeps the legacy `ProjectIds` layout readable after the storage helper
/// refactor was intentionally avoided; the vector remains the single source of
/// truth for enumeration.
#[test]
fn project_ids_vector_drives_pagination_and_deactivation() {
    let (env, client, admin, contract_id) = setup_projects(3);
    let ids = Vec::from_array(
        &env,
        [
            String::from_str(&env, "project-0"),
            String::from_str(&env, "project-1"),
            String::from_str(&env, "project-2"),
        ],
    );
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::ProjectIds, &ids);
    });

    assert_eq!(client.get_all_projects_paginated(&0, &10).len(), 3);
    assert_eq!(
        client.deactivate_projects_range(&admin, &0, &MAX_DEACTIVATION_BATCH),
        3,
    );
}
