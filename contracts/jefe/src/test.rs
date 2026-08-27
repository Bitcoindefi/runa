#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

/// La vida que le puso `lib/world-boss.js` al Coloso Runico.
const HP: i128 = 360;

fn armar(env: &Env) -> (JefeClient<'static>, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let id = env.register(Jefe, ());
    let c = JefeClient::new(env, &id);
    c.init(&admin);
    (c, admin)
}

#[test]
fn el_jefe_nace_entero_y_en_la_primera_fase() {
    let env = Env::default();
    let (c, _) = armar(&env);
    let b = c.spawn(&HP);
    assert_eq!(b.spawn_id, 1);
    assert_eq!(b.hp, HP);
    assert_eq!(b.phase, 0);
    assert_eq!(b.revision, 0);
    assert!(b.alive);
}

#[test]
fn cada_golpe_sube_la_revision() {
    // `world-boss.md` pide que la revision suba con cada dano aceptado, porque
    // es lo que deja a los pares descartar mensajes viejos sin curar al jefe.
    let env = Env::default();
    let (c, _) = armar(&env);
    c.spawn(&HP);
    let jugador = Address::generate(&env);

    let a = c.hit(&jugador, &111u32, &200u32);
    let b = c.hit(&jugador, &222u32, &200u32);
    assert_eq!(a.revision, 1);
    assert_eq!(b.revision, 2);
    assert!(b.hp < a.hp, "el segundo golpe tiene que restar vida");
}

#[test]
fn el_jugador_no_dice_cuanto_dano_hizo() {
    // No hay ningun parametro de dano en `hit`. Esa ausencia es el diseno: el
    // contrato rehace la pelea y calcula. Si alguien agrega ese parametro
    // alguna vez, este test deja de compilar, que es lo que se busca.
    let env = Env::default();
    let (c, _) = armar(&env);
    c.spawn(&HP);
    let jugador = Address::generate(&env);

    let antes = c.state().hp;
    let despues = c.hit(&jugador, &4242u32, &300u32).hp;
    let dano = antes - despues;

    assert!(
        dano > 0,
        "una pelea de 300 ticks tiene que hacer algo de dano"
    );
    assert_eq!(
        dano,
        c.contribution(&1u32, &jugador),
        "lo aportado tiene que ser lo que el contrato calculo"
    );
}

#[test]
fn la_misma_pelea_no_cuenta_dos_veces() {
    // Sin esto, la semilla mas afortunada se manda mil veces y el jefe cae en un
    // minuto sin que nadie haya jugado.
    let env = Env::default();
    let (c, _) = armar(&env);
    c.spawn(&HP);
    let jugador = Address::generate(&env);

    c.hit(&jugador, &777u32, &200u32);
    let repetida = c.try_hit(&jugador, &777u32, &200u32);
    assert_eq!(repetida, Err(Ok(Error::PeleaRepetida)));
}

#[test]
fn las_fases_siguen_los_umbrales_del_juego() {
    // 66% y 30%, los mismos que `WORLD_BOSS.phases` en lib/world-boss.js.
    assert_eq!(phase_for(360, 360), 0);
    assert_eq!(phase_for(238, 360), 0, "justo arriba del 66%");
    assert_eq!(phase_for(237, 360), 1, "justo abajo del 66%");
    assert_eq!(phase_for(109, 360), 1, "justo arriba del 30%");
    assert_eq!(phase_for(108, 360), 2, "justo abajo del 30%");
    assert_eq!(phase_for(0, 360), 2);
}

#[test]
fn el_jefe_muere_y_no_se_le_puede_pegar_mas() {
    let env = Env::default();
    let (c, _) = armar(&env);
    c.spawn(&40i128);
    let jugador = Address::generate(&env);

    let mut semilla = 1u32;
    let mut vivo = true;
    while vivo && semilla < 200 {
        let b = c.hit(&jugador, &semilla, &400u32);
        vivo = b.alive;
        semilla += 1;
    }
    assert!(!vivo, "con 40 de vida tendria que caer");

    let s = c.state();
    assert_eq!(s.hp, 0, "la vida no puede quedar negativa");
    assert_eq!(
        c.try_hit(&jugador, &9999u32, &100u32),
        Err(Ok(Error::YaMurio))
    );
}

#[test]
fn no_se_puede_invocar_otro_mientras_el_anterior_vive() {
    // Sin esta condicion, un jefe al que le falta poco puede ser reemplazado por
    // uno entero y el trabajo de todos se pierde.
    let env = Env::default();
    let (c, _) = armar(&env);
    c.spawn(&HP);
    assert_eq!(c.try_spawn(&HP), Err(Ok(Error::SigueVivo)));
}

#[test]
fn la_recompensa_se_cobra_una_sola_vez_por_aparicion() {
    // Es textual de world-boss.md: "el oro y la experiencia se entregan una sola
    // vez por spawnId".
    let env = Env::default();
    let (c, _) = armar(&env);
    c.spawn(&HP);
    let jugador = Address::generate(&env);
    c.hit(&jugador, &555u32, &300u32);

    let primero = c.claim(&jugador, &1u32);
    assert!(primero > 0);
    assert_eq!(c.try_claim(&jugador, &1u32), Err(Ok(Error::YaCobro)));
}

#[test]
fn el_que_no_peleo_no_cobra() {
    let env = Env::default();
    let (c, _) = armar(&env);
    c.spawn(&HP);
    let peleador = Address::generate(&env);
    let colado = Address::generate(&env);
    c.hit(&peleador, &31337u32, &300u32);

    assert_eq!(c.try_claim(&colado, &1u32), Err(Ok(Error::NadaQueCobrar)));
}

#[test]
fn dos_jugadores_le_pegan_al_mismo_jefe() {
    // Esto es lo que `net.js` no puede hacer y por lo que existe el contrato:
    // estado compartido de verdad, no dos partidas que se miran.
    let env = Env::default();
    let (c, _) = armar(&env);
    c.spawn(&HP);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    let tras_a = c.hit(&a, &101u32, &250u32).hp;
    let tras_b = c.hit(&b, &202u32, &250u32).hp;

    assert!(
        tras_b < tras_a,
        "el dano de los dos se acumula sobre la misma vida"
    );
    assert!(c.contribution(&1u32, &a) > 0);
    assert!(c.contribution(&1u32, &b) > 0);
    assert_eq!(
        HP - tras_b,
        c.contribution(&1u32, &a) + c.contribution(&1u32, &b),
        "la vida perdida tiene que ser la suma de lo que puso cada uno"
    );
}

#[test]
fn los_ticks_tienen_techo() {
    // El techo es lo que hace que el costo este acotado de antemano. Sin el,
    // alguien pide diez millones de ticks y la invocacion se queda sin
    // presupuesto en vez de rechazar el pedido.
    let env = Env::default();
    let (c, _) = armar(&env);
    c.spawn(&HP);
    let jugador = Address::generate(&env);

    assert_eq!(
        c.try_hit(&jugador, &1u32, &901u32),
        Err(Ok(Error::TicksFueraDeRango))
    );
    assert_eq!(
        c.try_hit(&jugador, &1u32, &0u32),
        Err(Ok(Error::TicksFueraDeRango))
    );
}
