'use strict'

/**
 * Generate HTML snapshots from the real TUI renderer. Chrome turns these into
 * the PNG files embedded by README.md; no hand-written mock screen is involved.
 *
 * Usage: bare scripts/readme-screens.js <output-directory>
 */

const fs = require('bare-fs')
const path = require('bare-path')

const { Runa } = require('../lib/game.js')
const { Field } = require('../lib/field.js')
const { Dungeon } = require('../lib/dungeon.js')
const { BossZone } = require('../lib/boss-zone.js')
const { BarbarianCamp } = require('../lib/barbarian-camp.js')

const WIDTH = 120
const HEIGHT = 34

const PALETTE = {
  30: '#111827',
  31: '#ff6b6b',
  32: '#73d99a',
  33: '#f2c94c',
  34: '#61afef',
  35: '#c678dd',
  36: '#56d4dd',
  37: '#d8dee9',
  90: '#6b7280',
  91: '#ff8585',
  92: '#8ee6aa',
  93: '#ffd76a',
  94: '#80bfff',
  95: '#dd93ef',
  96: '#75e7ed',
  97: '#ffffff'
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ansiToHtml(value) {
  const source = String(value)
  const pattern = /\x1b\[([0-9;]*)m/g
  const state = { color: '', bold: false, dim: false, reverse: false }
  let cursor = 0
  let output = ''

  const open = () => {
    const css = []
    if (state.color) css.push(`color:${state.color}`)
    if (state.bold) css.push('font-weight:700')
    if (state.dim) css.push('opacity:.58')
    if (state.reverse) css.push('color:#11151d;background:#d8dee9')
    return css.length ? `<span style="${css.join(';')}">` : '<span>'
  }

  while (true) {
    const match = pattern.exec(source)
    if (!match) break
    output += open() + escapeHtml(source.slice(cursor, match.index)) + '</span>'
    const codes = (match[1] || '0').split(';').map((code) => Number(code || 0))
    for (const code of codes) {
      if (code === 0) Object.assign(state, { color: '', bold: false, dim: false, reverse: false })
      else if (code === 1) state.bold = true
      else if (code === 2) state.dim = true
      else if (code === 7) state.reverse = true
      else if (code === 22) Object.assign(state, { bold: false, dim: false })
      else if (code === 27) state.reverse = false
      else if (code === 39) state.color = ''
      else if (PALETTE[code]) state.color = PALETTE[code]
    }
    cursor = pattern.lastIndex
  }
  return output + open() + escapeHtml(source.slice(cursor)) + '</span>'
}

function page(title, frame) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
  body {
    display: grid;
    place-items: center;
    background: radial-gradient(circle at 50% 0%, #263043 0, #11151d 58%, #090c12 100%);
  }
  .terminal {
    overflow: hidden;
    border: 1px solid #343b49;
    border-radius: 16px;
    background: #11151d;
    box-shadow: 0 28px 80px rgba(0,0,0,.52), 0 0 0 1px rgba(255,255,255,.025) inset;
  }
  .bar {
    height: 42px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 17px;
    background: #1d222c;
    border-bottom: 1px solid #2e3542;
  }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .red { background: #ff5f57; }
  .yellow { background: #febc2e; }
  .green { background: #28c840; }
  .caption {
    margin-left: 9px;
    color: #7c8597;
    font: 12px/1 "Segoe UI", sans-serif;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  pre {
    margin: 0;
    padding: 22px 26px 25px;
    color: #d8dee9;
    background: #11151d;
    font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
    font-size: 13px;
    line-height: 1.16;
    font-variant-ligatures: none;
    white-space: pre;
  }
</style>
</head>
<body>
  <div class="terminal">
    <div class="bar">
      <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
      <span class="caption">Runa · ${escapeHtml(title)}</span>
    </div>
    <pre>${ansiToHtml(frame)}</pre>
  </div>
</body>
</html>`
}

function key(name) {
  return { type: 'key', is: (...keys) => keys.includes(name) }
}

function type(sequence) {
  return { type: 'key', sequence, ctrl: false, meta: false, is: () => false }
}

function namedGame(name = 'Ayla', realm = 'runa') {
  const game = new Runa({ presence: false })
  game.width = WIDTH
  game.height = HEIGHT
  game.onKey(key('enter'))
  for (const ch of name) game.onKey(type(ch))
  if (realm === 'nox') game.onKey(key('right'))
  game.onKey(key('enter'))
  return game
}

function equippedGame(name = 'Ayla') {
  const game = namedGame(name)
  for (const id of ['spear', 'shield', 'chainmail', 'iron_helmet', 'boots', 'longbow']) {
    game.player.items.add(id)
  }
  for (const id of ['spear', 'shield', 'chainmail', 'iron_helmet', 'boots']) {
    game.player.equip(id)
  }
  return game
}

function frames() {
  const menu = new Runa({ presence: false })
  menu.width = WIDTH
  menu.height = HEIGHT

  const name = new Runa({ presence: false })
  name.width = WIDTH
  name.height = HEIGHT
  name.onKey(key('enter'))
  for (const ch of 'Ayla') name.onKey(type(ch))

  const city = equippedGame()
  city.walker.placeAt('city', 160, 102)

  const field = equippedGame()
  field.field = new Field({ seed: 17, player: field.player })
  field.field.player.x = 111
  field.field.player.y = 10

  const clearedField = equippedGame()
  clearedField.field = new Field({
    seed: 17,
    player: clearedField.player,
    clearedSettlements: ['colmillo-rojo']
  })
  clearedField.field.player.x = 111
  clearedField.field.player.y = 10

  const barbarians = equippedGame()
  barbarians.field = new BarbarianCamp({
    campId: 'hachas-negras',
    seed: 17,
    player: barbarians.player
  })
  barbarians.field.player.x = 54
  barbarians.field.player.y = 20

  const combat = equippedGame()
  combat.field = new Field({ seed: 17, player: combat.player })
  const foe = combat.field.foes.find((candidate) => !candidate.dead)
  combat.field.player.x = foe.x > 1 ? foe.x - 2 : foe.x + 2
  combat.field.player.y = foe.y
  combat.onKey(key(foe.x > combat.field.player.x ? 'right' : 'left'))
  combat.onKey(key('f'))

  const equipment = equippedGame()
  equipment.shop = 'armor'
  equipment.cursor = 0

  const nox = namedGame('Nyra', 'nox')
  nox.animationTick = 12
  nox.walker.placeAt('nox', 160, 103)

  const noxPalace = namedGame('Nyra', 'nox')
  noxPalace.animationTick = 12
  noxPalace.walker.placeAt('nox', 160, 10)

  const noxWorkshops = namedGame('Nyra', 'nox')
  noxWorkshops.animationTick = 12
  noxWorkshops.walker.placeAt('nox', 42, 148)

  const dungeon = equippedGame('Ayla')
  dungeon.field = new Dungeon({
    floor: 2,
    seed: 31,
    player: dungeon.player,
    script: dungeon.scriptSource,
    x: 57,
    y: 20
  })

  const worldBoss = equippedGame('Ayla')
  worldBoss.field = new BossZone({
    seed: 27,
    player: worldBoss.player,
    script: worldBoss.scriptSource,
    x: 101,
    y: 22
  })
  worldBoss.animationTick = 9

  const inventory = equippedGame('Ayla')
  inventory.openInventory()

  return {
    menu: { title: 'menu principal', frame: menu.view() },
    nombre: { title: 'nueva partida', frame: name.view() },
    ciudad: { title: 'ciudad', frame: city.view() },
    campo: { title: 'pradera', frame: field.view() },
    'campo-limpio': { title: 'pradera conquistada', frame: clearedField.view() },
    barbaros: { title: 'asentamiento barbaro', frame: barbarians.view() },
    combate: { title: 'combate en el mapa', frame: combat.view() },
    equipo: { title: 'armaduras y equipo', frame: equipment.view() },
    nox: { title: 'reino elfico oscuro de nox', frame: nox.view() },
    'nox-palacio': { title: 'palacio del eclipse', frame: noxPalace.view() },
    'nox-oficios': { title: 'barrio de oficios de nox', frame: noxWorkshops.view() },
    dungeon: { title: 'cripta - nivel 2', frame: dungeon.view() },
    'world-boss': { title: 'ruinas volcanicas del coloso', frame: worldBoss.view() },
    inventario: { title: 'inventario y equipo', frame: inventory.view() }
  }
}

const output = path.resolve(Bare.argv[2] || '.readme-screens')
fs.mkdirSync(output, { recursive: true })
for (const [name, screen] of Object.entries(frames())) {
  const target = path.join(output, name + '.html')
  fs.writeFileSync(target, page(screen.title, screen.frame))
  console.log(target)
}
