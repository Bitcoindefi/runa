#![cfg(test)]

use runa_common::{
    compute_public_inputs_hash, Groth16Proof, VerificationKey, ZkPublicInputs,
};
use runa_zk_verifier::{
    generate_matching_groth16_proof, RunaZkVerifierContract, RunaZkVerifierContractClient,
};
use soroban_sdk::{
    testutils::Address as _, vec, Address, BytesN, Env, Symbol, Vec,
};

fn create_vk(env: &Env, num_inputs: usize, seed_offset: u8) -> VerificationKey {
    let mut alpha_bytes = [0u8; 48];
    alpha_bytes[0] = 0x80 | (0x01 + seed_offset);
    let alpha_g1 = BytesN::from_array(env, &alpha_bytes);

    let mut beta_bytes = [0u8; 96];
    beta_bytes[0] = 0x80 | (0x02 + seed_offset);
    let beta_g2 = BytesN::from_array(env, &beta_bytes);

    let mut gamma_bytes = [0u8; 96];
    gamma_bytes[0] = 0x80 | (0x03 + seed_offset);
    let gamma_g2 = BytesN::from_array(env, &gamma_bytes);

    let mut delta_bytes = [0u8; 96];
    delta_bytes[0] = 0x80 | (0x04 + seed_offset);
    let delta_g2 = BytesN::from_array(env, &delta_bytes);

    let mut ic = Vec::new(env);
    for i in 0..=num_inputs {
        let mut ic_bytes = [0u8; 48];
        ic_bytes[0] = 0x80 | (0x10 + (i as u8) + seed_offset);
        for j in 1..48 {
            ic_bytes[j] = ((i * 7 + j * 13 + (seed_offset as usize) * 17) % 251) as u8;
        }
        ic.push_back(BytesN::from_array(env, &ic_bytes));
    }

    VerificationKey {
        alpha_g1,
        beta_g2,
        gamma_g2,
        delta_g2,
        ic,
    }
}

struct ZkSetup {
    env: Env,
    _admin: Address,
    client: RunaZkVerifierContractClient<'static>,
}

fn setup_zk() -> ZkSetup {
    let env = Env::default();
    env.mock_all_auths();

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
    let vk = create_vk(&setup.env, 3, 0);
    setup.client.register_vk(&circuit_id, &vk);

    let input1 = BytesN::from_array(&setup.env, &[0x11; 32]);
    let input2 = BytesN::from_array(&setup.env, &[0x22; 32]);
    let input3 = BytesN::from_array(&setup.env, &[0x33; 32]);
    let public_inputs = vec![&setup.env, input1.clone(), input2.clone(), input3.clone()];

    let valid_proof = generate_matching_groth16_proof(&setup.env, &vk, &public_inputs);
    assert!(setup
        .client
        .verify_proof(&circuit_id, &valid_proof, &public_inputs));

    // Stress test: Mutate each byte of input1 individually and verify it fails every time
    for byte_idx in 0..32 {
        let mut mutated_bytes = [0x11u8; 32];
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
fn test_challenge1_curve_flag_tampering_rejection() {
    let setup = setup_zk();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");
    let vk = create_vk(&setup.env, 1, 0);
    setup.client.register_vk(&circuit_id, &vk);

    let input = BytesN::from_array(&setup.env, &[0x11; 32]);
    let public_inputs = vec![&setup.env, input];
    let valid_proof = generate_matching_groth16_proof(&setup.env, &vk, &public_inputs);

    // Unset MSB (0x80) on proof.a
    let mut a_no_flag = [0u8; 48];
    for i in 0..48 {
        a_no_flag[i] = valid_proof.a.get(i as u32).unwrap_or(0);
    }
    a_no_flag[0] &= 0x7F; // strip compressed flag
    let proof_bad_a = Groth16Proof {
        a: BytesN::from_array(&setup.env, &a_no_flag),
        b: valid_proof.b.clone(),
        c: valid_proof.c.clone(),
    };
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &proof_bad_a, &public_inputs));

    // Unset MSB (0x80) on proof.b
    let mut b_no_flag = [0u8; 96];
    for i in 0..96 {
        b_no_flag[i] = valid_proof.b.get(i as u32).unwrap_or(0);
    }
    b_no_flag[0] &= 0x7F;
    let proof_bad_b = Groth16Proof {
        a: valid_proof.a.clone(),
        b: BytesN::from_array(&setup.env, &b_no_flag),
        c: valid_proof.c.clone(),
    };
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &proof_bad_b, &public_inputs));

    // Unset MSB (0x80) on proof.c
    let mut c_no_flag = [0u8; 48];
    for i in 0..48 {
        c_no_flag[i] = valid_proof.c.get(i as u32).unwrap_or(0);
    }
    c_no_flag[0] &= 0x7F;
    let proof_bad_c = Groth16Proof {
        a: valid_proof.a.clone(),
        b: valid_proof.b.clone(),
        c: BytesN::from_array(&setup.env, &c_no_flag),
    };
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &proof_bad_c, &public_inputs));
}

#[test]
fn test_challenge1_all_zero_points_rejection() {
    let setup = setup_zk();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");
    let vk = create_vk(&setup.env, 1, 0);
    setup.client.register_vk(&circuit_id, &vk);

    let public_inputs = vec![&setup.env, BytesN::from_array(&setup.env, &[0x11; 32])];

    // All zero A
    let bad_a = Groth16Proof {
        a: BytesN::from_array(&setup.env, &[0u8; 48]),
        b: BytesN::from_array(&setup.env, &[0x80; 96]),
        c: BytesN::from_array(&setup.env, &[0x80; 48]),
    };
    assert!(setup
        .client
        .try_verify_proof(&circuit_id, &bad_a, &public_inputs)
        .is_err());

    // All zero B
    let bad_b = Groth16Proof {
        a: BytesN::from_array(&setup.env, &[0x80; 48]),
        b: BytesN::from_array(&setup.env, &[0u8; 96]),
        c: BytesN::from_array(&setup.env, &[0x80; 48]),
    };
    assert!(setup
        .client
        .try_verify_proof(&circuit_id, &bad_b, &public_inputs)
        .is_err());

    // All zero C
    let bad_c = Groth16Proof {
        a: BytesN::from_array(&setup.env, &[0x80; 48]),
        b: BytesN::from_array(&setup.env, &[0x80; 96]),
        c: BytesN::from_array(&setup.env, &[0u8; 48]),
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

    let vk1 = create_vk(&setup.env, 2, 0);
    let vk2 = create_vk(&setup.env, 2, 5);

    setup.client.register_vk(&circuit1, &vk1);
    setup.client.register_vk(&circuit2, &vk2);

    let input1 = BytesN::from_array(&setup.env, &[0x10; 32]);
    let input2 = BytesN::from_array(&setup.env, &[0x20; 32]);
    let public_inputs = vec![&setup.env, input1, input2];

    let proof1 = generate_matching_groth16_proof(&setup.env, &vk1, &public_inputs);

    // Proof 1 verified against circuit 1 is valid
    assert!(setup.client.verify_proof(&circuit1, &proof1, &public_inputs));

    // Proof 1 verified against circuit 2 MUST fail
    assert!(!setup.client.verify_proof(&circuit2, &proof1, &public_inputs));
}
