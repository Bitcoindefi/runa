#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    vec, Address, BytesN, Env, Symbol,
};

fn create_sample_vk(env: &Env, num_inputs: usize) -> VerificationKey {
    let mut alpha_bytes = [0u8; 48];
    alpha_bytes[0] = 0x80 | 0x01;
    let alpha_g1 = BytesN::from_array(env, &alpha_bytes);

    let mut beta_bytes = [0u8; 96];
    beta_bytes[0] = 0x80 | 0x02;
    let beta_g2 = BytesN::from_array(env, &beta_bytes);

    let mut gamma_bytes = [0u8; 96];
    gamma_bytes[0] = 0x80 | 0x03;
    let gamma_g2 = BytesN::from_array(env, &gamma_bytes);

    let mut delta_bytes = [0u8; 96];
    delta_bytes[0] = 0x80 | 0x04;
    let delta_g2 = BytesN::from_array(env, &delta_bytes);

    let mut ic = Vec::new(env);
    // IC[0] for constant term + IC[1..num_inputs+1] for public inputs
    for i in 0..=num_inputs {
        let mut ic_bytes = [0u8; 48];
        ic_bytes[0] = 0x80 | (0x10 + (i as u8));
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

struct TestSetup {
    env: Env,
    admin: Address,
    client: RunaZkVerifierContractClient<'static>,
}

fn setup_test() -> TestSetup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(RunaZkVerifierContract, ());
    let client = RunaZkVerifierContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    TestSetup {
        env,
        admin,
        client,
    }
}

#[test]
fn test_initialize_and_double_init() {
    let setup = setup_test();
    let res = setup.client.try_initialize(&setup.admin);
    assert!(res.is_err());
}

#[test]
fn test_register_vk_and_query() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");
    let vk = create_sample_vk(&setup.env, 3);

    setup.client.register_vk(&circuit_id, &vk);

    let retrieved_vk = setup.client.get_vk(&circuit_id);
    assert_eq!(retrieved_vk.alpha_g1, vk.alpha_g1);
    assert_eq!(retrieved_vk.ic.len(), vk.ic.len());
}

#[test]
fn test_register_vk_empty_ic_fails() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "duel_empty");
    let mut vk = create_sample_vk(&setup.env, 1);
    vk.ic = Vec::new(&setup.env);

    let res = setup.client.try_register_vk(&circuit_id, &vk);
    assert!(res.is_err());
}

#[test]
fn test_verify_valid_proof() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");
    let vk = create_sample_vk(&setup.env, 2);
    setup.client.register_vk(&circuit_id, &vk);

    let input1 = BytesN::from_array(&setup.env, &[0xAA; 32]);
    let input2 = BytesN::from_array(&setup.env, &[0xBB; 32]);
    let public_inputs = vec![&setup.env, input1, input2];

    let proof = generate_matching_groth16_proof(&setup.env, &vk, &public_inputs);

    let is_valid = setup
        .client
        .verify_proof(&circuit_id, &proof, &public_inputs);
    assert!(is_valid);
}

#[test]
fn test_verify_corrupted_proof_elements_fail() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");
    let vk = create_sample_vk(&setup.env, 2);
    setup.client.register_vk(&circuit_id, &vk);

    let input1 = BytesN::from_array(&setup.env, &[0x11; 32]);
    let input2 = BytesN::from_array(&setup.env, &[0x22; 32]);
    let public_inputs = vec![&setup.env, input1, input2];

    let valid_proof = generate_matching_groth16_proof(&setup.env, &vk, &public_inputs);

    // Corrupt A
    let mut corrupted_a_bytes = [0u8; 48];
    for i in 0..48 {
        corrupted_a_bytes[i] = valid_proof.a.get(i as u32).unwrap_or(0) ^ 0xFF;
    }
    corrupted_a_bytes[0] |= 0x80;
    let corrupted_a_proof = Groth16Proof {
        a: BytesN::from_array(&setup.env, &corrupted_a_bytes),
        b: valid_proof.b.clone(),
        c: valid_proof.c.clone(),
    };
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &corrupted_a_proof, &public_inputs));

    // Corrupt B
    let mut corrupted_b_bytes = [0u8; 96];
    for i in 0..96 {
        corrupted_b_bytes[i] = valid_proof.b.get(i as u32).unwrap_or(0) ^ 0x01;
    }
    corrupted_b_bytes[0] |= 0x80;
    let corrupted_b_proof = Groth16Proof {
        a: valid_proof.a.clone(),
        b: BytesN::from_array(&setup.env, &corrupted_b_bytes),
        c: valid_proof.c.clone(),
    };
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &corrupted_b_proof, &public_inputs));

    // Corrupt C
    let mut corrupted_c_bytes = [0u8; 48];
    for i in 0..48 {
        corrupted_c_bytes[i] = valid_proof.c.get(i as u32).unwrap_or(0) ^ 0x42;
    }
    corrupted_c_bytes[0] |= 0x80;
    let corrupted_c_proof = Groth16Proof {
        a: valid_proof.a.clone(),
        b: valid_proof.b.clone(),
        c: BytesN::from_array(&setup.env, &corrupted_c_bytes),
    };
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &corrupted_c_proof, &public_inputs));
}

#[test]
fn test_verify_mismatched_public_inputs_fails() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");
    let vk = create_sample_vk(&setup.env, 2);
    setup.client.register_vk(&circuit_id, &vk);

    let input1 = BytesN::from_array(&setup.env, &[0x11; 32]);
    let input2 = BytesN::from_array(&setup.env, &[0x22; 32]);
    let public_inputs = vec![&setup.env, input1.clone(), input2.clone()];

    let proof = generate_matching_groth16_proof(&setup.env, &vk, &public_inputs);

    // Provide 1 input instead of 2 (IC length mismatch)
    let bad_inputs_len = vec![&setup.env, input1.clone()];
    let res = setup
        .client
        .try_verify_proof(&circuit_id, &proof, &bad_inputs_len);
    assert!(res.is_err());

    // Provide altered input (anti-replay check)
    let altered_input2 = BytesN::from_array(&setup.env, &[0x99; 32]);
    let altered_inputs = vec![&setup.env, input1, altered_input2];
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &proof, &altered_inputs));
}

#[test]
fn test_verify_all_zero_points_fails() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");
    let vk = create_sample_vk(&setup.env, 1);
    setup.client.register_vk(&circuit_id, &vk);

    let zero_proof = Groth16Proof {
        a: BytesN::from_array(&setup.env, &[0u8; 48]),
        b: BytesN::from_array(&setup.env, &[0u8; 96]),
        c: BytesN::from_array(&setup.env, &[0u8; 48]),
    };
    let public_inputs = vec![&setup.env, BytesN::from_array(&setup.env, &[1u8; 32])];

    let res = setup
        .client
        .try_verify_proof(&circuit_id, &zero_proof, &public_inputs);
    assert!(res.is_err());
}

#[test]
fn test_verify_unregistered_circuit_fails() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "unregistered");
    let vk = create_sample_vk(&setup.env, 1);
    let public_inputs = vec![&setup.env, BytesN::from_array(&setup.env, &[1u8; 32])];
    let proof = generate_matching_groth16_proof(&setup.env, &vk, &public_inputs);

    let res = setup
        .client
        .try_verify_proof(&circuit_id, &proof, &public_inputs);
    assert!(res.is_err());
}

#[test]
fn test_fallback_mode() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "duel_fallback");
    let vk = create_sample_vk(&setup.env, 1);
    setup.client.register_vk(&circuit_id, &vk);

    assert!(!setup.client.is_fallback_mode(&circuit_id));
    setup.client.set_fallback_mode(&circuit_id, &true);
    assert!(setup.client.is_fallback_mode(&circuit_id));

    let dummy_proof = Groth16Proof {
        a: BytesN::from_array(&setup.env, &[1u8; 48]),
        b: BytesN::from_array(&setup.env, &[2u8; 96]),
        c: BytesN::from_array(&setup.env, &[3u8; 48]),
    };
    let public_inputs = vec![&setup.env, BytesN::from_array(&setup.env, &[1u8; 32])];

    // Under fallback mode, it accepts correctly sized proof
    let is_valid = setup
        .client
        .verify_proof(&circuit_id, &dummy_proof, &public_inputs);
    assert!(is_valid);
}
