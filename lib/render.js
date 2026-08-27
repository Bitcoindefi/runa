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
const { makeMovingHeroSprite } = require('./sprites.js')
const { WORLD_BOSS } = require('./world-boss.js')
const { bossCamera } = require('./world-boss-event.js')

/** Smallest terminal the split layout is designed for. */
const MIN_WIDTH = 64

/** Smallest terminal the split layout is designed for. */
const MIN_HEIGHT = 16

/** Inner width of the right hand column (stats above, log below). */
const SIDE_W = 26

/** Terminal columns per map tile. Two, because cells are about 1:2. */
const CELL_W = 2

/** Torso column inside the approved asymmetric hero drawing. */
const HERO_ANCHOR_X = 2

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
const SOLID = '#%^=~":,-|+'

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

/** Colour belongs to terrain, not map data: collision stays plain ASCII. */
function mapColor(ch) {
  if (ch === ',' || ch === '"' || ch === 't') return 'green'
  if (ch === '~') return 'blue'
  if (ch === '*' || ch === '^' || ch === '/' || ch === '\\') return 'magenta'
  if (ch === 'O' || ch === '[' || ch === ']' || '(){}'.includes(ch)) return 'cyan'
  if (ch === 'o' || ch === '%' || '#+=-|;_'.includes(ch)) return 'gray'
  if (ch === ':' || /[A-Z<>a-z]/.test(ch)) return 'yellow'
  return null
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

/**
 * Paint a row in colour runs instead of wrapping every individual character in
 * its own ANSI open/reset pair. The visible result is identical, but a moving
 * field actor no longer turns one 120-cell row into thousands of output bytes.
 *
 * @param {string[]|string} cells
 * @param {Array<string|null>} colors
 * @returns {string}
 */
function paintRuns(cells, colors) {
  const chars = Array.isArray(cells) ? cells : String(cells).split('')
  if (chars.length === 0) return ''

  const foreground = {
    black: 30,
    red: 31,
    green: 32,
    yellow: 33,
    blue: 34,
    magenta: 35,
    cyan: 36,
    white: 37,
    gray: 90
  }

  // One SGR change replaces the preceding foreground directly. Reset only
  // when returning to uncoloured text or at the end of the row; closing and
  // reopening every short terrain run doubles the bytes around transparent
  // actor cells and can revive the terminal redraw problem.
  if (colors.every((color) => !color || foreground[color])) {
    let out = ''
    let active = null
    for (let i = 0; i < chars.length; i++) {
      const color = colors[i] || null
      if (color !== active) {
        out += color ? `\u001b[${foreground[color]}m` : '\u001b[39m'
        active = color
      }
      out += chars[i]
    }
    if (active) out += '\u001b[39m'
    return out
  }

  let out = ''
  let from = 0
  while (from < chars.length) {
    const color = colors[from] || null
    let to = from + 1
    while (to < chars.length && (colors[to] || null) === color) to++
    out += paint(chars.slice(from, to).join(''), color)
    from = to
  }
  return out
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
 * @param {{x:number,y:number,area:string}} [p.coordinates]
 * @param {object|string|null} [p.left]
 * @param {object|string|null} [p.right]
 * @param {object|string|null} [p.chest]
 * @param {object|string|null} [p.head]
 * @param {object|string|null} [p.boots]
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
    )
  ]
  lines.push(
    statLine('hp', hp, maxhp, w, hpColor(hp / maxhp)),
    statLine('xp', xp, xpNext, w, COLOR.xp),
    row(
      w,
      paint('oro ' + (p.gold === undefined ? 0 : p.gold), COLOR.gold),
      'pociones ' + (p.potions === undefined ? 0 : p.potions)
    ),
    row(w, 'izq ' + itemLabel(p.left)),
    row(w, 'der ' + itemLabel(p.right)),
    row(w, 'pecho ' + itemLabel(p.chest)),
    row(w, 'casco ' + itemLabel(p.head)),
    row(w, 'botas ' + itemLabel(p.boots))
  )
  if (p.quest) {
    const progress = `${Number(p.quest.progress) || 0}/${Number(p.quest.count) || 0}`
    lines.push(
      row(w, p.quest.ready ? 'mision lista: volver' : `mision ${p.quest.label} ${progress}`)
    )
  }
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

const WORDMARK_LINES = 6
const LOGO = [
  '  ____  _   _ _   _    _',
  ' |  _ \\| | | | \\ | |  / \\',
  ' | |_) | | | |  \\| | / _ \\',
  ' |  _ <| |_| | |\\  |/ ___ \\',
  ' |_| \\_\\\\___/|_| \\_/_/   \\_\\',
  '      RUNA  //  UN RPG HECHO EN BARE',
  '',
  '       |>>>                              |>>>',
  '   _  _|_  _                        _  _|_  _',
  '  |;|_|;|_|;|        .-^-.         |;|_|;|_|;|',
  '  \\\\.    .  /         |+ +|         \\\\.    .  /',
  '   ||:  .  |          |_-_|          ||:  .  |',
  '   ||:     |        __/| |\\__        ||:     |',
  ' __||______|_______/__/| |\\__\\_______||______|__',
  '      /  \\            /_| |_\\            /  \\',
  '                     /_/   \\_\\'
]

/**
 * The title card. Centred on whatever the terminal gives us, and it
 * degrades to just the word when the terminal is too narrow for the art.
 * @param {number} w
 * @param {number} h
 * @param {string} [status]
 * @param {object} [menu]
 * @returns {string}
 */
function titleScreen(w, h, status, menu = null) {
  w = Math.max(0, Math.floor(w))
  h = Math.max(0, Math.floor(h))
  const wordmark = LOGO.slice(0, WORDMARK_LINES)
  const fits = (lines, extraRows) =>
    h >= lines.length + extraRows && Math.max(...lines.map((line) => line.length)) + 2 <= w
  const slots = menu && Array.isArray(menu.slots) ? menu.slots : null
  const full = fits(LOGO, slots ? 12 : 4)
  const art = full ? LOGO : fits(wordmark, 4) ? wordmark : ['RUNA']
  const centre = (t) => ' '.repeat(Math.max(0, Math.floor((w - style.width(t)) / 2))) + t
  const tag = 'no controlas a tu personaje. escribis las reglas que sigue.'
  const sceneWidth = Math.max(...LOGO.slice(WORDMARK_LINES + 1).map((line) => line.length))
  const painted = art.map((line, i) => {
    const color = i < WORDMARK_LINES ? 'yellow' : 'gray'
    const canvas = full && i > WORDMARK_LINES ? line.padEnd(sceneWidth) : line
    return centre(
      style()
        .bold(i < WORDMARK_LINES)
        .foreground(color)
        .render(canvas)
    )
  })
  const body = [...painted, '']
  if (!slots) {
    body.push(
      centre(
        style()
          .faint(true)
          .render(tag.length <= w - 2 ? tag : 'escribis las reglas')
      ),
      '',
      centre(style().reverse(true).render(' ENTER / ESPACIO  nueva partida ')),
      centre(style().faint(true).render(' Q  salir '))
    )
  } else {
    const page = menu.page || 'slots'
    if (page === 'main') {
      const playable = slots.filter((slot) => slot && !slot.empty && !slot.corrupt)
      const latest = playable
        .slice()
        .sort((a, b) => String(b.savedAt || '').localeCompare(a.savedAt || ''))[0]
      const choices = [
        {
          label: latest
            ? `CONTINUAR  R${latest.slot} - ${ascii(latest.name)}`
            : 'CONTINUAR  (sin partidas)',
          disabled: !latest
        },
        { label: 'NUEVA PARTIDA', disabled: false },
        {
          label: playable.length ? 'CARGAR PARTIDA' : 'CARGAR PARTIDA  (sin partidas)',
          disabled: !playable.length
        },
        { label: 'CONTROLES', disabled: false },
        { label: 'SALIR', disabled: false }
      ]
      const cursor = Math.max(0, Math.min(choices.length - 1, Number(menu.cursor) || 0))
      body.push(centre(style().bold(true).foreground('yellow').render('MENU PRINCIPAL')))
      for (let index = 0; index < choices.length; index++) {
        const choice = choices[index]
        const selected = index === cursor
        const line = (selected ? '> ' : '  ') + choice.label
        const paint = style().faint(choice.disabled).reverse(selected)
        body.push(centre(paint.render(selected ? ' ' + line + ' ' : line)))
      }
      body.push(
        '',
        centre(
          style()
            .faint(true)
            .render('ARRIBA/ABAJO | ENTER / ESPACIO aceptar | ? controles | N nueva | Q salir')
        )
      )
    } else {
      body.push(centre(style().bold(true).foreground('yellow').render('PARTIDAS GUARDADAS')))
      const cursor = Math.max(0, Math.min(slots.length - 1, Number(menu.cursor) || 0))
      for (let index = 0; index < slots.length; index++) {
        const slot = slots[index] || { slot: index + 1, empty: true }
        const selected = index === cursor
        let label = `[${slot.slot || index + 1}] `
        if (slot.empty) label += 'VACIA'
        else if (slot.corrupt) label += 'GUARDADO DANADO - N para reemplazar'
        else {
          label += `${ascii(slot.name || 'viajero')} | ${ascii(slot.realm || 'runa')} | nv ${slot.level || 1} | ${ascii(slot.place || 'ciudad')}`
        }
        const line = (selected ? '> ' : '  ') + label
        body.push(
          centre(
            selected
              ? style()
                  .reverse(true)
                  .render(' ' + line + ' ')
              : line
          )
        )
      }
      body.push(
        '',
        centre(
          style().faint(true).render('ENTER cargar | N nueva/reemplazar | ESC volver | Q salir')
        )
      )
    }
    const message = ascii(String(menu.message || '')).trim()
    if (message) body.push(centre(style().foreground('red').render(message)))
  }

  // Who else is out there, if the caller knows. It goes last and it is the
  // first thing dropped when the terminal is short: the logo and the prompt are
  // what this screen is for, and a status line that pushes them off the bottom
  // has made things worse than saying nothing.
  const note = ascii(String(status || '')).trim()
  if (note && note.length <= w - 2) {
    body.push('')
    body.push(centre(style().faint(true).render(note)))
    if (body.length > h) body.length -= 2
  }

  const pad = Math.max(0, Math.floor((h - body.length) / 2))
  const out = Array(pad).fill('').concat(body)
  while (out.length < h) out.push('')
  return out
    .slice(0, h)
    .map((line) => padTo(line, w))
    .join('\n')
}

/** Name entry shown between the main menu and a fresh game. */
function newGameScreen(w, h, input, initial, error, options = {}) {
  w = Math.max(0, Math.floor(w))
  h = Math.max(0, Math.floor(h))
  const centre = (line) =>
    ' '.repeat(Math.max(0, Math.floor((w - style.width(line)) / 2))) + style.truncate(line, w)
  const sprite = heroSprite({ initial, items: [] })
  const realms = Array.isArray(options.realms) ? options.realms : []
  const realmCursor = Math.max(
    0,
    Math.min(realms.length - 1, Math.floor(Number(options.realmCursor) || 0))
  )
  const realmChoices = realms.map((realm, index) => {
    const label = `${ascii(realm.name)} - ${ascii(realm.about)}`
    return index === realmCursor ? style().reverse(true).render(` < ${label} > `) : `   ${label}   `
  })
  const body = [
    centre(style().bold(true).foreground('yellow').render('NUEVA PARTIDA')),
    centre(
      style()
        .faint(true)
        .render(`RANURA ${options.slot || 1}`)
    ),
    '',
    ...sprite.map((line) => centre(style().foreground(COLOR.hero).render(line))),
    '',
    centre('tu inicial va en el pecho del personaje'),
    '',
    centre('NOMBRE  ' + String(input || '')),
    '',
    centre(style().bold(true).render('REINO DE ORIGEN')),
    ...realmChoices.map((choice) => centre(choice)),
    centre(style().faint(true).render('IZQUIERDA / DERECHA elegir reino')),
    '',
    centre(style().reverse(true).render(' ENTER  comenzar ')),
    centre(style().faint(true).render(' ESC  volver '))
  ]
  if (options.replacing) {
    body.push(
      '',
      centre(
        style()
          .foreground('yellow')
          .render(`reemplazara la partida de ${ascii(options.replacing)}`)
      )
    )
  }
  if (error) body.push('', centre(style().foreground('red').render(ascii(error))))
  const pad = Math.max(0, Math.floor((h - body.length) / 2))
  const out = Array(pad).fill('').concat(body).slice(0, h)
  while (out.length < h) out.push('')
  return out.map((line) => padTo(line, w)).join('\n')
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
 * @param {{x: number, y: number, glyph?: string, sprite?: string[]}} map.hero
 * @param {Array<{x: number, y: number, glyph?: string, sprite?: string[], color?: string}>} [map.actors]
 * @param {Array<{cadence?:number,frames:Array<Array<{x:number,y:number,glyph:string,color?:string}>>}>} [map.animations]
 * @param {number} [map.frame]
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
  const heroSpriteData = Array.isArray(hero.sprite) && hero.sprite.length ? hero.sprite : null
  const heroW = heroSpriteData
    ? heroSpriteData.reduce((widest, line) => Math.max(widest, ascii(line).length), 1)
    : 1

  const occupied = new Set()
  const over = new Map()
  const actorColors = new Map()
  const animationFrame = Math.max(0, Math.floor(Number(map && map.frame) || 0))
  for (const animation of (map && map.animations) || []) {
    const frames = animation && Array.isArray(animation.frames) ? animation.frames : []
    if (!frames.length) continue
    const cadence = Math.max(1, Math.floor(Number(animation.cadence) || 1))
    const cells = frames[Math.floor(animationFrame / cadence) % frames.length] || []
    for (const cell of cells) {
      const x = Math.round(Number(cell && cell.x))
      const y = Math.round(Number(cell && cell.y))
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const key = y + ',' + x
      over.set(key, ascii(cell.glyph || ' ')[0] || ' ')
      actorColors.set(key, cell.color || 'blue')
    }
  }
  for (const a of (map && map.actors) || []) {
    if (!a) continue
    const ax = Math.round(Number(a.x) || 0)
    const ay = Math.round(Number(a.y) || 0)
    const actorSprite = Array.isArray(a.sprite) && a.sprite.length ? a.sprite : null

    if (!actorSprite) {
      const cell = ay + ',' + ax
      over.set(cell, ascii(a.glyph || '?')[0] || '?')
      actorColors.set(cell, a.color || COLOR.foe)
      continue
    }

    const actorW = actorSprite.reduce((widest, line) => Math.max(widest, ascii(line).length), 1)

    let drawX = ax
    const drawY = ay

    const playerAnchor = clamp(HERO_ANCHOR_X, 0, heroW - 1)
    const foeAnchor = Math.floor(actorW / 2)
    const heroLeft = hx - playerAnchor
    const heroRight = heroLeft + heroW - 1
    const defaultActorLeft = ax - foeAnchor
    const defaultActorRight = defaultActorLeft + actorW - 1

    // The horizontal test uses the real sprite boxes, so the vertical one has to
    // as well. It used to be `Math.abs(ay - hy) <= 2`, a literal that predates the
    // taller mover sprites: MOVER_HEIGHT is 4 and the hero is 3 rows, so a hero
    // standing three tiles above an NPC overlapped its head while the guard said
    // they were clear, and the hero painted over it.
    const heroH = heroSpriteData ? heroSpriteData.length : 1
    const heroAnchorRow = Number.isFinite(Number(hero.anchorY))
      ? Math.round(Number(hero.anchorY))
      : Math.floor(heroH / 2)
    const heroTop = hy - clamp(heroAnchorRow, 0, heroH - 1)
    const heroBottom = heroTop + heroH - 1

    const actorH = actorSprite.length
    const actorAnchorRow = Number.isFinite(Number(a.anchorY))
      ? Math.round(Number(a.anchorY))
      : Math.floor(actorH / 2)
    const actorTop = ay - clamp(actorAnchorRow, 0, actorH - 1)
    const actorBottom = actorTop + actorH - 1

    const rowsOverlap = heroTop <= actorBottom && heroBottom >= actorTop

    const isOverlapping =
      heroLeft <= defaultActorRight && heroRight >= defaultActorLeft && rowsOverlap

    if (isOverlapping || Math.max(Math.abs(ax - hx), Math.abs(ay - hy)) <= 2) {
      const wantedSide = Math.sign(ax - hx) || 1
      const rightGap = heroW - 1 - playerAnchor + foeAnchor + 1
      const leftGap = playerAnchor + (actorW - 1 - foeAnchor) + 1
      const right = hx + rightGap
      const left = hx - leftGap
      const minX = camX + foeAnchor
      const maxX = camX + cols - 1 - Math.floor(actorW / 2)
      const preferred = wantedSide > 0 ? right : left
      const alternate = wantedSide > 0 ? left : right
      drawX = preferred >= minX && preferred <= maxX ? preferred : clamp(alternate, minX, maxX)
    }

    const left = drawX - Math.floor(actorW / 2)
    const anchorY = Number.isFinite(Number(a.anchorY))
      ? Math.round(Number(a.anchorY))
      : Math.floor(actorSprite.length / 2)
    const top = drawY - clamp(anchorY, 0, actorSprite.length - 1)

    const footprint = []
    for (let sy = 0; sy < actorSprite.length; sy++) {
      const line = ascii(actorSprite[sy]).padEnd(actorW)
      const first = line.search(/\S/)
      if (first === -1) continue
      let last = line.length - 1
      while (last > first && line[last] === ' ') last--
      for (let sx = first; sx <= last; sx++) {
        if (line[sx] !== ' ') footprint.push(top + sy + ',' + (left + sx))
      }
    }

    if (footprint.some((cell) => occupied.has(cell))) {
      const centre = drawY + ',' + drawX
      if (!occupied.has(centre)) {
        over.set(centre, ascii(a.glyph || '?')[0] || '?')
        actorColors.set(centre, a.color || COLOR.foe)
        occupied.add(centre)
      }
      continue
    }

    for (let sy = 0; sy < actorSprite.length; sy++) {
      const line = ascii(actorSprite[sy]).padEnd(actorW)
      const first = line.search(/\S/)
      if (first === -1) continue
      let last = line.length - 1
      while (last > first && line[last] === ' ') last--
      for (let sx = first; sx <= last; sx++) {
        if (line[sx] === ' ') continue
        const cell = top + sy + ',' + (left + sx)
        over.set(cell, line[sx])
        actorColors.set(cell, a.color || COLOR.foe)
        occupied.add(cell)
      }
    }
  }

  const heroCells = new Set()
  const sprite = Array.isArray(hero.sprite) && hero.sprite.length ? hero.sprite : null
  if (sprite) {
    const spriteW = sprite.reduce((widest, line) => Math.max(widest, ascii(line).length), 1)
    const left = hx - clamp(HERO_ANCHOR_X, 0, spriteW - 1)
    // World coordinates are feet cells. Keeping the whole body above that
    // cell prevents a mover beside a wall from painting through its next row.
    const heroAnchorY = Number.isFinite(Number(hero.anchorY))
      ? Math.round(Number(hero.anchorY))
      : sprite.length - 1
    const top = hy - clamp(heroAnchorY, 0, sprite.length - 1)

    for (let sy = 0; sy < sprite.length; sy++) {
      const line = ascii(sprite[sy]).padEnd(spriteW)
      const first = line.search(/\S/)
      if (first === -1) continue
      let last = line.length - 1
      while (last > first && line[last] === ' ') last--
      for (let sx = first; sx <= last; sx++) {
        if (line[sx] === ' ') continue
        const cell = top + sy + ',' + (left + sx)
        over.set(cell, line[sx])
        heroCells.add(cell)
      }
    }
  } else {
    const cell = hy + ',' + hx
    over.set(cell, ascii(hero.glyph || '@')[0] || '@')
    heroCells.add(cell)
  }

  const out = []
  for (let r = 0; r < h; r++) {
    const y = camY + r
    let line = ''
    for (let c = 0; c < cols; c++) {
      const x = camX + c
      const rowStr = y >= 0 && y < mapH ? String(tiles[y]) : ''
      let ch = x >= 0 && x < rowStr.length ? rowStr[x] : ' '
      const key = y + ',' + x
      const g = over.get(key)
      const isActor = g !== undefined
      if (isActor) ch = g
      const visualGlyph = ch === '`' ? ' ' : ch
      const cell = expandCell(ascii(visualGlyph), cellW, isActor)
      const isHero = heroCells.has(key)
      line += paint(cell, isHero ? COLOR.hero : isActor ? actorColors.get(key) : mapColor(ch))
    }
    out.push(padTo(line, w))
  }
  return out.join('\n')
}

/**
 * Approved scrolling hero drawn at eight by three characters. Its two walking
 * poses move the limbs while preserving the exact footprint and visual weight.
 *
 * @param {number|{frame?:number,items?:string[]}} [options]
 * @returns {string[]}
 */
function heroSprite(options = {}) {
  const normalized = typeof options === 'number' ? { frame: options } : options || {}
  return makeMovingHeroSprite({
    frame: normalized.frame,
    items: normalized.items,
    initial: normalized.initial
  })
}

const FIELD_SPRITES = {
  mosquito: {
    lines: ['\\ /', '(o)>', '/ \\'],
    marker: 'm',
    color: 'magenta'
  },
  espectro: {
    lines: ['.-.', '(S)', '~~~'],
    marker: 'S',
    color: 'cyan'
  },
  golem: {
    lines: ['[##]', '[G]', '/ \\'],
    marker: 'G',
    color: 'yellow'
  },
  barbarian_raider: {
    lines: ['{b}', '/|>', '/ \\'],
    marker: 'b',
    color: 'yellow'
  },
  barbarian_thrower: {
    lines: ['{r}', '-|--', '/ \\'],
    marker: 'r',
    color: 'cyan'
  },
  barbarian_chief: {
    lines: ['^B^', '/#\\', '/ \\'],
    marker: 'B',
    color: 'red'
  },
  slime: {
    lines: ['___', '(o)', '~~~'],
    marker: 'o',
    color: 'green'
  },
  skeleton: {
    lines: ['.-.', '|S|', '/ \\'],
    marker: 'S',
    color: 'gray'
  },
  skeleton_knight: {
    lines: ['[_]', '/K]', '/ \\'],
    marker: 'K',
    color: 'cyan'
  },
  skeleton_archer: {
    lines: ['.-)', '-A}', '/ \\'],
    marker: 'A',
    color: 'yellow'
  },
  skeleton_elite: {
    lines: ['[E]', '/|\\', '/ \\'],
    marker: 'E',
    color: 'magenta'
  },
  skeleton_king: {
    lines: ['^K^', '/|\\', '/ \\'],
    marker: 'K',
    color: 'red'
  }
}

/**
 * Paint roaming field foes as small moving sprites instead of ambiguous map
 * punctuation. World coordinates remain one cell per actor; the sprite is a
 * visual footprint centred on that position and clipped by the camera.
 *
 * @param {object} field
 * @param {string[]} field.rows already-rendered terrain viewport
 * @param {number} field.width world width
 * @param {number} field.height world height
 * @param {{x:number,y:number}} field.player
 * @param {Array<{x:number,y:number,kind:string,glyph?:string}>} field.foes
 * @param {number} w
 * @param {number} h
 * @returns {string}
 */
function fieldPane(field, w, h) {
  const source = (field && field.rows) || []
  const vh = Math.min(Math.max(0, h), source.length)
  const vw = Math.max(1, w)
  const grid = []
  const colors = []

  for (let y = 0; y < vh; y++) {
    const row_ = ascii(source[y] || '')
      .padEnd(vw)
      .slice(0, vw)
      .split('')
    grid.push(row_)
    colors.push(
      row_.map((ch) => {
        if (field && field.mode === 'boss' && ch === '.') return 'gray'
        if (field && field.mode === 'boss' && ch === ',') return 'red'
        if (ch === '~') return 'red'
        if (ch === '.' || ch === '"') return 'green'
        if (ch === ',') return 'green'
        if (ch === '%') return 'gray'
        if (ch === ':') return 'yellow'
        if (ch === '*') return 'magenta'
        if (ch === 'o') return 'gray'
        if (ch === '<') return 'cyan'
        if (ch === '#' || ch === '|' || ch === '-' || ch === '[' || ch === ']') return 'gray'
        if (ch === '^' || ch === 'v') return 'cyan'
        if (ch === 'X') return 'cyan'
        if (ch === 'J' || ch === 'U') return 'cyan'
        if (ch === 'O') return 'magenta'
        if (ch === '=' || ch === 'T') return 'yellow'
        return null
      })
    )
  }

  const player = (field && field.player) || { x: 0, y: 0 }
  const px = Math.round(Number(player.x) || 0)
  const py = Math.round(Number(player.y) || 0)
  const worldW = Math.max(vw, Math.round(Number(field && field.width) || vw))
  const worldH = Math.max(vh, Math.round(Number(field && field.height) || vh))
  const boss = field && field.boss
  const { ox, oy } = bossCamera(player, boss, worldW, worldH, vw, vh)
  const playerArt =
    Array.isArray(player.sprite) && player.sprite.length
      ? player.sprite
      : heroSprite({ frame: px + py, items: player.items })
  const playerW = playerArt.reduce((widest, line) => Math.max(widest, ascii(line).length), 1)
  const playerH = playerArt.length

  const put = (x, y, ch, color) => {
    const gx = Math.round(x) - ox
    const gy = Math.round(y) - oy
    if (gx < 0 || gy < 0 || gx >= vw || gy >= vh) return
    grid[gy][gx] = ascii(ch || ' ')[0] || ' '
    colors[gy][gx] = color
  }

  const occupied = new Set()
  const guideArt = ['  /\\', ' (o)', ' /|\\', ' / \\']
  for (const guide of (field && field.guides) || []) {
    const left = Math.round(guide.x) - 2
    const top = Math.round(guide.y) - guideArt.length + 1
    for (let sy = 0; sy < guideArt.length; sy++) {
      for (let sx = 0; sx < guideArt[sy].length; sx++) {
        if (guideArt[sy][sx] === ' ') continue
        put(left + sx, top + sy, guideArt[sy][sx], 'cyan')
        occupied.add(top + sy + ',' + (left + sx))
      }
    }
  }
  if (boss && !boss.defeated) {
    const phaseFrames = WORLD_BOSS.fieldSprite.phaseFrames[boss.phase]
    const bossArt =
      (phaseFrames && phaseFrames[boss.frame]) ||
      WORLD_BOSS.fieldSprite.frames[boss.frame] ||
      WORLD_BOSS.fieldSprite.frames.idle
    const left = Math.round(boss.x) - WORLD_BOSS.fieldSprite.anchor.x
    const top = Math.round(boss.y) - WORLD_BOSS.fieldSprite.anchor.y
    const bossColor = boss.active ? (boss.phase === 'furia' ? 'magenta' : 'red') : 'gray'
    for (let sy = 0; sy < bossArt.length; sy++) {
      const line = bossArt[sy]
      for (let sx = 0; sx < line.length; sx++) {
        if (line[sx] === ' ') continue
        put(left + sx, top + sy, line[sx], bossColor)
        occupied.add(top + sy + ',' + (left + sx))
      }
    }
  }

  const foes = [...((field && field.foes) || [])].filter(Boolean).sort((a, b) => {
    const ad = Math.hypot(Number(a.x) - px, Number(a.y) - py)
    const bd = Math.hypot(Number(b.x) - px, Number(b.y) - py)
    return ad - bd
  })
  for (const foe of foes) {
    if (!foe) continue
    const sprite = FIELD_SPRITES[foe.kind]
    const foeColor = foe.active ? 'red' : sprite && sprite.color
    if (!sprite) {
      put(foe.x, foe.y, foe.glyph || '?', 'red')
      continue
    }

    const height = sprite.lines.length
    const width = sprite.lines.reduce((widest, line) => Math.max(widest, line.length), 1)
    let drawX = Math.round(foe.x)
    let drawY = Math.round(foe.y)

    if (foe.active) {
      // Logical centres are one tile apart when hitboxes touch, but the ASCII
      // bodies are wider than one tile. Separate only their presentation so
      // both fighters remain readable without lying to collision or distance.
      const wantedSide = Math.sign(foe.x - px) || 1
      const playerAnchor = clamp(HERO_ANCHOR_X, 0, playerW - 1)
      const foeAnchor = Math.floor(width / 2)
      const rightGap = playerW - 1 - playerAnchor + foeAnchor + 1
      const leftGap = playerAnchor + (width - 1 - foeAnchor) + 1
      const right = px + rightGap
      const left = px - leftGap
      const minX = ox + Math.floor(width / 2)
      const maxX = ox + vw - 1 - Math.floor(width / 2)
      const preferred = wantedSide > 0 ? right : left
      const alternate = wantedSide > 0 ? left : right
      drawX = preferred >= minX && preferred <= maxX ? preferred : clamp(alternate, minX, maxX)
      drawY = clamp(py, oy + height - 1, oy + vh - 1)
    }

    const left = drawX - Math.floor(width / 2)
    const top = drawY - height + 1
    const footprint = []
    for (let sy = 0; sy < height; sy++) {
      for (let sx = 0; sx < width; sx++) footprint.push(top + sy + ',' + (left + sx))
    }

    if (footprint.some((cell) => occupied.has(cell))) {
      const centre = drawY + ',' + drawX
      if (!occupied.has(centre)) {
        put(drawX, drawY, sprite.marker, foeColor)
        occupied.add(centre)
      }
      continue
    }

    for (let sy = 0; sy < height; sy++) {
      const line = sprite.lines[sy].padEnd(width)
      for (let sx = 0; sx < width; sx++) {
        if (line[sx] === ' ') continue
        put(left + sx, top + sy, line[sx], foeColor)
      }
    }
    for (let y = top - 1; y <= top + height; y++) {
      for (let x = left - 1; x <= left + width; x++) occupied.add(y + ',' + x)
    }
  }

  // Telegraphs lock the future trajectory before release. They never damage;
  // hazards paint over them once the cast becomes real.
  for (const warning of (boss && boss.telegraphs) || []) {
    const key = Math.round(warning.y) + ',' + Math.round(warning.x)
    if (occupied.has(key)) continue
    put(warning.x, warning.y, warning.glyph || '!', 'yellow')
  }

  // Powers sit above monsters so a damaging hitbox can never become invisible
  // just because a patrol crossed its coordinate. The hero remains the top
  // layer and visibly receives the contact on the next frame.
  for (const hazard of (boss && boss.hazards) || []) {
    const hazardColor =
      hazard.kind === 'rune' ? 'magenta' : hazard.kind === 'wave' ? 'cyan' : 'yellow'
    put(hazard.x, hazard.y, hazard.glyph || '*', hazardColor)
  }

  // The player is always the top layer, including when a sprite overlaps the
  // activation edge on the step that starts combat. Its logical coordinate is
  // the torso, so adding equipment never changes collision or aggro distance.
  const playerLeft = px - clamp(HERO_ANCHOR_X, 0, playerW - 1)
  const playerTop = py - playerH + 1
  for (let sy = 0; sy < playerH; sy++) {
    const line = ascii(playerArt[sy]).padEnd(playerW)
    for (let sx = 0; sx < playerW; sx++) {
      const ch = line[sx]
      if (ch === ' ') continue
      put(playerLeft + sx, playerTop + sy, ch, COLOR.hero)
    }
  }

  return grid.map((line, y) => paintRuns(line, colors[y])).join('\n')
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
 * @param {object} c.hero  { glyph, sprite?, name, x, hp, maxhp, reach, cooldown, cooldownMax }
 * @param {object} c.foe   { glyph, name, x, hp, maxhp, portrait? }
 * @param {number} [c.turn] visible combat turn
 * @param {number} [c.turnTicks] world ticks resolved by one visible turn
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
  const turn = Math.max(1, Math.floor(Number(c && c.turn) || 1))
  const turnTicks = Math.max(1, Math.floor(Number(c && c.turnTicks) || 1))
  const waitTurns = Math.max(0, Math.ceil(cdLeft / turnTicks))

  const lines = [
    row(
      w,
      paint(fg + ' ' + ascii(foe.name || 'enemigo'), COLOR.foe),
      paint('TURNO ' + turn, COLOR.gold) + '  ' + fhp + '/' + fmax
    ),
    paint(bar(fhp, fmax, w), hpColor(fhp / fmax))
  ]

  const portrait = Array.isArray(foe.portrait) ? foe.portrait.slice(0, 4) : []
  const heroArt = Array.isArray(hero.sprite) ? hero.sprite.slice(0, 4) : []
  if (h >= 18 && (portrait.length || heroArt.length)) {
    lines.push('')
    const artH = Math.max(portrait.length, heroArt.length)
    for (let i = 0; i < artH; i++) {
      const foeLine = portrait[i] ? paint(ascii(portrait[i]).trimEnd(), COLOR.foe) : ''
      const heroLine = heroArt[i] ? paint(ascii(heroArt[i]).trimEnd(), COLOR.hero) : ''
      lines.push(row(w, foeLine, heroLine))
    }
  }

  lines.push(
    '',
    padTo(glyphs.join(''), w),
    padTo(paint(ground, COLOR.border), w),
    row(
      w,
      dots.join(''),
      inReach ? paint('EN ALCANCE', COLOR.yes) : paint('FUERA DE ALCANCE', COLOR.no)
    ),
    '',
    row(w, paint(hg + ' ' + ascii(hero.name || 'vos'), COLOR.hero), hhp + '/' + hmax),
    paint(bar(hhp, hmax, w), hpColor(hhp / hmax)),
    '',
    row(w, 'proximo golpe ' + cdBar, ready ? paint('LISTO', COLOR.yes) : 'espera ' + waitTurns),
    row(w, 'alcance del arma ' + reach, 'distancia ' + dist)
  )

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

  const loadout = shop && shop.loadout
  if (loadout) {
    lines.push(row(w, 'izq ' + itemLabel(loadout.left), 'der ' + itemLabel(loadout.right)))
    lines.push(row(w, 'pecho ' + itemLabel(loadout.chest), 'casco ' + itemLabel(loadout.head)))
    lines.push(row(w, 'botas ' + itemLabel(loadout.boots)))
    lines.push('-'.repeat(w))
  }

  if (items.length === 0) {
    lines.push('')
    lines.push('no hay nada a la venta')
    return style().width(w).height(h).render(lines.join('\n'))
  }

  const tags = items.map((it) => {
    if (it.equipped) return 'equipado'
    if (it.stored) return 'depositado'
    if (it.owned) return 'equipar'
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

const EQUIPMENT_LABELS = {
  left_hand: 'mano izquierda',
  right_hand: 'mano derecha',
  chest: 'pecho',
  head: 'casco',
  boots: 'botas'
}

/** Inventory and home chest share one layout so transfers remain obvious. */
function inventoryPane(model, w, h) {
  const home = !!(model && model.home)
  const tab = model && model.tab === 'stored' ? 'stored' : 'carried'
  const items = (model && model.items) || []
  const equipped = (model && model.equipment) || {}
  const cursor = clamp(
    Math.floor(Number(model && model.cursor) || 0),
    0,
    Math.max(0, items.length - 1)
  )
  const combat = (model && model.combat) || {}
  const lines = [
    row(
      w,
      style()
        .bold(true)
        .render(home ? 'DEPOSITO DEL HOGAR' : 'EQUIPO Y MOCHILA'),
      `${items.length} / mochila`
    ),
    '-'.repeat(w)
  ]

  if (home) {
    lines.push(tab === 'carried' ? '[ MOCHILA ]   deposito' : '  mochila   [ DEPOSITO ]')
    lines.push('-'.repeat(w))
  }

  lines.push(row(w, style().bold(true).render('EQUIPO ACTIVO'), '5 RANURAS'))
  for (const slot of ['left_hand', 'right_hand', 'chest', 'head', 'boots']) {
    const item = equipped[slot]
    const label = `[${EQUIPMENT_LABELS[slot].toUpperCase()}]`
    lines.push(
      row(
        w,
        `${padTo(label, 18)} ${itemLabel(item)}`,
        item ? paint('EQUIPADO', COLOR.yes) : style().faint(true).render('VACIO')
      )
    )
  }
  lines.push(
    row(
      w,
      `ATAQUE ${Number(combat.atk) || 1}   DEFENSA ${Number(combat.defense) || 0}`,
      `ALCANCE ${Number(combat.reach) || 1}`
    )
  )
  lines.push('-'.repeat(w))

  const sectionTitle = tab === 'stored' ? 'DEPOSITO' : 'MOCHILA'
  lines.push(row(w, style().bold(true).render(sectionTitle), 'selecciona con arriba / abajo'))

  if (items.length === 0) {
    lines.push(tab === 'stored' ? 'el deposito esta vacio' : 'no llevas ningun objeto')
    return style().width(w).height(h).render(lines.join('\n'))
  }

  const detailRows = h >= 20 ? 4 : 0
  const visibleRows = Math.max(1, h - lines.length - detailRows)
  const start = clamp(
    cursor - Math.floor(visibleRows / 2),
    0,
    Math.max(0, items.length - visibleRows)
  )
  const end = Math.min(items.length, start + visibleRows)
  for (let index = start; index < end; index++) {
    const item = items[index]
    const selected = index === cursor
    const marker = selected ? '> ' : '  '
    const state = item.equipped ? '[E]' : '[ ]'
    const slot = EQUIPMENT_LABELS[item.slot] || item.slot || ''
    lines.push(
      row(
        w,
        selected
          ? style()
              .bold(true)
              .render(marker + state + ' ' + itemLabel(item))
          : marker + state + ' ' + itemLabel(item),
        item.equipped ? paint('EQUIPADO', COLOR.yes) : slot
      )
    )
  }

  const selected = items[cursor]
  if (selected && detailRows) {
    lines.push('-'.repeat(w))
    const stats = []
    if (selected.atk) stats.push(`ataque +${selected.atk}`)
    if (selected.defense) stats.push(`defensa +${selected.defense}`)
    if (selected.reach) stats.push(`alcance ${selected.reach}`)
    if (selected.speed) stats.push(`velocidad ${selected.speed > 0 ? '+' : ''}${selected.speed}`)
    lines.push(
      row(
        w,
        style()
          .bold(true)
          .render('DETALLE  ' + itemLabel(selected)),
        (EQUIPMENT_LABELS[selected.slot] || selected.slot || '').toUpperCase()
      )
    )
    lines.push(stats.length ? stats.join('  |  ') : 'sin bonificaciones')
    if (selected.about) {
      lines.push(
        style()
          .faint(true)
          .render(wrap(ascii(selected.about), w)[0])
      )
    }
  }
  return style().width(w).height(h).render(lines.join('\n'))
}

function rankingPane(model, w, h) {
  const tab = model && model.tab === 'pvp' ? 'pvp' : 'level'
  const entries = [...((model && model.entries) || [])]
  entries.sort((a, b) => {
    if (tab === 'pvp') {
      return (
        b.wins - a.wins || a.losses - b.losses || b.level - a.level || a.name.localeCompare(b.name)
      )
    }
    return b.level - a.level || b.wins - a.wins || a.name.localeCompare(b.name)
  })

  const lines = [
    row(w, tab === 'level' ? '[ NIVEL ]   pvp' : '  nivel   [ PVP ]', 'estatua de los heroes'),
    '-'.repeat(w),
    tab === 'level' ? row(w, '#  HEROE', 'NIVEL   ORIGEN') : row(w, '#  HEROE', 'V  D   NIVEL'),
    '-'.repeat(w)
  ]
  const visible = Math.max(1, h - lines.length)
  for (let i = 0; i < Math.min(entries.length, visible); i++) {
    const entry = entries[i]
    const place = String(i + 1).padStart(2) + ' '
    const name = place + ascii(entry.name || 'viajero')
    if (tab === 'level') {
      lines.push(row(w, name, `nv ${entry.level || 1}   ${ascii(entry.source || 'local')}`))
    } else {
      lines.push(
        row(
          w,
          name,
          `${Number(entry.wins) || 0}  ${Number(entry.losses) || 0}   nv ${entry.level || 1}`
        )
      )
    }
  }
  if (entries.length === 0) lines.push('todavia no hay heroes registrados')
  return style().width(w).height(h).render(lines.join('\n'))
}

/** Two-column controls list: complete at the minimum supported terminal size. */
function controlsPane(w, h) {
  const gap = 3
  const leftW = Math.max(1, Math.floor((w - gap) / 2))
  const rightW = Math.max(1, w - leftW - gap)
  const columns = (left, right = '') => padTo(left, leftW) + ' '.repeat(gap) + padTo(right, rightW)
  const heading = (text) => style().bold(true).foreground('yellow').render(text)
  const lines = [
    columns(heading('EXPLORACION'), heading('COMBATE')),
    columns('WASD / flechas  mover', 'F / espacio  atacar'),
    columns('E / enter  interactuar', 'WASD hacia rival  atacar'),
    columns('I  inventario', 'R  recargar script'),
    columns('T  volver a ciudad', '?  abrir controles'),
    '',
    columns(heading('INTERFACES'), heading('GENERAL')),
    columns('arriba / abajo  elegir', 'V  wallet y PVP'),
    columns('enter / espacio  confirmar', 'Q  salir del juego'),
    columns('tab / izq / der  cambiar', 'ESC  cerrar / volver'),
    columns('X  equipar / quitar', 'CTRL+C  salida inmediata')
  ]
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
 * @param {boolean} [opts.sidebar] false gives the main pane the full terminal width
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

  if (opts.sidebar === false) {
    const mainW = Math.max(8, width - 2)
    const mainH = Math.max(1, bodyH - 2)
    const inner =
      typeof opts.main === 'function' ? opts.main(mainW, mainH) : String(opts.main || '')
    const mainBox = box(inner, mainW, mainH, opts.mainCaption)
    return style.joinVertical(style.position.left, title, mainBox, footer)
  }

  // The stats box takes what it needs, the log box takes the rest. Measuring
  // the stats box means adding a stat never silently eats the log's border.
  const statsContent = statsPanel(opts.stats, SIDE_W)
  const coordinates = opts.stats && opts.stats.coordinates
  const statsCaption = coordinates
    ? `ficha X:${Math.round(Number(coordinates.x) || 0)} Y:${Math.round(Number(coordinates.y) || 0)} ${ascii(coordinates.area || '')}`
    : 'ficha'
  let statsBox = box(statsContent, SIDE_W, undefined, statsCaption)
  let statsH = style.height(statsBox)
  if (statsH > bodyH - 3) {
    statsH = Math.max(3, bodyH - 3)
    statsBox = box(statsContent, SIDE_W, statsH - 2, statsCaption)
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
  const tiles = (m.map && m.map.tiles) || []
  const cellW = Math.max(1, m.cellW || CELL_W)
  const mapW = tiles.reduce((widest, line) => Math.max(widest, String(line).length), 0) * cellW
  // Large maps scroll inside the pane. Requiring the entire map to fit would
  // hide the character sheet forever as soon as a world grew beyond one view.
  const sidebar = m.sidebar === undefined ? m.width >= 64 : m.sidebar
  const stats = m.stats || {}
  const compactStats =
    'nv ' +
    (stats.level === undefined ? 1 : stats.level) +
    '  hp ' +
    (stats.hp === undefined ? 0 : stats.hp) +
    '/' +
    (stats.maxhp === undefined ? 1 : stats.maxhp) +
    '  oro ' +
    (stats.gold === undefined ? 0 : stats.gold)

  return compose({
    width: m.width,
    height: m.height,
    title: m.title || 'runa',
    subtitle: m.subtitle || (sidebar ? '' : compactStats),
    mainCaption: m.place || '',
    main: (w, h) => mapPane(m.map, w, h, { cellW: m.cellW }),
    stats: m.stats,
    log: m.log,
    sidebar,
    footer: m.footer || 'wasd o flechas | puertas automaticas | e hablar / interactuar | q salir'
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
    footer: m.footer || 'espacio / enter / f siguiente turno | r recargar script | q salir'
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
    footer: m.footer || 'arriba/abajo elegir | enter comprar/equipar | x quitar | esc salir'
  })
}

function inventoryScreen(m) {
  return compose({
    width: m.width,
    height: m.height,
    title: m.title || 'runa',
    subtitle: m.home ? 'cofre personal' : 'equipo y mochila',
    mainCaption: m.home ? 'tu hogar' : 'inventario',
    main: (w, h) => inventoryPane(m, w, h),
    stats: m.stats,
    log: m.log,
    footer: m.footer || 'arriba/abajo elegir | enter equipar | x equipar/quitar | i / esc salir'
  })
}

function rankingScreen(m) {
  return compose({
    width: m.width,
    height: m.height,
    title: 'runa',
    subtitle: m.tab === 'pvp' ? 'clasificacion pvp' : 'clasificacion por nivel',
    mainCaption: 'ranking de heroes',
    main: (w, h) => rankingPane(m, w, h),
    sidebar: false,
    footer: m.footer || 'izquierda/derecha cambiar | e / esc volver'
  })
}

function controlsScreen(m) {
  return compose({
    width: m.width,
    height: m.height,
    title: 'runa',
    subtitle: 'ayuda',
    mainCaption: 'lista de controles',
    main: (w, h) => controlsPane(w, h),
    sidebar: false,
    footer: m.footer || 'ESC / ? / ENTER volver'
  })
}

module.exports = {
  titleScreen,
  newGameScreen,
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
  inventoryScreen,
  rankingScreen,
  controlsScreen,
  layout,
  tooSmall,

  // panes
  mapPane,
  fieldPane,
  heroSprite,
  arenaPane,
  shopPane,
  inventoryPane,
  rankingPane,
  controlsPane,
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
  ascii,
  paintRuns
}
