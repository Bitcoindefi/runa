'use strict'

const CONTENT = require('./content.js')
const { Field, FIELD, makeRng, randInt, hitdist } = require('./field.js')

const DUNGEON = {
  width: 112,
  height: 40,
  floors: 3,
  leash: 8
}

const FLOOR_ROSTERS = {
  1: [
    'slime',
    'slime',
    'slime',
    'slime',
    'slime',
    'slime',
    'slime',
    'slime',
    'skeleton',
    'skeleton',
    'skeleton',
    'skeleton'
  ],
  2: [
    'skeleton',
    'skeleton',
    'skeleton',
    'skeleton_knight',
    'skeleton_knight',
    'skeleton_knight',
    'skeleton_knight',
    'skeleton_archer',
    'skeleton_archer',
    'skeleton_archer',
    'skeleton_archer'
  ],
  3: [
    'skeleton_knight',
    'skeleton_knight',
    'skeleton_archer',
    'skeleton_archer',
    'skeleton_elite',
    'skeleton_elite',
    'skeleton_elite',
    'skeleton_elite',
    'skeleton_king'
  ]
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value
}

function normalState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const defeated = source.defeated && typeof source.defeated === 'object' ? source.defeated : {}
  const cleared = source.cleared && typeof source.cleared === 'object' ? source.cleared : {}
  return {
    defeated: {
      1: Array.isArray(defeated[1]) ? [...new Set(defeated[1].map(String))] : [],
      2: Array.isArray(defeated[2]) ? [...new Set(defeated[2].map(String))] : [],
      3: Array.isArray(defeated[3]) ? [...new Set(defeated[3].map(String))] : []
    },
    cleared: { 1: !!cleared[1], 2: !!cleared[2], 3: !!cleared[3] },
    kingDefeated: !!source.kingDefeated
  }
}

function rockGrid(width, height) {
  return Array.from({ length: height }, () => new Array(width).fill('#'))
}

function paint(grid, x, y, ch) {
  if (y > 0 && y < grid.length - 1 && x > 0 && x < grid[0].length - 1) grid[y][x] = ch
}

function carveRect(grid, x, y, width, height, ch = ' ') {
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) paint(grid, px, py, ch)
  }
}

function carveEllipse(grid, cx, cy, rx, ry, ch = ' ') {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1) paint(grid, x, y, ch)
    }
  }
}

function tomb(grid, x, y) {
  paint(grid, x - 1, y, '[')
  paint(grid, x, y, '=')
  paint(grid, x + 1, y, ']')
}

const STAIR_ART = {
  cistern: {
    up: ['    /=======\\', '   /_______/', '  /_______/', ' /_______/', '/___^___/'],
    down: ['    /___v___\\', '   /_______/', '  /_______/', ' /_______/', '/=======/']
  },
  ossuary: {
    up: ['    o=======o', '   /_.___._/', '  /_______/', ' /_.___._/', '/___^___/'],
    down: ['    o___v___o', '   /_.___._/', '  /_______/', ' /_.___._/', 'o=======o']
  },
  royal: {
    up: ['    +=======+', '   /___.___/', '  /___:___/', ' /___.___/', '/___^___/'],
    down: ['    +___v___+', '   /___.___/', '  /___:___/', ' /___.___/', '+=======+']
  }
}

function paintArt(grid, x, y, rows) {
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < rows[row].length; column++) {
      const ch = rows[row][column]
      if (ch !== ' ') paint(grid, x + column, y + row, ch)
    }
  }
}

function staircase(grid, point, direction, style) {
  const art = STAIR_ART[style][direction]
  const anchorX = direction === 'up' ? point.x - 4 : point.x - 8
  const anchorY = direction === 'up' ? point.y - art.length + 1 : point.y
  paintArt(grid, anchorX, anchorY, art)
}

function finishLayout(grid, details) {
  staircase(grid, details.up, 'up', details.stairStyle)
  if (details.down) staircase(grid, details.down, 'down', details.stairStyle)
  return { ...details, rows: grid.map((row) => row.join('')) }
}

// The three plans intentionally translate real underground architecture instead
// of repeating a room grid. Sources and motif notes live in docs/dungeon-design.md.
function cisternFloor(width, height) {
  const grid = rockGrid(width, height)
  const up = { x: 6, y: 35 }
  const down = { x: 104, y: 5 }

  carveRect(grid, 2, 29, 29, 9)
  carveRect(grid, 25, 31, 22, 4)
  carveEllipse(grid, 52, 23, 19, 11)
  carveRect(grid, 66, 9, 22, 4)
  carveRect(grid, 82, 2, 28, 12)
  carveEllipse(grid, 86, 30, 21, 7)
  carveRect(grid, 67, 27, 13, 5)
  carveRect(grid, 102, 10, 5, 18)

  // A rock-cut reservoir divides the central chamber; two narrow bridges keep
  // the main route legible while the southern overflow creates a second loop.
  carveEllipse(grid, 52, 23, 11, 6, '~')
  carveRect(grid, 39, 22, 27, 3, ':')
  carveRect(grid, 51, 15, 3, 17, ':')
  carveEllipse(grid, 87, 31, 8, 3, '~')
  carveRect(grid, 78, 30, 18, 2, ':')
  for (const [x, y] of [
    [35, 33],
    [70, 10],
    [76, 10],
    [84, 7],
    [93, 7],
    [103, 22]
  ]) {
    paint(grid, x, y, '+')
  }
  for (const [x, y] of [
    [18, 31],
    [28, 31],
    [68, 29],
    [105, 11]
  ]) {
    paint(grid, x, y, '*')
  }

  return finishLayout(grid, {
    name: 'cisternas del limo',
    stairStyle: 'cistern',
    up,
    down,
    spawnPoints: [
      { x: 18, y: 33 },
      { x: 22, y: 35 },
      { x: 34, y: 33 },
      { x: 43, y: 28 },
      { x: 43, y: 19 },
      { x: 61, y: 18 },
      { x: 61, y: 28 },
      { x: 75, y: 30 },
      { x: 88, y: 27 },
      { x: 102, y: 22 },
      { x: 90, y: 10 },
      { x: 101, y: 11 }
    ]
  })
}

function ossuaryFloor(width, height) {
  const grid = rockGrid(width, height)
  const up = { x: 6, y: 35 }
  const down = { x: 105, y: 5 }

  carveRect(grid, 2, 30, 27, 8)
  carveRect(grid, 11, 17, 5, 15)
  carveRect(grid, 5, 9, 29, 12)
  carveRect(grid, 30, 13, 19, 4)
  carveEllipse(grid, 53, 25, 16, 10)
  carveRect(grid, 51, 9, 5, 10)
  carveEllipse(grid, 57, 9, 14, 7)
  carveRect(grid, 68, 12, 41, 7)
  carveRect(grid, 96, 2, 14, 13)
  carveEllipse(grid, 87, 30, 21, 7)
  carveRect(grid, 65, 26, 17, 5)
  carveRect(grid, 101, 17, 6, 13)
  carveRect(grid, 24, 31, 18, 4)

  // Alternating skull/long-bone courses evoke the Paris ossuary. Turned
  // quarry pillars and the sepulchral lamp give the galleries landmarks.
  for (let x = 7; x <= 31; x += 3) {
    paint(grid, x, 10, '%')
    paint(grid, x + 1, 10, 'o')
  }
  for (let x = 72; x <= 98; x += 3) {
    paint(grid, x, 17, '%')
    paint(grid, x + 1, 17, 'o')
  }
  for (const [x, y] of [
    [12, 13],
    [27, 17],
    [47, 23],
    [59, 23],
    [51, 30],
    [72, 15],
    [93, 15],
    [77, 32],
    [98, 30]
  ]) {
    paint(grid, x, y, '+')
  }
  paint(grid, 57, 8, '*')
  tomb(grid, 19, 18)
  tomb(grid, 82, 28)
  tomb(grid, 93, 33)

  return finishLayout(grid, {
    name: 'galerias del osario',
    stairStyle: 'ossuary',
    up,
    down,
    spawnPoints: [
      { x: 18, y: 34 },
      { x: 25, y: 33 },
      { x: 13, y: 24 },
      { x: 20, y: 15 },
      { x: 39, y: 15 },
      { x: 45, y: 27 },
      { x: 57, y: 29 },
      { x: 57, y: 12 },
      { x: 76, y: 14 },
      { x: 89, y: 16 },
      { x: 99, y: 11 }
    ]
  })
}

function necropolisFloor(width, height) {
  const grid = rockGrid(width, height)
  const up = { x: 7, y: 35 }

  carveRect(grid, 3, 31, 21, 7)
  carveRect(grid, 11, 20, 6, 13)
  carveRect(grid, 11, 18, 35, 5)
  carveEllipse(grid, 34, 20, 9, 6)
  carveEllipse(grid, 58, 20, 18, 12)
  carveEllipse(grid, 58, 5, 11, 4)
  carveEllipse(grid, 58, 35, 11, 3)
  carveEllipse(grid, 82, 20, 9, 6)
  carveRect(grid, 72, 9, 19, 5)
  carveRect(grid, 72, 27, 30, 5)
  carveRect(grid, 98, 11, 5, 18)
  carveRect(grid, 85, 2, 25, 12)

  // The centered royal rotunda opens into side chapels and two approaches to
  // the throne, preserving the ceremonial axis without turning it into a hall.
  for (const [x, y] of [
    [47, 12],
    [69, 12],
    [47, 28],
    [69, 28],
    [79, 18],
    [79, 22],
    [88, 10],
    [106, 10]
  ]) {
    paint(grid, x, y, '+')
  }
  for (const [x, y] of [
    [33, 17],
    [33, 23],
    [55, 5],
    [61, 5],
    [55, 35],
    [61, 35],
    [82, 17],
    [82, 23]
  ]) {
    tomb(grid, x, y)
  }
  carveEllipse(grid, 58, 20, 5, 3, '.')
  paint(grid, 58, 20, '+')
  paint(grid, 96, 5, '\\')
  paint(grid, 100, 5, '/')
  paint(grid, 96, 6, '[')
  paint(grid, 97, 6, '=')
  paint(grid, 98, 6, 'T')
  paint(grid, 99, 6, '=')
  paint(grid, 100, 6, ']')

  return finishLayout(grid, {
    name: 'necropolis de la corona',
    stairStyle: 'royal',
    up,
    down: null,
    throne: { x: 98, y: 6 },
    spawnPoints: [
      { x: 15, y: 28 },
      { x: 25, y: 20 },
      { x: 42, y: 20 },
      { x: 55, y: 29 },
      { x: 53, y: 13 },
      { x: 67, y: 20 },
      { x: 80, y: 29 },
      { x: 89, y: 11 },
      { x: 98, y: 9 }
    ]
  })
}

/** Build a fixed, authored plan; only monster patrol is seeded. */
function floorRows(floor, width = DUNGEON.width, height = DUNGEON.height) {
  if (floor === 1) return cisternFloor(width, height)
  if (floor === 2) return ossuaryFloor(width, height)
  return necropolisFloor(width, height)
}

function walkable(ch) {
  return !['#', '|', '-', '=', '[', ']', '~', '%', 'o', '+'].includes(ch)
}

class Dungeon extends Field {
  constructor(opts = {}) {
    const floor = clamp(Math.floor(Number(opts.floor) || 1), 1, DUNGEON.floors)
    const seed = ((Number(opts.seed) || 1) ^ Math.imul(floor, 0x45d9f3b)) >>> 0
    super({ ...opts, seed, width: DUNGEON.width, height: DUNGEON.height })

    this.mode = 'dungeon'
    this.floor = floor
    this.state = normalState(opts.state)
    this.layout = floorRows(floor, this.width, this.height)
    this.gate = { ...this.layout.up }
    this.boss = null
    this.foes = []
    this.rng = makeRng(seed)
    this.drift = makeRng((seed ^ 0x9e3779b9) >>> 0)
    this.player.x = clamp(Number(opts.x) || this.layout.up.x + 2, 1, this.width - 2)
    this.player.y = clamp(Number(opts.y) || this.layout.up.y, 1, this.height - 2)
    if (!this.isWalkable(this.player.x, this.player.y)) {
      this.player.x = this.layout.up.x + 2
      this.player.y = this.layout.up.y
    }
    this.populateDungeon()
    this.say(`${this.layout.name}: ${this.remaining} monstruos vigilan las escaleras`)
  }

  populateDungeon() {
    const roster = FLOOR_ROSTERS[this.floor] || []
    const dead = new Set(this.state.defeated[this.floor])
    const spots = this.layout.spawnPoints

    for (let index = 0; index < roster.length; index++) {
      const id = `d${this.floor}-${index}`
      const kind = roster[index]
      const spot = spots[index % spots.length]
      const def = CONTENT.foes[kind]
      this.foes.push({
        id,
        kind,
        zone: `dungeon${this.floor}`,
        x: spot.x,
        y: spot.y,
        home: { ...spot },
        dead: dead.has(id),
        respawnAt: Infinity,
        nextStep:
          this.time + randInt(this.drift, 12, Math.max(16, Math.round(45 / def.stats.speed)))
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
      id: `dungeon${this.floor}`,
      name: this.layout.name,
      leash: DUNGEON.leash,
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
      return [{ type: 'dungeon-wall', text: 'la piedra bloquea el paso' }]
    }

    this.player.x = nx
    this.player.y = ny
    if (nx === this.layout.up.x && ny === this.layout.up.y) {
      if (this.floor === 1) return [{ type: 'dungeon-exit' }]
      return [{ type: 'dungeon-floor', floor: this.floor - 1, direction: 'up' }]
    }
    if (this.layout.down && nx === this.layout.down.x && ny === this.layout.down.y) {
      if (this.remaining > 0) {
        return [
          {
            type: 'dungeon-locked',
            text: `las escaleras siguen selladas: quedan ${this.remaining} monstruos`
          }
        ]
      }
      this.state.cleared[this.floor] = true
      return [{ type: 'dungeon-floor', floor: this.floor + 1, direction: 'down' }]
    }

    const events = []
    this.hunt(events)
    return events
  }

  wander(events) {
    for (const foe of this.foes) {
      if (foe.dead || foe.kind === 'skeleton_king' || this.time < foe.nextStep) continue
      const def = CONTENT.foes[foe.kind]
      foe.nextStep = this.time + clamp(Math.round(45 * (0.25 / def.stats.speed)), 16, 120)
      const nx = clamp(foe.x + randInt(this.drift, -1, 1), 1, this.width - 2)
      const ny = clamp(foe.y + randInt(this.drift, -1, 1), 1, this.height - 2)
      if (!this.isWalkable(nx, ny)) continue
      if (hitdist(nx, ny, foe.home.x, foe.home.y) > DUNGEON.leash) continue
      if (this.foeAt(nx, ny, foe)) continue
      if (nx === this.layout.up.x && ny === this.layout.up.y) continue
      if (this.layout.down && nx === this.layout.down.x && ny === this.layout.down.y) continue
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
      const defeated = new Set(this.state.defeated[this.floor])
      defeated.add(String(combat.foe.id))
      this.state.defeated[this.floor] = [...defeated]
      if (this.remaining === 0) this.state.cleared[this.floor] = true
      if (def.id === 'skeleton_king') {
        this.state.kingDefeated = true
        this.state.cleared[3] = true
        this.say('la corona cae al suelo: derrotaste al rey esqueleto')
        events.push({ type: 'dungeon-complete', text: 'la mazmorra ha sido conquistada' })
      } else if (this.remaining === 0) {
        this.say('el sello se rompe: las escaleras al siguiente nivel estan abiertas')
      }
      events.push({ type: 'win', id: combat.foe.id, kind: def.id, gold, xp, respawnIn: 0 })
      return
    }

    this.player.deaths++
    this.player.hp = this.player.maxhp
    this.player.x = this.layout.up.x + 2
    this.player.y = this.layout.up.y
    events.push({ type: 'death', kind: def.id })
  }

  snapshot() {
    const snap = super.snapshot()
    return {
      ...snap,
      mode: 'dungeon',
      floor: this.floor,
      zone: this.layout.name,
      stairs: {
        up: { ...this.layout.up },
        down: this.layout.down ? { ...this.layout.down } : null,
        downLocked: !!this.layout.down && this.remaining > 0
      },
      remaining: this.remaining,
      completed: this.state.kingDefeated
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
    return normalState(this.state)
  }
}

module.exports = { Dungeon, DUNGEON, FLOOR_ROSTERS, floorRows, normalState }
