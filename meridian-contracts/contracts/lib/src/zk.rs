//! Pure, dependency-free helpers for validating zero-knowledge proof payloads.
//!
//! These helpers mirror the pre-deserialization sanity checks performed by the
//! on-chain Groth16 verifiers (see `contracts/zk-compliance`). They are used by
//! the fuzz/security test suites to exercise malformed-proof handling without
//! depending on arkworks.
//!
//! > **Security note:** cryptographic soundness comes from the Groth16 pairing
//! > checks executed on-chain. These helpers are a *gate* (reject obviously
//! > malformed input early), not a substitute for the proof verification itself.
//!
//! A mirrored copy of the canonicality check lives in
//! `contracts/zk-compliance/src/verification_keys.rs` (that crate cannot depend
//! on this library without pulling in unrelated dependencies). Keep the two in
//! sync.

/// Compressed Groth16 proof length for Bn254 (A ∈ G1 + B ∈ G2 + C ∈ G1).
pub const GROTH16_BN254_PROOF_LEN: usize = 128;

/// Upper bound on a serialized proof payload accepted by the on-chain verifier.
pub const MAX_PROOF_LEN: usize = 1024;

/// Minimum plausible proof payload length (rejects empty/trivial inputs).
pub const MIN_PROOF_LEN: usize = 32;

/// Maximum number of public inputs accepted for a Bn254 Groth16 proof.
pub const MAX_PUBLIC_INPUTS: usize = 64;

/// Bn254 scalar field order
/// (21888242871839275222246405745257275088548364400416034343698204186575808495617)
/// expressed as little-endian u64 limbs.
///
/// hex: 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47
const BN254_MODULUS_LIMBS_LE: [u64; 4] = [
    0x3c20_8c16_d87c_fd47,
    0x9781_6a91_6871_ca8d,
    0xb850_45b6_8181_585d,
    0x3064_4e72_e131_a029,
];

/// Returns `true` when the 32 little-endian bytes encode a canonical Bn254
/// scalar field element, i.e. the value is strictly less than the group order.
///
/// Non-canonical encodings (values ≥ modulus) are rejected by the on-chain
/// verifiers to prevent input malleability.
pub fn is_canonical_field_element(bytes: &[u8; 32]) -> bool {
    let mut limbs = [0u64; 4];
    for (i, limb) in limbs.iter_mut().enumerate() {
        let mut acc = 0u64;
        for j in 0..8 {
            acc |= (bytes[i * 8 + j] as u64) << (8 * j);
        }
        *limb = acc;
    }
    // Compare from the most significant limb down.
    for i in (0..4).rev() {
        if limbs[i] < BN254_MODULUS_LIMBS_LE[i] {
            return true;
        }
        if limbs[i] > BN254_MODULUS_LIMBS_LE[i] {
            return false;
        }
    }
    // Exactly equal to the modulus -> not canonical.
    false
}

/// Returns `true` when the serialized proof payload is inside the accepted
/// length window. Actual structural validation is performed by arkworks during
/// deserialization on-chain.
pub fn validate_proof_payload(payload: &[u8]) -> bool {
    !payload.is_empty()
        && payload.len() >= MIN_PROOF_LEN
        && payload.len() <= MAX_PROOF_LEN
}

/// Returns `true` when the public-input set is well-formed: non-empty, bounded
/// in size, and every element is a canonical Bn254 scalar field element.
pub fn validate_public_inputs(inputs: &[[u8; 32]]) -> bool {
    !inputs.is_empty()
        && inputs.len() <= MAX_PUBLIC_INPUTS
        && inputs.iter().all(|input| is_canonical_field_element(input))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_length_window() {
        assert!(!validate_proof_payload(&[]));
        assert!(!validate_proof_payload(&[0u8; 31]));
        assert!(validate_proof_payload(&[0u8; GROTH16_BN254_PROOF_LEN]));
        assert!(validate_proof_payload(&[0u8; 512]));
        assert!(!validate_proof_payload(&[0u8; MAX_PROOF_LEN + 1]));
    }

    #[test]
    fn canonical_field_element_boundaries() {
        assert!(is_canonical_field_element(&[0u8; 32]));

        // All-ones is far above the modulus -> non-canonical.
        assert!(!is_canonical_field_element(&[0xffu8; 32]));

        // modulus - 1 (limb0 decremented) is the largest canonical value.
        let mut m_minus_one = [0u8; 32];
        let limbs = [
            0x3c20_8c16_d87c_fd46u64,
            0x9781_6a91_6871_ca8du64,
            0xb850_45b6_8181_585du64,
            0x3064_4e72_e131_a029u64,
        ];
        for (i, limb) in limbs.iter().enumerate() {
            for j in 0..8 {
                m_minus_one[i * 8 + j] = ((limb >> (8 * j)) & 0xff) as u8;
            }
        }
        assert!(is_canonical_field_element(&m_minus_one));

        // Exactly the modulus -> not canonical.
        let mut modulus = m_minus_one;
        modulus[0] = modulus[0].wrapping_add(1);
        assert!(!is_canonical_field_element(&modulus));
    }

    #[test]
    fn public_inputs_validation() {
        assert!(!validate_public_inputs(&[]));
        assert!(validate_public_inputs(&[[0u8; 32]]));
        assert!(!validate_public_inputs(&[[0xffu8; 32]]));
        // Array literals are used instead of `vec!` because this is a `#![no_std]`
        // crate and the `vec!` macro is not in the prelude.
        let many = [[0u8; 32]; MAX_PUBLIC_INPUTS];
        assert!(validate_public_inputs(&many));
        let too_many = [[0u8; 32]; MAX_PUBLIC_INPUTS + 1];
        assert!(!validate_public_inputs(&too_many));
    }
}
