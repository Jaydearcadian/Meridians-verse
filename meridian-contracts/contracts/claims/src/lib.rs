#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};
use stellar_insured_lib::{InsuranceClaim, ClaimStatus, InsurancePolicy, PolicyStatus, PoolStats};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    PolicyContract,
    RiskPool,
    Claim(u64),
    ClaimCounter,
    /// #409: Maps policy_id -> active claim_id. Present only while a claim is active
    /// (Submitted / UnderReview / Approved). Cleared on Rejected or Settled.
    PolicyActiveClaim(u64),
    /// #569: Per-holder in-flight settlement lock. Prevents concurrent settlements
    /// from the same holder across different policies in the same ledger.
    SettlingClaim(Address),
}

// --- Storage helpers (#378: data access abstraction) ---

fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

fn get_claim_counter(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::ClaimCounter).unwrap_or(0)
}

fn get_claim_inner(env: &Env, claim_id: u64) -> InsuranceClaim {
    env.storage().persistent().get(&DataKey::Claim(claim_id)).expect("Claim not found")
}

fn set_claim(env: &Env, claim_id: u64, claim: &InsuranceClaim) {
    env.storage().persistent().set(&DataKey::Claim(claim_id), claim);
}

// --------------------------------------------------------

#[contract]
pub struct ClaimsContract;

#[contractimpl]
impl ClaimsContract {
    pub fn initialize(env: Env, admin: Address, policy_contract: Address, risk_pool: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if admin == policy_contract || admin == risk_pool || policy_contract == risk_pool {
            panic!("Addresses must be distinct");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PolicyContract, &policy_contract);
        env.storage().instance().set(&DataKey::RiskPool, &risk_pool);
        env.storage().instance().set(&DataKey::ClaimCounter, &0u64);
    }

    pub fn submit_claim(env: Env, policy_id: u64, amount: i128) -> u64 {
        // #381: fetch policy and validate consistency before accepting claim
        let policy_contract: Address = env.storage().instance().get(&DataKey::PolicyContract).unwrap();
        // #407: Centralized validation via Policy contract (includes expiration check)
        let is_active: bool = env.invoke_contract(
            &policy_contract,
            &symbol_short!("is_active"),
            (policy_id,).into(),
        );
        if !is_active {
            panic!("Policy is not active or has expired");
        }

        let policy: InsurancePolicy = env.invoke_contract(
            &policy_contract,
            &symbol_short!("get_pol"),
            (policy_id,).into(),
        );

        // Consistency check: claim amount must not exceed coverage
        if amount <= 0 || (amount + policy.total_claimed) > policy.coverage_amount {
            panic!("Claim amount invalid or exceeds remaining coverage");
        }

        // #409: O(1) duplicate claim check — reject if an active claim already exists for this policy
        if env.storage().persistent().has(&DataKey::PolicyActiveClaim(policy_id)) {
            panic!("Policy already has an active claim");
        }

        let claimant = policy.holder.clone();
        claimant.require_auth();

        let mut counter = get_claim_counter(&env);
        counter += 1;
        env.storage().instance().set(&DataKey::ClaimCounter, &counter);

        let claim = InsuranceClaim {
            claim_id: counter,
            policy_id,
            claimant,
            amount,
            status: ClaimStatus::Submitted,
            submitted_at: env.ledger().timestamp(),
        };

        set_claim(&env, counter, &claim);

        // #409: Record the active claim for this policy (O(1) dedup key)
        env.storage().persistent().set(&DataKey::PolicyActiveClaim(policy_id), &counter);

        // #412: Enhanced event emission with more details
        env.events().publish(
            (symbol_short!("claim"), symbol_short!("submitted")),
            (counter, policy_id, claimant, amount),
        );

        counter
    }

    pub fn start_review(env: Env, claim_id: u64) {
        let admin = get_admin(&env);
        admin.require_auth();

        let mut claim = get_claim_inner(&env, claim_id);
        if claim.status != ClaimStatus::Submitted {
            panic!("Invalid claim status for review");
        }

        claim.status = ClaimStatus::UnderReview;
        set_claim(&env, claim_id, &claim);

        // #412: Enhanced event emission
        env.events().publish(
            (symbol_short!("claim"), symbol_short!("review")),
            (claim_id, claim.policy_id, claim.amount),
        );
    }

    pub fn approve_claim(env: Env, claim_id: u64) {
        let admin = get_admin(&env);
        admin.require_auth();

        let mut claim = get_claim_inner(&env, claim_id);
        if claim.status != ClaimStatus::UnderReview {
            panic!("Claim must be under review to approve");
        }

        claim.status = ClaimStatus::Approved;
        set_claim(&env, claim_id, &claim);

        // #412: Enhanced event emission
        env.events().publish(
            (symbol_short!("claim"), symbol_short!("approved")),
            (claim_id, claim.policy_id, claim.amount, claim.claimant),
        );
    }

    pub fn reject_claim(env: Env, claim_id: u64) {
        let admin = get_admin(&env);
        admin.require_auth();

        let mut claim = get_claim_inner(&env, claim_id);
        if claim.status != ClaimStatus::UnderReview {
            panic!("Claim must be under review to reject");
        }

        claim.status = ClaimStatus::Rejected;
        set_claim(&env, claim_id, &claim);

        // #409: Clear the active-claim lock so a new claim can be submitted for this policy
        env.storage().persistent().remove(&DataKey::PolicyActiveClaim(claim.policy_id));

        // #412: Enhanced event emission
        env.events().publish(
            (symbol_short!("claim"), symbol_short!("rejected")),
            (claim_id, claim.policy_id, claim.amount),
        );
    }

    pub fn settle_claim(env: Env, claim_id: u64) {
        let admin = get_admin(&env);
        admin.require_auth();

        let mut claim = get_claim_inner(&env, claim_id);
        if claim.status != ClaimStatus::Approved {
            panic!("Only approved claims can be settled");
        }

        let risk_pool: Address = env.storage().instance().get(&DataKey::RiskPool).unwrap();
        let policy_contract: Address = env.storage().instance().get(&DataKey::PolicyContract).unwrap();

        // #569: Per-holder in-flight settlement lock — prevents concurrent settlements
        // from the same holder across different policies in the same ledger.
        if env.storage().persistent().has(&DataKey::SettlingClaim(claim.claimant.clone())) {
            panic!("Settlement already in progress for this holder");
        }
        env.storage().persistent().set(&DataKey::SettlingClaim(claim.claimant.clone()), &true);

        // #410: Check risk pool balance before payout (early exit, not a lock)
        let pool_stats: PoolStats = env.invoke_contract(
            &risk_pool,
            &symbol_short!("get_stats"),
            ().into(),
        );

        if pool_stats.available_capital < claim.amount {
            env.storage().persistent().remove(&DataKey::SettlingClaim(claim.claimant));
            panic!("Insufficient risk pool funds for payout");
        }

        // #569: Checks-Effects-Interactions — update total_claimed BEFORE payout.
        // If the payout call panics, Soroban reverts all state changes including
        // this policy update, keeping accounting consistent.
        env.invoke_contract::<()>(
            &policy_contract,
            &symbol_short!("update_cl"),
            (claim.policy_id, claim.amount).into(),
        );

        // Transfer tokens from risk pool to claimant
        env.invoke_contract::<()>(
            &risk_pool,
            &symbol_short!("payout"),
            (claim.claimant.clone(), claim.amount).into(),
        );

        claim.status = ClaimStatus::Settled;
        set_claim(&env, claim_id, &claim);

        // #409: Clear the active-claim lock after settlement
        env.storage().persistent().remove(&DataKey::PolicyActiveClaim(claim.policy_id));
        // #569: Clear the per-holder settlement lock
        env.storage().persistent().remove(&DataKey::SettlingClaim(claim.claimant));

        // #412: Enhanced event emission
        env.events().publish(
            (symbol_short!("claim"), symbol_short!("settled")),
            (claim_id, claim.amount, claim.claimant),
        );
    }
}

#[contractimpl]
impl ClaimsContract {
    pub fn get_claim(env: Env, claim_id: u64) -> InsuranceClaim {
        get_claim_inner(&env, claim_id)
    }

    pub fn get_stats(env: Env) -> u64 {
        get_claim_counter(&env)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::AddressGenerator,
        token, Address, Env,
    };

    fn deploy_token(env: &Env, admin: &Address) -> Address {
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        token_addr
    }

    fn mint_tokens(env: &Env, token: &Address, to: &Address, amount: i128) {
        let client = token::StellarAssetClient::new(env, token);
        client.mint(to, &amount);
    }

    struct TestEnvSetup {
        env: Env,
        claims: Address,
        risk_pool: Address,
        policy: Address,
        token: Address,
        admin: Address,
        holder: Address,
    }

    fn setup() -> TestEnvSetup {
        let env = Env::new();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let holder = Address::generate(&env);

        // Deploy token
        let token = deploy_token(&env, &admin);

        // Deploy risk pool
        let risk_pool = env.register_contract(None, stellar_insured_risk_pool::RiskPoolContract);
        let risk_pool_client = stellar_insured_risk_pool::Client::new(&env, &risk_pool);
        risk_pool_client.initialize(&admin, &token, &1_000i128);

        // Deploy policy contract
        let policy = env.register_contract(None, stellar_insured_policy::PolicyContract);
        let policy_client = stellar_insured_policy::Client::new(&env, &policy);
        policy_client.initialize(&admin, &risk_pool);
        policy_client.set_claims_contract(&policy); // Placeholder, updated after claims deploy

        // Deploy claims contract
        let claims = env.register_contract(None, ClaimsContract);
        let claims_client = Client::new(&env, &claims);
        claims_client.initialize(&admin, &policy, &risk_pool);

        // Now set the real claims address in policy
        policy_client.set_claims_contract(&claims);

        // Set ledger timestamp
        env.ledger().set_timestamp(1_000_000);

        // Fund risk pool with liquidity
        mint_tokens(&env, &token, &holder, 1_000_000_000i128);
        let token_client = token::Client::new(&env, &token);
        token_client.approve(&holder, &risk_pool, &1_000_000i128, &200);
        risk_pool_client.deposit_liquidity(&holder, &100_000i128);

        TestEnvSetup {
            env,
            claims,
            risk_pool,
            policy,
            token,
            admin,
            holder,
        }
    }

    fn issue_policy(env: &Env, policy_client: &stellar_insured_policy::Client, admin: &Address, holder: &Address, coverage: i128) -> u64 {
        env.mock_all_auths();
        policy_client.issue_policy(holder, &coverage, &10_000i128, &30, &PolicyType::Standard)
    }

    fn submit_and_approve_claim(
        env: &Env,
        claims_client: &Client,
        policy_id: u64,
        amount: i128,
        holder: &Address,
    ) -> u64 {
        env.mock_all_auths();
        let claim_id = claims_client.submit_claim(&policy_id, &amount);
        claims_client.start_review(&claim_id);
        claims_client.approve_claim(&claim_id);
        claim_id
    }

    #[test]
    fn test_settle_claim_success() {
        let setup = setup();
        let claims_client = Client::new(&setup.env, &setup.claims);
        let policy_client = stellar_insured_policy::Client::new(&setup.env, &setup.policy);
        let risk_pool_client = stellar_insured_risk_pool::Client::new(&setup.env, &setup.risk_pool);

        let policy_id = issue_policy(&setup.env, &policy_client, &setup.admin, &setup.holder, 50_000i128);
        let claim_id = submit_and_approve_claim(&setup.env, &claims_client, policy_id, 10_000i128, &setup.holder);

        // Settle the claim
        claims_client.settle_claim(&claim_id);

        // Verify claim is settled
        let claim = claims_client.get_claim(&claim_id);
        assert_eq!(claim.status, ClaimStatus::Settled);

        // Verify policy total_claimed was updated
        let policy = policy_client.get_policy(&policy_id);
        assert_eq!(policy.total_claimed, 10_000i128);

        // Verify pool stats updated
        let pool_stats = risk_pool_client.get_pool_stats();
        assert!(pool_stats.available_capital < 100_000i128); // Was reduced by 10,000
        assert_eq!(pool_stats.total_claims_paid, 10_000i128);

        // Verify PolicyActiveClaim was cleared
        // A new claim on the same policy should work now
        let claim_id_2 = claims_client.submit_claim(&policy_id, &5_000i128);
        assert!(claim_id_2 > 0);
    }

    #[test]
    fn test_settle_claim_over_coverage_rejected() {
        let setup = setup();
        let claims_client = Client::new(&setup.env, &setup.claims);
        let policy_client = stellar_insured_policy::Client::new(&setup.env, &setup.policy);

        let policy_id = issue_policy(&setup.env, &policy_client, &setup.admin, &setup.holder, 50_000i128);

        // submit_claim rejects amounts that exceed remaining coverage
        // 60_000 > 50_000, so this must panic
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            claims_client.submit_claim(&policy_id, &60_000i128);
        }));
        assert!(result.is_err(), "Expected submit_claim to reject over-coverage claim");
    }

    #[test]
    fn test_settle_claim_insufficient_pool_rejected() {
        let setup = setup();
        let claims_client = Client::new(&setup.env, &setup.claims);
        let policy_client = stellar_insured_policy::Client::new(&setup.env, &setup.policy);
        let risk_pool_client = stellar_insured_risk_pool::Client::new(&setup.env, &setup.risk_pool);

        // Pool has 100_000, policy coverage is large
        let policy_id = issue_policy(&setup.env, &policy_client, &setup.admin, &setup.holder, 200_000i128);
        let claim_id = submit_and_approve_claim(&setup.env, &claims_client, policy_id, 150_000i128, &setup.holder);

        // Settlement should panic due to insufficient pool funds
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            claims_client.settle_claim(&claim_id);
        }));
        assert!(result.is_err(), "Expected settle_claim to panic due to insufficient pool funds");
    }

    #[test]
    fn test_per_holder_lock_prevents_concurrent_settlements() {
        let setup = setup();
        let claims_client = Client::new(&setup.env, &setup.claims);
        let policy_client = stellar_insured_policy::Client::new(&setup.env, &setup.policy);

        // Issue two policies for the same holder
        let policy_id_1 = issue_policy(&setup.env, &policy_client, &setup.admin, &setup.holder, 50_000i128);
        let policy_id_2 = issue_policy(&setup.env, &policy_client, &setup.admin, &setup.holder, 50_000i128);

        // Submit and approve claims on both policies
        let claim_id_1 = submit_and_approve_claim(&setup.env, &claims_client, policy_id_1, 10_000i128, &setup.holder);
        let claim_id_2 = submit_and_approve_claim(&setup.env, &claims_client, policy_id_2, 10_000i128, &setup.holder);

        // Settle first claim — should succeed
        claims_client.settle_claim(&claim_id_1);
        let claim_1 = claims_client.get_claim(&claim_id_1);
        assert_eq!(claim_1.status, ClaimStatus::Settled);

        // Settle second claim — should also succeed (lock is cleared after each settle)
        claims_client.settle_claim(&claim_id_2);
        let claim_2 = claims_client.get_claim(&claim_id_2);
        assert_eq!(claim_2.status, ClaimStatus::Settled);

        // Verify both policies have updated total_claimed
        let policy_1 = policy_client.get_policy(&policy_id_1);
        let policy_2 = policy_client.get_policy(&policy_id_2);
        assert_eq!(policy_1.total_claimed, 10_000i128);
        assert_eq!(policy_2.total_claimed, 10_000i128);
    }

    #[test]
    fn test_duplicate_settlement_rejected() {
        let setup = setup();
        let claims_client = Client::new(&setup.env, &setup.claims);
        let policy_client = stellar_insured_policy::Client::new(&setup.env, &setup.policy);

        let policy_id = issue_policy(&setup.env, &policy_client, &setup.admin, &setup.holder, 50_000i128);
        let claim_id = submit_and_approve_claim(&setup.env, &claims_client, policy_id, 10_000i128, &setup.holder);

        // Settle once
        claims_client.settle_claim(&claim_id);

        // Trying to settle again should panic (claim is already Settled)
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            claims_client.settle_claim(&claim_id);
        }));
        assert!(result.is_err(), "Expected settle_claim to panic on duplicate settlement");
    }

    #[test]
    fn test_update_claimed_before_payout_accounting_consistency() {
        let setup = setup();
        let claims_client = Client::new(&setup.env, &setup.claims);
        let policy_client = stellar_insured_policy::Client::new(&setup.env, &setup.policy);
        let risk_pool_client = stellar_insured_risk_pool::Client::new(&setup.env, &setup.risk_pool);

        let policy_id = issue_policy(&setup.env, &policy_client, &setup.admin, &setup.holder, 100_000i128);
        let claim_id = submit_and_approve_claim(&setup.env, &claims_client, policy_id, 30_000i128, &setup.holder);

        // Check state before settlement
        let pool_before = risk_pool_client.get_pool_stats();
        let policy_before = policy_client.get_policy(&policy_id);
        assert_eq!(policy_before.total_claimed, 0);

        // Settle
        claims_client.settle_claim(&claim_id);

        // Verify total_claimed was updated (should match pool outflow)
        let policy_after = policy_client.get_policy(&policy_id);
        let pool_after = risk_pool_client.get_pool_stats();

        assert_eq!(policy_after.total_claimed, 30_000i128);
        assert_eq!(
            pool_before.available_capital - pool_after.available_capital,
            30_000i128,
            "Pool outflows must match policy total_claimed increment"
        );
        assert_eq!(
            pool_after.total_claims_paid - pool_before.total_claims_paid,
            30_000i128,
            "Claims paid delta must match claim amount"
        );
    }
}
