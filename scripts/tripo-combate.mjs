// El ritmo y la lectura del combate en 3D de la pagina (tripo-heroe.html): lo
// que comparten la pradera, la cripta y los campamentos (pradera.js Effects).
//
//  - Ritmo: cada ataque (F, Espacio, Enter, el boton Atacar o el stick hacia el
//    monstruo) pide un turno. Va uno por vez: el siguiente sale cuando cae el
//    golpe del anterior, con un pedido guardado como mucho. Mantener apretado
//    repite al mismo ritmo. Con el turno hasta el proximo golpe (L3) cada turno
//    dura los ticks que resolvio el juego, a 30 por segundo (turnLead): la
//    barra de carga se llena en ese tiempo y el golpe cae al final.
//  - Acciones (L2, L4, L5): la pocion, la guardia y la retirada se piden con
//    order() y salen en el proximo turno, antes que el ataque.
//  - Turno: lo que paso se lee del registro con datos de la pelea (L1: type, by,
//    amount); sin el, se cuenta por las vidas antes y despues (tripo-estado.js
//    fightOf), no leyendo las lineas del registro en castellano.
//  - Lectura: el boton dice Atacar, Esperar (n) o Recargando, y la barra de
//    carga y los aros de la pelea muestran la recarga de los dos.
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

// Las acciones de un turno y la tecla del juego de cada una (lib/game.js
// COMBAT_KEYS; una prueba los compara).
export const ACTION_KEYS = { attack: 'f', potion: 'p', guard: 'g', retreat: 'b' }

/**
 * El cursor del combate: guarda un pedido y avisa cuando mandarlo.
 * press() guarda un pedido (varios seguidos son uno solo); hold(true, from)
 * repite mientras siga apretado; order(kind) guarda una pocion, una guardia o
 * una retirada para el proximo turno (la ultima pedida gana); ready(now,
 * busyUntil) dice que turno toca mandar ahora ('attack', la accion pedida o
 * false) y lo consume. Cada fuente (tecla, boton, stick) se aprieta y se
 * suelta por su lado: soltar una no corta las otras. release() suelta todo y
 * olvida lo guardado (el menu de pausa, la ventana sin foco).
 */
export class CombatPace {
  constructor({ minTurn = MIN_TURN } = {}) {
    this.minTurn = minTurn
    this.buffered = false
    this.action = null
    this.held = false
    this.sources = new Set()
    this.last = -Infinity
    this.notBefore = -Infinity
  }

  press() {
    this.buffered = true
  }

  order(kind) {
    if (kind && kind !== 'attack' && ACTION_KEYS[kind]) this.action = kind
  }

  hold(on, from = 'key') {
    if (on) this.sources.add(from)
    else this.sources.delete(from)
    this.held = this.sources.size > 0
    if (on) this.buffered = true
  }

  release() {
    this.sources.clear()
    this.held = false
    this.buffered = false
    this.action = null
  }

  // La pelea empieza: el primer turno espera la pausa del contacto.
  contact(now, pause = CONTACT_PAUSE) {
    this.notBefore = now + pause
  }

  // La pelea termina: se olvida el pedido guardado (no la tecla apretada).
  clear() {
    this.buffered = false
    this.action = null
  }

  wants() {
    return this.buffered || this.held || !!this.action
  }

  ready(now, busyUntil = -Infinity) {
    if (!this.wants()) return false
    if (now < busyUntil || now < this.notBefore || now < this.last + this.minTurn) return false
    this.last = now
    if (this.action) {
      const kind = this.action
      this.action = null
      return kind
    }
    this.buffered = false
    return 'attack'
  }
}

/**
 * Cuanto dura en la pagina un turno que resolvio varios ticks de la pelea
 * (L3): los mismos segundos que en el juego, a fight.tps por segundo, con un
 * tope de tres segundos. Con el turno fijo de antes (sin untilBlow) no hay
 * espera: la animacion manda.
 * @param {object} before fightOf de antes
 * @param {object} after fightOf de despues
 * @returns {number} segundos
 */
export function turnLead(before, after) {
  if (!before || !after || !before.untilBlow) return 0
  const ticks = num(after.tick, NaN) - num(before.tick, NaN)
  const tps = Math.max(1, num(before.tps, 30))
  if (!(ticks > 0)) return 0
  return Math.min(3, ticks / tps)
}

const num = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// Lo que cura una pocion (lib/world.js applyIntent), sin pasar la vida maxima.
export const POTION_HEAL = 8

/**
 * Cuantos golpes dio el monstruo entre dos lecturas: repite los ticks del
 * juego (lib/world.js step) con las distancias, velocidades y recargas, y lo
 * acepta solo si termina en la misma distancia y la misma recarga. null si no
 * se puede saber.
 * @param {object} before fightOf de antes
 * @param {object} after fightOf de despues
 * @returns {number|null}
 */
export function foeBlows(before, after) {
  const ticks = num(after.tick, NaN) - num(before.tick, NaN)
  const cdMax = num(before.foeCdMax)
  if (!(ticks > 0) || ticks > 600 || cdMax <= 0 || !(num(before.foeHit) > 0)) return null
  const reach = num(before.reach, 1)
  const foeReach = num(before.foeReach, 1)
  let hero = 0
  let foe = num(before.dist)
  let cd = Math.max(0, num(before.foeCd))
  let blows = 0
  for (let i = 0; i < ticks; i++) {
    const dist = Math.abs(foe - hero)
    if (cd > 0) cd--
    if (dist > reach) hero += num(before.speed)
    else if (dist < reach - 1) hero -= num(before.speed) * 0.7
    if (dist > foeReach) foe -= num(before.foeSpeed)
    else if (cd <= 0) {
      blows++
      cd = cdMax
    }
  }
  const same = Math.abs(Math.abs(foe - hero) - num(after.dist)) < 0.05 && cd === num(after.foeCd)
  return same ? blows : null
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
  const told = loggedEvents(before, after)
  if (told) return told
  const events = []
  const dealt = Math.max(0, num(before.foeHp) - num(after.foeHp))
  const used = Math.max(0, num(before.potions) - num(after.potions))
  const drop = num(before.hp) - num(after.hp)
  // Sin pocion la vida perdida es el golpe. Con pocion la cura tapa el golpe:
  // se cuentan los golpes del monstruo por su recarga y, si no se puede, se
  // supone la cura entera.
  let taken = Math.max(0, drop)
  if (used > 0) {
    const blows = foeBlows(before, after)
    const hit = num(before.foeHit) * (blows || 0)
    const fits = blows !== null && hit >= drop + used && hit <= drop + used * POTION_HEAL
    taken = fits ? hit : Math.max(0, drop + used * POTION_HEAL)
    events.push({ who: 'potion', amount: Math.max(0, taken - drop) })
  }
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
 * Lo que paso entre dos lecturas, leido del registro con datos de la pelea (L1:
 * cada linea con type, by y amount, lib/world.js event). Las lineas de un turno
 * son las de numero (n) mayor que before.logged. null si no se puede leer asi
 * (L1 apagado, una pelea vieja o lineas que ya no estan): entonces se cuenta
 * por las vidas. El golpe que mata se cuenta hasta la vida que le quedaba.
 * @param {object} before
 * @param {object} after
 * @returns {object[]|null}
 */
export function loggedEvents(before, after) {
  if (!before || !after || !Array.isArray(after.log)) return null
  const from = Number(before.logged)
  const to = Number(after.logged)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  const fresh = after.log.filter((line) => line && num(line.n) > from)
  // Si se cortaron lineas del medio, o ninguna trae datos, no se adivina.
  if (fresh.length < to - from) return null
  if (fresh.length && !fresh.some((line) => line.type)) return null
  const events = []
  let foeHp = num(before.foeHp)
  let hp = num(before.hp)
  for (const line of fresh) {
    const amount = Math.max(0, num(line.amount))
    if (line.type === 'hit' && line.by === 'hero') {
      const dealt = Math.min(amount, Math.max(0, foeHp))
      foeHp -= dealt
      if (dealt > 0) {
        const share = dealt / Math.max(1, num(before.foeMaxhp, 1))
        events.push({ who: 'hero', amount: dealt, share })
      }
    } else if (line.type === 'hit' && line.by === 'foe') {
      const taken = Math.min(amount, Math.max(0, hp))
      hp -= taken
      const event = { who: 'foe', amount: taken, share: taken / Math.max(1, num(before.maxhp, 1)) }
      if (num(line.blocked) > 0) event.blocked = num(line.blocked)
      if (line.parting) event.parting = true
      if (taken > 0) events.push(event)
    } else if (line.type === 'potion') {
      hp += amount
      events.push({ who: 'potion', amount })
    } else if (line.type === 'guard') {
      events.push({ who: 'guard' })
    } else if (line.type === 'retreat') {
      events.push({ who: 'retreat', clean: !!line.clean })
    }
  }
  if (!events.some((event) => event.who !== 'guard')) {
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
  const state = closeTicks > cd ? 'wait' : 'recharge'
  if (fight.untilBlow) return blowReadout(fight, ticks, turn, state)
  if (ticks <= turn) return { state: 'attack', n: 1 }
  const n = Number.isFinite(ticks) ? Math.ceil(ticks / turn) : 9
  return { state, n: Math.min(9, n) }
}

// L3: cada turno corre hasta el primer golpe (o el tope, turn). El heroe pega
// en este turno si su golpe llega antes o junto con el del monstruo (en un tick
// pega primero el heroe). Si no, cuenta los turnos que terminan en un golpe del
// monstruo o en el tope antes del suyo.
function blowReadout(fight, ticks, turn, state) {
  const strike = Math.max(1, ticks)
  if (!Number.isFinite(strike)) return { state, n: 9 }
  const foeCdMax = Math.max(1, num(fight.foeCdMax, 1))
  let foe = foeFirst(fight)
  let start = 0
  let n = 1
  while (n < 9) {
    if (strike <= start + turn && strike <= foe) break
    if (foe <= start + turn && foe < strike) {
      start = foe
      foe += foeCdMax
    } else start += turn
    n++
  }
  return n === 1 ? { state: 'attack', n: 1 } : { state, n }
}

// El tick (desde ahora, 1 el proximo) en que pega el monstruo, estimado: con su
// recarga si ya alcanza al heroe, o cuando llegue caminando.
function foeFirst(fight) {
  const cd = Math.max(1, num(fight.foeCd))
  const gap = num(fight.dist) - num(fight.foeReach, 1)
  if (gap <= 0) return cd
  const near = num(fight.dist) > num(fight.reach, 1) ? num(fight.speed) : 0
  const closing = num(fight.foeSpeed) + near
  if (!(closing > 0)) return Infinity
  return Math.max(cd, Math.ceil(gap / closing) + 1)
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

/**
 * El alcance del heroe en un duelo, para dibujarlo en el piso alrededor de su
 * celda. El duelo mide la distancia en celdas, la mayor de las dos (lib/duel.js
 * distance), menos las celdas de los cuerpos (gap): el alcance es un rectangulo
 * de (reach + gap) celdas hacia cada lado, hasta el borde de la ultima celda.
 * cx y cz son lo que mide una celda en el mundo. Devuelve { hx, hz, inside }:
 * las mitades del rectangulo y si el rival esta al alcance; null sin duelo.
 */
export function reachBox(arena, cx, cz) {
  if (!arena || !arena.self) return null
  const cells = Math.max(0, num(arena.self.reach)) + Math.max(0, num(arena.gap)) + 0.5
  return {
    hx: cells * num(cx),
    hz: cells * num(cz),
    inside: num(arena.distance) <= num(arena.self.reach)
  }
}
