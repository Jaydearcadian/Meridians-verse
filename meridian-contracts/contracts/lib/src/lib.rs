#![no_std]

//! Shared contracts library with common reusable primitives.

pub mod random;
pub mod insurance_types;
pub mod errors;
pub mod access_control;

pub use random::Randomness;
pub use insurance_types::*;
pub use errors::*;
pub use access_control::{AccessControlRole, init_access_control, set_role, require_role, has_role, revoke_role};
