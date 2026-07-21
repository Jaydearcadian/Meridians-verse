#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};
use stellar_insured_lib::PoolStats;

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

// --- Storage helpers (#378: data access abstraction) ---

fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

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
        let admin = get_admin(&env);
        admin.require_auth();

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
}

#[contractimpl]
impl RiskPoolContract {
    pub fn get_pool_stats(env: Env) -> PoolStats {
        PoolStats {
            total_capital: get_total_capital(&env),
            available_capital: get_available_capital(&env),
            total_claims_paid: env.storage().instance().get(&DataKey::ClaimsPaid).unwrap_or(0),
            provider_count: 0,
        }
    }

    // Short-name alias used by claims contract via cross-contract call
    pub fn get_stats(env: Env) -> PoolStats {
        Self::get_pool_stats(env)
    }

    // Short-name alias for payout_claim — matches symbol called by claims contract
    pub fn payout(env: Env, recipient: Address, amount: i128) {
        Self::payout_claim(env, recipient, amount)
    }

    pub fn get_provider_info(env: Env, provider: Address) -> i128 {
        get_provider_stake(&env, &provider)
    }
}
