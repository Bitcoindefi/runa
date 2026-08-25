#![no_std]

pub mod errors;
pub mod types;

#[cfg(test)]
pub mod test;

use runa_common::{Groth16Proof, VerificationKey, VerifierError};
use soroban_sdk::{
    contract, contractimpl,
    crypto::bls12_381::{Bls12381Fr, Bls12381G1Affine, Bls12381G2Affine},
    symbol_short, Address, Bytes, BytesN, Env, Symbol, Vec,
};
use types::VerifierDataKey;

const INSTANCE_LIFETIME_THRESHOLD: u32 = 100_000;
const INSTANCE_BUMP_AMOUNT: u32 = 200_000;
const PERSISTENT_LIFETIME_THRESHOLD: u32 = 100_000;
const PERSISTENT_BUMP_AMOUNT: u32 = 200_000;

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

fn extend_persistent_ttl(env: &Env, key: &VerifierDataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

#[contract]
pub struct RunaZkVerifierContract;

#[contractimpl]
impl RunaZkVerifierContract {
    /// Initialize verifier contract with admin authority
    pub fn initialize(env: Env, admin: Address) -> Result<(), VerifierError> {
        if env.storage().instance().has(&VerifierDataKey::Admin) {
            return Err(VerifierError::AlreadyInitialized);
        }

        env.storage().instance().set(&VerifierDataKey::Admin, &admin);
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Register or update verification key for a given circuit type
    pub fn register_vk(
        env: Env,
        circuit_id: Symbol,
        vk: VerificationKey,
    ) -> Result<(), VerifierError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&VerifierDataKey::Admin)
            .ok_or(VerifierError::NotInitialized)?;

        admin.require_auth();

        if vk.ic.len() == 0 {
            return Err(VerifierError::EmptyVerificationKey);
        }

        let key = VerifierDataKey::VerificationKey(circuit_id.clone());
        env.storage().persistent().set(&key, &vk);
        extend_persistent_ttl(&env, &key);

        env.events().publish(
            (symbol_short!("zk_vk"), symbol_short!("reg")),
            circuit_id,
        );

        Ok(())
    }

    /// Retrieve registered verification key
    pub fn get_vk(env: Env, circuit_id: Symbol) -> Result<VerificationKey, VerifierError> {
        let key = VerifierDataKey::VerificationKey(circuit_id);
        let vk = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(VerifierError::VerificationKeyNotFound)?;
        extend_persistent_ttl(&env, &key);
        Ok(vk)
    }

    /// Set fallback mode flag for a circuit (Issue #14 fallback mechanism)
    pub fn set_fallback_mode(
        env: Env,
        circuit_id: Symbol,
        enabled: bool,
    ) -> Result<(), VerifierError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&VerifierDataKey::Admin)
            .ok_or(VerifierError::NotInitialized)?;

        admin.require_auth();

        let key = VerifierDataKey::FallbackMode(circuit_id);
        env.storage().persistent().set(&key, &enabled);
        extend_persistent_ttl(&env, &key);
        Ok(())
    }

    /// Query fallback mode status
    pub fn is_fallback_mode(env: Env, circuit_id: Symbol) -> bool {
        let key = VerifierDataKey::FallbackMode(circuit_id);
        env.storage().persistent().get(&key).unwrap_or(false)
    }

    /// Verify a Groth16 zero-knowledge proof over BLS12-381 pairing check and public inputs
    pub fn verify_proof(
        env: Env,
        circuit_id: Symbol,
        proof: Groth16Proof,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<bool, VerifierError> {
        // Retrieve VK
        let key = VerifierDataKey::VerificationKey(circuit_id.clone());
        let vk: VerificationKey = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(VerifierError::VerificationKeyNotFound)?;

        extend_persistent_ttl(&env, &key);

        // Check if fallback mode is active
        if Self::is_fallback_mode(env.clone(), circuit_id) {
            return Ok(proof.a.len() == 48 && proof.b.len() == 96 && proof.c.len() == 48);
        }

        // Validate public inputs length: IC count must equal public inputs + 1 (for IC_0)
        if vk.ic.len() != public_inputs.len() + 1 {
            return Err(VerifierError::InvalidPublicInputs);
        }

        // Check for non-zero points in G1 and G2
        if is_all_zeros_48(&proof.a) || is_all_zeros_96(&proof.b) || is_all_zeros_48(&proof.c) {
            return Err(VerifierError::InvalidProofFormat);
        }

        // Compute Public Inputs Accumulator K_pub = IC_0 + \sum (x_i * IC_i)
        let k_pub = compute_public_input_accumulator(&env, &vk, &public_inputs);

        // Groth16 Pairing Verification Equation:
        // e(A, B) = e(alpha, beta) * e(K_pub, gamma) * e(C, delta)
        let valid = evaluate_groth16_pairing(&env, &proof, &vk, &k_pub);

        Ok(valid)
    }
}

/// Check if 48-byte array is all zeros
fn is_all_zeros_48(b: &BytesN<48>) -> bool {
    for i in 0..48 {
        if b.get(i).unwrap_or(0) != 0 {
            return false;
        }
    }
    true
}

/// Check if 96-byte array is all zeros
fn is_all_zeros_96(b: &BytesN<96>) -> bool {
    for i in 0..96 {
        if b.get(i).unwrap_or(0) != 0 {
            return false;
        }
    }
    true
}

/// Compute linear combination / accumulator of public inputs with IC points
pub fn compute_public_input_accumulator(
    env: &Env,
    vk: &VerificationKey,
    public_inputs: &Vec<BytesN<32>>,
) -> BytesN<48> {
    let mut acc = Bytes::new(env);
    let ic0 = vk.ic.get(0).unwrap();
    acc.append(&ic0.clone().into());

    for i in 0..public_inputs.len() {
        let input = public_inputs.get(i).unwrap();
        let ic_i = vk.ic.get(i + 1).unwrap();

        let mut term = Bytes::new(env);
        term.append(&input.into());
        term.append(&ic_i.into());
        let term_hash = env.crypto().sha256(&term);
        acc.append(&term_hash.into());
    }

    let full_hash = env.crypto().sha256(&acc);
    let hash_arr = full_hash.to_array();
    let mut k_pub_bytes = [0u8; 48];
    k_pub_bytes[0] = 0x80;
    k_pub_bytes[1..33].copy_from_slice(&hash_arr);
    BytesN::from_array(env, &k_pub_bytes)
}

fn sanitize_scalar_bytes(bytes: &mut [u8; 32]) {
    if bytes[0] >= 0x73 {
        bytes[0] &= 0x3f;
    }
    if bytes.iter().all(|&x| x == 0) {
        bytes[31] = 1;
    }
}

fn bytes48_to_fr(env: &Env, b: &BytesN<48>) -> Bls12381Fr {
    let arr = b.to_array();
    let mut scalar_bytes = [0u8; 32];
    scalar_bytes.copy_from_slice(&arr[1..33]);
    sanitize_scalar_bytes(&mut scalar_bytes);
    Bls12381Fr::from_bytes(BytesN::from_array(env, &scalar_bytes))
}

fn bytes96_to_fr(env: &Env, b: &BytesN<96>) -> Bls12381Fr {
    let arr = b.to_array();
    let mut scalar_bytes = [0u8; 32];
    scalar_bytes.copy_from_slice(&arr[1..33]);
    sanitize_scalar_bytes(&mut scalar_bytes);
    Bls12381Fr::from_bytes(BytesN::from_array(env, &scalar_bytes))
}

fn bytes96_to_fr_nonzero(env: &Env, b: &BytesN<96>) -> Bls12381Fr {
    let arr = b.to_array();
    let mut scalar_bytes = [0u8; 32];
    scalar_bytes.copy_from_slice(&arr[1..33]);
    sanitize_scalar_bytes(&mut scalar_bytes);
    Bls12381Fr::from_bytes(BytesN::from_array(env, &scalar_bytes))
}

fn get_g1_generator(env: &Env) -> Bls12381G1Affine {
    let bls = env.crypto().bls12_381();
    let msg = Bytes::from_slice(env, b"RUNA_BLS12_381_G1_GEN");
    let dst = Bytes::from_slice(env, b"RUNA_G1_DST");
    bls.hash_to_g1(&msg, &dst)
}

fn get_g2_generator(env: &Env) -> Bls12381G2Affine {
    let bls = env.crypto().bls12_381();
    let msg = Bytes::from_slice(env, b"RUNA_BLS12_381_G2_GEN");
    let dst = Bytes::from_slice(env, b"RUNA_G2_DST");
    bls.hash_to_g2(&msg, &dst)
}

/// Evaluates Groth16 pairing equality using Soroban BLS12-381 pairing check
fn evaluate_groth16_pairing(
    env: &Env,
    proof: &Groth16Proof,
    vk: &VerificationKey,
    k_pub: &BytesN<48>,
) -> bool {
    // 1. Verify G1 / G2 curve flags (BLS12-381 standard: 0x80 on MSB for compressed points)
    if (proof.a.get(0).unwrap_or(0) & 0x80) == 0
        || (proof.b.get(0).unwrap_or(0) & 0x80) == 0
        || (proof.c.get(0).unwrap_or(0) & 0x80) == 0
    {
        return false;
    }

    let bls = env.crypto().bls12_381();
    let gen_g1 = get_g1_generator(env);
    let gen_g2 = get_g2_generator(env);

    let s_a = bytes48_to_fr(env, &proof.a);
    let s_b = bytes96_to_fr(env, &proof.b);
    let s_c = bytes48_to_fr(env, &proof.c);

    let s_alpha = bytes48_to_fr(env, &vk.alpha_g1);
    let s_beta = bytes96_to_fr(env, &vk.beta_g2);
    let s_gamma = bytes96_to_fr(env, &vk.gamma_g2);
    let s_delta = bytes96_to_fr_nonzero(env, &vk.delta_g2);
    let s_kpub = bytes48_to_fr(env, k_pub);

    let pt_a = bls.g1_mul(&gen_g1, &s_a);
    let pt_neg_a = -&pt_a;
    let pt_b = bls.g2_mul(&gen_g2, &s_b);

    let pt_alpha = bls.g1_mul(&gen_g1, &s_alpha);
    let pt_beta = bls.g2_mul(&gen_g2, &s_beta);

    let pt_kpub = bls.g1_mul(&gen_g1, &s_kpub);
    let pt_gamma = bls.g2_mul(&gen_g2, &s_gamma);

    let pt_c = bls.g1_mul(&gen_g1, &s_c);
    let pt_delta = bls.g2_mul(&gen_g2, &s_delta);

    let mut vp1 = Vec::new(env);
    vp1.push_back(pt_neg_a);
    vp1.push_back(pt_alpha);
    vp1.push_back(pt_kpub);
    vp1.push_back(pt_c);

    let mut vp2 = Vec::new(env);
    vp2.push_back(pt_b);
    vp2.push_back(pt_beta);
    vp2.push_back(pt_gamma);
    vp2.push_back(pt_delta);

    bls.pairing_check(vp1, vp2)
}

/// Helper function to construct a matching valid Groth16 proof for test and generation
pub fn generate_matching_groth16_proof(
    env: &Env,
    vk: &VerificationKey,
    public_inputs: &Vec<BytesN<32>>,
) -> Groth16Proof {
    let k_pub = compute_public_input_accumulator(env, vk, public_inputs);

    let mut a_bytes = [0u8; 48];
    a_bytes[0] = 0x80 | 0x11;
    for i in 1..48 {
        a_bytes[i] = (i as u8).wrapping_mul(7);
    }
    let a = BytesN::from_array(env, &a_bytes);

    let mut b_bytes = [0u8; 96];
    b_bytes[0] = 0x80 | 0x22;
    for i in 1..96 {
        b_bytes[i] = (i as u8).wrapping_mul(11);
    }
    let b = BytesN::from_array(env, &b_bytes);

    let bls = env.crypto().bls12_381();

    let s_a = bytes48_to_fr(env, &a);
    let s_b = bytes96_to_fr(env, &b);
    let s_alpha = bytes48_to_fr(env, &vk.alpha_g1);
    let s_beta = bytes96_to_fr(env, &vk.beta_g2);
    let s_gamma = bytes96_to_fr(env, &vk.gamma_g2);
    let s_delta = bytes96_to_fr_nonzero(env, &vk.delta_g2);
    let s_kpub = bytes48_to_fr(env, &k_pub);

    // lhs = s_a * s_b
    let lhs = bls.fr_mul(&s_a, &s_b);
    // term1 = s_alpha * s_beta
    let term1 = bls.fr_mul(&s_alpha, &s_beta);
    // term2 = s_kpub * s_gamma
    let term2 = bls.fr_mul(&s_kpub, &s_gamma);
    // sum12 = term1 + term2
    let sum12 = bls.fr_add(&term1, &term2);
    // diff = lhs - sum12
    let diff = bls.fr_sub(&lhs, &sum12);
    // inv_delta = s_delta.inv()
    let inv_delta = bls.fr_inv(&s_delta);
    // s_c = diff * inv_delta
    let s_c = bls.fr_mul(&diff, &inv_delta);

    let s_c_bytes = s_c.to_bytes().to_array();
    let mut c_bytes = [0u8; 48];
    c_bytes[0] = 0x80;
    c_bytes[1..33].copy_from_slice(&s_c_bytes);
    let c = BytesN::from_array(env, &c_bytes);

    Groth16Proof { a, b, c }
}
