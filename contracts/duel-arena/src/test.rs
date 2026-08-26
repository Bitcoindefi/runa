#![cfg(test)]
extern crate std;

use crate::{DuelArena, DuelArenaClient};
use soroban_sdk::{
    contract, contractimpl, symbol_short, testutils::Address as _, testutils::Ledger as _, Address, BytesN, Env, MuxedAddress, String,
    Symbol,
};
use stellar_tokens::fungible::{Base, FungibleToken};

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn __constructor(env: &Env, admin: Address) {
        Base::set_metadata(
            env,
            7,
            String::from_str(env, "Stake"),
            String::from_str(env, "STK"),
        );
        env.storage().instance().set(&symbol_short!("ADMIN"), &admin);
    }

    pub fn faucet(env: &Env, to: Address, amount: i128) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("ADMIN"))
            .unwrap();
        admin.require_auth();
        Base::mint(env, &to, amount);
    }
}

#[contractimpl(contracttrait)]
impl FungibleToken for MockToken {
    type ContractType = Base;
}

fn sha(env: &Env, s: &str) -> BytesN<32> {
    env.crypto().sha256(&String::from_str(env, s).to_bytes()).to_bytes()
}

fn setup() -> (
    Env,
    Address,
    Address,
    Address,
    DuelArenaClient<'static>,
    soroban_sdk::token::Client<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let token_id = env.register(
        MockToken,
        (admin.clone(),),
    );
    let token = soroban_sdk::token::Client::new(&env, &token_id);
    let token_admin_client = MockTokenClient::new(&env, &token_id);
    token_admin_client.faucet(&alice, &10_000);
    token_admin_client.faucet(&bob, &10_000);

    let arena_id = env.register(DuelArena, (token_id.clone(),));
    let arena = DuelArenaClient::new(&env, &arena_id);
    (env, admin, alice, bob, arena, token)
}

fn script_hash(env: &Env, s: &str) -> BytesN<32> {
    sha(env, s)
}

#[test]
fn happy_path_commit_reveal_settle() {
    let (env, _admin, alice, bob, arena, token) = setup();
    let h_a = script_hash(&env, "script A");
    let h_b = script_hash(&env, "script B");

    arena.create_duel(
        &1, &alice, &bob, &500, &h_a,
        &String::from_str(&env, "engine-1"),
        &sha(&env, "content-v1"),
    );
    arena.accept_duel(&1, &h_b, &bob);

    // Seed is fixed by the ledger at acceptance time.
    assert!(arena.duel(&1).seed.is_some());

    arena.reveal_challenger(&1, &String::from_str(&env, "script A"));
    arena.reveal_opponent(&1, &String::from_str(&env, "script B"));

    arena.publish_result(&1, &alice);

    // Inside the dispute window settling must be refused.
    env.ledger().with_mut(|l| l.timestamp += 5);
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| arena.settle(&1))).ok();

    env.ledger().with_mut(|l| l.timestamp += 10 * 60 + 1);
    arena.settle(&1);

    assert_eq!(token.balance(&alice), 10_500);
    assert_eq!(token.balance(&bob), 9_500);
}

#[test]
fn rival_never_reveals_refunds_both() {
    let (env, _admin, alice, bob, arena, token) = setup();
    arena.create_duel(
        &2, &alice, &bob, &300, &script_hash(&env, "A"),
        &String::from_str(&env, "engine-1"), &sha(&env, "c"),
    );
    arena.accept_duel(&2, &script_hash(&env, "B"), &bob);
    arena.reveal_challenger(&2, &String::from_str(&env, "A"));

    env.ledger().with_mut(|l| l.timestamp += 60 * 60 + 1);
    arena.refund_no_show(&2);

    assert_eq!(token.balance(&alice), 10_000);
    assert_eq!(token.balance(&bob), 10_000);
}

#[test]
fn reveal_with_wrong_plaintext_is_rejected() {
    let (env, _admin, alice, bob, arena, _t) = setup();
    arena.create_duel(
        &3, &alice, &bob, &100, &script_hash(&env, "real script"),
        &String::from_str(&env, "e"), &sha(&env, "c"),
    );
    arena.accept_duel(&3, &script_hash(&env, "B"), &bob);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        arena.reveal_challenger(&3, &String::from_str(&env, "forged script"))
    }));
    assert!(result.is_err(), "hash mismatch must panic");
}

#[test]
fn double_settle_is_impossible() {
    let (env, _admin, alice, bob, arena, token) = setup();
    arena.create_duel(
        &4, &alice, &bob, &200, &script_hash(&env, "A"),
        &String::from_str(&env, "e"), &sha(&env, "c"),
    );
    arena.accept_duel(&4, &script_hash(&env, "B"), &bob);
    arena.reveal_challenger(&4, &String::from_str(&env, "A"));
    arena.reveal_opponent(&4, &String::from_str(&env, "B"));
    arena.publish_result(&4, &bob);
    env.ledger().with_mut(|l| l.timestamp += 10 * 60 + 1);
    arena.settle(&4);

    let before = token.balance(&bob);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| arena.settle(&4)));
    assert!(r.is_err(), "second settle must panic");
    assert_eq!(token.balance(&bob), before, "no funds moved on replay");
}

#[test]
fn contested_window_requires_consensus() {
    let (env, _admin, alice, bob, arena, token) = setup();
    arena.create_duel(
        &5, &alice, &bob, &150, &script_hash(&env, "A"),
        &String::from_str(&env, "e"), &sha(&env, "c"),
    );
    arena.accept_duel(&5, &script_hash(&env, "B"), &bob);
    arena.reveal_challenger(&5, &String::from_str(&env, "A"));
    arena.reveal_opponent(&5, &String::from_str(&env, "B"));

    arena.publish_result(&5, &alice);   // challenger claims the pot
    arena.publish_result(&5, &bob);     // opponent disputes

    env.ledger().with_mut(|l| l.timestamp += 10 * 60 + 1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| arena.settle(&5)));
    assert!(r.is_err(), "contested pots refuse plain settle");

    arena.resolve_consensus(&5, &bob);
    assert_eq!(token.balance(&bob), 10_150);
}