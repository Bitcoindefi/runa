'use strict'

/**
 * Reglas de combate L1 a L7 (docs/combate.md), en un solo lugar.
 *
 * Cada regla nueva tiene su interruptor y sus numeros aca. Volver a la regla de
 * antes es cambiar un valor, sin tocar la logica: `turnUntilBlow: false` vuelve
 * al turno fijo de seis ticks, `manualPotion`, `guard` y `retreat` en false
 * apagan las tres acciones nuevas, `foePace: 1` deja la recarga de los
 * monstruos como esta escrita en content.js, `bossCooldown: false` vuelve al
 * golpe por cada tecla contra el Coloso, `bossTelegraphTicks: 0` al aviso de
 * antes y `duelWindup: 0` al golpe instantaneo del duelo. Las pruebas de
 * balance (test/balance.test.js) corren las peleas de verdad con estas reglas.
 *
 * Los ticks de la pelea del campo son los de lib/world.js (TPS 30). Los del
 * Coloso y los del duelo son los del reloj del juego (lib/game.js, 15 por
 * segundo): `gameClock` pasa de unos a otros.
 */
const COMBAT_RULES = {
  // L1: cada golpe, pocion, guardia y retirada queda en el registro de la
  // pelea con su tipo, quien lo hizo y cuanto (ademas del texto de siempre).
  // Apagado, el registro vuelve a ser solo texto y la pagina cuenta por vidas.
  logEvents: true,

  // L3: un turno dura hasta el proximo golpe de cualquiera de los dos (o una
  // pocion), con este tope de ticks. Apagado, el turno es de turnTicks fijos.
  turnUntilBlow: true,
  turnCap: 45,
  turnTicks: 6,

  // L2: tomar una pocion a mano (tecla P o el boton). Ocupa el turno del
  // heroe: toma la pocion y no pega hasta que pegue el monstruo (o el tope del
  // turno). La del guion (`use potion`) sigue como siempre.
  manualPotion: true,
  potionHeal: 8,

  // L4: la guardia (tecla G). Ese turno el heroe no pega, el proximo golpe que
  // recibe se multiplica por guardFactor (redondeado hacia arriba, minimo 1) y,
  // si guardHoldsCooldown, el arma no se recarga mientras se cubre.
  guard: true,
  guardFactor: 0.5,
  guardHoldsCooldown: true,

  // L5: la retirada (tecla B). Sale limpia si el monstruo no alcanza o si le
  // faltan mas de retreatSafeTicks para volver a pegar; si no, se lleva ese
  // golpe entero al darle la espalda (y sale igual si queda en pie). No hay
  // azar: la barra del monstruo dice si conviene. Despues da retreatStep pasos
  // hacia atras en el mapa y nada lo vuelve a atacar por contacto durante
  // retreatGrace ticks del campo.
  retreat: true,
  retreatSafeTicks: 8,
  retreatStep: 2,
  retreatGrace: 75,

  // Las armas pegan segun su tamano (content.js): la daga poco y seguido, el
  // martillo mucho y lento, medido en segundos de verdad. Los monstruos van al
  // mismo reloj: su recarga de content.js se multiplica por foePace.
  foePace: 3,

  // Los ticks del reloj del juego (15 por segundo) que dura un tick de la pelea
  // del campo (30 por segundo). Asi un arma tarda los mismos segundos contra un
  // monstruo, en un duelo y contra el Coloso.
  gameClock: 0.5,

  // L6: el golpe al Coloso respeta la recarga del arma (en el reloj del juego).
  // Cada golpe pega (1 + atk del arma) por bossStrikeScale, menos la defensa
  // del Coloso, para que la pelea dure parecido con un ritmo humano de teclas.
  bossCooldown: true,
  bossStrikeScale: 2,
  // L6: la carga de cada ataque del Coloso lee su `telegraph` (1, 2 o 3) a
  // tantos ticks por punto, nunca menos que sus cuadros. La pausa entre ataques
  // se acorta lo mismo que crece la carga, asi el ritmo del jefe no cambia.
  bossTelegraphTicks: 10,
  bossMinGap: 12,

  // L7: el golpe del duelo se prepara durante estos ticks (del reloj del juego)
  // y se resuelve en el paso ordenado por la autoridad, midiendo la distancia
  // en ese momento. Solo se usa si los dos lados anuncian el mismo valor (0 =
  // golpe instantaneo, como un par que no la conoce).
  duelWindup: 5
}

/** Como termina una pelea de la que el heroe se retiro (World.over). */
const RETREAT = 'retirada'

/** Lo que hace el heroe en un turno. */
const ACTIONS = Object.freeze(['attack', 'potion', 'guard', 'retreat'])

/**
 * La recarga de un monstruo en ticks de la pelea.
 * @param {number} cooldown la de content.js
 * @param {object} [rules]
 * @returns {number}
 */
function foeCooldown(cooldown, rules = COMBAT_RULES) {
  const pace = Number(rules.foePace) > 0 ? Number(rules.foePace) : 1
  return Math.max(1, Math.round((Number(cooldown) || 1) * pace))
}

/**
 * Ticks de la pelea del campo pasados al reloj del juego (duelo, Coloso).
 * @param {number} ticks
 * @param {object} [rules]
 * @returns {number}
 */
function gameTicks(ticks, rules = COMBAT_RULES) {
  const scale = Number(rules.gameClock) > 0 ? Number(rules.gameClock) : 1
  return Math.max(1, Math.round((Number(ticks) || 1) * scale))
}

/**
 * Lo que entra de un golpe con la guardia puesta.
 * @param {number} damage
 * @param {object} [rules]
 * @returns {number}
 */
function guarded(damage, rules = COMBAT_RULES) {
  const factor = Math.max(0, Math.min(1, Number(rules.guardFactor)))
  return Math.max(1, Math.ceil(Math.max(0, Number(damage) || 0) * factor))
}

/** Los ticks que puede durar un turno como mucho. */
function turnLimit(rules = COMBAT_RULES) {
  return Math.max(1, Math.floor(rules.turnUntilBlow ? rules.turnCap : rules.turnTicks) || 1)
}

/**
 * El tope de un turno de guardia (L4): la guardia espera el golpe que tiene que
 * parar, asi que si el monstruo ya alcanza al heroe dura hasta su golpe aunque
 * pase del tope de siempre. Fuera de su alcance, el tope de siempre.
 * @param {object} world
 * @param {object} [rules]
 * @returns {number}
 */
function guardLimit(world, rules = COMBAT_RULES) {
  const cap = turnLimit(rules)
  if (!rules.turnUntilBlow) return cap
  const reach = world.foe.derive([]).reach
  const near = Math.abs(world.foe.x - world.hero.x) <= reach
  return near ? Math.max(cap, world.foe.cooldownLeft + 1) : cap
}

/**
 * Un turno de la pelea (L3): avanza `step` hasta el proximo golpe de
 * cualquiera de los dos (o una pocion), o hasta el tope. `step()` avanza un
 * tick y devuelve false si la pelea ya no sigue (el campo la cerro).
 * @param {object} world un World de lib/world.js
 * @param {() => boolean|void} [step]
 * @param {object} [rules]
 * @param {number} [cap] el tope de este turno (turnLimit, o mas para la guardia)
 * @returns {number} los ticks que duro
 */
function playTurn(world, step = () => world.step(), rules = COMBAT_RULES, cap = turnLimit(rules)) {
  const mark = world.blows
  let ticks = 0
  // El primer paso va siempre: una pelea ya decidida la cierra el campo ahi.
  while (ticks < cap) {
    if (step() === false) break
    ticks++
    if (world.over) break
    if (rules.turnUntilBlow && world.blows !== mark) break
  }
  return ticks
}

/**
 * Los ticks de carga de un ataque del Coloso (L6).
 * @param {{ frames?: string[], telegraph?: number }} attack
 * @param {number} frameTicks ticks por cuadro (lib/world-boss-event.js)
 * @param {object} [rules]
 * @returns {number}
 */
function bossWindup(attack, frameTicks, rules = COMBAT_RULES) {
  const frames = Math.max(1, ((attack && attack.frames) || ['idle']).length)
  const byFrames = frames * frameTicks
  const level = Math.max(0, Number(attack && attack.telegraph) || 0)
  return Math.max(byFrames, Math.round(level * (Number(rules.bossTelegraphTicks) || 0)))
}

/**
 * La pausa despues de un ataque del Coloso: la de siempre menos lo que la
 * carga crecio por el aviso, para que el ritmo de ataques quede igual.
 * @param {object} attack
 * @param {number} frameTicks
 * @param {number} gap pausa de siempre
 * @param {object} [rules]
 * @returns {number}
 */
function bossGap(attack, frameTicks, gap, rules = COMBAT_RULES) {
  const frames = Math.max(1, ((attack && attack.frames) || ['idle']).length)
  const longer = bossWindup(attack, frameTicks, rules) - frames * frameTicks
  return Math.max(Math.min(gap, Number(rules.bossMinGap) || 0), gap - longer)
}

/**
 * La carga del duelo que usan los dos lados: la misma o ninguna. Un par viejo
 * no la anuncia (undefined) y el duelo queda con el golpe instantaneo.
 * @param {number} [mine]
 * @param {number} [theirs]
 * @returns {number}
 */
function agreedWindup(mine, theirs) {
  if (mine === undefined || theirs === undefined) return 0
  const a = Number(mine)
  const b = Number(theirs)
  if (!Number.isInteger(a) || !Number.isInteger(b) || a !== b) return 0
  return Math.max(0, Math.min(30, a))
}

module.exports = {
  COMBAT_RULES,
  RETREAT,
  ACTIONS,
  foeCooldown,
  gameTicks,
  guarded,
  turnLimit,
  guardLimit,
  playTurn,
  bossWindup,
  bossGap,
  agreedWindup
}
