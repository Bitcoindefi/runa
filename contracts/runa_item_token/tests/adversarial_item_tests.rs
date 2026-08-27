#![cfg(test)]

use runa_item_token::types::ItemMetadata;
use runa_item_token::{RunaItemTokenContract, RunaItemTokenContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, Symbol};

struct ItemSetup {
    env: Env,
    _admin: Address,
    _game_contract: Address,
    player1: Address,
    player2: Address,
    client: RunaItemTokenContractClient<'static>,
}

fn setup_items() -> ItemSetup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let game_contract = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    let contract_id = env.register(RunaItemTokenContract, ());
    let client = RunaItemTokenContractClient::new(&env, &contract_id);
    client.initialize(&admin, &game_contract);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_contract.address());
    token_admin_client.mint(&player1, &1_000_000_000);
    token_admin_client.mint(&player2, &1_000_000_000);

    let dummy_sac = token_contract.address();

    // sword: base_price = 25, min_level = 1
    client.register_item(&ItemMetadata {
        id: Symbol::new(&env, "sword"),
        hand: Symbol::new(&env, "left"),
        kind: Symbol::new(&env, "weapon"),
        base_price: 25,
        min_level: 1,
        sac_token: dummy_sac.clone(),
    });

    // crossbow: base_price = 60, min_level = 2
    client.register_item(&ItemMetadata {
        id: Symbol::new(&env, "crossbow"),
        hand: Symbol::new(&env, "left"),
        kind: Symbol::new(&env, "weapon"),
        base_price: 60,
        min_level: 2,
        sac_token: dummy_sac.clone(),
    });

    // shield: base_price = 30, min_level = 1
    client.register_item(&ItemMetadata {
        id: Symbol::new(&env, "shield"),
        hand: Symbol::new(&env, "right"),
        kind: Symbol::new(&env, "armor"),
        base_price: 30,
        min_level: 1,
        sac_token: dummy_sac.clone(),
    });

    // boots: base_price = 45, min_level = 2
    client.register_item(&ItemMetadata {
        id: Symbol::new(&env, "boots"),
        hand: Symbol::new(&env, "right"),
        kind: Symbol::new(&env, "armor"),
        base_price: 45,
        min_level: 2,
        sac_token: dummy_sac,
    });

    ItemSetup {
        env,
        _admin: admin,
        _game_contract: game_contract,
        player1,
        player2,
        client,
    }
}

#[test]
fn test_challenge4_all_items_level_gating_adversarial_matrix() {
    let setup = setup_items();

    let items = [
        (Symbol::new(&setup.env, "sword"), 25i128, 1u32),
        (Symbol::new(&setup.env, "crossbow"), 60i128, 2u32),
        (Symbol::new(&setup.env, "shield"), 30i128, 1u32),
        (Symbol::new(&setup.env, "boots"), 45i128, 2u32),
    ];

    for (item_sym, price, min_level) in items.iter() {
        // Test levels 0 up to min_level - 1 -> all must fail with LevelRequirementNotMet
        for lvl in 0..*min_level {
            // Even if paying 10x the gold price, level requirement must block purchase
            let res = setup
                .client
                .try_mint_item(&setup.player1, item_sym, &(price * 10), &lvl);
            assert!(
                res.is_err(),
                "Item {:?} must be rejected for player level {} (min_level {})",
                item_sym,
                lvl,
                min_level
            );
        }

        // Test at min_level -> succeeds
        let res = setup
            .client
            .try_mint_item(&setup.player1, item_sym, price, min_level);
        assert!(
            res.is_ok(),
            "Item {:?} should succeed for level {}",
            item_sym,
            min_level
        );
    }
}

#[test]
fn test_challenge4_gold_price_underpayment_stress() {
    let setup = setup_items();

    let items = [
        (Symbol::new(&setup.env, "sword"), 25i128, 1u32),
        (Symbol::new(&setup.env, "crossbow"), 60i128, 2u32),
        (Symbol::new(&setup.env, "shield"), 30i128, 1u32),
        (Symbol::new(&setup.env, "boots"), 45i128, 2u32),
    ];

    for (item_sym, price, min_level) in items.iter() {
        // Underpay by 1 gold
        let res1 = setup
            .client
            .try_mint_item(&setup.player1, item_sym, &(price - 1), min_level);
        assert!(res1.is_err(), "Paying price - 1 must fail");

        // Pay 0 gold
        let res2 = setup
            .client
            .try_mint_item(&setup.player1, item_sym, &0, min_level);
        assert!(res2.is_err(), "Paying 0 gold must fail");

        // Pay negative gold
        let res3 = setup
            .client
            .try_mint_item(&setup.player1, item_sym, &-50, min_level);
        assert!(res3.is_err(), "Paying negative gold must fail");
    }
}

#[test]
fn test_challenge4_burn_refund_exact_arithmetic_and_double_burn() {
    let setup = setup_items();

    let items = [
        (Symbol::new(&setup.env, "sword"), 25i128, 1u32, 12i128),
        (Symbol::new(&setup.env, "crossbow"), 60i128, 2u32, 30i128),
        (Symbol::new(&setup.env, "shield"), 30i128, 1u32, 15i128),
        (Symbol::new(&setup.env, "boots"), 45i128, 2u32, 22i128),
    ];

    for (item_sym, price, min_level, expected_refund) in items.iter() {
        // Mint 1 item
        setup
            .client
            .mint_item(&setup.player1, item_sym, price, min_level);

        // Burn item -> verify refund
        let refund = setup.client.burn_item(&setup.player1, item_sym);
        assert_eq!(
            refund, *expected_refund,
            "Refund for {:?} must equal {}",
            item_sym, expected_refund
        );

        // Attempt second burn when balance is 0 -> MUST FAIL
        let fail_res = setup.client.try_burn_item(&setup.player1, item_sym);
        assert!(
            fail_res.is_err(),
            "Second burn of {:?} must fail due to InsufficientBalance",
            item_sym
        );
    }
}

#[test]
fn test_challenge4_transfer_drain_and_double_spend() {
    let setup = setup_items();
    let sword_sym = Symbol::new(&setup.env, "sword");

    // Mint 1 sword for player1
    setup
        .client
        .mint_item(&setup.player1, &sword_sym, &25, &1);

    // Transfer from player1 to player2
    setup
        .client
        .transfer_item(&setup.player1, &setup.player2, &sword_sym);
    assert_eq!(
        setup
            .client
            .get_player_item_balance(&setup.player1, &sword_sym),
        0
    );
    assert_eq!(
        setup
            .client
            .get_player_item_balance(&setup.player2, &sword_sym),
        1
    );

    // Player 1 attempts double spend transfer
    let res = setup
        .client
        .try_transfer_item(&setup.player1, &setup.player2, &sword_sym);
    assert!(res.is_err(), "Double spend transfer must fail");

    // Player 1 attempts burn on transferred item
    let burn_res = setup.client.try_burn_item(&setup.player1, &sword_sym);
    assert!(burn_res.is_err(), "Burning transferred item must fail");

    // Player 2 transfers to self -> balance stays 1
    setup
        .client
        .transfer_item(&setup.player2, &setup.player2, &sword_sym);
    assert_eq!(
        setup
            .client
            .get_player_item_balance(&setup.player2, &sword_sym),
        1
    );
}

#[test]
fn test_challenge4_inventory_summary_invariants() {
    let setup = setup_items();
    let sword_sym = Symbol::new(&setup.env, "sword");
    let crossbow_sym = Symbol::new(&setup.env, "crossbow");
    let shield_sym = Symbol::new(&setup.env, "shield");
    let boots_sym = Symbol::new(&setup.env, "boots");

    // Mint multi items
    setup.client.mint_item(&setup.player1, &sword_sym, &25, &1);
    setup.client.mint_item(&setup.player1, &sword_sym, &25, &1);
    setup.client.mint_item(&setup.player1, &crossbow_sym, &60, &2);
    setup.client.mint_item(&setup.player1, &shield_sym, &30, &1);
    setup.client.mint_item(&setup.player1, &boots_sym, &45, &2);

    let inv = setup.client.get_player_inventory(&setup.player1);
    assert_eq!(inv.sword_count, 2);
    assert_eq!(inv.crossbow_count, 1);
    assert_eq!(inv.shield_count, 1);
    assert_eq!(inv.boots_count, 1);

    // Burn 1 sword
    setup.client.burn_item(&setup.player1, &sword_sym);
    let inv2 = setup.client.get_player_inventory(&setup.player1);
    assert_eq!(inv2.sword_count, 1);

    // Transfer 1 crossbow to player2
    setup
        .client
        .transfer_item(&setup.player1, &setup.player2, &crossbow_sym);
    let inv3 = setup.client.get_player_inventory(&setup.player1);
    assert_eq!(inv3.crossbow_count, 0);

    let inv_p2 = setup.client.get_player_inventory(&setup.player2);
    assert_eq!(inv_p2.crossbow_count, 1);
}
