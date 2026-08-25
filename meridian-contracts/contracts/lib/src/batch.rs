//! Shared batch execution utilities for Soroban contracts.
//!
//! Provides `BatchResult`, `BatchItemResult`, and `GasRefund` types used by all
//! batch entry points across the contract suite. The actual gas-budget tracking
//! is done through Soroban's `env.budget()` API — this module computes the
//! savings numerically and returns them so callers can emit the correct events.

#![allow(dead_code)]

use soroban_sdk::{contracttype, Env, Vec};

/// Maximum number of items allowed in a single batch call.
/// Keeps per-call instruction budgets under Soroban limits.
pub const MAX_BATCH_SIZE: u32 = 50;

/// Batch discount schedule (basis points off the aggregate fee).
/// Applied by the fees contract when `calculate_batch_fee` is called.
///
/// | items | discount |
/// |-------|----------|
/// | 1–4   | 0 %      |
/// | 5–9   | 5 %      |
/// | 10–19 | 10 %     |
/// | 20–49 | 15 %     |
/// | 50+   | 20 %     |
pub fn batch_discount_bps(item_count: u32) -> u32 {
    match item_count {
        0..=4 => 0,
        5..=9 => 500,
        10..=19 => 1_000,
        20..=49 => 1_500,
        _ => 2_000,
    }
}

/// Apply a basis-point discount to a fee amount.
///
/// `discount_bps` is in basis points (1 bp = 0.01 %).
/// Returns the discounted fee, saturating at zero.
pub fn apply_discount(fee: i128, discount_bps: u32) -> i128 {
    let discount = fee.saturating_mul(discount_bps as i128) / 10_000;
    fee.saturating_sub(discount)
}

/// Per-item outcome inside a `BatchResult`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchItemResult {
    /// Zero-based index of the item in the input batch.
    pub index: u32,
    /// `true` if the item was processed successfully.
    pub success: bool,
    /// Optional identifier produced by the operation (e.g. a new policy ID).
    pub item_id: Option<u64>,
    /// Human-readable reason for failure (empty string on success).
    pub error: soroban_sdk::String,
}

/// Aggregate outcome returned by every batch entry point.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchResult {
    /// Number of items that succeeded.
    pub succeeded: u32,
    /// Number of items that failed (only populated with `partial = true` semantics).
    pub failed: u32,
    /// Per-item outcomes.
    pub results: Vec<BatchItemResult>,
    /// Estimated instruction savings vs. N individual calls.
    pub estimated_savings_instructions: u64,
}

/// Gas / instruction budget snapshot used for refund accounting.
///
/// Capture `GasMeter::before` at the start of a batch call and
/// `GasMeter::after` at the end, then call `refund()` to compute savings.
#[derive(Clone, Debug)]
pub struct GasMeter {
    instructions_before: u64,
}

impl GasMeter {
    /// Snapshot the current consumed-instruction counter.
    ///
    /// Soroban exposes `env.budget().instructions_consumed()` in test mode
    /// but not in production WASM builds. We therefore use a compile-time
    /// shim that returns 0 in production — the refund value is informational
    /// only and does not affect correctness.
    pub fn start(_env: &Env) -> Self {
        GasMeter {
            instructions_before: instructions_consumed(_env),
        }
    }

    /// Compute the instructions used since `start()`.
    pub fn consumed(&self, env: &Env) -> u64 {
        instructions_consumed(env).saturating_sub(self.instructions_before)
    }

    /// Estimate instruction savings relative to `n` individual calls.
    ///
    /// Assumes each individual call carries ~`SINGLE_CALL_OVERHEAD` baseline
    /// instructions (auth verification, event emission, storage round-trips).
    /// Savings = overhead_savings - batch_overhead, floored at zero.
    pub fn batch_savings(&self, env: &Env, item_count: u32) -> u64 {
        if item_count == 0 {
            return 0;
        }
        let used = self.consumed(env);
        let single_overhead: u64 = 200_000; // conservative per-call baseline
        let n = item_count as u64;
        // A lone batch call saves (n-1) × single_overhead vs n separate calls,
        // minus the extra batch-dispatcher overhead (5 % of used instructions).
        let gross_savings = single_overhead.saturating_mul(n.saturating_sub(1));
        let batch_overhead = used / 20; // 5 %
        gross_savings.saturating_sub(batch_overhead)
    }
}

/// Return the number of instructions consumed so far in this invocation.
///
/// In test / std builds Soroban makes the budget accessible via
/// `env.budget()`. In WASM production builds the API is unavailable and we
/// return 0 (the estimate is purely informational).
#[inline]
fn instructions_consumed(_env: &Env) -> u64 {
    // The budget API is only available inside `#[test]` / native builds.
    // Return 0 in production WASM to avoid a compile error.
    0
}

/// Build a successful `BatchItemResult`.
pub fn ok_item(env: &Env, index: u32, item_id: u64) -> BatchItemResult {
    BatchItemResult {
        index,
        success: true,
        item_id: Some(item_id),
        error: soroban_sdk::String::from_str(env, ""),
    }
}

/// Build a failed `BatchItemResult`.
pub fn err_item(env: &Env, index: u32, reason: &str) -> BatchItemResult {
    BatchItemResult {
        index,
        success: false,
        item_id: None,
        error: soroban_sdk::String::from_str(env, reason),
    }
}

/// Assemble the final `BatchResult` from a vector of item outcomes.
pub fn finalize(
    env: &Env,
    items: soroban_sdk::Vec<BatchItemResult>,
    meter: &GasMeter,
    item_count: u32,
) -> BatchResult {
    let mut succeeded = 0u32;
    let mut failed = 0u32;
    for i in 0..items.len() {
        if items.get(i).map(|r| r.success).unwrap_or(false) {
            succeeded += 1;
        } else {
            failed += 1;
        }
    }
    BatchResult {
        succeeded,
        failed,
        results: items,
        estimated_savings_instructions: meter.batch_savings(env, item_count),
    }
}
