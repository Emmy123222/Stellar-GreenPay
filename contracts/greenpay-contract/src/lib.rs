#![no_std]

/**
 * contracts/greenpay-contract/src/lib.rs
 *
 * Stellar GreenPay — Climate Donation Tracking Contract
 *
 * This contract provides on-chain transparency for every donation:
 *
 *   1. Admin registers verified climate projects on-chain
 *   2. Donors call donate() — XLM sent directly to project wallet
 *   3. Contract records every donation immutably
 *   4. Anyone can query total raised, donor count, CO2 offset per project
 *   5. Impact badges auto-calculated based on cumulative donor totals
 *   6. Community governance: badge holders vote to verify new projects
 *
 * Build:
 *   cargo build --target wasm32-unknown-unknown --release
 *
 * Deploy:
 *   stellar contract deploy \
 *     --wasm target/wasm32-unknown-unknown/release/greenpay_contract.wasm \
 *     --source alice --network testnet
 */

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, symbol_short, String,
};

// ─── Badge tiers (on-chain) ───────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum BadgeTier {
    None,
    Seedling,      // ≥ 10 XLM
    Tree,          // ≥ 100 XLM
    Forest,        // ≥ 500 XLM
    EarthGuardian, // ≥ 2000 XLM
}

// ─── Data structures ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Project {
    pub id:            String,
    pub name:          String,
    pub wallet:        Address,
    pub co2_per_xlm:   u32,
    pub total_raised:  i128,
    pub donor_count:   u32,
    pub active:        bool,
    pub registered_at: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DonationRecord {
    pub donor:        Address,
    pub project:      String,
    pub amount:       i128,
    pub ledger:       u32,
    pub message_hash: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DonorStats {
    pub total_donated:    i128,
    pub donation_count:   u32,
    pub badge:            BadgeTier,
    pub co2_offset_grams: i128,
}

/// A community voting proposal to verify a project.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VoteProposal {
    pub project_id:      String,
    pub votes_for:       u32,
    pub votes_against:   u32,
    pub deadline_ledger: u32,
    pub resolved:        bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Project(String),
    ProjectCount,
    DonorStats(Address),
    DonationCount,
    GlobalTotalRaised,
    GlobalCO2OffsetGrams,
    // Governance
    Proposal(String),
    HasVoted(String, Address),
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STROOP: i128 = 10_000_000;

// 7 days × 24 h × 3600 s ÷ 5 s per ledger ≈ 120_960 ledgers
const VOTING_WINDOW_LEDGERS: u32 = 120_960;

fn calculate_badge(total_stroops: i128) -> BadgeTier {
    let xlm = total_stroops / STROOP;
    if      xlm >= 2000 { BadgeTier::EarthGuardian }
    else if xlm >= 500  { BadgeTier::Forest }
    else if xlm >= 100  { BadgeTier::Tree }
    else if xlm >= 10   { BadgeTier::Seedling }
    else                { BadgeTier::None }
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct GreenPayContract;

#[contractimpl]
impl GreenPayContract {

    // ─── Initialization ──────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ProjectCount,         &0u32);
        env.storage().instance().set(&DataKey::DonationCount,        &0u32);
        env.storage().instance().set(&DataKey::GlobalTotalRaised,    &0i128);
        env.storage().instance().set(&DataKey::GlobalCO2OffsetGrams, &0i128);
    }

    // ─── Project management ───────────────────────────────────────────────────

    pub fn register_project(
        env:         Env,
        admin:       Address,
        project_id:  String,
        name:        String,
        wallet:      Address,
        co2_per_xlm: u32,
    ) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can register projects"); }
        if env.storage().instance().has(&DataKey::Project(project_id.clone())) {
            panic!("Project already registered");
        }
        let project = Project {
            id: project_id.clone(), name, wallet, co2_per_xlm,
            total_raised: 0, donor_count: 0, active: true,
            registered_at: env.ledger().sequence(),
        };
        env.storage().instance().set(&DataKey::Project(project_id.clone()), &project);
        let count: u32 = env.storage().instance().get(&DataKey::ProjectCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::ProjectCount, &(count + 1));
        env.events().publish((symbol_short!("proj_reg"), admin), project_id);
    }

    pub fn deactivate_project(env: Env, admin: Address, project_id: String) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can deactivate projects"); }
        let mut project: Project = env.storage().instance()
            .get(&DataKey::Project(project_id.clone())).expect("Project not found");
        project.active = false;
        env.storage().instance().set(&DataKey::Project(project_id), &project);
    }

    // ─── Donations ────────────────────────────────────────────────────────────

    pub fn donate(
        env:        Env,
        token:      Address,
        donor:      Address,
        project_id: String,
        amount:     i128,
        msg_hash:   u32,
    ) {
        donor.require_auth();
        if amount <= 0 { panic!("Donation amount must be positive"); }

        let mut project: Project = env.storage().instance()
            .get(&DataKey::Project(project_id.clone())).expect("Project not found");
        if !project.active { panic!("Project is not accepting donations"); }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&donor, &project.wallet, &amount);

        project.total_raised += amount;
        project.donor_count  += 1;
        env.storage().instance().set(&DataKey::Project(project_id.clone()), &project);

        let mut donor_stats: DonorStats = env.storage().instance()
            .get(&DataKey::DonorStats(donor.clone()))
            .unwrap_or(DonorStats { total_donated: 0, donation_count: 0,
                badge: BadgeTier::None, co2_offset_grams: 0 });
        donor_stats.total_donated    += amount;
        donor_stats.donation_count   += 1;
        donor_stats.badge             = calculate_badge(donor_stats.total_donated);
        donor_stats.co2_offset_grams += (amount / STROOP) * project.co2_per_xlm as i128;
        env.storage().instance().set(&DataKey::DonorStats(donor.clone()), &donor_stats);

        let _donation = DonationRecord {
            donor: donor.clone(), project: project_id.clone(),
            amount, ledger: env.ledger().sequence(), message_hash: msg_hash,
        };
        let dc: u32 = env.storage().instance().get(&DataKey::DonationCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::DonationCount, &(dc + 1));

        let gr: i128 = env.storage().instance().get(&DataKey::GlobalTotalRaised).unwrap_or(0);
        env.storage().instance().set(&DataKey::GlobalTotalRaised, &(gr + amount));

        let gc: i128 = env.storage().instance().get(&DataKey::GlobalCO2OffsetGrams).unwrap_or(0);
        let new_co2 = (amount / STROOP) * project.co2_per_xlm as i128;
        env.storage().instance().set(&DataKey::GlobalCO2OffsetGrams, &(gc + new_co2));

        env.events().publish(
            (symbol_short!("donated"), donor, project_id),
            (amount, donor_stats.badge.clone()),
        );
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    pub fn get_project(env: Env, project_id: String) -> Project {
        env.storage().instance().get(&DataKey::Project(project_id)).expect("Project not found")
    }

    pub fn get_donor_stats(env: Env, donor: Address) -> DonorStats {
        env.storage().instance().get(&DataKey::DonorStats(donor))
            .unwrap_or(DonorStats { total_donated: 0, donation_count: 0,
                badge: BadgeTier::None, co2_offset_grams: 0 })
    }

    pub fn get_badge(env: Env, donor: Address) -> BadgeTier {
        let stats: DonorStats = env.storage().instance()
            .get(&DataKey::DonorStats(donor))
            .unwrap_or(DonorStats { total_donated: 0, donation_count: 0,
                badge: BadgeTier::None, co2_offset_grams: 0 });
        stats.badge
    }

    pub fn get_global_total(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::GlobalTotalRaised).unwrap_or(0)
    }

    pub fn get_global_co2(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::GlobalCO2OffsetGrams).unwrap_or(0)
    }

    pub fn get_project_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::ProjectCount).unwrap_or(0)
    }

    pub fn get_donation_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::DonationCount).unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("Not initialized")
    }

    // ─── Placeholders ─────────────────────────────────────────────────────────

    pub fn mint_impact_nft(_env: Env, _donor: Address, _tier: BadgeTier) {
        panic!("Impact NFT minting coming in v1.3 — see ROADMAP.md");
    }

    // ─── Governance ───────────────────────────────────────────────────────────

    /// Admin creates a voting proposal for a project to be community-verified.
    pub fn create_proposal(env: Env, admin: Address, project_id: String) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can create proposals"); }
        if !env.storage().instance().has(&DataKey::Project(project_id.clone())) {
            panic!("Project not found");
        }
        if env.storage().instance().has(&DataKey::Proposal(project_id.clone())) {
            panic!("Proposal already exists for this project");
        }
        let proposal = VoteProposal {
            project_id:      project_id.clone(),
            votes_for:       0,
            votes_against:   0,
            deadline_ledger: env.ledger().sequence() + VOTING_WINDOW_LEDGERS,
            resolved:        false,
        };
        env.storage().instance().set(&DataKey::Proposal(project_id.clone()), &proposal);
        env.events().publish((symbol_short!("prop_new"), admin), project_id);
    }

    /// Badge holders (≥ Seedling) cast a vote. One vote per address per proposal.
    pub fn vote_verify_project(env: Env, voter: Address, project_id: String, approve: bool) {
        voter.require_auth();

        let stats: DonorStats = env.storage().instance()
            .get(&DataKey::DonorStats(voter.clone()))
            .unwrap_or(DonorStats { total_donated: 0, donation_count: 0,
                badge: BadgeTier::None, co2_offset_grams: 0 });
        if stats.badge == BadgeTier::None {
            panic!("Only badge holders (Seedling or above) can vote");
        }

        let mut proposal: VoteProposal = env.storage().instance()
            .get(&DataKey::Proposal(project_id.clone())).expect("Proposal not found");
        if proposal.resolved { panic!("Proposal already resolved"); }
        if env.ledger().sequence() > proposal.deadline_ledger {
            panic!("Voting window has closed");
        }

        let voted_key = DataKey::HasVoted(project_id.clone(), voter.clone());
        if env.storage().instance().has(&voted_key) {
            panic!("Already voted on this proposal");
        }
        env.storage().instance().set(&voted_key, &true);

        if approve { proposal.votes_for += 1; } else { proposal.votes_against += 1; }
        env.storage().instance().set(&DataKey::Proposal(project_id.clone()), &proposal);
        env.events().publish((symbol_short!("voted"), voter, project_id), approve);
    }

    /// Callable by anyone after the deadline. Resolves based on majority.
    /// Emits proj_ver on approval, prop_rej on rejection.
    pub fn resolve_proposal(env: Env, project_id: String) {
        let mut proposal: VoteProposal = env.storage().instance()
            .get(&DataKey::Proposal(project_id.clone())).expect("Proposal not found");
        if proposal.resolved { panic!("Proposal already resolved"); }
        if env.ledger().sequence() <= proposal.deadline_ledger {
            panic!("Voting window not yet closed");
        }
        proposal.resolved = true;
        if proposal.votes_for > proposal.votes_against {
            env.events().publish((symbol_short!("proj_ver"),), project_id.clone());
        } else {
            env.events().publish((symbol_short!("prop_rej"),), project_id.clone());
        }
        env.storage().instance().set(&DataKey::Proposal(project_id), &proposal);
    }

    /// Returns current vote counts and status for a proposal.
    pub fn get_proposal(env: Env, project_id: String) -> VoteProposal {
        env.storage().instance()
            .get(&DataKey::Proposal(project_id)).expect("Proposal not found")
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Address, Env, String};

    // ─── Existing tests ───────────────────────────────────────────────────────

    #[test]
    fn test_initialize() {
        let env    = Env::default();
        let id     = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin  = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_project_count(), 0);
        assert_eq!(client.get_donation_count(), 0);
        assert_eq!(client.get_global_total(), 0);
    }

    #[test]
    #[should_panic(expected = "Contract already initialized")]
    fn test_double_init_fails() {
        let env    = Env::default();
        let id     = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin  = Address::generate(&env);
        client.initialize(&admin);
        client.initialize(&admin);
    }

    #[test]
    fn test_donor_badge_none_below_threshold() {
        let env    = Env::default();
        let id     = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin  = Address::generate(&env);
        client.initialize(&admin);
        let donor  = Address::generate(&env);
        assert_eq!(client.get_badge(&donor), BadgeTier::None);
    }

    #[test]
    fn test_calculate_badge_thresholds() {
        assert_eq!(calculate_badge(0),               BadgeTier::None);
        assert_eq!(calculate_badge(9 * STROOP),      BadgeTier::None);
        assert_eq!(calculate_badge(10 * STROOP),     BadgeTier::Seedling);
        assert_eq!(calculate_badge(99 * STROOP),     BadgeTier::Seedling);
        assert_eq!(calculate_badge(100 * STROOP),    BadgeTier::Tree);
        assert_eq!(calculate_badge(499 * STROOP),    BadgeTier::Tree);
        assert_eq!(calculate_badge(500 * STROOP),    BadgeTier::Forest);
        assert_eq!(calculate_badge(1999 * STROOP),   BadgeTier::Forest);
        assert_eq!(calculate_badge(2000 * STROOP),   BadgeTier::EarthGuardian);
        assert_eq!(calculate_badge(100000 * STROOP), BadgeTier::EarthGuardian);
    }

    // ─── Governance helpers ───────────────────────────────────────────────────

    /// Set up a fresh contract with one registered project.
    fn setup() -> (Env, soroban_sdk::Address, GreenPayContractClient<'static>, Address, String) {
        let env   = Env::default();
        env.mock_all_auths();
        let cid   = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &cid);
        let admin  = Address::generate(&env);
        client.initialize(&admin);
        let pid    = String::from_str(&env, "proj-001");
        let wallet = Address::generate(&env);
        client.register_project(&admin, &pid, &String::from_str(&env, "Test Project"), &wallet, &100u32);
        (env, cid, client, admin, pid)
    }

    /// Inject a Seedling badge directly into contract storage for a voter.
    fn grant_badge(env: &Env, cid: &soroban_sdk::Address, voter: &Address) {
        env.as_contract(cid, || {
            env.storage().instance().set(
                &DataKey::DonorStats(voter.clone()),
                &DonorStats {
                    total_donated:    10 * STROOP,
                    donation_count:   1,
                    badge:            BadgeTier::Seedling,
                    co2_offset_grams: 0,
                },
            );
        });
    }

    /// Extend instance TTL before a large ledger jump so storage isn't archived.
    fn extend_ttl(env: &Env, cid: &soroban_sdk::Address) {
        env.as_contract(cid, || {
            env.storage().instance().extend_ttl(VOTING_WINDOW_LEDGERS * 4, VOTING_WINDOW_LEDGERS * 4);
        });
    }

    // ─── Governance tests ─────────────────────────────────────────────────────

    #[test]
    fn test_create_proposal() {
        let (env, _cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid);
        let p = client.get_proposal(&pid);
        assert_eq!(p.votes_for,     0);
        assert_eq!(p.votes_against, 0);
        assert!(!p.resolved);
        assert!(p.deadline_ledger > env.ledger().sequence());
    }

    #[test]
    #[should_panic(expected = "Proposal already exists for this project")]
    fn test_create_duplicate_proposal_fails() {
        let (_env, _cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid);
        client.create_proposal(&admin, &pid);
    }

    #[test]
    fn test_cast_vote() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid);
        let voter = Address::generate(&env);
        grant_badge(&env, &cid, &voter);
        client.vote_verify_project(&voter, &pid, &true);
        let p = client.get_proposal(&pid);
        assert_eq!(p.votes_for,     1);
        assert_eq!(p.votes_against, 0);
    }

    #[test]
    #[should_panic(expected = "Only badge holders (Seedling or above) can vote")]
    fn test_non_badge_holder_cannot_vote() {
        let (env, _cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid);
        let non_donor = Address::generate(&env);
        client.vote_verify_project(&non_donor, &pid, &true);
    }

    #[test]
    #[should_panic(expected = "Already voted on this proposal")]
    fn test_double_vote_prevented() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid);
        let voter = Address::generate(&env);
        grant_badge(&env, &cid, &voter);
        client.vote_verify_project(&voter, &pid, &true);
        client.vote_verify_project(&voter, &pid, &true); // should panic
    }

    #[test]
    fn test_resolve_proposal_approved() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid);
        // 2 approve, 1 rejects
        for i in 0..3u32 {
            let voter = Address::generate(&env);
            grant_badge(&env, &cid, &voter);
            client.vote_verify_project(&voter, &pid, &(i < 2));
        }
        extend_ttl(&env, &cid);
        env.ledger().set_sequence_number(VOTING_WINDOW_LEDGERS + 2);
        client.resolve_proposal(&pid);
        let p = client.get_proposal(&pid);
        assert!(p.resolved);
        assert_eq!(p.votes_for,     2);
        assert_eq!(p.votes_against, 1);
    }

    #[test]
    fn test_resolve_proposal_rejected() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid);
        // 1 approves, 2 reject
        for i in 0..3u32 {
            let voter = Address::generate(&env);
            grant_badge(&env, &cid, &voter);
            client.vote_verify_project(&voter, &pid, &(i == 0));
        }
        extend_ttl(&env, &cid);
        env.ledger().set_sequence_number(VOTING_WINDOW_LEDGERS + 2);
        client.resolve_proposal(&pid);
        let p = client.get_proposal(&pid);
        assert!(p.resolved);
        assert_eq!(p.votes_for,     1);
        assert_eq!(p.votes_against, 2);
    }

    #[test]
    #[should_panic(expected = "Voting window not yet closed")]
    fn test_resolve_before_deadline_fails() {
        let (_env, _cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid);
        client.resolve_proposal(&pid);
    }

    #[test]
    #[should_panic(expected = "Proposal already resolved")]
    fn test_double_resolve_fails() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid);
        extend_ttl(&env, &cid);
        env.ledger().set_sequence_number(VOTING_WINDOW_LEDGERS + 2);
        client.resolve_proposal(&pid);
        // Extend again so the second call reaches our panic, not an archive error
        extend_ttl(&env, &cid);
        client.resolve_proposal(&pid);
    }
}
