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
