#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol};

struct TestSetup {
    env: Env,
    admin: Address,
    game_contract: Address,
    player: Address,
    recipient: Address,
    contract_id: Address,
    token_client: token::Client<'static>,
    client: RunaItemTokenContractClient<'static>,
}

fn setup_test() -> TestSetup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let game_contract = Address::generate(&env);
    let player = Address::generate(&env);
    let recipient = Address::generate(&env);

    let contract_id = env.register(RunaItemTokenContract, ());
    let client = RunaItemTokenContractClient::new(&env, &contract_id);

    client.initialize(&admin, &game_contract);

    // Register token SAC and mint test gold
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_contract.address());
    let token_client = token::Client::new(&env, &token_contract.address());
    token_admin_client.mint(&player, &1_000_000_000);
    token_admin_client.mint(&recipient, &1_000_000_000);

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

    TestSetup {
        env,
        admin,
        game_contract,
        player,
        recipient,
        contract_id,
        token_client,
        client,
    }
}

#[test]
fn test_initialize_and_double_init() {
    let setup = setup_test();
    let res = setup
        .client
        .try_initialize(&setup.admin, &setup.game_contract);
    assert!(res.is_err());
}

#[test]
fn test_get_item_metadata() {
    let setup = setup_test();
    let sword = setup.client.get_item(&Symbol::new(&setup.env, "sword"));
    assert_eq!(sword.base_price, 25);
    assert_eq!(sword.min_level, 1);

    let crossbow = setup.client.get_item(&Symbol::new(&setup.env, "crossbow"));
    assert_eq!(crossbow.base_price, 60);
    assert_eq!(crossbow.min_level, 2);
}

#[test]
fn test_mint_item_happy_path() {
    let setup = setup_test();
    let sword_sym = Symbol::new(&setup.env, "sword");

    assert_eq!(setup.token_client.balance(&setup.player), 1_000_000_000);
    assert_eq!(setup.token_client.balance(&setup.contract_id), 0);

    setup
        .client
        .mint_item(&setup.player, &sword_sym, &25, &1);

    assert_eq!(setup.token_client.balance(&setup.player), 999_999_975);
    assert_eq!(setup.token_client.balance(&setup.contract_id), 25);

    let balance = setup
        .client
        .get_player_item_balance(&setup.player, &sword_sym);
    assert_eq!(balance, 1);

    let inventory = setup.client.get_player_inventory(&setup.player);
    assert_eq!(inventory.sword_count, 1);
    assert_eq!(inventory.crossbow_count, 0);
    assert_eq!(inventory.shield_count, 0);
    assert_eq!(inventory.boots_count, 0);
}

#[test]
fn test_mint_item_level_gate_rejection_issue_2_fix() {
    let setup = setup_test();
    let crossbow_sym = Symbol::new(&setup.env, "crossbow");

    // Level 1 player attempts to purchase level 2 crossbow with full gold -> MUST FAIL
    let res = setup
        .client
        .try_mint_item(&setup.player, &crossbow_sym, &60, &1);
    assert!(res.is_err());

    // Boots require level 2 -> level 1 player fails
    let boots_sym = Symbol::new(&setup.env, "boots");
    let boots_res = setup
        .client
        .try_mint_item(&setup.player, &boots_sym, &45, &1);
    assert!(boots_res.is_err());

    // Once player reaches level 2 -> succeeds
    setup
        .client
        .mint_item(&setup.player, &crossbow_sym, &60, &2);
    let balance = setup
        .client
        .get_player_item_balance(&setup.player, &crossbow_sym);
    assert_eq!(balance, 1);
}

#[test]
fn test_mint_item_insufficient_gold_fails() {
    let setup = setup_test();
    let shield_sym = Symbol::new(&setup.env, "shield");

    // Shield costs 30g, paying only 20g fails
    let res = setup
        .client
        .try_mint_item(&setup.player, &shield_sym, &20, &1);
    assert!(res.is_err());
}

#[test]
fn test_burn_item_and_50_percent_refund() {
    let setup = setup_test();
    let sword_sym = Symbol::new(&setup.env, "sword");
    let crossbow_sym = Symbol::new(&setup.env, "crossbow");

    // Mint sword (25g) and crossbow (60g)
    setup
        .client
        .mint_item(&setup.player, &sword_sym, &25, &1);
    setup
        .client
        .mint_item(&setup.player, &crossbow_sym, &60, &2);

    assert_eq!(setup.token_client.balance(&setup.contract_id), 85);
    assert_eq!(setup.token_client.balance(&setup.player), 999_999_915);

    // Burn sword -> 50% refund = 25 / 2 = 12g
    let sword_refund = setup.client.burn_item(&setup.player, &sword_sym);
    assert_eq!(sword_refund, 12);
    assert_eq!(setup.token_client.balance(&setup.contract_id), 73);
    assert_eq!(setup.token_client.balance(&setup.player), 999_999_927);
    assert_eq!(
        setup
            .client
            .get_player_item_balance(&setup.player, &sword_sym),
        0
    );

    // Burn crossbow -> 50% refund = 60 / 2 = 30g
    let crossbow_refund = setup.client.burn_item(&setup.player, &crossbow_sym);
    assert_eq!(crossbow_refund, 30);
    assert_eq!(setup.token_client.balance(&setup.contract_id), 43);
    assert_eq!(setup.token_client.balance(&setup.player), 999_999_957);
    assert_eq!(
        setup
            .client
            .get_player_item_balance(&setup.player, &crossbow_sym),
        0
    );
}

#[test]
fn test_burn_item_insufficient_balance_fails() {
    let setup = setup_test();
    let boots_sym = Symbol::new(&setup.env, "boots");

    let res = setup.client.try_burn_item(&setup.player, &boots_sym);
    assert!(res.is_err());
}

#[test]
fn test_inventory_summary_all_items() {
    let setup = setup_test();
    let sword_sym = Symbol::new(&setup.env, "sword");
    let crossbow_sym = Symbol::new(&setup.env, "crossbow");
    let shield_sym = Symbol::new(&setup.env, "shield");
    let boots_sym = Symbol::new(&setup.env, "boots");

    setup
        .client
        .mint_item(&setup.player, &sword_sym, &25, &1);
    setup
        .client
        .mint_item(&setup.player, &sword_sym, &25, &1);
    setup
        .client
        .mint_item(&setup.player, &crossbow_sym, &60, &2);
    setup
        .client
        .mint_item(&setup.player, &shield_sym, &30, &1);
    setup
        .client
        .mint_item(&setup.player, &boots_sym, &45, &2);

    let inventory = setup.client.get_player_inventory(&setup.player);
    assert_eq!(inventory.sword_count, 2);
    assert_eq!(inventory.crossbow_count, 1);
    assert_eq!(inventory.shield_count, 1);
    assert_eq!(inventory.boots_count, 1);
}

#[test]
fn test_transfer_item() {
    let setup = setup_test();
    let shield_sym = Symbol::new(&setup.env, "shield");

    setup
        .client
        .mint_item(&setup.player, &shield_sym, &30, &1);

    setup
        .client
        .transfer_item(&setup.player, &setup.recipient, &shield_sym);

    assert_eq!(
        setup
            .client
            .get_player_item_balance(&setup.player, &shield_sym),
        0
    );
    assert_eq!(
        setup
            .client
            .get_player_item_balance(&setup.recipient, &shield_sym),
        1
    );

    // Transferring without balance fails
    let fail_res = setup
        .client
        .try_transfer_item(&setup.player, &setup.recipient, &shield_sym);
    assert!(fail_res.is_err());
}
