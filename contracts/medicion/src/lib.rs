#![no_std]

//! Cuanto cuesta rehacer una pelea de runa adentro de un contrato.
//!
//! No es el motor de combate: es su forma. Un tick de runa hace tres cosas y
//! solo tres, porque el lenguaje de guiones no tiene bucles ni recursion:
//!
//!   1. lee el estado (hp, distancia, municion, cooldowns)
//!   2. recorre las reglas del guion de arriba a abajo, una vez
//!   3. aplica la que gano y avanza el mundo un paso
//!
//! Eso es aritmetica de enteros sobre una decena de variables, sin asignar
//! memoria y sin tocar almacenamiento. Lo que se mide aca es exactamente ese
//! costo, repetido la cantidad de ticks que dura una pelea de verdad.
//!
//! La pregunta que contesta: ¿entra una pelea entera en el presupuesto de una
//! sola invocacion? De eso depende que el contrato pueda declarar al ganador
//! por su cuenta, en vez de creerle a un jugador que dice que gano.

use soroban_sdk::{contract, contractimpl, contracttype, Env};

/// El estado de una pelea. Doce numeros, que es todo lo que runa necesita.
#[contracttype]
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
    pub over: u32,
}

/// El generador de runa, tal cual: xorshift de 32 bits.
///
/// Tiene que dar exactamente los mismos numeros que `makeRng` en field.js, o el
/// contrato y el juego no estarian rehaciendo la misma pelea.
#[inline(always)]
fn next(rng: &mut u32) -> u32 {
    let mut x = *rng;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *rng = x;
    x
}

/// Un tick.
///
/// Las diez ramas son un guion de tamano realista: la mayoria de los jugadores
/// escribe entre cinco y quince reglas. Se recorren todas cada tick porque asi
/// funciona el lenguaje, que se relee entero de arriba a abajo.
fn step(f: &mut Fight) {
    if f.over != 0 {
        return;
    }
    let r = next(&mut f.rng);

    if f.cd_atk > 0 {
        f.cd_atk -= 1;
    }
    if f.cd_shot > 0 {
        f.cd_shot -= 1;
    }

    // El guion, de arriba a abajo.
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

    // El bicho contesta.
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
        f.over = 1;
    }
}

#[contract]
pub struct Medicion;

#[contractimpl]
impl Medicion {
    /// Rehace una pelea de `ticks` pasos y devuelve como termino.
    ///
    /// Nada de esto toca almacenamiento a proposito: lo que se quiere medir es
    /// el costo de pensar, no el de guardar.
    pub fn replay(_env: Env, seed: u32, ticks: u32) -> Fight {
        let mut f = Fight {
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
            over: 0,
        };
        let mut i = 0u32;
        while i < ticks {
            step(&mut f);
            i += 1;
        }
        f
    }

    /// Igual que `replay`, pero con un bicho que no se muere.
    ///
    /// Existe para medir el peor caso. Una pelea real puede terminar en el tick
    /// 17, y medir esa seria medir la comoda: la que decide si esto es viable
    /// es la que llega al tope, porque es la que el contrato tiene que poder
    /// pagar siempre.
    pub fn bench(_env: Env, seed: u32, ticks: u32) -> Fight {
        let mut f = Fight {
            hero_hp: i32::MAX / 4,
            foe_hp: i32::MAX / 4,
            dist: 8,
            ammo: i32::MAX / 4,
            potions: i32::MAX / 4,
            cd_atk: 0,
            cd_shot: 0,
            tick: 0,
            rng: if seed == 0 { 1 } else { seed },
            dealt: 0,
            taken: 0,
            over: 0,
        };
        let mut i = 0u32;
        while i < ticks {
            step(&mut f);
            i += 1;
        }
        f
    }

    /// Un duelo: las dos peleas en la MISMA invocacion.
    ///
    /// Medir dos llamadas sueltas no sirve, porque el arnes de pruebas reinicia
    /// el presupuesto en cada invocacion de nivel superior. Lo que el contrato
    /// de duelos va a hacer es esto: rehacer las dos peleas de una sola vez y
    /// comparar. Entonces eso es lo que hay que medir.
    pub fn bench_duel(env: Env, seed_a: u32, seed_b: u32, ticks: u32) -> i32 {
        let a = Self::bench(env.clone(), seed_a, ticks);
        let b = Self::bench(env, seed_b, ticks);
        if a.dealt > b.dealt {
            1
        } else if b.dealt > a.dealt {
            -1
        } else {
            0
        }
    }
}

mod test;
