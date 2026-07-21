#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};
use stellar_insured_lib::RiskPoolError;
use stellar_insured_lib::access_control::{self, AccessControlRole};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    MinStake,
    TotalCapital,
    AvailableCapital,
    ClaimsPaid,
    ProviderStake(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolStats {
    pub total_capital: i128,
    pub available_capital: i128,
    pub total_claims_paid: i128,
}

// --- Storage helpers (#378: data access abstraction) ---

fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

fn get_total_capital(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalCapital).unwrap_or(0)
}

fn get_available_capital(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::AvailableCapital).unwrap_or(0)
}

fn get_provider_stake(env: &Env, provider: &Address) -> i128 {
    env.storage().persistent().get(&DataKey::ProviderStake(provider.clone())).unwrap_or(0)
}

// --------------------------------------------------------

#[contract]
pub struct RiskPoolContract;

#[contractimpl]
impl RiskPoolContract {
    pub fn initialize(env: Env, admin: Address, token: Address, min_stake: i128) -> Result<(), RiskPoolError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RiskPoolError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::MinStake, &min_stake);
        env.storage().instance().set(&DataKey::TotalCapital, &0i128);
        env.storage().instance().set(&DataKey::AvailableCapital, &0i128);
        env.storage().instance().set(&DataKey::ClaimsPaid, &0i128);
        access_control::init_access_control(&env, &admin);
        Ok(())
    }

    pub fn set_role(env: Env, addr: Address, role: AccessControlRole) -> Result<(), RiskPoolError> {
        access_control::set_role(&env, &env.current_contract_address(), &addr, role);
        Ok(())
    }

    pub fn deposit_liquidity(env: Env, provider: Address, amount: i128) -> Result<(), RiskPoolError> {
        provider.require_auth();
        
        let min_stake: i128 = env.storage().instance().get(&DataKey::MinStake)
            .ok_or(RiskPoolError::NotInitialized)?;

        if amount < min_stake {
            return Err(RiskPoolError::BelowMinimumStake);
        }

        let token: Address = env.storage().instance().get(&DataKey::Token)
            .ok_or(RiskPoolError::NotInitialized)?;
        
        // Transfer tokens from provider to this contract
        let client = soroban_sdk::token::Client::new(&env, &token);
        client.transfer(&provider, &env.current_contract_address(), &amount);

        let current_stake = get_provider_stake(&env, &provider);
        let new_stake = current_stake + amount;
        env.storage().persistent().set(&DataKey::ProviderStake(provider.clone()), &new_stake);

        let new_total = get_total_capital(&env) + amount;
        let new_available = get_available_capital(&env) + amount;
        env.storage().instance().set(&DataKey::TotalCapital, &new_total);
        env.storage().instance().set(&DataKey::AvailableCapital, &new_available);

        // #412: Enhanced event emission with provider info
        env.events().publish(
            (symbol_short!("pool"), symbol_short!("deposit")),
            (provider, amount, new_stake),
        );
        Ok(())
    }

    pub fn withdraw_liquidity(env: Env, provider: Address, amount: i128) -> Result<(), RiskPoolError> {
        provider.require_auth();

        let stake = get_provider_stake(&env, &provider);
        if stake < amount {
            return Err(RiskPoolError::InsufficientStake);
        }

        let avail = get_available_capital(&env);
        if avail < amount {
            return Err(RiskPoolError::InsufficientPoolFunds);
        }

        let token: Address = env.storage().instance().get(&DataKey::Token)
            .ok_or(RiskPoolError::NotInitialized)?;
        let client = soroban_sdk::token::Client::new(&env, &token);
        client.transfer(&env.current_contract_address(), &provider, &amount);

        let new_stake = stake - amount;
        env.storage().persistent().set(&DataKey::ProviderStake(provider.clone()), &new_stake);
        
        let new_total = get_total_capital(&env) - amount;
        let new_available = avail - amount;
        env.storage().instance().set(&DataKey::TotalCapital, &new_total);
        env.storage().instance().set(&DataKey::AvailableCapital, &new_available);

        // #412: Enhanced event emission
        env.events().publish(
            (symbol_short!("pool"), symbol_short!("withdraw")),
            (provider, amount, new_stake),
        );
        Ok(())
    }

    pub fn payout_claim(env: Env, recipient: Address, amount: i128) -> Result<(), RiskPoolError> {
        let caller = env.current_contract_address();
        access_control::require_role(&env, &caller, &AccessControlRole::Admin);

        // #410: Verify available capital before payout
        let avail = get_available_capital(&env);
        if avail < amount {
            return Err(RiskPoolError::InsufficientPoolFunds);
        }

        let token: Address = env.storage().instance().get(&DataKey::Token)
            .ok_or(RiskPoolError::NotInitialized)?;
        let client = soroban_sdk::token::Client::new(&env, &token);
        client.transfer(&env.current_contract_address(), &recipient, &amount);

        let new_available = avail - amount;
        env.storage().instance().set(&DataKey::AvailableCapital, &new_available);

        let paid = env.storage().instance().get(&DataKey::ClaimsPaid).unwrap_or(0);
        env.storage().instance().set(&DataKey::ClaimsPaid, &(paid + amount));

        // #412: Enhanced event emission with recipient info
        env.events().publish(
            (symbol_short!("pool"), symbol_short!("payout")),
            (recipient, amount, new_available),
        );
        Ok(())
    }

    pub fn get_pool_stats(env: Env) -> PoolStats {
        PoolStats {
            total_capital: get_total_capital(&env),
            available_capital: get_available_capital(&env),
            total_claims_paid: env.storage().instance().get(&DataKey::ClaimsPaid).unwrap_or(0),
        }
    }

    pub fn get_provider_info(env: Env, provider: Address) -> i128 {
        get_provider_stake(&env, &provider)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Env, Address};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        let contract = env.register_contract(None, RiskPoolContract);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        env.mock_all_auths();
        env.as_contract(&contract, || {
            RiskPoolContract::initialize(env.clone(), admin.clone(), token, 100).unwrap();
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
