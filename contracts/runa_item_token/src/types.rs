use soroban_sdk::{contracttype, Address, Symbol};

#[derive(Clone)]
#[contracttype]
pub enum ItemDataKey {
    Admin,
    AuthorizedGameContract,
    Item(Symbol),
    PlayerBalance(Address, Symbol),
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct ItemMetadata {
    pub id: Symbol,
    pub hand: Symbol,
    pub kind: Symbol,
    pub base_price: i128,
    pub min_level: u32,
    pub sac_token: Address,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct InventorySummary {
    pub sword_count: u32,
    pub crossbow_count: u32,
    pub shield_count: u32,
    pub boots_count: u32,
}
