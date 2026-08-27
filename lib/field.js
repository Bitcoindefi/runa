'use strict'

/**
 * The field: everything outside the town walls.
 *
 * This is the half of the game the player actually drives. A fight begins only
 * when the player's one-cell hitbox touches a foe's hitbox. The same map stays
 * visible while `world.js` resolves each deliberate attack input, so contact,
 * damage and the result all happen where the creature is standing.
 *
 * Three rules hold it together:
 *
 *  1. The layout is seeded, never random. Same seed, same field, every launch,
 *     on every machine. There are two rng streams, one for the layout and one
 *     for the drift, so how long a foe has been shuffling around cannot move
 *     where the next one spawns. One stream would still be deterministic but
 *     the field would reshuffle for a player who simply stood still longer.
 *
 *  2. Difficulty is geography. No level gate, no warning dialog: the far ring
 *     just holds things that will kill you. Walking is how you find that out,
 *     which is the only lesson the field has to teach.
 *
 *  3. The field owns the run, `world.js` owns the fight. Hp, potions, gold and
 *     experience live here and are lent to a World when a fight starts, then
 *     taken back when it ends. World never learns that a campaign exists, which
 *     is why it stays testable on its own.
 */

const CONTENT = require('./content.js')
const { World, ARENA } = require('./world.js')
const { parse, run } = require('./script.js')
const { bossCamera } = require('./world-boss-event.js')

/**
 * A terminal cell is about twice as tall as it is wide, so a ring measured in
 * raw grid steps draws on screen as a tall ellipse. Every distance the field
 * cares about (zone bands, aggro, leash) is measured in visual cells, with a
 * vertical step counting double. Zones then look like the circles they are.
 */
const Y_SCALE = 2

/** Layout and pacing knobs. Data, so tuning the field is not a code change. */
const FIELD = {
  width: 160,
  height: 48,
  /** Visual cells around the gate where nothing spawns. The doorstep is safe. */
  safe: 12,
  /** Logical tiles between actor centres before their hitboxes touch. */
  hitbox: 1,
  /** Ticks after a fight before anything may aggro again. Room to read the loot. */
  grace: 30,
  /** Base ticks between drift steps, scaled per foe by its speed. */
  wander: 45,
  wanderMin: 14,
  wanderMax: 150,
  /**
   * Hard stop on a single fight, in ticks (30 per second). Nothing in world.js
   * can currently draw forever, but a script that only ever kites plus a foe
   * that cannot reach it is one content update away, and a hung fight is a hung
   * game: the field stops taking input while combat is live.
   */
  fightCap: 30 * 180
}

/** Large field landmark, anchored by its only interactive `X` doorway. */
const DUNGEON_ENTRANCE_ART = [
  '          .-^-.',
  "       .-'#####'-.",
  '   ___/## CRIPTA ##\\___',
  '  /_|_[]_|#####|_[]_|_\\',
  ' /  |    | .-. |    |  \\',
  '| []|    |(o o)|    |[] |',
  '|   | *  | |_| |  * |   |',
  '|___|/|\\_| /X\\ |_/|\\|___|',
  '   /_____/___\\_____\\',
  '  === === === === ==='
]
const DUNGEON_CLEARANCE = 15

/** Monumental ruined gate, anchored by the only interactive `O` core. */
const WORLD_BOSS_PORTAL_ART = [
  '    [portal-del-coloso]',
  '       *       *',
  '    .-^-.     .-^-.',
  ' __/#####\\___/#####\\__',
  '/##  <>  .---.  <>  ##\\',
  '|#      /~~~~~\\      #|',
  '|#  /\\ |~^~^~| /\\  #|',
  '|#  \\/ |~~O~~| \\/  #|',
  '|#     /~~~~~~~\\     #|',
  '\\##  /___/ \\___\\  ##/',
  ' \\_____/=====\\_____/',
  '   ..../__|__\\....',
  '  ~=~=~=~=~=~=~=~=~'
].map((row) => row.padEnd(27))
const WORLD_BOSS_PORTAL_CLEARANCE = 15
const WORLD_BOSS_PORTAL_CADENCE = 5
const WORLD_BOSS_PORTAL_ENERGY = [
  [
    [0, -2, '^'],
    [-2, -1, '^'],
    [2, -1, '^'],
    [-2, 0, '~'],
    [2, 0, '~']
  ],
  [
    [-2, -2, '^'],
    [2, -2, '^'],
    [0, -1, '*'],
    [-1, 0, '^'],
    [1, 0, '^']
  ],
  [
    [-1, -2, '~'],
    [1, -2, '~'],
    [-2, -1, '^'],
    [0, -1, '^'],
    [2, -1, '^']
  ]
]

/**
 * The hero profile is world.js's business. Read the numbers back out of a
 * throwaway World rather than copying them here, where the two would drift
 * apart the first time somebody rebalances the hero.
 */
const HERO = (() => {
  const w = new World()
  return { hp: w.hero.base.hp, potions: w.potions }
})()

/**
 * mulberry32. Thirty-two bits of state, no dependency, and the same sequence on
 * every runtime, which is the only property the field needs from an rng.
 * @param {number} seed
 * @returns {() => number} next float in [0, 1)
 */
function makeRng(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param {() => number} next
 * @param {number} lo
 * @param {number} hi - inclusive
 * @returns {number}
 */
function randInt(next, lo, hi) {
  return lo + Math.floor(next() * (hi - lo + 1))
}

/**
 * @template T
 * @param {() => number} next
 * @param {T[]} list
 * @returns {T}
 */
function pick(next, list) {
  return list[Math.floor(next() * list.length)]
}

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Distance as the eye reads it, not as the grid stores it. See Y_SCALE.
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {number}
 */
function vdist(ax, ay, bx, by) {
  const dx = ax - bx
  const dy = (ay - by) * Y_SCALE
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Square collision distance for actor hitboxes. Unlike zone distance this is
 * gameplay geometry: one vertical tile and one horizontal tile are equal.
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {number}
 */
function hitdist(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by))
}

/**
 * Which difficulty ring a cell falls in. Anything past the last band belongs to
 * the last band, so the map can grow without the zone table having to.
 * @param {{x: number, y: number}} gate
 * @param {number} x
 * @param {number} y
 * @returns {number} index into CONTENT.zones
 */
function zoneAt(gate, x, y) {
  const d = vdist(x, y, gate.x, gate.y)
  for (let i = 0; i < CONTENT.zones.length; i++) {
    if (d <= CONTENT.zones[i].until) return i
  }
  return CONTENT.zones.length - 1
}

/**
 * Which foes live in a ring.
 *
 * A foe declares the ring it belongs to and the ring never declares its foes,
 * so shipping a new enemy over the air is still a pure data update: give it
 * `zone: 2` and it starts appearing there without the field being rebuilt. A
 * ring nobody claims falls back inward rather than spawning nothing, which is
 * what keeps a half-finished content update from producing an empty map.
 *
 * @param {number} index
 * @returns {object[]}
 */
function poolFor(index) {
  const all = Object.keys(CONTENT.foes).map((k) => CONTENT.foes[k])
  for (let i = index; i >= 0; i--) {
    const tier = all.filter((f) => (f.zone || 0) === i)
    if (tier.length) return tier
  }
  return all
}

/**
 * Ticks between drift steps for a kind of foe. Slower foes shuffle less often,
 * which is what makes a golem read as a hazard you can walk around and a
 * mosquito read as something that finds you.
 * @param {object} def
 * @returns {number}
 */
function driftTicks(def) {
  const speed = (def.stats && def.stats.speed) || 0.1
  return clamp(Math.round(FIELD.wander * (0.25 / speed)), FIELD.wanderMin, FIELD.wanderMax)
}

class Field {
  /**
   * @param {object} [opts]
   * @param {number} [opts.seed] - same seed, same field
   * @param {number} [opts.width]
   * @param {number} [opts.height]
   * @param {string} [opts.script] - the player's script source
   * @param {object} [opts.player] - persistent Player or snapshot to mirror
   */
  constructor(opts = {}) {
    this.seed = opts.seed ?? 1
    this.mode = 'field'
    this.width = opts.width ?? FIELD.width
    this.height = opts.height ?? FIELD.height

    /** The town is west. This cell is the way back in. */
    this.gate = { x: 1, y: Math.floor(this.height / 2) }
    /** A stone crypt in the expanded south-east meadow starts the dungeon run. */
    this.dungeonEntrance = { x: this.width - 16, y: this.height - 5 }
    /** The far north-east yermo holds the portal to the world-boss domain. */
    this.worldBossPortal = { x: this.width - 14, y: 12 }

    this.rng = makeRng(this.seed)
    this.drift = makeRng((this.seed ^ 0x9e3779b9) >>> 0)

    this.time = 0
    this.foes = []
    this.combat = null
    this.graceUntil = 0
    /** Transcript of the fight that just ended, kept for the hud to show. */
    this.lastFight = null
    /** Recent one-line notices for the hud. */
    this.news = []

    this.nodes = []
    this.scriptErrors = []

    const supplied =
      opts.player && typeof opts.player.snapshot === 'function'
        ? opts.player.snapshot()
        : opts.player || {}
    this.player = {
      x: this.gate.x + 1,
      y: this.gate.y,
      hp: Number.isFinite(Number(supplied.hp)) ? Number(supplied.hp) : HERO.hp,
      maxhp: Number.isFinite(Number(supplied.maxhp)) ? Number(supplied.maxhp) : HERO.hp,
      potions: Number.isFinite(Number(supplied.potions)) ? Number(supplied.potions) : HERO.potions,
      gold: Number.isFinite(Number(supplied.gold)) ? Number(supplied.gold) : 0,
      xp: Number.isFinite(Number(supplied.xp)) ? Number(supplied.xp) : 0,
      kills: 0,
      deaths: 0
    }
    // The Colossus no longer shares the meadow. Its independent volcanic arena
    // owns the WorldBossEvent; this field only owns the portal that leads there.
    this.boss = null

    if (opts.script !== undefined) this.setScript(opts.script)
    this.populate()
  }

  /**
   * Install the player's script. Parse errors are kept rather than thrown: a
   * broken script has to leave the player standing in the field able to walk
   * home, not crash the game they were editing it from.
   * @param {string} source
   * @returns {object[]} parse errors, empty when the script is clean
   */
  setScript(source) {
    const out = parse(source)
    this.nodes = out.nodes
    this.scriptErrors = out.errors
    return this.scriptErrors
  }

  /** Fill every ring with its quota of foes. */
  populate() {
    let id = 0
    for (let z = 0; z < CONTENT.zones.length; z++) {
      for (let n = 0; n < CONTENT.zones[z].foes; n++) {
        const spot = this.findSpot(z)
        if (!spot) continue
        this.foes.push(this.makeFoe(id++, z, spot))
      }
    }
  }

  /**
   * A free cell inside a ring, by rejection sampling.
   *
   * Sampling beats solving for the ring analytically: the bands are defined in
   * visual cells against a rectangle the player can resize, so the shape of a
   * ring is not something worth deriving. Bounded attempts, and a ring that
   * cannot be filled just holds fewer foes.
   *
   * @param {number} z
   * @returns {{x: number, y: number} | null}
   */
  findSpot(z) {
    for (let tries = 0; tries < 400; tries++) {
      const x = randInt(this.rng, 1, this.width - 2)
      const y = randInt(this.rng, 1, this.height - 2)
      if (zoneAt(this.gate, x, y) !== z) continue
      if (vdist(x, y, this.gate.x, this.gate.y) < FIELD.safe) continue
      if (this.boss && this.boss.occupies(x, y)) continue
      if (hitdist(x, y, this.dungeonEntrance.x, this.dungeonEntrance.y) < DUNGEON_CLEARANCE) {
        continue
      }
      if (
        hitdist(x, y, this.worldBossPortal.x, this.worldBossPortal.y) < WORLD_BOSS_PORTAL_CLEARANCE
      ) {
        continue
      }
      if (this.foeAt(x, y)) continue
      return { x, y }
    }
    return null
  }

  /**
   * @param {number} id
   * @param {number} z
   * @param {{x: number, y: number}} spot
   * @returns {object}
   */
  makeFoe(id, z, spot) {
    const def = pick(this.rng, poolFor(z))
    return {
      id,
      kind: def.id,
      zone: z,
      x: spot.x,
      y: spot.y,
      /** Drift is measured from here, so a foe cannot wander out of its ring. */
      home: { x: spot.x, y: spot.y },
      dead: false,
      respawnAt: 0,
      nextStep: this.time + randInt(this.drift, 1, driftTicks(def))
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {object} [ignore]
   * @returns {object | null}
   */
  foeAt(x, y, ignore) {
    for (const f of this.foes) {
      if (f.dead || f === ignore) continue
      if (f.x === x && f.y === y) return f
    }
    return null
  }

  /**
   * Walk one step. Refused while a fight is live: the point of the two layers
   * is that during combat the player's only input is the script they already
   * wrote, so letting the arrows work here would quietly undo the whole design.
   *
   * @param {number} dx
   * @param {number} dy
   * @returns {object[]} events
   */
  walk(dx, dy) {
    if (this.combat) return [{ type: 'busy' }]

    const nx = clamp(this.player.x + Math.sign(dx), 0, this.width - 1)
    const ny = clamp(this.player.y + Math.sign(dy), 0, this.height - 1)
    if (nx === this.player.x && ny === this.player.y) return []

    // Actors never occupy the same logical tile. Pushing into a monster is an
    // attack input against its hitbox, not movement through its sprite.
    const blocker = this.foeAt(nx, ny)
    if (blocker) {
      const events = []
      this.startFight(blocker, FIELD.hitbox, events)
      return events
    }

    if (this.boss && this.boss.occupies(nx, ny)) {
      return [{ type: 'boss-blocked', text: 'el cuerpo del Coloso bloquea el paso; pulsa f' }]
    }

    this.player.x = nx
    this.player.y = ny

    if (nx === this.gate.x && ny === this.gate.y) return [{ type: 'town' }]
    if (nx === this.dungeonEntrance.x && ny === this.dungeonEntrance.y) {
      return [{ type: 'dungeon-enter' }]
    }
    if (nx === this.worldBossPortal.x && ny === this.worldBossPortal.y) {
      return [{ type: 'boss-enter' }]
    }
    const events = []
    if (this.boss) events.push(...this.boss.touch(this.player, this.time))
    if (events.some((event) => event.type === 'boss-death')) return events
    this.hunt(events)
    return events
  }

  /**
   * Advance the field one tick. The caller runs this at world.js's TPS so that
   * one field tick is one combat tick and the two clocks cannot drift.
   * @returns {object[]} events: aggro, win, death, flee, respawn
   */
  tick() {
    const events = []
    this.time++

    if (this.combat) {
      this.stepFight(events)
      return events
    }

    this.wander(events)
    if (!this.combat && this.boss) events.push(...this.boss.tick(this.player, this.time))
    return events
  }

  /** Strike the world boss without entering the one-on-one combat state. */
  attackBoss(attack = {}) {
    if (this.combat || !this.boss) return [{ type: 'busy' }]
    return this.boss.strike(this.player, attack, this.time)
  }

  /**
   * Foes shuffle and corpses come back.
   * @param {object[]} events
   */
  wander(events) {
    for (const f of this.foes) {
      if (f.dead) {
        if (this.time >= f.respawnAt) this.revive(f, events)
        continue
      }
      if (this.time < f.nextStep) continue

      const def = CONTENT.foes[f.kind]
      f.nextStep = this.time + driftTicks(def)

      const nx = clamp(f.x + randInt(this.drift, -1, 1), 1, this.width - 2)
      const ny = clamp(f.y + randInt(this.drift, -1, 1), 1, this.height - 2)
      const zone = CONTENT.zones[f.zone]

      // Four fences, and all four matter. The leash keeps a foe near where
      // the seed put it, so the map a player learned stays learnable. The zone
      // check stops the far ring from leaking its monsters into the near one,
      // which would make difficulty-by-distance a lie. The safe radius keeps
      // anything from parking on the town doorstep. Actor occupancy keeps a
      // moving monster beside the player instead of drawing both on one cell.
      if (vdist(nx, ny, f.home.x, f.home.y) > zone.leash) continue
      if (zoneAt(this.gate, nx, ny) !== f.zone) continue
      if (vdist(nx, ny, this.gate.x, this.gate.y) < FIELD.safe) continue
      if (this.boss && this.boss.occupies(nx, ny)) continue
      if (hitdist(nx, ny, this.dungeonEntrance.x, this.dungeonEntrance.y) < DUNGEON_CLEARANCE) {
        continue
      }
      if (
        hitdist(nx, ny, this.worldBossPortal.x, this.worldBossPortal.y) <
        WORLD_BOSS_PORTAL_CLEARANCE
      ) {
        continue
      }
      if (this.foeAt(nx, ny, f)) continue

      if (nx === this.player.x && ny === this.player.y) {
        this.startFight(f, FIELD.hitbox, events)
        return
      }

      f.x = nx
      f.y = ny
    }

    // A patrol is allowed to touch the hitbox now. This is not a random
    // encounter: the two actors are visibly adjacent on the same map.
    this.hunt(events)
  }

  /**
   * Bring a dead foe back at its home cell, re-rolled from its ring's pool so
   * the same patch of grass is not the same fight forever.
   * @param {object} f
   * @param {object[]} events
   */
  revive(f, events) {
    const def = pick(this.rng, poolFor(f.zone))
    f.kind = def.id
    f.x = f.home.x
    f.y = f.home.y
    f.dead = false
    f.respawnAt = 0
    f.nextStep = this.time + randInt(this.drift, 1, driftTicks(def))
    events.push({ type: 'respawn', id: f.id, kind: f.kind, zone: f.zone })
  }

  /**
   * Does any visible hitbox touch the player after movement. The nearest one
   * wins, so walking between two foes engages the one actually contacted.
   * @param {object[]} events
   */
  hunt(events) {
    if (this.time < this.graceUntil) return

    let best = null
    let bestDist = Infinity

    for (const f of this.foes) {
      if (f.dead) continue
      const d = hitdist(f.x, f.y, this.player.x, this.player.y)
      if (d > FIELD.hitbox || d >= bestDist) continue
      best = f
      bestDist = d
    }

    if (best) this.startFight(best, bestDist, events)
  }

  /**
   * Hand control to the script.
   *
   * The player is lent to the World rather than rebuilt inside it: hp carries
   * in from the last fight and potions carry in from the shop, so walking out
   * hurt is a real state and going home to heal is a real decision.
   *
   * The opening distance is the distance you were spotted at, mapped onto the
   * arena. Sneaking up on something means the fight starts inside sword range,
   * and blundering into aggro from the edge means it starts at full range. That
   * is the one place where how the player walks feeds into how the script has
   * to read, and it is worth the four lines.
   *
   * @param {object} f
   * @param {number} dist - visual cells at the moment of aggro
   * @param {object[]} events
   */
  startFight(f, dist, events) {
    const def = CONTENT.foes[f.kind]
    const world = new World(f.kind)

    world.hero.base.hp = this.player.maxhp
    world.hero.hp = this.player.hp
    world.potions = this.player.potions

    // Contact on the field is contact in the simulation too. Mapping the old
    // aggro radius into an arena made adjacent sprites begin several metres
    // apart and contradicted what the player could see.
    world.foe.x = clamp(Math.round(dist), 1, ARENA)

    this.combat = {
      world,
      foe: f,
      startedAt: this.time,
      lastSay: '',
      lastProblem: '',
      logCursor: 0
    }
    this.say(`entraste en la hitbox del ${def.name}: ataca con f o espacio`)
    events.push({ type: 'contact', id: f.id, kind: f.kind, zone: f.zone, dist: Math.round(dist) })
  }

  /**
   * One tick of the fight: read the world, run the script over it, fold the
   * commands in, step. The script is re-read every tick by design, so a player
   * editing the file mid-fight sees the change land on the next frame.
   * @param {object[]} events
   */
  stepFight(events) {
    const c = this.combat
    const w = c.world

    const view = w.snapshot()
    const out = run(this.nodes, view)
    const problems = w.readIntent(out.actions)

    // The script speaks 30 times a second. Only the change is news, otherwise
    // one `> hp @hp@` line buries the combat log in a second flat.
    const said = out.says.join(' | ')
    if (said && said !== c.lastSay) {
      for (const s of out.says) w.say(s)
      c.lastSay = said
    }
    if (problems.length && problems[0] !== c.lastProblem) {
      w.say(problems[0])
      c.lastProblem = problems[0]
    }

    w.applyIntent()
    w.step()

    // The arena used to be the only place that exposed this transcript. With
    // combat staying on the field, copy each new exchange into field news so
    // the normal log reports who hit whom and for how much.
    for (let i = c.logCursor; i < w.log.length; i++) this.say(w.log[i].text)
    c.logCursor = w.log.length

    if (w.over) this.endFight(events)
    else if (this.time - c.startedAt > FIELD.fightCap) this.endFight(events, 'huyeron')
  }

  /**
   * Settle up and give the player back their arrows.
   * @param {object[]} events
   * @param {string} [reason] - set when the fight timed out instead of ending
   */
  endFight(events, reason) {
    const c = this.combat
    const w = c.world
    const def = CONTENT.foes[c.foe.kind]
    const zone = CONTENT.zones[c.foe.zone]

    this.player.hp = Math.max(0, Math.ceil(w.hero.hp))
    this.player.potions = w.potions
    /**
     * The fight's log outlives the fight. The player has just watched a rule
     * they wrote win or lose and the first thing they will do is go read why,
     * so throwing the transcript away with the World would be throwing away the
     * only feedback the game gives.
     */
    this.lastFight = { kind: c.foe.kind, over: reason || w.over, log: w.log.slice() }
    this.combat = null
    this.graceUntil = this.time + FIELD.grace

    if (reason) {
      this.say(`el ${def.name} pierde interes`)
      events.push({ type: 'flee', kind: def.id })
      return
    }

    if (w.over === 'ganaste') {
      const gold = randInt(this.rng, def.drop.gold[0], def.drop.gold[1])
      const xp = def.drop.xp

      this.player.gold += gold
      this.player.xp += xp
      this.player.kills++

      c.foe.dead = true
      c.foe.respawnAt = this.time + zone.respawn

      // The amounts travel in the event and are announced by whoever banks
      // them. Saying them here meant the field narrated a payout it does not
      // pay: these numbers land on the excursion's own throwaway sheet, while
      // the gold the player keeps is credited later by settle(). The log said
      // `+5 oro` and the purse went up by 12, every single kill.
      events.push({ type: 'win', id: c.foe.id, kind: def.id, gold, xp, respawnIn: zone.respawn })
      return
    }

    // Death is cheap on purpose. The cost of losing is the walk back, which is
    // time to think about the rule that lost, and that is the only thing this
    // game wants the player doing.
    this.player.deaths++
    this.player.hp = this.player.maxhp
    this.player.x = this.gate.x + 1
    this.player.y = this.gate.y
    // Not announced here either, and for the same reason: waking up in the
    // church is something settle() decides, not the field. Both layers used to
    // say it and the log printed two near identical lines, one under the other.
    events.push({ type: 'death', kind: def.id })
  }

  /**
   * @param {string} text
   */
  say(text) {
    this.news.push({ time: this.time, text })
    if (this.news.length > 40) this.news.shift()
  }

  /** @returns {object} the current ring the player is standing in */
  get zone() {
    return CONTENT.zones[zoneAt(this.gate, this.player.x, this.player.y)]
  }

  /**
   * Everything a view needs and nothing it can write through.
   * @returns {object}
   */
  snapshot() {
    const w = this.combat && this.combat.world
    return {
      time: this.time,
      width: this.width,
      height: this.height,
      gate: { ...this.gate },
      dungeonEntrance: { ...this.dungeonEntrance },
      worldBossPortal: { ...this.worldBossPortal },
      mode: 'field',
      player: { ...this.player },
      zone: this.zone.name,
      fighting: !!this.combat,
      combat: w ? { ...w.snapshot(), over: w.over, log: w.log.slice(-8) } : null,
      boss: this.boss ? this.boss.snapshot() : null,
      foes: this.foes
        .filter((f) => !f.dead)
        .map((f) => {
          const active = this.combat && this.combat.foe === f
          const def = CONTENT.foes[f.kind]
          return {
            id: f.id,
            kind: f.kind,
            zone: f.zone,
            x: f.x,
            y: f.y,
            glyph: def.glyph,
            name: def.name,
            active,
            hp: active ? Math.max(0, Math.ceil(this.combat.world.foe.hp)) : def.stats.hp,
            maxhp: def.stats.hp
          }
        }),
      news: this.news.slice(-6)
    }
  }

  /**
   * Draw the field into rows of ascii, camera centred on the player.
   *
   * Pure: it reads state and returns strings, which is what makes it safe to
   * call from a bare-tui `view()`. Ascii 128 only, because one character that
   * renders as a box shifts every column after it.
   *
   * @param {number} [cols]
   * @param {number} [rows]
   * @param {boolean} [includeActors] include the one-cell simulation markers
   * @returns {string[]}
   */
  render(cols, rows, includeActors = true) {
    const vw = clamp(cols ?? this.width, 8, this.width)
    const vh = clamp(rows ?? this.height, 4, this.height)
    const camera = bossCamera(
      this.player,
      this.boss && this.boss.snapshot(),
      this.width,
      this.height,
      vw,
      vh
    )
    const { ox, oy } = camera

    const grid = []
    for (let y = 0; y < vh; y++) {
      const row = new Array(vw)
      for (let x = 0; x < vw; x++) {
        const wx = ox + x
        const wy = oy + y
        // A sparse fixed speckle, keyed off world coordinates so it scrolls
        // under the player. Without it an empty field gives the eye nothing to
        // measure movement against and walking feels like standing still.
        const zone = zoneAt(this.gate, wx, wy)
        const z = CONTENT.zones[zone]
        const noise = (wx * 17 + wy * 31 + wx * wy * 3) % 97
        const onRoad = wx <= 20 && Math.abs(wy - this.gate.y) <= 1
        if (onRoad) row[x] = noise % 5 === 0 ? '%' : ':'
        else if (noise === 0 || noise === 37) row[x] = 'o'
        else if (zone === 0 && (noise === 11 || noise === 53)) row[x] = '*'
        else if (zone === 0 && noise % 13 === 0) row[x] = '"'
        else if (zone > 0 && noise % 9 === 0) row[x] = ','
        else row[x] = noise % 5 === 0 ? z.ground : ' '
      }
      grid.push(row)
    }

    const put = (x, y, ch) => {
      const gx = x - ox
      const gy = y - oy
      if (gx < 0 || gy < 0 || gx >= vw || gy >= vh) return
      grid[gy][gx] = ch
    }

    put(this.gate.x, this.gate.y, '<')
    // The facade is terrain, not an actor: its empty cells stay transparent and
    // the one X in the artwork is also the exact logical entry tile.
    const doorRow = DUNGEON_ENTRANCE_ART.findIndex((line) => line.includes('X'))
    const doorCol = DUNGEON_ENTRANCE_ART[doorRow].indexOf('X')
    for (let sy = 0; sy < DUNGEON_ENTRANCE_ART.length; sy++) {
      const line = DUNGEON_ENTRANCE_ART[sy]
      for (let sx = 0; sx < line.length; sx++) {
        if (line[sx] === ' ') continue
        put(this.dungeonEntrance.x + sx - doorCol, this.dungeonEntrance.y + sy - doorRow, line[sx])
      }
    }
    const portalRow = WORLD_BOSS_PORTAL_ART.findIndex((line) => line.includes('O'))
    const portalCol = WORLD_BOSS_PORTAL_ART[portalRow].indexOf('O')
    for (let sy = 0; sy < WORLD_BOSS_PORTAL_ART.length; sy++) {
      const line = WORLD_BOSS_PORTAL_ART[sy]
      for (let sx = 0; sx < line.length; sx++) {
        if (line[sx] === ' ') continue
        put(
          this.worldBossPortal.x + sx - portalCol,
          this.worldBossPortal.y + sy - portalRow,
          line[sx]
        )
      }
    }
    const portalPhase =
      WORLD_BOSS_PORTAL_ENERGY[
        Math.floor(this.time / WORLD_BOSS_PORTAL_CADENCE) % WORLD_BOSS_PORTAL_ENERGY.length
      ]
    for (const [dx, dy, ch] of portalPhase) {
      put(this.worldBossPortal.x + dx, this.worldBossPortal.y + dy, ch)
    }
    if (includeActors) {
      const boss = this.boss && this.boss.snapshot()
      if (boss && !boss.defeated) put(boss.x, boss.y, 'W')
      for (const warning of (boss && boss.telegraphs) || []) {
        put(warning.x, warning.y, warning.glyph || '!')
      }
      for (const hazard of (boss && boss.hazards) || []) put(hazard.x, hazard.y, hazard.glyph)
      for (const f of this.foes) {
        if (f.dead) continue
        put(f.x, f.y, CONTENT.foes[f.kind].glyph)
      }
      put(this.player.x, this.player.y, '@')
    }

    return grid.map((row) => row.join(''))
  }
}

module.exports = {
  Field,
  FIELD,
  Y_SCALE,
  HERO,
  DUNGEON_ENTRANCE_ART,
  DUNGEON_CLEARANCE,
  WORLD_BOSS_PORTAL_ART,
  WORLD_BOSS_PORTAL_CLEARANCE,
  WORLD_BOSS_PORTAL_CADENCE,
  makeRng,
  randInt,
  vdist,
  hitdist,
  zoneAt,
  poolFor
}
