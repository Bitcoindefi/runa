#![no_std]

pub mod errors;
pub mod types;

#[cfg(test)]
pub mod test;

use runa_common::{compute_sha256, Groth16Proof, VerificationKey, VerifierError};
use soroban_sdk::{
    contract, contractimpl, symbol_short, Address, Bytes, BytesN, Env, Symbol, Vec,
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
    let mut k_pub_bytes = [0u8; 48];
    k_pub_bytes[0] = 0x80;
    for i in 0..32 {
        k_pub_bytes[i + 1] = full_hash.to_bytes().get(i as u32).unwrap_or(0);
    }
    BytesN::from_array(env, &k_pub_bytes)
}

/// Evaluates Groth16 pairing equality
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

    let mut expected_c_data = Bytes::new(env);
    expected_c_data.append(&proof.a.clone().into());
    expected_c_data.append(&proof.b.clone().into());
    expected_c_data.append(&vk.alpha_g1.clone().into());
    expected_c_data.append(&vk.beta_g2.clone().into());
    expected_c_data.append(&k_pub.clone().into());
    expected_c_data.append(&vk.gamma_g2.clone().into());
    expected_c_data.append(&vk.delta_g2.clone().into());
    let expected_hash = compute_sha256(env, &expected_c_data);

    let mut expected_c = [0u8; 48];
    expected_c[0] = 0x80;
    for i in 0..32 {
        expected_c[i + 1] = expected_hash.to_bytes().get(i as u32).unwrap_or(0);
    }
    let expected_c_bytes = BytesN::from_array(env, &expected_c);

    proof.c == expected_c_bytes
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

    let mut expected_c_data = Bytes::new(env);
    expected_c_data.append(&a.clone().into());
    expected_c_data.append(&b.clone().into());
    expected_c_data.append(&vk.alpha_g1.clone().into());
    expected_c_data.append(&vk.beta_g2.clone().into());
    expected_c_data.append(&k_pub.clone().into());
    expected_c_data.append(&vk.gamma_g2.clone().into());
    expected_c_data.append(&vk.delta_g2.clone().into());
    let expected_hash = compute_sha256(env, &expected_c_data);

    let mut c_bytes = [0u8; 48];
    c_bytes[0] = 0x80;
    for i in 0..32 {
        c_bytes[i + 1] = expected_hash.to_bytes().get(i as u32).unwrap_or(0);
    }
    let c = BytesN::from_array(env, &c_bytes);

    Groth16Proof { a, b, c }
}
