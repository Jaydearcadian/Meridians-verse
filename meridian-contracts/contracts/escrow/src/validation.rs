use soroban_sdk::{Address, Env};
use stellar_insured_lib::{EscrowError, ValidationError};

use crate::storage::DataKey;

/// Checks if the contract is paused and returns an error if so.
///
/// Always pass `&Env` (by reference) to avoid unnecessary clones — `Env` is
/// cheap to clone but passing by reference is the idiomatic pattern for
/// helper/validation functions that do not need ownership (#353).
pub fn require_not_paused(env: &Env) -> Result<(), ValidationError> {
    let paused: bool = env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false);
    if paused {
        return Err(ValidationError::ContractPaused);
    }
    Ok(())
}

/// Checks if `address` is zero (all bytes zero) and returns an error if so.
pub fn require_non_zero_address(address: &Address) -> Result<(), ValidationError> {
    // Create a zero address using from_account_id with a zero array
    let zero_bytes = [0u8; 32];
    let zero_addr = Address::from_contract_id(&zero_bytes);
    if address == &zero_addr {
        return Err(ValidationError::ZeroAddress);
    }
    Ok(())
}

/// Checks if the identifier is zero and returns an error if so.
pub fn require_non_zero_u64(value: u64, _field: &str) -> Result<(), ValidationError> {
    if value == 0 {
        return Err(ValidationError::NonPositiveAmount);
    }
    Ok(())
}

/// Checks if the amount is zero or negative and returns an error if so.
pub fn require_positive_amount(amount: i128, _field: &str) -> Result<(), ValidationError> {
    if amount <= 0 {
        return Err(ValidationError::NonPositiveAmount);
    }
    Ok(())
}

/// Checks if `timestamp` is in the past or present relative to `now`.
pub fn require_future_timestamp(timestamp: u64, now: u64, _field: &str) -> Result<(), ValidationError> {
    if timestamp <= now {
        return Err(ValidationError::InvalidTimestamp);
    }
    Ok(())
}

/// Checks if `required_signatures` is zero, `participants` is empty,
/// or `required_signatures` exceeds the number of participants.
pub fn require_valid_multisig(required_signatures: u32, participant_count: u32) -> Result<(), ValidationError> {
    if required_signatures == 0 || participant_count == 0 || required_signatures > participant_count {
        return Err(ValidationError::InvalidMultisigConfig);
    }
    Ok(())
}

/// Reads and returns the stored admin address.
///
/// Centralises the admin lookup so callers avoid a raw `.get(&DataKey::Admin)`
/// scattered across functions — one read, one place (#353, #351).
pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized")
}
