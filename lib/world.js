'use strict'

/**
 * Game state.
 *
 * Two rules hold this together, and both exist because the player's script is
 * re-evaluated every tick and may equip something different on any of them:
 *
 *  1. Base stats are the only truth. Equipment never writes to them; it
 *     contributes a modifier layer that is recomputed from scratch. A design
 *     that mutated base stats on equip would drift within seconds here, because
 *     "equip" is not a rare menu action, it happens up to 30 times a second.
 *
 *  2. Content is data, never code. Items and foes are plain objects in
 *     `content.js`. That is what makes a new enemy shippable over the air: the
 *     OTA carries data, and the running engine already knows how to read it.
 */

const CONTENT = require('./content.js')

/** Ticks per second the simulation advances at. */
const TPS = 30

/** How far apart the two fighters start, in cells. */
const ARENA = 40

class Actor {
  /**
   * @param {string} name
   * @param {{ hp: number, atk: number, reach: number, speed: number, cooldown: number }} base
   */
  constructor(name, base) {
    this.name = name
    this.base = { ...base }
    this.hp = base.hp
    this.x = 0
    this.cooldownLeft = 0
    this.swinging = 0
  }

  /**
   * Recompute the stats that combat reads, from base plus whatever is held.
   * Derived values are never stored as truth: they are a function of base and
   * the current loadout, so a change to either is impossible to desynchronise.
   * @param {object[]} held
   * @returns {{ atk: number, defense: number, reach: number, speed: number, cooldown: number }}
   */
  derive(held) {
    let atk = this.base.atk
    let defense = this.base.defense || 0
    let reach = this.base.reach
    let speed = this.base.speed
    let cooldown = this.base.cooldown

    for (const item of held) {
      if (!item) continue
      atk += item.atk || 0
      defense += item.defense || 0
      reach = Math.max(reach, item.reach || 0)
      speed += item.speed || 0
      if (item.cooldown) cooldown = item.cooldown
    }

    return {
      atk: Math.max(0, atk),
      defense: Math.max(0, defense),
      reach: Math.max(1, reach),
      speed: Math.max(0, speed),
      cooldown: Math.max(1, cooldown)
    }
  }

  get alive() {
    return this.hp > 0
  }
}

class World {
  /**
   * @param {string} [foeId]
   */
  constructor(foeId = 'mosquito') {
    this.tick = 0
    this.log = []
    this.over = null

    this.hero = new Actor('vos', { hp: 20, atk: 1, reach: 1, speed: 0.25, cooldown: 30 })
    this.hero.x = 0

    const def = CONTENT.foes[foeId] || CONTENT.foes.mosquito
    this.foeDef = def
    this.foe = new Actor(def.name, def.stats)
    this.foe.x = ARENA

    /** What the script asked for this tick. Cleared and refilled every tick. */
    this.wanted = { left: null, right: null, use: null }
    /** What is actually held. Swapping is not instant; see `applyIntent`. */
    this.held = { left: null, right: null, chest: null, head: null, boots: null }

    this.potions = 2
  }

  /**
   * The read-only surface the script sees.
   *
   * Deliberately flat and named after things in the world, not after the code:
   * `foe.dist`, not `state.entities[1].position.delta`. The vocabulary is the
   * game, which is what lets someone who has never programmed write a rule.
   * @returns {object}
   */
  snapshot() {
    const dist = Math.abs(this.foe.x - this.hero.x)
    const held = Object.values(this.held)
    const d = this.hero.derive(held)

    return {
      hp: Math.ceil(this.hero.hp),
      maxhp: this.hero.base.hp,
      potions: this.potions,
      reach: d.reach,
      ready: this.hero.cooldownLeft <= 0,
      left: this.held.left ? this.held.left.id : '',
      right: this.held.right ? this.held.right.id : '',
      chest: this.held.chest ? this.held.chest.id : '',
      head: this.held.head ? this.held.head.id : '',
      boots: this.held.boots ? this.held.boots.id : '',
      foe: {
        kind: this.foeDef.id,
        name: this.foe.name,
        hp: Math.ceil(this.foe.hp),
        maxhp: this.foe.base.hp,
        dist: Math.round(dist),
        flying: !!this.foeDef.flying
      },
      tick: this.tick
    }
  }

  /**
   * Fold the script's commands into intent.
   *
   * Commands are intent, not effect. `equip sword` on a tick where the swing is
   * already mid-flight must not teleport a different weapon into the hero's
   * hand: it records what the player wants, and `applyIntent` decides when the
   * world can honour it. Without that split, a script that flips between two
   * items every tick would attack with neither.
   *
   * @param {{cmd: string, args: string[]}[]} actions
   * @returns {string[]} messages about commands that could not be understood
   */
  readIntent(actions) {
    const problems = []
    this.wanted.left = null
    this.wanted.right = null
    this.wanted.use = null

    for (const a of actions) {
      switch (a.cmd) {
        case 'equip':
        case 'equipl': {
          const item = CONTENT.items[a.args[0]]
          if (!item) {
            problems.push(`no existe el item "${a.args[0] || ''}"`)
            break
          }
          if (item.slot !== 'left_hand' && item.slot !== 'right_hand') {
            problems.push(`${item.name} no se lleva en una mano`)
            break
          }
          if (a.cmd === 'equipl' && item.slot !== 'left_hand') {
            problems.push(`${item.name} no se lleva en la mano izquierda`)
            break
          }
          if (item.slot === 'left_hand') this.wanted.left = item
          else this.wanted.right = item
          break
        }
        case 'equipr': {
          const item = CONTENT.items[a.args[0]]
          if (!item) {
            problems.push(`no existe el item "${a.args[0] || ''}"`)
            break
          }
          if (item.slot !== 'right_hand') {
            problems.push(`${item.name} no se lleva en la mano derecha`)
            break
          }
          this.wanted.right = item
          break
        }
        case 'use':
          this.wanted.use = a.args[0] || 'potion'
          break
        case 'wait':
          break
        default:
          problems.push(`no conozco el comando "${a.cmd}"`)
      }
    }

    return problems
  }

  /** Move intent into the world where the rules allow it. */
  applyIntent() {
    // A swap lands only between swings. Mid-swing the hand is busy, which is
    // also what stops a script from cancelling its own attack every tick.
    if (this.hero.swinging <= 0) {
      if (this.wanted.left) this.held.left = this.wanted.left
      if (this.wanted.right) this.held.right = this.wanted.right
    }

    if (this.wanted.use === 'potion' && this.potions > 0 && this.hero.hp < this.hero.base.hp) {
      this.potions--
      this.hero.hp = Math.min(this.hero.base.hp, this.hero.hp + 8)
      this.say('tomas una pocion')
    }
  }

  /**
   * Advance one tick.
   * @returns {void}
   */
  step() {
    if (this.over) return
    this.tick++

    const held = Object.values(this.held)
    const d = this.hero.derive(held)
    const dist = Math.abs(this.foe.x - this.hero.x)

    if (this.hero.cooldownLeft > 0) this.hero.cooldownLeft--
    if (this.hero.swinging > 0) this.hero.swinging--
    if (this.foe.cooldownLeft > 0) this.foe.cooldownLeft--

    // The hero holds the range its weapon wants: closes when too far, backs
    // away when the foe gets inside it. Retreating is what makes reach mean
    // anything. Without it a long weapon and a short one produce the same
    // fight, and the player's choice of item never shows up on screen.
    //
    // The retreat is deliberately slower than the advance. Kiting should be a
    // real option, not a free win, and paying for it in speed is what lets a
    // slow foe with a long arm punish someone who only ever runs away.
    if (dist > d.reach) {
      this.hero.x += d.speed
    } else if (dist < d.reach - 1) {
      this.hero.x -= d.speed * 0.7
    }

    if (dist <= d.reach && this.hero.cooldownLeft <= 0 && d.atk > 0) {
      this.foe.hp -= d.atk
      this.hero.cooldownLeft = d.cooldown
      this.hero.swinging = 6
      const weapon = this.held.left && this.held.left.kind === 'weapon' ? this.held.left : null
      this.say(weapon ? `pegas ${d.atk} con ${weapon.name}` : `pegas ${d.atk}`)
    }

    if (this.foe.alive) {
      const fd = this.foe.derive([])
      if (dist > fd.reach) {
        this.foe.x -= fd.speed
      } else if (this.foe.cooldownLeft <= 0) {
        const damage = Math.max(1, fd.atk - d.defense)
        this.hero.hp -= damage
        this.foe.cooldownLeft = fd.cooldown
        this.say(`${this.foe.name} te pega ${damage}`)
      }
    }

    if (!this.foe.alive) this.over = 'ganaste'
    else if (!this.hero.alive) this.over = 'moriste'
  }

  /** @param {string} text */
  say(text) {
    this.log.push({ tick: this.tick, text })
    if (this.log.length > 60) this.log.shift()
  }
}

module.exports = { World, Actor, TPS, ARENA }
