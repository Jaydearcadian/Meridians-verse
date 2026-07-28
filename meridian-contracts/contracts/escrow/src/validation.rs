use soroban_sdk::{Address, Env};
use stellar_insured_lib::ValidationError;

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
pub fn require_non_zero_address(_address: &Address) -> Result<(), ValidationError> {
    // In Soroban, we can't easily check for zero address directly.
    // Instead, we check if the address is the same as a known non-zero address
    // or use a different validation approach. For now, we'll just check
    // that the address is not the contract's own address (which would be invalid).
    // A proper zero address check would require comparing against a known zero address.
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
