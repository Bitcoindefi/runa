#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::Env;

/// Cuantos ticks dura una pelea de runa como mucho (`FIELD.fightCap`).
const FIGHT_CAP: u32 = 900;

/// Los techos de una sola invocacion en Soroban.
const CPU_MAX: u64 = 100_000_000;
const MEM_MAX: u64 = 41_943_040;

/// El contrato compilado.
///
/// Esto importa mas de lo que parece. `env.register(Medicion, ())` corre el
/// contrato como Rust nativo, y entonces el medidor de presupuesto **no ve el
/// bucle**: da el mismo numero para un tick que para novecientos, porque lo
/// unico que cuenta es el costo de invocar. Para medir de verdad hay que
/// registrar el wasm, que es lo que la red va a ejecutar.
mod wasm {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/medicion.wasm");
}

fn medir(ticks: u32) -> (u64, u64, u32) {
    let env = Env::default();
    let id = env.register(wasm::WASM, ());
    let c = wasm::Client::new(&env, &id);
    env.cost_estimate().budget().reset_default();
    let f = c.bench(&12345u32, &ticks);
    let b = env.cost_estimate().budget();
    (b.cpu_instruction_cost(), b.memory_bytes_cost(), f.tick)
}

#[test]
fn el_peor_caso_entra_en_el_presupuesto() {
    std::println!("");
    std::println!("  ticks        cpu       mem     %cpu");
    let mut base = 0u64;
    for t in [0u32, 1, 100, 300, 600, 900] {
        let (cpu, mem, corridos) = medir(t);
        assert_eq!(corridos, t, "la pelea corto antes: la medicion no vale");
        if t == 0 {
            base = cpu;
        }
        std::println!(
            "  {:>4}  {:>10}  {:>8}  {:>4}%",
            t,
            cpu,
            mem,
            (cpu * 100) / CPU_MAX
        );
    }

    let (cpu, mem, _) = medir(FIGHT_CAP);
    let por_tick = (cpu.saturating_sub(base)) / FIGHT_CAP as u64;
    std::println!("");
    std::println!("  invocar sin ticks : {}", base);
    std::println!("  cada tick cuesta  : {}", por_tick);
    std::println!(
        "  pelea de {} ticks: {} cpu ({}%), {} mem ({}%)",
        FIGHT_CAP,
        cpu,
        (cpu * 100) / CPU_MAX,
        mem,
        (mem * 100) / MEM_MAX
    );
    std::println!("  peleas por invocacion: {}", CPU_MAX / cpu.max(1));

    assert!(cpu < CPU_MAX, "la pelea no entra en el presupuesto de cpu");
    assert!(
        mem < MEM_MAX,
        "la pelea no entra en el presupuesto de memoria"
    );
}

#[test]
fn el_costo_crece_con_los_ticks() {
    // Si esto falla, el medidor no esta viendo el bucle y cualquier conclusion
    // que saquemos de los otros tests es mentira.
    let (poco, _, _) = medir(10);
    let (mucho, _, _) = medir(900);
    std::println!("  10 ticks: {}   900 ticks: {}", poco, mucho);
    assert!(
        mucho > poco * 2,
        "el medidor no ve el bucle: la medicion no sirve"
    );
}

#[test]
fn un_duelo_son_dos_peleas_y_tambien_entra() {
    // Las dos peleas van en UNA invocacion, y eso importa: el arnes de pruebas
    // reinicia el presupuesto en cada invocacion de nivel superior, asi que dos
    // llamadas sueltas dan el costo de una sola y parece que un duelo sale
    // gratis. Con bench_duel el numero es el de verdad.
    let env = Env::default();
    let id = env.register(wasm::WASM, ());
    let c = wasm::Client::new(&env, &id);
    env.cost_estimate().budget().reset_default();
    let ganador = c.bench_duel(&12345u32, &999u32, &FIGHT_CAP);
    let cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let mem = env.cost_estimate().budget().memory_bytes_cost();
    std::println!(
        "  duelo, dos peleas de {} ticks en UNA invocacion:",
        FIGHT_CAP
    );
    std::println!(
        "    cpu     {} ({}% del maximo)",
        cpu,
        (cpu * 100) / CPU_MAX
    );
    std::println!(
        "    memoria {} ({}% del maximo)",
        mem,
        (mem * 100) / MEM_MAX
    );
    std::println!("    gano    {}", ganador);

    // Y tiene que costar bastante mas que una pelea sola, o no las corrio a las
    // dos y el numero no vale.
    let (una, _, _) = medir(FIGHT_CAP);
    assert!(
        cpu > una + (una / 2),
        "un duelo tiene que costar casi el doble que una pelea"
    );
    assert!(cpu < CPU_MAX, "un duelo entero no entra");
    assert!(mem < MEM_MAX, "un duelo entero no entra en memoria");
}

#[test]
fn dos_peleas_con_la_misma_semilla_son_identicas() {
    let env = Env::default();
    let id = env.register(wasm::WASM, ());
    let c = wasm::Client::new(&env, &id);
    let a = c.replay(&777u32, &400u32);
    let b = c.replay(&777u32, &400u32);
    assert_eq!(a.dealt, b.dealt);
    assert_eq!(a.taken, b.taken);
    assert_eq!(a.tick, b.tick);
    assert_eq!(a.hero_hp, b.hero_hp);
}

#[test]
fn semillas_distintas_dan_peleas_distintas() {
    let env = Env::default();
    let id = env.register(wasm::WASM, ());
    let c = wasm::Client::new(&env, &id);
    let a = c.replay(&7u32, &400u32);
    let b = c.replay(&99u32, &400u32);
    assert!(
        a.dealt != b.dealt || a.taken != b.taken || a.tick != b.tick,
        "la semilla no esta cambiando nada"
    );
}
