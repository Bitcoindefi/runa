use soroban_sdk::{contracttype, Symbol};

#[derive(Clone)]
#[contracttype]
pub enum VerifierDataKey {
    Admin,
    VerificationKey(Symbol),
    FallbackMode(Symbol),
}
