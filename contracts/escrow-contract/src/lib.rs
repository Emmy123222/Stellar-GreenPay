#![no_std]

//! Escrow contract with milestone-based fund release.
//! Client locks funds with `create_job`, then releases them per milestone.

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum JobStatus {
    Escrowed,
    PartiallyReleased,
    Completed,
    Disputed,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub name: String,
    pub percentage: u32,  // 0-100
    pub released: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Job {
    pub id: String,
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub amount: i128,
    pub status: JobStatus,
    pub milestones: Vec<Milestone>,
    pub disputed: bool,
    pub release_after: u32,
}

#[contracttype]
pub enum DataKey {
    Job(String),
    Admin,
    ProposedAdmin,
}

pub const RELEASE_AFTER_LEDGERS: u32 = 10;

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Initialize contract with admin address.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Propose a new admin address. Only the current admin can propose.
    pub fn propose_admin(env: Env, current_admin: Address, new_admin: Address) {
        current_admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != current_admin {
            panic!("Only admin can propose new admin");
        }
        env.storage()
            .instance()
            .set(&DataKey::ProposedAdmin, &new_admin);
    }

    /// Accept the proposed admin role. Only the proposed new admin can accept.
    pub fn accept_admin(env: Env, new_admin: Address) {
        new_admin.require_auth();
        let proposed_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProposedAdmin)
            .expect("No proposed admin");
        if proposed_admin != new_admin {
            panic!("Not the proposed admin");
        }
        env.storage()
            .instance()
            .set(&DataKey::Admin, &new_admin);
        env.storage()
            .instance()
            .remove(&DataKey::ProposedAdmin);
    }

    /// Get the current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    /// Get the proposed admin address, if any.
    pub fn get_proposed_admin(env: Env) -> Option<Address> {
        env.storage()
            .instance()
            .get(&DataKey::ProposedAdmin)
    }

    /// Client funds escrow with milestones: transfers `amount` of `token` from client into this contract.
    pub fn create_job(
        env: Env,
        client: Address,
        freelancer: Address,
        job_id: String,
        token: Address,
        amount: i128,
        milestones: Vec<Milestone>,
    ) {
        client.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        if env.storage().instance().has(&DataKey::Job(job_id.clone())) {
            panic!("Job already exists");
        }

        // Validate milestones sum to 100%
        let mut total_percentage: u32 = 0;
        for milestone in milestones.iter() {
            total_percentage = total_percentage.checked_add(milestone.percentage)
                .expect("Milestone percentage overflow");
        }
        if total_percentage != 100 {
            panic!("Milestones must sum to 100%");
        }

        let token_client = token::Client::new(&env, &token);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&client, &contract_addr, &amount);

        let job = Job {
            id: job_id.clone(),
            client: client.clone(),
            freelancer,
            token: token.clone(),
            amount,
            status: JobStatus::Escrowed,
            milestones,
            disputed: false,
            release_after: env.ledger().sequence() + RELEASE_AFTER_LEDGERS,
        };
        env.storage().instance().set(&DataKey::Job(job_id), &job);
    }

    /// Client releases a specific milestone. Pays proportional XLM to freelancer.
    pub fn release_milestone(env: Env, client: Address, job_id: String, milestone_index: u32) {
        client.require_auth();
        let mut job: Job = env
            .storage()
            .instance()
            .get(&DataKey::Job(job_id.clone()))
            .expect("Job not found");

        if job.client != client {
            panic!("Only the client can release");
        }
        if job.disputed {
            panic!("Job is disputed; admin must resolve");
        }
        if milestone_index >= job.milestones.len() {
            panic!("Invalid milestone index");
        }

<<<<<<< HEAD
        let milestone = &job.milestones.get(milestone_index).unwrap();
=======
        let milestone = job.milestones.get(milestone_index).unwrap();
>>>>>>> 827cfd4 (fix: resolve 9 CI failures across backend, frontend, contracts, helm, and security scans)
        if milestone.released {
            panic!("Milestone already released");
        }

        // Calculate proportional amount
        let proportion = milestone.percentage as i128;
        let release_amount = (job.amount * proportion) / 100i128;

        let token_client = token::Client::new(&env, &job.token);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&contract_addr, &job.freelancer, &release_amount);

<<<<<<< HEAD
        // Mark milestone as released (soroban Vec has no iter_mut/get_mut —
        // mutate via index-based get/set)
        let mut updated_milestones = job.milestones.clone();
        let mut released_count = 0u32;
        let mut i: u32 = 0;
        while i < updated_milestones.len() {
            let mut m = updated_milestones.get(i).unwrap();
            if i == milestone_index {
=======
        // Mark milestone as released and count total released
        let mut updated_milestones: Vec<Milestone> = Vec::new(&env);
        let mut released_count = 0u32;
        let len = job.milestones.len();
        let mut idx = 0u32;
        while idx < len {
            let mut m = job.milestones.get(idx).unwrap();
            if idx == milestone_index {
>>>>>>> 827cfd4 (fix: resolve 9 CI failures across backend, frontend, contracts, helm, and security scans)
                m.released = true;
            }
            if m.released {
                released_count = released_count.checked_add(1).expect("released_count overflow");
            }
<<<<<<< HEAD
            updated_milestones.set(i, m);
            i = i.checked_add(1).expect("milestone index overflow");
=======
            updated_milestones.push_back(m);
            idx += 1;
>>>>>>> 827cfd4 (fix: resolve 9 CI failures across backend, frontend, contracts, helm, and security scans)
        }
        job.milestones = updated_milestones;

        // Update job status
<<<<<<< HEAD
        if released_count == job.milestones.len() {
=======
        if released_count == len {
>>>>>>> 827cfd4 (fix: resolve 9 CI failures across backend, frontend, contracts, helm, and security scans)
            job.status = JobStatus::Completed;
        } else {
            job.status = JobStatus::PartiallyReleased;
        }

        env.storage().instance().set(&DataKey::Job(job_id), &job);
    }

    /// Client or freelancer: Mark a job as disputed, freezing remaining releases.
    pub fn raise_dispute(env: Env, client: Address, job_id: String) {
        client.require_auth();

        let mut job: Job = env
            .storage()
            .instance()
            .get(&DataKey::Job(job_id.clone()))
            .expect("Job not found");

        if job.client != client && job.freelancer != client {
            panic!("Only client or freelancer can raise dispute");
        }
        job.disputed = true;
        job.status = JobStatus::Disputed;
        env.storage().instance().set(&DataKey::Job(job_id), &job);
    }

    /// Admin-only: Resolve a dispute and release remaining funds.
    pub fn resolve_dispute(env: Env, admin: Address, job_id: String, release_to_freelancer: bool) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can resolve disputes");
        }

        let mut job: Job = env
            .storage()
            .instance()
            .get(&DataKey::Job(job_id.clone()))
            .expect("Job not found");

        if !job.disputed {
            panic!("Job is not disputed");
        }

        if release_to_freelancer {
            // Release all unreleased milestones
            let mut total_unreleased: i128 = 0;
            for milestone in job.milestones.iter() {
                if !milestone.released {
                    let proportion = milestone.percentage as i128;
                    total_unreleased = total_unreleased.checked_add(
                        (job.amount * proportion) / 100i128
                    ).expect("total_unreleased overflow");
                }
            }

            if total_unreleased > 0 {
                let token_client = token::Client::new(&env, &job.token);
                let contract_addr = env.current_contract_address();
                token_client.transfer(&contract_addr, &job.freelancer, &total_unreleased);
            }

            job.status = JobStatus::Completed;
        } else {
            // Return funds to client (refund)
            let mut remaining_amount: i128 = 0;
            for milestone in job.milestones.iter() {
                if !milestone.released {
                    let proportion = milestone.percentage as i128;
                    remaining_amount = remaining_amount.checked_add(
                        (job.amount * proportion) / 100i128
                    ).expect("remaining_amount overflow");
                }
            }

            if remaining_amount > 0 {
                let token_client = token::Client::new(&env, &job.token);
                let contract_addr = env.current_contract_address();
                token_client.transfer(&contract_addr, &job.client, &remaining_amount);
            }

            job.status = JobStatus::Completed;
        }

        job.disputed = false;
        env.storage().instance().set(&DataKey::Job(job_id), &job);
    }

    /// Freelancer can claim a milestone after release_after ledgers if not disputed.
    pub fn claim_milestone(env: Env, freelancer: Address, job_id: String, milestone_index: u32) {
        freelancer.require_auth();
        let mut job: Job = env.storage().instance().get(&DataKey::Job(job_id.clone())).expect("Job not found");

        if job.disputed {
            panic!("Job is disputed; cannot claim milestone");
        }
        if env.ledger().sequence() < job.release_after {
            panic!("Release period not reached");
        }
        if milestone_index >= job.milestones.len() {
            panic!("Invalid milestone index");
        }
<<<<<<< HEAD
        let milestone = &job.milestones.get(milestone_index).unwrap();
=======
        let milestone = job.milestones.get(milestone_index).unwrap();
>>>>>>> 827cfd4 (fix: resolve 9 CI failures across backend, frontend, contracts, helm, and security scans)
        if milestone.released {
            panic!("Milestone already released");
        }
        // Calculate amount
        let proportion = milestone.percentage as i128;
        let release_amount = (job.amount * proportion) / 100i128;
        let token_client = token::Client::new(&env, &job.token);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&contract_addr, &job.freelancer, &release_amount);

        // Mark as released
<<<<<<< HEAD
        let mut updated_milestones = job.milestones.clone();
        let mut m = updated_milestones.get(milestone_index).unwrap();
        m.released = true;
        updated_milestones.set(milestone_index, m);
=======
        let mut updated_milestones: Vec<Milestone> = Vec::new(&env);
        let len = job.milestones.len();
        let mut all_released = true;
        let mut i = 0u32;
        while i < len {
            let mut m = job.milestones.get(i).unwrap();
            if i == milestone_index {
                m.released = true;
            }
            if !m.released {
                all_released = false;
            }
            updated_milestones.push_back(m);
            i += 1;
        }
>>>>>>> 827cfd4 (fix: resolve 9 CI failures across backend, frontend, contracts, helm, and security scans)
        job.milestones = updated_milestones;

        // Update status
        job.status = if all_released { JobStatus::Completed } else { JobStatus::PartiallyReleased };

        env.storage().instance().set(&DataKey::Job(job_id), &job);
    }

    pub fn get_job(env: Env, job_id: String) -> Option<Job> {
        env.storage().instance().get(&DataKey::Job(job_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{Address, Env, String, Vec};

    fn setup(env: &Env) -> (Address, EscrowContractClient) {
        let cid = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(env, &cid);
        let admin = Address::generate(env);
        client.initialize(&admin);
        (admin, client)
    }

    #[test]
    fn test_admin_rotation_success() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, client) = setup(&env);
        let new_admin = Address::generate(&env);

        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_proposed_admin(), None);

        client.propose_admin(&admin, &new_admin);
        assert_eq!(client.get_proposed_admin(), Some(new_admin.clone()));

        client.accept_admin(&new_admin);
        assert_eq!(client.get_admin(), new_admin);
        assert_eq!(client.get_proposed_admin(), None);
    }

    #[test]
    #[should_panic(expected = "Only admin can propose new admin")]
    fn test_propose_admin_unauthorized_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);
        let impostor = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.propose_admin(&impostor, &new_admin);
    }

    #[test]
    #[should_panic(expected = "Not the proposed admin")]
    fn test_accept_admin_wrong_address_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, client) = setup(&env);
        let new_admin = Address::generate(&env);
        let wrong_admin = Address::generate(&env);

        client.propose_admin(&admin, &new_admin);
        client.accept_admin(&wrong_admin);
    }

    #[test]
    #[should_panic(expected = "No proposed admin")]
    fn test_accept_admin_no_proposal_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);
        let new_admin = Address::generate(&env);

        client.accept_admin(&new_admin);
    }

    #[test]
    fn test_milestone_based_release() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);

        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        // Use a real Stellar asset token so create_job's transfer succeeds
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&client_addr, &1000i128);
        let job_id = String::from_str(&env, "job-1");

        // Create 3 milestones: 50%, 30%, 20%
        let mut milestones = Vec::new(&env);
        milestones.push_back(Milestone {
            name: String::from_str(&env, "Design"),
            percentage: 50,
            released: false,
        });
        milestones.push_back(Milestone {
            name: String::from_str(&env, "Development"),
            percentage: 30,
            released: false,
        });
        milestones.push_back(Milestone {
            name: String::from_str(&env, "Testing"),
            percentage: 20,
            released: false,
        });

        client.create_job(&client_addr, &freelancer, &job_id, &token, &1000i128, &milestones);

        let job = client.get_job(&job_id).expect("Job should exist");
        assert_eq!(job.status, JobStatus::Escrowed);
        assert_eq!(job.milestones.len(), 3);
    }

    #[test]
    #[should_panic(expected = "Milestones must sum to 100%")]
    fn test_milestone_validation() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);

        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = Address::generate(&env);
        let job_id = String::from_str(&env, "job-invalid");

        let mut milestones = Vec::new(&env);
        milestones.push_back(Milestone {
            name: String::from_str(&env, "M1"),
            percentage: 50,
            released: false,
        });
        milestones.push_back(Milestone {
            name: String::from_str(&env, "M2"),
            percentage: 40,
            released: false,
        });
        // Only 90%, should panic

        client.create_job(&client_addr, &freelancer, &job_id, &token, &1000i128, &milestones);
    }

    #[test]
    #[should_panic(expected = "Job not found")]
    fn release_missing_job_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);
        let addr = Address::generate(&env);
        client.release_milestone(&addr, &String::from_str(&env, "no-such-job"), &0u32);
    }

    #[test]
    fn test_dispute_freezes_release() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, client) = setup(&env);

        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        // Use a real Stellar asset token so create_job's transfer succeeds
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&client_addr, &1000i128);
        let job_id = String::from_str(&env, "job-dispute");

        let mut milestones = Vec::new(&env);
        milestones.push_back(Milestone {
            name: String::from_str(&env, "M1"),
            percentage: 100,
            released: false,
        });

        client.create_job(&client_addr, &freelancer, &job_id, &token, &1000i128, &milestones);

        // Dispute the job
        client.raise_dispute(&client_addr, &job_id);

        let job = client.get_job(&job_id).expect("Job should exist");
        assert_eq!(job.status, JobStatus::Disputed);
        assert!(job.disputed);
    }
}
