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
}

#[contract]
pub const RELEASE_AFTER_LEDGERS: u32 = 10;

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
        if milestone_index >= job.milestones.len() as u32 {
            panic!("Invalid milestone index");
        }

        let milestone = &job.milestones.get(milestone_index as usize).unwrap();
        if milestone.released {
            panic!("Milestone already released");
        }

        // Calculate proportional amount
        let proportion = milestone.percentage as i128;
        let release_amount = (job.amount * proportion) / 100i128;

        let token_client = token::Client::new(&env, &job.token);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&contract_addr, &job.freelancer, &release_amount);

        // Mark milestone as released
        let mut updated_milestones = job.milestones.clone();
        let mut released_count = 0u32;
        for (i, m) in updated_milestones.iter_mut().enumerate() {
            if i as u32 == milestone_index {
                m.released = true;
            }
            if m.released {
                released_count = released_count.checked_add(1).expect("released_count overflow");
            }
        }
        job.milestones = updated_milestones;

        // Update job status
        if released_count as usize == job.milestones.len() {
            job.status = JobStatus::Completed;
        } else {
            job.status = JobStatus::PartiallyReleased;
        }

        env.storage().instance().set(&DataKey::Job(job_id), &job);
    }

    /// Admin-only: Mark a job as disputed, freezing remaining releases.
    pub fn dispute_job(env: Env, admin: Address, job_id: String) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can dispute jobs");
        }

        let mut job: Job = env
            .storage()
            .instance()
            .get(&DataKey::Job(job_id.clone()))
            .expect("Job not found");
        job.disputed = true;
        job.status = JobStatus::Disputed;
        env.storage().instance().set(&DataKey::Job(job_id), &job);
    }

    /// Admin-only: Resolve a dispute and release remaining funds.
    pub fn resolve_dispute(env: Env, admin: Address, job_id: String, approve_remaining: bool) {
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

        if approve_remaining {
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
        if milestone_index >= job.milestones.len() as u32 {
            panic!("Invalid milestone index");
        }
        let milestone = &job.milestones.get(milestone_index as usize).unwrap();
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
        let mut updated_milestones = job.milestones.clone();
        updated_milestones.get_mut(milestone_index as usize).unwrap().released = true;
        job.milestones = updated_milestones;

        // Update status
        let all_released = job.milestones.iter().all(|m| m.released);
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
    fn test_milestone_based_release() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);

        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = Address::generate(&env);
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
        let token = Address::generate(&env);
        let job_id = String::from_str(&env, "job-dispute");

        let mut milestones = Vec::new(&env);
        milestones.push_back(Milestone {
            name: String::from_str(&env, "M1"),
            percentage: 100,
            released: false,
        });

        client.create_job(&client_addr, &freelancer, &job_id, &token, &1000i128, &milestones);

        // Dispute the job
        client.dispute_job(&admin, &job_id);

        let job = client.get_job(&job_id).expect("Job should exist");
        assert_eq!(job.status, JobStatus::Disputed);
        assert!(job.disputed);
    }
}
