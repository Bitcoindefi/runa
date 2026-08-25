#![no_std]

pub mod errors;
pub mod types;

#[cfg(test)]
mod test;

use runa_common::{
    compute_nonce, compute_sha256, derive_seed, DuelError, DuelState, DuelStatus, Groth16Proof,
    ResolutionMode,
};
use soroban_sdk::{
    contract, contractimpl, symbol_short, token, vec, Address, Bytes, BytesN, Env, IntoVal,
    Symbol, Vec,
};
use types::DataKey;

const INSTANCE_LIFETIME_THRESHOLD: u32 = 100_000;
const INSTANCE_BUMP_AMOUNT: u32 = 200_000;
const PERSISTENT_LIFETIME_THRESHOLD: u32 = 100_000;
const PERSISTENT_BUMP_AMOUNT: u32 = 200_000;

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

#[contract]
pub struct RunaDuelContract;

#[contractimpl]
impl RunaDuelContract {
    /// Initialize the contract configuration
    pub fn initialize(
        env: Env,
        admin: Address,
        verifier: Address,
        item_contract: Address,
        fee_recipient: Address,
        fee_bps: u32,
    ) -> Result<(), DuelError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(DuelError::AlreadyInitialized);
        }
        if fee_bps > 5000 {
            // Fee cannot exceed 50%
            return Err(DuelError::InvalidFee);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VerifierContract, &verifier);
        env.storage()
            .instance()
            .set(&DataKey::ItemContract, &item_contract);
        env.storage()
            .instance()
            .set(&DataKey::FeeRecipient, &fee_recipient);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::DuelCount, &0u64);

        extend_instance_ttl(&env);
        Ok(())
    }

    /// Create an asynchronous duel challenge with escrowed wager
    pub fn create_duel(
        env: Env,
        challenger: Address,
        wager_token: Address,
        wager_amount: i128,
        script_hash: BytesN<32>,
        content_hash: BytesN<32>,
        engine_version: u32,
        duration_ledgers: u32,
        reveal_window_ledgers: u32,
    ) -> Result<u64, DuelError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(DuelError::NotInitialized);
        }

        challenger.require_auth();

        if wager_amount <= 0 {
            return Err(DuelError::InvalidWagerAmount);
        }
        if duration_ledgers == 0 || reveal_window_ledgers == 0 {
            return Err(DuelError::InvalidExpiration);
        }

        // Transfer wager from challenger to contract escrow
        let token_client = token::Client::new(&env, &wager_token);
        token_client.transfer(&challenger, &env.current_contract_address(), &wager_amount);

        let mut duel_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DuelCount)
            .unwrap_or(0);
        duel_count += 1;
        env.storage()
            .instance()
            .set(&DataKey::DuelCount, &duel_count);

        let creation_ledger = env.ledger().sequence();
        let expiration_ledger = creation_ledger + duration_ledgers;
        let nonce = compute_nonce(&env, duel_count, &challenger, env.ledger().timestamp());

        let duel = DuelState {
            duel_id: duel_count,
            challenger: challenger.clone(),
            opponent: None,
            wager_token: wager_token.clone(),
            wager_amount,
            challenger_script_hash: script_hash,
            opponent_script_hash: None,
            challenger_script: None,
            opponent_script: None,
            content_hash,
            engine_version,
            seed: 0,
            creation_ledger,
            expiration_ledger,
            reveal_deadline_ledger: 0,
            dispute_deadline_ledger: 0,
            status: DuelStatus::Initiated,
            winner: None,
            resolution_mode: ResolutionMode::CommitReveal,
            nonce,
        };

        let key = DataKey::Duel(duel_count);
        env.storage().persistent().set(&key, &duel);
        env.storage()
            .persistent()
            .set(&DataKey::RevealWindow(duel_count), &reveal_window_ledgers);

        extend_instance_ttl(&env);
        extend_persistent_ttl(&env, &key);

        // Emit duel created event
        env.events().publish(
            (symbol_short!("duel"), symbol_short!("created")),
            (duel_count, challenger, wager_token, wager_amount),
        );

        Ok(duel_count)
    }

    /// Accept an open duel challenge and deposit matching wager
    pub fn accept_duel(
        env: Env,
        opponent: Address,
        duel_id: u64,
        opponent_script_hash: BytesN<32>,
    ) -> Result<(), DuelError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(DuelError::NotInitialized);
        }

        opponent.require_auth();

        let key = DataKey::Duel(duel_id);
        let mut duel: DuelState = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(DuelError::DuelNotFound)?;

        if duel.status != DuelStatus::Initiated {
            return Err(DuelError::DuelNotInitiated);
        }
        if opponent == duel.challenger {
            return Err(DuelError::SelfChallengeForbidden);
        }
        if env.ledger().sequence() >= duel.expiration_ledger {
            return Err(DuelError::DuelExpired);
        }

        // Transfer matching wager from opponent to contract escrow
        let token_client = token::Client::new(&env, &duel.wager_token);
        token_client.transfer(
            &opponent,
            &env.current_contract_address(),
            &duel.wager_amount,
        );

        let reveal_window: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::RevealWindow(duel_id))
            .unwrap_or(100);

        let current_ledger = env.ledger().sequence();
        let seed = derive_seed(&env, duel_id, current_ledger, &duel.challenger);

        duel.opponent = Some(opponent.clone());
        duel.opponent_script_hash = Some(opponent_script_hash);
        duel.seed = seed;
        duel.status = DuelStatus::Accepted;
        duel.reveal_deadline_ledger = current_ledger + reveal_window;

        env.storage().persistent().set(&key, &duel);
        extend_persistent_ttl(&env, &key);

        // Emit duel accepted event
        env.events().publish(
            (symbol_short!("duel"), symbol_short!("accepted")),
            (duel_id, opponent, seed),
        );

        Ok(())
    }

    /// Reveal script text and verify against committed SHA-256 hash
    pub fn reveal_script(
        env: Env,
        caller: Address,
        duel_id: u64,
        script_text: Bytes,
    ) -> Result<(), DuelError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(DuelError::NotInitialized);
        }

        caller.require_auth();

        let key = DataKey::Duel(duel_id);
        let mut duel: DuelState = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(DuelError::DuelNotFound)?;

        if duel.status != DuelStatus::Accepted && duel.status != DuelStatus::Revealed {
            return Err(DuelError::DuelNotAccepted);
        }

        if env.ledger().sequence() > duel.reveal_deadline_ledger {
            return Err(DuelError::RevealWindowClosed);
        }

        let computed_hash = compute_sha256(&env, &script_text);

        if caller == duel.challenger {
            if duel.challenger_script.is_some() {
                return Err(DuelError::AlreadyRevealed);
            }
            if computed_hash != duel.challenger_script_hash {
                return Err(DuelError::ScriptHashMismatch);
            }
            duel.challenger_script = Some(script_text);
        } else if let Some(ref opp) = duel.opponent {
            if caller == *opp {
                if duel.opponent_script.is_some() {
                    return Err(DuelError::AlreadyRevealed);
                }
                let expected_hash = duel
                    .opponent_script_hash
                    .as_ref()
                    .ok_or(DuelError::DuelNotAccepted)?;
                if computed_hash != *expected_hash {
                    return Err(DuelError::ScriptHashMismatch);
                }
                duel.opponent_script = Some(script_text);
            } else {
                return Err(DuelError::InvalidParticipant);
            }
        } else {
            return Err(DuelError::InvalidParticipant);
        }

        if duel.challenger_script.is_some() && duel.opponent_script.is_some() {
            duel.status = DuelStatus::Revealed;
        }

        env.storage().persistent().set(&key, &duel);
        extend_persistent_ttl(&env, &key);

        env.events().publish(
            (symbol_short!("duel"), symbol_short!("revealed")),
            (duel_id, caller),
        );

        Ok(())
    }

    /// Resolve duel optimistically with optional dispute window
    pub fn resolve_duel_optimistic(
        env: Env,
        caller: Address,
        duel_id: u64,
        winner: Address,
        dispute_window_ledgers: u32,
    ) -> Result<(), DuelError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(DuelError::NotInitialized);
        }

        caller.require_auth();

        let key = DataKey::Duel(duel_id);
        let mut duel: DuelState = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(DuelError::DuelNotFound)?;

        if duel.status != DuelStatus::Revealed {
            return Err(DuelError::DuelNotRevealed);
        }

        let is_challenger = winner == duel.challenger;
        let is_opponent = duel.opponent.as_ref().map_or(false, |opp| winner == *opp);
        if !is_challenger && !is_opponent {
            return Err(DuelError::InvalidWinner);
        }

        duel.winner = Some(winner.clone());
        duel.resolution_mode = ResolutionMode::CommitReveal;

        if dispute_window_ledgers == 0 {
            // Immediate final settlement
            duel.status = DuelStatus::Resolved;
            env.storage().persistent().set(&key, &duel);
            extend_persistent_ttl(&env, &key);

            Self::distribute_wagers(&env, &duel, &winner)?;

            env.events().publish(
                (symbol_short!("duel"), symbol_short!("settled")),
                (duel_id, winner, duel.wager_amount * 2),
            );
        } else {
            duel.status = DuelStatus::Disputed;
            duel.dispute_deadline_ledger = env.ledger().sequence() + dispute_window_ledgers;
            env.storage().persistent().set(&key, &duel);
            extend_persistent_ttl(&env, &key);

            env.events().publish(
                (symbol_short!("duel"), symbol_short!("resolved")),
                (duel_id, winner, 0u32),
            );
        }

        Ok(())
    }

    /// Contest optimistic resolution with fraud simulation proof
    pub fn dispute_duel(
        env: Env,
        caller: Address,
        duel_id: u64,
        fraud_proof: Bytes,
    ) -> Result<(), DuelError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(DuelError::NotInitialized);
        }

        caller.require_auth();

        let key = DataKey::Duel(duel_id);
        let mut duel: DuelState = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(DuelError::DuelNotFound)?;

        if duel.status != DuelStatus::Disputed {
            return Err(DuelError::DuelNotDisputed);
        }

        if env.ledger().sequence() > duel.dispute_deadline_ledger {
            return Err(DuelError::DisputeWindowClosed);
        }

        // Ensure caller is participant
        let is_challenger = caller == duel.challenger;
        let is_opponent = duel.opponent.as_ref().map_or(false, |opp| caller == *opp);
        if !is_challenger && !is_opponent {
            return Err(DuelError::InvalidParticipant);
        }

        // Validate non-empty fraud proof
        if fraud_proof.len() == 0 {
            return Err(DuelError::InvalidSimulationProof);
        }

        // Invert current winner to caller or based on fraud proof
        let new_winner = if duel.winner.as_ref() == Some(&duel.challenger) {
            duel.opponent.clone().ok_or(DuelError::InvalidWinner)?
        } else {
            duel.challenger.clone()
        };

        duel.winner = Some(new_winner.clone());
        duel.status = DuelStatus::Resolved;

        env.storage().persistent().set(&key, &duel);
        extend_persistent_ttl(&env, &key);

        Self::distribute_wagers(&env, &duel, &new_winner)?;

        env.events().publish(
            (symbol_short!("duel"), symbol_short!("settled")),
            (duel_id, new_winner, duel.wager_amount * 2),
        );

        Ok(())
    }

    /// Finalize settlement after dispute window closes without challenge
    pub fn finalize_settlement(env: Env, duel_id: u64) -> Result<(), DuelError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(DuelError::NotInitialized);
        }

        let key = DataKey::Duel(duel_id);
        let mut duel: DuelState = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(DuelError::DuelNotFound)?;

        if duel.status != DuelStatus::Disputed {
            return Err(DuelError::DuelNotDisputed);
        }

        if env.ledger().sequence() <= duel.dispute_deadline_ledger {
            return Err(DuelError::DisputeWindowOpen);
        }

        let winner = duel.winner.clone().ok_or(DuelError::InvalidWinner)?;
        duel.status = DuelStatus::Resolved;

        env.storage().persistent().set(&key, &duel);
        extend_persistent_ttl(&env, &key);

        Self::distribute_wagers(&env, &duel, &winner)?;

        env.events().publish(
            (symbol_short!("duel"), symbol_short!("settled")),
            (duel_id, winner, duel.wager_amount * 2),
        );

        Ok(())
    }

    /// Resolve duel using Zero-Knowledge proof of victory
    pub fn resolve_duel_zk(
        env: Env,
        caller: Address,
        duel_id: u64,
        winner: Address,
        proof_data: Bytes,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<(), DuelError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(DuelError::NotInitialized);
        }

        caller.require_auth();

        let key = DataKey::Duel(duel_id);
        let mut duel: DuelState = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(DuelError::DuelNotFound)?;

        if duel.status != DuelStatus::Accepted && duel.status != DuelStatus::Initiated {
            return Err(DuelError::DuelNotAccepted);
        }

        let is_challenger = winner == duel.challenger;
        let is_opponent = duel.opponent.as_ref().map_or(false, |opp| winner == *opp);
        if !is_challenger && !is_opponent {
            return Err(DuelError::InvalidWinner);
        }

        // Format proof: 192 bytes = a (48) + b (96) + c (48)
        if proof_data.len() < 192 {
            return Err(DuelError::ProofVerificationFailed);
        }

        let mut a_bytes = [0u8; 48];
        let mut b_bytes = [0u8; 96];
        let mut c_bytes = [0u8; 48];

        for i in 0..48 {
            a_bytes[i] = proof_data.get(i as u32).unwrap_or(0);
        }
        for i in 0..96 {
            b_bytes[i] = proof_data.get((48 + i) as u32).unwrap_or(0);
        }
        for i in 0..48 {
            c_bytes[i] = proof_data.get((144 + i) as u32).unwrap_or(0);
        }

        let proof = Groth16Proof {
            a: BytesN::from_array(&env, &a_bytes),
            b: BytesN::from_array(&env, &b_bytes),
            c: BytesN::from_array(&env, &c_bytes),
        };

        // Call verifier contract
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::VerifierContract)
            .ok_or(DuelError::NotInitialized)?;

        let circuit_id = Symbol::new(&env, "duel_v1");

        let verified: bool = env.invoke_contract(
            &verifier,
            &Symbol::new(&env, "verify_proof"),
            vec![
                &env,
                circuit_id.into_val(&env),
                proof.into_val(&env),
                public_inputs.into_val(&env),
            ],
        );

        if !verified {
            return Err(DuelError::ProofVerificationFailed);
        }

        duel.winner = Some(winner.clone());
        duel.resolution_mode = ResolutionMode::ZeroKnowledge;
        duel.status = DuelStatus::Resolved;

        env.storage().persistent().set(&key, &duel);
        extend_persistent_ttl(&env, &key);

        Self::distribute_wagers(&env, &duel, &winner)?;

        env.events().publish(
            (symbol_short!("duel"), symbol_short!("settled")),
            (duel_id, winner, duel.wager_amount * 2),
        );

        Ok(())
    }

    /// Cancel unaccepted duel or refund expired/forfeited duels
    pub fn cancel_or_refund(env: Env, caller: Address, duel_id: u64) -> Result<(), DuelError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(DuelError::NotInitialized);
        }

        caller.require_auth();

        let key = DataKey::Duel(duel_id);
        let mut duel: DuelState = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(DuelError::DuelNotFound)?;

        let current_ledger = env.ledger().sequence();
        let token_client = token::Client::new(&env, &duel.wager_token);

        match duel.status {
            DuelStatus::Initiated => {
                if caller != duel.challenger && current_ledger < duel.expiration_ledger {
                    return Err(DuelError::DuelNotExpired);
                }
                duel.status = DuelStatus::Canceled;
                env.storage().persistent().set(&key, &duel);
                extend_persistent_ttl(&env, &key);

                // Refund challenger
                token_client.transfer(
                    &env.current_contract_address(),
                    &duel.challenger,
                    &duel.wager_amount,
                );

                env.events().publish(
                    (symbol_short!("duel"), symbol_short!("refunded")),
                    (duel_id, symbol_short!("canceled")),
                );
                Ok(())
            }
            DuelStatus::Accepted => {
                if current_ledger <= duel.reveal_deadline_ledger {
                    return Err(DuelError::RevealWindowOpen);
                }

                let chal_revealed = duel.challenger_script.is_some();
                let opp_revealed = duel.opponent_script.is_some();
                let opponent = duel.opponent.clone().ok_or(DuelError::DuelNotAccepted)?;

                if chal_revealed && !opp_revealed {
                    // Challenger wins by default
                    duel.winner = Some(duel.challenger.clone());
                    duel.status = DuelStatus::Resolved;
                    env.storage().persistent().set(&key, &duel);
                    extend_persistent_ttl(&env, &key);

                    Self::distribute_wagers(&env, &duel, &duel.challenger.clone())?;
                    env.events().publish(
                        (symbol_short!("duel"), symbol_short!("settled")),
                        (duel_id, duel.challenger.clone(), duel.wager_amount * 2),
                    );
                } else if !chal_revealed && opp_revealed {
                    // Opponent wins by default
                    duel.winner = Some(opponent.clone());
                    duel.status = DuelStatus::Resolved;
                    env.storage().persistent().set(&key, &duel);
                    extend_persistent_ttl(&env, &key);

                    Self::distribute_wagers(&env, &duel, &opponent)?;
                    env.events().publish(
                        (symbol_short!("duel"), symbol_short!("settled")),
                        (duel_id, opponent, duel.wager_amount * 2),
                    );
                } else {
                    // Neither revealed, refund both
                    duel.status = DuelStatus::ExpiredRefunded;
                    env.storage().persistent().set(&key, &duel);
                    extend_persistent_ttl(&env, &key);

                    token_client.transfer(
                        &env.current_contract_address(),
                        &duel.challenger,
                        &duel.wager_amount,
                    );
                    token_client.transfer(
                        &env.current_contract_address(),
                        &opponent,
                        &duel.wager_amount,
                    );

                    env.events().publish(
                        (symbol_short!("duel"), symbol_short!("refunded")),
                        (duel_id, symbol_short!("timeout")),
                    );
                }
                Ok(())
            }
            DuelStatus::Resolved => Err(DuelError::DuelAlreadyResolved),
            DuelStatus::Canceled => Err(DuelError::DuelAlreadyResolved),
            DuelStatus::ExpiredRefunded => Err(DuelError::DuelAlreadyResolved),
            _ => Err(DuelError::Unauthorized),
        }
    }

    /// Read state of a duel
    pub fn get_duel(env: Env, duel_id: u64) -> Result<DuelState, DuelError> {
        let key = DataKey::Duel(duel_id);
        let duel = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(DuelError::DuelNotFound)?;
        extend_persistent_ttl(&env, &key);
        Ok(duel)
    }

    /// Helper to distribute wagers with protocol fee deduction
    fn distribute_wagers(env: &Env, duel: &DuelState, winner: &Address) -> Result<(), DuelError> {
        let total_pot = duel.wager_amount * 2;
        let fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or(0);
        let fee_recipient: Address = env
            .storage()
            .instance()
            .get(&DataKey::FeeRecipient)
            .unwrap_or_else(|| duel.challenger.clone());

        let fee = if fee_bps > 0 {
            (total_pot * (fee_bps as i128)) / 10_000
        } else {
            0
        };
        let payout = total_pot - fee;

        let token_client = token::Client::new(env, &duel.wager_token);
        if fee > 0 {
            token_client.transfer(&env.current_contract_address(), &fee_recipient, &fee);
        }
        token_client.transfer(&env.current_contract_address(), winner, &payout);

        Ok(())
    }
}
