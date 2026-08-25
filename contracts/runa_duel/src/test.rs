#![cfg(test)]

use super::*;
use runa_common::{compute_sha256, Groth16Proof};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    vec, Address, Bytes, BytesN, Env, Symbol, Vec,
};

// Mock ZK Verifier Contract for testing duel ZK resolution
#[contract]
pub struct MockZkVerifier;

#[contractimpl]
impl MockZkVerifier {
    pub fn verify_proof(
        _env: Env,
        _circuit_id: Symbol,
        proof: Groth16Proof,
        _public_inputs: Vec<BytesN<32>>,
    ) -> bool {
        // Mock verification: accept if first byte of proof.a is 0x42
        proof.a.get(0).unwrap_or(0) == 0x42
    }
}

struct TestSetup {
    env: Env,
    admin: Address,
    challenger: Address,
    opponent: Address,
    fee_recipient: Address,
    wager_token: Address,
    token_client: token::Client<'static>,
    duel_contract_id: Address,
    duel_client: RunaDuelContractClient<'static>,
    verifier_id: Address,
}

fn setup_test(fee_bps: u32) -> TestSetup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let challenger = Address::generate(&env);
    let opponent = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let item_contract = Address::generate(&env);

    // Deploy Mock Verifier
    let verifier_id = env.register(MockZkVerifier, ());

    // Deploy Stellar Asset Token for wagers
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_contract.address());
    let token_client = token::Client::new(&env, &token_contract.address());

    // Mint initial balances
    token_admin_client.mint(&challenger, &1_000_000_000);
    token_admin_client.mint(&opponent, &1_000_000_000);

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

    TestSetup {
        env,
        admin,
        challenger,
        opponent,
        fee_recipient,
        wager_token: token_contract.address(),
        token_client,
        duel_contract_id,
        duel_client,
        verifier_id,
    }
}

#[test]
fn test_initialize_and_prevent_double_init() {
    let setup = setup_test(250);
    let res = setup.duel_client.try_initialize(
        &setup.admin,
        &setup.verifier_id,
        &setup.admin,
        &setup.fee_recipient,
        &250,
    );
    assert!(res.is_err());
}

#[test]
fn test_create_and_accept_duel() {
    let setup = setup_test(0);
    let script1 = Bytes::from_slice(&setup.env, b"?hp < 10\n use potion");
    let script1_hash = compute_sha256(&setup.env, &script1);
    let content_hash = BytesN::from_array(&setup.env, &[1u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &100,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    assert_eq!(duel_id, 1);
    assert_eq!(setup.token_client.balance(&setup.challenger), 999_999_900);
    assert_eq!(
        setup.token_client.balance(&setup.duel_contract_id),
        100
    );

    let script2 = Bytes::from_slice(&setup.env, b"?dist > 5\n equip bow");
    let script2_hash = compute_sha256(&setup.env, &script2);

    setup
        .duel_client
        .accept_duel(&setup.opponent, &duel_id, &script2_hash);

    assert_eq!(setup.token_client.balance(&setup.opponent), 999_999_900);
    assert_eq!(
        setup.token_client.balance(&setup.duel_contract_id),
        200
    );

    let duel = setup.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Accepted);
    assert_eq!(duel.opponent, Some(setup.opponent));
    assert_ne!(duel.seed, 0);
}

#[test]
fn test_self_challenge_forbidden() {
    let setup = setup_test(0);
    let script_hash = BytesN::from_array(&setup.env, &[1u8; 32]);
    let content_hash = BytesN::from_array(&setup.env, &[2u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &100,
        &script_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    let res = setup
        .duel_client
        .try_accept_duel(&setup.challenger, &duel_id, &script_hash);
    assert!(res.is_err());
}

#[test]
fn test_expired_duel_acceptance_fails() {
    let setup = setup_test(0);
    let script_hash = BytesN::from_array(&setup.env, &[1u8; 32]);
    let content_hash = BytesN::from_array(&setup.env, &[2u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &100,
        &script_hash,
        &content_hash,
        &1,
        &10,
        &20,
    );

    // Fast forward ledger sequence past expiration
    setup.env.ledger().set_sequence_number(20);

    let res = setup
        .duel_client
        .try_accept_duel(&setup.opponent, &duel_id, &script_hash);
    assert!(res.is_err());
}

#[test]
fn test_commit_reveal_and_optimistic_settlement_immediate() {
    let setup = setup_test(500); // 5% fee (500 bps)
    let script1 = Bytes::from_slice(&setup.env, b"script player 1");
    let script1_hash = compute_sha256(&setup.env, &script1);
    let script2 = Bytes::from_slice(&setup.env, b"script player 2");
    let script2_hash = compute_sha256(&setup.env, &script2);
    let content_hash = BytesN::from_array(&setup.env, &[7u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &1000,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &30,
    );

    setup
        .duel_client
        .accept_duel(&setup.opponent, &duel_id, &script2_hash);

    // Reveal scripts
    setup
        .duel_client
        .reveal_script(&setup.challenger, &duel_id, &script1);
    setup
        .duel_client
        .reveal_script(&setup.opponent, &duel_id, &script2);

    let duel = setup.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Revealed);

    // Optimistic settlement with 0 dispute window
    setup
        .duel_client
        .resolve_duel_optimistic(&setup.challenger, &duel_id, &setup.challenger, &0);

    let resolved_duel = setup.duel_client.get_duel(&duel_id);
    assert_eq!(resolved_duel.status, DuelStatus::Resolved);
    assert_eq!(resolved_duel.winner, Some(setup.challenger.clone()));

    // Total pot = 2000. 5% fee = 100 to fee_recipient. 1900 to challenger.
    assert_eq!(setup.token_client.balance(&setup.fee_recipient), 100);
    // Challenger initial: 1_000_000_000 - 1000 + 1900 = 1_000_000_900
    assert_eq!(
        setup.token_client.balance(&setup.challenger),
        1_000_000_900
    );
}

#[test]
fn test_script_hash_mismatch_fails_reveal() {
    let setup = setup_test(0);
    let script1 = Bytes::from_slice(&setup.env, b"correct script");
    let script1_hash = compute_sha256(&setup.env, &script1);
    let script2 = Bytes::from_slice(&setup.env, b"opp script");
    let script2_hash = compute_sha256(&setup.env, &script2);
    let content_hash = BytesN::from_array(&setup.env, &[7u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &30,
    );

    setup
        .duel_client
        .accept_duel(&setup.opponent, &duel_id, &script2_hash);

    let tampered_script = Bytes::from_slice(&setup.env, b"tampered script");
    let res = setup
        .duel_client
        .try_reveal_script(&setup.challenger, &duel_id, &tampered_script);
    assert!(res.is_err());
}

#[test]
fn test_optimistic_dispute_and_finalize_flow() {
    let setup = setup_test(0);
    let script1 = Bytes::from_slice(&setup.env, b"script 1");
    let script1_hash = compute_sha256(&setup.env, &script1);
    let script2 = Bytes::from_slice(&setup.env, b"script 2");
    let script2_hash = compute_sha256(&setup.env, &script2);
    let content_hash = BytesN::from_array(&setup.env, &[1u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &30,
    );

    setup
        .duel_client
        .accept_duel(&setup.opponent, &duel_id, &script2_hash);
    setup
        .duel_client
        .reveal_script(&setup.challenger, &duel_id, &script1);
    setup
        .duel_client
        .reveal_script(&setup.opponent, &duel_id, &script2);

    // Initiate optimistic resolution with 10 ledger dispute window claiming challenger won
    setup
        .duel_client
        .resolve_duel_optimistic(&setup.challenger, &duel_id, &setup.challenger, &10);

    let duel = setup.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Disputed);

    // Opponent files dispute with fraud proof
    let fraud_proof = Bytes::from_slice(&setup.env, b"simulation: opponent dealt fatal strike");
    setup
        .duel_client
        .dispute_duel(&setup.opponent, &duel_id, &fraud_proof);

    let resolved_duel = setup.duel_client.get_duel(&duel_id);
    assert_eq!(resolved_duel.status, DuelStatus::Resolved);
    assert_eq!(resolved_duel.winner, Some(setup.opponent.clone()));
    assert_eq!(
        setup.token_client.balance(&setup.opponent),
        1_000_000_500
    );
}

#[test]
fn test_uncontested_dispute_window_finalize() {
    let setup = setup_test(0);
    let script1 = Bytes::from_slice(&setup.env, b"script 1");
    let script1_hash = compute_sha256(&setup.env, &script1);
    let script2 = Bytes::from_slice(&setup.env, b"script 2");
    let script2_hash = compute_sha256(&setup.env, &script2);
    let content_hash = BytesN::from_array(&setup.env, &[1u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &30,
    );

    setup
        .duel_client
        .accept_duel(&setup.opponent, &duel_id, &script2_hash);
    setup
        .duel_client
        .reveal_script(&setup.challenger, &duel_id, &script1);
    setup
        .duel_client
        .reveal_script(&setup.opponent, &duel_id, &script2);

    setup
        .duel_client
        .resolve_duel_optimistic(&setup.challenger, &duel_id, &setup.challenger, &10);

    // Trying to finalize while dispute window is open should fail
    let early_res = setup.duel_client.try_finalize_settlement(&duel_id);
    assert!(early_res.is_err());

    // Advance ledger sequence past dispute deadline
    setup.env.ledger().set_sequence_number(30);

    setup.duel_client.finalize_settlement(&duel_id);
    let duel = setup.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Resolved);
    assert_eq!(duel.winner, Some(setup.challenger.clone()));
    assert_eq!(
        setup.token_client.balance(&setup.challenger),
        1_000_000_500
    );
}

#[test]
fn test_challenger_cancel_unaccepted_duel() {
    let setup = setup_test(0);
    let script_hash = BytesN::from_array(&setup.env, &[1u8; 32]);
    let content_hash = BytesN::from_array(&setup.env, &[2u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &300,
        &script_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    setup
        .duel_client
        .cancel_or_refund(&setup.challenger, &duel_id);

    let duel = setup.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Canceled);
    assert_eq!(
        setup.token_client.balance(&setup.challenger),
        1_000_000_000
    );
}

#[test]
fn test_timeout_single_player_revealed_default_win() {
    let setup = setup_test(0);
    let script1 = Bytes::from_slice(&setup.env, b"script 1");
    let script1_hash = compute_sha256(&setup.env, &script1);
    let script2 = Bytes::from_slice(&setup.env, b"script 2");
    let script2_hash = compute_sha256(&setup.env, &script2);
    let content_hash = BytesN::from_array(&setup.env, &[1u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &400,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    setup
        .duel_client
        .accept_duel(&setup.opponent, &duel_id, &script2_hash);

    // Only challenger reveals
    setup
        .duel_client
        .reveal_script(&setup.challenger, &duel_id, &script1);

    // Advance ledger past reveal window
    setup.env.ledger().set_sequence_number(50);

    setup
        .duel_client
        .cancel_or_refund(&setup.challenger, &duel_id);

    let duel = setup.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Resolved);
    assert_eq!(duel.winner, Some(setup.challenger.clone()));
    assert_eq!(
        setup.token_client.balance(&setup.challenger),
        1_000_000_400
    );
}

#[test]
fn test_timeout_neither_revealed_refund_both() {
    let setup = setup_test(0);
    let script1_hash = BytesN::from_array(&setup.env, &[1u8; 32]);
    let script2_hash = BytesN::from_array(&setup.env, &[2u8; 32]);
    let content_hash = BytesN::from_array(&setup.env, &[3u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &250,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    setup
        .duel_client
        .accept_duel(&setup.opponent, &duel_id, &script2_hash);

    // Advance ledger past reveal deadline
    setup.env.ledger().set_sequence_number(60);

    setup
        .duel_client
        .cancel_or_refund(&setup.challenger, &duel_id);

    let duel = setup.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::ExpiredRefunded);
    assert_eq!(
        setup.token_client.balance(&setup.challenger),
        1_000_000_000
    );
    assert_eq!(
        setup.token_client.balance(&setup.opponent),
        1_000_000_000
    );
}

#[test]
fn test_zk_resolution_flow() {
    let setup = setup_test(0);
    let script1_hash = BytesN::from_array(&setup.env, &[1u8; 32]);
    let script2_hash = BytesN::from_array(&setup.env, &[2u8; 32]);
    let content_hash = BytesN::from_array(&setup.env, &[3u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    setup
        .duel_client
        .accept_duel(&setup.opponent, &duel_id, &script2_hash);

    // Build 192 byte proof where first byte is 0x42 (accepted by MockZkVerifier)
    let mut proof_bytes = [0u8; 192];
    proof_bytes[0] = 0x42;
    let proof_data = Bytes::from_slice(&setup.env, &proof_bytes);

    let public_inputs = vec![&setup.env, script2_hash.clone(), content_hash.clone()];

    setup.duel_client.resolve_duel_zk(
        &setup.challenger,
        &duel_id,
        &setup.challenger,
        &proof_data,
        &public_inputs,
    );

    let duel = setup.duel_client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Resolved);
    assert_eq!(duel.resolution_mode, ResolutionMode::ZeroKnowledge);
    assert_eq!(duel.winner, Some(setup.challenger.clone()));
    assert_eq!(
        setup.token_client.balance(&setup.challenger),
        1_000_000_500
    );
}

#[test]
fn test_zk_resolution_invalid_proof_rejected() {
    let setup = setup_test(0);
    let script1_hash = BytesN::from_array(&setup.env, &[1u8; 32]);
    let script2_hash = BytesN::from_array(&setup.env, &[2u8; 32]);
    let content_hash = BytesN::from_array(&setup.env, &[3u8; 32]);

    let duel_id = setup.duel_client.create_duel(
        &setup.challenger,
        &setup.wager_token,
        &500,
        &script1_hash,
        &content_hash,
        &1,
        &50,
        &20,
    );

    setup
        .duel_client
        .accept_duel(&setup.opponent, &duel_id, &script2_hash);

    // Proof with first byte 0x00 (rejected by MockZkVerifier)
    let proof_bytes = [0u8; 192];
    let proof_data = Bytes::from_slice(&setup.env, &proof_bytes);
    let public_inputs = vec![&setup.env, script2_hash.clone()];

    let res = setup.duel_client.try_resolve_duel_zk(
        &setup.challenger,
        &duel_id,
        &setup.challenger,
        &proof_data,
        &public_inputs,
    );
    assert!(res.is_err());
}
