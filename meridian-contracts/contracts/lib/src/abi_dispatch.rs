//! Soroban ABI version-check and typed dispatch helpers shared by all
//! contracts in this workspace.
//!
//! Every Soroban contract stores its ABI range in instance storage under two
//! well-known keys and exposes it via `get_supported_abis()`.  Callers use the
//! helpers in this module to verify compatibility before making a
//! cross-contract call, replacing raw `symbol_short!` invocations with typed,
//! version-guarded wrappers.
//!
//! # Storage keys
//!
//! | Key                 | Type  | Meaning                                |
//! |---------------------|-------|----------------------------------------|
//! | `ABI_KEY_MIN`       | `u32` | Oldest version still served (packed)   |
//! | `ABI_KEY_CURRENT`   | `u32` | Current version (packed)               |
//!
//! # Version encoding
//!
//! `packed = major * 1_000 + minor`  (fits in `u32` for major ≤ 65 535)

#![allow(dead_code)]

use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol, Vec};

// ---------------------------------------------------------------------------
// Version constants (packed u32: major * 1000 + minor)
// ---------------------------------------------------------------------------

pub const CLAIMS_V1: u32 = 1_000; // 1.0
pub const POLICY_V1: u32 = 1_000; // 1.0
pub const RISK_POOL_V1: u32 = 1_000; // 1.0
pub const RISK_POOL_V2: u32 = 1_001; // 1.1 (V2 storage migration)
pub const GOVERNANCE_V1: u32 = 1_000; // 1.0
pub const SLASHING_V1: u32 = 1_000; // 1.0
pub const ESCROW_V1: u32 = 1_000; // 1.0
pub const ESCROW_V2: u32 = 1_001; // 1.1 (V2 storage migration)
pub const ZK_COMPLIANCE_V1: u32 = 1_000; // 1.0
pub const PROPERTY_TOKEN_V1: u32 = 1_000; // 1.0
pub const INSURANCE_V1: u32 = 1_000; // 1.0

// ---------------------------------------------------------------------------
// Storage keys written during initialisation
// ---------------------------------------------------------------------------

/// Instance-storage keys for the ABI version registry.
#[contracttype]
#[derive(Clone)]
pub enum AbiStorageKey {
    AbiVersionMin,
    AbiVersionCurrent,
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/// Write `min_version` and `current_version` into instance storage.
///
/// Call this at the end of each contract's `initialize` entry point.
pub fn init_abi(env: &Env, min_version: u32, current_version: u32) {
    env.storage()
        .instance()
        .set(&AbiStorageKey::AbiVersionMin, &min_version);
    env.storage()
        .instance()
        .set(&AbiStorageKey::AbiVersionCurrent, &current_version);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/// Read the ABI range from the *calling* contract's own instance storage.
///
/// Returns `(min_packed, current_packed)`.  Both are 0 if not initialised.
pub fn read_own_abi(env: &Env) -> (u32, u32) {
    let min: u32 = env
        .storage()
        .instance()
        .get(&AbiStorageKey::AbiVersionMin)
        .unwrap_or(0);
    let cur: u32 = env
        .storage()
        .instance()
        .get(&AbiStorageKey::AbiVersionCurrent)
        .unwrap_or(0);
    (min, cur)
}

// ---------------------------------------------------------------------------
// Compatibility check
// ---------------------------------------------------------------------------

/// Check whether a packed `required` version is compatible with a `(min, cur)` range.
///
/// Compatible means:
/// - same major (`required / 1000 == cur / 1000`)
/// - `min <= required <= cur`
#[inline]
pub fn is_compatible(min: u32, cur: u32, required: u32) -> bool {
    let req_major = required / 1_000;
    let cur_major = cur / 1_000;
    req_major == cur_major && required >= min && required <= cur
}

/// Query `target.get_supported_abis()` and panic when the result is not
/// compatible with `required`.
///
/// This is the **single call gate** used by every typed dispatch helper.
pub fn check_abi(env: &Env, target: &Address, required: u32) {
    let (min, cur): (u32, u32) = env.invoke_contract(
        target,
        &Symbol::new(env, "get_supported_abis"),
        Vec::new(env),
    );
    if !is_compatible(min, cur, required) {
        panic!(
            "ABI version mismatch: required {} but target supports {}–{}",
            required, min, cur
        );
    }
}

// ---------------------------------------------------------------------------
// Typed dispatch – calls check_abi then invoke_contract
// ---------------------------------------------------------------------------

/// Version-guarded cross-contract call that returns a value.
pub fn dispatch<R: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    target: &Address,
    required: u32,
    method: &Symbol,
    args: Vec<soroban_sdk::Val>,
) -> R {
    check_abi(env, target, required);
    env.invoke_contract(target, method, args)
}

/// Version-guarded cross-contract call that returns `()`.
pub fn dispatch_no_ret(
    env: &Env,
    target: &Address,
    required: u32,
    method: &Symbol,
    args: Vec<soroban_sdk::Val>,
) {
    check_abi(env, target, required);
    env.invoke_contract::<()>(target, method, args);
}
