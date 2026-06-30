#![no_std]
#[cfg(all(test, feature = "testutils"))]
mod fuzz_tests;

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
    token, Address, Env, symbol_short, Symbol, String, BytesN, Vec,
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
    pub currency:     Symbol,  // "XLM" or "USDC"
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
    ProjectIds,
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
    // Contract upgrade and multi-currency support
    ContractWasmHash,
    USDCTokenAddress,
    // Oracle for dynamic CO2 pricing
    CO2OraclePrice,
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STROOP: i128 = 10_000_000;

// 7 days × 24 h × 3600 s ÷ 5 s per ledger ≈ 120_960 ledgers — used as the
// default when `create_proposal` is called without an explicit duration.
const VOTING_WINDOW_LEDGERS: u32 = 120_960;

// Bounds on caller-supplied voting durations. Floor (~1 hour) keeps the
// window long enough to be observed; ceiling (~30 days) bounds storage TTL
// pressure and prevents proposals from sitting open indefinitely.
const MIN_VOTING_WINDOW_LEDGERS: u32 = 720;     // 1 hour @ 5s/ledger
const MAX_VOTING_WINDOW_LEDGERS: u32 = 518_400; // 30 days @ 5s/ledger

// Upper bound on co2_per_xlm at registration — prevents donate-time CO₂ overflow
// panics and misleading impact figures from misconfigured projects.
const MAX_CO2_PER_XLM: u32 = 100_000;

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
        env.storage().instance().set(&DataKey::CO2OraclePrice,       &100i128);
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
        if co2_per_xlm > MAX_CO2_PER_XLM {
            panic!("CO2 per XLM exceeds maximum");
        }
        let project = Project {
            id: project_id.clone(), name, wallet, co2_per_xlm,
            total_raised: 0, donor_count: 0, active: true,
            registered_at: env.ledger().sequence(),
        };
        env.storage().instance().set(&DataKey::Project(project_id.clone()), &project);
        let mut project_ids: Vec<String> = env.storage().instance()
            .get(&DataKey::ProjectIds)
            .unwrap_or_else(|| Vec::new(&env));
        project_ids.push_back(project_id.clone());
        env.storage().instance().set(&DataKey::ProjectIds, &project_ids);
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

    /// Emergency circuit breaker — deactivates every registered project at once.
    /// Callable only by admin when a critical vulnerability requires halting
    /// all donation processing.
    pub fn deactivate_all_projects(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can deactivate all projects"); }
        let project_ids: Vec<String> = env.storage().instance()
            .get(&DataKey::ProjectIds)
            .unwrap_or_else(|| Vec::new(&env));
        for i in 0..project_ids.len() {
            let project_id = project_ids.get(i).unwrap();
            let mut project: Project = env.storage().instance()
                .get(&DataKey::Project(project_id.clone())).expect("Project not found");
            project.active = false;
            env.storage().instance().set(&DataKey::Project(project_id), &project);
        }
        env.events().publish((symbol_short!("deact_all"),), admin);
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
            (symbol_short!("donated"), donor.clone(), project_id.clone()),
            (amount, donor_stats.badge.clone(), msg_hash),
        );

        env.events().publish(
            (symbol_short!("don_rec"), donor, project_id),
            (amount, env.ledger().sequence()),
        );

        if donor_stats.badge != prev_badge && donor_stats.badge != BadgeTier::None {
            env.events().publish(
                (symbol_short!("badge_up"), donor),
                donor_stats.badge.clone(),
            );
        }
    }

    // ─── Oracle management ────────────────────────────────────────────────────

    pub fn set_co2_price(env: Env, admin: Address, price: i128) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can set CO2 price"); }
        if price <= 0 { panic!("CO2 price must be positive"); }
        env.storage().instance().set(&DataKey::CO2OraclePrice, &price);
        env.events().publish((symbol_short!("oracle_upd"),), price);
    }

    pub fn get_co2_price(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::CO2OraclePrice).unwrap_or(100)
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
    ///
    /// `duration_ledgers` is the length of the voting window in Stellar
    /// ledgers (≈5 s each). Pass `0` to use the default 7-day window;
    /// any other value must be within
    /// [`MIN_VOTING_WINDOW_LEDGERS`, `MAX_VOTING_WINDOW_LEDGERS`].
    pub fn create_proposal(
        env:              Env,
        admin:            Address,
        project_id:       String,
        duration_ledgers: u32,
    ) {
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

        let window = if duration_ledgers == 0 {
            VOTING_WINDOW_LEDGERS
        } else {
            if duration_ledgers < MIN_VOTING_WINDOW_LEDGERS {
                panic!("Voting duration too short");
            }
            if duration_ledgers > MAX_VOTING_WINDOW_LEDGERS {
                panic!("Voting duration too long");
            }
            duration_ledgers
        };
        let deadline_ledger = env.ledger().sequence()
            .checked_add(window)
            .expect("Voting deadline overflow");

        let proposal = VoteProposal {
            project_id:      project_id.clone(),
            votes_for:       0,
            votes_against:   0,
            deadline_ledger,
            resolved:        false,
        };
        env.storage().instance().set(&DataKey::Proposal(project_id.clone()), &proposal);
        env.events().publish((symbol_short!("prop_new"), admin), (project_id.clone(), window));
        env.events().publish(
            (symbol_short!("prop_crt"), admin),
            (project_id, deadline_ledger),
        );
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
        env.events().publish((symbol_short!("voted"), voter.clone(), project_id.clone()), approve);
        env.events().publish(
            (symbol_short!("vote_cast"), voter, project_id),
            approve,
        );
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

    /// Admin-only immediate veto. Marks the proposal resolved & rejected.
    /// Required for incident response when a proposal is based on fraudulent data.
    /// Emits prop_veto with the admin address for auditability.
    pub fn veto_proposal(env: Env, admin: Address, project_id: String) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can veto proposals"); }
        let mut proposal: VoteProposal = env.storage().instance()
            .get(&DataKey::Proposal(project_id.clone())).expect("Proposal not found");
        if proposal.resolved { panic!("Proposal already resolved"); }
        proposal.resolved = true;
        env.events().publish((symbol_short!("prop_veto"), admin), project_id.clone());
        env.storage().instance().set(&DataKey::Proposal(project_id), &proposal);
    }

    /// Returns current vote counts and status for a proposal.
    pub fn get_proposal(env: Env, project_id: String) -> VoteProposal {
        env.storage().instance()
            .get(&DataKey::Proposal(project_id)).expect("Proposal not found")
    }

    /// Donate USDC. Converts to XLM-equivalent for global stats using a price oracle stub.
    pub fn donate_usdc(
        env:        Env,
        usdc_token: Address,
        donor:      Address,
        project_id: String,
        usdc_amount: i128,
        msg_hash:   u32,
    ) {
        donor.require_auth();
        if usdc_amount <= 0 { panic!("Donation amount must be positive"); }

        let stored_usdc: Option<Address> = env.storage().instance()
            .get(&DataKey::USDCTokenAddress);
        if stored_usdc.is_none() || stored_usdc.unwrap() != usdc_token {
            panic!("USDC token not configured");
        }

        let co2_price: i128 = env.storage().instance()
            .get(&DataKey::CO2OraclePrice).unwrap_or(100);
        let xlm_equivalent = usdc_amount
            .checked_mul(co2_price / 100).expect("USDC to XLM conversion overflow");

        let mut project: Project = env.storage().instance()
            .get(&DataKey::Project(project_id.clone())).expect("Project not found");
        if !project.active { panic!("Project is not accepting donations"); }

        // Pre-compute CO2 increment using XLM-equivalent
        let xlm_units = xlm_equivalent / STROOP;
        let co2_increment = xlm_units
            .checked_mul(project.co2_per_xlm as i128)
            .expect("CO2 calculation overflow");

        let mut donor_stats: DonorStats = env.storage().instance()
            .get(&DataKey::DonorStats(donor.clone()))
            .unwrap_or(DonorStats { total_donated: 0, donation_count: 0,
                badge: BadgeTier::None, co2_offset_grams: 0 });
        let prev_badge = donor_stats.badge.clone();

        // Update project and donor stats using XLM-equivalent
        project.total_raised = project.total_raised
            .checked_add(xlm_equivalent).expect("Project total_raised overflow");
        let donated_key = DataKey::HasDonated(project_id.clone(), donor.clone());
        if !env.storage().instance().has(&donated_key) {
            env.storage().instance().set(&donated_key, &true);
            project.donor_count = project.donor_count
                .checked_add(1).expect("Project donor_count overflow");
        }
        env.storage().instance().set(&DataKey::Project(project_id.clone()), &project);

        donor_stats.total_donated = donor_stats.total_donated
            .checked_add(xlm_equivalent).expect("Donor total_donated overflow");
        donor_stats.donation_count = donor_stats.donation_count
            .checked_add(1).expect("Donor donation_count overflow");
        donor_stats.co2_offset_grams = donor_stats.co2_offset_grams
            .checked_add(co2_increment).expect("Donor co2_offset overflow");
        donor_stats.badge = calculate_badge(donor_stats.total_donated);
        env.storage().instance().set(&DataKey::DonorStats(donor.clone()), &donor_stats);

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
        env.storage().instance().set(&DataKey::GlobalTotalRaised,
            &gr.checked_add(xlm_equivalent).expect("GlobalTotalRaised overflow"));

        let gg: i128 = env.storage().instance().get(&DataKey::GlobalCO2OffsetGrams).unwrap_or(0);
        env.storage().instance().set(&DataKey::GlobalCO2OffsetGrams,
            &gg.checked_add(co2_increment).expect("GlobalCO2OffsetGrams overflow"));

        let token_client = token::Client::new(&env, &usdc_token);
        let project_wallet = project.wallet;
        token_client.transfer(&donor, &project_wallet, &usdc_amount);

        env.events().publish((symbol_short!("donated"), donor.clone(), project_id), (usdc_amount, symbol_short!("USDC")));
    }

    /// Admin-only: Set the USDC token address for multi-currency donations.
    pub fn set_usdc_token(env: Env, admin: Address, usdc_token: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can set USDC token"); }
        env.storage().instance().set(&DataKey::USDCTokenAddress, &usdc_token);
        env.events().publish((symbol_short!("usdc_set"),), usdc_token);
    }

    /// Get the configured USDC token address.
    pub fn get_usdc_token(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::USDCTokenAddress)
    }

    /// Admin-only: Upgrade the contract to a new WASM code.
    /// Preserves all on-chain state while replacing the contract implementation.
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can upgrade"); }

        // Store the new WASM hash for upgrade verification
        env.storage().instance().set(&DataKey::ContractWasmHash, &new_wasm_hash);

        // Execute the actual upgrade
        env.deployer().update_current_contract_wasm(new_wasm_hash);

        env.events().publish((symbol_short!("upgrade"),), admin);
    }

    /// Get the current contract WASM hash.
    pub fn get_contract_wasm_hash(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::ContractWasmHash)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Address, Env, String};
    use soroban_sdk::token::StellarAssetClient;

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

    #[test]
    fn test_upgrade_preserves_donation_state_and_storage_keys() {
        let (env, cid, client_v1, _admin, pid) = setup();
        let donor       = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token       = env.register_stellar_asset_contract_v2(token_admin).address();
        let token_client = StellarAssetClient::new(&env, &token);
        let amount       = 25 * STROOP;
        let expected_co2 = 25 * 100i128;

        token_client.mint(&donor, &amount);
        client_v1.donate(&token, &donor, &pid, &amount, &42u32);

        let project_before = client_v1.get_project(&pid);
        assert_eq!(project_before.total_raised, amount);
        assert_eq!(project_before.donor_count, 1);
        assert_eq!(client_v1.get_donation_count(), 1);
        assert_eq!(client_v1.get_global_total(), amount);
        assert_eq!(client_v1.get_global_co2(), expected_co2);

        // The test host replaces the executable at the same contract address,
        // modeling a v2 deployment with the same storage key definitions.
        let v2_cid = env.register_contract(Some(&cid), GreenPayContract);
        assert_eq!(v2_cid, cid);

        let client_v2 = GreenPayContractClient::new(&env, &cid);
        let project_after = client_v2.get_project(&pid);
        assert_eq!(project_after.id,            project_before.id);
        assert_eq!(project_after.name,          project_before.name);
        assert_eq!(project_after.wallet,        project_before.wallet);
        assert_eq!(project_after.co2_per_xlm,   project_before.co2_per_xlm);
        assert_eq!(project_after.total_raised,  amount);
        assert_eq!(project_after.donor_count,   1);
        assert!(project_after.active);
        assert_eq!(project_after.registered_at, project_before.registered_at);

        let donor_stats = client_v2.get_donor_stats(&donor);
        assert_eq!(donor_stats.total_donated,    amount);
        assert_eq!(donor_stats.donation_count,   1);
        assert_eq!(donor_stats.badge,            BadgeTier::Seedling);
        assert_eq!(donor_stats.co2_offset_grams, expected_co2);
        assert!(client_v2.has_nft(&donor, &BadgeTier::Seedling));
        assert_eq!(client_v2.get_project_count(),   1);
        assert_eq!(client_v2.get_donation_count(),  1);
        assert_eq!(client_v2.get_global_total(),    amount);
        assert_eq!(client_v2.get_global_co2(),      expected_co2);

        env.as_contract(&cid, || {
            let stored_project: Project = env.storage().instance()
                .get(&DataKey::Project(pid.clone()))
                .expect("project key must remain readable after upgrade");
            assert_eq!(stored_project.total_raised, amount);
            assert_eq!(stored_project.donor_count,  1);

            let stored_stats: DonorStats = env.storage().instance()
                .get(&DataKey::DonorStats(donor.clone()))
                .expect("donor stats key must remain readable after upgrade");
            assert_eq!(stored_stats.total_donated,    amount);
            assert_eq!(stored_stats.donation_count,   1);
            assert_eq!(stored_stats.badge,            BadgeTier::Seedling);
            assert_eq!(stored_stats.co2_offset_grams, expected_co2);

            let has_donated: bool = env.storage().instance()
                .get(&DataKey::HasDonated(pid.clone(), donor.clone()))
                .expect("unique donor key must remain readable after upgrade");
            assert!(has_donated);

            let donation_count: u32 = env.storage().instance()
                .get(&DataKey::DonationCount)
                .expect("donation count key must remain readable after upgrade");
            let global_total: i128 = env.storage().instance()
                .get(&DataKey::GlobalTotalRaised)
                .expect("global total key must remain readable after upgrade");
            let global_co2: i128 = env.storage().instance()
                .get(&DataKey::GlobalCO2OffsetGrams)
                .expect("global CO2 key must remain readable after upgrade");

            assert_eq!(donation_count, 1);
            assert_eq!(global_total,   amount);
            assert_eq!(global_co2,     expected_co2);
        });
    }

    // ─── Governance tests ─────────────────────────────────────────────────────

    #[test]
    fn test_create_proposal() {
        let (env, _cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);
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
        client.create_proposal(&admin, &pid, &0u32);
        client.create_proposal(&admin, &pid, &0u32);
    }

    #[test]
    fn test_cast_vote() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);
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
        client.create_proposal(&admin, &pid, &0u32);
        let non_donor = Address::generate(&env);
        client.vote_verify_project(&non_donor, &pid, &true);
    }

    #[test]
    #[should_panic(expected = "Already voted on this proposal")]
    fn test_double_vote_prevented() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);
        let voter = Address::generate(&env);
        grant_badge(&env, &cid, &voter);
        client.vote_verify_project(&voter, &pid, &true);
        client.vote_verify_project(&voter, &pid, &true); // should panic
    }

    #[test]
    fn test_resolve_proposal_approved() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);
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
        client.create_proposal(&admin, &pid, &0u32);
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
        client.create_proposal(&admin, &pid, &0u32);
        client.resolve_proposal(&pid);
    }

    #[test]
    #[should_panic(expected = "Proposal already resolved")]
    fn test_double_resolve_fails() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);
        extend_ttl(&env, &cid);
        env.ledger().set_sequence_number(VOTING_WINDOW_LEDGERS + 2);
        client.resolve_proposal(&pid);
        // Extend again so the second call reaches our panic, not an archive error
        extend_ttl(&env, &cid);
        client.resolve_proposal(&pid);
    }

    #[test]
    fn test_veto_proposal() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);
        extend_ttl(&env, &cid);
        client.veto_proposal(&admin, &pid);
        let p = client.get_proposal(&pid);
        assert!(p.resolved);
    }

    #[test]
    #[should_panic(expected = "Only admin can veto proposals")]
    fn test_veto_proposal_non_admin_fails() {
        let (env, _cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);
        let imposter = Address::generate(&env);
        client.veto_proposal(&imposter, &pid);
    }

    #[test]
    #[should_panic(expected = "Proposal not found")]
    fn test_veto_proposal_missing_fails() {
        let env    = Env::default();
        env.mock_all_auths();
        let cid    = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &cid);
        let admin  = Address::generate(&env);
        client.initialize(&admin);
        client.veto_proposal(&admin, &String::from_str(&env, "nonexistent"));
    }

    #[test]
    #[should_panic(expected = "Proposal already resolved")]
    fn test_veto_proposal_double_veto_fails() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);
        extend_ttl(&env, &cid);
        client.veto_proposal(&admin, &pid);
        client.veto_proposal(&admin, &pid);
    }

    // ─── Configurable voting-duration tests ───────────────────────────────────

    /// A non-zero `duration_ledgers` within bounds is honored verbatim.
    #[test]
    fn test_create_proposal_custom_duration() {
        let (env, _cid, client, admin, pid) = setup();
        let custom: u32 = 5_000;
        let start = env.ledger().sequence();
        client.create_proposal(&admin, &pid, &custom);
        let p = client.get_proposal(&pid);
        assert_eq!(p.deadline_ledger, start + custom);
    }

    /// `0` means "use the default 7-day window".
    #[test]
    fn test_create_proposal_zero_duration_uses_default() {
        let (env, _cid, client, admin, pid) = setup();
        let start = env.ledger().sequence();
        client.create_proposal(&admin, &pid, &0u32);
        let p = client.get_proposal(&pid);
        assert_eq!(p.deadline_ledger, start + VOTING_WINDOW_LEDGERS);
    }

    #[test]
    #[should_panic(expected = "Voting duration too short")]
    fn test_create_proposal_rejects_too_short_duration() {
        let (_env, _cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &(MIN_VOTING_WINDOW_LEDGERS - 1));
    }

    #[test]
    #[should_panic(expected = "Voting duration too long")]
    fn test_create_proposal_rejects_too_long_duration() {
        let (_env, _cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &(MAX_VOTING_WINDOW_LEDGERS + 1));
    }

    #[test]
    #[should_panic(expected = "CO2 per XLM exceeds maximum")]
    fn test_register_project_rejects_excessive_co2_per_xlm() {
        let (env, _cid, client, admin, _pid) = setup();
        let pid2 = String::from_str(&env, "proj-002");
        let wallet = Address::generate(&env);
        client.register_project(
            &admin,
            &pid2,
            &String::from_str(&env, "Bad Project"),
            &wallet,
            &(MAX_CO2_PER_XLM + 1),
        );
    }

    #[test]
    fn test_deactivate_all_projects() {
        let (env, _cid, client, admin, pid1) = setup();
        let pid2 = String::from_str(&env, "proj-002");
        let wallet = Address::generate(&env);
        client.register_project(
            &admin,
            &pid2,
            &String::from_str(&env, "Second Project"),
            &wallet,
            &100u32,
        );

        assert!(client.get_project(&pid1).active);
        assert!(client.get_project(&pid2).active);

        client.deactivate_all_projects(&admin);

        assert!(!client.get_project(&pid1).active);
        assert!(!client.get_project(&pid2).active);
    }

    /// Test that voting is rejected after the deadline has passed (issue #209).
    #[test]
    #[should_panic(expected = "Voting window has closed")]
    fn test_vote_rejected_after_deadline() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);

        // Create a voter with badge
        let voter = Address::generate(&env);
        grant_badge(&env, &cid, &voter);

        // Advance ledger past the deadline
        extend_ttl(&env, &cid);
        env.ledger().set_sequence_number(VOTING_WINDOW_LEDGERS + 2);

        // Attempt to vote after deadline — should panic with "Voting window has closed"
        client.vote_verify_project(&voter, &pid, &true);
    }

    /// Test that voting is allowed before the deadline (issue #209).
    #[test]
    fn test_vote_allowed_before_deadline() {
        let (env, cid, client, admin, pid) = setup();
        let start = env.ledger().sequence();
        client.create_proposal(&admin, &pid, &0u32);

        let voter = Address::generate(&env);
        grant_badge(&env, &cid, &voter);

        // Vote at ledger start + VOTING_WINDOW_LEDGERS - 1 (last valid ledger)
        extend_ttl(&env, &cid);
        env.ledger().set_sequence_number(start + VOTING_WINDOW_LEDGERS - 1);

        // Should succeed
        client.vote_verify_project(&voter, &pid, &true);

        let proposal = client.get_proposal(&pid);
        assert_eq!(proposal.votes_for, 1);
    }

    /// Test minimum voting duration enforcement (issue #209).
    #[test]
    fn test_minimum_voting_duration_enforced() {
        let (env, cid, client, admin, pid) = setup();
        let custom_duration = MIN_VOTING_WINDOW_LEDGERS;
        let start = env.ledger().sequence();

        client.create_proposal(&admin, &pid, &custom_duration);

        let voter = Address::generate(&env);
        grant_badge(&env, &cid, &voter);

        // Vote within the minimum window
        extend_ttl(&env, &cid);
        env.ledger().set_sequence_number(start + custom_duration - 1);

        client.vote_verify_project(&voter, &pid, &true);

        let proposal = client.get_proposal(&pid);
        assert_eq!(proposal.votes_for, 1);
    }
}
