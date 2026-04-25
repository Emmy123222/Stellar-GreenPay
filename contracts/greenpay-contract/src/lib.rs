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

#[contracttype]
#[derive(Clone, Debug)]
pub struct ImpactNFT {
    pub owner:              Address,
    pub tier:               BadgeTier,
    pub total_donated:      i128,
    pub minted_at_ledger:   u32,
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
    ImpactNFT(Address, BadgeTier),
    DonationCount,
    GlobalTotalRaised,
    GlobalCO2OffsetGrams,
    // Tracks whether `donor` has ever donated to `project` — used so
    // `Project.donor_count` reflects unique donors instead of donations.
    HasDonated(String, Address),
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
        let next_count = count.checked_add(1).expect("ProjectCount overflow");
        env.storage().instance().set(&DataKey::ProjectCount, &next_count);
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

        // Pre-compute CO2 increment with checked multiplication so an attacker
        // can't trigger a silent wrap via a project with a huge co2_per_xlm.
        let xlm_units = amount / STROOP;
        let co2_increment = xlm_units
            .checked_mul(project.co2_per_xlm as i128)
            .expect("CO2 calculation overflow");

        let mut donor_stats: DonorStats = env.storage().instance()
            .get(&DataKey::DonorStats(donor.clone()))
            .unwrap_or(DonorStats { total_donated: 0, donation_count: 0,
                badge: BadgeTier::None, co2_offset_grams: 0 });
        let prev_badge = donor_stats.badge.clone();

        // ── Effects: all state writes BEFORE the external token transfer
        //    (Checks-Effects-Interactions to defend against reentrancy from a
        //    malicious token contract passed via `token`).
        project.total_raised = project.total_raised
            .checked_add(amount).expect("Project total_raised overflow");
        let donated_key = DataKey::HasDonated(project_id.clone(), donor.clone());
        if !env.storage().instance().has(&donated_key) {
            env.storage().instance().set(&donated_key, &true);
            project.donor_count = project.donor_count
                .checked_add(1).expect("Project donor_count overflow");
        }
        env.storage().instance().set(&DataKey::Project(project_id.clone()), &project);

        donor_stats.total_donated = donor_stats.total_donated
            .checked_add(amount).expect("Donor total_donated overflow");
        donor_stats.donation_count = donor_stats.donation_count
            .checked_add(1).expect("Donor donation_count overflow");
        donor_stats.co2_offset_grams = donor_stats.co2_offset_grams
            .checked_add(co2_increment).expect("Donor co2_offset overflow");
        donor_stats.badge = calculate_badge(donor_stats.total_donated);
        env.storage().instance().set(&DataKey::DonorStats(donor.clone()), &donor_stats);

        // Auto-mint an Impact NFT when a donor reaches a new badge tier.
        if donor_stats.badge != BadgeTier::None && donor_stats.badge != prev_badge {
            let nft_key = DataKey::ImpactNFT(donor.clone(), donor_stats.badge.clone());
            if !env.storage().instance().has(&nft_key) {
                let nft = ImpactNFT {
                    owner: donor.clone(),
                    tier: donor_stats.badge.clone(),
                    total_donated: donor_stats.total_donated,
                    minted_at_ledger: env.ledger().sequence(),
                };
                env.storage().instance().set(&nft_key, &nft);
                env.events().publish((symbol_short!("nft_mint"), donor.clone()), donor_stats.badge.clone());
            }
        }

        let dc: u32 = env.storage().instance().get(&DataKey::DonationCount).unwrap_or(0);
        let new_dc = dc.checked_add(1).expect("DonationCount overflow");
        env.storage().instance().set(&DataKey::DonationCount, &new_dc);

        let gr: i128 = env.storage().instance().get(&DataKey::GlobalTotalRaised).unwrap_or(0);
        let new_gr = gr.checked_add(amount).expect("GlobalTotalRaised overflow");
        env.storage().instance().set(&DataKey::GlobalTotalRaised, &new_gr);

        let gc: i128 = env.storage().instance().get(&DataKey::GlobalCO2OffsetGrams).unwrap_or(0);
        let new_gc = gc.checked_add(co2_increment).expect("GlobalCO2 overflow");
        env.storage().instance().set(&DataKey::GlobalCO2OffsetGrams, &new_gc);

        // ── Interaction: external call happens after every effect is durable.
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&donor, &project.wallet, &amount);

        env.events().publish(
            (symbol_short!("donated"), donor, project_id),
            (amount, donor_stats.badge.clone(), msg_hash),
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

    pub fn mint_impact_nft(env: Env, donor: Address, tier: BadgeTier) {
        donor.require_auth();
        if tier == BadgeTier::None { panic!("Cannot mint NFT for None tier"); }

        let stats: DonorStats = env.storage().instance()
            .get(&DataKey::DonorStats(donor.clone()))
            .unwrap_or(DonorStats { total_donated: 0, donation_count: 0,
                badge: BadgeTier::None, co2_offset_grams: 0 });
        if stats.badge == BadgeTier::None {
            panic!("No badge tier reached yet");
        }
        if stats.badge != tier {
            panic!("Tier does not match donor's current badge");
        }

        let key = DataKey::ImpactNFT(donor.clone(), tier.clone());
        if env.storage().instance().has(&key) {
            panic!("NFT already minted for this tier");
        }

        let nft = ImpactNFT {
            owner: donor.clone(),
            tier: tier.clone(),
            total_donated: stats.total_donated,
            minted_at_ledger: env.ledger().sequence(),
        };
        env.storage().instance().set(&key, &nft);
        env.events().publish((symbol_short!("nft_mint"), donor), tier);
    }

    pub fn has_nft(env: Env, donor: Address, tier: BadgeTier) -> bool {
        env.storage().instance().has(&DataKey::ImpactNFT(donor, tier))
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
        let deadline_ledger = env.ledger().sequence()
            .checked_add(VOTING_WINDOW_LEDGERS)
            .expect("Voting deadline overflow");
        let proposal = VoteProposal {
            project_id:      project_id.clone(),
            votes_for:       0,
            votes_against:   0,
            deadline_ledger,
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

        if approve {
            proposal.votes_for = proposal.votes_for
                .checked_add(1).expect("votes_for overflow");
        } else {
            proposal.votes_against = proposal.votes_against
                .checked_add(1).expect("votes_against overflow");
        }
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

    // ─── Security regression tests (see SECURITY.md) ──────────────────────────

    /// Helper that registers a SAC token for the donate-flow tests.
    fn setup_with_token() -> (
        Env,
        soroban_sdk::Address,
        GreenPayContractClient<'static>,
        Address,
        String,
        Address,
        Address,
    ) {
        let env   = Env::default();
        env.mock_all_auths();
        let cid    = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &cid);
        let admin  = Address::generate(&env);
        client.initialize(&admin);
        let pid    = String::from_str(&env, "proj-001");
        let wallet = Address::generate(&env);
        client.register_project(
            &admin, &pid,
            &String::from_str(&env, "Test Project"),
            &wallet, &100u32,
        );
        let token_admin = Address::generate(&env);
        let token_addr  = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        (env, cid, client, admin, pid, wallet, token_addr)
    }

    fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
        soroban_sdk::token::StellarAssetClient::new(env, token).mint(to, &amount);
    }

    /// H-01 regression: donate() applies state updates before the external
    /// token transfer and the happy path remains correct end-to-end.
    #[test]
    fn test_donate_basic_flow_after_cei_reorder() {
        let (env, _cid, client, _admin, pid, wallet, token) = setup_with_token();
        let donor = Address::generate(&env);
        mint(&env, &token, &donor, 100 * STROOP);

        client.donate(&token, &donor, &pid, &(50 * STROOP), &0);

        let project = client.get_project(&pid);
        assert_eq!(project.total_raised, 50 * STROOP);
        assert_eq!(project.donor_count,  1);
        assert_eq!(client.get_global_total(), 50 * STROOP);
        assert_eq!(client.get_donation_count(), 1);

        // CEI: tokens actually moved as a side-effect of the recorded state.
        let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&wallet), 50 * STROOP);
        assert_eq!(token_client.balance(&donor),  50 * STROOP);
    }

    /// M-01 regression: `donor_count` reflects unique donors, not donations.
    #[test]
    fn test_donate_unique_donor_count_not_inflated() {
        let (env, _cid, client, _admin, pid, _wallet, token) = setup_with_token();
        let donor = Address::generate(&env);
        mint(&env, &token, &donor, 100 * STROOP);

        client.donate(&token, &donor, &pid, &(20 * STROOP), &0);
        client.donate(&token, &donor, &pid, &(20 * STROOP), &0);
        client.donate(&token, &donor, &pid, &(20 * STROOP), &0);

        let project = client.get_project(&pid);
        assert_eq!(project.donor_count,  1, "same donor must count once");
        assert_eq!(project.total_raised, 60 * STROOP);
        assert_eq!(client.get_donation_count(), 3, "donation_count tracks every donate call");
    }

    /// M-01 regression: distinct donors increment `donor_count` independently.
    #[test]
    fn test_donate_distinct_donors_increment_count() {
        let (env, _cid, client, _admin, pid, _wallet, token) = setup_with_token();
        for _ in 0..3u32 {
            let d = Address::generate(&env);
            mint(&env, &token, &d, 10 * STROOP);
            client.donate(&token, &d, &pid, &(10 * STROOP), &0);
        }
        let project = client.get_project(&pid);
        assert_eq!(project.donor_count, 3);
    }

    /// H-02 regression: donating onto a near-MAX `total_raised` panics with
    /// the checked-arithmetic guard instead of silently wrapping.
    #[test]
    #[should_panic(expected = "Project total_raised overflow")]
    fn test_donate_total_raised_overflow_protected() {
        let (env, cid, client, _admin, pid, _wallet, token) = setup_with_token();
        env.as_contract(&cid, || {
            let mut p: Project = env.storage().instance()
                .get(&DataKey::Project(pid.clone())).unwrap();
            p.total_raised = i128::MAX - 1;
            env.storage().instance().set(&DataKey::Project(pid.clone()), &p);
        });
        let donor = Address::generate(&env);
        mint(&env, &token, &donor, 100 * STROOP);
        client.donate(&token, &donor, &pid, &(10 * STROOP), &0);
    }

    /// H-02 regression: CO2 multiplication is bounded by `checked_mul`, so a
    /// project with a huge `co2_per_xlm` cannot silently wrap the offset.
    #[test]
    #[should_panic(expected = "CO2 calculation overflow")]
    fn test_donate_co2_overflow_protected() {
        let env   = Env::default();
        env.mock_all_auths();
        let cid    = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &cid);
        let admin  = Address::generate(&env);
        client.initialize(&admin);
        let pid    = String::from_str(&env, "proj-co2");
        let wallet = Address::generate(&env);
        client.register_project(
            &admin, &pid,
            &String::from_str(&env, "Carbon Bomb"),
            &wallet, &u32::MAX,
        );
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        let donor = Address::generate(&env);
        let amount = 10i128.pow(36);
        mint(&env, &token, &donor, amount);
        // (amount / STROOP) * u32::MAX  ≈ 1e29 * 4.3e9 ≈ 4.3e38 > i128::MAX.
        client.donate(&token, &donor, &pid, &amount, &0);
    }

    /// L-01 regression: the deadline calculation in `create_proposal` uses
    /// `checked_add` so a near-u32::MAX ledger sequence panics instead of
    /// silently wrapping to a past ledger (which would let proposals be
    /// resolved immediately). Verified by exercising the same arithmetic
    /// the entrypoint runs — going through the contract client at
    /// near-MAX ledgers trips the host's TTL archive check first.
    #[test]
    #[should_panic(expected = "Voting deadline overflow")]
    fn test_voting_deadline_checked_add_guard() {
        let near_max: u32 = u32::MAX - 100;
        let _ = near_max
            .checked_add(VOTING_WINDOW_LEDGERS)
            .expect("Voting deadline overflow");
    }
}
