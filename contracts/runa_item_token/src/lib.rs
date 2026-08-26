#![no_std]

pub mod errors;
pub mod types;

#[cfg(test)]
pub mod test;

use runa_common::{InventorySummary, ItemError, ItemMetadata};
use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, Env, Symbol,
};
use types::ItemDataKey;

const INSTANCE_LIFETIME_THRESHOLD: u32 = 100_000;
const INSTANCE_BUMP_AMOUNT: u32 = 200_000;
const PERSISTENT_LIFETIME_THRESHOLD: u32 = 100_000;
const PERSISTENT_BUMP_AMOUNT: u32 = 200_000;

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

fn extend_persistent_ttl(env: &Env, key: &ItemDataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

#[contract]
pub struct RunaItemTokenContract;

#[contractimpl]
impl RunaItemTokenContract {
    /// Initialize item token contract with admin and authorized game contract
    pub fn initialize(
        env: Env,
        admin: Address,
        game_contract: Address,
    ) -> Result<(), ItemError> {
        if env.storage().instance().has(&ItemDataKey::Admin) {
            return Err(ItemError::AlreadyInitialized);
        }

        env.storage().instance().set(&ItemDataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&ItemDataKey::AuthorizedGameContract, &game_contract);

        extend_instance_ttl(&env);
        Ok(())
    }

    /// Register or update item metadata (admin only)
    pub fn register_item(env: Env, metadata: ItemMetadata) -> Result<(), ItemError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ItemDataKey::Admin)
            .ok_or(ItemError::NotInitialized)?;

        admin.require_auth();

        let key = ItemDataKey::Item(metadata.id.clone());
        env.storage().persistent().set(&key, &metadata);
        extend_persistent_ttl(&env, &key);

        env.events().publish(
            (symbol_short!("item"), symbol_short!("reg")),
            metadata.id,
        );

        Ok(())
    }

    /// Query item metadata by symbol ID
    pub fn get_item(env: Env, item_id: Symbol) -> Result<ItemMetadata, ItemError> {
        let key = ItemDataKey::Item(item_id);
        let metadata = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ItemError::ItemNotFound)?;
        extend_persistent_ttl(&env, &key);
        Ok(metadata)
    }

    /// Mint item upon verified game purchase (Issue #2 level & gold gating enforced)
    pub fn mint_item(
        env: Env,
        to: Address,
        item_id: Symbol,
        gold_paid: i128,
        player_level: u32,
    ) -> Result<(), ItemError> {
        if !env.storage().instance().has(&ItemDataKey::Admin) {
            return Err(ItemError::NotInitialized);
        }

        let game_contract: Address = env
            .storage()
            .instance()
            .get(&ItemDataKey::AuthorizedGameContract)
            .ok_or(ItemError::NotInitialized)?;

        game_contract.require_auth();
        to.require_auth();

        // Fetch item metadata
        let key = ItemDataKey::Item(item_id.clone());
        let metadata: ItemMetadata = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ItemError::ItemNotFound)?;

        // Issue #2 Gate: Check level requirement
        if player_level < metadata.min_level {
            return Err(ItemError::LevelRequirementNotMet);
        }

        // Check gold price paid
        if gold_paid < metadata.base_price {
            return Err(ItemError::InsufficientGold);
        }

        // Transfer gold price into the shop before crediting balance
        let token_client = token::Client::new(&env, &metadata.sac_token);
        token_client.transfer(&to, &env.current_contract_address(), &gold_paid);

        // Increment player balance
        let balance_key = ItemDataKey::PlayerBalance(to.clone(), item_id.clone());
        let current_balance: u32 = env
            .storage()
            .persistent()
            .get(&balance_key)
            .unwrap_or(0);
        let new_balance = current_balance.checked_add(1).ok_or(ItemError::InvalidAmount)?;

        env.storage().persistent().set(&balance_key, &new_balance);
        extend_persistent_ttl(&env, &balance_key);

        env.events().publish(
            (symbol_short!("item"), symbol_short!("minted")),
            (to, item_id, gold_paid),
        );

        Ok(())
    }

    /// Burn / sell item back to shop for 50% gold refund
    pub fn burn_item(env: Env, from: Address, item_id: Symbol) -> Result<i128, ItemError> {
        if !env.storage().instance().has(&ItemDataKey::Admin) {
            return Err(ItemError::NotInitialized);
        }

        from.require_auth();

        // Fetch item metadata
        let key = ItemDataKey::Item(item_id.clone());
        let metadata: ItemMetadata = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ItemError::ItemNotFound)?;

        let balance_key = ItemDataKey::PlayerBalance(from.clone(), item_id.clone());
        let current_balance: u32 = env
            .storage()
            .persistent()
            .get(&balance_key)
            .unwrap_or(0);

        if current_balance == 0 {
            return Err(ItemError::InsufficientBalance);
        }

        let new_balance = current_balance - 1;
        env.storage().persistent().set(&balance_key, &new_balance);
        extend_persistent_ttl(&env, &balance_key);

        // Calculate 50% refund payout
        let payout = metadata.base_price / 2;

        let token_client = token::Client::new(&env, &metadata.sac_token);
        token_client.transfer(&env.current_contract_address(), &from, &payout);

        env.events().publish(
            (symbol_short!("item"), symbol_short!("burned")),
            (from, item_id, payout),
        );

        Ok(payout)
    }

    /// Query player balance for a specific item ID
    pub fn get_player_item_balance(env: Env, player: Address, item_id: Symbol) -> u32 {
        let balance_key = ItemDataKey::PlayerBalance(player, item_id);
        env.storage().persistent().get(&balance_key).unwrap_or(0)
    }

    /// Query full player inventory summary across all 4 standard equipment assets
    pub fn get_player_inventory(env: Env, player: Address) -> Result<InventorySummary, ItemError> {
        let sword_sym = Symbol::new(&env, "sword");
        let crossbow_sym = Symbol::new(&env, "crossbow");
        let shield_sym = Symbol::new(&env, "shield");
        let boots_sym = Symbol::new(&env, "boots");

        let sword_count = Self::get_player_item_balance(env.clone(), player.clone(), sword_sym);
        let crossbow_count =
            Self::get_player_item_balance(env.clone(), player.clone(), crossbow_sym);
        let shield_count = Self::get_player_item_balance(env.clone(), player.clone(), shield_sym);
        let boots_count = Self::get_player_item_balance(env.clone(), player, boots_sym);

        Ok(InventorySummary {
            sword_count,
            crossbow_count,
            shield_count,
            boots_count,
        })
    }

    /// Transfer item from one player account to another
    pub fn transfer_item(
        env: Env,
        from: Address,
        to: Address,
        item_id: Symbol,
    ) -> Result<(), ItemError> {
        from.require_auth();

        if from == to {
            return Ok(());
        }

        // Verify item exists
        let item_key = ItemDataKey::Item(item_id.clone());
        if !env.storage().persistent().has(&item_key) {
            return Err(ItemError::ItemNotFound);
        }

        let from_balance_key = ItemDataKey::PlayerBalance(from.clone(), item_id.clone());
        let from_balance: u32 = env
            .storage()
            .persistent()
            .get(&from_balance_key)
            .unwrap_or(0);

        if from_balance == 0 {
            return Err(ItemError::InsufficientBalance);
        }

        let to_balance_key = ItemDataKey::PlayerBalance(to.clone(), item_id.clone());
        let to_balance: u32 = env
            .storage()
            .persistent()
            .get(&to_balance_key)
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&from_balance_key, &(from_balance - 1));
        env.storage()
            .persistent()
            .set(&to_balance_key, &(to_balance + 1));

        extend_persistent_ttl(&env, &from_balance_key);
        extend_persistent_ttl(&env, &to_balance_key);

        env.events().publish(
            (symbol_short!("item"), symbol_short!("transfer")),
            (from, to, item_id),
        );

        Ok(())
    }
}
