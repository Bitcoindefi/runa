use soroban_sdk::contracttype;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    DuelCount,
    Duel(u64),
    VerifierContract,
    ItemContract,
    FeeRecipient,
    FeeBps,
    RevealWindow(u64),
}
