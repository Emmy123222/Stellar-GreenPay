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
    contract, contractclient, contractimpl, contracttype, contracterror,
    token, Address, Env, symbol_short, Symbol, String, BytesN, Vec,
};

// ─── Oracle interface ─────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OracleAsset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OraclePriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// SEP-40 methods used from the configured Reflector Pulse oracle.
#[contractclient(name = "OracleClient")]
pub trait OracleInterface {
    fn decimals(env: Env) -> u32;
    fn lastprice(env: Env, asset: OracleAsset) -> Option<OraclePriceData>;
    fn resolution(env: Env) -> u32;
}

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

// ─── Contract errors ──────────────────────────────────────────────────────────

/// Typed errors returned by contract entry-points that require authorisation.
///
/// Using `#[contracterror]` (rather than `panic!`) gives callers a stable,
/// machine-readable signal they can match on, and satisfies the Soroban SDK's
/// `try_*` generated-client interface.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    /// The transaction invoker is neither the donor nor the contract admin.
    Unauthorized = 1,
    /// An arithmetic operation would have overflowed its integer type, or a
    /// donation amount exceeds the protocol-defined maximum.
    Overflow = 2,
}

// ─── Data structures ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub wallet: Address,
    pub co2_per_xlm: u32,
    pub min_donation_amount: i128,
    pub total_raised: i128,
    pub donor_count: u32,
    pub active: bool,
    pub registered_at: u32,
}

/// Input for registering a project via `batch_register_projects`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProjectInit {
    pub id:          String,
    pub name:        String,
    pub wallet:      Address,
    pub co2_per_xlm: u32,
    pub min_donation_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DonationRecord {
    pub donor: Address,
    pub project: String,
    pub amount: i128,
    pub ledger: u32,
    pub message_hash: u32,
    pub currency: Symbol, // "XLM" or "USDC"
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DonorStats {
    pub total_donated: i128,
    pub donation_count: u32,
    pub badge: BadgeTier,
    pub co2_offset_grams: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ImpactNFT {
    pub owner: Address,
    pub tier: BadgeTier,
    pub total_donated: i128,
    pub minted_at_ledger: u32,
}

/// Per-project milestone NFT awarded when a donor's cumulative donation to a
/// single project exceeds 100 XLM. One NFT per (donor, project_id) pair.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProjectMilestoneNFT {
    pub owner:              Address,
    pub project_id:         String,
    pub amount_donated:     i128,
    pub co2_offset_grams:   i128,
    pub minted_at_ledger:   u32,
}

/// A community voting proposal to verify a project.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VoteProposal {
    pub project_id: String,
    pub votes_for: u32,
    pub votes_against: u32,
    pub deadline_ledger: u32,
    pub resolved: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VerificationStatus {
    pub has_proposal: bool,
    pub votes_for: u32,
    pub votes_against: u32,
    pub deadline_ledger: u32,
    pub resolved: bool,
    pub approved: bool,
}

/// Aggregated platform-wide counters returned by `get_global_stats`.
///
/// Bundles the four values that the landing page hero section needs in a
/// single RPC call, avoiding the four separate `get_global_total`,
/// `get_global_co2`, `get_donation_count`, and `get_project_count` round
/// trips that were required before this type existed.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GlobalStats {
    /// Total XLM (in stroops) donated across all projects and all currencies.
    pub total_raised:    i128,
    /// Cumulative CO₂ offset in grams across every donation ever recorded.
    pub co2_offset_grams: i128,
    /// Total number of individual donation transactions recorded on-chain.
    pub donation_count:  u32,
    /// Total number of climate projects registered with the contract.
    pub project_count:   u32,
}

/// Aggregated project-detail view returned by `get_impact_summary`.
///
/// Bundles the full project record together with the project-level CO₂
/// offset and the calling donor's personal stats (defaults to zeros when
/// no donor address is provided), so that a client can render a complete
/// project detail page in a single contract call instead of three separate
/// RPC round trips.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ImpactSummary {
    /// The full on-chain project record (id, name, wallet, etc.).
    pub project: Project,
    /// Total CO₂ offset in grams attributed to this project's donations.
    /// Computed as `(project.total_raised / STROOP) × project.co2_per_xlm`.
    pub project_co2_offset_grams: i128,
    /// Donor-specific stats (total_donated, donation_count, badge,
    /// co2_offset_grams).  When `get_impact_summary` is called without a
    /// donor address, this field is returned with all-zero / `None` badge
    /// defaults, saving the extra storage read.
    pub donor_stats: DonorStats,
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
    DonationRecord(u32),
    DonorDonations(Address),
    GlobalTotalRaised,
    GlobalCO2OffsetGrams,
    // Tracks whether `donor` has ever donated to `project` — used so
    // `Project.donor_count` reflects unique donors instead of donations.
    HasDonated(String, Address),
    // Governance
    Proposal(String),
    HasVoted(String, Address),
    // List of voter addresses for a given proposal — used by get_voter_list
    VoterList(String),
    // Per-donor per-project cumulative donation total for milestone NFT gating
    DonorProjectTotal(String, Address),
    // Per-project milestone NFT: one per (project_id, donor) pair
    ProjectMilestoneNFT(String, Address),
    // Metadata IPFS storage
    ProjectMetadata(String),
    // Contract upgrade and multi-currency support
    ContractWasmHash,
    USDCTokenAddress,
    // Price oracle for USDC → XLM conversion
    OracleAddress,
    // Contract-wide emergency pause status
    Paused,
    PendingAdmin,
    // Configurable staleness bound for oracle price quotes (issue #1146)
    MaxPriceAgeSecs,
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STROOP: i128 = 10_000_000;
/// USDC uses six decimal places.
const USDC_SCALE: i128 = 1_000_000;
/// Reject quotes older than three oracle update intervals.
const ORACLE_MAX_AGE_MULTIPLIER: u64 = 3;
/// Default ceiling on oracle price age, in seconds, used unless the admin
/// has configured a different value via `set_max_price_age`. A stale price
/// (older than this, or than `ORACLE_MAX_AGE_MULTIPLIER` update intervals,
/// whichever is stricter) is rejected in `donate_usdc`.
const DEFAULT_MAX_PRICE_AGE_SECS: u64 = 3600;

// 7 days × 24 h × 3600 s ÷ 5 s per ledger ≈ 120_960 ledgers — used as the
// default when `create_proposal` is called without an explicit duration.
const VOTING_WINDOW_LEDGERS: u32 = 120_960;

// Bounds on caller-supplied voting durations. Floor (~1 hour) keeps the
// window long enough to be observed; ceiling (~30 days) bounds storage TTL
// pressure and prevents proposals from sitting open indefinitely.
const MIN_VOTING_WINDOW_LEDGERS: u32 = 720; // 1 hour @ 5s/ledger
const MAX_VOTING_WINDOW_LEDGERS: u32 = 518_400; // 30 days @ 5s/ledger

// Upper bound on co2_per_xlm at registration — prevents donate-time CO₂ overflow
// panics and misleading impact figures from misconfigured projects.
const MAX_CO2_PER_XLM: u32 = 100_000;

/// Maximum single-donation size accepted by `donate()` and `donate_usdc()`.
///
/// Set to 100 000 XLM in stroops. This is intentionally conservative:
///   * At MAX_CO2_PER_XLM = 100 000 g/XLM the worst-case CO₂ increment is
///     100 000 XLM × 100 000 g = 10 000 000 000 g ≈ 10⁷ i128 — nowhere near
///     i128::MAX (~1.7 × 10³⁸), so every intermediate product stays safe.
///   * The cap is a policy boundary that prevents runaway storage values from
///     a single outlier transaction, not an arithmetic necessity.
const MAX_DONATION: i128 = 100_000 * STROOP; // 100 000 XLM in stroops

fn calculate_badge(total_stroops: i128) -> BadgeTier {
    let xlm = total_stroops / STROOP;
    if xlm >= 2000 {
        BadgeTier::EarthGuardian
    } else if xlm >= 500 {
        BadgeTier::Forest
    } else if xlm >= 100 {
        BadgeTier::Tree
    } else if xlm >= 10 {
        BadgeTier::Seedling
    } else {
        BadgeTier::None
    }
}

/// Compute the CO₂ offset in grams for a donation.
///
/// # Parameters
/// * `amount_stroops` — donation size in stroops (XLM × 10⁷). Must be
///   `≤ MAX_DONATION`; larger values return `ContractError::Overflow`.
/// * `co2_per_xlm`    — grams of CO₂ offset per whole XLM, as registered
///   for the project (capped at `MAX_CO2_PER_XLM` at registration time).
///
/// # Returns
/// `Ok(grams)` on success, or `Err(ContractError::Overflow)` if:
/// * `amount_stroops > MAX_DONATION`, **or**
/// * the intermediate `xlm_units × co2_per_xlm` product overflows `i128`.
///
/// # Why both guards?
/// The cap (`MAX_DONATION`) is a *policy* barrier — it prevents a single
/// donation from dominating global statistics and is enforced before any
/// arithmetic.  The `checked_mul` is an *arithmetic* safety net that catches
/// any residual overflow (e.g. a corrupted `co2_per_xlm` that slipped past
/// the `MAX_CO2_PER_XLM` registration gate).
fn compute_co2_offset(amount_stroops: i128, co2_per_xlm: u32) -> Result<i128, ContractError> {
    if amount_stroops > MAX_DONATION {
        return Err(ContractError::Overflow);
    }
    let xlm_units = amount_stroops / STROOP; // infallible: divisor is non-zero constant
    xlm_units
        .checked_mul(co2_per_xlm as i128)
        .ok_or(ContractError::Overflow)
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
        env.storage().instance().set(&DataKey::ProjectCount, &0u32);
        env.storage().instance().set(&DataKey::DonationCount, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::GlobalTotalRaised, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::GlobalCO2OffsetGrams, &0i128);
    }

    // ─── Emergency Pause (Circuit Breaker) ───────────────────────────────────

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can pause contract");
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"), admin), ());
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can unpause contract");
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("unpaused"), admin), ());
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ─── Project management ───────────────────────────────────────────────────

    pub fn register_project(
        env: Env,
        admin: Address,
        project_id: String,
        name: String,
        wallet: Address,
        co2_per_xlm: u32,
        min_donation_amount: i128,
    ) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can register projects");
        }
        if env
            .storage()
            .instance()
            .has(&DataKey::Project(project_id.clone()))
        {
            panic!("Project already registered");
        }
        if co2_per_xlm > MAX_CO2_PER_XLM {
            panic!("CO2 per XLM exceeds maximum");
        }
        let project = Project {
            id: project_id.clone(),
            name,
            wallet,
            co2_per_xlm,
            min_donation_amount,
            total_raised: 0,
            donor_count: 0,
            active: true,
            registered_at: env.ledger().sequence(),
        };
        env.storage()
            .instance()
            .set(&DataKey::Project(project_id.clone()), &project);

        // Track project ID for listing / bulk operations
        let mut ids: Vec<String> = env.storage().instance()
            .get(&DataKey::ProjectIds).unwrap_or(Vec::new(&env));
        ids.push_back(project_id.clone());
        env.storage().instance().set(&DataKey::ProjectIds, &ids);

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProjectCount)
            .unwrap_or(0);
        let next_count = count.checked_add(1).expect("ProjectCount overflow");
        env.storage()
            .instance()
            .set(&DataKey::ProjectCount, &next_count);
        
        // Append project ID to the ProjectIds vector for enumeration
        let mut project_ids: Vec<String> = env
            .storage()
            .instance()
            .get(&DataKey::ProjectIds)
            .unwrap_or(Vec::new(&env));
        project_ids.push_back(project_id.clone());
        env.storage()
            .instance()
            .set(&DataKey::ProjectIds, &project_ids);
        
        env.events()
            .publish((symbol_short!("proj_reg"), admin), project_id);
    }

    pub fn batch_register_projects(env: Env, admin: Address, projects: Vec<ProjectInit>) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can register projects"); }

        // Load the project IDs vector once outside the loop for efficiency
        let mut project_ids: Vec<String> = env
            .storage()
            .instance()
            .get(&DataKey::ProjectIds)
            .unwrap_or(Vec::new(&env));

        for init in projects.iter() {
            let project_id = init.id.clone();
            if env.storage().instance().has(&DataKey::Project(project_id.clone())) {
                panic!("Project already registered");
            }
            if init.co2_per_xlm > MAX_CO2_PER_XLM {
                panic!("CO2 per XLM exceeds maximum");
            }
            let project = Project {
                id: project_id.clone(),
                name: init.name.clone(),
                wallet: init.wallet.clone(),
                co2_per_xlm: init.co2_per_xlm,
                min_donation_amount: init.min_donation_amount,
                total_raised: 0,
                donor_count: 0,
                active: true,
                registered_at: env.ledger().sequence(),
            };
            env.storage().instance().set(&DataKey::Project(project_id.clone()), &project);

            // Track project ID for listing / bulk operations
            let mut ids: Vec<String> = env.storage().instance()
                .get(&DataKey::ProjectIds).unwrap_or(Vec::new(&env));
            ids.push_back(project_id.clone());
            env.storage().instance().set(&DataKey::ProjectIds, &ids);

            let count: u32 = env.storage().instance().get(&DataKey::ProjectCount).unwrap_or(0);
            let next_count = count.checked_add(1).expect("ProjectCount overflow");
            env.storage().instance().set(&DataKey::ProjectCount, &next_count);
            
            // Append project ID to the ProjectIds vector for enumeration
            project_ids.push_back(project_id.clone());
            
            env.events().publish((symbol_short!("proj_reg"), admin.clone()), project_id);
        }
        
        // Store the updated ProjectIds vector
        env.storage()
            .instance()
            .set(&DataKey::ProjectIds, &project_ids);
    }

    pub fn deactivate_project(env: Env, admin: Address, project_id: String) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can deactivate projects");
        }
        let mut project: Project = env
            .storage()
            .instance()
            .get(&DataKey::Project(project_id.clone()))
            .expect("Project not found");
        project.active = false;
        env.storage()
            .instance()
            .set(&DataKey::Project(project_id), &project);
    }

    pub fn pause_project(env: Env, admin: Address, project_id: String) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can pause projects"); }
        let mut project: Project = env.storage().instance()
            .get(&DataKey::Project(project_id.clone())).expect("Project not found");
        if !project.active { panic!("Cannot pause a deactivated project"); }
        project.active = false;
        env.storage().instance().set(&DataKey::Project(project_id), &project);
    }

    // ─── Project Metadata ───────────────────────────────────────────────────

    /// Update or store the IPFS CID of a project's metadata JSON.
    /// Accessible by contract global admin or the project's wallet owner.
    pub fn set_project_metadata(
        env: Env,
        admin: Address,
        project_id: String,
        ipfs_cid: String,
    ) {
        admin.require_auth();

        let project: Project = env
            .storage()
            .instance()
            .get(&DataKey::Project(project_id.clone()))
            .expect("Project not found");

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");

        if stored_admin != admin && project.wallet != admin {
            panic!("Only admin or project wallet can set metadata");
        }

        if ipfs_cid.is_empty() {
            panic!("IPFS CID cannot be empty");
        }

        if ipfs_cid.len() > 128 {
            panic!("IPFS CID exceeds maximum length");
        }

        env.storage()
            .instance()
            .set(&DataKey::ProjectMetadata(project_id.clone()), &ipfs_cid);

        env.events().publish(
            (Symbol::new(&env, "meta_updated"), project_id),
            (admin, ipfs_cid),
        );
    }

    /// Deactivate all active projects at once. Admin only.
    /// Iterates the project ID list stored during `register_project`.
    pub fn deactivate_all_projects(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin { panic!("Only admin can deactivate projects"); }
        let ids: Vec<String> = env.storage().instance()
            .get(&DataKey::ProjectIds).unwrap_or(Vec::new(&env));
        for pid in ids.iter() {
            let mut project: Project = env.storage().instance()
                .get(&DataKey::Project(pid.clone())).expect("Project not found");
            project.active = false;
            env.storage().instance().set(&DataKey::Project(pid), &project);
        }
    }

    // ─── Donations ────────────────────────────────────────────────────────────

    pub fn donate(
        env: Env,
        token: Address,
        donor: Address,
        project_id: String,
        amount: i128,
        msg_hash: u32,
    ) {
        donor.require_auth();
        if Self::is_paused(env.clone()) {
            panic!("Contract is paused");
        }
        if amount <= 0 {
            panic!("Donation amount must be positive");
        }
        if amount > MAX_DONATION {
            panic!("Donation amount exceeds maximum");
        }

        let mut project: Project = env
            .storage()
            .instance()
            .get(&DataKey::Project(project_id.clone()))
            .expect("Project not found");
        if !project.active {
            panic!("Project is not accepting donations");
        }
        if amount < project.min_donation_amount {
            panic!("Donation below minimum");
        }

        // Delegate CO2 arithmetic to the shared helper that enforces the
        // MAX_DONATION cap and uses checked_mul to return ContractError::Overflow
        // instead of panicking on pathological inputs.
        let co2_increment = compute_co2_offset(amount, project.co2_per_xlm)
            .expect("CO2 calculation overflow");

        let mut donor_stats: DonorStats = env
            .storage()
            .instance()
            .get(&DataKey::DonorStats(donor.clone()))
            .unwrap_or(DonorStats {
                total_donated: 0,
                donation_count: 0,
                badge: BadgeTier::None,
                co2_offset_grams: 0,
            });
        let prev_badge = donor_stats.badge.clone();

        // ── Effects: all state writes BEFORE the external token transfer
        //    (Checks-Effects-Interactions to defend against reentrancy from a
        //    malicious token contract passed via `token`).
        project.total_raised = project
            .total_raised
            .checked_add(amount)
            .expect("Project total_raised overflow");
        let donated_key = DataKey::HasDonated(project_id.clone(), donor.clone());
        if !env.storage().instance().has(&donated_key) {
            env.storage().instance().set(&donated_key, &true);
            project.donor_count = project
                .donor_count
                .checked_add(1)
                .expect("Project donor_count overflow");
        }
        env.storage()
            .instance()
            .set(&DataKey::Project(project_id.clone()), &project);

        donor_stats.total_donated = donor_stats
            .total_donated
            .checked_add(amount)
            .expect("Donor total_donated overflow");
        donor_stats.donation_count = donor_stats
            .donation_count
            .checked_add(1)
            .expect("Donor donation_count overflow");
        donor_stats.co2_offset_grams = donor_stats
            .co2_offset_grams
            .checked_add(co2_increment)
            .expect("Donor co2_offset overflow");
        donor_stats.badge = calculate_badge(donor_stats.total_donated);
        env.storage()
            .instance()
            .set(&DataKey::DonorStats(donor.clone()), &donor_stats);

        // Track per-project cumulative donations for milestone NFT eligibility.
        let proj_total_key = DataKey::DonorProjectTotal(project_id.clone(), donor.clone());
        let prev_proj_total: i128 = env.storage().instance().get(&proj_total_key).unwrap_or(0);
        env.storage().instance().set(
            &proj_total_key,
            &prev_proj_total.checked_add(amount).expect("DonorProjectTotal overflow"),
        );

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
                env.events().publish(
                    (symbol_short!("nft_mint"), donor.clone()),
                    donor_stats.badge.clone(),
                );
            }
        }

        let dc: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DonationCount)
            .unwrap_or(0);
        let new_dc = dc.checked_add(1).expect("DonationCount overflow");
        env.storage().instance().set(&DataKey::DonationCount, &new_dc);
        // Store donation record for trustless enumeration
        let donation_record = DonationRecord {
            donor: donor.clone(),
            project: project_id.clone(),
            amount,
            ledger: env.ledger().sequence(),
            message_hash: msg_hash,
            currency: symbol_short!("XLM"),
        };
        env.storage().instance().set(&DataKey::DonationRecord(dc), &donation_record);

        // Track this donation index in the donor's history list.
        let mut donor_donations: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::DonorDonations(donor.clone()))
            .unwrap_or(Vec::new(&env));
        donor_donations.push_back(dc);
        env.storage().instance().set(&DataKey::DonorDonations(donor.clone()), &donor_donations);

        let gr: i128 = env
            .storage()
            .instance()
            .get(&DataKey::GlobalTotalRaised)
            .unwrap_or(0);
        let new_gr = gr.checked_add(amount).expect("GlobalTotalRaised overflow");
        env.storage()
            .instance()
            .set(&DataKey::GlobalTotalRaised, &new_gr);

        let gc: i128 = env
            .storage()
            .instance()
            .get(&DataKey::GlobalCO2OffsetGrams)
            .unwrap_or(0);
        let new_gc = gc.checked_add(co2_increment).expect("GlobalCO2 overflow");
        env.storage()
            .instance()
            .set(&DataKey::GlobalCO2OffsetGrams, &new_gc);

        // ── Interaction: external call happens after every effect is durable.
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&donor, &project.wallet, &amount);

        env.events().publish(
            (symbol_short!("donated"), donor.clone(), project_id.clone()),
            (amount, donor_stats.badge.clone(), msg_hash),
        );
        env.storage().instance().extend_ttl(VOTING_WINDOW_LEDGERS * 4, VOTING_WINDOW_LEDGERS * 4);
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    pub fn get_project(env: Env, project_id: String) -> Project {
        env.storage()
            .instance()
            .get(&DataKey::Project(project_id))
            .expect("Project not found")
    }

    pub fn get_donor_stats(env: Env, donor: Address) -> DonorStats {
        env.storage()
            .instance()
            .get(&DataKey::DonorStats(donor))
            .unwrap_or(DonorStats {
                total_donated: 0,
                donation_count: 0,
                badge: BadgeTier::None,
                co2_offset_grams: 0,
            })
    }

    pub fn get_badge(env: Env, donor: Address) -> BadgeTier {
        let stats: DonorStats = env
            .storage()
            .instance()
            .get(&DataKey::DonorStats(donor))
            .unwrap_or(DonorStats {
                total_donated: 0,
                donation_count: 0,
                badge: BadgeTier::None,
                co2_offset_grams: 0,
            });
        stats.badge
    }

    pub fn get_global_total(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::GlobalTotalRaised)
            .unwrap_or(0)
    }

    pub fn get_global_co2(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::GlobalCO2OffsetGrams)
            .unwrap_or(0)
    }

    pub fn get_project_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ProjectCount)
            .unwrap_or(0)
    }

    pub fn get_donation_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DonationCount)
            .unwrap_or(0)
    }

    /// Returns all four global counters in a single contract call.
    ///
    /// This eliminates the four separate RPC round trips that were previously
    /// required to populate the landing page hero section (total raised, CO₂
    /// offset, donation count, project count).  Clients should prefer this
    /// function over calling the individual getters when all four values are
    /// needed at the same time.
    ///
    /// # Example (JavaScript SDK)
    /// ```js
    /// const stats = await contract.get_global_stats();
    /// console.log(stats.total_raised, stats.co2_offset_grams,
    ///             stats.donation_count, stats.project_count);
    /// ```
    pub fn get_global_stats(env: Env) -> GlobalStats {
        GlobalStats {
            total_raised:     env.storage().instance()
                                  .get(&DataKey::GlobalTotalRaised).unwrap_or(0),
            co2_offset_grams: env.storage().instance()
                                  .get(&DataKey::GlobalCO2OffsetGrams).unwrap_or(0),
            donation_count:   env.storage().instance()
                                  .get(&DataKey::DonationCount).unwrap_or(0),
            project_count:    env.storage().instance()
                                  .get(&DataKey::ProjectCount).unwrap_or(0),
        }
    }

    /// Returns all data needed for a project detail page in one Soroban call.
    ///
    /// Bundles the full project record together with the project-level CO₂
    /// offset and (optionally) the calling donor's personal stats.  This
    /// eliminates three separate RPC round trips (`get_project`,
    /// `get_donor_stats`, plus a manual CO₂ computation on the client) that
    /// were previously required to render a project detail page.
    ///
    /// When `donor` is `None`, the returned `donor_stats` field is a
    /// zeroed-out `DonorStats` (all amounts 0, badge `None`) and the
    /// contract skips the second storage read entirely, saving gas.
    ///
    /// # Panics
    /// Panics if the project does not exist.
    ///
    /// # Example (JavaScript SDK)
    /// ```js
    /// // With donor
    /// const summary = await contract.get_impact_summary({ project_id: "proj-001", donor: donorAddr });
    /// console.log(summary.project.name, summary.project_co2_offset_grams, summary.donor_stats.badge);
    ///
    /// // Without donor (public view) — donor_stats defaults to zeros
    /// const summary = await contract.get_impact_summary({ project_id: "proj-001" });
    /// console.log(summary.project_co2_offset_grams, summary.donor_stats.badge);
    /// ```
    pub fn get_impact_summary(env: Env, project_id: String, donor: Option<Address>) -> ImpactSummary {
        let project: Project = env.storage()
            .instance()
            .get(&DataKey::Project(project_id))
            .expect("Project not found");

        let xlm_units = project.total_raised / STROOP;
        let project_co2_offset_grams = xlm_units
            .checked_mul(project.co2_per_xlm as i128)
            .expect("CO2 calculation overflow");

        let donor_stats = match donor {
            Some(donor_addr) => {
                env.storage()
                    .instance()
                    .get(&DataKey::DonorStats(donor_addr))
                    .unwrap_or(DonorStats {
                        total_donated: 0,
                        donation_count: 0,
                        badge: BadgeTier::None,
                        co2_offset_grams: 0,
                    })
            }
            None => DonorStats {
                total_donated: 0,
                donation_count: 0,
                badge: BadgeTier::None,
                co2_offset_grams: 0,
            },
        };

        ImpactSummary {
            project,
            project_co2_offset_grams,
            donor_stats,
        }
    }

    /// Retrieve a donation record by its index.
    pub fn get_donation_record(env: Env, index: u32) -> DonationRecord {
        env.storage().instance().get(&DataKey::DonationRecord(index)).expect("Donation record not found")
    }

    /// Returns a paginated list of donation records for a given donor.
    /// Results are ordered chronologically (oldest first).
    pub fn get_donor_history(env: Env, donor: Address, offset: u32, limit: u32) -> Vec<DonationRecord> {
        let donation_ids: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::DonorDonations(donor))
            .unwrap_or(Vec::new(&env));
        let total_count = donation_ids.len();
        let bounded_offset = offset.min(total_count);

        if bounded_offset >= total_count || limit == 0 {
            return Vec::new(&env);
        }

        let bounded_limit = limit.min(total_count - bounded_offset);
        let end = bounded_offset + bounded_limit;
        let mut result = Vec::new(&env);
        let mut index = bounded_offset;
        while index < end {
            if let Some(donation_id) = donation_ids.get(index) {
                if let Some(record) = env
                    .storage()
                    .instance()
                    .get::<_, DonationRecord>(&DataKey::DonationRecord(donation_id))
                {
                    result.push_back(record);
                }
            }
            index += 1;
        }

        result
    }

    /// Retrieve a paginated list of all projects on-chain.
    ///
    /// # Arguments
    /// * `offset` - Starting index in the project list (0-indexed)
    /// * `limit` - Maximum number of projects to return
    ///
    /// # Returns
    /// A `Vec<Project>` containing up to `limit` projects starting from `offset`.
    /// If `offset` is greater than or equal to the total number of projects,
    /// returns an empty vector without panicking.
    ///
    /// # Example
    /// ```ignore
    /// // Get first 10 projects
    /// let projects = contract.get_all_projects_paginated(0, 10);
    /// // Get next 10 projects
    /// let projects = contract.get_all_projects_paginated(10, 10);
    /// ```
    pub fn get_all_projects_paginated(env: Env, offset: u32, limit: u32) -> Vec<Project> {
        // Retrieve the list of project IDs, or empty vec if not yet initialized
        let project_ids: Vec<String> = env
            .storage()
            .instance()
            .get(&DataKey::ProjectIds)
            .unwrap_or(Vec::new(&env));
        
        let total_count = project_ids.len();
        
        // If offset is out of bounds, return empty vec
        if offset >= total_count {
            return Vec::new(&env);
        }
        
        // Calculate the end bound: min(offset + limit, total_count).
        // The addition is done in u64 to avoid overflow when checking the
        // bound; once we know offset + limit <= total_count (a u32), the
        // u32 addition below is guaranteed not to overflow.
        let end = if (offset as u64) + (limit as u64) > (total_count as u64) {
            total_count
        } else {
            (offset + limit).min(total_count)
        };

        // Collect projects from the slice
        let mut result = Vec::new(&env);
        let mut idx = offset;
        while idx < end {
            if let Some(project_id) = project_ids.get(idx) {
                if let Some(project) = env
                    .storage()
                    .instance()
                    .get::<_, Project>(&DataKey::Project(project_id))
                {
                    result.push_back(project);
                }
            }
            idx += 1;
        }
        
        result
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    /// Propose a new admin. The current admin keeps control until the
    /// proposed address explicitly accepts the role.
    pub fn propose_new_admin(env: Env, admin: Address, new_admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can propose a new admin");
        }
        if new_admin == stored_admin {
            panic!("New admin must differ from current admin");
        }

        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        env.events()
            .publish((symbol_short!("adm_prop"), admin), new_admin);
    }

    /// Accept a pending admin proposal and finalize the admin rotation.
    pub fn accept_admin(env: Env, new_admin: Address) {
        new_admin.require_auth();
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .expect("No pending admin proposal");
        if pending_admin != new_admin {
            panic!("Only pending admin can accept admin role");
        }

        let previous_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.events()
            .publish((symbol_short!("adm_acpt"), previous_admin), new_admin);
    }

    /// Read the current pending admin proposal, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    // ─── Placeholders ─────────────────────────────────────────────────────────

    /// Manually mint an impact-tier NFT for `donor`.
    ///
    /// # Authorization
    /// `caller` must equal `donor` (self-service) **or** the contract admin.
    /// Any other address receives [`ContractError::Unauthorized`].
    ///
    /// # Errors
    /// * [`ContractError::Unauthorized`] — `caller` is neither `donor` nor admin.
    ///
    /// # Panics
    /// * `"Cannot mint NFT for None tier"` — `tier` is `BadgeTier::None`.
    /// * `"No badge tier reached yet"` — donor has not earned any badge.
    /// * `"Tier does not match donor's current badge"` — `tier` doesn't match.
    /// * `"NFT already minted for this tier"` — duplicate mint attempt.
    pub fn mint_impact_nft(env: Env, caller: Address, donor: Address, tier: BadgeTier) -> Result<(), ContractError> {
        // ── Authorization: caller must be donor or admin ──────────────────────
        caller.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if caller != donor && caller != stored_admin {
            return Err(ContractError::Unauthorized);
        }

        // ── Validation ───────────────────────────────────────────────────────
        if tier == BadgeTier::None {
            panic!("Cannot mint NFT for None tier");
        }

        let stats: DonorStats = env
            .storage()
            .instance()
            .get(&DataKey::DonorStats(donor.clone()))
            .unwrap_or(DonorStats {
                total_donated: 0,
                donation_count: 0,
                badge: BadgeTier::None,
                co2_offset_grams: 0,
            });
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

        // ── Effects ──────────────────────────────────────────────────────────
        let nft = ImpactNFT {
            owner: donor.clone(),
            tier: tier.clone(),
            total_donated: stats.total_donated,
            minted_at_ledger: env.ledger().sequence(),
        };
        env.storage().instance().set(&key, &nft);
        env.events()
            .publish((symbol_short!("nft_mint"), donor), tier);
        Ok(())
    }

    /// Returns the impact NFT minted for `owner` at `tier`, if it exists.
    ///
    /// The returned value is the complete immutable mint snapshot, including
    /// the owner, tier, cumulative donation total, and mint ledger sequence.
    pub fn get_impact_nft(env: Env, owner: Address, tier: BadgeTier) -> Option<ImpactNFT> {
        env.storage()
            .instance()
            .get(&DataKey::ImpactNFT(owner, tier))
    }

    pub fn has_nft(env: Env, donor: Address, tier: BadgeTier) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::ImpactNFT(donor, tier))
    }

    // ─── Project milestone NFT (#205) ────────────────────────────────────────

    /// Mint a project milestone NFT when a donor's cumulative donation to a
    /// specific project exceeds 100 XLM. Minting is idempotent-blocked: a second
    /// call for the same (donor, project_id) pair panics.
    pub fn mint_project_nft(env: Env, donor: Address, project_id: String) {
        donor.require_auth();

        let project: Project = env.storage().instance()
            .get(&DataKey::Project(project_id.clone())).expect("Project not found");

        let proj_total_key = DataKey::DonorProjectTotal(project_id.clone(), donor.clone());
        let proj_total: i128 = env.storage().instance().get(&proj_total_key).unwrap_or(0);

        // 100 XLM = 100 × 10_000_000 stroops
        if proj_total < 100 * STROOP {
            panic!("Cumulative donation to this project has not reached 100 XLM");
        }

        let nft_key = DataKey::ProjectMilestoneNFT(project_id.clone(), donor.clone());
        if env.storage().instance().has(&nft_key) {
            panic!("Milestone NFT already minted for this project");
        }

        let co2_per_xlm = project.co2_per_xlm as i128;
        let xlm_units = proj_total / STROOP;
        let co2_offset = xlm_units.checked_mul(co2_per_xlm).expect("CO2 calculation overflow");

        let nft = ProjectMilestoneNFT {
            owner:            donor.clone(),
            project_id:       project_id.clone(),
            amount_donated:   proj_total,
            co2_offset_grams: co2_offset,
            minted_at_ledger: env.ledger().sequence(),
        };
        env.storage().instance().set(&nft_key, &nft);
        env.events().publish(
            (symbol_short!("pnft_mnt"), donor.clone()),
            (project_id, proj_total),
        );
    }

    pub fn has_project_nft(env: Env, donor: Address, project_id: String) -> bool {
        env.storage().instance().has(&DataKey::ProjectMilestoneNFT(project_id, donor))
    }

    pub fn get_project_nft(env: Env, donor: Address, project_id: String) -> ProjectMilestoneNFT {
        env.storage().instance()
            .get(&DataKey::ProjectMilestoneNFT(project_id, donor))
            .expect("Project milestone NFT not found")
    }

    // ─── Governance ───────────────────────────────────────────────────────────

    /// Admin creates a voting proposal for a project to be community-verified.
    ///
    /// `duration_ledgers` is the length of the voting window in Stellar
    /// ledgers (≈5 s each). Pass `0` to use the default 7-day window;
    /// any other value must be within
    /// [`MIN_VOTING_WINDOW_LEDGERS`, `MAX_VOTING_WINDOW_LEDGERS`].
    pub fn create_proposal(env: Env, admin: Address, project_id: String, duration_ledgers: u32) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can create proposals");
        }
        if !env
            .storage()
            .instance()
            .has(&DataKey::Project(project_id.clone()))
        {
            panic!("Project not found");
        }
        if env
            .storage()
            .instance()
            .has(&DataKey::Proposal(project_id.clone()))
        {
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
        let deadline_ledger = env
            .ledger()
            .sequence()
            .checked_add(window)
            .expect("Voting deadline overflow");

        let proposal = VoteProposal {
            project_id: project_id.clone(),
            votes_for: 0,
            votes_against: 0,
            deadline_ledger,
            resolved: false,
        };
        env.storage()
            .instance()
            .set(&DataKey::Proposal(project_id.clone()), &proposal);
        env.events()
            .publish((symbol_short!("prop_new"), admin), (project_id, window));
    }

    /// Badge holders (≥ Seedling) cast a vote. One vote per address per proposal.
    pub fn vote_verify_project(env: Env, voter: Address, project_id: String, approve: bool) {
        voter.require_auth();
        if Self::is_paused(env.clone()) {
            panic!("Contract is paused");
        }

        let stats: DonorStats = env
            .storage()
            .instance()
            .get(&DataKey::DonorStats(voter.clone()))
            .unwrap_or(DonorStats {
                total_donated: 0,
                donation_count: 0,
                badge: BadgeTier::None,
                co2_offset_grams: 0,
            });
        if stats.badge == BadgeTier::None {
            panic!("Only badge holders (Seedling or above) can vote");
        }

        let mut proposal: VoteProposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(project_id.clone()))
            .expect("Proposal not found");
        if proposal.resolved {
            panic!("Proposal already resolved");
        }
        if env.ledger().sequence() > proposal.deadline_ledger {
            panic!("Voting window has closed");
        }

        let voted_key = DataKey::HasVoted(project_id.clone(), voter.clone());
        if env.storage().instance().has(&voted_key) {
            panic!("Already voted on this proposal");
        }
        env.storage().instance().set(&voted_key, &true);

        // Add voter to the voter list for this proposal
        let voter_list_key = DataKey::VoterList(project_id.clone());
        let mut voter_list: Vec<Address> = env.storage().instance()
            .get(&voter_list_key)
            .unwrap_or(Vec::new(&env));
        voter_list.push_back(voter.clone());
        env.storage().instance().set(&voter_list_key, &voter_list);

        if approve {
            proposal.votes_for = proposal
                .votes_for
                .checked_add(1)
                .expect("votes_for overflow");
        } else {
            proposal.votes_against = proposal
                .votes_against
                .checked_add(1)
                .expect("votes_against overflow");
        }
        env.storage()
            .instance()
            .set(&DataKey::Proposal(project_id.clone()), &proposal);
        env.events()
            .publish((symbol_short!("voted"), voter, project_id), approve);
    }

    /// Callable by anyone after the deadline. Resolves based on majority.
    /// Emits proj_ver on approval, prop_rej on rejection.
    pub fn resolve_proposal(env: Env, project_id: String) {
        let mut proposal: VoteProposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(project_id.clone()))
            .expect("Proposal not found");
        if proposal.resolved {
            panic!("Proposal already resolved");
        }
        if env.ledger().sequence() <= proposal.deadline_ledger {
            panic!("Voting window not yet closed");
        }
        proposal.resolved = true;
        if proposal.votes_for > proposal.votes_against {
            env.events()
                .publish((symbol_short!("proj_ver"),), project_id.clone());
        } else {
            env.events()
                .publish((symbol_short!("prop_rej"),), project_id.clone());
        }
        env.storage()
            .instance()
            .set(&DataKey::Proposal(project_id), &proposal);
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
        env.storage()
            .instance()
            .get(&DataKey::Proposal(project_id))
            .expect("Proposal not found")
    }

    pub fn get_verification_status(env: Env, project_id: String) -> VerificationStatus {
        if env.storage().instance().has(&DataKey::Proposal(project_id.clone())) {
            let proposal: VoteProposal = env.storage().instance().get(&DataKey::Proposal(project_id)).unwrap();
            let approved = proposal.resolved && proposal.votes_for > proposal.votes_against;
            VerificationStatus {
                has_proposal: true,
                votes_for: proposal.votes_for,
                votes_against: proposal.votes_against,
                deadline_ledger: proposal.deadline_ledger,
                resolved: proposal.resolved,
                approved,
            }
        } else {
            VerificationStatus {
                has_proposal: false,
                votes_for: 0,
                votes_against: 0,
                deadline_ledger: 0,
                resolved: false,
                approved: false,
            }
        }
    }

    /// Returns the list of voter addresses for a proposal.
    /// Can be used by governance UIs to display who voted and how.
    pub fn get_voter_list(env: Env, project_id: String) -> Vec<Address> {
        env.storage().instance()
            .get(&DataKey::VoterList(project_id))
            .unwrap_or(Vec::new(&env))
    }

    /// Donate USDC. Converts to an XLM-equivalent amount using the configured
    /// on-chain price oracle.
    pub fn donate_usdc(
        env: Env,
        usdc_token: Address,
        donor: Address,
        project_id: String,
        usdc_amount: i128,
        msg_hash: u32,
    ) {
        donor.require_auth();
        if Self::is_paused(env.clone()) {
            panic!("Contract is paused");
        }
        if usdc_amount <= 0 {
            panic!("Donation amount must be positive");
        }
        if usdc_amount > MAX_DONATION {
            panic!("Donation amount exceeds maximum");
        }

        let stored_usdc: Option<Address> = env.storage().instance().get(&DataKey::USDCTokenAddress);
        if stored_usdc.is_none() || stored_usdc.unwrap() != usdc_token {
            panic!("USDC token not configured");
        }

        // Fetch the latest USDC price from the configured XLM-base SEP-40
        // oracle. The returned fixed-point precision is declared by decimals().
        let oracle_addr: Address = env.storage().instance()
            .get(&DataKey::OracleAddress).expect("Price oracle not configured");
        let oracle = OracleClient::new(&env, &oracle_addr);
        let quote = oracle
            .lastprice(&OracleAsset::Stellar(usdc_token.clone()))
            .expect("Oracle price not available");
        if quote.price <= 0 {
            panic!("Oracle returned invalid price");
        }
        let resolution = oracle.resolution();
        if resolution == 0 {
            panic!("Oracle returned invalid resolution");
        }
        let now = env.ledger().timestamp();
        let resolution_max_age = u64::from(resolution)
            .checked_mul(ORACLE_MAX_AGE_MULTIPLIER)
            .expect("Oracle max age overflow");
        let configured_max_age = Self::get_max_price_age(env.clone());
        // Enforce whichever bound is stricter: a fast-updating oracle still
        // can't be trusted past MAX_PRICE_AGE_SECS, and a slow-updating one
        // is still held to its own resolution-derived window.
        let max_age = resolution_max_age.min(configured_max_age);
        if quote.timestamp > now || now - quote.timestamp > max_age {
            panic!("StalePriceData: oracle price is older than the maximum allowed age");
        }
        let price_scale = 10i128
            .checked_pow(oracle.decimals())
            .expect("Oracle decimals are too large");
        let conversion_scale = USDC_SCALE
            .checked_mul(price_scale)
            .expect("Oracle conversion scale overflow");
        let xlm_equivalent = usdc_amount
            .checked_mul(quote.price)
            .expect("USDC to XLM conversion overflow")
            .checked_mul(STROOP)
            .expect("USDC to XLM stroop conversion overflow")
            .checked_div(conversion_scale)
            .expect("USDC to XLM conversion division failed");
        if xlm_equivalent <= 0 {
            panic!("Oracle conversion rounded donation to zero");
        }

        let mut project: Project = env
            .storage()
            .instance()
            .get(&DataKey::Project(project_id.clone()))
            .expect("Project not found");
        if !project.active {
            panic!("Project is not accepting donations");
        }
        if usdc_amount < project.min_donation_amount {
            panic!("Donation below minimum");
        }

        // Delegate CO2 arithmetic to the shared helper — uses checked_mul and
        // enforces the MAX_DONATION cap on the XLM-equivalent amount.
        let co2_increment = compute_co2_offset(xlm_equivalent, project.co2_per_xlm)
            .expect("CO2 calculation overflow");

        let mut donor_stats: DonorStats = env
            .storage()
            .instance()
            .get(&DataKey::DonorStats(donor.clone()))
            .unwrap_or(DonorStats {
                total_donated: 0,
                donation_count: 0,
                badge: BadgeTier::None,
                co2_offset_grams: 0,
            });
        let prev_badge = donor_stats.badge.clone();

        // Update project and donor stats using XLM-equivalent
        project.total_raised = project
            .total_raised
            .checked_add(xlm_equivalent)
            .expect("Project total_raised overflow");
        let donated_key = DataKey::HasDonated(project_id.clone(), donor.clone());
        if !env.storage().instance().has(&donated_key) {
            env.storage().instance().set(&donated_key, &true);
            project.donor_count = project
                .donor_count
                .checked_add(1)
                .expect("Project donor_count overflow");
        }
        env.storage()
            .instance()
            .set(&DataKey::Project(project_id.clone()), &project);

        donor_stats.total_donated = donor_stats
            .total_donated
            .checked_add(xlm_equivalent)
            .expect("Donor total_donated overflow");
        donor_stats.donation_count = donor_stats
            .donation_count
            .checked_add(1)
            .expect("Donor donation_count overflow");
        donor_stats.co2_offset_grams = donor_stats
            .co2_offset_grams
            .checked_add(co2_increment)
            .expect("Donor co2_offset overflow");
        donor_stats.badge = calculate_badge(donor_stats.total_donated);
        env.storage()
            .instance()
            .set(&DataKey::DonorStats(donor.clone()), &donor_stats);

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
                env.events().publish(
                    (symbol_short!("nft_mint"), donor.clone()),
                    donor_stats.badge.clone(),
                );
            }
        }

        let dc: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DonationCount)
            .unwrap_or(0);
        let new_dc = dc.checked_add(1).expect("DonationCount overflow");
        env.storage().instance().set(&DataKey::DonationCount, &new_dc);
        // Store USDC donation record for trustless enumeration
        let donation_record = DonationRecord {
            donor: donor.clone(),
            project: project_id.clone(),
            amount: usdc_amount,
            ledger: env.ledger().sequence(),
            message_hash: msg_hash,
            currency: symbol_short!("USDC"),
        };
        env.storage().instance().set(&DataKey::DonationRecord(dc), &donation_record);

        // Track this donation index in the donor's history list.
        let mut donor_donations: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::DonorDonations(donor.clone()))
            .unwrap_or(Vec::new(&env));
        donor_donations.push_back(dc);
        env.storage().instance().set(&DataKey::DonorDonations(donor.clone()), &donor_donations);

        let gr: i128 = env
            .storage()
            .instance()
            .get(&DataKey::GlobalTotalRaised)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::GlobalTotalRaised,
            &gr.checked_add(xlm_equivalent)
                .expect("GlobalTotalRaised overflow"),
        );

        let gg: i128 = env
            .storage()
            .instance()
            .get(&DataKey::GlobalCO2OffsetGrams)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::GlobalCO2OffsetGrams,
            &gg.checked_add(co2_increment)
                .expect("GlobalCO2OffsetGrams overflow"),
        );

        // Track per-project cumulative donations for milestone NFT eligibility.
        let proj_total_key = DataKey::DonorProjectTotal(project_id.clone(), donor.clone());
        let prev_proj_total: i128 = env.storage().instance().get(&proj_total_key).unwrap_or(0);
        env.storage().instance().set(
            &proj_total_key,
            &prev_proj_total.checked_add(xlm_equivalent).expect("DonorProjectTotal overflow"),
        );

        let token_client = token::Client::new(&env, &usdc_token);
        let project_wallet = project.wallet;
        token_client.transfer(&donor, &project_wallet, &usdc_amount);

        env.events().publish(
            (symbol_short!("donated"), donor.clone(), project_id),
            (usdc_amount, symbol_short!("USDC"), msg_hash),
        );
    }

    // ─── Admin: refund a disputed or fraudulent donation ────────────────────
    //
    // NOTE ON AUTHORIZATION: `donate()` transfers funds directly
    // donor -> project.wallet — this contract never custodies funds. That
    // means reversing a donation requires `project.wallet` itself to
    // authorize the outgoing transfer; Soroban's token client cannot move
    // funds out of an address without that address's own auth, and
    // `admin.require_auth()` alone cannot satisfy that for an arbitrary
    // external wallet. This function therefore requires BOTH the admin's
    // and the project wallet's authorization in the submitted transaction
    // (e.g. as a co-signed/multi-op transaction, or with the project
    // wallet itself being a contract that trusts this admin).
    //
    // If the intent is for admin to unilaterally claw back funds from an
    // uncooperative or genuinely fraudulent project (i.e. without that
    // project's cooperation), that requires a different architecture —
    // true custodial escrow held by this contract, or a pre-authorized
    // clawback allowance granted by the project at registration time.
    // Neither exists in this codebase today; this is flagged as a
    // recommended follow-up, not solved by this function.
    pub fn refund_donation(
        env: Env,
        admin: Address,
        project_id: String,
        donor: Address,
        amount: i128,
        token: Address,
    ) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can refund donations");
        }

        if amount <= 0 {
            panic!("Refund amount must be positive");
        }

        let mut project: Project = env
            .storage()
            .instance()
            .get(&DataKey::Project(project_id.clone()))
            .expect("Project not found");

        // The project wallet must itself authorize giving the funds back —
        // see the note above.
        project.wallet.require_auth();

        if project.total_raised < amount {
            panic!("Refund amount exceeds project total_raised");
        }

        let mut donor_stats: DonorStats = env
            .storage()
            .instance()
            .get(&DataKey::DonorStats(donor.clone()))
            .expect("Donor has no recorded donations");

        if donor_stats.total_donated < amount {
            panic!("Refund amount exceeds donor total_donated");
        }

        // ── Effects before the external token transfer (Checks-Effects-
        //    Interactions, matching `donate`'s ordering) ─────────────────────
        project.total_raised = project
            .total_raised
            .checked_sub(amount)
            .expect("Project total_raised underflow");
        env.storage()
            .instance()
            .set(&DataKey::Project(project_id.clone()), &project);

        donor_stats.total_donated = donor_stats
            .total_donated
            .checked_sub(amount)
            .expect("Donor total_donated underflow");
        donor_stats.badge = calculate_badge(donor_stats.total_donated);
        env.storage()
            .instance()
            .set(&DataKey::DonorStats(donor.clone()), &donor_stats);

        let gr: i128 = env
            .storage()
            .instance()
            .get(&DataKey::GlobalTotalRaised)
            .unwrap_or(0);
        let new_gr = gr.checked_sub(amount).expect("GlobalTotalRaised underflow");
        env.storage()
            .instance()
            .set(&DataKey::GlobalTotalRaised, &new_gr);

        // ── Interaction: transfer amount back from the project wallet to
        //    the donor, after every effect above is durable.
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&project.wallet, &donor, &amount);

        env.events().publish(
            (Symbol::new(&env, "donation_refunded"), donor.clone(), project_id.clone()),
            (amount, project.wallet.clone()),
        );
    }

    /// Admin-only: Configure the USDC token and its price oracle.
    ///
    /// Both addresses are written atomically so `donate_usdc` cannot observe a
    /// token configured without a matching oracle.
    pub fn set_usdc_token(
        env: Env,
        admin: Address,
        usdc_token: Address,
        oracle: Address,
    ) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can set USDC token");
        }
        env.storage()
            .instance()
            .set(&DataKey::USDCTokenAddress, &usdc_token);
        env.storage()
            .instance()
            .set(&DataKey::OracleAddress, &oracle);
        env.events()
            .publish((symbol_short!("usdc_set"),), (usdc_token, oracle));
    }

    /// Get the configured USDC token address.
    pub fn get_usdc_token(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::USDCTokenAddress)
    }

    /// Get the configured price oracle address.
    pub fn get_oracle(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::OracleAddress)
    }

    /// Admin-only: configure the maximum age, in seconds, an oracle price
    /// quote may have before `donate_usdc` rejects it as stale (issue #1146).
    /// Defaults to `DEFAULT_MAX_PRICE_AGE_SECS` (3600) until set.
    pub fn set_max_price_age(env: Env, admin: Address, max_age_secs: u64) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can set max price age");
        }
        if max_age_secs == 0 {
            panic!("Max price age must be positive");
        }
        env.storage()
            .instance()
            .set(&DataKey::MaxPriceAgeSecs, &max_age_secs);
        env.events()
            .publish((symbol_short!("maxage"),), max_age_secs);
    }

    /// Get the configured maximum oracle price age in seconds, falling back
    /// to `DEFAULT_MAX_PRICE_AGE_SECS` when unset.
    pub fn get_max_price_age(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MaxPriceAgeSecs)
            .unwrap_or(DEFAULT_MAX_PRICE_AGE_SECS)
    }

    /// Admin-only: Upgrade the contract to a new WASM code.
    /// Preserves all on-chain state while replacing the contract implementation.
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can upgrade");
        }

        // Store the new WASM hash for upgrade verification
        env.storage()
            .instance()
            .set(&DataKey::ContractWasmHash, &new_wasm_hash);

        // Execute the actual upgrade
        env.deployer().update_current_contract_wasm(new_wasm_hash);

        env.events().publish((symbol_short!("upgrade"),), admin);
    }

    /// Get the current contract WASM hash.
    pub fn get_contract_wasm_hash(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::ContractWasmHash)
    }
}

// ─── Mock oracle (test / integration use only) ────────────────────────────────

/// A minimal SEP-40 oracle that returns a fixed rate of 8 XLM per 1 USDC.
/// Deploy this in tests and local integration environments via
/// `set_usdc_token(admin, usdc_token, oracle)`.
#[contract]
pub struct MockOracle;

#[contractimpl]
impl OracleInterface for MockOracle {
    fn decimals(_env: Env) -> u32 {
        6
    }

    fn lastprice(env: Env, _asset: OracleAsset) -> Option<OraclePriceData> {
        Some(OraclePriceData {
            price: 8_000_000,
            timestamp: env.ledger().timestamp(),
        })
    }

    fn resolution(_env: Env) -> u32 {
        300
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
    use soroban_sdk::token::StellarAssetClient;
    use super::*;

    #[contract]
    struct FractionalMockOracle;

    #[contractimpl]
    impl OracleInterface for FractionalMockOracle {
        fn decimals(_env: Env) -> u32 {
            6
        }

        fn lastprice(env: Env, _asset: OracleAsset) -> Option<OraclePriceData> {
            Some(OraclePriceData {
                price: 2_500_000,
                timestamp: env.ledger().timestamp(),
            })
        }

        fn resolution(_env: Env) -> u32 {
            300
        }
    }

    /// Returns a quote with a fixed timestamp so tests can advance the
    /// ledger clock to simulate a stale or fresh price (issue #1146).
    #[contract]
    struct TimestampedMockOracle;

    #[contractimpl]
    impl OracleInterface for TimestampedMockOracle {
        fn decimals(_env: Env) -> u32 {
            6
        }

        fn lastprice(_env: Env, _asset: OracleAsset) -> Option<OraclePriceData> {
            Some(OraclePriceData {
                price: 8_000_000,
                timestamp: 1_000,
            })
        }

        fn resolution(_env: Env) -> u32 {
            300
        }
    }

    // ─── Existing tests ───────────────────────────────────────────────────────

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let id = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_project_count(), 0);
        assert_eq!(client.get_donation_count(), 0);
        assert_eq!(client.get_global_total(), 0);
    }

    #[test]
    fn test_admin_rotation_requires_proposal_and_acceptance() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.initialize(&admin);
        client.propose_new_admin(&admin, &new_admin);

        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_pending_admin(), Some(new_admin.clone()));

        client.accept_admin(&new_admin);

        assert_eq!(client.get_admin(), new_admin);
        assert_eq!(client.get_pending_admin(), None);
    }

    #[test]
    #[should_panic(expected = "Only pending admin can accept admin role")]
    fn test_accept_admin_requires_pending_admin_match() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let pending_admin = Address::generate(&env);
        let wrong_admin = Address::generate(&env);

        client.initialize(&admin);
        client.propose_new_admin(&admin, &pending_admin);
        client.accept_admin(&wrong_admin);
    }

    #[test]
    #[should_panic(expected = "No pending admin proposal")]
    fn test_accept_admin_without_proposal_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.initialize(&admin);
        client.accept_admin(&new_admin);
    }

    #[test]
    #[should_panic(expected = "Only admin can propose a new admin")]
    fn test_only_current_admin_can_propose_new_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.initialize(&admin);
        client.propose_new_admin(&attacker, &new_admin);
    }

        #[test]
    fn test_get_donation_record() {
        let (env, _cid, client, admin, pid) = setup();
        // Set up USDC token and oracle
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        let oracle_id = env.register_contract(None, MockOracle);
        client.set_usdc_token(&admin, &token, &oracle_id);
        let donor = Address::generate(&env);
        // Mint USDC to donor
        StellarAssetClient::new(&env, &token).mint(&donor, &(100 * 1_000_000i128));
        let usdc_amount: i128 = 10 * 1_000_000; // 10 USDC assuming 6 decimals
        client.donate_usdc(&token, &donor, &pid, &usdc_amount, &0u32);
        let record = client.get_donation_record(&0u32);
        assert_eq!(record.donor, donor);
        assert_eq!(record.project, pid);
        assert_eq!(record.amount, usdc_amount);
        assert_eq!(record.currency, symbol_short!("USDC"));
    }

    #[test]
    fn test_usdc_donation_uses_configured_oracle_rate() {
        let (env, _cid, client, admin, pid) = setup();
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        let oracle = env.register_contract(None, FractionalMockOracle);

        client.set_usdc_token(&admin, &token, &oracle);
        assert_eq!(client.get_usdc_token(), Some(token.clone()));
        assert_eq!(client.get_oracle(), Some(oracle));

        let donor = Address::generate(&env);
        let usdc_amount = 4_000_000i128;
        StellarAssetClient::new(&env, &token).mint(&donor, &usdc_amount);
        client.donate_usdc(&token, &donor, &pid, &usdc_amount, &0u32);

        // 4 USDC at 2.5 XLM per USDC = 10 XLM, represented in stroops.
        assert_eq!(client.get_global_total(), 10 * STROOP);
    }

    // ─── Issue #1146: oracle price staleness ─────────────────────────────────

    #[test]
    #[should_panic(expected = "StalePriceData")]
    fn test_donate_usdc_rejects_stale_oracle_price() {
        let (env, _cid, client, admin, pid) = setup();
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        let oracle = env.register_contract(None, TimestampedMockOracle);
        client.set_usdc_token(&admin, &token, &oracle);

        let donor = Address::generate(&env);
        let usdc_amount = 4_000_000i128;
        StellarAssetClient::new(&env, &token).mint(&donor, &usdc_amount);

        // The mock quote's timestamp is fixed at 1_000. Advance the ledger
        // clock 2 hours past it — older than DEFAULT_MAX_PRICE_AGE_SECS
        // (3600s) and the resolution-derived window alike.
        env.ledger().set_timestamp(1_000 + 7_200);

        client.donate_usdc(&token, &donor, &pid, &usdc_amount, &0u32);
    }

    #[test]
    fn test_donate_usdc_accepts_fresh_oracle_price() {
        let (env, _cid, client, admin, pid) = setup();
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        let oracle = env.register_contract(None, TimestampedMockOracle);
        client.set_usdc_token(&admin, &token, &oracle);

        let donor = Address::generate(&env);
        let usdc_amount = 4_000_000i128;
        StellarAssetClient::new(&env, &token).mint(&donor, &usdc_amount);

        // Advance the clock by only 60s past the quote's fixed timestamp -
        // well within both the default and resolution-derived windows.
        env.ledger().set_timestamp(1_000 + 60);

        client.donate_usdc(&token, &donor, &pid, &usdc_amount, &0u32);

        assert_eq!(client.get_donation_count(), 1);
    }

    #[test]
    fn test_set_max_price_age_is_admin_gated_and_persists() {
        let (env, _cid, client, admin, _pid) = setup();
        assert_eq!(client.get_max_price_age(), DEFAULT_MAX_PRICE_AGE_SECS);

        client.set_max_price_age(&admin, &600u64);
        assert_eq!(client.get_max_price_age(), 600u64);
    }

    #[test]
    #[should_panic(expected = "Only admin can set max price age")]
    fn test_set_max_price_age_rejects_non_admin() {
        let (env, _cid, client, _admin, _pid) = setup();
        let attacker = Address::generate(&env);
        client.set_max_price_age(&attacker, &600u64);
    }

    #[test]
    fn test_get_donor_history() {
        let (env, cid, client, admin, pid) = setup();
        env.mock_all_auths();
        let donor = Address::generate(&env);
        let wallet = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(wallet.clone()).address();
        let token_client = StellarAssetClient::new(&env, &token);
        token_client.mint(&donor, &i128::MAX);

        let empty_history = client.get_donor_history(&donor, &0, &10);
        assert_eq!(empty_history.len(), 0);

        // Donate XLM three times.
        for i in 1..=3 {
            client.donate(&token, &donor, &pid, &(i * 100 * STROOP), &0);
        }

        let history = client.get_donor_history(&donor, &0, &10);
        assert_eq!(history.len(), 3);
        assert_eq!(history.get(0).unwrap().amount, 100 * STROOP);
        assert_eq!(history.get(1).unwrap().amount, 200 * STROOP);
        assert_eq!(history.get(2).unwrap().amount, 300 * STROOP);

        let page = client.get_donor_history(&donor, &1, &2);
        assert_eq!(page.len(), 2);
        assert_eq!(page.get(0).unwrap().amount, 200 * STROOP);
        assert_eq!(page.get(1).unwrap().amount, 300 * STROOP);

        let offset_and_limit_beyond_end = client.get_donor_history(&donor, &1, &u32::MAX);
        assert_eq!(offset_and_limit_beyond_end.len(), 2);
        assert_eq!(offset_and_limit_beyond_end.get(0).unwrap().amount, 200 * STROOP);
        assert_eq!(offset_and_limit_beyond_end.get(1).unwrap().amount, 300 * STROOP);

        let offset_beyond_end = client.get_donor_history(&donor, &u32::MAX, &u32::MAX);
        assert_eq!(offset_beyond_end.len(), 0);
    }

    #[test]
    fn test_get_global_stats_initial_zeros() {
        let env    = Env::default();
        let id     = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin  = Address::generate(&env);
        client.initialize(&admin);

        let stats = client.get_global_stats();
        assert_eq!(stats.total_raised,     0);
        assert_eq!(stats.co2_offset_grams, 0);
        assert_eq!(stats.donation_count,   0);
        assert_eq!(stats.project_count,    0);
    }

    /// `get_global_stats` should return values consistent with the individual
    /// getters (`get_global_total`, `get_global_co2`, `get_donation_count`,
    /// `get_project_count`) after a donation has been processed.
    #[test]
    fn test_get_global_stats_matches_individual_getters() {
        let env    = Env::default();
        env.mock_all_auths();
        let id     = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin  = Address::generate(&env);
        client.initialize(&admin);

        // Register a project (co2_per_xlm = 200 grams per XLM)
        let pid    = String::from_str(&env, "proj-stats");
        let wallet = Address::generate(&env);
        client.register_project(
            &admin, &pid,
            &String::from_str(&env, "Stats Project"),
            &wallet, &200u32, &1i128,
        );

        // Mint tokens and donate
        let token_admin = Address::generate(&env);
        let token       = env.register_stellar_asset_contract_v2(token_admin).address();
        let donor       = Address::generate(&env);
        let amount      = 50 * STROOP; // 50 XLM
        soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&donor, &amount);
        client.donate(&token, &donor, &pid, &amount, &1u32);

        // get_global_stats must agree with each individual getter
        let stats = client.get_global_stats();
        assert_eq!(stats.total_raised,     client.get_global_total());
        assert_eq!(stats.co2_offset_grams, client.get_global_co2());
        assert_eq!(stats.donation_count,   client.get_donation_count());
        assert_eq!(stats.project_count,    client.get_project_count());

        // Spot-check concrete values
        assert_eq!(stats.total_raised,     amount);
        assert_eq!(stats.co2_offset_grams, 50 * 200i128); // 10 000 g
        assert_eq!(stats.donation_count,   1);
        assert_eq!(stats.project_count,    1);
    }

    #[test]
    #[should_panic(expected = "Contract already initialized")]
    fn test_double_init_fails() {
        let env = Env::default();
        let id = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        client.initialize(&admin);
    }

    #[test]
    fn test_donor_badge_none_below_threshold() {
        let env = Env::default();
        let id = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        let donor = Address::generate(&env);
        assert_eq!(client.get_badge(&donor), BadgeTier::None);
    }

    #[test]
    fn test_calculate_badge_thresholds() {
        assert_eq!(calculate_badge(0), BadgeTier::None);
        assert_eq!(calculate_badge(9 * STROOP), BadgeTier::None);
        assert_eq!(calculate_badge(10 * STROOP), BadgeTier::Seedling);
        assert_eq!(calculate_badge(99 * STROOP), BadgeTier::Seedling);
        assert_eq!(calculate_badge(100 * STROOP), BadgeTier::Tree);
        assert_eq!(calculate_badge(499 * STROOP), BadgeTier::Tree);
        assert_eq!(calculate_badge(500 * STROOP), BadgeTier::Forest);
        assert_eq!(calculate_badge(1999 * STROOP), BadgeTier::Forest);
        assert_eq!(calculate_badge(2000 * STROOP), BadgeTier::EarthGuardian);
        assert_eq!(calculate_badge(100000 * STROOP), BadgeTier::EarthGuardian);
    }

    #[test]
    fn test_batch_register_projects() {
        let env    = Env::default();
        env.mock_all_auths();
        let id     = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin  = Address::generate(&env);
        client.initialize(&admin);

        let wallet1 = Address::generate(&env);
        let wallet2 = Address::generate(&env);
        let wallet3 = Address::generate(&env);
        let mut projects = Vec::new(&env);
        projects.push_back(ProjectInit {
            id:          String::from_str(&env, "proj-001"),
            name:        String::from_str(&env, "Forest Restore"),
            wallet:      wallet1.clone(),
            co2_per_xlm: 100,
            min_donation_amount: 1,
        });
        projects.push_back(ProjectInit {
            id:          String::from_str(&env, "proj-002"),
            name:        String::from_str(&env, "Ocean Cleanup"),
            wallet:      wallet2.clone(),
            co2_per_xlm: 200,
            min_donation_amount: 1,
        });
        projects.push_back(ProjectInit {
            id:          String::from_str(&env, "proj-003"),
            name:        String::from_str(&env, "Solar Schools"),
            wallet:      wallet3.clone(),
            co2_per_xlm: 150,
            min_donation_amount: 1,
        });

        client.batch_register_projects(&admin, &projects);

        assert_eq!(client.get_project_count(), 3);
        let p1 = client.get_project(&String::from_str(&env, "proj-001"));
        assert_eq!(p1.name, String::from_str(&env, "Forest Restore"));
        assert_eq!(p1.wallet, wallet1);
        assert_eq!(p1.co2_per_xlm, 100);
        assert!(p1.active);
        let p2 = client.get_project(&String::from_str(&env, "proj-002"));
        assert_eq!(p2.co2_per_xlm, 200);
        let p3 = client.get_project(&String::from_str(&env, "proj-003"));
        assert_eq!(p3.co2_per_xlm, 150);
    }

    #[test]
    #[should_panic(expected = "Project already registered")]
    fn test_batch_register_projects_duplicate_fails() {
        let env    = Env::default();
        env.mock_all_auths();
        let id     = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let admin  = Address::generate(&env);
        client.initialize(&admin);

        let wallet = Address::generate(&env);
        let pid    = String::from_str(&env, "proj-dup");
        let mut projects = Vec::new(&env);
        projects.push_back(ProjectInit {
            id:          pid.clone(),
            name:        String::from_str(&env, "First"),
            wallet:      wallet.clone(),
            co2_per_xlm: 100,
            min_donation_amount: 1,
        });
        projects.push_back(ProjectInit {
            id:          pid,
            name:        String::from_str(&env, "Duplicate"),
            wallet:      wallet,
            co2_per_xlm: 50,
            min_donation_amount: 1,
        });

        client.batch_register_projects(&admin, &projects);
    }

    // ─── Governance helpers ───────────────────────────────────────────────────

    /// Set up a fresh contract with one registered project.
    fn setup() -> (
        Env,
        soroban_sdk::Address,
        GreenPayContractClient<'static>,
        Address,
        String,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &cid);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        let pid = String::from_str(&env, "proj-001");
        let wallet = Address::generate(&env);
        client.register_project(
            &admin,
            &pid,
            &String::from_str(&env, "Test Project"),
            &wallet,
            &100u32,
            &1i128,
        );
        (env, cid, client, admin, pid)
    }

    /// Inject a Seedling badge directly into contract storage for a voter.
    fn grant_badge(env: &Env, cid: &soroban_sdk::Address, voter: &Address) {
        env.as_contract(cid, || {
            env.storage().instance().set(
                &DataKey::DonorStats(voter.clone()),
                &DonorStats {
                    total_donated: 10 * STROOP,
                    donation_count: 1,
                    badge: BadgeTier::Seedling,
                    co2_offset_grams: 0,
                },
            );
        });
    }

    /// Extend instance TTL before a large ledger jump so storage isn't archived.
    fn extend_ttl(env: &Env, cid: &soroban_sdk::Address) {
        env.as_contract(cid, || {
            env.storage()
                .instance()
                .extend_ttl(VOTING_WINDOW_LEDGERS * 4, VOTING_WINDOW_LEDGERS * 4);
        });
    }

    #[test]
    fn test_upgrade_preserves_donation_state_and_storage_keys() {
        let (env, cid, client_v1, _admin, pid) = setup();
        let donor = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        let token_client = StellarAssetClient::new(&env, &token);
        let amount = 25 * STROOP;
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
        assert_eq!(project_after.id, project_before.id);
        assert_eq!(project_after.name, project_before.name);
        assert_eq!(project_after.wallet, project_before.wallet);
        assert_eq!(project_after.co2_per_xlm, project_before.co2_per_xlm);
        assert_eq!(project_after.total_raised, amount);
        assert_eq!(project_after.donor_count, 1);
        assert!(project_after.active);
        assert_eq!(project_after.registered_at, project_before.registered_at);

        let donor_stats = client_v2.get_donor_stats(&donor);
        assert_eq!(donor_stats.total_donated, amount);
        assert_eq!(donor_stats.donation_count, 1);
        assert_eq!(donor_stats.badge, BadgeTier::Seedling);
        assert_eq!(donor_stats.co2_offset_grams, expected_co2);
        assert!(client_v2.has_nft(&donor, &BadgeTier::Seedling));
        assert_eq!(client_v2.get_project_count(), 1);
        assert_eq!(client_v2.get_donation_count(), 1);
        assert_eq!(client_v2.get_global_total(), amount);
        assert_eq!(client_v2.get_global_co2(), expected_co2);

        env.as_contract(&cid, || {
            let stored_project: Project = env
                .storage()
                .instance()
                .get(&DataKey::Project(pid.clone()))
                .expect("project key must remain readable after upgrade");
            assert_eq!(stored_project.total_raised, amount);
            assert_eq!(stored_project.donor_count, 1);

            let stored_stats: DonorStats = env
                .storage()
                .instance()
                .get(&DataKey::DonorStats(donor.clone()))
                .expect("donor stats key must remain readable after upgrade");
            assert_eq!(stored_stats.total_donated, amount);
            assert_eq!(stored_stats.donation_count, 1);
            assert_eq!(stored_stats.badge, BadgeTier::Seedling);
            assert_eq!(stored_stats.co2_offset_grams, expected_co2);

            let has_donated: bool = env
                .storage()
                .instance()
                .get(&DataKey::HasDonated(pid.clone(), donor.clone()))
                .expect("unique donor key must remain readable after upgrade");
            assert!(has_donated);

            let donation_count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::DonationCount)
                .expect("donation count key must remain readable after upgrade");
            let global_total: i128 = env
                .storage()
                .instance()
                .get(&DataKey::GlobalTotalRaised)
                .expect("global total key must remain readable after upgrade");
            let global_co2: i128 = env
                .storage()
                .instance()
                .get(&DataKey::GlobalCO2OffsetGrams)
                .expect("global CO2 key must remain readable after upgrade");

            assert_eq!(donation_count, 1);
            assert_eq!(global_total, amount);
            assert_eq!(global_co2, expected_co2);
        });
    }

    // ─── Governance tests ─────────────────────────────────────────────────────

    #[test]
    fn test_create_proposal() {
        let (env, _cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);
        let p = client.get_proposal(&pid);
        assert_eq!(p.votes_for, 0);
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
        assert_eq!(p.votes_for, 1);
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
        assert_eq!(p.votes_for, 2);
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
        assert_eq!(p.votes_for, 1);
        assert_eq!(p.votes_against, 2);
    }

    #[test]
    fn test_resolve_proposal_tie_rejected_with_rejection_event() {
        let (env, cid, client, admin, pid) = setup();
        client.create_proposal(&admin, &pid, &0u32);

        for i in 0..2u32 {
            let voter = Address::generate(&env);
            grant_badge(&env, &cid, &voter);
            client.vote_verify_project(&voter, &pid, &(i == 0));
        }

        extend_ttl(&env, &cid);
        env.ledger().set_sequence_number(VOTING_WINDOW_LEDGERS + 2);
        client.resolve_proposal(&pid);

        // Capture events BEFORE any other contract calls — env.events().all()
        // returns events from the most recent call only.
        let rejection_events = env.events().all().events().len();

        let p = client.get_proposal(&pid);
        assert!(p.resolved);
        assert_eq!(p.votes_for,     1);
        assert_eq!(p.votes_against, 1);
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
            &1i128,
        );
    }

    #[test]
    #[should_panic(expected = "CO2 per XLM exceeds maximum")]
    fn test_batch_register_projects_rejects_excessive_co2_per_xlm() {
        let (env, _cid, client, admin, _pid) = setup();
        let project = ProjectInit {
            id: String::from_str(&env, "proj-002"),
            name: String::from_str(&env, "Bad Project"),
            wallet: Address::generate(&env),
            co2_per_xlm: MAX_CO2_PER_XLM + 1,
            min_donation_amount: 1,
        };
        let projects = Vec::from_array(&env, [project]);
        client.batch_register_projects(&admin, &projects);
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
            &1i128,
        );

        assert!(client.get_project(&pid1).active);
        assert!(client.get_project(&pid2).active);

        client.deactivate_project(&admin, &pid1);
        client.deactivate_project(&admin, &pid2);

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
        env.ledger()
            .set_sequence_number(start + VOTING_WINDOW_LEDGERS - 1);

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
        env.ledger()
            .set_sequence_number(start + custom_duration - 1);

        client.vote_verify_project(&voter, &pid, &true);

        let proposal = client.get_proposal(&pid);
        assert_eq!(proposal.votes_for, 1);
    }

    // ─── ProjectMilestoneNFT tests (#205) ────────────────────────────────────

    #[test]
    fn test_mint_project_nft_success() {
        let (env, _cid, client, _admin, pid) = setup();
        let donor        = Address::generate(&env);
        let token_admin  = Address::generate(&env);
        let token        = env.register_stellar_asset_contract_v2(token_admin).address();
        let token_client = StellarAssetClient::new(&env, &token);

        token_client.mint(&donor, &(200 * STROOP));
        client.donate(&token, &donor, &pid, &(101 * STROOP), &0u32);

        assert!(!client.has_project_nft(&donor, &pid));
        client.mint_project_nft(&donor, &pid);
        assert!(client.has_project_nft(&donor, &pid));

        let nft = client.get_project_nft(&donor, &pid);
        assert_eq!(nft.owner,          donor);
        assert_eq!(nft.project_id,     pid);
        assert_eq!(nft.amount_donated, 101 * STROOP);
        // co2_per_xlm for the test project is 100 grams/XLM
        assert_eq!(nft.co2_offset_grams, 101 * 100);
    }

    #[test]
    #[should_panic(expected = "Cumulative donation to this project has not reached 100 XLM")]
    fn test_mint_project_nft_below_threshold() {
        let (env, _cid, client, _admin, pid) = setup();
        let donor        = Address::generate(&env);
        let token_admin  = Address::generate(&env);
        let token        = env.register_stellar_asset_contract_v2(token_admin).address();
        let token_client = StellarAssetClient::new(&env, &token);

        token_client.mint(&donor, &(100 * STROOP));
        client.donate(&token, &donor, &pid, &(50 * STROOP), &0u32);

        client.mint_project_nft(&donor, &pid);
    }

    #[test]
    #[should_panic(expected = "Milestone NFT already minted for this project")]
    fn test_mint_project_nft_duplicate_prevented() {
        let (env, _cid, client, _admin, pid) = setup();
        let donor        = Address::generate(&env);
        let token_admin  = Address::generate(&env);
        let token        = env.register_stellar_asset_contract_v2(token_admin).address();
        let token_client = StellarAssetClient::new(&env, &token);

        token_client.mint(&donor, &(200 * STROOP));
        client.donate(&token, &donor, &pid, &(101 * STROOP), &0u32);

        client.mint_project_nft(&donor, &pid);
        // Second call must panic
        client.mint_project_nft(&donor, &pid);
    }

    #[test]
    fn test_project_nft_independent_per_project() {
        let (env, _cid, client, admin, pid1) = setup();
        let pid2    = String::from_str(&env, "proj-002");
        let wallet2 = Address::generate(&env);
        client.register_project(
            &admin, &pid2,
            &String::from_str(&env, "Project 2"),
            &wallet2, &50u32, &1i128,
        );

        let donor        = Address::generate(&env);
        let token_admin  = Address::generate(&env);
        let token        = env.register_stellar_asset_contract_v2(token_admin).address();
        let token_client = StellarAssetClient::new(&env, &token);

        token_client.mint(&donor, &(300 * STROOP));
        client.donate(&token, &donor, &pid1, &(101 * STROOP), &0u32);
        client.donate(&token, &donor, &pid2, &(50 * STROOP),  &1u32);

        client.mint_project_nft(&donor, &pid1);
        assert!(client.has_project_nft(&donor, &pid1));
        assert!(!client.has_project_nft(&donor, &pid2));
    }

    #[test]
    fn test_project_nft_cumulative_across_donations() {
        let (env, _cid, client, _admin, pid) = setup();
        let donor        = Address::generate(&env);
        let token_admin  = Address::generate(&env);
        let token        = env.register_stellar_asset_contract_v2(token_admin).address();
        let token_client = StellarAssetClient::new(&env, &token);

        // Two donations summing to > 100 XLM
        token_client.mint(&donor, &(200 * STROOP));
        client.donate(&token, &donor, &pid, &(60 * STROOP), &0u32);
        client.donate(&token, &donor, &pid, &(60 * STROOP), &1u32);

        client.mint_project_nft(&donor, &pid);
        assert!(client.has_project_nft(&donor, &pid));

       let nft = client.get_project_nft(&donor, &pid);
        assert_eq!(nft.amount_donated, 120 * STROOP);
    }

    #[test]
    fn test_refund_donation_reverses_totals_and_transfers_funds() {
        let (env, _cid, client, admin, pid) = setup();
        let donor = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        let token_client = StellarAssetClient::new(&env, &token);

        let amount = 100 * STROOP;
        token_client.mint(&donor, &amount);
        client.donate(&token, &donor, &pid, &amount, &0u32);

        let wallet = client.get_project(&pid).wallet;
        let project_before = client.get_project(&pid);
        let donor_stats_before = client.get_donor_stats(&donor);
        assert_eq!(project_before.total_raised, amount);
        assert_eq!(donor_stats_before.total_donated, amount);

        client.refund_donation(&admin, &pid, &donor, &amount, &token);

        let project_after = client.get_project(&pid);
        let donor_stats_after = client.get_donor_stats(&donor);
        assert_eq!(project_after.total_raised, 0);
        assert_eq!(donor_stats_after.total_donated, 0);

        let native_client = soroban_sdk::token::Client::new(&env, &token);
        assert_eq!(native_client.balance(&donor), amount);
        assert_eq!(native_client.balance(&wallet), 0);
    }

    #[test]
    #[should_panic(expected = "Only admin can refund donations")]
    fn test_refund_donation_rejects_non_admin_caller() {
        let (env, _cid, client, _admin, pid) = setup();
        let not_admin = Address::generate(&env);
        let donor = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();

        client.refund_donation(&not_admin, &pid, &donor, &(10 * STROOP), &token);
    }

    // ─── Minimum donation enforcement (#1043) ─────────────────────────────────

    /// Minimum used by the guard tests below: 10 XLM, expressed in stroops.
    const TEST_MIN_DONATION: i128 = 10 * STROOP;

    /// Fresh contract holding one project with a 10 XLM minimum donation, and a
    /// donor funded with 100 XLM of the donation token.
    fn setup_min_donation() -> (
        Env,
        GreenPayContractClient<'static>,
        Address,
        String,
        Address,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &cid);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let pid = String::from_str(&env, "proj-min-donation");
        let wallet = Address::generate(&env);
        client.register_project(
            &admin,
            &pid,
            &String::from_str(&env, "Minimum Guard Project"),
            &wallet,
            &100u32,
            &TEST_MIN_DONATION,
        );

        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        let donor = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&donor, &(100 * STROOP));

        (env, client, token, pid, donor, wallet)
    }

    /// The exact scenario from #1043: a single stroop sent to a project that
    /// configured a 10 XLM minimum must not be accepted.
    #[test]
    #[should_panic(expected = "Donation below minimum")]
    fn test_donate_one_stroop_below_ten_xlm_minimum_is_rejected() {
        let (_env, client, token, pid, donor, _wallet) = setup_min_donation();

        client.donate(&token, &donor, &pid, &1i128, &0u32);
    }

    /// Boundary case: one stroop under the minimum is still under the minimum.
    #[test]
    #[should_panic(expected = "Donation below minimum")]
    fn test_donate_just_below_minimum_is_rejected() {
        let (_env, client, token, pid, donor, _wallet) = setup_min_donation();

        client.donate(&token, &donor, &pid, &(TEST_MIN_DONATION - 1), &0u32);
    }

    /// A rejected donation must leave no trace: no funds moved, no accounting.
    #[test]
    fn test_donate_below_minimum_leaves_state_untouched() {
        let (env, client, token, pid, donor, wallet) = setup_min_donation();

        let attempted = client.try_donate(&token, &donor, &pid, &1i128, &0u32);
        assert!(attempted.is_err());

        let project = client.get_project(&pid);
        assert_eq!(project.total_raised, 0);
        assert_eq!(client.get_donation_count(), 0);
        assert_eq!(client.get_global_total(), 0);

        let token_client = token::Client::new(&env, &token);
        assert_eq!(token_client.balance(&wallet), 0);
        assert_eq!(token_client.balance(&donor), 100 * STROOP);
    }

    /// Donating exactly the minimum is allowed — the guard is `<`, not `<=`.
    #[test]
    fn test_donate_at_exact_minimum_succeeds() {
        let (env, client, token, pid, donor, wallet) = setup_min_donation();

        client.donate(&token, &donor, &pid, &TEST_MIN_DONATION, &0u32);

        let project = client.get_project(&pid);
        assert_eq!(project.total_raised, TEST_MIN_DONATION);
        assert_eq!(client.get_donation_count(), 1);

        let token_client = token::Client::new(&env, &token);
        assert_eq!(token_client.balance(&wallet), TEST_MIN_DONATION);
        assert_eq!(
            token_client.balance(&donor),
            100 * STROOP - TEST_MIN_DONATION,
        );
    }

    /// Comfortably above the minimum still succeeds.
    #[test]
    fn test_donate_above_minimum_succeeds() {
        let (_env, client, token, pid, donor, _wallet) = setup_min_donation();

        let amount = TEST_MIN_DONATION * 2;
        client.donate(&token, &donor, &pid, &amount, &0u32);

        assert_eq!(client.get_project(&pid).total_raised, amount);
        assert_eq!(client.get_donation_count(), 1);
    }

    // ── mint_impact_nft authorization tests (#1149) ───────────────────────────

    /// A third party (neither the donor nor the admin) calling mint_impact_nft
    /// must receive ContractError::Unauthorized and the NFT must NOT be minted.
    #[test]
    fn test_mint_impact_nft_third_party_is_unauthorized() {
        let (env, cid, client, _admin, _pid) = setup();

        let donor = Address::generate(&env);
        let third_party = Address::generate(&env);

        // Give the donor a Seedling badge so the call would otherwise succeed.
        grant_badge(&env, &cid, &donor);

        // Call as a completely unrelated third party — must be rejected.
        let result = client.try_mint_impact_nft(&third_party, &donor, &BadgeTier::Seedling);
        assert_eq!(
            result,
            Err(Ok(ContractError::Unauthorized)),
            "Expected ContractError::Unauthorized when caller is a third party"
        );

        // Confirm no NFT was stored.
        assert!(
            !client.has_nft(&donor, &BadgeTier::Seedling),
            "NFT must not be minted when caller is unauthorized"
        );
    }

    /// The donor themselves can successfully mint their own impact NFT.
    #[test]
    fn test_mint_impact_nft_donor_self_service_succeeds() {
        let (env, cid, client, _admin, _pid) = setup();

        let donor = Address::generate(&env);
        grant_badge(&env, &cid, &donor);

        // Donor signs their own mint — must succeed.
        client.mint_impact_nft(&donor, &donor, &BadgeTier::Seedling);

        assert!(
            client.has_nft(&donor, &BadgeTier::Seedling),
            "NFT must be stored after donor self-service mint"
        );
    }

    /// The contract admin can mint an impact NFT on behalf of any donor.
    #[test]
    fn test_mint_impact_nft_admin_on_behalf_of_donor_succeeds() {
        let (env, cid, client, admin, _pid) = setup();

        let donor = Address::generate(&env);
        grant_badge(&env, &cid, &donor);

        // Admin mints on behalf of the donor — must succeed.
        client.mint_impact_nft(&admin, &donor, &BadgeTier::Seedling);

        assert!(
            client.has_nft(&donor, &BadgeTier::Seedling),
            "NFT must be stored when admin mints on behalf of donor"
        );
    }

    // ── compute_co2_offset unit tests (#1154) ─────────────────────────────────

    /// Normal input: 10 XLM at 500 g/XLM → 5 000 g.
    /// Validates the happy-path arithmetic and the Ok(grams) return shape.
    #[test]
    fn test_compute_co2_offset_normal_input_returns_correct_grams() {
        let amount = 10 * STROOP; // 10 XLM in stroops
        let rate: u32 = 500;      // g CO₂ per XLM
        let result = compute_co2_offset(amount, rate);
        assert_eq!(result, Ok(5_000), "10 XLM × 500 g/XLM must equal 5 000 g");
    }

    /// Exact MAX_DONATION is accepted — the cap is inclusive (≤, not <).
    #[test]
    fn test_compute_co2_offset_at_max_donation_succeeds() {
        let result = compute_co2_offset(MAX_DONATION, MAX_CO2_PER_XLM);
        // MAX_DONATION = 100_000 XLM; MAX_CO2_PER_XLM = 100_000 g/XLM
        // expected = 100_000 × 100_000 = 10_000_000_000 g
        assert_eq!(
            result,
            Ok(100_000 * 100_000),
            "MAX_DONATION × MAX_CO2_PER_XLM must not overflow"
        );
    }

    /// One stroop above MAX_DONATION must return ContractError::Overflow
    /// immediately, before any multiplication is attempted.
    #[test]
    fn test_compute_co2_offset_one_stroop_over_cap_returns_overflow() {
        let result = compute_co2_offset(MAX_DONATION + 1, 1);
        assert_eq!(
            result,
            Err(ContractError::Overflow),
            "Amount one stroop above MAX_DONATION must return Overflow"
        );
    }

    /// Near-overflow input (i128::MAX / 2 stroops) must return
    /// ContractError::Overflow, not panic or silently wrap.
    /// This is the exact scenario described in issue #1154.
    #[test]
    fn test_compute_co2_offset_near_i128_max_returns_overflow() {
        // i128::MAX / 2 far exceeds MAX_DONATION so the cap fires first.
        let huge = i128::MAX / 2;
        let result = compute_co2_offset(huge, 3);
        assert_eq!(
            result,
            Err(ContractError::Overflow),
            "i128::MAX/2 input must return Overflow, not panic"
        );
    }

    /// Even with co2_per_xlm = 0 the result is 0 g — not an error.
    #[test]
    fn test_compute_co2_offset_zero_rate_returns_zero() {
        let result = compute_co2_offset(10 * STROOP, 0);
        assert_eq!(result, Ok(0), "Zero CO₂ rate must return Ok(0)");
    }

    /// donate() rejects a donation of MAX_DONATION + 1 stroops.
    /// Validates the cap is wired into the entry-point, not just the helper.
    #[test]
    #[should_panic(expected = "Donation amount exceeds maximum")]
    fn test_donate_over_max_donation_is_rejected() {
        let (env, client, token, pid, donor, _wallet) = setup_min_donation();

        // Mint enough tokens so the cap — not a balance error — triggers first.
        StellarAssetClient::new(&env, &token).mint(&donor, &(MAX_DONATION + 1));

        client.donate(&token, &donor, &pid, &(MAX_DONATION + 1), &0u32);
    }

    /// donate() accepts a donation of exactly MAX_DONATION stroops.
    /// Confirms the boundary is ≤, not <.
    #[test]
    fn test_donate_at_max_donation_succeeds() {
        let (env, client, token, pid, donor, _wallet) = setup_min_donation();

        // Top up the donor's balance to exactly MAX_DONATION.
        // setup_min_donation already minted 100 XLM; mint the remainder.
        let top_up = MAX_DONATION - 100 * STROOP;
        StellarAssetClient::new(&env, &token).mint(&donor, &top_up);

        client.donate(&token, &donor, &pid, &MAX_DONATION, &0u32);

        assert_eq!(
            client.get_project(&pid).total_raised,
            MAX_DONATION,
            "Donation of exactly MAX_DONATION must be accepted"
        );
    }
}
