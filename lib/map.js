'use strict'

/**
 * The walkable world: the city, the field, and the rules for stepping around
 * them.
 *
 * Three decisions shape this file.
 *
 *  1. Maps are ASCII art, not arrays of tile objects. The art IS the source, so
 *     moving a shop is editing a string, and the map can be read in a diff. It
 *     also means a new map is data, which is the same property `content.js`
 *     buys for items and foes: it can ship over the air without a new build.
 *
 *  2. What a character means lives in one table, `TILES`, never in a chain of
 *     ifs. Adding a building is one row in that table plus one letter in the
 *     art, and nothing in the movement code changes.
 *
 *  3. A terminal cell is about twice as tall as it is wide. Everything here is
 *     drawn wide and short on purpose: a building that looks square in the
 *     source would render as a tall tower on screen. The same asymmetry is why
 *     the city is 60 by 18 rather than something near square.
 */

/**
 * What each character in the art is.
 *
 * `solid` is the only thing movement reads. `enter` is what standing on the
 * cell offers the game: it is a descriptor, not a callback, so the game layer
 * decides what a shop actually does and this file stays about walking.
 */
const TILES = {
  '#': { id: 'wall', name: 'una pared', solid: true },
  '+': { id: 'wall', name: 'una pared', solid: true },
  '-': { id: 'wall', name: 'una pared', solid: true },
  '|': { id: 'wall', name: 'una pared', solid: true },
  '^': { id: 'roof', name: 'un tejado', solid: true },
  '.': { id: 'road', name: 'la calle', solid: false },
  ';': { id: 'cobble', name: 'los adoquines', solid: false },
  ',': { id: 'grass', name: 'el pasto', solid: false },
  '*': { id: 'flower', name: 'unas flores', solid: false },
  O: { id: 'fountain', name: 'una fuente', solid: true },
  ':': { id: 'building', name: 'un edificio', solid: true },
  o: { id: 'rock', name: 'una piedra', solid: true },
  t: { id: 'tree', name: 'un arbol', solid: true },
  '~': { id: 'water', name: 'el agua', solid: true },

  C: { id: 'door.home', name: 'tu casa', solid: false, enter: { kind: 'home' } },
  I: { id: 'door.church', name: 'la iglesia', solid: false, enter: { kind: 'church' } },
  P: {
    id: 'door.potions',
    name: 'la tienda de pociones',
    solid: false,
    enter: { kind: 'shop', shop: 'potions' }
  },
  A: {
    id: 'door.weapons',
    name: 'la tienda de armas',
    solid: false,
    enter: { kind: 'shop', shop: 'weapons' }
  },
  D: {
    id: 'door.armor',
    name: 'la tienda de armaduras',
    solid: false,
    enter: { kind: 'shop', shop: 'armor' }
  },

  '>': {
    id: 'gate.field',
    name: 'la salida al campo',
    solid: false,
    enter: { kind: 'travel', to: 'field' }
  },
  '<': {
    id: 'gate.city',
    name: 'la entrada a la ciudad',
    solid: false,
    enter: { kind: 'travel', to: 'city' }
  }
}

/**
 * Building names are painted straight into the art, so every remaining
 * lowercase letter has to be solid. Registering them in bulk beats listing
 * them one by one: renaming a shop must never punch a hole in its own wall.
 */
for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
  if (!TILES[ch]) TILES[ch] = { id: 'sign', name: 'un cartel', solid: true }
}

/** Anything the art does not define, and anything off the edge. Solid, always. */
const NOWHERE = { id: 'nowhere', name: 'la nada', solid: true }

/** Doors, for the on-screen legend. Order is reading order, not table order. */
const LEGEND = [
  { glyph: 'C', text: 'tu casa' },
  { glyph: 'I', text: 'iglesia' },
  { glyph: 'P', text: 'pociones' },
  { glyph: 'A', text: 'armas' },
  { glyph: 'D', text: 'armaduras' },
  { glyph: '>', text: 'al campo' },
  { glyph: '<', text: 'a la ciudad' }
]

/**
 * La ciudad.
 *
 * El porton al campo es una casa de guardia y no un caracter. Antes era un solo
 * '>' en la pared de abajo, y un caracter en un borde de sesenta no se lee como
 * una salida: se lee como una imperfeccion del borde. La gente no lo encontraba,
 * y no por distraida.
 *
 * Tres cosas lo arreglan, y ninguna es agrandarlo a secas:
 *   1. El vano son cinco tiles. Un hueco ancho se lee como hueco.
 *   2. Dos torres lo flanquean. Un vano entre dos macizos es una puerta; un
 *      hueco en una pared lisa es un agujero.
 *   3. Un camino de adoquines baja hasta el vano. El ojo sigue los caminos, y
 *      ese camino no lleva a ningun otro lado.
 *
 * Los cinco '>' son cinco casillas de viaje, no cinco salidas distintas: pisar
 * cualquiera te lleva al mismo campo.
 */
const CITY_ROWS = [
  '############################################################',
  '#..........................................................#',
  '#..+----------+.....+--------------+.....+------------+....#',
  '#..|^^^^^^^^^^|.....|^^^^^^^^^^^^^^|.....|^^^^^^^^^^^^|....#',
  '#..|:::casa:::|.....|:::iglesia::::|.....|::pociones::|....#',
  '#..+----C-----+.....+------I-------+.....+-----P------+....#',
  '#..........................................................#',
  '#...............;.;.;.;.;.;.;.;.;.;.;......................#',
  '#..........................................................#',
  '#.......+------A-----+........+------D-------+.............#',
  '#.......|^^^^^^^^^^^^|........|^^^^^^^^^^^^^^|.............#',
  '#.......|:::armas::::|........|::armaduras:::|.............#',
  '#.......+------------+........+--------------+.............#',
  '#........................^^^.....^^^.......................#',
  '#...,,,,,,,,,,,,,,.......:::;;;;;:::.......................#',
  '#...,,*,,,O,,,*,,,.......:::;;;;;:::.......................#',
  '#...,,,,,,,,,,,,,,.......:::;;;;;:::.......................#',
  '############################>>>>>###########################'
]

const FIELD_ROWS = [
  '########################################<#######################################',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,o,,,,,,,,oo...,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,o,#',
  '#,,,,,o,,,,o,,,o,,,,,,,,,,,,,,t,t,t,t,o...tt,,,,,,,,,,,,,,,,,,t,t,,,t,ttt,tt,,,#',
  '#,,,,,,,,,,,,,,,,~,,,,,,,,,,,,,,t,tttt,...,,,,,,,,,,,,,,,tt,,,,t,ttt,,,tttt,,,,#',
  '#,,,,,,,..,,~~~~~~~~~~~,,,,,,,tt,,,t,tt...tt,,,,,,,,,,,,t,,,,,ttt,,,t,,t,,,,,,,#',
  '#,,,,,,,..~~~~~~~~~~~~~~~,,,,,t,,,,,t,,...,,,,,,,,,,,,,,,,ttt,t,,,t,,,,,,,t,,,,#',
  '#o,,,,,,..~~~~~~~~~~~~~~~~,,,,,,,,,,,,,...,,,,,,,,,,,,,,t,,t,,,,t,t,t,,,,,tt,,,#',
  '#,,,,,,,..~~~~~~~~~~~~~~~,,,,,,,,,,,,,,...,,,,,,,,,,,,,,,t,ttt,t,t,tt,,t,ttt,,,#',
  '#,,,,,,,..,,~~~~~~~~~~~,,,,,,,,,,,,,,,,...,,,,,,,,,,,,,,t,,,t,t,t,,,,,,t,,tt,,,#',
  '#,,,,,,,..,,,,,,,~,,,,,,,,,,,,,,,,,,,,,...,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#,,,,,,,..,,,,,,,,,,,,,,,,,,,,,,,,,,,,,...,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#,,,,,,,..,,,,,,,,,o,,,o,,,,,,,,,,,,,,,...,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#,,,,,...................................................................,,,,,,#',
  '#,,,o,...................................................................,,,,,,#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,...,,,,,o,,#',
  '#,,,,,t,,t,,tt,,,,,t,,,ttt,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,...,,,,,,,,#',
  '#,,,,tt,,t,t,,ttt,,,o,tt,,,,,,,,,,,,,,,,o,,,,,,,o,tto,,,,ttt,,t,t,t,...tt,,t,,,#',
  '#,,,,t,,,t,,t,,t,,t,to,t,,,,,,,,,,,,,,,,,,,,,,,,,,tt,tot,,tt,,,,,,t,...t,t,t,,,#',
  '#o,,tttt,t,,t,tt,,,,t,,,t,,,,,,,,,,,,,,,,,,,,,,,,,t,t,,ttt,,tt,,t,t,...,,,tt,,,#',
  '#,,,t,,t,ttt,,tttt,,tt,,tt,,,,,,,,,,oo,,,,,,,,,,,,tt,,tttttt,,,tt,,t...,,,tt,,,#',
  '#,,,,,,,,,t,,,tott,,tt,t,,,,,,,,,,,,,,,,o,,,,,,,,,,,t,ttt,,t,ttttt,t...,,,t,,,,#',
  '#,,,,t,,,,,t,,,t,ttt,t,t,,,,,,,,,,,,,,,,,,,,,,,,,,t,tt,t,,,t,ttt,tt,ttttt,t,,,,#',
  '#,,,,t,t,t,t,t,,tt,tt,,,tt,,,,,,,,,,,,,,,,,,,,,,,,t,t,t,,t,,,,,tt,t,t,t,t,,,,,,#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,t,,,tt,t,t,t,,,tt,t,t,,t,t,,,#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,o,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,o,,,,,,,,,#',
  '################################################################################'
]

/**
 * Turn art plus metadata into a map, checking the art is rectangular.
 *
 * The check is here because a ragged row is invisible in the source and would
 * surface much later as a player walking through a wall on one line only.
 *
 * @param {{ id: string, name: string, rows: string[], spawn: {x: number, y: number},
 *           arrive: {x: number, y: number} }} def
 * @returns {object} the map, with `width` and `height` filled in
 */
function defineMap(def) {
  const width = def.rows[0].length
  for (let y = 0; y < def.rows.length; y++) {
    if (def.rows[y].length !== width) {
      throw new Error(`mapa ${def.id}: la fila ${y} mide ${def.rows[y].length}, no ${width}`)
    }
  }
  return { ...def, width, height: def.rows.length }
}

/**
 * `spawn` is where a new game starts. `arrive` is where you land coming in from
 * the other map, and it is deliberately one cell past the gate: landing on the
 * gate itself would offer to send you straight back the way you came.
 */
const MAPS = {
  city: defineMap({
    id: 'city',
    name: 'la ciudad',
    rows: CITY_ROWS,
    spawn: { x: 8, y: 6 },
    arrive: { x: 30, y: 16 }
  }),
  field: defineMap({
    id: 'field',
    name: 'el campo',
    rows: FIELD_ROWS,
    spawn: { x: 40, y: 1 },
    arrive: { x: 40, y: 1 }
  })
}

/**
 * Is this cell on the map at all.
 * @param {object} map
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function inside(map, x, y) {
  return x >= 0 && y >= 0 && x < map.width && y < map.height
}

/**
 * The tile at a cell. Off the map, or a character the table does not know,
 * reads as solid: an unrecognised map is unwalkable, never leaky.
 * @param {object} map
 * @param {number} x
 * @param {number} y
 * @returns {{ id: string, name: string, solid: boolean, enter?: object }}
 */
function tileAt(map, x, y) {
  if (!inside(map, x, y)) return NOWHERE
  return TILES[map.rows[y][x]] || NOWHERE
}

/**
 * @param {object} map
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isSolid(map, x, y) {
  return tileAt(map, x, y).solid
}

/** Where the player is and how they get around. */
class Walker {
  /**
   * @param {string} [mapId] - key into MAPS
   */
  constructor(mapId = 'city') {
    this.mapId = MAPS[mapId] ? mapId : 'city'
    const spawn = MAPS[this.mapId].spawn
    this.x = spawn.x
    this.y = spawn.y
  }

  /** @returns {object} the map currently being walked */
  get map() {
    return MAPS[this.mapId]
  }

  /**
   * The tile under the player's feet.
   * @returns {object}
   */
  here() {
    return tileAt(this.map, this.x, this.y)
  }

  /**
   * The tile one step away, without moving.
   * @param {number} dx
   * @param {number} dy
   * @returns {object}
   */
  peek(dx, dy) {
    return tileAt(this.map, this.x + dx, this.y + dy)
  }

  /**
   * What standing here offers: a shop, a door, a way out. Null on plain ground.
   *
   * Movement never triggers it. The game asks for it, usually on a key, which
   * is what keeps a player from being swallowed by a shop while crossing a
   * doorway on the way somewhere else.
   *
   * @returns {object|null}
   */
  action() {
    return this.here().enter || null
  }

  /**
   * Step one cell, if the cell allows it.
   *
   * `tile` is always where you ended up, moved or not, so the caller can print
   * it either way. `blocked` is what stopped you, and is null on a good step.
   *
   * @param {number} dx
   * @param {number} dy
   * @returns {{ moved: boolean, tile: object, blocked: object|null }}
   */
  move(dx, dy) {
    const tile = this.peek(dx, dy)
    if (tile.solid) return { moved: false, tile: this.here(), blocked: tile }
    this.x += dx
    this.y += dy
    return { moved: true, tile, blocked: null }
  }

  /**
   * Cross to another map, landing at its arrival point.
   * @param {string} mapId
   * @returns {boolean} false if there is no such map
   */
  travel(mapId) {
    const map = MAPS[mapId]
    if (!map) return false
    this.mapId = mapId
    this.x = map.arrive.x
    this.y = map.arrive.y
    return true
  }

  /**
   * Drop the player somewhere specific. Used by save games and by tests.
   * @param {string} mapId
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  placeAt(mapId, x, y) {
    if (!MAPS[mapId]) return false
    this.mapId = mapId
    this.x = x
    this.y = y
    return true
  }
}

/**
 * The rectangle of map to draw, centred on a point and clamped to the edges.
 *
 * Clamping rather than letting the window run off the map is what stops the
 * player walking into a band of blank screen at the borders. It does mean the
 * player is off-centre near an edge, which is the trade every scrolling map
 * makes and the one players do not notice.
 *
 * @param {object} map
 * @param {{x: number, y: number}} focus
 * @param {number} width - columns available on screen
 * @param {number} height - rows available on screen
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function viewport(map, focus, width, height) {
  const w = Math.max(1, Math.min(Math.floor(width) || map.width, map.width))
  const h = Math.max(1, Math.min(Math.floor(height) || map.height, map.height))
  const x = clamp(Math.round(focus.x - (w - 1) / 2), 0, map.width - w)
  const y = clamp(Math.round(focus.y - (h - 1) / 2), 0, map.height - h)
  return { x, y, width: w, height: h }
}

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n
}

/**
 * The map as lines, with the player painted on top.
 *
 * Pass `width`/`height` to get a window around `at`, or leave them out for the
 * whole map. Lines come back as an array because a TUI view usually has other
 * rows to interleave, and joining is the caller's business.
 *
 * @param {object} map
 * @param {{ at?: {x: number, y: number}, glyph?: string, width?: number,
 *           height?: number, view?: object }} [opts]
 * @returns {string[]}
 */
function renderLines(map, opts = {}) {
  const at = opts.at || null
  const glyph = opts.glyph || '@'
  const view =
    opts.view ||
    (opts.width || opts.height
      ? viewport(map, at || { x: 0, y: 0 }, opts.width, opts.height)
      : { x: 0, y: 0, width: map.width, height: map.height })

  const lines = []
  for (let row = 0; row < view.height; row++) {
    const y = view.y + row
    let line = map.rows[y].slice(view.x, view.x + view.width)
    const col = at && at.y === y ? at.x - view.x : -1
    if (col >= 0 && col < view.width) {
      line = line.slice(0, col) + glyph[0] + line.slice(col + 1)
    }
    lines.push(line)
  }
  return lines
}

/**
 * Same as `renderLines`, joined.
 *
 * The separator defaults to '\n' because bare-tui's renderer splits the view on
 * '\n' and writes the carriage returns itself. Only code writing straight to a
 * raw-mode tty needs `eol: '\r\n'`, and without it the map stair-steps.
 *
 * @param {object} map
 * @param {object} [opts] - as `renderLines`, plus `eol`
 * @returns {string}
 */
function render(map, opts = {}) {
  return renderLines(map, opts).join(opts.eol || '\n')
}

module.exports = {
  TILES,
  LEGEND,
  MAPS,
  NOWHERE,
  defineMap,
  inside,
  tileAt,
  isSolid,
  viewport,
  renderLines,
  render,
  Walker
}
