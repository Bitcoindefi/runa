'use strict'

/**
 * The visual layer: pure functions from state to a block of text.
 *
 * Nothing here holds state and nothing here touches the outside world. Every
 * function takes the width and height it is allowed to use and returns a block
 * of exactly that size. That is not tidiness, it is what keeps the diff
 * renderer honest: a frame one line taller than the terminal makes the terminal
 * itself scroll, and from that moment on every absolute cursor move addresses
 * the wrong row and the screen looks like it jumped.
 *
 * Three constraints shape everything below.
 *
 *  1. ASCII 128 only. A box drawing character that a font does not have is not
 *     merely ugly, it renders as a replacement box of a different cell width,
 *     and the whole line drifts. `+`, `-` and `|` are one cell in every
 *     terminal on every machine, forever.
 *
 *  2. A terminal cell is about twice as tall as it is wide. A map drawn one
 *     character per tile comes out stretched vertically, so `mapPane` draws
 *     every tile two columns wide and the world reads as square. This is the
 *     only reason `CELL_W` exists.
 *
 *  3. All layout math goes through `style.width` / `style.truncate`, never
 *     `.length` / `.slice`. The strings here carry ANSI colour, whose byte
 *     count has nothing to do with the number of cells the user sees.
 *
 * The model lives outside. This file only draws it.
 */

const { style } = require('bare-tui')

/** Smallest terminal the split layout is designed for. */
const MIN_WIDTH = 64

/** Smallest terminal the split layout is designed for. */
const MIN_HEIGHT = 16

/** Inner width of the right hand column (stats above, log below). */
const SIDE_W = 26

/** Terminal columns per map tile. Two, because cells are about 1:2. */
const CELL_W = 2

/**
 * Tiles that fill their cell rather than sit in it.
 *
 * A tile is two columns wide (see CELL_W), so every tile has to decide what
 * goes in the second column. Terrain and walls repeat, because a wall with a
 * gap in it is a doorway the player will walk into and bounce off. Everything
 * else gets a trailing space, which is what makes a floor of dots read as open
 * ground instead of static. `|` and `+` are in here so that a map drawn as
 * line art survives the doubling: `+--+` comes out `++----++`, still a box.
 */
const SOLID = '#%=~":,-|+'

/** ASCII border charset, for `style().border()` or for `box()` below. */
const BORDER = {
  topLeft: '+',
  top: '-',
  topRight: '+',
  left: '|',
  right: '|',
  bottomLeft: '+',
  bottom: '-',
  bottomRight: '+'
}

const COLOR = {
  border: 'gray',
  hpHigh: 'green',
  hpMid: 'yellow',
  hpLow: 'red',
  xp: 'magenta',
  gold: 'yellow',
  foe: 'red',
  hero: 'cyan',
  cooldown: 'blue',
  yes: 'green',
  no: 'red'
}

// ---------------------------------------------------------------------------
// small text helpers
// ---------------------------------------------------------------------------

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo
  return n < lo ? lo : n > hi ? hi : n
}

/**
 * Force a string into ASCII 128. Anything outside the printable range becomes
 * `?`, which is visibly wrong at exactly one cell wide instead of invisibly
 * wrong at two. Do not run this over styled text: it would eat the escapes.
 * @param {string} s
 * @returns {string}
 */
function ascii(s) {
  let out = ''
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0)
    out += cp >= 32 && cp <= 126 ? ch : '?'
  }
  return out
}

/**
 * Pad or truncate to exactly `w` visible cells, content to the left.
 * @param {string} s
 * @param {number} w
 * @returns {string}
 */
function padTo(s, w) {
  if (w <= 0) return ''
  const t = style.truncate(String(s), w)
  return t + ' '.repeat(Math.max(0, w - style.width(t)))
}

/**
 * Pad or truncate to exactly `w` visible cells, content to the right.
 * @param {string} s
 * @param {number} w
 * @returns {string}
 */
function padLeftTo(s, w) {
  if (w <= 0) return ''
  const t = style.truncate(String(s), w)
  return ' '.repeat(Math.max(0, w - style.width(t))) + t
}

/**
 * One line of exactly `w` cells with `left` flush left and `right` flush
 * right. When they cannot both fit, the left side is the one that gets cut,
 * because the right side is almost always a number and half a number is a lie.
 * @param {number} w
 * @param {string} left
 * @param {string} [right]
 * @returns {string}
 */
function row(w, left, right = '') {
  if (w <= 0) return ''
  const r = String(right)
  const rw = style.width(r)
  if (rw >= w) return padLeftTo(r, w)
  const l = style.truncate(String(left), w - rw)
  return l + ' '.repeat(w - style.width(l) - rw) + r
}

/**
 * Plain text word wrap. Words longer than the column are hard split rather
 * than allowed to overflow, since one long token would otherwise push a border
 * off the screen edge.
 * @param {string} text
 * @param {number} w
 * @returns {string[]}
 */
function wrap(text, w) {
  if (w < 1) return ['']
  const out = []
  for (const para of String(text).split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      if (word === '') continue
      if (line === '') line = word
      else if (style.width(line) + 1 + style.width(word) <= w) line = line + ' ' + word
      else {
        out.push(line)
        line = word
      }
      while (style.width(line) > w) {
        const head = style.truncate(line, w)
        out.push(head)
        line = line.slice(head.length)
      }
    }
    out.push(line)
  }
  return out
}

/**
 * @param {string} s
 * @param {string} color
 * @returns {string}
 */
function paint(s, color) {
  return color ? style().foreground(color).render(s) : s
}

// ---------------------------------------------------------------------------
// bars
// ---------------------------------------------------------------------------

/**
 * An ASCII meter, `[####------]`, exactly `w` cells wide including brackets.
 *
 * Two rounding rules matter more than they look. A fighter with one hit point
 * left keeps one visible block, and a fighter one hit from death never shows a
 * full bar. Without those, the bar lies at precisely the two moments the
 * player is actually reading it.
 *
 * @param {number} value
 * @param {number} max
 * @param {number} w total width including the brackets
 * @param {{fill?: string, empty?: string, open?: string, close?: string}} [opts]
 * @returns {string}
 */
function bar(value, max, w, opts = {}) {
  const open = opts.open === undefined ? '[' : opts.open
  const close = opts.close === undefined ? ']' : opts.close
  const fill = opts.fill || '#'
  const empty = opts.empty || '-'
  const inner = Math.max(1, w - open.length - close.length)
  const frac = clamp(max > 0 ? value / max : 0, 0, 1)

  let n = Math.round(inner * frac)
  if (frac > 0 && n === 0) n = 1
  if (frac < 1 && n === inner) n = inner - 1

  return open + fill.repeat(n) + empty.repeat(inner - n) + close
}

/**
 * Colour for a health fraction: green, then yellow, then red.
 * @param {number} frac
 * @returns {string}
 */
function hpColor(frac) {
  return frac > 0.5 ? COLOR.hpHigh : frac > 0.25 ? COLOR.hpMid : COLOR.hpLow
}

/**
 * `label [####------] 16/20` in exactly `w` cells.
 * @param {string} label
 * @param {number} value
 * @param {number} max
 * @param {number} w
 * @param {string} [color]
 * @returns {string}
 */
function statLine(label, value, max, w, color) {
  const nums = `${Math.max(0, Math.round(value))}/${Math.max(0, Math.round(max))}`
  const lw = style.width(label)
  const barW = w - lw - style.width(nums) - 2
  if (barW < 3) return row(w, label, nums)
  const meter = paint(bar(value, max, barW), color)
  return label + ' ' + meter + ' ' + nums
}

// ---------------------------------------------------------------------------
// boxes
// ---------------------------------------------------------------------------

/**
 * An ASCII box around content, `w` inner columns by `h` inner rows, with an
 * optional caption bitten out of the top border:
 *
 *     +- log --------------+
 *     | pegas 4            |
 *     +--------------------+
 *
 * Content shorter than `h` is padded, content longer is cut. Both are on
 * purpose: the box owns its size so the caller can add up a layout without
 * having to trust what is inside.
 *
 * @param {string} content
 * @param {number} w inner width
 * @param {number} [h] inner height, omitted to fit the content
 * @param {string} [caption]
 * @returns {string}
 */
function box(content, w, h, caption) {
  const iw = Math.max(1, w)
  let s = style().width(iw)
  if (h) s = s.height(Math.max(1, h))
  const lines = s.render(String(content)).split('\n')

  const bar_ = (n) => '-'.repeat(Math.max(0, n))
  let top = '+' + bar_(iw) + '+'
  if (caption) {
    const cap = ' ' + style.truncate(ascii(caption), Math.max(1, iw - 4)) + ' '
    top = '+-' + cap + bar_(iw - 1 - style.width(cap)) + '+'
  }

  const edge = paint('|', COLOR.border)
  const out = [paint(top, COLOR.border)]
  for (const line of lines) out.push(edge + line + edge)
  out.push(paint('+' + bar_(iw) + '+', COLOR.border))
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// the too small screen
// ---------------------------------------------------------------------------

/**
 * The frame to show when the terminal is smaller than the layout needs, or
 * null when it fits. It is deliberately a full frame of exactly the size we
 * were given: refusing to draw is still drawing, and it has to obey the same
 * rule as everything else.
 *
 * @param {number} width
 * @param {number} height
 * @returns {string|null}
 */
function tooSmall(width, height) {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  if (w >= MIN_WIDTH && h >= MIN_HEIGHT) return null
  if (w < 1 || h < 1) return ''

  const msg = [
    'la terminal es muy chica',
    '',
    `tenes   ${w}x${h}`,
    `necesito ${MIN_WIDTH}x${MIN_HEIGHT}`,
    '',
    'agranda la ventana'
  ]
  const body = msg.slice(0, h)
  const pad = Math.max(0, Math.floor((h - body.length) / 2))
  const out = []
  for (let i = 0; i < pad; i++) out.push(' '.repeat(w))
  for (const line of body) {
    const left = Math.max(0, Math.floor((w - style.width(line)) / 2))
    out.push(padTo(' '.repeat(left) + line, w))
  }
  while (out.length < h) out.push(' '.repeat(w))
  return out.slice(0, h).join('\n')
}

// ---------------------------------------------------------------------------
// right hand column
// ---------------------------------------------------------------------------

/**
 * Render an item slot. Accepts a content.js item object, a bare id string, or
 * nothing at all, because the caller reads its equipment from three different
 * places (the world's `held`, the script's snapshot, the shop) and none of
 * them should have to normalise first.
 *
 * @param {object|string|null|undefined} item
 * @returns {string}
 */
function itemLabel(item) {
  if (!item) return '-'
  if (typeof item === 'string') return ascii(item)
  const glyph = item.glyph ? ascii(item.glyph) + ' ' : ''
  return glyph + ascii(item.name || item.id || '?')
}

/**
 * The character sheet: health, experience, money, equipment.
 *
 * @param {object} p
 * @param {string} [p.name]
 * @param {number} [p.level]
 * @param {number} p.hp
 * @param {number} p.maxhp
 * @param {number} [p.xp]
 * @param {number} [p.xpNext]
 * @param {number} [p.gold]
 * @param {number} [p.potions]
 * @param {object|string|null} [p.left]
 * @param {object|string|null} [p.right]
 * @param {number} w inner width
 * @returns {string}
 */
function statsPanel(p, w) {
  if (!p) return ''
  const hp = Number(p.hp) || 0
  const maxhp = Number(p.maxhp) || 1
  const xp = Number(p.xp) || 0
  const xpNext = Number(p.xpNext) || 1

  const lines = [
    row(
      w,
      style()
        .bold(true)
        .render(ascii(p.name || 'vos')),
      'nv ' + (p.level === undefined ? 1 : p.level)
    ),
    statLine('hp', hp, maxhp, w, hpColor(hp / maxhp)),
    statLine('xp', xp, xpNext, w, COLOR.xp),
    row(
      w,
      paint('oro ' + (p.gold === undefined ? 0 : p.gold), COLOR.gold),
      'pociones ' + (p.potions === undefined ? 0 : p.potions)
    ),
    row(w, 'izq ' + itemLabel(p.left)),
    row(w, 'der ' + itemLabel(p.right))
  ]
  return lines.join('\n')
}

/**
 * The last lines of the log, newest at the bottom.
 *
 * Padding goes on top rather than the bottom so a fresh message always appears
 * on the same row instead of the whole log sliding down the panel as it fills.
 *
 * @param {Array<string|{text: string}>} entries
 * @param {number} w inner width
 * @param {number} h inner height
 * @returns {string}
 */
function logPanel(entries, w, h) {
  const rows = Math.max(1, h)
  const lines = []
  for (const e of entries || []) {
    if (e === null || e === undefined) continue
    const text = typeof e === 'string' ? e : String(e.text === undefined ? e : e.text)
    for (const l of wrap(ascii(text), w)) lines.push(l)
  }
  const tail = lines.slice(Math.max(0, lines.length - rows))
  while (tail.length < rows) tail.unshift('')
  return tail.map((l) => padTo(l, w)).join('\n')
}

// ---------------------------------------------------------------------------
// the map
// ---------------------------------------------------------------------------

/**
 * Expand one tile into `cellW` terminal columns.
 * @param {string} ch
 * @param {number} cellW
 * @param {boolean} isActor
 * @returns {string}
 */
function expandCell(ch, cellW, isActor) {
  if (cellW <= 1) return ch
  if (!isActor && SOLID.indexOf(ch) !== -1) return ch.repeat(cellW)
  return ch + ' '.repeat(cellW - 1)
}

const LOGO = [
  '/\\=======================================================/\\',
  '||                       BARE RPG                        ||',
  '||     ____    _    ____  _____   ____  ____   ____      ||',
  '||    | __ )  / \\  |  _ \\| ____| |  _ \\|  _ \\ / ___|     ||',
  '||    |  _ \\ / _ \\ | |_) |  _|   | |_) | |_) | |  _      ||',
  '||    | |_) / ___ \\|  _ <| |___  |  _ <|  __/| |_| |     ||',
  '||    |____/_/   \\_\\_| \\_\\_____| |_| \\_\\_|    \\____|     ||',
  '||          T E R M I N A L   A D V E N T U R E          ||',
  '\\/=======================================================\\/'
]

/**
 * The title card. Centred on whatever the terminal gives us, and it
 * degrades to just the word when the terminal is too narrow for the art.
 * @param {number} w
 * @param {number} h
 * @returns {string}
 */
function titleScreen(w, h) {
  const art = LOGO[0].length + 2 <= w ? LOGO : ['BARE RPG']
  const centre = (t) => ' '.repeat(Math.max(0, Math.floor((w - t.length) / 2))) + t
  const tag = 'no controlas a tu personaje. escribis las reglas que sigue.'
  const body = [
    ...art.map(centre),
    '',
    centre(tag.length <= w - 2 ? tag : 'escribis las reglas'),
    '',
    centre('[ cualquier tecla para empezar ]')
  ]
  const pad = Math.max(0, Math.floor((h - body.length) / 2))
  return Array(pad).fill('').concat(body).join('\n')
}

/**
 * The walking view: a window onto the tile map, centred on the hero and
 * clamped to the map edges so the camera never shows a void it does not have
 * to.
 *
 * Every tile is drawn `cellW` columns wide, which is the whole reason a square
 * room looks square. Draw it one column per tile and the same room is a
 * letterbox.
 *
 * @param {object} map
 * @param {string[]} map.tiles rows of ASCII, one character per tile
 * @param {{x: number, y: number, glyph?: string}} map.hero
 * @param {Array<{x: number, y: number, glyph?: string}>} [map.actors]
 * @param {number} w
 * @param {number} h
 * @param {{cellW?: number}} [opts]
 * @returns {string}
 */
function mapPane(map, w, h, opts = {}) {
  const cellW = Math.max(1, opts.cellW || CELL_W)
  const tiles = (map && map.tiles) || []
  const mapH = tiles.length
  let mapW = 0
  for (const r of tiles) mapW = Math.max(mapW, String(r).length)

  const cols = Math.max(1, Math.floor(w / cellW))
  const hero = (map && map.hero) || { x: 0, y: 0 }
  const hx = Math.round(Number(hero.x) || 0)
  const hy = Math.round(Number(hero.y) || 0)

  // Centre on the hero, then stop at the map edge so the camera never shows a
  // void it does not have to. A map smaller than the pane is centred in it
  // instead, since a small room pinned to the top left corner reads as a bug.
  const camX =
    mapW <= cols ? -Math.floor((cols - mapW) / 2) : clamp(hx - Math.floor(cols / 2), 0, mapW - cols)
  const camY = mapH <= h ? -Math.floor((h - mapH) / 2) : clamp(hy - Math.floor(h / 2), 0, mapH - h)

  // Overlay everything that moves, hero last so nothing can hide the player.
  const over = new Map()
  for (const a of (map && map.actors) || []) {
    if (!a) continue
    over.set(Math.round(a.y) + ',' + Math.round(a.x), ascii(a.glyph || '?')[0] || '?')
  }
  over.set(hy + ',' + hx, ascii(hero.glyph || '@')[0] || '@')

  const out = []
  for (let r = 0; r < h; r++) {
    const y = camY + r
    let line = ''
    for (let c = 0; c < cols; c++) {
      const x = camX + c
      const rowStr = y >= 0 && y < mapH ? String(tiles[y]) : ''
      let ch = x >= 0 && x < rowStr.length ? rowStr[x] : ' '
      const g = over.get(y + ',' + x)
      const isActor = g !== undefined
      if (isActor) ch = g
      line += expandCell(ascii(ch), cellW, isActor)
    }
    out.push(padTo(line, w))
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// the arena
// ---------------------------------------------------------------------------

/**
 * The fight, on one horizontal line.
 *
 * Distance is the whole game here: reach decides who lands a hit, so the two
 * fighters are placed by their real `x` on a track scaled to the pane, and the
 * hero's reach is drawn under them as a run of dots. The player is meant to be
 * able to see the mistake, not read about it, which is why the dots stop
 * exactly where the weapon does.
 *
 * @param {object} c
 * @param {number} [c.span] arena length in cells, world.ARENA
 * @param {object} c.hero  { glyph, name, x, hp, maxhp, reach, cooldown, cooldownMax }
 * @param {object} c.foe   { glyph, name, x, hp, maxhp }
 * @param {string} [c.over] result banner, e.g. 'ganaste'
 * @param {number} w
 * @param {number} h
 * @returns {string}
 */
function arenaPane(c, w, h) {
  const span = Number(c && c.span) > 0 ? Number(c.span) : 40
  const hero = (c && c.hero) || {}
  const foe = (c && c.foe) || {}
  const track = Math.max(4, w)

  const at = (x) => Math.round((clamp(Number(x) || 0, 0, span) / span) * (track - 1))
  let hp = at(hero.x)
  let fp = at(foe.x === undefined ? span : foe.x)
  // Two glyphs cannot share a column. Nudging the foe (never the hero) keeps
  // the player's own position honest when the fight collapses to nothing.
  if (fp === hp) fp = Math.min(track - 1, hp + 1)
  if (fp === hp) hp = Math.max(0, fp - 1)

  const hg = ascii(hero.glyph || '@')[0] || '@'
  const fg = ascii(foe.glyph || '?')[0] || '?'

  const glyphs = new Array(track).fill(' ')
  glyphs[hp] = paint(hg, COLOR.hero)
  glyphs[fp] = paint(fg, COLOR.foe)

  const ground = '+' + '-'.repeat(Math.max(0, track - 2)) + '+'

  const reach = Math.max(0, Number(hero.reach) || 0)
  const reachCells = Math.round((reach / span) * (track - 1))
  const dots = new Array(track).fill(' ')
  for (let i = 1; i <= reachCells; i++) {
    const at_ = hp + i
    if (at_ < track) dots[at_] = '.'
  }
  const inReach = Math.abs((Number(foe.x) || 0) - (Number(hero.x) || 0)) <= reach

  const fhp = Number(foe.hp) || 0
  const fmax = Number(foe.maxhp) || 1
  const hhp = Number(hero.hp) || 0
  const hmax = Number(hero.maxhp) || 1

  const cdMax = Math.max(1, Number(hero.cooldownMax) || 1)
  const cdLeft = clamp(Number(hero.cooldown) || 0, 0, cdMax)
  const ready = cdLeft <= 0
  const cdW = Math.min(14, Math.max(6, w - 22))
  const cdBar = paint(bar(cdMax - cdLeft, cdMax, cdW), ready ? COLOR.yes : COLOR.cooldown)
  const dist = Math.round(Math.abs((Number(foe.x) || 0) - (Number(hero.x) || 0)))

  const lines = [
    row(w, paint(fg + ' ' + ascii(foe.name || 'enemigo'), COLOR.foe), fhp + '/' + fmax),
    paint(bar(fhp, fmax, w), hpColor(fhp / fmax)),
    '',
    padTo(glyphs.join(''), w),
    padTo(paint(ground, COLOR.border), w),
    row(w, dots.join(''), inReach ? paint('a tiro', COLOR.yes) : paint('lejos', COLOR.no)),
    '',
    row(w, paint(hg + ' ' + ascii(hero.name || 'vos'), COLOR.hero), hhp + '/' + hmax),
    paint(bar(hhp, hmax, w), hpColor(hhp / hmax)),
    '',
    row(w, 'golpe ' + cdBar + (ready ? ' listo' : ''), 'dist ' + dist),
    row(w, 'alcance ' + reach, '')
  ]

  if (c && c.over) {
    const banner = '-- ' + ascii(c.over) + ' --'
    const left = Math.max(0, Math.floor((w - style.width(banner)) / 2))
    lines.push('')
    lines.push(padTo(' '.repeat(left) + style().bold(true).render(banner), w))
  }

  return style().width(w).height(h).alignVertical(style.position.center).render(lines.join('\n'))
}

// ---------------------------------------------------------------------------
// the shop
// ---------------------------------------------------------------------------

/**
 * A shop: what is for sale, what it costs, and what you can actually afford.
 *
 * Affordability is spelled out in words as well as in colour. A player on a
 * monochrome terminal, or one who cannot tell red from green, still has to be
 * able to see why the purchase is not happening.
 *
 * @param {object} shop
 * @param {string} [shop.title]
 * @param {number} [shop.gold]
 * @param {number} [shop.cursor] index of the highlighted row
 * @param {Array<{name: string, glyph?: string, price: number, about?: string, owned?: boolean}>} shop.items
 * @param {number} w
 * @param {number} h
 * @returns {string}
 */
function shopPane(shop, w, h) {
  const gold = Number(shop && shop.gold) || 0
  const items = (shop && shop.items) || []
  const cursor = Math.round(Number(shop && shop.cursor) || 0)

  const lines = [
    row(
      w,
      style()
        .bold(true)
        .render(ascii((shop && shop.title) || 'tienda')),
      paint('oro ' + gold, COLOR.gold)
    ),
    '-'.repeat(w)
  ]

  if (items.length === 0) {
    lines.push('')
    lines.push('no hay nada a la venta')
    return style().width(w).height(h).render(lines.join('\n'))
  }

  const tags = items.map((it) => {
    if (it.owned) return 'ya lo tenes'
    const price = Number(it.price) || 0
    return gold >= price ? 'comprar' : 'faltan ' + (price - gold)
  })
  let tagW = 0
  let priceW = 0
  for (let i = 0; i < items.length; i++) {
    tagW = Math.max(tagW, tags[i].length)
    priceW = Math.max(priceW, String(Number(items[i].price) || 0).length)
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const price = Number(it.price) || 0
    const here = i === cursor
    const left = (here ? '> ' : '  ') + itemLabel(it)
    const right = padLeftTo(String(price), priceW) + ' o  ' + padTo(tags[i], tagW)
    const color = it.owned ? null : gold >= price ? COLOR.yes : COLOR.no
    const line = row(w, here ? style().bold(true).render(left) : left, paint(right, color))
    lines.push(line)
  }

  const sel = items[clamp(cursor, 0, items.length - 1)]
  if (sel && sel.about) {
    lines.push('-'.repeat(w))
    for (const l of wrap(ascii(sel.about), w)) lines.push(style().faint(true).render(l))
  }

  return style().width(w).height(h).render(lines.join('\n'))
}

// ---------------------------------------------------------------------------
// the whole screen
// ---------------------------------------------------------------------------

/**
 * Geometry of the split layout for a given terminal size. Exposed so a model
 * can size things in `update()` instead of discovering them in `view()`.
 *
 * @param {number} width
 * @param {number} height
 * @returns {{ok: boolean, width: number, height: number, bodyH: number, mainW: number, mainH: number, sideW: number}}
 */
function layout(width, height) {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const bodyH = Math.max(3, h - 2)
  return {
    ok: w >= MIN_WIDTH && h >= MIN_HEIGHT,
    width: w,
    height: h,
    bodyH,
    mainW: Math.max(8, w - SIDE_W - 5),
    mainH: Math.max(1, bodyH - 2),
    sideW: SIDE_W
  }
}

/**
 * Assemble a frame: title bar, main pane on the left, stats over log on the
 * right, hint line at the bottom.
 *
 * `main` may be a string or a function `(w, h) => string`. The function form is
 * the one to use, because the pane cannot know how much room it has until this
 * function has measured its own chrome. The chrome is measured, never counted:
 * a hardcoded line count goes stale the day somebody adds a line to the header,
 * and the frame silently becomes one row taller than the screen.
 *
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {string} [opts.title]
 * @param {string} [opts.subtitle]
 * @param {string|function(number, number): string} opts.main
 * @param {object} [opts.stats] see statsPanel
 * @param {Array<string|{text: string}>} [opts.log]
 * @param {string} [opts.footer]
 * @param {string} [opts.mainCaption]
 * @returns {string}
 */
function compose(opts) {
  const width = Math.max(0, Math.floor(opts.width))
  const height = Math.max(0, Math.floor(opts.height))

  const small = tooSmall(width, height)
  if (small !== null) return small

  const title = style()
    .reverse(true)
    .render(row(width, ' ' + ascii(opts.title || 'runa'), ascii(opts.subtitle || '') + ' '))
  const footer = style()
    .faint(true)
    .render(row(width, ' ' + ascii(opts.footer || ''), ''))

  const bodyH = Math.max(3, height - style.height(title) - style.height(footer))

  // The stats box takes what it needs, the log box takes the rest. Measuring
  // the stats box means adding a stat never silently eats the log's border.
  const statsContent = statsPanel(opts.stats, SIDE_W)
  let statsBox = box(statsContent, SIDE_W, undefined, 'ficha')
  let statsH = style.height(statsBox)
  if (statsH > bodyH - 3) {
    statsH = Math.max(3, bodyH - 3)
    statsBox = box(statsContent, SIDE_W, statsH - 2, 'ficha')
  }
  const logH = Math.max(3, bodyH - statsH)
  const logBox = box(logPanel(opts.log, SIDE_W, logH - 2), SIDE_W, logH - 2, 'log')

  const mainW = Math.max(8, width - SIDE_W - 5)
  const mainH = Math.max(1, bodyH - 2)
  const inner = typeof opts.main === 'function' ? opts.main(mainW, mainH) : String(opts.main || '')
  const mainBox = box(inner, mainW, mainH, opts.mainCaption)

  const side = style.joinVertical(style.position.left, statsBox, logBox)
  const body = style.joinHorizontal(style.position.top, mainBox, ' ', side)
  return style.joinVertical(style.position.left, title, body, footer)
}

/**
 * Walking around: the map on the left, the character sheet on the right.
 * @param {object} m
 * @returns {string}
 */
function mapScreen(m) {
  return compose({
    width: m.width,
    height: m.height,
    title: m.title || 'runa',
    subtitle: m.subtitle || '',
    mainCaption: m.place || '',
    main: (w, h) => mapPane(m.map, w, h, { cellW: m.cellW }),
    stats: m.stats,
    log: m.log,
    footer: m.footer || 'wasd o flechas | e entrar | ? script | q salir'
  })
}

/**
 * Fighting: the arena on the left. The player does not steer this one, their
 * script does, so the hint line says so instead of listing keys that do
 * nothing.
 * @param {object} m
 * @returns {string}
 */
function combatScreen(m) {
  return compose({
    width: m.width,
    height: m.height,
    title: m.title || 'runa',
    subtitle: m.subtitle || '',
    mainCaption: m.place || 'combate',
    main: (w, h) => arenaPane(m.combat, w, h),
    stats: m.stats,
    log: m.log,
    footer: m.footer || 'pelea tu script | r recargar script | q salir'
  })
}

/**
 * Shopping.
 * @param {object} m
 * @returns {string}
 */
function shopScreen(m) {
  return compose({
    width: m.width,
    height: m.height,
    title: m.title || 'runa',
    subtitle: m.subtitle || '',
    mainCaption: m.place || (m.shop && m.shop.title) || 'tienda',
    main: (w, h) => shopPane(m.shop, w, h),
    stats: m.stats,
    log: m.log,
    footer: m.footer || 'arriba/abajo elegir | enter comprar | esc salir'
  })
}

module.exports = {
  titleScreen,
  LOGO,
  // constants
  MIN_WIDTH,
  MIN_HEIGHT,
  SIDE_W,
  CELL_W,
  BORDER,
  COLOR,

  // whole screens
  compose,
  mapScreen,
  combatScreen,
  shopScreen,
  layout,
  tooSmall,

  // panes
  mapPane,
  arenaPane,
  shopPane,
  statsPanel,
  logPanel,

  // pieces
  box,
  bar,
  statLine,
  hpColor,
  itemLabel,
  row,
  wrap,
  padTo,
  padLeftTo,
  ascii
}
