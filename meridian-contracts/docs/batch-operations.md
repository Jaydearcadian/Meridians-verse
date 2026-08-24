# Batch Operations

High-volume users and integrators repeatedly call single-entity entry points
(e.g. `issue_policy`, `submit_claim`) in loops, paying full gas per call.
The batch variants in this release reduce that cost by amortising per-call
overhead across many items in a single transaction.

---

## Contents

1. [How it works](#how-it-works)
2. [Gas refund accounting](#gas-refund-accounting)
3. [Fee discounts](#fee-discounts)
4. [Batch entry points by contract](#batch-entry-points-by-contract)
   - [Policy](#policy)
   - [Claims](#claims)
   - [Risk Pool](#risk-pool)
   - [Escrow](#escrow)
   - [Property Token](#property-token)
   - [Oracle](#oracle)
   - [ZK Compliance](#zk-compliance)
   - [IPFS Metadata](#ipfs-metadata)
5. [All-or-nothing semantics](#all-or-nothing-semantics)
6. [Batch size limits](#batch-size-limits)
7. [Usage examples](#usage-examples)
8. [Gas savings reference table](#gas-savings-reference-table)

---

## How it works

Each batch entry point:

1. **Validates the batch** — rejects empty batches and batches exceeding the
   per-contract maximum (see [Batch size limits](#batch-size-limits)).
2. **Iterates items atomically** — each item goes through the same validation
   as its single-item counterpart.  A failure on any item panics the entire
   transaction (all-or-nothing, see below).
3. **Emits a single batch event** — instead of N individual events a single
   compact `BTCH*` event is emitted containing the item count and a summary
   (first/last IDs where applicable).
4. **Returns aggregate results** — the return value carries all newly created
   IDs and, for `BatchResult`-returning methods, per-item success/failure
   details plus an instruction-savings estimate.

---

## Gas refund accounting

Soroban instruction budgets and ink! `ref_time`/`proof_size` limits are
consumed per transaction, not per entry-point call.  Batching therefore
reduces the number of transactions — and hence the number of times you pay
the per-transaction overhead.

The shared `GasMeter` utility in `contracts/lib/src/batch.rs` estimates the
savings:

```
savings = (N − 1) × SINGLE_CALL_OVERHEAD − (batch_total × 0.05)
```

where `SINGLE_CALL_OVERHEAD` is a conservative 200 000 instructions per call.
In production WASM the actual value is reported as zero (the Soroban budget
API is not exposed in WASM); the estimate is purely informational.

The `estimated_savings_instructions` field of `BatchResult` surfaces this
value for off-chain tooling.

---

## Fee discounts

The `FeeManager` (fees contract) applies tiered discounts when callers use
batch operations.  Use `calculate_batch_fee(operation, item_count)` to get
the discounted aggregate fee before submitting a batch.

| Items in batch | Discount |
|---------------|----------|
| 1 – 4         | 0 %      |
| 5 – 9         | 5 %      |
| 10 – 19       | 10 %     |
| 20 – 49       | 15 %     |
| 50 +          | 20 %     |

**Example** — 10 `RegisterProperty` operations at 1 000 units each:

```
aggregate = 10 × 1 000 = 10 000
discount  = 10 000 × 10% = 1 000
total fee = 9 000
```

---

## Batch entry points by contract

### Policy

| Method | Parameters | Returns | Auth |
|--------|-----------|---------|------|
| `issue_policies_batch` | `Vec<(holder, coverage, premium, duration_days, policy_type)>` | `Vec<u64>` policy IDs | Admin |
| `renew_policies_batch` | `Vec<(policy_id, extra_days)>` | `()` | Per-item holder |
| `cancel_policies_batch` | `Vec<policy_id>` | `()` | Per-item holder |

### Claims

| Method | Parameters | Returns | Auth |
|--------|-----------|---------|------|
| `submit_claims_batch` | `Vec<(policy_id, amount)>` | `Vec<u64>` claim IDs | Per-item policy holder |

### Risk Pool

| Method | Parameters | Returns | Auth |
|--------|-----------|---------|------|
| `deposit_liquidity_batch` | `Vec<(provider, amount)>` | `u32` count | Per-item provider |
| `withdraw_liquidity_batch` | `Vec<(provider, amount)>` | `u32` count | Per-item provider |

### Escrow

| Method | Parameters | Returns | Auth |
|--------|-----------|---------|------|
| `create_escrows_batch` | `Vec<(property_id, amount, buyer, seller, participants, required_sigs, time_lock, nonce)>` | `Vec<u64>` IDs | None (nonce-gated) |
| `deposit_funds_batch` | `Vec<(escrow_id, amount)>` | `u32` count | None (status-gated) |
| `sign_approval_batch` | `Vec<(escrow_id, approval_type, signer)>` | `u32` count | Per-item signer |

### Property Token

| Method | Parameters | Returns | Auth |
|--------|-----------|---------|------|
| `safe_batch_transfer_from` | *(pre-existing)* | — | — |
| `issue_shares_batch` | `Vec<(token_id, recipient, amount)>` | `u32` count | Admin |
| `place_ask_batch` | `Vec<(token_id, price_per_share, amount)>` | `u32` count | Caller (seller) |

### Oracle

| Method | Parameters | Returns | Auth |
|--------|-----------|---------|------|
| `batch_request_valuations` | `Vec<u64>` property IDs | `Vec<u64>` request IDs | None |
| `add_oracle_sources_batch` | `Vec<OracleSource>` | `u32` count | Admin |
| `update_source_reputation_batch` | `Vec<(source_id, success)>` | `u32` count | Admin |

### ZK Compliance

| Method | Parameters | Returns | Auth |
|--------|-----------|---------|------|
| `batch_submit_zk_proofs` | `Vec<(proof_type, public_inputs, proof_data, extra)>` | `u32` count | None (proof-gated) |
| `batch_verify_zk_proofs` | `Vec<(account, property_id, expected)>` | `Vec<(u64, bool)>` | None |

### IPFS Metadata

| Method | Parameters | Returns | Auth |
|--------|-----------|---------|------|
| `register_ipfs_documents_batch` | `Vec<(property_id, cid, doc_type, hash, size, mime, encrypted)>` | `Vec<u64>` IDs | Per-item write access |
| `verify_content_hash_batch` | `Vec<(document_id, hash)>` | `Vec<(u64, bool)>` | Per-item read access |

---

## All-or-nothing semantics

All batch entry points on Soroban contracts use `panic!()` on item-level
failure.  Because Soroban rolls back the ledger state on panic, **the entire
transaction is reversed** if any single item in the batch fails.

```
┌────────────────────────────────────────────────────┐
│  issue_policies_batch([item0, item1 ✗, item2])      │
│                                                    │
│  item0: OK (policy 1 stored)  ──────────┐          │
│  item1: FAIL (coverage > max) ─── PANIC │          │
│                                         ▼          │
│              ← entire transaction rolled back ─── │
│  item0 policy 1 does NOT exist after the call      │
└────────────────────────────────────────────────────┘
```

For ink! contracts (oracle, zk-compliance, ipfs-metadata) the same
all-or-nothing guarantee applies via `return Err(...)` short-circuit.

The `verify_content_hash_batch` and `batch_verify_zk_proofs` methods are
**exceptions** — they do not short-circuit on failure because verification
is a read-only query that should return results for all items.

---

## Batch size limits

| Contract | Limit | Rationale |
|----------|-------|-----------|
| policy | 50 | Soroban instruction budget |
| claims | 50 | Cross-contract call depth |
| risk_pool | 50 | Token transfer loop |
| escrow | create: 20, deposit/sign: 50 | Higher per-item cost for create |
| property-token | 50 | ink! ref_time budget |
| oracle | 50 | Mapping writes |
| zk-compliance | 20 | Proof verification overhead |
| ipfs-metadata | 50 | Mapping writes |

---

## Usage examples

### TypeScript / Stellar SDK

```typescript
import { Contract, SorobanRpc } from '@stellar/stellar-sdk';

// Issue 3 policies in one batch call
const result = await policyContract.call(
  'issue_policies_batch',
  [
    [holder1, 1000n, 100n, 365, 'Standard'],
    [holder2, 2000n, 200n, 180, 'Standard'],
    [holder3, 3000n, 300n,  90, 'Standard'],
  ]
);
console.log('Policy IDs:', result.value); // [1n, 2n, 3n]
```

### Rust / Soroban test harness

```rust
use soroban_sdk::{vec, Env};

let mut requests = vec![&env];
requests.push_back((holder1, 1_000i128, 100i128, 365u32, PolicyType::Standard));
requests.push_back((holder2, 2_000i128, 200i128, 180u32, PolicyType::Standard));

let ids = env.as_contract(&contract, || {
    PolicyContract::issue_policies_batch(env.clone(), requests)
});
assert_eq!(ids.len(), 2);
```

### ink! / polkadot.js

```typescript
// Register 3 IPFS documents in one call
const tx = await ipfsContract.tx.registerIpfsDocumentsBatch({
  gasLimit,
  value: 0,
}, [
  [propertyId, 'QmAbc…', 'Deed', contentHash1, 1024, 'application/pdf', false],
  [propertyId, 'QmDef…', 'Title', contentHash2, 2048, 'application/pdf', false],
  [propertyId, 'QmGhi…', 'Images', contentHash3, 5120, 'image/jpeg', false],
]);
await tx.signAndSend(alice);
```

---

## Gas savings reference table

Estimated instruction savings for a 10-item batch.  Single-call baseline is
250 000 instructions/call (200 000 overhead + 50 000 op-specific).  Batch
baseline is 650 000 total (250 000 fixed + 40 000 per item).

| Contract + Operation | 5 items | 10 items | 20 items | 50 items |
|---------------------|---------|----------|----------|----------|
| policy::issue | 27 % | 35 % | 42 % | 52 % |
| policy::renew | 27 % | 35 % | 42 % | 52 % |
| policy::cancel | 27 % | 35 % | 42 % | 52 % |
| claims::submit | 27 % | 35 % | 42 % | 52 % |
| risk_pool::deposit | 27 % | 35 % | 42 % | 52 % |
| risk_pool::withdraw | 27 % | 35 % | 42 % | 52 % |
| escrow::create | 27 % | 35 % | N/A (max 20) | N/A |
| escrow::deposit | 27 % | 35 % | 42 % | 52 % |
| oracle::add_source | 27 % | 35 % | 42 % | 52 % |
| oracle::update_rep | 27 % | 35 % | 42 % | 52 % |
| property-token::issue_shares | 27 % | 35 % | 42 % | 52 % |
| zk-compliance::submit | 27 % | 35 % | N/A (max 20) | N/A |
| ipfs-metadata::register | 27 % | 35 % | 42 % | 52 % |

> **Note:** These figures are computed by the analytical model in
> `scripts/gas_benchmark.sh`. Run the script to generate
> `benchmark_results.json` with the full table including all batch sizes.

---

## Running the benchmark

```bash
# Full benchmark across all contracts (batch sizes 5, 10, 20, 50)
./scripts/gas_benchmark.sh

# Filter to a single contract
./scripts/gas_benchmark.sh --contract policy

# Single batch size
./scripts/gas_benchmark.sh --batch-size 10

# Results are written to benchmark_results.json
cat benchmark_results.json | python3 -m json.tool
```
