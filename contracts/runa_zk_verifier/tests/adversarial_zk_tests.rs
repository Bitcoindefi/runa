#![cfg(test)]

use runa_common::{
    compute_public_inputs_hash, Groth16Proof, VerificationKey, ZkPublicInputs,
};
use runa_zk_verifier::{
    RunaZkVerifierContract, RunaZkVerifierContractClient,
};
use soroban_sdk::{
    crypto::bls12_381::Bls12381Fr,
    testutils::Address as _, vec, Address, Bytes, BytesN, Env, Symbol, Vec,
};

fn generate_adversarial_zk_fixture(
    env: &Env,
    public_inputs: &Vec<BytesN<32>>,
    seed_offset: u32,
) -> (VerificationKey, Groth16Proof) {
    let bls = env.crypto().bls12_381();
    let mut msg_bytes = [0u8; 16];
    msg_bytes[0] = (seed_offset & 0xFF) as u8;
    let msg = Bytes::from_slice(env, &msg_bytes);
    let dst_g1 = Bytes::from_slice(env, b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_");
    let dst_g2 = Bytes::from_slice(env, b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_");

    let g1 = bls.hash_to_g1(&msg, &dst_g1);
    let g2 = bls.hash_to_g2(&msg, &dst_g2);

    let scalar_from_u32 = |val: u32| {
        let mut b = [0u8; 32];
        b[31] = (val & 0xFF) as u8;
        b[30] = ((val >> 8) & 0xFF) as u8;
        Bls12381Fr::from_bytes(BytesN::from_array(env, &b))
    };

    let s_alpha = scalar_from_u32(2 + seed_offset);
    let s_beta = scalar_from_u32(3 + seed_offset);
    let s_gamma = scalar_from_u32(5 + seed_offset);
    let s_delta = scalar_from_u32(7 + seed_offset);
    let s_c = scalar_from_u32(11 + seed_offset);
    let s_b = scalar_from_u32(1);

    let alpha_g1 = bls.g1_mul(&g1, &s_alpha);
    let beta_g2 = bls.g2_mul(&g2, &s_beta);
    let gamma_g2 = bls.g2_mul(&g2, &s_gamma);
    let delta_g2 = bls.g2_mul(&g2, &s_delta);

    let mut ic = Vec::new(env);
    let mut s_kpub = scalar_from_u32(13 + seed_offset);
    let ic0 = bls.g1_mul(&g1, &s_kpub);
    ic.push_back(ic0.to_bytes());

    for i in 0..public_inputs.len() {
        let s_ici = scalar_from_u32(17 + (i as u32) * 2 + seed_offset);
        let ic_pt = bls.g1_mul(&g1, &s_ici);
        ic.push_back(ic_pt.to_bytes());

        let x_i = Bls12381Fr::from_bytes(public_inputs.get(i).unwrap());
        let term = bls.fr_mul(&x_i, &s_ici);
        s_kpub = bls.fr_add(&s_kpub, &term);
    }

    let vk = VerificationKey {
        alpha_g1: alpha_g1.to_bytes(),
        beta_g2: beta_g2.to_bytes(),
        gamma_g2: gamma_g2.to_bytes(),
        delta_g2: delta_g2.to_bytes(),
        ic,
    };

    let term1 = bls.fr_mul(&s_alpha, &s_beta);
    let term2 = bls.fr_mul(&s_kpub, &s_gamma);
    let term3 = bls.fr_mul(&s_c, &s_delta);

    let sum12 = bls.fr_add(&term1, &term2);
    let s_a = bls.fr_add(&sum12, &term3);

    let pt_a = bls.g1_mul(&g1, &s_a);
    let pt_b = bls.g2_mul(&g2, &s_b);
    let pt_c = bls.g1_mul(&g1, &s_c);

    let proof = Groth16Proof {
        a: pt_a.to_bytes(),
        b: pt_b.to_bytes(),
        c: pt_c.to_bytes(),
    };

    (vk, proof)
}

struct ZkSetup {
    env: Env,
    _admin: Address,
    client: RunaZkVerifierContractClient<'static>,
}

fn setup_zk() -> ZkSetup {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let admin = Address::generate(&env);
    let contract_id = env.register(RunaZkVerifierContract, ());
    let client = RunaZkVerifierContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    ZkSetup { env, _admin: admin, client }
}

#[test]
fn test_challenge1_public_input_single_byte_mutation_stress() {
    let setup = setup_zk();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");

    let mut input1_bytes = [0u8; 32];
    input1_bytes[31] = 0x11;
    let input1 = BytesN::from_array(&setup.env, &input1_bytes);

    let mut input2_bytes = [0u8; 32];
    input2_bytes[31] = 0x22;
    let input2 = BytesN::from_array(&setup.env, &input2_bytes);

    let mut input3_bytes = [0u8; 32];
    input3_bytes[31] = 0x33;
    let input3 = BytesN::from_array(&setup.env, &input3_bytes);

    let public_inputs = vec![&setup.env, input1.clone(), input2.clone(), input3.clone()];

    let (vk, valid_proof) = generate_adversarial_zk_fixture(&setup.env, &public_inputs, 0);
    setup.client.register_vk(&circuit_id, &vk);

    assert!(setup
        .client
        .verify_proof(&circuit_id, &valid_proof, &public_inputs));

    // Stress test: Mutate each byte of input1 individually and verify it fails every time
    for byte_idx in 0..31 {
        let mut mutated_bytes = [0u8; 32];
        mutated_bytes[31] = 0x11;
        mutated_bytes[byte_idx] ^= 0x01; // flip 1 bit
        let mutated_input1 = BytesN::from_array(&setup.env, &mutated_bytes);

        let mutated_inputs = vec![
            &setup.env,
            mutated_input1,
            input2.clone(),
            input3.clone(),
        ];

        let result = setup
            .client
            .verify_proof(&circuit_id, &valid_proof, &mutated_inputs);
        assert!(
            !result,
            "Verification must fail when public input byte {} is mutated",
            byte_idx
        );
    }
}

#[test]
fn test_challenge1_public_inputs_hash_tamper_resistance() {
    let env = Env::default();

    let base_inputs = ZkPublicInputs {
        initial_state_hash: BytesN::from_array(&env, &[0x01; 32]),
        opponent_script_hash: BytesN::from_array(&env, &[0x02; 32]),
        seed: 123456789,
        outcome_flag: 1,
        ticks_elapsed: 42,
        content_hash: BytesN::from_array(&env, &[0x03; 32]),
        engine_version: 1,
        nonce: BytesN::from_array(&env, &[0x04; 32]),
    };

    let base_hash = compute_public_inputs_hash(&env, &base_inputs);

    // 1. Altered Nonce
    let mut modified = base_inputs.clone();
    modified.nonce = BytesN::from_array(&env, &[0xFF; 32]);
    assert_ne!(base_hash, compute_public_inputs_hash(&env, &modified));

    // 2. Altered Seed
    let mut modified = base_inputs.clone();
    modified.seed = 987654321;
    assert_ne!(base_hash, compute_public_inputs_hash(&env, &modified));

    // 3. Altered Opponent Script Hash
    let mut modified = base_inputs.clone();
    modified.opponent_script_hash = BytesN::from_array(&env, &[0xAA; 32]);
    assert_ne!(base_hash, compute_public_inputs_hash(&env, &modified));

    // 4. Altered Outcome Flag (e.g. loser claiming win)
    let mut modified = base_inputs.clone();
    modified.outcome_flag = 2;
    assert_ne!(base_hash, compute_public_inputs_hash(&env, &modified));

    // 5. Altered Content Hash
    let mut modified = base_inputs.clone();
    modified.content_hash = BytesN::from_array(&env, &[0xBB; 32]);
    assert_ne!(base_hash, compute_public_inputs_hash(&env, &modified));

    // 6. Altered Engine Version
    let mut modified = base_inputs.clone();
    modified.engine_version = 2;
    assert_ne!(base_hash, compute_public_inputs_hash(&env, &modified));

    // 7. Altered Initial State Hash
    let mut modified = base_inputs.clone();
    modified.initial_state_hash = BytesN::from_array(&env, &[0xCC; 32]);
    assert_ne!(base_hash, compute_public_inputs_hash(&env, &modified));
}

#[test]
fn test_challenge1_curve_point_corruption_rejection() {
    let setup = setup_zk();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");

    let mut input_bytes = [0u8; 32];
    input_bytes[31] = 0x11;
    let input = BytesN::from_array(&setup.env, &input_bytes);
    let public_inputs = vec![&setup.env, input];

    let (vk, valid_proof) = generate_adversarial_zk_fixture(&setup.env, &public_inputs, 0);
    setup.client.register_vk(&circuit_id, &vk);

    let bls = setup.env.crypto().bls12_381();
    let other_msg = Bytes::from_slice(&setup.env, b"different_point");
    let dst_g1 = Bytes::from_slice(&setup.env, b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_");
    let different_g1 = bls.hash_to_g1(&other_msg, &dst_g1);

    let proof_bad_a = Groth16Proof {
        a: different_g1.to_bytes(),
        b: valid_proof.b.clone(),
        c: valid_proof.c.clone(),
    };
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &proof_bad_a, &public_inputs));
}

#[test]
fn test_challenge1_all_zero_points_rejection() {
    let setup = setup_zk();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");
    let public_inputs = vec![&setup.env, BytesN::from_array(&setup.env, &[0x11; 32])];
    let (vk, _) = generate_adversarial_zk_fixture(&setup.env, &public_inputs, 0);
    setup.client.register_vk(&circuit_id, &vk);

    // All zero A
    let bad_a = Groth16Proof {
        a: BytesN::from_array(&setup.env, &[0u8; 96]),
        b: BytesN::from_array(&setup.env, &[0x80; 192]),
        c: BytesN::from_array(&setup.env, &[0x80; 96]),
    };
    assert!(setup
        .client
        .try_verify_proof(&circuit_id, &bad_a, &public_inputs)
        .is_err());

    // All zero B
    let bad_b = Groth16Proof {
        a: BytesN::from_array(&setup.env, &[0x80; 96]),
        b: BytesN::from_array(&setup.env, &[0u8; 192]),
        c: BytesN::from_array(&setup.env, &[0x80; 96]),
    };
    assert!(setup
        .client
        .try_verify_proof(&circuit_id, &bad_b, &public_inputs)
        .is_err());

    // All zero C
    let bad_c = Groth16Proof {
        a: BytesN::from_array(&setup.env, &[0x80; 96]),
        b: BytesN::from_array(&setup.env, &[0x80; 192]),
        c: BytesN::from_array(&setup.env, &[0u8; 96]),
    };
    assert!(setup
        .client
        .try_verify_proof(&circuit_id, &bad_c, &public_inputs)
        .is_err());
}

#[test]
fn test_challenge1_cross_circuit_proof_isolation() {
    let setup = setup_zk();
    let circuit1 = Symbol::new(&setup.env, "duel_1v1");
    let circuit2 = Symbol::new(&setup.env, "duel_3v3");

    let mut input1_bytes = [0u8; 32];
    input1_bytes[31] = 0x10;
    let input1 = BytesN::from_array(&setup.env, &input1_bytes);

    let mut input2_bytes = [0u8; 32];
    input2_bytes[31] = 0x20;
    let input2 = BytesN::from_array(&setup.env, &input2_bytes);

    let public_inputs = vec![&setup.env, input1, input2];

    let (vk1, proof1) = generate_adversarial_zk_fixture(&setup.env, &public_inputs, 0);
    let (vk2, _) = generate_adversarial_zk_fixture(&setup.env, &public_inputs, 5);

    setup.client.register_vk(&circuit1, &vk1);
    setup.client.register_vk(&circuit2, &vk2);

    // Proof 1 verified against circuit 1 is valid
    assert!(setup.client.verify_proof(&circuit1, &proof1, &public_inputs));

    // Proof 1 verified against circuit 2 MUST fail
    assert!(!setup.client.verify_proof(&circuit2, &proof1, &public_inputs));
}
