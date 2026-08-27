#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    vec, Address, Bytes, BytesN, Env, Symbol,
};

fn create_sample_vk(env: &Env, num_inputs: usize) -> VerificationKey {
    let mut alpha_bytes = [0u8; 96];
    alpha_bytes[0] = 0x80 | 0x01;
    let alpha_g1 = BytesN::from_array(env, &alpha_bytes);

    let mut beta_bytes = [0u8; 192];
    beta_bytes[0] = 0x80 | 0x02;
    let beta_g2 = BytesN::from_array(env, &beta_bytes);

    let mut gamma_bytes = [0u8; 192];
    gamma_bytes[0] = 0x80 | 0x03;
    let gamma_g2 = BytesN::from_array(env, &gamma_bytes);

    let mut delta_bytes = [0u8; 192];
    delta_bytes[0] = 0x80 | 0x04;
    let delta_g2 = BytesN::from_array(env, &delta_bytes);

    let mut ic = Vec::new(env);
    // IC[0] for constant term + IC[1..num_inputs+1] for public inputs
    for i in 0..=num_inputs {
        let mut ic_bytes = [0u8; 96];
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
    env.budget().reset_unlimited();

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

fn generate_test_groth16_fixture(
    env: &Env,
    public_inputs: &Vec<BytesN<32>>,
) -> (VerificationKey, Groth16Proof) {
    let bls = env.crypto().bls12_381();
    let msg = Bytes::from_slice(env, b"runa_zk_test_generator");
    let dst_g1 = Bytes::from_slice(env, b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_");
    let dst_g2 = Bytes::from_slice(env, b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_");

    let g1 = bls.hash_to_g1(&msg, &dst_g1);
    let g2 = bls.hash_to_g2(&msg, &dst_g2);

    let scalar_from_u32 = |val: u32| {
        let mut b = [0u8; 32];
        b[31] = val as u8;
        b[30] = (val >> 8) as u8;
        Bls12381Fr::from_bytes(BytesN::from_array(env, &b))
    };

    let s_alpha = scalar_from_u32(2);
    let s_beta = scalar_from_u32(3);
    let s_gamma = scalar_from_u32(5);
    let s_delta = scalar_from_u32(7);
    let s_c = scalar_from_u32(11);
    let s_b = scalar_from_u32(1);

    let alpha_g1 = bls.g1_mul(&g1, &s_alpha);
    let beta_g2 = bls.g2_mul(&g2, &s_beta);
    let gamma_g2 = bls.g2_mul(&g2, &s_gamma);
    let delta_g2 = bls.g2_mul(&g2, &s_delta);

    let mut ic = Vec::new(env);
    let mut s_kpub = scalar_from_u32(13);
    let ic0 = bls.g1_mul(&g1, &s_kpub);
    ic.push_back(ic0.to_bytes());

    for i in 0..public_inputs.len() {
        let s_ici = scalar_from_u32(17 + (i as u32) * 2);
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

#[test]
fn test_verify_valid_proof() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");

    let mut input1_bytes = [0u8; 32];
    input1_bytes[31] = 0x11;
    let input1 = BytesN::from_array(&setup.env, &input1_bytes);

    let mut input2_bytes = [0u8; 32];
    input2_bytes[31] = 0x22;
    let input2 = BytesN::from_array(&setup.env, &input2_bytes);

    let public_inputs = vec![&setup.env, input1, input2];
    let (vk, proof) = generate_test_groth16_fixture(&setup.env, &public_inputs);
    setup.client.register_vk(&circuit_id, &vk);

    let is_valid = setup
        .client
        .verify_proof(&circuit_id, &proof, &public_inputs);
    assert!(is_valid);
}

#[test]
fn test_verify_corrupted_proof_elements_fail() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");

    let mut input1_bytes = [0u8; 32];
    input1_bytes[31] = 0x11;
    let input1 = BytesN::from_array(&setup.env, &input1_bytes);

    let mut input2_bytes = [0u8; 32];
    input2_bytes[31] = 0x22;
    let input2 = BytesN::from_array(&setup.env, &input2_bytes);

    let public_inputs = vec![&setup.env, input1, input2];
    let (vk, valid_proof) = generate_test_groth16_fixture(&setup.env, &public_inputs);
    setup.client.register_vk(&circuit_id, &vk);

    // Corrupt A
    let bls = setup.env.crypto().bls12_381();
    let msg = Bytes::from_slice(&setup.env, b"corrupted_point");
    let dst_g1 = Bytes::from_slice(&setup.env, b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_");
    let corrupted_a_pt = bls.hash_to_g1(&msg, &dst_g1);
    let corrupted_a_proof = Groth16Proof {
        a: corrupted_a_pt.to_bytes(),
        b: valid_proof.b.clone(),
        c: valid_proof.c.clone(),
    };
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &corrupted_a_proof, &public_inputs));

    // Corrupt B
    let dst_g2 = Bytes::from_slice(&setup.env, b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_");
    let corrupted_b_pt = bls.hash_to_g2(&msg, &dst_g2);
    let corrupted_b_proof = Groth16Proof {
        a: valid_proof.a.clone(),
        b: corrupted_b_pt.to_bytes(),
        c: valid_proof.c.clone(),
    };
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &corrupted_b_proof, &public_inputs));

    // Corrupt C
    let corrupted_c_pt = bls.hash_to_g1(&msg, &dst_g1);
    let corrupted_c_proof = Groth16Proof {
        a: valid_proof.a.clone(),
        b: valid_proof.b.clone(),
        c: corrupted_c_pt.to_bytes(),
    };
    assert!(!setup
        .client
        .verify_proof(&circuit_id, &corrupted_c_proof, &public_inputs));
}

#[test]
fn test_verify_mismatched_public_inputs_fails() {
    let setup = setup_test();
    let circuit_id = Symbol::new(&setup.env, "duel_v1");

    let mut input1_bytes = [0u8; 32];
    input1_bytes[31] = 0x11;
    let input1 = BytesN::from_array(&setup.env, &input1_bytes);

    let mut input2_bytes = [0u8; 32];
    input2_bytes[31] = 0x22;
    let input2 = BytesN::from_array(&setup.env, &input2_bytes);

    let public_inputs = vec![&setup.env, input1.clone(), input2.clone()];
    let (vk, proof) = generate_test_groth16_fixture(&setup.env, &public_inputs);
    setup.client.register_vk(&circuit_id, &vk);

    // Provide 1 input instead of 2 (IC length mismatch)
    let bad_inputs_len = vec![&setup.env, input1.clone()];
    let res = setup
        .client
        .try_verify_proof(&circuit_id, &proof, &bad_inputs_len);
    assert!(res.is_err());

    // Provide altered input (anti-replay check)
    let mut altered2_bytes = [0u8; 32];
    altered2_bytes[31] = 0x99;
    let altered_input2 = BytesN::from_array(&setup.env, &altered2_bytes);
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
        a: BytesN::from_array(&setup.env, &[0u8; 96]),
        b: BytesN::from_array(&setup.env, &[0u8; 192]),
        c: BytesN::from_array(&setup.env, &[0u8; 96]),
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
    let public_inputs = vec![&setup.env, BytesN::from_array(&setup.env, &[1u8; 32])];
    let (_vk, proof) = generate_test_groth16_fixture(&setup.env, &public_inputs);

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
        a: BytesN::from_array(&setup.env, &[1u8; 96]),
        b: BytesN::from_array(&setup.env, &[2u8; 192]),
        c: BytesN::from_array(&setup.env, &[3u8; 96]),
    };
    let public_inputs = vec![&setup.env, BytesN::from_array(&setup.env, &[1u8; 32])];

    // Under fallback mode, it accepts correctly sized proof
    let is_valid = setup
        .client
        .verify_proof(&circuit_id, &dummy_proof, &public_inputs);
    assert!(is_valid);
}
