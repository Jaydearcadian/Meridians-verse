//! ABI trait and versioned dispatch helpers for the Claims contract.
//!
//! ## ClaimsAbi – method catalogue (v1.0)
//!
//! | Method          | Symbol       | Caller-required version |
//! |-----------------|--------------|-------------------------|
//! | `submit_claim`  | `sub_clm`    | 1.0                     |
//! | `approve_claim` | `approve`    | 1.0                     |
//! | `reject_claim`  | `reject`     | 1.0                     |
//! | `settle_claim`  | `settle`     | 1.0                     |
//! | `get_claim`     | `get_claim`  | 1.0                     |
//! | `get_stats`     | `get_stats`  | 1.0                     |
//!
//! All helpers call `get_supported_abis` on the target before invoking the
//! entry point, preventing silent calls to mismatched entry points after an
//! upgrade.

#![no_std]

use soroban_sdk::{symbol_short, Address, Env, IntoVal, Symbol};
use stellar_insured_lib::abi_dispatch::{check_abi, CLAIMS_V1};
use stellar_insured_lib::InsuranceClaim;

// ---------------------------------------------------------------------------
// Typed dispatch helpers – used by external callers (e.g. Governance)
// ---------------------------------------------------------------------------

/// Call `approve(claim_id)` on the Claims contract at `target`
/// after verifying ABI v1.0 compatibility.
pub fn approve_claim(env: &Env, target: &Address, claim_id: u64) {
    check_abi(env, target, CLAIMS_V1);
    env.invoke_contract::<()>(
        target,
        &symbol_short!("approve"),
        soroban_sdk::vec![env, claim_id.into_val(env)],
    );
}

/// Call `reject(claim_id)` on the Claims contract at `target`
/// after verifying ABI v1.0 compatibility.
pub fn reject_claim(env: &Env, target: &Address, claim_id: u64) {
    check_abi(env, target, CLAIMS_V1);
    env.invoke_contract::<()>(
        target,
        &symbol_short!("reject"),
        soroban_sdk::vec![env, claim_id.into_val(env)],
    );
}

/// Call `get_claim(claim_id)` on the Claims contract at `target`
/// after verifying ABI v1.0 compatibility.
pub fn get_claim(env: &Env, target: &Address, claim_id: u64) -> InsuranceClaim {
    check_abi(env, target, CLAIMS_V1);
    env.invoke_contract(
        target,
        &symbol_short!("get_claim"),
        soroban_sdk::vec![env, claim_id.into_val(env)],
    )
}

/// Call `get_stats()` on the Claims contract at `target`
/// after verifying ABI v1.0 compatibility.
pub fn get_stats(env: &Env, target: &Address) -> u64 {
    check_abi(env, target, CLAIMS_V1);
    env.invoke_contract(
        target,
        &symbol_short!("get_stats"),
        soroban_sdk::Vec::new(env),
    )
}
