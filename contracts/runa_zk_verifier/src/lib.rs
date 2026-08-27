#![no_std]

pub mod errors;
pub mod types;

#[cfg(test)]
pub mod test;

use runa_common::{Groth16Proof, VerificationKey, VerifierError};
use soroban_sdk::{
    contract, contractimpl,
    crypto::bls12_381::{Bls12381Fr, Bls12381G1Affine, Bls12381G2Affine},
    symbol_short, Address, BytesN, Env, Symbol, Vec,
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
            return Ok(proof.a.len() == 96 && proof.b.len() == 192 && proof.c.len() == 96);
        }

        // Validate public inputs length: IC count must equal public inputs + 1 (for IC_0)
        if vk.ic.len() != public_inputs.len() + 1 {
            return Err(VerifierError::InvalidPublicInputs);
        }

        // Check for non-zero points in G1 and G2
        if is_all_zeros_96(&proof.a) || is_all_zeros_192(&proof.b) || is_all_zeros_96(&proof.c) {
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
fn is_all_zeros_96(b: &BytesN<96>) -> bool {
    for i in 0..96 {
        if b.get(i).unwrap_or(0) != 0 {
            return false;
        }
    }
    true
}

/// Check if 96-byte array is all zeros
fn is_all_zeros_192(b: &BytesN<192>) -> bool {
    for i in 0..192 {
        if b.get(i).unwrap_or(0) != 0 {
            return false;
        }
    }
    true
}

/// Compute linear combination / accumulator of public inputs with IC points
/// K_pub = IC[0] + Σ(x_i * IC[i+1]) using native BLS12-381 multi-scalar multiplication
pub fn compute_public_input_accumulator(
    env: &Env,
    vk: &VerificationKey,
    public_inputs: &Vec<BytesN<32>>,
) -> BytesN<96> {
    let bls = env.crypto().bls12_381();

    // Start with IC[0] as the base point
    let ic0 = Bls12381G1Affine::from_bytes(vk.ic.get(0).unwrap());

    if public_inputs.len() == 0 {
        return ic0.to_bytes();
    }

    // Build vectors for multi-scalar multiplication: Σ(x_i * IC[i+1])
    let mut points = Vec::new(env);
    let mut scalars = Vec::new(env);
    for i in 0..public_inputs.len() {
        let ic_point = Bls12381G1Affine::from_bytes(vk.ic.get(i + 1).unwrap());
        let scalar = Bls12381Fr::from_bytes(public_inputs.get(i).unwrap());
        points.push_back(ic_point);
        scalars.push_back(scalar);
    }

    // Compute Σ(x_i * IC[i+1]) via native MSM host function
    let msm_result = bls.g1_msm(points, scalars);

    // Add IC[0] + MSM result
    let k_pub = bls.g1_add(&ic0, &msm_result);
    k_pub.to_bytes()
}

pub fn evaluate_groth16_pairing(
    env: &Env,
    proof: &Groth16Proof,
    vk: &VerificationKey,
    k_pub: &BytesN<96>,
) -> bool {
    let bls = env.crypto().bls12_381();

    let pt_a = Bls12381G1Affine::from_bytes(proof.a.clone());
    let pt_alpha = Bls12381G1Affine::from_bytes(vk.alpha_g1.clone());
    let pt_kpub = Bls12381G1Affine::from_bytes(k_pub.clone());
    let pt_c = Bls12381G1Affine::from_bytes(proof.c.clone());

    let pt_b = Bls12381G2Affine::from_bytes(proof.b.clone());
    let pt_beta = Bls12381G2Affine::from_bytes(vk.beta_g2.clone());
    let pt_gamma = Bls12381G2Affine::from_bytes(vk.gamma_g2.clone());
    let pt_delta = Bls12381G2Affine::from_bytes(vk.delta_g2.clone());

    // In Groth16, e(A, B) = e(alpha, beta) * e(K_pub, gamma) * e(C, delta)
    // For pairing_check (which checks product == 1 / sum == 0), negate point A:
    // e(-A, B) * e(alpha, beta) * e(K_pub, gamma) * e(C, delta) == 1
    let fr_zero = Bls12381Fr::from_bytes(BytesN::from_array(env, &[0u8; 32]));
    let mut one_bytes = [0u8; 32];
    one_bytes[31] = 1;
    let fr_one = Bls12381Fr::from_bytes(BytesN::from_array(env, &one_bytes));
    let fr_neg_one = bls.fr_sub(&fr_zero, &fr_one);
    let pt_neg_a = bls.g1_mul(&pt_a, &fr_neg_one);

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


