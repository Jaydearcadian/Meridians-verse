#![no_std]

//! Shared contracts library with common reusable primitives.

pub mod circuit_breaker;
#[cfg(feature = "soroban")]
pub mod random;
#[cfg(any(feature = "soroban", feature = "ink"))]
pub mod validation;
#[cfg(feature = "soroban")]
pub mod insurance_types;
#[cfg(any(feature = "soroban", feature = "ink"))]
pub mod errors;
#[cfg(feature = "soroban")]
pub mod access_control;
#[cfg(feature = "soroban")]
pub mod zk;
#[cfg(all(feature = "verification", feature = "soroban"))]
pub mod verification;
#[cfg(feature = "soroban")]
pub mod events;

#[cfg(feature = "soroban")]
pub use random::Randomness;
#[cfg(feature = "soroban")]
pub use insurance_types::*;
#[cfg(any(feature = "soroban", feature = "ink"))]
pub use errors::*;
#[cfg(feature = "soroban")]
pub use access_control::{AccessControlRole, init_access_control, set_role, require_role, has_role, revoke_role};
pub use circuit_breaker::*;
#[cfg(feature = "soroban")]
pub use zk::*;
#[cfg(feature = "soroban")]
pub use events::*;
#[cfg(any(feature = "soroban", feature = "ink"))]
pub use validation::*;
