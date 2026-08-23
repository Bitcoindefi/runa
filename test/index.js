const { test } = require('brittle')
const { style } = require('bare-tui')
const { Runa } = require('../lib/game.js')
const { MAPS, TILES } = require('../lib/map.js')
const render = require('../lib/render.js')

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
