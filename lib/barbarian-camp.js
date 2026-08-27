'use strict'

const CONTENT = require('./content.js')
const { Field, FIELD, BARBARIAN_SETTLEMENTS, makeRng, randInt, hitdist } = require('./field.js')

const BARBARIAN_CAMP = {
  width: 108,
  height: 46,
  leash: 12
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value
}

function campDefinition(id) {
  return (
    BARBARIAN_SETTLEMENTS.find((settlement) => settlement.id === id) || BARBARIAN_SETTLEMENTS[0]
  )
}

function normalCampState(state, campId) {
  const source = state && state.campId === campId ? state : {}
  return {
    campId,
    defeated: Array.isArray(source.defeated) ? [...new Set(source.defeated.map(String))] : [],
    completed: !!source.completed
  }
}

function campRows(campId, width = BARBARIAN_CAMP.width, height = BARBARIAN_CAMP.height) {
  const camp = campDefinition(campId)
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ((x * 17 + y * 29 + x * y) % 37 === 0 ? ',' : ' '))
  )
  const set = (x, y, ch) => {
    if (x >= 0 && y >= 0 && x < width && y < height) grid[y][x] = ch
  }
  const fill = (x, y, w, h, ch) => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) set(col, row, ch)
    }
  }
  const write = (x, y, text) => {
    for (let index = 0; index < String(text).length; index++) set(x + index, y, text[index])
  }
  const border = (x, y, w, h) => {
    for (let col = x; col < x + w; col++) {
      set(col, y, '#')
      set(col, y + h - 1, '#')
    }
    for (let row = y; row < y + h; row++) {
      set(x, row, '#')
      set(x + w - 1, row, '#')
    }
  }
  const tent = (x, y, w, label) => {
    const roof = '/'.concat('^'.repeat(Math.max(1, w - 2)), '\\')
    write(x, y, roof)
    write(x, y + 1, '|'.concat(' '.repeat(w - 2), '|'))
    write(x + Math.max(1, Math.floor((w - label.length) / 2)), y + 1, label)
    write(x, y + 2, '|'.concat(' '.repeat(w - 2), '|'))
    write(x, y + 3, '\\'.concat('_'.repeat(Math.max(1, w - 2)), '/'))
  }

  border(0, 0, width, height)
  for (let x = 3; x < width - 2; x += 4) set(x, 1, '^')
  write(Math.floor((width - camp.name.length - 19) / 2), 2, `asentamiento ${camp.name}`)

  // A central raid road divides tents, stores and the chief's longhouse.
  fill(51, 3, 7, height - 4, '.')
  fill(4, 21, width - 8, 5, '.')
  tent(37, 5, 34, 'casa del caudillo')
  tent(9, 8, 24, 'guerreros')
  tent(75, 8, 24, 'jabalinas')
  tent(8, 30, 27, 'pieles y grano')
  tent(73, 30, 27, 'botin robado')

  // Palisade lanes and fire pits make the arena a settlement rather than an
  // empty combat rectangle, while the broad crossroads keep every foe reachable.
  border(4, 4, 4, 17)
  border(width - 8, 4, 4, 17)
  border(4, 27, 4, 14)
  border(width - 8, 27, 4, 14)
  write(23, 17, '---[ empalizada ]---')
  write(66, 17, '---[ empalizada ]---')
  write(19, 38, 'o== corral ==o')
  write(76, 38, 'o== forja ==o')
  write(48, 20, '   (**)   ')
  write(48, 21, '  ((**))  ')
  write(48, 22, '   /||\\   ')
  write(46, 23, '--- fuego ---')

  const exit = { x: 54, y: height - 2 }
  write(exit.x - 5, exit.y - 2, '/----.----\\')
  write(exit.x - 5, exit.y - 1, '|    .    |')
  write(exit.x - 5, exit.y, '=====U=====')
  set(exit.x, exit.y, 'U')

  return {
    rows: grid.map((row) => row.join('')),
    exit,
    spawn: { x: exit.x, y: exit.y - 3 },
    spawnPoints: [
      { x: 19, y: 15 },
      { x: 88, y: 15 },
      { x: 18, y: 28 },
      { x: 89, y: 28 },
      { x: 42, y: 18 },
      { x: 66, y: 29 },
      { x: 54, y: 12 }
    ]
  }
}

function walkable(ch) {
  return [' ', '.', ',', ':', ';', '*', 'U'].includes(ch)
}

class BarbarianCamp extends Field {
  constructor(opts = {}) {
    const camp = campDefinition(opts.campId)
    const seed = ((Number(opts.seed) || 1) ^ Math.imul(camp.x + camp.y, 0x45d9f3b)) >>> 0
    super({ ...opts, seed, width: BARBARIAN_CAMP.width, height: BARBARIAN_CAMP.height })

    this.mode = 'barbarian-camp'
    this.camp = { ...camp, roster: camp.roster.slice() }
    this.state = normalCampState(opts.state, camp.id)
    this.layout = campRows(camp.id, this.width, this.height)
    this.gate = { ...this.layout.exit }
    this.guides = []
    this.settlements = []
    this.boss = null
    this.foes = []
    this.rng = makeRng(seed)
    this.drift = makeRng((seed ^ 0x9e3779b9) >>> 0)
    this.player.x = Number.isFinite(Number(opts.x)) ? Number(opts.x) : this.layout.spawn.x
    this.player.y = Number.isFinite(Number(opts.y)) ? Number(opts.y) : this.layout.spawn.y
    if (!this.isWalkable(this.player.x, this.player.y)) {
      this.player.x = this.layout.spawn.x
      this.player.y = this.layout.spawn.y
    }
    this.populateCamp()
    this.say(`${this.camp.name}: quedan ${this.remaining} barbaros dentro de la empalizada`)
  }

  populateCamp() {
    const defeated = new Set(this.state.defeated)
    for (let index = 0; index < this.camp.roster.length; index++) {
      const id = `${this.camp.id}-${index}`
      const kind = this.camp.roster[index]
      const spot = this.layout.spawnPoints[index % this.layout.spawnPoints.length]
      const def = CONTENT.foes[kind]
      this.foes.push({
        id,
        kind,
        zone: 'barbarian-camp',
        x: spot.x,
        y: spot.y,
        home: { ...spot },
        dead: defeated.has(id),
        respawnAt: Infinity,
        nextStep:
          this.time + randInt(this.drift, 14, Math.max(20, Math.round(48 / def.stats.speed)))
      })
    }
  }

  isWalkable(x, y) {
    const row = this.layout && this.layout.rows[y]
    return !!row && walkable(row[x])
  }

  get remaining() {
    return this.foes.filter((foe) => !foe.dead).length
  }

  get zone() {
    return {
      id: 'barbarian-camp',
      name: `asentamiento ${this.camp ? this.camp.name : 'barbaro'}`,
      leash: BARBARIAN_CAMP.leash,
      respawn: Infinity
    }
  }

  walk(dx, dy) {
    if (this.combat) return [{ type: 'busy' }]
    const nx = clamp(this.player.x + Math.sign(dx), 0, this.width - 1)
    const ny = clamp(this.player.y + Math.sign(dy), 0, this.height - 1)
    if (nx === this.player.x && ny === this.player.y) return []

    const blocker = this.foeAt(nx, ny)
    if (blocker) {
      const events = []
      this.startFight(blocker, FIELD.hitbox, events)
      return events
    }
    if (!this.isWalkable(nx, ny)) {
      return [{ type: 'barbarian-wall', text: 'la empalizada bloquea el paso' }]
    }

    this.player.x = nx
    this.player.y = ny
    if (nx === this.layout.exit.x && ny === this.layout.exit.y) {
      return [
        {
          type: 'barbarian-exit',
          campId: this.camp.id,
          cleared: this.remaining === 0,
          reward: this.camp.reward
        }
      ]
    }

    const events = []
    this.hunt(events)
    return events
  }

  wander(events) {
    for (const foe of this.foes) {
      if (foe.dead || foe.kind === 'barbarian_chief' || this.time < foe.nextStep) continue
      const def = CONTENT.foes[foe.kind]
      foe.nextStep = this.time + clamp(Math.round(48 * (0.25 / def.stats.speed)), 18, 120)
      const nx = clamp(foe.x + randInt(this.drift, -1, 1), 1, this.width - 2)
      const ny = clamp(foe.y + randInt(this.drift, -1, 1), 1, this.height - 2)
      if (!this.isWalkable(nx, ny)) continue
      if (hitdist(nx, ny, foe.home.x, foe.home.y) > BARBARIAN_CAMP.leash) continue
      if (this.foeAt(nx, ny, foe)) continue
      if (nx === this.layout.exit.x && ny === this.layout.exit.y) continue
      if (nx === this.player.x && ny === this.player.y) {
        this.startFight(foe, FIELD.hitbox, events)
        return
      }
      foe.x = nx
      foe.y = ny
    }
    this.hunt(events)
  }

  revive() {}

  endFight(events, reason) {
    const combat = this.combat
    const world = combat.world
    const def = CONTENT.foes[combat.foe.kind]
    this.player.hp = Math.max(0, Math.ceil(world.hero.hp))
    this.player.potions = world.potions
    this.lastFight = { kind: combat.foe.kind, over: reason || world.over, log: world.log.slice() }
    this.combat = null
    this.graceUntil = this.time + FIELD.grace

    if (reason) {
      this.say(`el ${def.name} pierde interes`)
      events.push({ type: 'flee', kind: def.id })
      return
    }
    if (world.over === 'ganaste') {
      const gold = randInt(this.rng, def.drop.gold[0], def.drop.gold[1])
      const xp = def.drop.xp
      combat.foe.dead = true
      const defeated = new Set(this.state.defeated)
      defeated.add(String(combat.foe.id))
      this.state.defeated = [...defeated]
      this.state.completed = this.remaining === 0
      if (this.state.completed) {
        this.say('la empalizada queda en silencio: volve por U para reclamar el botin')
      }
      events.push({ type: 'win', id: combat.foe.id, kind: def.id, gold, xp, respawnIn: 0 })
      return
    }

    this.player.deaths++
    this.player.hp = this.player.maxhp
    this.player.x = this.layout.spawn.x
    this.player.y = this.layout.spawn.y
    events.push({ type: 'death', kind: def.id })
  }

  snapshot() {
    const snap = super.snapshot()
    return {
      ...snap,
      mode: 'barbarian-camp',
      camp: {
        id: this.camp.id,
        name: this.camp.name,
        reward: this.camp.reward
      },
      zone: `asentamiento ${this.camp.name}`,
      exit: { ...this.layout.exit },
      remaining: this.remaining,
      completed: this.state.completed
    }
  }

  render(cols, rows, includeActors = true) {
    const vw = clamp(cols ?? this.width, 8, this.width)
    const vh = clamp(rows ?? this.height, 4, this.height)
    const ox = clamp(Math.round(this.player.x) - (vw >> 1), 0, Math.max(0, this.width - vw))
    const oy = clamp(Math.round(this.player.y) - (vh >> 1), 0, Math.max(0, this.height - vh))
    const grid = []
    for (let y = 0; y < vh; y++) {
      const source = this.layout.rows[oy + y] || ''
      grid.push(
        source
          .slice(ox, ox + vw)
          .padEnd(vw)
          .split('')
      )
    }
    const put = (x, y, ch) => {
      const gx = x - ox
      const gy = y - oy
      if (gx >= 0 && gy >= 0 && gx < vw && gy < vh) grid[gy][gx] = ch
    }
    if (includeActors) {
      for (const foe of this.foes) {
        if (!foe.dead) put(foe.x, foe.y, CONTENT.foes[foe.kind].glyph)
      }
      put(this.player.x, this.player.y, '@')
    }
    return grid.map((row) => row.join(''))
  }

  toJSON() {
    return normalCampState(this.state, this.camp.id)
  }
}

module.exports = {
  BarbarianCamp,
  BARBARIAN_CAMP,
  campRows,
  campDefinition,
  normalCampState
}
