// El ritmo y la lectura del combate en 3D de la pagina (tripo-heroe.html): lo
// que comparten la pradera, la cripta y los campamentos (pradera.js Effects).
//
//  - Ritmo: cada ataque (F, Espacio, Enter, el boton Atacar o el stick hacia el
//    monstruo) pide un turno. Va uno por vez: el siguiente sale cuando termina
//    la animacion del anterior, con un pedido guardado como mucho. Mantener
//    apretado repite al mismo ritmo, nunca mas de unos tres por segundo.
//  - Turno: lo que paso se cuenta por las vidas antes y despues (tripo-estado.js
//    fightOf), no leyendo las lineas del registro en castellano.
//  - Lectura: el boton dice Atacar, Esperar (n) o Recargando, y los aros de la
//    pelea muestran la recarga de los dos.
//  - Golpe: una pausa corta (hit stop), el temblor de la camara y el tamano del
//    numero crecen con la parte de la vida que se llevo el golpe.
//
// Las reglas son las del juego (lib/world.js, lib/game.js advanceCombat): aca
// solo se decide cuando mandar la tecla y como mostrar lo que el juego resolvio.
//
// Sin three.js ni el juego: .mjs para que las pruebas lo carguen en Bare.

// Los ticks que resuelve cada ataque (lib/game.js COMBAT_TURN_TICKS). fightOf
// manda el valor del juego en `turn`; este es el de respaldo.
export const TURN_TICKS = 6
// Lo minimo entre dos turnos, en segundos: mantener apretado da a lo sumo unos
// tres turnos por segundo aunque la animacion sea mas corta.
export const MIN_TURN = 0.34
// Despues del contacto, el primer turno espera un poco: se ve el "!" y los aros.
export const CONTACT_PAUSE = 0.45

/**
 * El cursor del combate: guarda un pedido y avisa cuando mandarlo.
 * press() guarda un pedido (varios seguidos son uno solo); hold(true) repite
 * mientras siga apretado; ready(now, busyUntil) dice si toca mandar el turno
 * ahora (y lo consume).
 */
export class CombatPace {
  constructor({ minTurn = MIN_TURN } = {}) {
    this.minTurn = minTurn
    this.buffered = false
    this.held = false
    this.last = -Infinity
    this.notBefore = -Infinity
  }

  press() {
    this.buffered = true
  }

  hold(on) {
    this.held = !!on
    if (on) this.buffered = true
  }

  // La pelea empieza: el primer turno espera la pausa del contacto.
  contact(now, pause = CONTACT_PAUSE) {
    this.notBefore = now + pause
  }

  // La pelea termina: se olvida el pedido guardado (no la tecla apretada).
  clear() {
    this.buffered = false
  }

  wants() {
    return this.buffered || this.held
  }

  ready(now, busyUntil = -Infinity) {
    if (!this.wants()) return false
    if (now < busyUntil || now < this.notBefore || now < this.last + this.minTurn) return false
    this.last = now
    this.buffered = false
    return true
  }
}

const num = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Lo que paso entre dos lecturas de la pelea, por las vidas: el golpe del
 * heroe, la pocion y el golpe del monstruo, en el orden del juego (la pocion
 * va antes del tick y el heroe pega primero dentro del tick, world.js step).
 * Si nada cambio el turno fue de espera: 'advance' si el monstruo seguia fuera
 * de alcance, 'recharge' si el arma se estaba recargando.
 * @param {object} before fightOf de antes
 * @param {object} after fightOf de despues
 * @returns {{ who: string, amount?: number, share?: number }[]}
 */
export function turnEvents(before, after) {
  const events = []
  const dealt = Math.max(0, num(before.foeHp) - num(after.foeHp))
  const potion = num(before.potions) > num(after.potions)
  const taken = Math.max(0, num(before.hp) - num(after.hp))
  if (potion) events.push({ who: 'potion', amount: Math.max(0, num(after.hp) - num(before.hp)) })
  if (dealt > 0) {
    events.push({ who: 'hero', amount: dealt, share: dealt / Math.max(1, num(before.foeMaxhp, 1)) })
  }
  if (taken > 0) {
    events.push({ who: 'foe', amount: taken, share: taken / Math.max(1, num(before.maxhp, 1)) })
  }
  if (!events.length) {
    const far = num(before.dist) > num(before.reach, 1)
    events.push({ who: far ? 'advance' : 'recharge' })
  }
  return events
}

/**
 * Cuantos turnos faltan para que el heroe pegue y por que. state es 'attack'
 * (pega con el proximo turno), 'recharge' (el arma se recarga: n turnos) o
 * 'wait' (el monstruo esta fuera de alcance: n turnos, estimado por las
 * velocidades de los dos).
 * @param {object|null} fight fightOf
 * @returns {{ state: string, n: number }|null}
 */
export function readout(fight) {
  if (!fight) return null
  const turn = Math.max(1, num(fight.turn, TURN_TICKS))
  const dist = num(fight.dist)
  const reach = num(fight.reach, 1)
  // El tick en que el heroe pega: el arma lista (heroCd en 0) y el monstruo a
  // su alcance. En cada tick primero baja la recarga y despues se mide.
  const cd = Math.max(0, num(fight.heroCd))
  const gap = dist - reach
  let closeTicks = 0
  if (gap > 0) {
    const closing = num(fight.speed) + (dist > num(fight.foeReach, 1) ? num(fight.foeSpeed) : 0)
    closeTicks = closing > 0 ? Math.ceil(gap / closing) + 1 : Infinity
  }
  const ticks = Math.max(cd, closeTicks)
  if (ticks <= turn) return { state: 'attack', n: 1 }
  const n = Number.isFinite(ticks) ? Math.ceil(ticks / turn) : 9
  return { state: closeTicks > cd ? 'wait' : 'recharge', n: Math.min(9, n) }
}

/** Lo cargado de una recarga, de 0 (recien pego) a 1 (lista). */
export function charge(left, max) {
  const total = num(max)
  if (total <= 0) return 1
  return Math.max(0, Math.min(1, 1 - num(left) / total))
}

// La pausa del golpe en milisegundos: 60 un rasguno, 90 un golpe, 140 uno
// grande (la parte de la vida del que lo recibe).
export function hitStopMs(share) {
  const s = num(share)
  if (s >= 0.25) return 140
  if (s >= 0.1) return 90
  return 60
}

// El temblor de la camara (el mismo que el del Coloso, que va de 0,35 a 1).
export function shakeOf(share) {
  return Math.min(0.55, 0.08 + Math.max(0, num(share)) * 1.1)
}

// El tamano del numero de dano, 1 el de siempre.
export function numberScale(share) {
  return Math.max(0.85, Math.min(1.8, 0.85 + Math.max(0, num(share)) * 2.4))
}

/**
 * La pausa del golpe: kick(ms, now) la empieza (o la alarga), scale(now) es la
 * velocidad del reloj de la pelea (casi parado durante la pausa, 1 despues).
 * now en segundos.
 */
export class HitStop {
  constructor({ slow = 0.06 } = {}) {
    this.slow = slow
    this.until = -Infinity
  }

  kick(ms, now) {
    this.until = Math.max(this.until, now + Math.max(0, num(ms)) / 1000)
  }

  scale(now) {
    return now < this.until ? this.slow : 1
  }
}

/**
 * Si un paso (dx, dy) va hacia el monstruo que esta en (fx, fy) desde (hx, hy):
 * mas de la mitad del paso en su direccion. Los pasos hacia atras o de costado
 * no atacan. Sin posicion conocida, cualquier paso vale (como en el juego).
 */
export function towardFoe(dx, dy, hero, foe) {
  if (!dx && !dy) return false
  if (!hero || !foe) return true
  const vx = num(foe.x) - num(hero.x)
  const vy = num(foe.y) - num(hero.y)
  const length = Math.hypot(vx, vy) * Math.hypot(dx, dy)
  if (!length) return true
  return (vx * dx + vy * dy) / length > 0.5
}

/**
 * Los monstruos que estan por tocar al heroe (celdas de distancia, como el
 * hitbox de lib/field.js), el mas cerca primero: para el aro rojo antes del
 * contacto. Fuera de `radius` no van.
 */
export function nearFoes(foes, at, radius = 3, limit = 3) {
  if (!Array.isArray(foes) || !at) return []
  const list = []
  for (const foe of foes) {
    const d = Math.max(Math.abs(num(foe.x) - num(at.x)), Math.abs(num(foe.y) - num(at.y)))
    if (d <= radius) list.push({ id: foe.id, d })
  }
  list.sort((a, b) => a.d - b.d)
  return list.slice(0, limit)
}
