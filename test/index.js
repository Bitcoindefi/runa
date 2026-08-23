const { test } = require('brittle')
const { style } = require('bare-tui')
const { Runa } = require('../lib/game.js')
const { MAPS, TILES } = require('../lib/map.js')
const render = require('../lib/render.js')

require('./sage.test.js')

test('REMOVE ME', (t) => {
  t.pass()
})

test('title screen renders the Runa logo and start prompt', (t) => {
  const screen = style.stripAnsi(render.titleScreen(80, 30))
  t.ok(screen.includes('RUNA'))
  t.ok(screen.includes('UN RPG HECHO EN BARE'))
  t.ok(screen.includes('cualquier tecla para empezar'))
  const lines = screen.split('\n')
  t.is(lines.length, 30)
  t.ok(lines.every((line) => line.length === 80))
})

test('title screen falls back cleanly in a small terminal', (t) => {
  const screen = style.stripAnsi(render.titleScreen(40, 10))
  const lines = screen.split('\n')
  t.ok(screen.includes('RUNA'))
  t.is(lines.length, 10)
  t.ok(lines.every((line) => line.length === 40))
})

test('pressing a key opens the navigable city map', (t) => {
  const game = new Runa()
  game.onKey({ type: 'key', is: (...keys) => keys.includes('x') })

  const screen = style.stripAnsi(game.view())
  t.is(game.title, false)
  t.ok(screen.includes('la ciudad'))
  t.ok(screen.includes('wasd o flechas'))
})

test('city art remains rectangular and walkable', (t) => {
  const city = MAPS.city
  t.is(city.width, 60)
  t.is(city.height, 18)
  t.ok(city.rows.every((row) => row.length === city.width))
  t.ok(city.rows.some((row) => row.includes('^')))
  t.ok(city.rows.some((row) => row.includes('O')))
  t.ok(city.rows.some((row) => row.includes('*')))
  t.is(TILES[';'].solid, false)
  t.is(TILES.O.solid, true)
})

test('the field pane paints the whole field, not one stringified line', (t) => {
  const game = new Runa()
  game.update({ type: 'resize', width: 88, height: 26 })
  game.onKey({ type: 'key', is: (...keys) => keys.includes('x') })

  // Find the gate the map itself declares. Hardcoding its coordinates would let
  // somebody move the gate and quietly turn this test into a no-op.
  let gate = null
  const rows = MAPS.city.rows
  for (let y = 0; y < rows.length && gate === null; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const tile = TILES[rows[y][x]]
      if (tile && tile.enter && tile.enter.kind === 'travel') {
        gate = { x, y }
        break
      }
    }
  }
  t.ok(gate !== null, 'the city has a gate out to the field')

  game.walker.placeAt('city', gate.x, gate.y)
  game.onKey({ type: 'key', is: (...keys) => keys.includes('e') })
  t.ok(game.field !== null, 'stepping through the gate opens the field')

  const lines = style.stripAnsi(game.view()).split('\n')
  const pane = lines.map((line) => line.slice(1, 58))
  const painted = pane.filter((line) => /[.,~#@<]/.test(line))

  // The bug this guards against, in full, because it cost a demo:
  //
  // field.render() hands back one string per row and compose() wants a single
  // string. Passing the array through meant box() stringified it, all 22 rows
  // were joined by commas into one line, and the pane showed a single stripe of
  // terrain with the hero nowhere on it. Nothing threw and every other test
  // stayed green, so only an assertion about the painted frame can see it.
  t.ok(painted.length > 10, 'terrain covers the pane rather than a single row')
  t.ok(
    lines.some((line) => line.includes('@')),
    'the hero is somewhere on screen'
  )

  // And the field is drawn at full width. Dividing the pane by CELL_W as well
  // as letting the field paint one column per cell squeezed the world into the
  // left half of the box, which reads as a rendering glitch rather than a bug.
  t.ok(
    painted.some((line) => /[.,~#]/.test(line.slice(40))),
    'the field reaches the right hand side of the pane'
  )
})

/**
 * Walk out of town and keep walking until something picks a fight.
 *
 * @param {object} game
 * @returns {boolean} whether a fight is running
 */
function pickAFight(game) {
  let gate = null
  const rows = MAPS.city.rows
  for (let y = 0; y < rows.length && gate === null; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const tile = TILES[rows[y][x]]
      if (tile && tile.enter && tile.enter.kind === 'travel') {
        gate = { x, y }
        break
      }
    }
  }
  if (gate === null) return false

  game.walker.placeAt('city', gate.x, gate.y)
  game.onKey({ type: 'key', is: (...keys) => keys.includes('e') })
  if (!game.field) return false

  const dirs = ['right', 'down', 'right', 'right', 'up', 'right', 'down', 'right']
  for (let i = 0; i < 600 && !game.field.snapshot().fighting; i++) {
    const dir = dirs[i % dirs.length]
    game.onKey({ type: 'key', is: (...keys) => keys.includes(dir) })
    game.update({ type: 'tick' })
  }
  return game.field.snapshot().fighting
}

test('the experience bar shows progress into the level, not lifetime over one', (t) => {
  const game = new Runa()
  game.update({ type: 'resize', width: 88, height: 26 })
  game.onKey({ type: 'key', is: (...keys) => keys.includes('x') })

  game.player.xp = 18
  const sheet = game.sheet()

  // statsPanel reads `xpNext`, the snapshot only ever had `xpneed`, and a
  // missing field is undefined rather than an error. The bar divided by one,
  // so after a single kill it read `18/1` and stayed full from then on. That
  // is the first number a new player watches change, so it had to be the first
  // thing checked.
  t.ok(sheet.xpNext > 1, 'the bar has a real denominator')
  t.is(sheet.xp, sheet.xpinto, 'the bar draws progress into the current level')
  t.ok(sheet.xp < sheet.xpNext, 'progress fits inside the level it belongs to')

  const screen = style.stripAnsi(game.view())
  const bar = screen.split('\n').find((line) => line.indexOf('xp [') !== -1) || ''
  t.ok(bar.indexOf('/1 ') === -1 && !/\/1$/.test(bar.trim()), 'never renders over one')
  t.ok(bar.indexOf('/' + sheet.xpNext) !== -1, 'prints the real denominator')
})

test('the equipment rows follow what is actually in hand', (t) => {
  const game = new Runa()
  game.update({ type: 'resize', width: 88, height: 26 })
  game.onKey({ type: 'key', is: (...keys) => keys.includes('x') })

  game.player.gold = 500
  game.player.buy('sword', 'weapons')
  const town = style.stripAnsi(game.view())
  t.ok(town.indexOf('izq / espada') !== -1, 'what you bought shows up on the sheet')

  t.ok(pickAFight(game), 'a fight starts out in the field')

  // The script equips at fight time, so mid fight the sheet has to follow the
  // world rather than the persistent record. Both rows used to read `-` here
  // while the arena printed `alcance 14` right beside them.
  //
  // Equipping costs a few ticks: the rules are re-read every tick and a swap
  // only lands between swings, so at the instant the fight opens both hands
  // are still empty. Waiting for the hand to fill is the point of the test,
  // not an accident of timing.
  for (let i = 0; i < 60; i++) {
    const c = game.field.combat
    if (!c || c.world.held.left || c.world.held.right) break
    game.update({ type: 'tick' })
  }
  t.ok(game.field.combat, 'the fight is still running')
  const held = game.field.combat.world.held
  t.ok(held.left || held.right, 'the script put something in a hand')

  const fight = style.stripAnsi(game.view())
  const wielded = held.left || held.right
  t.ok(fight.indexOf(wielded.name) !== -1, 'the sheet names the weapon actually in hand')
  t.is(game.sheet().left, held.left, 'the left row is the world truth, not a stale copy')
  t.is(game.sheet().right, held.right, 'and so is the right row')
})
