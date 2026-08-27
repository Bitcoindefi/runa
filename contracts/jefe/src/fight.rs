//! Rehacer una pelea de runa.
//!
//! Esto es la mitad del contrato que importa. Todo lo demas es contabilidad; lo
//! que hace que la contabilidad valga algo es que el dano se calcule aca en vez
//! de recibirse de un jugador.
//!
//! ## La deuda que este archivo tiene, dicha de frente
//!
//! Esto es la **forma** del combate de runa, no su motor. El motor vive en
//! `lib/world.js` y `lib/script.js`, son unas quinientas lineas de JavaScript, y
//! portarlas es trabajo aparte. Mientras tanto, un dano calculado aca y un dano
//! calculado por el juego **no coinciden**, y eso es un problema real que hay
//! que resolver antes de que esto toque mainnet.
//!
//! La forma de resolverlo no es leer los dos archivos y convencerse: es un test
//! cruzado que corra la misma semilla en JavaScript y en Rust y compare. Hasta
//! que ese test exista y este verde, este contrato sirve para probar el diseno,
//! no para repartir premios de verdad.
//!
//! Lo que si es fiel y no se puede tocar: el generador de numeros. `next()` es
//! el mismo xorshift de 32 bits que `makeRng` en `lib/field.js`. Si eso se
//! desviara, ni siquiera tendria sentido comparar el resto.

/// El xorshift de `makeRng` en `lib/field.js`, tal cual.
#[inline(always)]
pub fn next(rng: &mut u32) -> u32 {
    let mut x = *rng;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *rng = x;
    x
}

/// El estado de una pelea: doce numeros.
#[derive(Clone, Copy)]
pub struct Fight {
    pub hero_hp: i32,
    pub foe_hp: i32,
    pub dist: i32,
    pub ammo: i32,
    pub potions: i32,
    pub cd_atk: i32,
    pub cd_shot: i32,
    pub tick: u32,
    pub rng: u32,
    pub dealt: i32,
    pub taken: i32,
    pub over: bool,
}

impl Fight {
    pub fn new(seed: u32) -> Self {
        Fight {
            hero_hp: 20,
            foe_hp: 30,
            dist: 8,
            ammo: 10,
            potions: 2,
            cd_atk: 0,
            cd_shot: 0,
            tick: 0,
            rng: if seed == 0 { 1 } else { seed },
            dealt: 0,
            taken: 0,
            over: false,
        }
    }
}

/// Un tick.
///
/// Las ramas se leen de arriba a abajo y solo gana la primera, que es como
/// funciona el lenguaje de guiones: la hoja entera se relee cada tick y no hay
/// nada que sobreviva de un tick al siguiente salvo el estado del mundo.
pub fn step(f: &mut Fight) {
    if f.over {
        return;
    }
    let r = next(&mut f.rng);

    if f.cd_atk > 0 {
        f.cd_atk -= 1;
    }
    if f.cd_shot > 0 {
        f.cd_shot -= 1;
    }

    if f.hero_hp < 7 && f.potions > 0 {
        f.potions -= 1;
        f.hero_hp += 12;
    } else if f.dist > 5 && f.ammo > 0 && f.cd_shot == 0 {
        f.ammo -= 1;
        f.cd_shot = 4;
        let dmg = 3 + (r % 4) as i32;
        f.foe_hp -= dmg;
        f.dealt += dmg;
    } else if f.dist > 1 {
        f.dist -= 1;
    } else if f.cd_atk == 0 {
        f.cd_atk = 3;
        let dmg = 4 + (r % 5) as i32;
        f.foe_hp -= dmg;
        f.dealt += dmg;
    }

    if f.foe_hp > 0 {
        if f.dist > 1 {
            f.dist -= 1;
        } else if (r >> 8) % 3 == 0 {
            let dmg = 2 + ((r >> 16) % 3) as i32;
            f.hero_hp -= dmg;
            f.taken += dmg;
        }
    }

    f.tick += 1;
    if f.foe_hp <= 0 || f.hero_hp <= 0 {
        f.over = true;
    }
}

/// Cuanto dano hizo el heroe en esa pelea. Es lo unico que el contrato necesita.
pub fn replay(seed: u32, ticks: u32) -> i32 {
    let mut f = Fight::new(seed);
    let mut i = 0u32;
    while i < ticks {
        step(&mut f);
        i += 1;
    }
    f.dealt
}
