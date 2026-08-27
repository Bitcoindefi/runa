'use strict'

const { Field } = require('./field.js')
const { WorldBossEvent, bossCamera } = require('./world-boss-event.js')

const BOSS_ZONE = { width: 128, height: 44 }

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value
}

function volcanicRows(width = BOSS_ZONE.width, height = BOSS_ZONE.height) {
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ((x * 19 + y * 31 + x * y) % 17 === 0 ? ',' : '.'))
  )
  const set = (x, y, ch) => {
    if (x >= 0 && y >= 0 && x < width && y < height) grid[y][x] = ch
  }

  for (let x = 0; x < width; x++) {
    set(x, 0, '#')
    set(x, height - 1, '#')
  }
  for (let y = 0; y < height; y++) {
    set(0, y, '#')
    set(width - 1, y, '#')
  }

  // Two lava rivers split the ruined district. Three basalt bridges in each
  // river guarantee multiple routes for dodging the boss's moving hazards.
  for (const y of [12, 13, 14, 28, 29, 30]) {
    for (let x = 1; x < width - 1; x++) {
      const bridge = (x >= 15 && x <= 23) || (x >= 57 && x <= 65) || (x >= 101 && x <= 109)
      set(x, y, bridge ? '=' : '~')
    }
  }

  const ruin = (left, top, w, h) => {
    for (let x = left; x < left + w; x++) {
      if ((x - left) % 7 !== 5) set(x, top, '-')
    }
    for (let y = top; y < top + h; y++) {
      if ((y - top) % 5 !== 3) set(left, y, '|')
      if ((y - top) % 4 !== 2) set(left + w - 1, y, '|')
    }
    set(left, top, '+')
    set(left + w - 1, top, '+')
    set(left + 3, top + h - 1, '/')
    set(left + w - 4, top + h - 1, '\\')
    set(left + Math.floor(w / 2), top + h - 2, 'x')
  }
  ruin(8, 18, 24, 9)
  ruin(42, 3, 27, 8)
  ruin(71, 32, 22, 9)

  // Cracked columns and an altar frame the boss without becoming a closed box.
  for (const [x, y] of [
    [83, 18],
    [91, 24],
    [116, 18],
    [119, 25]
  ]) {
    set(x, y - 2, '_')
    set(x, y - 1, '|')
    set(x, y, '|')
  }
  for (let x = width - 35; x < width - 8; x++) set(x, 25, x % 5 === 0 ? '_' : '=')

  const portal = { x: 5, y: height - 5 }
  set(portal.x - 2, portal.y - 2, '/')
  set(portal.x + 2, portal.y - 2, '\\')
  set(portal.x - 2, portal.y - 1, '|')
  set(portal.x + 2, portal.y - 1, '|')
  set(portal.x - 1, portal.y, '(')
  set(portal.x, portal.y, 'O')
  set(portal.x + 1, portal.y, ')')
  set(portal.x - 2, portal.y + 1, '=')
  set(portal.x - 1, portal.y + 1, '=')
  set(portal.x, portal.y + 1, '=')
  set(portal.x + 1, portal.y + 1, '=')
  set(portal.x + 2, portal.y + 1, '=')

  return { rows: grid.map((row) => row.join('')), portal }
}

class BossZone extends Field {
  constructor(opts = {}) {
    super({ ...opts, width: BOSS_ZONE.width, height: BOSS_ZONE.height })
    this.mode = 'boss'
    this.layout = volcanicRows(this.width, this.height)
    this.portal = { ...this.layout.portal }
    this.gate = { ...this.portal }
    this.foes = []
    this.player.x = clamp(Number(opts.x) || this.portal.x + 3, 1, this.width - 2)
    this.player.y = clamp(Number(opts.y) || this.portal.y, 1, this.height - 2)
    this.boss = new WorldBossEvent({
      width: this.width,
      height: this.height,
      x: this.width - 24,
      y: Math.floor(this.height / 2)
    })
    const state = opts.state && typeof opts.state === 'object' ? opts.state : {}
    if (Number.isFinite(Number(state.hp))) {
      this.boss.hp = clamp(Math.floor(Number(state.hp)), 0, this.boss.maxhp)
    }
    this.boss.defeated = !!state.defeated || this.boss.hp === 0
    if (this.boss.defeated) this.boss.active = false
    this.say('el portal desemboca entre ruinas y rios de lava')
  }

  get zone() {
    return { id: 'boss_zone', name: 'ruinas volcanicas', leash: 0, respawn: Infinity }
  }

  tileAt(x, y) {
    const row = this.layout && this.layout.rows[y]
    return row ? row[x] : '#'
  }

  isWalkable(x, y) {
    const ch = this.tileAt(x, y)
    return ch !== '#' && ch !== '~' && ch !== '|' && ch !== '-' && ch !== '+'
  }

  walk(dx, dy) {
    const nx = clamp(this.player.x + Math.sign(dx), 0, this.width - 1)
    const ny = clamp(this.player.y + Math.sign(dy), 0, this.height - 1)
    if (nx === this.player.x && ny === this.player.y) return []
    if (this.boss && this.boss.occupies(nx, ny)) {
      return [{ type: 'boss-blocked', text: 'el cuerpo del Coloso bloquea el paso; pulsa f' }]
    }
    if (!this.isWalkable(nx, ny)) {
      const lava = this.tileAt(nx, ny) === '~'
      return [
        {
          type: lava ? 'boss-lava' : 'boss-wall',
          text: lava
            ? 'la lava corta el camino; busca un puente de piedra'
            : 'las ruinas bloquean el paso'
        }
      ]
    }

    this.player.x = nx
    this.player.y = ny
    if (nx === this.portal.x && ny === this.portal.y) return [{ type: 'boss-exit' }]
    return this.boss ? this.boss.touch(this.player, this.time) : []
  }

  wander() {}

  snapshot() {
    const snap = super.snapshot()
    return {
      ...snap,
      mode: 'boss',
      zone: 'ruinas volcanicas',
      portal: { ...this.portal },
      dungeonEntrance: null,
      worldBossPortal: null,
      foes: []
    }
  }

  render(cols, rows, includeActors = true) {
    const vw = clamp(cols ?? this.width, 8, this.width)
    const vh = clamp(rows ?? this.height, 4, this.height)
    const boss = this.boss && this.boss.snapshot()
    const { ox, oy } = bossCamera(this.player, boss, this.width, this.height, vw, vh)
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
      const gx = Math.round(x) - ox
      const gy = Math.round(y) - oy
      if (gx >= 0 && gy >= 0 && gx < vw && gy < vh) grid[gy][gx] = ch
    }
    if (includeActors) {
      if (boss && !boss.defeated) put(boss.x, boss.y, 'W')
      for (const warning of (boss && boss.telegraphs) || []) {
        put(warning.x, warning.y, warning.glyph || '!')
      }
      for (const hazard of (boss && boss.hazards) || []) put(hazard.x, hazard.y, hazard.glyph)
      put(this.player.x, this.player.y, '@')
    }
    return grid.map((row) => row.join(''))
  }

  toJSON() {
    return this.boss
      ? { hp: this.boss.hp, defeated: this.boss.defeated }
      : { hp: 0, defeated: true }
  }
}

module.exports = { BossZone, BOSS_ZONE, volcanicRows }
