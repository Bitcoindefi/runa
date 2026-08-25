#![no_std]

use soroban_sdk::{
    contracterror, contracttype, Address, Bytes, BytesN, Env, Symbol, Vec,
};

// ==========================================
// 1. Duel Types & Errors
// ==========================================

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
#[repr(u32)]
pub enum DuelStatus {
    Initiated = 0,
    Accepted = 1,
    Revealed = 2,
    Resolved = 3,
    Canceled = 4,
    ExpiredRefunded = 5,
    Disputed = 6,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
#[repr(u32)]
pub enum ResolutionMode {
    CommitReveal = 0,
    ZeroKnowledge = 1,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct DuelState {
    pub duel_id: u64,
    pub challenger: Address,
    pub opponent: Option<Address>,
    pub wager_token: Address,
    pub wager_amount: i128,
    pub challenger_script_hash: BytesN<32>,
    pub opponent_script_hash: Option<BytesN<32>>,
    pub challenger_script: Option<Bytes>,
    pub opponent_script: Option<Bytes>,
    pub content_hash: BytesN<32>,
    pub engine_version: u32,
    pub seed: u64,
    pub creation_ledger: u32,
    pub expiration_ledger: u32,
    pub reveal_deadline_ledger: u32,
    pub dispute_deadline_ledger: u32,
    pub status: DuelStatus,
    pub winner: Option<Address>,
    pub resolution_mode: ResolutionMode,
    pub nonce: BytesN<32>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum DuelError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    InvalidWagerAmount = 4,
    InvalidExpiration = 5,
    DuelNotFound = 6,
    DuelNotInitiated = 7,
    DuelNotAccepted = 8,
    DuelNotRevealed = 9,
    DuelAlreadyResolved = 10,
    DuelExpired = 11,
    DuelNotExpired = 12,
    SelfChallengeForbidden = 13,
    ScriptHashMismatch = 14,
    RevealWindowClosed = 15,
    RevealWindowOpen = 16,
    InvalidPublicInputs = 17,
    ProofVerificationFailed = 18,
    DisputeWindowClosed = 19,
    DisputeWindowOpen = 20,
    InvalidSimulationProof = 21,
    UnsupportedEngineVersion = 22,
    ContentHashMismatch = 23,
    TransferFailed = 24,
    AlreadyRevealed = 25,
    DuelNotDisputed = 26,
    InvalidFee = 27,
    InvalidWinner = 28,
    InvalidParticipant = 29,
}

// ==========================================
// 2. Zero-Knowledge Verifier Types & Errors
// ==========================================

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Groth16Proof {
    pub a: BytesN<48>,    // G1 point (48 bytes compressed for BLS12-381)
    pub b: BytesN<96>,    // G2 point (96 bytes compressed for BLS12-381)
    pub c: BytesN<48>,    // G1 point (48 bytes compressed for BLS12-381)
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct VerificationKey {
    pub alpha_g1: BytesN<48>,
    pub beta_g2: BytesN<96>,
    pub gamma_g2: BytesN<96>,
    pub delta_g2: BytesN<96>,
    pub ic: Vec<BytesN<48>>, // IC[0..n] public input base points
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct ZkPublicInputs {
    pub initial_state_hash: BytesN<32>,
    pub opponent_script_hash: BytesN<32>,
    pub seed: u64,
    pub outcome_flag: u32,
    pub ticks_elapsed: u32,
    pub content_hash: BytesN<32>,
    pub engine_version: u32,
    pub nonce: BytesN<32>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    VerificationKeyNotFound = 4,
    InvalidProofFormat = 5,
    InvalidPublicInputs = 6,
    VerificationFailed = 7,
    InvalidCircuitId = 8,
    EmptyVerificationKey = 9,
}

// ==========================================
// 3. Item Token Types & Errors
// ==========================================

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct ItemMetadata {
    pub id: Symbol,         // "sword", "crossbow", "shield", "boots"
    pub hand: Symbol,       // "left", "right"
    pub kind: Symbol,       // "weapon", "armor"
    pub base_price: i128,   // Base gold price in shop
    pub min_level: u32,     // Level requirement (Issue #2 gate)
    pub sac_token: Address, // Stellar Asset Contract binding
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct InventorySummary {
    pub sword_count: u32,
    pub crossbow_count: u32,
    pub shield_count: u32,
    pub boots_count: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ItemError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ItemAlreadyRegistered = 4,
    ItemNotFound = 5,
    InsufficientGold = 6,
    LevelRequirementNotMet = 7,
    InsufficientBalance = 8,
    InvalidAmount = 9,
    TransferFailed = 10,
    TrustlineMissing = 11,
    InvalidRecipient = 12,
}

// ==========================================
// 4. Cryptographic & Utility Helpers
// ==========================================

/// Compute SHA-256 hash using Soroban crypto host function
pub fn compute_sha256(env: &Env, data: &Bytes) -> BytesN<32> {
    env.crypto().sha256(data).into()
}

/// Derive deterministic seed for duel from ledger sequence and duel metadata
pub fn derive_seed(env: &Env, duel_id: u64, ledger_sequence: u32, _challenger: &Address) -> u64 {
    let mut payload = Bytes::new(env);
    payload.append(&Bytes::from_array(env, &duel_id.to_be_bytes()));
    payload.append(&Bytes::from_array(env, &ledger_sequence.to_be_bytes()));
    
    // Hash combined payload
    let hash = env.crypto().sha256(&payload);
    let hash_bytes = hash.to_bytes();
    
    // Extract 8 bytes for u64 seed (PRNG input)
    let b0 = hash_bytes.get(0).unwrap_or(0) as u64;
    let b1 = hash_bytes.get(1).unwrap_or(0) as u64;
    let b2 = hash_bytes.get(2).unwrap_or(0) as u64;
    let b3 = hash_bytes.get(3).unwrap_or(0) as u64;
    let b4 = hash_bytes.get(4).unwrap_or(0) as u64;
    let b5 = hash_bytes.get(5).unwrap_or(0) as u64;
    let b6 = hash_bytes.get(6).unwrap_or(0) as u64;
    let b7 = hash_bytes.get(7).unwrap_or(0) as u64;

    (b0 << 56) | (b1 << 48) | (b2 << 40) | (b3 << 32) | (b4 << 24) | (b5 << 16) | (b6 << 8) | b7
}

/// Compute unique nonce binding duel parameters
pub fn compute_nonce(env: &Env, duel_id: u64, _challenger: &Address, timestamp: u64) -> BytesN<32> {
    let mut payload = Bytes::new(env);
    payload.append(&Bytes::from_array(env, &duel_id.to_be_bytes()));
    payload.append(&Bytes::from_array(env, &timestamp.to_be_bytes()));
    env.crypto().sha256(&payload).into()
}

/// Pack ZkPublicInputs into a single 32-byte digest for Groth16 verification
pub fn compute_public_inputs_hash(env: &Env, inputs: &ZkPublicInputs) -> BytesN<32> {
    let mut payload = Bytes::new(env);
    payload.append(&inputs.initial_state_hash.clone().into());
    payload.append(&inputs.opponent_script_hash.clone().into());
    payload.append(&Bytes::from_array(env, &inputs.seed.to_be_bytes()));
    payload.append(&Bytes::from_array(env, &inputs.outcome_flag.to_be_bytes()));
    payload.append(&Bytes::from_array(env, &inputs.ticks_elapsed.to_be_bytes()));
    payload.append(&inputs.content_hash.clone().into());
    payload.append(&Bytes::from_array(env, &inputs.engine_version.to_be_bytes()));
    payload.append(&inputs.nonce.clone().into());
    env.crypto().sha256(&payload).into()
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_sha256_computation() {
        let env = Env::default();
        let data = Bytes::from_slice(&env, b"hello world");
        let hash = compute_sha256(&env, &data);
        assert_eq!(hash.len(), 32);

        // SHA-256("hello world") starts with 0xb94d27b9
        assert_eq!(hash.get(0).unwrap(), 0xb9);
        assert_eq!(hash.get(1).unwrap(), 0x4d);
    }

    #[test]
    fn test_seed_derivation() {
        let env = Env::default();
        let challenger = Address::generate(&env);
        let seed1 = derive_seed(&env, 1, 100, &challenger);
        let seed2 = derive_seed(&env, 1, 100, &challenger);
        let seed3 = derive_seed(&env, 2, 100, &challenger);
        assert_eq!(seed1, seed2);
        assert_ne!(seed1, seed3);
    }

    #[test]
    fn test_public_inputs_hash() {
        let env = Env::default();
        let inputs = ZkPublicInputs {
            initial_state_hash: BytesN::from_array(&env, &[1u8; 32]),
            opponent_script_hash: BytesN::from_array(&env, &[2u8; 32]),
            seed: 12345678,
            outcome_flag: 1,
            ticks_elapsed: 50,
            content_hash: BytesN::from_array(&env, &[3u8; 32]),
            engine_version: 1,
            nonce: BytesN::from_array(&env, &[4u8; 32]),
        };
        let hash1 = compute_public_inputs_hash(&env, &inputs);
        let hash2 = compute_public_inputs_hash(&env, &inputs);
        assert_eq!(hash1, hash2);
    }
}
