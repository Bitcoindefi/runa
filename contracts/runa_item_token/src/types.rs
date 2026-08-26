use soroban_sdk::{contracttype, Address, Symbol};

#[derive(Clone)]
#[contracttype]
pub enum ItemDataKey {
    Admin,
    AuthorizedGameContract,
    Item(Symbol),
    PlayerBalance(Address, Symbol),
}
