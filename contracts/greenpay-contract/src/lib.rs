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
        let fee = compute_donation_fee(&env, amount);
        if fee > 0 {
            let fee_recipient: Address = env
                .storage()
                .instance()
                .get(&DataKey::FeeRecipient)
                .expect("Fee recipient not set");
            token_client.transfer(&donor, &fee_recipient, &fee);
        }
        token_client.transfer(
            &donor,
            &project.wallet,
            &amount.checked_sub(fee).expect("Fee exceeds donation amount"),
        );

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

    // ─── Impact NFT getter tests ──────────────────────────────────────────────

    #[test]
    fn test_get_impact_nft_returns_none_when_not_minted() {
        let env = Env::default();
        let id = env.register_contract(None, GreenPayContract);
        let client = GreenPayContractClient::new(&env, &id);
        let owner = Address::generate(&env);

        assert!(client
            .get_impact_nft(&owner, &BadgeTier::Seedling)
            .is_none());
    }

    #[test]
    fn test_get_impact_nft_returns_full_mint_snapshot() {
        let (env, _cid, client, _admin, pid) = setup();
        let donor = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        let token_client = StellarAssetClient::new(&env, &token);
        let amount = 25 * STROOP;
        let mint_ledger = 42;

        token_client.mint(&donor, &amount);
        env.ledger().set_sequence_number(mint_ledger);
        client.donate(&token, &donor, &pid, &amount, &0u32);

        let nft = client
            .get_impact_nft(&donor, &BadgeTier::Seedling)
            .expect("Seedling impact NFT should be minted");
        assert_eq!(nft.owner, donor);
        assert_eq!(nft.tier, BadgeTier::Seedling);
        assert_eq!(nft.total_donated, amount);
        assert_eq!(nft.minted_at_ledger, mint_ledger);
    }

    // ─── Platform fee tests ───────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Only admin can set fee recipient")]
    fn test_set_fee_recipient_requires_admin() {
        let (env, _cid, client, _admin, _pid) = setup();
        let attacker = Address::generate(&env);
        let recipient = Address::generate(&env);
        client.set_fee_recipient(&attacker, &recipient, &100u32);
    }

    #[test]
    #[should_panic(expected = "Fee exceeds maximum allowed")]
    fn test_set_fee_recipient_rejects_fee_above_max() {
        let (env, _cid, client, admin, _pid) = setup();
        let recipient = Address::generate(&env);
        client.set_fee_recipient(&admin, &recipient, &(MAX_FEE_BPS + 1));
    }

    #[test]
    fn test_set_fee_recipient_round_trips_and_zero_bps_disables() {
        let (env, _cid, client, admin, _pid) = setup();
        let recipient = Address::generate(&env);

        // Default: no fee configured.
        assert_eq!(
            client.get_fee_config(),
            FeeConfig { recipient: None, fee_bps: 0 }
        );

        // Max rate is accepted.
        client.set_fee_recipient(&admin, &recipient, &MAX_FEE_BPS);
        assert_eq!(
            client.get_fee_config(),
            FeeConfig { recipient: Some(recipient.clone()), fee_bps: MAX_FEE_BPS }
        );

        // 0 bps keeps the recipient stored but disables the withholding.
        client.set_fee_recipient(&admin, &recipient, &0u32);
        assert_eq!(
            client.get_fee_config(),
            FeeConfig { recipient: Some(recipient), fee_bps: 0 }
        );
    }

    #[test]
    fn test_donate_withholds_platform_fee() {
        let (env, _cid, client, admin, pid) = setup();
        let wallet = client.get_project(&pid).wallet;

        let fee_recipient = Address::generate(&env);
        client.set_fee_recipient(&admin, &fee_recipient, &100u32); // 1%

        let donor = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        let token_client = StellarAssetClient::new(&env, &token);

        let amount = 100 * STROOP; // 100 XLM
        token_client.mint(&donor, &amount);
        client.donate(&token, &donor, &pid, &amount, &42u32);

        // 1% of 100 XLM: fee recipient gets 1 XLM, project wallet 99 XLM.
        assert_eq!(token_client.balance(&fee_recipient), 1 * STROOP);
        assert_eq!(token_client.balance(&wallet), 99 * STROOP);
        assert_eq!(token_client.balance(&donor), 0);

        // Accounting stays gross.
        let project = client.get_project(&pid);
        assert_eq!(project.total_raised, amount);
        let donor_stats = client.get_donor_stats(&donor);
        assert_eq!(donor_stats.total_donated, amount);
        assert_eq!(client.get_global_total(), amount);
        let record = client.get_donation_record(&0u32);
        assert_eq!(record.amount, amount);
    }

    #[test]
    fn test_fee_truncates_and_zero_bps_sends_full_amount() {
        let (env, _cid, client, admin, pid) = setup();
        let wallet = client.get_project(&pid).wallet;
        let fee_recipient = Address::generate(&env);

        let donor = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        let token_client = StellarAssetClient::new(&env, &token);

        // 10_000_009 × 200 bps / 10_000 = 200_000.18 → truncated to 200_000.
        let amount = 10_000_009i128;
        token_client.mint(&donor, &amount);
        client.set_fee_recipient(&admin, &fee_recipient, &200u32); // 2%

        client.donate(&token, &donor, &pid, &amount, &0u32);
        assert_eq!(token_client.balance(&fee_recipient), 200_000);
        assert_eq!(token_client.balance(&wallet), amount - 200_000);

        // Disabling via 0 bps: the full amount reaches the project wallet.
        client.set_fee_recipient(&admin, &fee_recipient, &0u32);
        let donor2 = Address::generate(&env);
        token_client.mint(&donor2, &amount);
        client.donate(&token, &donor2, &pid, &amount, &1u32);
        assert_eq!(token_client.balance(&fee_recipient), 200_000); // unchanged
        assert_eq!(token_client.balance(&wallet), amount - 200_000 + amount);
    }

    #[test]
    fn test_donate_usdc_withholds_platform_fee() {
        let (env, _cid, client, admin, pid) = setup();
        let token_admin = Address::generate(&env);
        let usdc_token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        client.set_usdc_token(&admin, &usdc_token);
        let oracle_id = env.register_contract(None, MockOracle);
        client.set_oracle(&admin, &oracle_id);

        let fee_recipient = Address::generate(&env);
        client.set_fee_recipient(&admin, &fee_recipient, &100u32); // 1%

        let donor = Address::generate(&env);
        let usdc_amount = 100i128 * 1_000_000; // 100 USDC (6 decimals)
        StellarAssetClient::new(&env, &usdc_token).mint(&donor, &usdc_amount);

        client.donate_usdc(&usdc_token, &donor, &pid, &usdc_amount, &0u32);

        let usdc_client = StellarAssetClient::new(&env, &usdc_token);
        // 1% of 100 USDC → 1 USDC to the fee recipient.
        assert_eq!(usdc_client.balance(&fee_recipient), 1_000_000);
        assert_eq!(usdc_client.balance(&donor), 0);

        // Project wallet receives the remainder.
        let wallet = client.get_project(&pid).wallet;
        assert_eq!(usdc_client.balance(&wallet), usdc_amount - 1_000_000);
    }
}
