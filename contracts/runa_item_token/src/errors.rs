use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ItemError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ItemNotFound = 3,
    LevelRequirementNotMet = 4,
    InsufficientGold = 5,
    InvalidAmount = 6,
    InsufficientBalance = 7,
}
