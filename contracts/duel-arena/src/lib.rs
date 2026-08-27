#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, Map, String, Symbol,
};

#[contract]
pub struct DuelArena;

/// One asynchronous duel, keyed by a caller-chosen nonce so the same duel can
/// never be funded or settled twice.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Duel {
    pub challenger: Address,
    pub opponent: Address,
    pub stake: i128,
    pub script_hash_c: BytesN<32>,
    pub script_hash_o: Option<BytesN<32>>,
    /// Common seed fixed by the ledger once both sides committed: neither
    /// player controls it, which is what makes the replay trustworthy (#13).
    pub seed: Option<u32>,
    pub engine_version: String,
    pub content_hash: BytesN<32>,
    pub reveal_deadline: u64,
    pub settle_deadline: Option<u64>,
    pub revealed_c: Option<String>,
    pub revealed_o: Option<String>,
    pub claim: Option<Address>,
    pub contested: bool,
    pub settled: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    NoSuchDuel = 1,
    NonceTaken = 2,
    WrongPhase = 3,
    NotParticipant = 4,
    HashMismatch = 5,
    DeadlineNotReached = 6,
    AlreadySettled = 7,
    ContestedNeedsConsensus = 8,
    BadWinner = 9,
}

const DUELS: Symbol = symbol_short!("DUELS");
const TOKEN: Symbol = symbol_short!("TOKEN");
/// How long the opponent has to reveal after both deposits are in (seconds).
const REVEAL_WINDOW: u64 = 60 * 60;
/// Dispute window after a result is published before anyone may settle it.
const DISPUTE_WINDOW: u64 = 10 * 60;

fn duels(env: &Env) -> Map<u64, Duel> {
    env.storage()
        .persistent()
        .get(&DUELS)
        .unwrap_or_else(|| Map::new(env))
}

fn save(env: &Env, nonce: &u64, duel: &Duel) {
    let mut m = duels(env);
    m.set(*nonce, duel.clone());
    env.storage().persistent().set(&DUELS, &m);
}

fn get(env: &Env, nonce: &u64) -> Duel {
    duels(env)
        .get(*nonce)
        .unwrap_or_else(|| panic_with_error!(env, Error::NoSuchDuel))
}

fn payout(env: &Env, token: &Address, to: &Address, amount: i128) {
    let client = soroban_sdk::token::Client::new(env, token);
    client.transfer(&env.current_contract_address(), to, &amount);
}

#[contractimpl]
impl DuelArena {
    pub fn __constructor(env: &Env, token: Address) {
        env.storage().instance().set(&TOKEN, &token);
    }

    fn token(env: &Env) -> Address {
        env.storage().instance().get(&TOKEN).unwrap()
    }

    /// Phase 1: challenge. Deposits the stake and commits the script hash
    /// BEFORE anyone sees anything - that is the whole point of commit-reveal.
    /// The invoker is the funding challenger; their signature authorizes the
    /// stake transfer out of their token balance.
    pub fn create_duel(
        env: &Env,
        nonce: u64,
        challenger: Address,
        opponent: Address,
        stake: i128,
        script_hash: BytesN<32>,
        engine_version: String,
        content_hash: BytesN<32>,
    ) {
        if duels(env).contains_key(nonce) {
            panic_with_error!(env, Error::NonceTaken);
        }
        challenger.require_auth();
        let now = env.ledger().timestamp();
        let duel = Duel {
            challenger,
            opponent,
            stake,
            script_hash_c: script_hash,
            script_hash_o: None,
            seed: None,
            engine_version,
            content_hash,
            reveal_deadline: now + REVEAL_WINDOW,
            settle_deadline: None,
            revealed_c: None,
            revealed_o: None,
            claim: None,
            contested: false,
            settled: false,
        };
        save(env, &nonce, &duel);
        let t = Self::token(env);
        let c = soroban_sdk::token::Client::new(env, &t);
        c.transfer(&duel.challenger, &env.current_contract_address(), &stake);
    }

    /// Phase 1b: accept. Second deposit plus second commitment; the ledger
    /// sequence becomes the shared seed at this moment.
    pub fn accept_duel(env: &Env, nonce: u64, script_hash: BytesN<32>, from: Address) {
        from.require_auth();
        let mut d = get(env, &nonce);
        if d.script_hash_o.is_some() || d.seed.is_some() {
            panic_with_error!(env, Error::WrongPhase);
        }
        if from != d.opponent {
            panic_with_error!(env, Error::NotParticipant);
        }
        let t = Self::token(env);
        let c = soroban_sdk::token::Client::new(env, &t);
        c.transfer(&from, &env.current_contract_address(), &d.stake);
        d.script_hash_o = Some(script_hash);
        d.seed = Some(env.ledger().sequence() as u32);
        d.reveal_deadline = env.ledger().timestamp() + REVEAL_WINDOW;
        save(env, &nonce, &d);
    }

    /// Phase 2: reveal. The plaintext script must hash to the commitment.
    fn do_reveal(env: &Env, nonce: &u64, who: Address, script: String) {
        let mut d = get(env, nonce);
        if d.settled || d.claim.is_some() {
            panic_with_error!(env, Error::WrongPhase);
        }
        if env.ledger().timestamp() > d.reveal_deadline {
            panic_with_error!(env, Error::DeadlineNotReached);
        }
        let digest = env.crypto().sha256(&script.clone().to_bytes());
        let is_challenger = who == d.challenger;
        if !is_challenger && who != d.opponent {
            panic_with_error!(env, Error::NotParticipant);
        }
        let expected = if is_challenger {
            d.script_hash_c.clone()
        } else {
            match d.script_hash_o {
                Some(ref h) => h.clone(),
                None => panic_with_error!(env, Error::WrongPhase),
            }
        };
        if digest.to_bytes() != expected {
            panic_with_error!(env, Error::HashMismatch);
        }
        if is_challenger {
            if d.revealed_c.is_none() {
                d.revealed_c = Some(script);
            }
        } else if d.revealed_o.is_none() {
            d.revealed_o = Some(script);
        }
        if d.revealed_c.is_some() && d.revealed_o.is_some() && d.settle_deadline.is_none() {
            d.settle_deadline = Some(env.ledger().timestamp() + DISPUTE_WINDOW);
        }
        save(env, nonce, &d);
    }

    pub fn reveal_challenger(env: &Env, nonce: u64, script: String) {
        let d = get(env, &nonce);
        Self::do_reveal(env, &nonce, d.challenger, script);
    }

    pub fn reveal_opponent(env: &Env, nonce: u64, script: String) {
        let d = get(env, &nonce);
        Self::do_reveal(env, &nonce, d.opponent, script);
    }

    /// Phase 3: publish a result claim. The counterpart may dispute during
    /// the window by claiming the opposite winner; a contested pot then needs
    /// resolve_consensus instead of a plain settle.
    pub fn publish_result(env: &Env, nonce: u64, winner: Address) {
        let mut d = get(env, &nonce);
        if d.settled {
            panic_with_error!(env, Error::AlreadySettled);
        }
        if d.settle_deadline.is_none() {
            panic_with_error!(env, Error::WrongPhase);
        }
        if winner != d.challenger && winner != d.opponent {
            panic_with_error!(env, Error::BadWinner);
        }
        // A result claim is not an oracle: a player may only claim their own
        // victory. Without this auth any unrelated account could front-run a
        // duel, publish a winner and let the false claim settle uncontested.
        winner.require_auth();
        if let Some(prev) = &d.claim {
            if *prev != winner {
                d.contested = true;
            }
        } else {
            d.claim = Some(winner);
        }
        save(env, &nonce, &d);
    }

    /// Both participants agree out of band: settles immediately even if the
    /// public window got contested.
    pub fn resolve_consensus(env: &Env, nonce: u64, winner: Address) {
        let mut d = get(env, &nonce);
        if d.settled {
            panic_with_error!(env, Error::AlreadySettled);
        }
        d.challenger.require_auth();
        d.opponent.require_auth();
        if winner != d.challenger && winner != d.opponent {
            panic_with_error!(env, Error::BadWinner);
        }
        let pot = d.stake * 2;
        d.settled = true;
        save(env, &nonce, &d);
        let t = Self::token(env);
        payout(env, &t, &winner, pot);
    }

    /// Phase 4: settle an uncontested result once its window has passed.
    pub fn settle(env: &Env, nonce: u64) {
        let mut d = get(env, &nonce);
        if d.settled {
            panic_with_error!(env, Error::AlreadySettled);
        }
        let deadline = match d.settle_deadline {
            Some(x) => x,
            None => panic_with_error!(env, Error::WrongPhase),
        };
        if env.ledger().timestamp() <= deadline {
            panic_with_error!(env, Error::DeadlineNotReached);
        }
        if d.contested || d.claim.is_none() {
            panic_with_error!(env, Error::ContestedNeedsConsensus);
        }
        let pot = d.stake * 2;
        let winner = d.claim.clone().unwrap();
        d.settled = true;
        save(env, &nonce, &d);
        let t = Self::token(env);
        payout(env, &t, &winner, pot);
    }

    /// The ugly path: the rival never revealed. Everyone takes their own
    /// stake back and the duel closes - stonewalling profits nobody.
    pub fn refund_no_show(env: &Env, nonce: u64) {
        let mut d = get(env, &nonce);
        if d.settled {
            panic_with_error!(env, Error::AlreadySettled);
        }
        if env.ledger().timestamp() <= d.reveal_deadline {
            panic_with_error!(env, Error::DeadlineNotReached);
        }
        if d.revealed_o.is_some() && d.revealed_c.is_some() {
            panic_with_error!(env, Error::WrongPhase);
        }
        let t = Self::token(env);
        payout(env, &t, &d.challenger, d.stake);
        if d.script_hash_o.is_some() {
            payout(env, &t, &d.opponent, d.stake);
        }
        d.settled = true;
        save(env, &nonce, &d);
    }

    /// Read helper for front ends and verifiers.
    pub fn duel(env: &Env, nonce: u64) -> Duel {
        get(env, &nonce)
    }
}
#[cfg(test)]
mod test;
