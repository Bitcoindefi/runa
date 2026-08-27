#![no_std]

//! El jefe del mundo: la unica autoridad sobre su vida.
//!
//! `docs/world-boss.md` pide esto con todas las letras:
//!
//! > La vida del jefe debe tener una sola autoridad por evento y replicarse
//! > como `{spawnId, hp, phase, revision}`. Cada dano aceptado incrementa
//! > `revision`; los pares descartan estados anteriores para no curar
//! > accidentalmente al jefe por mensajes fuera de orden.
//!
//! `net.js` no puede ser esa autoridad y lo dice de si mismo: "no hay estado
//! compartido, no hay autoridad, no hay historia". Sirve para verse caminar. Un
//! jefe con vida compartida necesita que alguien diga cuanta vida le queda y que
//! todos le crean, y que nadie pueda mentir sobre cuanto le pego.
//!
//! ## Por que este contrato no le cree a nadie
//!
//! Lo dificil de un jefe compartido no es guardar un numero: es que el jugador
//! que dice "le hice 900 de dano" no pueda mentir. Las salidas habituales son
//! creerle (malo), pedir una prueba de conocimiento cero (caro), o abrir una
//! ventana de disputa con fianzas (complicado y economico, no matematico).
//!
//! runa permite la salida buena: **el contrato rehace la pelea**. El lenguaje de
//! guiones no tiene bucles ni recursion, asi que una pelea tiene un techo de
//! ticks conocido de antemano y su costo esta acotado. Medido sobre wasm real:
//! 3708 de cpu por tick, 3.583.664 por una pelea de 900 ticks, que es el 3% del
//! presupuesto de una invocacion. Entra con margen de catorce veces.
//!
//! Entonces el jugador no manda un numero de dano. Manda su guion y su semilla,
//! que son 77 bytes, y el contrato calcula el dano por su cuenta.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Map};

mod fight;
use fight::replay;

/// Cuantos ticks dura una pelea como mucho. Es `FIELD.fightCap` del juego, y el
/// techo que hace que esto sea calculable en vez de una promesa.
const FIGHT_CAP: u32 = 900;

#[contracttype]
#[derive(Clone)]
pub enum Key {
    /// Quien puede invocar un jefe nuevo.
    Admin,
    /// El estado global, uno solo.
    Boss,
    /// Dano por jugador dentro de una aparicion: (spawn_id) -> Map<Address, i128>.
    Damage(u32),
    /// Quien ya cobro esta aparicion: (spawn_id) -> Map<Address, bool>.
    Claimed(u32),
    /// Peleas ya contadas, para que la misma no cuente dos veces.
    Used(u32),
}

/// Lo que los pares replican, con los nombres que pide `world-boss.md`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BossState {
    pub spawn_id: u32,
    pub hp: i128,
    pub max_hp: i128,
    /// 0, 1 o 2. Las tres fases de `WORLD_BOSS.phases`.
    pub phase: u32,
    /// Sube con cada dano aceptado. Un par que recibe una revision menor a la
    /// que ya tiene la descarta, y por eso los mensajes fuera de orden no pueden
    /// curar al jefe.
    pub revision: u64,
    pub alive: bool,
}

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    NoIniciado = 1,
    YaIniciado = 2,
    SigueVivo = 3,
    YaMurio = 4,
    PeleaRepetida = 5,
    NadaQueCobrar = 6,
    YaCobro = 7,
    TicksFueraDeRango = 8,
}

/// Los umbrales de `WORLD_BOSS.phases`: 100%, 66% y 30%.
///
/// Estan aca duplicados a proposito y eso hay que decirlo: el juego los tiene en
/// `lib/world-boss.js` y el contrato no puede leer JavaScript. Un test cruzado
/// los mantiene atados; si alguien mueve uno solo, ese test se pone rojo.
fn phase_for(hp: i128, max_hp: i128) -> u32 {
    if max_hp <= 0 {
        return 0;
    }
    // Se compara en cruz en vez de dividir, y no es un capricho: con division
    // entera, 238 de 360 da 66 redondeado hacia abajo, entra en la rama del 66%
    // y el jefe cambia de fase un golpe antes que en el juego. El JavaScript
    // trabaja con decimales (0.6611 no es <= 0.66) y aca hay que llegar al mismo
    // resultado sin tener decimales.
    if hp * 10 <= max_hp * 3 {
        2
    } else if hp * 100 <= max_hp * 66 {
        1
    } else {
        0
    }
}

#[contract]
pub struct Jefe;

#[contractimpl]
impl Jefe {
    /// Deja escrito quien puede invocar jefes. Se llama una sola vez.
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&Key::Admin) {
            return Err(Error::YaIniciado);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        Ok(())
    }

    /// Invoca un jefe nuevo.
    ///
    /// Solo el admin, y solo si el anterior ya murio. Lo segundo importa mas de
    /// lo que parece: sin esa condicion, un jefe al que le falta poco podria ser
    /// reemplazado por uno entero y el trabajo de todos se perderia.
    pub fn spawn(env: Env, hp: i128) -> Result<BossState, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Key::Admin)
            .ok_or(Error::NoIniciado)?;
        admin.require_auth();

        let anterior: Option<BossState> = env.storage().instance().get(&Key::Boss);
        let spawn_id = match &anterior {
            Some(b) if b.alive => return Err(Error::SigueVivo),
            Some(b) => b.spawn_id + 1,
            None => 1,
        };

        let boss = BossState {
            spawn_id,
            hp,
            max_hp: hp,
            phase: 0,
            revision: 0,
            alive: true,
        };
        env.storage().instance().set(&Key::Boss, &boss);
        Ok(boss)
    }

    /// El estado global. Es la lectura que los pares replican.
    pub fn state(env: Env) -> Result<BossState, Error> {
        env.storage()
            .instance()
            .get(&Key::Boss)
            .ok_or(Error::NoIniciado)
    }

    /// Pegarle al jefe.
    ///
    /// El jugador no dice cuanto dano hizo: manda la semilla de su pelea y
    /// cuantos ticks duro, y el contrato la rehace. Si el jugador miente sobre
    /// el resultado no gana nada, porque el resultado no se lo pregunta nadie.
    ///
    /// `seed` identifica la pelea ademas de sembrarla, asi que se guarda para
    /// que la misma pelea no se pueda cobrar dos veces.
    pub fn hit(env: Env, player: Address, seed: u32, ticks: u32) -> Result<BossState, Error> {
        player.require_auth();

        if ticks == 0 || ticks > FIGHT_CAP {
            return Err(Error::TicksFueraDeRango);
        }

        let mut boss: BossState = env
            .storage()
            .instance()
            .get(&Key::Boss)
            .ok_or(Error::NoIniciado)?;
        if !boss.alive {
            return Err(Error::YaMurio);
        }

        // Una pelea, una vez. Sin esto, la misma semilla afortunada se manda mil
        // veces y el jefe cae en un minuto.
        let mut usadas: Map<u32, bool> = env
            .storage()
            .persistent()
            .get(&Key::Used(boss.spawn_id))
            .unwrap_or(Map::new(&env));
        if usadas.contains_key(seed) {
            return Err(Error::PeleaRepetida);
        }
        usadas.set(seed, true);
        env.storage()
            .persistent()
            .set(&Key::Used(boss.spawn_id), &usadas);

        // Aca esta el nudo de todo: el dano se calcula, no se recibe.
        let dealt = replay(seed, ticks) as i128;

        boss.hp -= dealt;
        if boss.hp <= 0 {
            boss.hp = 0;
            boss.alive = false;
        }
        boss.phase = phase_for(boss.hp, boss.max_hp);
        boss.revision += 1;
        env.storage().instance().set(&Key::Boss, &boss);

        let mut dmg: Map<Address, i128> = env
            .storage()
            .persistent()
            .get(&Key::Damage(boss.spawn_id))
            .unwrap_or(Map::new(&env));
        let previo = dmg.get(player.clone()).unwrap_or(0);
        dmg.set(player, previo + dealt);
        env.storage()
            .persistent()
            .set(&Key::Damage(boss.spawn_id), &dmg);

        Ok(boss)
    }

    /// Cuanto le puso un jugador a una aparicion.
    pub fn contribution(env: Env, spawn_id: u32, player: Address) -> i128 {
        let dmg: Map<Address, i128> = env
            .storage()
            .persistent()
            .get(&Key::Damage(spawn_id))
            .unwrap_or(Map::new(&env));
        dmg.get(player).unwrap_or(0)
    }

    /// Marcar la recompensa como cobrada.
    ///
    /// Devuelve el dano aportado, que es con lo que el juego calcula el premio.
    /// `world-boss.md` pide que el oro y la experiencia se entreguen "una sola
    /// vez por spawnId", asi que lo que el contrato garantiza es exactamente
    /// eso: que nadie cobre dos veces la misma aparicion.
    pub fn claim(env: Env, player: Address, spawn_id: u32) -> Result<i128, Error> {
        player.require_auth();

        let dmg: Map<Address, i128> = env
            .storage()
            .persistent()
            .get(&Key::Damage(spawn_id))
            .unwrap_or(Map::new(&env));
        let aporte = dmg.get(player.clone()).unwrap_or(0);
        if aporte <= 0 {
            return Err(Error::NadaQueCobrar);
        }

        let mut cobrado: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&Key::Claimed(spawn_id))
            .unwrap_or(Map::new(&env));
        if cobrado.get(player.clone()).unwrap_or(false) {
            return Err(Error::YaCobro);
        }
        cobrado.set(player, true);
        env.storage()
            .persistent()
            .set(&Key::Claimed(spawn_id), &cobrado);

        Ok(aporte)
    }
}

mod test;
