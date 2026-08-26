'use strict'

/**
 * runa: una sesion de duelo.
 *
 * El Coliseo ya existe como mapa propio (`lib/coliseum.js`) y publica todo lo
 * que hace falta para pararse adentro: `duelSpawns`, `arenaBounds` y
 * `refereeSpawn`. Este archivo no dibuja nada. Se ocupa de lo otro: quien va de
 * que lado, donde vuelve cada uno cuando termina, y que nadie se escape a las
 * gradas mientras la pelea esta viva.
 *
 * Tres decisiones que explican el resto.
 *
 *  1. **Los lados se calculan, no se acuerdan.** Dos jugadores sin servidor
 *     tienen que llegar al mismo reparto por su cuenta, y cualquier negociacion
 *     ("vos oeste, yo este") es un mensaje que se puede perder o contradecir.
 *     Comparar las dos identidades y que la menor sea oeste no necesita ningun
 *     mensaje: los dos hacen la misma cuenta y les da lo mismo.
 *
 *  2. **La vuelta se guarda antes de salir.** Un duelo puede terminar porque
 *     alguien gano, porque se rindio, o porque se le corto internet. El ultimo
 *     caso es el que manda el diseno: si el regreso dependiera de un mensaje de
 *     cierre, el que se desconecta quedaria varado en el Coliseo para siempre.
 *     Por eso `from` se guarda al entrar y alcanza con tenerlo para volver.
 *
 *  3. **Sesion, combate y cadena son capas distintas.** `Duel` guarda solamente
 *     geometria y retorno; `DuelCombat` calcula el resultado efimero sin tocar
 *     la vida persistente; Soroban liquida el resultado acordado. Los duelos,
 *     el jefe mundial y los encuentros con monstruos siguen siendo sesiones
 *     distintas y mezclarles el estado es el error que hay que no cometer.
 */

/** Los estados posibles. Un duelo no vuelve de `over`. */
const IDLE = 'idle'
const ACTIVE = 'active'
const OVER = 'over'

const DEFAULT_COMBAT_STATS = Object.freeze({
  hp: 20,
  maxHp: 20,
  atk: 1,
  defense: 0,
  reach: 1,
  cooldown: 30
})

// Coordinates anchor the feet, while each stickman occupies several columns.
// Distances are measured between the visible bodies instead of between their
// anchors, so a sword can connect before the two ASCII drawings overwrite one
// another.
const DUEL_BODY_GAP = 5

function positiveNumber(value, fallback, minimum = 0) {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) ? Math.max(minimum, number) : fallback
}

/** Normalize the portable stat block exchanged before a duel. */
function combatStats(stats = {}) {
  const maxHp = positiveNumber(stats.maxHp === undefined ? stats.maxhp : stats.maxHp, 20, 1)
  return {
    hp: Math.min(maxHp, positiveNumber(stats.hp, maxHp, 0)),
    maxHp,
    atk: positiveNumber(stats.atk, DEFAULT_COMBAT_STATS.atk, 0),
    defense: positiveNumber(stats.defense, DEFAULT_COMBAT_STATS.defense, 0),
    reach: positiveNumber(stats.reach, DEFAULT_COMBAT_STATS.reach, 1),
    cooldown: positiveNumber(stats.cooldown, DEFAULT_COMBAT_STATS.cooldown, 1),
    items: Array.isArray(stats.items) ? stats.items.map(String).slice(0, 2) : []
  }
}

/**
 * De que lado le toca a cada uno.
 *
 * Se comparan las dos identidades como texto y la menor va al oeste. No importa
 * cual criterio se elija mientras sea total y los dos usen el mismo; lo que
 * importa es que **no haga falta preguntar**. Los dos jugadores corren esta
 * funcion con los mismos dos nombres, en el orden que sea, y les da lo mismo.
 *
 * @param {string} self
 * @param {string} rival
 * @returns {'west'|'east'}
 */
function sideFor(self, rival) {
  const a = String(self)
  const b = String(rival)
  if (a === b) {
    // Dos identidades iguales no son dos jugadores. Se devuelve algo estable en
    // vez de tirar, porque quien llame a esto puede estar dibujando un cuadro.
    return 'west'
  }
  return a < b ? 'west' : 'east'
}

/** El lado contrario. */
function otherSide(side) {
  return side === 'west' ? 'east' : 'west'
}

class Duel {
  /**
   * @param {object} opts
   * @param {object} opts.arena - `MAPS.coliseum`. De aca salen las coordenadas;
   *   este modulo no tiene ninguna escrita, para que mover el arte del Coliseo
   *   no obligue a tocar la logica de duelos.
   * @param {string} opts.self - identidad del jugador local
   * @param {string} opts.rival - identidad del rival
   */
  constructor({ arena, self, rival } = {}) {
    if (!arena || !Array.isArray(arena.duelSpawns) || arena.duelSpawns.length < 2) {
      throw new Error('el duelo necesita un mapa con dos duelSpawns')
    }
    if (!arena.arenaBounds) {
      throw new Error('el duelo necesita arenaBounds para encerrar a los que pelean')
    }

    this.arena = arena
    this.self = String(self)
    this.rival = String(rival)
    this.side = sideFor(this.self, this.rival)
    this.state = IDLE

    /** Donde estaba el jugador antes de entrar. Se llena en `begin`. */
    this.from = null
    /** Por que termino. Lo lee la interfaz para decir algo. */
    this.reason = null
  }

  /** ¿Hay una pelea en curso? */
  get active() {
    return this.state === ACTIVE
  }

  /**
   * El punto donde le toca pararse a un lado.
   *
   * Sale de `arena.duelSpawns` y se devuelve copiado. Devolver el objeto del
   * mapa dejaria que quien lo reciba le mueva las coordenadas al Coliseo sin
   * querer, y el proximo duelo empezaria torcido.
   *
   * @param {'west'|'east'} [side] - por omision, el lado del jugador local
   */
  spawnFor(side = this.side) {
    const found = this.arena.duelSpawns.find((s) => s.id === side)
    if (!found) throw new Error('el mapa no publica el lado ' + side)
    return { ...found }
  }

  /** Donde se para el rival. */
  rivalSpawn() {
    return this.spawnFor(otherSide(this.side))
  }

  /**
   * Donde se para el arbitro, si el protocolo llega a necesitar uno visible.
   *
   * Hoy nadie lo usa, y esta igual porque el mapa lo reserva: si el dia de
   * manana la autoridad tiene cuerpo, el lugar ya esta y no hay que inventarlo
   * en medio de otra cosa.
   */
  refereeSpawn() {
    return this.arena.refereeSpawn ? { ...this.arena.refereeSpawn } : null
  }

  /**
   * Entrar al Coliseo.
   *
   * @param {{mapId: string, x: number, y: number}} from - donde estaba el
   *   jugador. Se guarda tal cual y es lo unico que hace falta para volver.
   * @returns {{mapId: 'coliseum', x: number, y: number, facing: string}}
   */
  begin(from) {
    if (this.state === ACTIVE) throw new Error('el duelo ya empezo')
    if (this.state === OVER) throw new Error('este duelo ya termino')
    if (!from || typeof from.mapId !== 'string') {
      throw new Error('hace falta saber de donde vino para poder devolverlo')
    }

    this.from = { mapId: from.mapId, x: from.x, y: from.y }
    this.state = ACTIVE

    const spawn = this.spawnFor()
    return { mapId: 'coliseum', x: spawn.x, y: spawn.y, facing: spawn.facing }
  }

  /**
   * Encerrar una posicion dentro del campo.
   *
   * `docs/coliseum.md` lo pide con estas palabras: los limites existen "para
   * impedir que un combatiente huya a las gradas". Se recorta en vez de
   * rechazar el movimiento porque el que camina contra el borde tiene que
   * quedar pegado al borde, no rebotar ni quedarse trabado.
   */
  clamp(x, y) {
    const b = this.arena.arenaBounds
    return {
      x: Math.min(Math.max(x, b.x1), b.x2),
      y: Math.min(Math.max(y, b.y1), b.y2)
    }
  }

  /** ¿Esta posicion quedo afuera del campo? */
  inside(x, y) {
    const b = this.arena.arenaBounds
    return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2
  }

  /**
   * ¿Hay que bloquear la salida `Q`?
   *
   * La baldosa `Q` vuelve a la ciudad y existe como salida de seguridad. Con un
   * duelo vivo se bloquea, porque si no el que va perdiendo se va caminando y
   * el duelo no termina nunca ni gana nadie.
   */
  blocksExit() {
    return this.active
  }

  /**
   * Terminar.
   *
   * Sirve para las tres formas de terminar y a proposito no las distingue en el
   * regreso: el que gana, el que se rinde y el que se queda sin internet
   * vuelven todos al mismo lugar del que salieron. La diferencia entre esos
   * casos es de puntaje y de premio, y eso no vive aca.
   *
   * @param {string} [reason]
   * @returns {{mapId: string, x: number, y: number}|null} donde devolverlo
   */
  end(reason = 'termino') {
    if (this.state === OVER) return this.from ? { ...this.from } : null
    this.state = OVER
    this.reason = reason
    return this.from ? { ...this.from } : null
  }
}

/**
 * Deterministic combat state for one Coliseum session.
 *
 * Networking transports ordered inputs; it does not get to invent damage.
 * Replaying the same moves, attacks and ticks on both peers therefore produces
 * the same winner. The Soroban contract remains the settlement layer: this
 * class produces the result that both players can publish, but never signs or
 * pays anything itself.
 */
class DuelCombat {
  constructor({ session, selfStats, rivalStats } = {}) {
    if (!session || !session.active) throw new Error('el combate necesita un duelo activo')
    if (session.self === session.rival) {
      throw new Error('el duelo necesita dos identidades distintas')
    }

    this.session = session
    this.tickCount = 0
    this.result = null
    this.log = []

    const selfSide = session.side
    const rivalSide = otherSide(selfSide)
    this.fighters = {
      [selfSide]: this.makeFighter(session.self, selfSide, selfStats, session.spawnFor(selfSide)),
      [rivalSide]: this.makeFighter(
        session.rival,
        rivalSide,
        rivalStats,
        session.spawnFor(rivalSide)
      )
    }
  }

  makeFighter(id, side, stats, spawn) {
    const normalized = combatStats(stats)
    return {
      id: String(id),
      side,
      x: spawn.x,
      y: spawn.y,
      facing: spawn.facing,
      ...normalized,
      cooldownLeft: 0,
      swinging: 0
    }
  }

  sideOf(identity) {
    if (identity === 'west' || identity === 'east') return identity
    for (const side of ['west', 'east']) {
      if (this.fighters[side].id === String(identity)) return side
    }
    throw new Error('ese combatiente no participa del duelo')
  }

  fighter(identity) {
    return this.fighters[this.sideOf(identity)]
  }

  opponent(identity) {
    return this.fighters[otherSide(this.sideOf(identity))]
  }

  distance(identity) {
    const fighter = this.fighter(identity)
    const opponent = this.opponent(identity)
    const anchors = Math.max(Math.abs(fighter.x - opponent.x), Math.abs(fighter.y - opponent.y))
    return Math.max(0, anchors - DUEL_BODY_GAP)
  }

  /** Advance only timers. Movement and attacks always come from explicit input. */
  tick(amount = 1) {
    const ticks = positiveNumber(amount, 1, 0)
    for (let i = 0; i < ticks; i++) {
      this.tickCount++
      for (const side of ['west', 'east']) {
        const fighter = this.fighters[side]
        if (fighter.cooldownLeft > 0) fighter.cooldownLeft--
        if (fighter.swinging > 0) fighter.swinging--
      }
    }
    return this.snapshot()
  }

  /** Place an input-controlled fighter, clamped to the published arena bounds. */
  place(identity, x, y) {
    const fighter = this.fighter(identity)
    if (this.result) return { moved: false, x: fighter.x, y: fighter.y }
    const rawX = Math.round(Number(x))
    const rawY = Math.round(Number(y))
    const next = this.session.clamp(
      Number.isFinite(rawX) ? rawX : fighter.x,
      Number.isFinite(rawY) ? rawY : fighter.y
    )
    const opponent = this.opponent(identity)
    if (next.x === opponent.x && next.y === opponent.y) {
      return { moved: false, x: fighter.x, y: fighter.y, blocked: 'opponent' }
    }
    const moved = next.x !== fighter.x || next.y !== fighter.y
    fighter.x = next.x
    fighter.y = next.y
    if (moved) fighter.facing = fighter.x <= opponent.x ? 'east' : 'west'
    return { moved, x: fighter.x, y: fighter.y }
  }

  /** Resolve one attack with visible reach, defence and a real cooldown. */
  attack(identity) {
    const attacker = this.fighter(identity)
    const target = this.opponent(identity)
    const distance = this.distance(identity)

    if (this.result) return { type: 'duel-over', result: { ...this.result } }
    if (attacker.cooldownLeft > 0) {
      return { type: 'duel-cooldown', by: attacker.id, readyIn: attacker.cooldownLeft }
    }

    attacker.cooldownLeft = attacker.cooldown
    attacker.swinging = 4
    if (distance > attacker.reach) {
      const event = {
        type: 'duel-miss',
        by: attacker.id,
        distance,
        reach: attacker.reach
      }
      this.remember(event)
      return event
    }

    const damage = Math.max(1, attacker.atk - target.defense)
    target.hp = Math.max(0, target.hp - damage)
    const event = {
      type: 'duel-hit',
      by: attacker.id,
      target: target.id,
      damage,
      hp: target.hp,
      distance
    }

    if (target.hp === 0) {
      this.result = {
        winner: attacker.id,
        loser: target.id,
        reason: 'vida',
        tick: this.tickCount
      }
      event.result = { ...this.result }
    }
    this.remember(event)
    return event
  }

  surrender(identity, reason = 'rendicion') {
    const loser = this.fighter(identity)
    const winner = this.opponent(identity)
    if (!this.result) {
      loser.hp = 0
      this.result = {
        winner: winner.id,
        loser: loser.id,
        reason,
        tick: this.tickCount
      }
    }
    return { ...this.result }
  }

  remember(event) {
    this.log.push({ tick: this.tickCount, ...event })
    if (this.log.length > 30) this.log.shift()
  }

  snapshot(viewer = this.session.self) {
    const self = this.fighter(viewer)
    const rival = this.opponent(viewer)
    return {
      tick: this.tickCount,
      distance: this.distance(viewer),
      self: { ...self, items: [...self.items] },
      rival: { ...rival, items: [...rival.items] },
      result: this.result ? { ...this.result } : null
    }
  }
}

module.exports = {
  Duel,
  DuelCombat,
  combatStats,
  sideFor,
  otherSide,
  IDLE,
  ACTIVE,
  OVER,
  DEFAULT_COMBAT_STATS,
  DUEL_BODY_GAP
}
