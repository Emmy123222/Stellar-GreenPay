#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String,
};

#[derive(Clone)]
#[contracttype]
pub struct Project {
    pub id: String,
    pub name: String,
    pub wallet: Address,
    pub goal: u32,
    pub raised: i128,
}

#[derive(Clone)]
#[contracttype]
pub struct RecurringCommitment {
    pub donor: Address,
    pub project_id: String,
    pub monthly_amount: i128,
    pub duration_months: u32,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Admin,
    Project(String),
    RecurringCommitment(Address, String),
}

#[contract]
pub struct GreenPayContract;

#[contractimpl]
impl GreenPayContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("contract already initialized");
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.events().publish((symbol_short!("initialized"),), admin);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));

        admin.require_auth();
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn register_project(
        env: Env,
        caller: Address,
        project_id: String,
        name: String,
        wallet: Address,
        goal: u32,
    ) {
        caller.require_auth();

        if project_id.is_empty() {
            panic!("project id cannot be empty");
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Project(project_id.clone()))
        {
            panic!("project already registered");
        }

        let project = Project {
            id: project_id.clone(),
            name,
            wallet,
            goal,
            raised: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);
        env.events().publish(
            (symbol_short!("project"), project_id),
            project,
        );
    }

    pub fn donate(
        env: Env,
        token: Address,
        donor: Address,
        project_id: String,
        amount: i128,
        _message: u32,
    ) {
        donor.require_auth();
        if amount <= 0 {
            panic!("donation amount must be positive");
        }

        let mut project: Project = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id.clone()))
            .unwrap_or_else(|| panic!("project not found"));

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&donor, &project.wallet, &amount);

        project.raised = project
            .raised
            .checked_add(amount)
            .unwrap_or_else(|| panic!("donation total overflow"));
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("donated"), donor, project_id),
            amount,
        );
    }

    pub fn create_recurring_commitment(
        env: Env,
        donor: Address,
        project_id: String,
        monthly_amount: i128,
        duration_months: u32,
    ) {
        donor.require_auth();

        if monthly_amount <= 0 {
            panic!("monthly amount must be positive");
        }
        if duration_months == 0 {
            panic!("duration must be positive");
        }
        if !env
            .storage()
            .persistent()
            .has(&DataKey::Project(project_id.clone()))
        {
            panic!("project not found");
        }

        let commitment = RecurringCommitment {
            donor: donor.clone(),
            project_id: project_id.clone(),
            monthly_amount,
            duration_months,
        };

        env.storage().persistent().set(
            &DataKey::RecurringCommitment(donor.clone(), project_id.clone()),
            &commitment,
        );

        env.events().publish(
            (
                soroban_sdk::Symbol::new(&env, "pledge_created"),
                donor,
                project_id,
            ),
            (monthly_amount, duration_months),
        );
    }

    pub fn get_project(env: Env, project_id: String) -> Option<Project> {
        env.storage()
            .persistent()
            .get(&DataKey::Project(project_id))
    }

    pub fn get_recurring_commitment(
        env: Env,
        donor: Address,
        project_id: String,
    ) -> Option<RecurringCommitment> {
        env.storage()
            .persistent()
            .get(&DataKey::RecurringCommitment(donor, project_id))
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }
}
