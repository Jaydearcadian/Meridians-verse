#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec, Symbol, IntoVal};
use stellar_insured_lib::{Proposal, GovernanceAction, GovernanceError};
use stellar_insured_lib::access_control::{self, AccessControlRole};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    SlashingContract,
    ClaimsContract,
    RiskPoolContract,
    PolicyContract,
    Proposal(u64),
    ProposalCounter,
    VoterRecord(u64, Address),
    VotingPeriod,
    GovernanceActionPending(u64),  // proposal_id -> GovernanceAction
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteRecord {
    pub voter: Address,
    pub weight: i128,
    pub is_yes: bool,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalStats {
    pub yes_votes: i128,
    pub no_votes: i128,
    pub total_votes: i128,
    pub status: Symbol,
}

// --- Storage helpers (#378: data access abstraction) ---

fn get_voting_period(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::VotingPeriod).unwrap()
}

fn get_proposal_counter(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::ProposalCounter).unwrap_or(0)
}

fn get_proposal_inner(env: &Env, proposal_id: u64) -> Proposal {
    env.storage().persistent().get(&DataKey::Proposal(proposal_id)).expect("Proposal not found")
}

fn set_proposal(env: &Env, proposal_id: u64, proposal: &Proposal) {
    env.storage().persistent().set(&DataKey::Proposal(proposal_id), proposal);
}

// --------------------------------------------------------

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        slashing_contract: Address,
        voting_period: u64,
        claims_contract: Address,
        risk_pool_contract: Address,
        policy_contract: Address,
    ) -> Result<(), GovernanceError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(GovernanceError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::SlashingContract, &slashing_contract);
        env.storage().instance().set(&DataKey::VotingPeriod, &voting_period);
        env.storage().instance().set(&DataKey::ProposalCounter, &0u64);
        env.storage().instance().set(&DataKey::ClaimsContract, &claims_contract);
        env.storage().instance().set(&DataKey::RiskPoolContract, &risk_pool_contract);
        env.storage().instance().set(&DataKey::PolicyContract, &policy_contract);
        access_control::init_access_control(&env, &admin);

        // #379: emit event for initialization
        env.events().publish(
            (symbol_short!("admin"), symbol_short!("init")),
            admin,
        );
        Ok(())
    }

    pub fn set_role(env: Env, addr: Address, role: AccessControlRole) -> Result<(), GovernanceError> {
        access_control::set_role(&env, &env.current_contract_address(), &addr, role);
        Ok(())
    }

    pub fn create_proposal(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        execution_data: String,
        threshold_percentage: u32,
    ) -> Result<u64, GovernanceError> {
        creator.require_auth();

        let mut counter = get_proposal_counter(&env);
        counter += 1;
        env.storage().instance().set(&DataKey::ProposalCounter, &counter);

        let voting_period: u64 = env.storage().instance().get(&DataKey::VotingPeriod)
            .ok_or(GovernanceError::NotInitialized)?;
        
        let proposal = Proposal {
            id: counter,
            title,
            description,
            execution_data,
            creator: creator.clone(),
            expires_at: env.ledger().timestamp() + get_voting_period(&env),
            threshold_percentage,
            yes_votes: 0,
            no_votes: 0,
            is_finalized: false,
            is_executed: false,
        };

        set_proposal(&env, counter, &proposal);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("created")),
            (counter, creator),
        );

        Ok(counter)
    }

    pub fn create_slashing_proposal(
        env: Env,
        creator: Address,
        target: Address,
        role: Symbol,
        reason: String,
        amount: i128,
        threshold: u32,
    ) -> Result<u64, GovernanceError> {
        creator.require_auth();

        let title = String::from_str(&env, "Slashing Proposal");
        let execution_data = String::from_str(&env, "slash_call");

        let mut counter = get_proposal_counter(&env);
        counter += 1;
        env.storage().instance().set(&DataKey::ProposalCounter, &counter);

        let proposal = Proposal {
            id: counter,
            title,
            description: reason,
            execution_data,
            creator: creator.clone(),
            expires_at: env.ledger().timestamp() + get_voting_period(&env),
            threshold_percentage: threshold,
            yes_votes: 0,
            no_votes: 0,
            is_finalized: false,
            is_executed: false,
        };

        set_proposal(&env, counter, &proposal);

        // #601: persist the slashing action so execute_proposal can carry it out.
        let action = GovernanceAction::Slashing(target.clone(), role.clone(), amount);
        env.storage().persistent().set(&DataKey::GovernanceActionPending(counter), &action);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("slash_p")),
            (counter, target, role, amount),
        );

        Ok(counter)
    }

    // #411: Create governance proposal for claim approval
    pub fn create_claim_approval_proposal(
        env: Env,
        creator: Address,
        claim_id: u64,
        threshold: u32,
    ) -> Result<u64, GovernanceError> {
        creator.require_auth();

        let title = String::from_str(&env, "Claim Approval Proposal");
        let description = String::from_str(&env, "DAO vote required for claim approval");
        let execution_data = String::from_str(&env, "approve_claim");

        let mut counter = get_proposal_counter(&env);
        counter += 1;
        env.storage().instance().set(&DataKey::ProposalCounter, &counter);

        let voting_period: u64 = env.storage().instance().get(&DataKey::VotingPeriod)
            .ok_or(GovernanceError::NotInitialized)?;

        let proposal = Proposal {
            id: counter,
            title,
            description,
            execution_data,
            creator: creator.clone(),
            expires_at: env.ledger().timestamp() + voting_period,
            threshold_percentage: threshold,
            yes_votes: 0,
            no_votes: 0,
            is_finalized: false,
            is_executed: false,
        };

        set_proposal(&env, counter, &proposal);

        // Store the governance action
        let action = GovernanceAction::ClaimApproval(claim_id);
        env.storage().persistent().set(&DataKey::GovernanceActionPending(counter), &action);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("claim_pr")),
            (counter, claim_id, creator),
        );

        Ok(counter)
    }

    // #411: Create governance proposal for fund allocation
    pub fn create_fund_allocation_proposal(
        env: Env,
        creator: Address,
        recipient: Address,
        amount: i128,
        threshold: u32,
    ) -> Result<u64, GovernanceError> {
        creator.require_auth();

        let title = String::from_str(&env, "Fund Allocation Proposal");
        let description = String::from_str(&env, "DAO vote required for fund allocation");
        let execution_data = String::from_str(&env, "allocate_funds");

        let mut counter = get_proposal_counter(&env);
        counter += 1;
        env.storage().instance().set(&DataKey::ProposalCounter, &counter);

        let voting_period: u64 = env.storage().instance().get(&DataKey::VotingPeriod)
            .ok_or(GovernanceError::NotInitialized)?;

        let proposal = Proposal {
            id: counter,
            title,
            description,
            execution_data,
            creator: creator.clone(),
            expires_at: env.ledger().timestamp() + voting_period,
            threshold_percentage: threshold,
            yes_votes: 0,
            no_votes: 0,
            is_finalized: false,
            is_executed: false,
        };

        set_proposal(&env, counter, &proposal);

        // Store the governance action
        let action = GovernanceAction::FundAllocation(recipient.clone(), amount);
        env.storage().persistent().set(&DataKey::GovernanceActionPending(counter), &action);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("fund_prop")),
            (counter, recipient, amount, creator),
        );

        Ok(counter)
    }

    pub fn vote(env: Env, voter: Address, proposal_id: u64, weight: i128, is_yes: bool) -> Result<(), GovernanceError> {
        voter.require_auth();

        let mut proposal = get_proposal_inner(&env, proposal_id);

        if env.ledger().timestamp() > proposal.expires_at {
            return Err(GovernanceError::VotingPeriodEnded);
        }

        let record_key = DataKey::VoterRecord(proposal_id, voter.clone());
        if env.storage().persistent().has(&record_key) {
            return Err(GovernanceError::AlreadyVoted);
        }

        if is_yes {
            proposal.yes_votes += weight;
        } else {
            proposal.no_votes += weight;
        }

        let record = VoteRecord {
            voter: voter.clone(),
            weight,
            is_yes,
            timestamp: env.ledger().timestamp(),
        };

        set_proposal(&env, proposal_id, &proposal);
        env.storage().persistent().set(&record_key, &record);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("vote")),
            (proposal_id, voter),
        );
        Ok(())
    }

    pub fn finalize_proposal(env: Env, proposal_id: u64) -> Result<(), GovernanceError> {
        let mut proposal = get_proposal_inner(&env, proposal_id);

        if env.ledger().timestamp() <= proposal.expires_at {
            return Err(GovernanceError::VotingPeriodNotEnded);
        }

        proposal.is_finalized = true;
        set_proposal(&env, proposal_id, &proposal);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("final")),
            proposal_id,
        );
        Ok(())
    }

    pub fn execute_proposal(env: Env, proposal_id: u64) -> Result<(), GovernanceError> {
        let mut proposal = get_proposal_inner(&env, proposal_id);

        if !proposal.is_finalized {
            return Err(GovernanceError::MustFinalizeFirst);
        }

        if proposal.is_executed {
            return Err(GovernanceError::AlreadyExecuted);
        }

        let total_votes = proposal.yes_votes + proposal.no_votes;
        if total_votes == 0 || (proposal.yes_votes * 100 / total_votes) < proposal.threshold_percentage as i128 {
            return Err(GovernanceError::ThresholdNotMet);
        }

        // #411: Execute governance action if exists
        let action_key = DataKey::GovernanceActionPending(proposal_id);
        if env.storage().persistent().has(&action_key) {
            let action: GovernanceAction = env.storage().persistent().get(&action_key).unwrap();
            
            match action {
                GovernanceAction::ClaimApproval(claim_id) => {
                    // Call claims contract to approve the claim
                    let claims_contract: Address = env.storage().instance().get(&DataKey::ClaimsContract)
                        .ok_or(GovernanceError::ClaimsContractNotSet)?;
                    env.invoke_contract::<()>(
                        &claims_contract,
                        &symbol_short!("approve"),
                        soroban_sdk::vec![&env, claim_id.into_val(&env)],
                    );
                }
                GovernanceAction::FundAllocation(recipient, amount) => {
                    // Call risk pool to allocate funds
                    let risk_pool: Address = env.storage().instance().get(&DataKey::RiskPoolContract)
                        .ok_or(GovernanceError::RiskPoolContractNotSet)?;
                    env.invoke_contract::<()>(
                        &risk_pool,
                        &symbol_short!("payout"),
                        soroban_sdk::vec![&env, recipient.into_val(&env), amount.into_val(&env)],
                    );
                }
                GovernanceAction::PolicyChange(policy_id) => {
                    // Handle policy change through policy contract
                    let policy_contract: Address = env.storage().instance().get(&DataKey::PolicyContract)
                        .ok_or(GovernanceError::PolicyContractNotSet)?;
                    env.invoke_contract::<()>(
                        &policy_contract,
                        &symbol_short!("update"),
                        soroban_sdk::vec![&env, policy_id.into_val(&env)],
                    );
                }
                GovernanceAction::Slashing(target, role, amount) => {
                    // #601: end-to-end slashing pipeline.
                    // 1. Slash the target's stake via the slashing contract.
                    let slashing_contract: Address = env.storage().instance().get(&DataKey::SlashingContract)
                        .ok_or(GovernanceError::SlashingContractNotSet)?;
                    let reason = String::from_str(&env, "governance_slash");
                    env.invoke_contract::<()>(
                        &slashing_contract,
                        &Symbol::new(&env, "slash_funds"),
                        soroban_sdk::vec![
                            &env,
                            target.clone().into_val(&env),
                            role.clone().into_val(&env),
                            reason.into_val(&env),
                            amount.into_val(&env),
                        ],
                    );

                    // 2. Route the slashed stake to the risk pool (mirrors the
                    //    oracle's slash_source -> risk_pool transfer).
                    let risk_pool: Address = env.storage().instance().get(&DataKey::RiskPoolContract)
                        .ok_or(GovernanceError::RiskPoolContractNotSet)?;
                    env.invoke_contract::<()>(
                        &risk_pool,
                        &Symbol::new(&env, "absorb_slash"),
                        soroban_sdk::vec![
                            &env,
                            target.clone().into_val(&env),
                            amount.into_val(&env),
                        ],
                    );

                    // 3. Emit a structured Slashed event from governance.
                    env.events().publish(
                        (symbol_short!("gov"), symbol_short!("slashed")),
                        (proposal_id, target, role, amount),
                    );
                }
            }

            // Remove the pending action
            env.storage().persistent().remove(&action_key);
        }

        proposal.is_executed = true;
        set_proposal(&env, proposal_id, &proposal);

        // #379: emit event for admin/governance action
        // #412: Enhanced event emission
        env.events().publish(
            (symbol_short!("admin"), symbol_short!("exec")),
            (proposal_id, proposal.creator),
        );
        Ok(())
    }

    pub fn execute_slashing_proposal(env: Env, proposal_id: u64) -> Result<(), GovernanceError> {
        Self::execute_proposal(env, proposal_id)
    }
}

#[contractimpl]
impl GovernanceContract {
    pub fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
        get_proposal_inner(&env, proposal_id)
    }

    pub fn get_active_proposals(env: Env) -> Vec<u64> {
        let counter = get_proposal_counter(&env);
        let mut list = Vec::new(&env);
        let now = env.ledger().timestamp();
        for i in 1..=counter {
            if let Some(p) = env.storage().persistent().get::<DataKey, Proposal>(&DataKey::Proposal(i)) {
                if !p.is_finalized && now <= p.expires_at {
                    list.push_back(i);
                }
            }
        }
        list
    }

    pub fn get_proposal_stats(env: Env, proposal_id: u64) -> ProposalStats {
        let p = get_proposal_inner(&env, proposal_id);
        let now = env.ledger().timestamp();
        let status = if p.is_executed {
            symbol_short!("executed")
        } else if p.is_finalized {
            symbol_short!("finalized")
        } else if now > p.expires_at {
            symbol_short!("expired")
        } else {
            symbol_short!("active")
        };

        ProposalStats {
            yes_votes: p.yes_votes,
            no_votes: p.no_votes,
            total_votes: p.yes_votes + p.no_votes,
            status,
        }
    }

    pub fn get_all_proposals(env: Env) -> Vec<u64> {
        let counter = get_proposal_counter(&env);
        let mut list = Vec::new(&env);
        for i in 1..=counter {
            list.push_back(i);
        }
        list
    }

    pub fn get_vote_record(env: Env, proposal_id: u64, voter: Address) -> Option<VoteRecord> {
        env.storage().persistent().get(&DataKey::VoterRecord(proposal_id, voter))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Env, Address};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        let contract = env.register_contract(None, GovernanceContract);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let slashing = Address::generate(&env);
        let claims = Address::generate(&env);
        let risk_pool = Address::generate(&env);
        let policy = Address::generate(&env);
        env.mock_all_auths();
        env.as_contract(&contract, || {
            GovernanceContract::initialize(
                env.clone(),
                admin.clone(),
                token,
                slashing,
                1000,
                claims,
                risk_pool,
                policy,
            ).unwrap();
        });
        (env, contract, admin)
    }

    #[test]
    fn test_initialize_sets_admin_role() {
        let (env, contract, admin) = setup();
        env.as_contract(&contract, || {
            assert!(access_control::has_role(&env, &admin, &AccessControlRole::Admin));
        });
    }
}

// #601: end-to-end slashing pipeline (Governance -> Slashing -> Risk Pool).
#[cfg(test)]
mod slashing_pipeline_tests {
    use super::{GovernanceContract, GovernanceContractClient};
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{token, Address, Env, String, Symbol};
    use stellar_insured_lib::access_control::AccessControlRole;
    use stellar_insured_risk_pool::{RiskPoolContract, RiskPoolContractClient};
    use stellar_insured_slashing::{SlashingContract, SlashingContractClient};

    const VOTING_PERIOD: u64 = 1000;
    const MIN_STAKE: i128 = 100;
    const INITIAL_STAKE: i128 = 500;
    const SLASH_AMOUNT: i128 = 200;

    // Holds only owned values (no borrowed clients), so tests build their own
    // clients from `env` + the contract ids. This avoids a self-referential
    // struct (clients borrow `&env`).
    struct Harness {
        env: Env,
        gov_id: Address,
        slash_id: Address,
        pool_id: Address,
        target: Address,
        creator: Address,
        voter: Address,
        role: Symbol,
    }

    impl Harness {
        fn gov(&self) -> GovernanceContractClient<'_> {
            GovernanceContractClient::new(&self.env, &self.gov_id)
        }
        fn slashing(&self) -> SlashingContractClient<'_> {
            SlashingContractClient::new(&self.env, &self.slash_id)
        }
        fn pool(&self) -> RiskPoolContractClient<'_> {
            RiskPoolContractClient::new(&self.env, &self.pool_id)
        }
        fn advance_past_voting_period(&self) {
            self.env.ledger().with_mut(|li| {
                li.timestamp += VOTING_PERIOD + 1;
            });
        }
    }

    fn setup() -> Harness {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let voter = Address::generate(&env);
        let target = Address::generate(&env);
        let claims = Address::generate(&env);
        let policy = Address::generate(&env);
        let role = Symbol::new(&env, "validator");

        // Token used by the risk pool; mint the target enough to stake.
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin);
        token::StellarAssetClient::new(&env, &token_id).mint(&target, &1_000);

        // Register the three contracts.
        let gov_id = env.register_contract(None, GovernanceContract);
        let slash_id = env.register_contract(None, SlashingContract);
        let pool_id = env.register_contract(None, RiskPoolContract);

        let gov = GovernanceContractClient::new(&env, &gov_id);
        let slashing = SlashingContractClient::new(&env, &slash_id);
        let pool = RiskPoolContractClient::new(&env, &pool_id);

        pool.initialize(&admin, &token_id, &MIN_STAKE);
        slashing.initialize(&admin, &gov_id, &pool_id);
        gov.initialize(
            &admin,
            &token_id,
            &slash_id,
            &VOTING_PERIOD,
            &claims,
            &pool_id,
            &policy,
        );

        // The role checks in slash_funds / absorb_slash gate on the callee
        // contract's own address holding the Governance role, and
        // add_slashable_role gates on Admin. Grant both to the contracts.
        slashing.set_role(&slash_id, &AccessControlRole::Admin);
        slashing.set_role(&slash_id, &AccessControlRole::Governance);
        slashing.add_slashable_role(&role);
        pool.set_role(&pool_id, &AccessControlRole::Governance);

        // Target stakes into the pool so there is something to slash.
        pool.deposit_liquidity(&target, &INITIAL_STAKE);

        Harness {
            env,
            gov_id,
            slash_id,
            pool_id,
            target,
            creator,
            voter,
            role,
        }
    }

    #[test]
    fn passing_slashing_proposal_reduces_stake_and_credits_pool() {
        let h = setup();
        let gov = h.gov();
        let pool = h.pool();
        let slashing = h.slashing();

        // Sanity: pre-slash state.
        assert_eq!(pool.get_provider_info(&h.target), INITIAL_STAKE);
        assert_eq!(pool.get_pool_stats().available_capital, INITIAL_STAKE);
        assert_eq!(slashing.get_violation_count(&h.target, &h.role), 0);

        let reason = String::from_str(&h.env, "misbehaviour");
        let proposal_id = gov.create_slashing_proposal(
            &h.creator,
            &h.target,
            &h.role,
            &reason,
            &SLASH_AMOUNT,
            &50,
        );

        // Pass the threshold: a single yes vote with full weight.
        gov.vote(&h.voter, &proposal_id, &100, &true);

        h.advance_past_voting_period();
        gov.finalize_proposal(&proposal_id);
        gov.execute_slashing_proposal(&proposal_id);

        // Target stake reduced by the slashed amount.
        assert_eq!(
            pool.get_provider_info(&h.target),
            INITIAL_STAKE - SLASH_AMOUNT
        );
        // Risk pool available capital credited with the slashed amount.
        assert_eq!(
            pool.get_pool_stats().available_capital,
            INITIAL_STAKE + SLASH_AMOUNT
        );
        // Slashing contract recorded the slash against the target.
        assert_eq!(slashing.get_violation_count(&h.target, &h.role), 1);
    }

    #[test]
    fn failing_slashing_proposal_leaves_state_unchanged() {
        let h = setup();
        let gov = h.gov();
        let pool = h.pool();
        let slashing = h.slashing();

        let reason = String::from_str(&h.env, "misbehaviour");
        let proposal_id = gov.create_slashing_proposal(
            &h.creator,
            &h.target,
            &h.role,
            &reason,
            &SLASH_AMOUNT,
            &50,
        );

        // Vote no so the yes-threshold is not met.
        gov.vote(&h.voter, &proposal_id, &100, &false);

        h.advance_past_voting_period();
        gov.finalize_proposal(&proposal_id);

        // Execution must fail on the unmet threshold. A declared contract error
        // surfaces as Ok(Err(_)); a host error as Err(_). Assert only that it did
        // not succeed (which would be Ok(Ok(()))).
        let result = gov.try_execute_slashing_proposal(&proposal_id);
        assert!(!matches!(result, Ok(Ok(()))));

        // No state changed anywhere in the pipeline.
        assert_eq!(pool.get_provider_info(&h.target), INITIAL_STAKE);
        assert_eq!(pool.get_pool_stats().available_capital, INITIAL_STAKE);
        assert_eq!(slashing.get_violation_count(&h.target, &h.role), 0);
    }
}
