//! ABI versioning, compatibility checking, and typed cross-contract dispatch.
//!
//! # Design
//!
//! Every contract exposes a minimum and maximum supported ABI version through
//! instance storage and the `get_supported_abis()` entry point.  Before calling
//! another contract a caller uses `check_abi_compatibility` to verify the
//! target supports the version it needs, then uses the `dispatch` helper to
//! invoke the entry point.  If the version is unsupported the helper panics
//! with a descriptive message instead of silently reaching the wrong entry
//! point.
//!
//! ## Version scheme
//!
//! Versions are `(major, minor)` pairs encoded as a single `u32`:
//!
//! ```text
//! version = major * 1000 + minor   (major ∈ 0..65, minor ∈ 0..999)
//! ```
//!
//! - **Same major** → backward-compatible upgrade; callers on any minor ≥
//!   `caller_min_minor` may proceed.
//! - **Different major** → breaking change; callers must be updated to the new
//!   major before they can talk to the upgraded callee.
//!
//! ## Storage layout
//!
//! Each Soroban contract stores two keys in instance storage:
//!
//! | Key                  | Type  | Description                              |
//! |----------------------|-------|------------------------------------------|
//! | `AbiVersionMin`      | `u32` | Oldest version this contract still serves |
//! | `AbiVersionCurrent`  | `u32` | Current (newest) version                  |
//!
//! ink! contracts store the same data via the `AbiRegistry` storage item.
//!
//! ## Dispatch protocol
//!
//! ```text
//! caller                         callee
//!   │── check_abi_compatibility ──►│  (query get_supported_abis)
//!   │◄── Ok / Err ─────────────────│
//!   │── dispatch(env, addr,        │
//!   │     version, method, args) ──►│
//!   │◄── return value ─────────────│
//! ```
//!
//! The `dispatch` helper is a thin wrapper around `env.invoke_contract` that
//! gates the call on a version compatibility check so raw string selectors can
//! never reach a mismatched callee silently.

#![cfg_attr(not(feature = "std"), no_std)]

// ---------------------------------------------------------------------------
// Shared (no_std-compatible) types used by both runtimes
// ---------------------------------------------------------------------------

/// A packed `(major, minor)` ABI version.
///
/// Encoded as `major * 1000 + minor`.  This fits in a `u32` as long as
/// `major ≤ 65_535` and `minor ≤ 999`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "scale", derive(scale::Encode, scale::Decode))]
#[cfg_attr(
    all(feature = "scale", feature = "std"),
    derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
)]
pub struct AbiVersion {
    pub major: u16,
    pub minor: u16,
}

impl AbiVersion {
    /// Construct a new version.
    pub const fn new(major: u16, minor: u16) -> Self {
        Self { major, minor }
    }

    /// Pack into the 32-bit wire format used for Soroban storage.
    pub const fn to_u32(self) -> u32 {
        self.major as u32 * 1_000 + self.minor as u32
    }

    /// Unpack from the 32-bit wire format.
    pub const fn from_u32(v: u32) -> Self {
        Self {
            major: (v / 1_000) as u16,
            minor: (v % 1_000) as u16,
        }
    }

    /// Returns `true` when `self` is compatible with `required`.
    ///
    /// A version is compatible when it shares the same major number and its
    /// minor number is ≥ the required minor number.
    pub const fn is_compatible_with(self, required: AbiVersion) -> bool {
        self.major == required.major && self.minor >= required.minor
    }
}

/// A version range `[min, current]` advertised by a contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "scale", derive(scale::Encode, scale::Decode))]
#[cfg_attr(
    all(feature = "scale", feature = "std"),
    derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
)]
pub struct AbiCompatibility {
    /// Oldest version still served by this contract.
    pub min_version: AbiVersion,
    /// Current (newest) version.
    pub current_version: AbiVersion,
}

impl AbiCompatibility {
    pub const fn new(min_version: AbiVersion, current_version: AbiVersion) -> Self {
        Self {
            min_version,
            current_version,
        }
    }

    /// Returns `true` when the contract can serve `requested`.
    pub const fn supports(&self, requested: AbiVersion) -> bool {
        // Same major, and requested minor is between [min_minor, current_minor].
        self.current_version.major == requested.major
            && requested.minor >= self.min_version.minor
            && requested.minor <= self.current_version.minor
    }
}

// ---------------------------------------------------------------------------
// Well-known ABI versions for each Soroban contract family
// ---------------------------------------------------------------------------

/// Current ABI version constants used in Soroban contracts.
pub mod versions {
    use super::AbiVersion;

    pub const CLAIMS_V1: AbiVersion = AbiVersion::new(1, 0);
    pub const POLICY_V1: AbiVersion = AbiVersion::new(1, 0);
    pub const RISK_POOL_V1: AbiVersion = AbiVersion::new(1, 0);
    pub const RISK_POOL_V2: AbiVersion = AbiVersion::new(1, 1); // V2 storage migration
    pub const GOVERNANCE_V1: AbiVersion = AbiVersion::new(1, 0);
    pub const SLASHING_V1: AbiVersion = AbiVersion::new(1, 0);
    pub const ESCROW_V1: AbiVersion = AbiVersion::new(1, 0);
    pub const ESCROW_V2: AbiVersion = AbiVersion::new(1, 1); // V2 storage migration
    pub const ZK_COMPLIANCE_V1: AbiVersion = AbiVersion::new(1, 0);
    pub const PROPERTY_TOKEN_V1: AbiVersion = AbiVersion::new(1, 0);
    pub const INSURANCE_V1: AbiVersion = AbiVersion::new(1, 0);
}

// ---------------------------------------------------------------------------
// Soroban-only dispatch layer
// ---------------------------------------------------------------------------

/// Soroban-specific ABI storage keys.
#[cfg(feature = "soroban")]
pub mod soroban {
    use super::*;
    use soroban_sdk::{contracttype, Address, Env, IntoVal, Symbol, TryFromVal, Val, Vec};

    /// Storage keys for the ABI version registry stored in instance storage.
    #[contracttype]
    #[derive(Clone)]
    pub enum AbiStorageKey {
        /// Packed `u32` of the oldest compatible version.
        AbiVersionMin,
        /// Packed `u32` of the current version.
        AbiVersionCurrent,
    }

    /// Write the contract's ABI range into instance storage during initialisation.
    ///
    /// Call this inside the contract's `initialize` entry point after all other
    /// setup is complete.
    pub fn init_abi(env: &Env, min: AbiVersion, current: AbiVersion) {
        env.storage()
            .instance()
            .set(&AbiStorageKey::AbiVersionMin, &min.to_u32());
        env.storage()
            .instance()
            .set(&AbiStorageKey::AbiVersionCurrent, &current.to_u32());
    }

    /// Read back the stored ABI range.
    ///
    /// Returns `None` when the contract has not been initialised yet.
    pub fn read_abi(env: &Env) -> Option<AbiCompatibility> {
        let min_raw: u32 = env
            .storage()
            .instance()
            .get(&AbiStorageKey::AbiVersionMin)?;
        let cur_raw: u32 = env
            .storage()
            .instance()
            .get(&AbiStorageKey::AbiVersionCurrent)?;
        Some(AbiCompatibility {
            min_version: AbiVersion::from_u32(min_raw),
            current_version: AbiVersion::from_u32(cur_raw),
        })
    }

    /// Query a remote contract's ABI range via `get_supported_abis()` and
    /// verify that `required` falls within the reported range.
    ///
    /// # Panics
    ///
    /// Panics with a descriptive message when:
    /// - the remote contract returns no ABI info (not initialised), or
    /// - `required` is not within the remote contract's supported range.
    pub fn check_abi_compatibility(env: &Env, target: &Address, required: AbiVersion) {
        // Query the remote contract.
        let (min_raw, cur_raw): (u32, u32) = env.invoke_contract(
            target,
            &Symbol::new(env, "get_supported_abis"),
            Vec::new(env),
        );
        let compat = AbiCompatibility {
            min_version: AbiVersion::from_u32(min_raw),
            current_version: AbiVersion::from_u32(cur_raw),
        };
        if !compat.supports(required) {
            panic!(
                "ABI version mismatch: caller requires {}.{} but target supports {}.{} – {}.{}",
                required.major,
                required.minor,
                compat.min_version.major,
                compat.min_version.minor,
                compat.current_version.major,
                compat.current_version.minor,
            );
        }
    }

    /// Typed cross-contract dispatch with ABI version guard.
    ///
    /// This is the **primary call site** for all cross-contract invocations in
    /// Soroban contracts.  It:
    ///
    /// 1. Calls `check_abi_compatibility` to validate the version.
    /// 2. Invokes `method` on `target` with `args`.
    ///
    /// Use [`dispatch_no_ret`] when the callee returns `()`.
    pub fn dispatch<R>(
        env: &Env,
        target: &Address,
        required: AbiVersion,
        method: &Symbol,
        args: Vec<Val>,
    ) -> R
    where
        R: TryFromVal<Env, Val>,
    {
        check_abi_compatibility(env, target, required);
        env.invoke_contract(target, method, args)
    }

    /// Typed cross-contract dispatch that discards the return value (`()`).
    pub fn dispatch_no_ret(
        env: &Env,
        target: &Address,
        required: AbiVersion,
        method: &Symbol,
        args: Vec<Val>,
    ) {
        check_abi_compatibility(env, target, required);
        env.invoke_contract::<()>(target, method, args);
    }
}

// ---------------------------------------------------------------------------
// ink! ABI registry (shared across ink! contracts)
// ---------------------------------------------------------------------------

/// ink! ABI trait and registry type.
#[cfg(feature = "ink")]
pub mod ink_abi {
    use super::*;
    use ink::prelude::vec::Vec;

    /// An ink! storage item that holds the contract's ABI range.
    ///
    /// Embed this in your contract's storage struct and call
    /// `AbiRegistry::init` in the constructor.
    ///
    /// ```rust,ignore
    /// #[ink(storage)]
    /// pub struct MyContract {
    ///     abi: AbiRegistry,
    ///     // …
    /// }
    ///
    /// impl MyContract {
    ///     #[ink(constructor)]
    ///     pub fn new() -> Self {
    ///         Self { abi: AbiRegistry::init(versions::MY_CONTRACT_V1) }
    ///     }
    /// }
    /// ```
    #[derive(Debug, Clone, scale::Encode, scale::Decode)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
    )]
    pub struct AbiRegistry {
        pub min_version: AbiVersion,
        pub current_version: AbiVersion,
    }

    impl AbiRegistry {
        /// Initialise a registry with a single supported version (min == current).
        pub const fn init(version: AbiVersion) -> Self {
            Self {
                min_version: version,
                current_version: version,
            }
        }

        /// Initialise with an explicit min/current range.
        pub const fn init_range(min: AbiVersion, current: AbiVersion) -> Self {
            Self {
                min_version: min,
                current_version: current,
            }
        }

        /// Returns the compatibility descriptor for this registry.
        pub fn compatibility(&self) -> AbiCompatibility {
            AbiCompatibility {
                min_version: self.min_version,
                current_version: self.current_version,
            }
        }

        /// Returns `(min_packed, current_packed)` for the `get_supported_abis`
        /// message return value.
        pub fn as_tuple(&self) -> (u32, u32) {
            (self.min_version.to_u32(), self.current_version.to_u32())
        }

        /// Returns `true` when `requested` falls within the supported range.
        pub fn supports(&self, requested: AbiVersion) -> bool {
            self.compatibility().supports(requested)
        }
    }

    /// Trait implemented by every ink! contract that participates in ABI
    /// versioning.
    ///
    /// The `get_supported_abis` message is the single public endpoint queried
    /// by callers before making a cross-contract call.
    #[ink::trait_definition]
    pub trait AbiVersioned {
        /// Return `(min_packed, current_packed)` where each value is
        /// `major * 1000 + minor`.
        #[ink(message)]
        fn get_supported_abis(&self) -> (u32, u32);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_round_trips_through_u32() {
        let v = AbiVersion::new(1, 5);
        assert_eq!(AbiVersion::from_u32(v.to_u32()), v);
    }

    #[test]
    fn compatibility_same_major_minor_range() {
        let compat = AbiCompatibility {
            min_version: AbiVersion::new(1, 0),
            current_version: AbiVersion::new(1, 3),
        };
        assert!(compat.supports(AbiVersion::new(1, 0)));
        assert!(compat.supports(AbiVersion::new(1, 2)));
        assert!(compat.supports(AbiVersion::new(1, 3)));
        assert!(!compat.supports(AbiVersion::new(1, 4))); // above current
        assert!(!compat.supports(AbiVersion::new(2, 0))); // wrong major
    }

    #[test]
    fn is_compatible_with_checks_major_and_minor() {
        let v = AbiVersion::new(1, 2);
        assert!(v.is_compatible_with(AbiVersion::new(1, 0)));
        assert!(v.is_compatible_with(AbiVersion::new(1, 2)));
        assert!(!v.is_compatible_with(AbiVersion::new(1, 3)));
        assert!(!v.is_compatible_with(AbiVersion::new(2, 0)));
    }

    #[test]
    fn version_ordering() {
        assert!(AbiVersion::new(1, 1) > AbiVersion::new(1, 0));
        assert!(AbiVersion::new(2, 0) > AbiVersion::new(1, 999));
    }
}
