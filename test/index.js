const { test } = require('brittle')
const { style } = require('bare-tui')
const { Runa } = require('../lib/game.js')
const render = require('../lib/render.js')

test('REMOVE ME', (t) => {
  t.pass()
})

test('title screen renders the BareRPG logo and start prompt', (t) => {
  const screen = style.stripAnsi(render.titleScreen(80, 30))
  t.ok(screen.includes('BARE RPG'))
  t.ok(screen.includes('T E R M I N A L   A D V E N T U R E'))
  t.ok(screen.includes('[ cualquier tecla para empezar ]'))
})

test('pressing a key opens the navigable city map', (t) => {
  const game = new Runa()
  game.onKey({ type: 'key', is: (...keys) => keys.includes('x') })

  const screen = style.stripAnsi(game.view())
  t.is(game.title, false)
  t.ok(screen.includes('la ciudad'))
  t.ok(screen.includes('wasd o flechas'))
})
