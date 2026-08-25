use runa_common::{
    compute_sha256, DuelStatus, Groth16Proof,
};
use runa_duel::{RunaDuelContract, RunaDuelContractClient};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    vec, Address, Bytes, BytesN, Env, Symbol, Vec, token,
};

#[contract]
pub struct RealZkVerifierContract;

#[contractimpl]
impl RealZkVerifierContract {
    pub fn verify_proof(
        env: Env,
        _circuit_id: Symbol,
        proof: Groth16Proof,
        public_inputs: Vec<BytesN<32>>,
    ) -> bool {
        // Curve flags check
        if (proof.a.get(0).unwrap_or(0) & 0x80) == 0
            || (proof.b.get(0).unwrap_or(0) & 0x80) == 0
            || (proof.c.get(0).unwrap_or(0) & 0x80) == 0
        {
            return false;
        }

        let mut expected_c_data = Bytes::new(&env);
        expected_c_data.append(&proof.a.clone().into());
        expected_c_data.append(&proof.b.clone().into());
        for i in 0..public_inputs.len() {
            let input = public_inputs.get(i).unwrap();
            expected_c_data.append(&input.into());
        }
        let expected_hash = compute_sha256(&env, &expected_c_data);

        let mut expected_c = [0u8; 96];
        expected_c[0] = 0x80;
        for i in 0..32 {
            expected_c[i + 1] = expected_hash.to_bytes().get(i as u32).unwrap_or(0);
        }
        let expected_c_bytes = BytesN::from_array(&env, &expected_c);

        proof.c == expected_c_bytes
    }
}

pub fn generate_matching_proof(
    env: &Env,
    public_inputs: &Vec<BytesN<32>>,
) -> Groth16Proof {
    let mut a_bytes = [0u8; 96];
    a_bytes[0] = 0x80 | 0x11;
    for i in 1..96 {
        a_bytes[i] = (i as u8).wrapping_mul(7);
    }
    let a = BytesN::from_array(env, &a_bytes);

    let mut b_bytes = [0u8; 192];
    b_bytes[0] = 0x80 | 0x22;
    for i in 1..96 {
        b_bytes[i] = (i as u8).wrapping_mul(11);
    }
    let b = BytesN::from_array(env, &b_bytes);

    let mut expected_c_data = Bytes::new(env);
    expected_c_data.append(&a.clone().into());
    expected_c_data.append(&b.clone().into());
    for i in 0..public_inputs.len() {
        let input = public_inputs.get(i).unwrap();
        expected_c_data.append(&input.into());
    }
    let expected_hash = compute_sha256(env, &expected_c_data);

    let mut c_bytes = [0u8; 96];
    c_bytes[0] = 0x80;
    for i in 0..32 {
        c_bytes[i + 1] = expected_hash.to_bytes().get(i as u32).unwrap_or(0);
    }
    let c = BytesN::from_array(env, &c_bytes);

    Groth16Proof { a, b, c }
}

struct DuelTestRig {
    env: Env,
    _admin: Address,
    challenger: Address,
    opponent: Address,
    fee_recipient: Address,
    wager_token: Address,
    token_client: token::Client<'static>,
    duel_contract_id: Address,
    duel_client: RunaDuelContractClient<'static>,
    _verifier_id: Address,
}

fn setup_duel_rig(fee_bps: u32) -> DuelTestRig {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let challenger = Address::generate(&env);
    let opponent = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let item_contract = Address::generate(&env);

    // Deploy Real ZK Verifier Contract
    let verifier_id = env.register(RealZkVerifierContract, ());

    // Deploy Wager Token
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_contract.address());
    let token_client = token::Client::new(&env, &token_contract.address());

    // Mint funds
    token_admin_client.mint(&challenger, &10_000_000);
    token_admin_client.mint(&opponent, &10_000_000);

    // Deploy Duel Contract
    let duel_contract_id = env.register(RunaDuelContract, ());
    let duel_client = RunaDuelContractClient::new(&env, &duel_contract_id);
    duel_client.initialize(
        &admin,
        &verifier_id,
        &item_contract,
        &fee_recipient,
        &fee_bps,
    );

    DuelTestRig {
        env,
        _admin: admin,
        challenger,
        opponent,
        fee_recipient,
        wager_token: token_contract.address(),
        token_client,
        duel_contract_id,
        duel_client,
        _verifier_id: verifier_id,
    }
}

// =========================================================================
// CHALLENGE 1: Proof Malleability & ZK Replay Attacks
// =========================================================================

#[test]
fn test_challenge1_zk_proof_malleability_rejected_by_real_verifier() {
    let rig = setup_duel_rig(0);
    let script1_hash = BytesN::from_array(&rig.env, &[0x11; 32]);
    let script2_hash = BytesN::from_array(&rig.env, &[0x22; 32]);
    let content_hash = BytesN::from_array(&rig.env, &[0x33; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    rig.duel_client
        .accept_duel(&rig.opponent, &duel_id, &script2_hash);

    let public_inputs = vec![&rig.env, script2_hash.clone(), content_hash.clone()];
    let valid_proof = generate_matching_proof(&rig.env, &public_inputs);

    // 1. Pack valid proof into bytes (384 bytes = 96 + 192 + 96)
    let mut valid_proof_bytes = [0u8; 384];
    for i in 0..96 {
        valid_proof_bytes[i] = valid_proof.a.get(i as u32).unwrap_or(0);
    }
    for i in 0..192 {
        valid_proof_bytes[96 + i] = valid_proof.b.get(i as u32).unwrap_or(0);
    }
    for i in 0..96 {
        valid_proof_bytes[288 + i] = valid_proof.c.get(i as u32).unwrap_or(0);
    }

    // 2. Malleated Proof: Corrupt proof byte in C
    let mut corrupted_proof_bytes = valid_proof_bytes;
    corrupted_proof_bytes[300] ^= 0xFF;
    let corrupted_proof_data = Bytes::from_slice(&rig.env, &corrupted_proof_bytes);

    let res = rig.duel_client.try_resolve_duel_zk(
        &rig.challenger,
        &duel_id,
        &rig.challenger,
        &corrupted_proof_data,
        &public_inputs,
    );
    assert!(
        res.is_err(),
        "Corrupted ZK proof must be rejected with ProofVerificationFailed"
    );

    // 3. Malleated Public Inputs: Modified nonce/seed input
    let tampered_inputs = vec![
        &rig.env,
        BytesN::from_array(&rig.env, &[0x99; 32]), // modified input
        content_hash.clone(),
    ];
    let valid_proof_data = Bytes::from_slice(&rig.env, &valid_proof_bytes);
    let res_tampered_inputs = rig.duel_client.try_resolve_duel_zk(
        &rig.challenger,
        &duel_id,
        &rig.challenger,
        &valid_proof_data,
        &tampered_inputs,
    );
    assert!(
        res_tampered_inputs.is_err(),
        "Tampered public inputs must cause verification failure"
    );

    // 4. Genuine proof + inputs succeeds
    rig.duel_client.resolve_duel_zk(
        &rig.challenger,
        &duel_id,
        &rig.challenger,
        &valid_proof_data,
        &public_inputs,
    );

    let duel = rig.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Resolved);
    assert_eq!(duel.winner, Some(rig.challenger.clone()));
}

#[test]
fn test_challenge1_zk_invalid_winner_rejected() {
    let rig = setup_duel_rig(0);
    let script1_hash = BytesN::from_array(&rig.env, &[0x11; 32]);
    let script2_hash = BytesN::from_array(&rig.env, &[0x22; 32]);
    let content_hash = BytesN::from_array(&rig.env, &[0x33; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    rig.duel_client
        .accept_duel(&rig.opponent, &duel_id, &script2_hash);

    let third_party = Address::generate(&rig.env);
    let dummy_proof_data = Bytes::from_slice(&rig.env, &[0u8; 192]);
    let public_inputs = vec![&rig.env, script2_hash, content_hash];

    // Attempting to resolve with an outsider as winner must fail
    let res = rig.duel_client.try_resolve_duel_zk(
        &rig.challenger,
        &duel_id,
        &third_party,
        &dummy_proof_data,
        &public_inputs,
    );
    assert!(res.is_err(), "Non-participant winner must be rejected");
}

#[test]
fn test_challenge1_zk_initiated_status_drain_rejected() {
    let rig = setup_duel_rig(0);
    let script1_hash = BytesN::from_array(&rig.env, &[0x11; 32]);
    let content_hash = BytesN::from_array(&rig.env, &[0x33; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    // Duel is still in Initiated status (no opponent has accepted yet)
    let public_inputs = vec![&rig.env, script1_hash.clone(), content_hash.clone()];
    let valid_proof = generate_matching_proof(&rig.env, &public_inputs);
    let mut valid_proof_bytes = [0u8; 384];
    for i in 0..96 {
        valid_proof_bytes[i] = valid_proof.a.get(i as u32).unwrap_or(0);
    }
    for i in 0..192 {
        valid_proof_bytes[96 + i] = valid_proof.b.get(i as u32).unwrap_or(0);
    }
    for i in 0..96 {
        valid_proof_bytes[288 + i] = valid_proof.c.get(i as u32).unwrap_or(0);
    }
    let proof_data = Bytes::from_slice(&rig.env, &valid_proof_bytes);

    // Attempting to resolve ZK on unaccepted (Initiated) duel must fail
    let res = rig.duel_client.try_resolve_duel_zk(
        &rig.challenger,
        &duel_id,
        &rig.challenger,
        &proof_data,
        &public_inputs,
    );
    assert!(res.is_err(), "resolve_duel_zk on Initiated duel must fail with DuelNotAccepted");

    // Wager escrow must remain intact in contract
    assert_eq!(rig.token_client.balance(&rig.duel_contract_id), 500);
}

#[test]
fn test_challenge1_zk_unauthorized_caller_rejected() {
    let rig = setup_duel_rig(0);
    let script1_hash = BytesN::from_array(&rig.env, &[0x11; 32]);
    let script2_hash = BytesN::from_array(&rig.env, &[0x22; 32]);
    let content_hash = BytesN::from_array(&rig.env, &[0x33; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    rig.duel_client
        .accept_duel(&rig.opponent, &duel_id, &script2_hash);

    let third_party = Address::generate(&rig.env);
    let public_inputs = vec![&rig.env, script2_hash.clone(), content_hash.clone()];
    let valid_proof = generate_matching_proof(&rig.env, &public_inputs);
    let mut valid_proof_bytes = [0u8; 384];
    for i in 0..96 {
        valid_proof_bytes[i] = valid_proof.a.get(i as u32).unwrap_or(0);
    }
    for i in 0..192 {
        valid_proof_bytes[96 + i] = valid_proof.b.get(i as u32).unwrap_or(0);
    }
    for i in 0..96 {
        valid_proof_bytes[288 + i] = valid_proof.c.get(i as u32).unwrap_or(0);
    }
    let proof_data = Bytes::from_slice(&rig.env, &valid_proof_bytes);

    // Outsider calls resolve_duel_zk -> must fail
    let res = rig.duel_client.try_resolve_duel_zk(
        &third_party,
        &duel_id,
        &rig.challenger,
        &proof_data,
        &public_inputs,
    );
    assert!(res.is_err(), "Outsider calling resolve_duel_zk must be rejected");
}

// =========================================================================
// CHALLENGE 2: Script Hash Collisions and Whitespace Manipulation
// =========================================================================

#[test]
fn test_challenge2_whitespace_and_format_tampering_exhaustion() {
    let rig = setup_duel_rig(0);

    let canonical_script = b"?hp < 10\n use potion";
    let script1 = Bytes::from_slice(&rig.env, canonical_script);
    let script1_hash = compute_sha256(&rig.env, &script1);

    let opp_script = Bytes::from_slice(&rig.env, b"defend");
    let script2_hash = compute_sha256(&rig.env, &opp_script);
    let content_hash = BytesN::from_array(&rig.env, &[0x07; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &100,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &30,
    );

    rig.duel_client
        .accept_duel(&rig.opponent, &duel_id, &script2_hash);

    // Adversarial whitespace / encoding mutations:
    let mutations: &[&[u8]] = &[
        b"?hp < 10\r\n use potion",      // CRLF
        b"?hp < 10\n  use potion",      // extra inner space
        b"?hp < 10\n use potion ",      // trailing space
        b" ?hp < 10\n use potion",      // leading space
        b"?hp < 10\n\n use potion",     // extra newline
        b"?hp<10\nuse potion",          // collapsed spaces
        b"?hp < 10\t\n use potion",     // tab character
        b"?hp < 10\n use potion\0",     // null byte injection
        b"",                            // empty script
        b"?HP < 10\n USE POTION",       // case change
    ];

    for (idx, mutated) in mutations.iter().enumerate() {
        let bad_bytes = Bytes::from_slice(&rig.env, mutated);
        let res = rig
            .duel_client
            .try_reveal_script(&rig.challenger, &duel_id, &bad_bytes);
        assert!(
            res.is_err(),
            "Mutation #{} ({:?}) must be rejected due to ScriptHashMismatch",
            idx,
            mutated
        );
    }

    // Reveal exact script -> must succeed
    rig.duel_client
        .reveal_script(&rig.challenger, &duel_id, &script1);

    // Attempt double reveal -> must fail
    let double_res = rig
        .duel_client
        .try_reveal_script(&rig.challenger, &duel_id, &script1);
    assert!(double_res.is_err(), "Double reveal must be rejected");

    // Opponent reveals
    rig.duel_client
        .reveal_script(&rig.opponent, &duel_id, &opp_script);

    let duel = rig.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Revealed);
}

#[test]
fn test_challenge2_unauthorized_parties_cannot_reveal() {
    let rig = setup_duel_rig(0);
    let script1_hash = BytesN::from_array(&rig.env, &[0x11; 32]);
    let content_hash = BytesN::from_array(&rig.env, &[0x22; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &100,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &30,
    );

    let script = Bytes::from_slice(&rig.env, b"some script");

    // Challenger tries to reveal before duel is accepted
    let early_res = rig
        .duel_client
        .try_reveal_script(&rig.challenger, &duel_id, &script);
    assert!(early_res.is_err(), "Reveal before acceptance must fail");

    // Outsider tries to reveal
    let outsider = Address::generate(&rig.env);
    let outsider_res = rig
        .duel_client
        .try_reveal_script(&outsider, &duel_id, &script);
    assert!(outsider_res.is_err(), "Outsider reveal must fail");
}

// =========================================================================
// CHALLENGE 3: Wager Escrow Drain Attempts and Double-Settlement Races
// =========================================================================

#[test]
fn test_challenge3_wager_escrow_double_settlement_drain_prevention() {
    let rig = setup_duel_rig(500); // 5% fee
    let script1 = Bytes::from_slice(&rig.env, b"p1");
    let script1_hash = compute_sha256(&rig.env, &script1);
    let script2 = Bytes::from_slice(&rig.env, b"p2");
    let script2_hash = compute_sha256(&rig.env, &script2);
    let content_hash = BytesN::from_array(&rig.env, &[0x01; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &1000,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &30,
    );

    rig.duel_client
        .accept_duel(&rig.opponent, &duel_id, &script2_hash);
    rig.duel_client
        .reveal_script(&rig.challenger, &duel_id, &script1);
    rig.duel_client
        .reveal_script(&rig.opponent, &duel_id, &script2);

    assert_eq!(
        rig.token_client.balance(&rig.duel_contract_id),
        2000,
        "Contract escrow must hold exactly 2000"
    );

    // Settle immediately optimistically
    rig.duel_client
        .resolve_duel_optimistic(&rig.challenger, &duel_id, &rig.challenger, &0);

    // Escrow must now be 0
    assert_eq!(
        rig.token_client.balance(&rig.duel_contract_id),
        0,
        "Contract escrow must be completely drained to 0 after legitimate settlement"
    );

    // ATTACK ATTEMPTS POST-SETTLEMENT:
    // 1. Re-run optimistic resolution
    let res1 = rig.duel_client.try_resolve_duel_optimistic(
        &rig.opponent,
        &duel_id,
        &rig.opponent,
        &0,
    );
    assert!(res1.is_err(), "Re-resolving optimistic must fail");

    // 2. Re-run cancellation/refund
    let res2 = rig
        .duel_client
        .try_cancel_or_refund(&rig.challenger, &duel_id);
    assert!(res2.is_err(), "Refunding resolved duel must fail");

    // 3. Finalize settlement on already resolved duel
    let res3 = rig.duel_client.try_finalize_settlement(&duel_id);
    assert!(res3.is_err(), "Finalizing resolved duel must fail");

    // 4. File dispute on resolved duel
    let res4 = rig.duel_client.try_dispute_duel(
        &rig.opponent,
        &duel_id,
        &Bytes::from_slice(&rig.env, b"fraud proof"),
    );
    assert!(res4.is_err(), "Disputing resolved duel must fail");

    // Escrow balance remains 0
    assert_eq!(rig.token_client.balance(&rig.duel_contract_id), 0);
}

#[test]
fn test_challenge3_optimistic_unauthorized_caller_rejected() {
    let rig = setup_duel_rig(0);
    let script1 = Bytes::from_slice(&rig.env, b"p1");
    let script1_hash = compute_sha256(&rig.env, &script1);
    let script2 = Bytes::from_slice(&rig.env, b"p2");
    let script2_hash = compute_sha256(&rig.env, &script2);
    let content_hash = BytesN::from_array(&rig.env, &[0x01; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &1000,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &30,
    );

    rig.duel_client
        .accept_duel(&rig.opponent, &duel_id, &script2_hash);
    rig.duel_client
        .reveal_script(&rig.challenger, &duel_id, &script1);
    rig.duel_client
        .reveal_script(&rig.opponent, &duel_id, &script2);

    let outsider = Address::generate(&rig.env);
    let res = rig.duel_client.try_resolve_duel_optimistic(
        &outsider,
        &duel_id,
        &rig.challenger,
        &0,
    );
    assert!(res.is_err(), "Outsider calling resolve_duel_optimistic must fail with InvalidParticipant");
}

#[test]
fn test_challenge3_multiple_cancellation_drain_prevention() {
    let rig = setup_duel_rig(0);
    let script_hash = BytesN::from_array(&rig.env, &[0x01; 32]);
    let content_hash = BytesN::from_array(&rig.env, &[0x02; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &500,
        &script_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    assert_eq!(rig.token_client.balance(&rig.duel_contract_id), 500);

    // Cancel unaccepted duel
    rig.duel_client
        .cancel_or_refund(&rig.challenger, &duel_id);
    assert_eq!(rig.token_client.balance(&rig.duel_contract_id), 0);

    // Attempt second cancel
    let res = rig
        .duel_client
        .try_cancel_or_refund(&rig.challenger, &duel_id);
    assert!(res.is_err(), "Second cancellation must fail");

    // Attempt opponent cancel
    let opp_res = rig
        .duel_client
        .try_cancel_or_refund(&rig.opponent, &duel_id);
    assert!(opp_res.is_err(), "Opponent cancellation must fail");

    assert_eq!(rig.token_client.balance(&rig.duel_contract_id), 0);
}

#[test]
fn test_challenge3_wager_amount_and_fee_boundaries() {
    let rig = setup_duel_rig(5000); // 50% max fee
    let script_hash = BytesN::from_array(&rig.env, &[0x01; 32]);
    let content_hash = BytesN::from_array(&rig.env, &[0x02; 32]);

    // Zero wager rejected
    let res0 = rig.duel_client.try_create_duel(
        &rig.challenger,
        &rig.wager_token,
        &0,
        &script_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );
    assert!(res0.is_err());

    // Negative wager rejected
    let res_neg = rig.duel_client.try_create_duel(
        &rig.challenger,
        &rig.wager_token,
        &-100,
        &script_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );
    assert!(res_neg.is_err());

    // 0 duration rejected
    let res_dur = rig.duel_client.try_create_duel(
        &rig.challenger,
        &rig.wager_token,
        &100,
        &script_hash,
        &content_hash,
        &1,
        &0,
        &20,
    );
    assert!(res_dur.is_err());
}

// =========================================================================
// CHALLENGE 5: Storage TTL Edge Cases and Expired Duel Settlement
// =========================================================================

#[test]
fn test_challenge5_unaccepted_duel_expiration_boundaries() {
    let rig = setup_duel_rig(0);
    let script_hash = BytesN::from_array(&rig.env, &[0x01; 32]);
    let content_hash = BytesN::from_array(&rig.env, &[0x02; 32]);

    // Current ledger sequence starts at 0 (or default)
    let start_seq = rig.env.ledger().sequence();

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &300,
        &script_hash,
        &content_hash,
        &1,
        &50, // duration 50 -> expires at start_seq + 50
        &20,
    );

    // Fast forward to start_seq + 49: Opponent should still be able to accept
    rig.env.ledger().set_sequence_number(start_seq + 49);
    // Non-challenger trying to cancel before expiration should fail
    let early_cancel = rig
        .duel_client
        .try_cancel_or_refund(&rig.opponent, &duel_id);
    assert!(early_cancel.is_err(), "Non-challenger cancel before expiry must fail");

    // Fast forward to expiration ledger
    rig.env.ledger().set_sequence_number(start_seq + 50);

    // Acceptance now fails
    let late_accept = rig
        .duel_client
        .try_accept_duel(&rig.opponent, &duel_id, &script_hash);
    assert!(late_accept.is_err(), "Late acceptance must fail with DuelExpired");

    // Anyone can now cancel/refund for challenger
    rig.duel_client
        .cancel_or_refund(&rig.opponent, &duel_id);
    let duel = rig.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Canceled);
    assert_eq!(
        rig.token_client.balance(&rig.challenger),
        10_000_000
    );
}

#[test]
fn test_challenge5_reveal_window_boundaries_and_forfeiture() {
    let rig = setup_duel_rig(0);
    let script1 = Bytes::from_slice(&rig.env, b"chal script");
    let script1_hash = compute_sha256(&rig.env, &script1);
    let script2 = Bytes::from_slice(&rig.env, b"opp script");
    let script2_hash = compute_sha256(&rig.env, &script2);
    let content_hash = BytesN::from_array(&rig.env, &[0x01; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &400,
        &script1_hash,
        &content_hash,
        &1,
        &100,
        &20, // reveal window = 20 ledgers
    );

    rig.env.ledger().set_sequence_number(10);
    rig.duel_client
        .accept_duel(&rig.opponent, &duel_id, &script2_hash);

    // Reveal deadline is 10 + 20 = 30
    // Challenger reveals at ledger 15
    rig.env.ledger().set_sequence_number(15);
    rig.duel_client
        .reveal_script(&rig.challenger, &duel_id, &script1);

    // At ledger 30: window is still open, timeout claim must fail
    rig.env.ledger().set_sequence_number(30);
    let early_claim = rig
        .duel_client
        .try_cancel_or_refund(&rig.challenger, &duel_id);
    assert!(early_claim.is_err(), "Cannot forfeit while reveal window is open");

    // At ledger 31: window is closed, opponent forfeited -> challenger wins default
    rig.env.ledger().set_sequence_number(31);
    rig.duel_client
        .cancel_or_refund(&rig.challenger, &duel_id);

    let duel = rig.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Resolved);
    assert_eq!(duel.winner, Some(rig.challenger.clone()));
    assert_eq!(
        rig.token_client.balance(&rig.challenger),
        10_000_400
    );
}

#[test]
fn test_challenge5_dispute_window_boundaries() {
    let rig = setup_duel_rig(0);
    let script1 = Bytes::from_slice(&rig.env, b"chal");
    let script1_hash = compute_sha256(&rig.env, &script1);
    let script2 = Bytes::from_slice(&rig.env, b"opp");
    let script2_hash = compute_sha256(&rig.env, &script2);
    let content_hash = BytesN::from_array(&rig.env, &[0x01; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &100,
        &20,
    );

    rig.duel_client
        .accept_duel(&rig.opponent, &duel_id, &script2_hash);
    rig.duel_client
        .reveal_script(&rig.challenger, &duel_id, &script1);
    rig.duel_client
        .reveal_script(&rig.opponent, &duel_id, &script2);

    rig.env.ledger().set_sequence_number(20);
    // Optimistic resolution with 15 ledger dispute window -> deadline = 35
    rig.duel_client
        .resolve_duel_optimistic(&rig.challenger, &duel_id, &rig.challenger, &15);

    // At ledger 35: dispute window still open
    rig.env.ledger().set_sequence_number(35);
    let early_finalize = rig.duel_client.try_finalize_settlement(&duel_id);
    assert!(early_finalize.is_err(), "Finalize before window closes must fail");

    // At ledger 36: dispute window closed
    rig.env.ledger().set_sequence_number(36);

    // Late dispute fails
    let late_dispute = rig.duel_client.try_dispute_duel(
        &rig.opponent,
        &duel_id,
        &Bytes::from_slice(&rig.env, b"fraud proof"),
    );
    assert!(late_dispute.is_err(), "Late dispute must fail with DisputeWindowClosed");

    // Finalize succeeds
    rig.duel_client.finalize_settlement(&duel_id);
    let duel = rig.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Resolved);
    assert_eq!(duel.winner, Some(rig.challenger.clone()));
}

#[test]
fn test_challenge5_concurrent_multi_duel_lifecycle_isolation() {
    let rig = setup_duel_rig(250); // 2.5% fee
    let charlie = Address::generate(&rig.env);
    let _token_admin = Address::generate(&rig.env);
    let token_contract = env_token_client(&rig.env, &rig.wager_token);
    token_contract.mint(&charlie, &10_000_000);

    let script1 = Bytes::from_slice(&rig.env, b"s1");
    let script2 = Bytes::from_slice(&rig.env, b"s2");
    let h1 = compute_sha256(&rig.env, &script1);
    let h2 = compute_sha256(&rig.env, &script2);
    let ch = BytesN::from_array(&rig.env, &[0xAA; 32]);

    // Create 5 duels
    let d1 = rig.duel_client.create_duel(&rig.challenger, &rig.wager_token, &1000, &h1, &ch, &1, &100, &20);
    let d2 = rig.duel_client.create_duel(&rig.challenger, &rig.wager_token, &2000, &h1, &ch, &1, &100, &20);
    let d3 = rig.duel_client.create_duel(&rig.challenger, &rig.wager_token, &3000, &h1, &ch, &1, &100, &20);
    let d4 = rig.duel_client.create_duel(&rig.challenger, &rig.wager_token, &4000, &h1, &ch, &1, &100, &20);
    let d5 = rig.duel_client.create_duel(&rig.challenger, &rig.wager_token, &5000, &h1, &ch, &1, &100, &20);

    // Total escrow initially = 1000 + 2000 + 3000 + 4000 + 5000 = 15000
    assert_eq!(rig.token_client.balance(&rig.duel_contract_id), 15000);

    // D1: Accept, Reveal both, Settle immediate optimistic
    rig.duel_client.accept_duel(&rig.opponent, &d1, &h2);
    rig.duel_client.reveal_script(&rig.challenger, &d1, &script1);
    rig.duel_client.reveal_script(&rig.opponent, &d1, &script2);
    rig.duel_client.resolve_duel_optimistic(&rig.challenger, &d1, &rig.challenger, &0);
    assert_eq!(rig.duel_client.get_duel(&d1).status, DuelStatus::Resolved);

    // D2: Accept, Reveal both, Optimistic dispute window, Opponent disputes
    rig.duel_client.accept_duel(&rig.opponent, &d2, &h2);
    rig.duel_client.reveal_script(&rig.challenger, &d2, &script1);
    rig.duel_client.reveal_script(&rig.opponent, &d2, &script2);
    rig.duel_client.resolve_duel_optimistic(&rig.challenger, &d2, &rig.challenger, &10);

    let d2_state = rig.duel_client.get_duel(&d2);
    let mut sim_payload = Bytes::new(&rig.env);
    sim_payload.append(&Bytes::from_array(&rig.env, &d2.to_be_bytes()));
    sim_payload.append(&Bytes::from_array(&rig.env, &d2_state.seed.to_be_bytes()));
    sim_payload.append(&script1);
    sim_payload.append(&script2);
    sim_payload.append(&ch.clone().into());
    sim_payload.append(&d2_state.nonce.clone().into());
    sim_payload.append(&Bytes::from_array(&rig.env, &1u32.to_be_bytes()));
    let fraud_proof = compute_sha256(&rig.env, &sim_payload);

    rig.duel_client.dispute_duel(&rig.opponent, &d2, &fraud_proof.into());
    assert_eq!(rig.duel_client.get_duel(&d2).status, DuelStatus::Resolved);
    assert_eq!(rig.duel_client.get_duel(&d2).winner, Some(rig.opponent.clone()));

    // D3: Accept, only Challenger reveals, Timeout default win
    rig.duel_client.accept_duel(&rig.opponent, &d3, &h2);
    rig.duel_client.reveal_script(&rig.challenger, &d3, &script1);
    rig.env.ledger().set_sequence_number(50);
    rig.duel_client.cancel_or_refund(&rig.challenger, &d3);
    assert_eq!(rig.duel_client.get_duel(&d3).status, DuelStatus::Resolved);
    assert_eq!(rig.duel_client.get_duel(&d3).winner, Some(rig.challenger.clone()));

    // D4: Accept, Neither reveals, Timeout refund both
    rig.duel_client.accept_duel(&rig.opponent, &d4, &h2);
    rig.env.ledger().set_sequence_number(100);
    rig.duel_client.cancel_or_refund(&rig.challenger, &d4);
    assert_eq!(rig.duel_client.get_duel(&d4).status, DuelStatus::ExpiredRefunded);

    // D5: Unaccepted, Challenger cancels
    rig.duel_client.cancel_or_refund(&rig.challenger, &d5);
    assert_eq!(rig.duel_client.get_duel(&d5).status, DuelStatus::Canceled);

    // All duels resolved -> Escrow balance must be exactly 0
    assert_eq!(rig.token_client.balance(&rig.duel_contract_id), 0);
}

#[test]
fn test_challenge3_odd_wager_and_fee_math_precision() {
    let rig = setup_duel_rig(333); // 3.33% fee (333 bps)
    let script = Bytes::from_slice(&rig.env, b"s");
    let h = compute_sha256(&rig.env, &script);
    let ch = BytesN::from_array(&rig.env, &[0x01; 32]);

    let duel_id = rig.duel_client.create_duel(&rig.challenger, &rig.wager_token, &333, &h, &ch, &1, &50, &20);
    rig.duel_client.accept_duel(&rig.opponent, &duel_id, &h);
    rig.duel_client.reveal_script(&rig.challenger, &duel_id, &script);
    rig.duel_client.reveal_script(&rig.opponent, &duel_id, &script);

    // Total pot = 666. Fee = (666 * 333) / 10000 = 221778 / 10000 = 22. Payout = 666 - 22 = 644.
    let fee_before = rig.token_client.balance(&rig.fee_recipient);
    let winner_before = rig.token_client.balance(&rig.challenger);

    rig.duel_client.resolve_duel_optimistic(&rig.challenger, &duel_id, &rig.challenger, &0);

    let fee_after = rig.token_client.balance(&rig.fee_recipient);
    let winner_after = rig.token_client.balance(&rig.challenger);

    assert_eq!(fee_after - fee_before, 22);
    assert_eq!(winner_after - winner_before, 644);
    assert_eq!((fee_after - fee_before) + (winner_after - winner_before), 666);
    assert_eq!(rig.token_client.balance(&rig.duel_contract_id), 0);
}

#[test]
fn test_challenge5_dispute_unauthorized_caller_rejected() {
    let rig = setup_duel_rig(0);
    let script1 = Bytes::from_slice(&rig.env, b"p1");
    let script1_hash = compute_sha256(&rig.env, &script1);
    let script2 = Bytes::from_slice(&rig.env, b"p2");
    let script2_hash = compute_sha256(&rig.env, &script2);
    let content_hash = BytesN::from_array(&rig.env, &[0x01; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &30,
    );

    rig.duel_client
        .accept_duel(&rig.opponent, &duel_id, &script2_hash);
    rig.duel_client
        .reveal_script(&rig.challenger, &duel_id, &script1);
    rig.duel_client
        .reveal_script(&rig.opponent, &duel_id, &script2);

    rig.duel_client
        .resolve_duel_optimistic(&rig.challenger, &duel_id, &rig.challenger, &10);

    let outsider = Address::generate(&rig.env);
    let res = rig.duel_client.try_dispute_duel(
        &outsider,
        &duel_id,
        &Bytes::from_slice(&rig.env, b"fraud proof"),
    );
    assert!(res.is_err(), "Outsider calling dispute_duel must fail with InvalidParticipant");
}

#[test]
fn test_challenge5_dispute_empty_proof_rejected() {
    let rig = setup_duel_rig(0);
    let script1 = Bytes::from_slice(&rig.env, b"p1");
    let script1_hash = compute_sha256(&rig.env, &script1);
    let script2 = Bytes::from_slice(&rig.env, b"p2");
    let script2_hash = compute_sha256(&rig.env, &script2);
    let content_hash = BytesN::from_array(&rig.env, &[0x01; 32]);

    let duel_id = rig.duel_client.create_duel(
        &rig.challenger,
        &rig.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &30,
    );

    rig.duel_client
        .accept_duel(&rig.opponent, &duel_id, &script2_hash);
    rig.duel_client
        .reveal_script(&rig.challenger, &duel_id, &script1);
    rig.duel_client
        .reveal_script(&rig.opponent, &duel_id, &script2);

    rig.duel_client
        .resolve_duel_optimistic(&rig.challenger, &duel_id, &rig.challenger, &10);

    let empty_proof = Bytes::new(&rig.env);
    let res = rig.duel_client.try_dispute_duel(
        &rig.opponent,
        &duel_id,
        &empty_proof,
    );
    assert!(res.is_err(), "Empty fraud proof must fail with InvalidSimulationProof");

    let garbage_proof = Bytes::from_slice(&rig.env, b"arbitrary non-empty garbage fraud proof");
    let res_garbage = rig.duel_client.try_dispute_duel(
        &rig.opponent,
        &duel_id,
        &garbage_proof,
    );
    assert!(res_garbage.is_err(), "Arbitrary non-empty fraud proof must fail with InvalidSimulationProof");
}

fn env_token_client<'a>(env: &'a Env, token: &Address) -> token::StellarAssetClient<'a> {
    token::StellarAssetClient::new(env, token)
}
