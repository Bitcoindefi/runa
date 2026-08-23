const { test } = require('brittle')
const { style } = require('bare-tui')
const { Runa } = require('../lib/game.js')
const { MAPS, TILES } = require('../lib/map.js')
const { reward } = require('../lib/shop.js')
const CONTENT = require('../lib/content.js')
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

test('what a foe is worth comes from its own table, not from a formula', (t) => {
  // `reward()` looked for `drops` and content.js has always written `drop`, so
  // the override never fired and every foe fell through to numbers derived
  // from its stats. Derived, a mosquito and a spectre were both worth 12 gold
  // and 18 xp, which erases the whole relationship between how hard a thing is
  // and what killing it pays.
  const mosquito = reward('mosquito')
  const golem = reward('golem')

  t.ok(mosquito.xp < golem.xp, 'the easy thing is worth less experience')
  t.ok(mosquito.gold < golem.gold, 'and less gold')

  const table = CONTENT.foes.mosquito.drop
  t.is(mosquito.xp, table.xp, 'experience is the number the table declares')
  t.ok(
    mosquito.gold >= table.gold[0] && mosquito.gold <= table.gold[1],
    'gold sits inside the declared range'
  )
})

test('the gold the log announces is the gold the purse receives', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 88, height: 26 })
  game.onKey({ type: 'key', is: (...keys) => keys.includes('x') })

  t.ok(pickAFight(game), 'a fight starts out in the field')

  // Run the fight out and watch the tick it resolves on.
  let before = { gold: game.player.gold, xp: game.player.xp }
  let line = null
  let credited = null
  for (let i = 0; i < 4000 && game.field; i++) {
    const fighting = !!game.field.combat
    before = { gold: game.player.gold, xp: game.player.xp }
    game.log.length = 0
    game.update({ type: 'tick' })
    if (fighting && game.field && !game.field.combat) {
      line = game.log.find((l) => String(l).indexOf('cae el') !== -1) || null
      credited = { gold: game.player.gold - before.gold, xp: game.player.xp - before.xp }
      break
    }
  }

  t.ok(line, 'the kill is announced')
  t.ok(credited && credited.gold > 0, 'and it paid something')

  // The field rolled these numbers on its own throwaway sheet and said them
  // out loud, while settle() credited a different figure entirely: the log read
  // `+5 oro` and the purse went up by 12, on every single kill. Now one roll
  // travels in the event and is announced by whoever banks it, so the two
  // cannot drift apart again.
  const said = /\+(\d+) oro, \+(\d+) exp/.exec(String(line))
  t.ok(said, 'the line carries both numbers')
  t.is(Number(said[1]), credited.gold, 'the gold announced is the gold received')
  t.is(Number(said[2]), credited.xp, 'and the same for experience')
})

test('dying puts you at the church it says it puts you at', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 88, height: 26 })
  game.onKey({ type: 'key', is: (...keys) => keys.includes('x') })

  t.ok(pickAFight(game), 'a fight starts out in the field')

  // Lose on purpose rather than waiting for a rule to lose for us.
  game.field.combat.world.potions = 0
  game.field.combat.world.hero.hp = 0
  game.log.length = 0
  for (let i = 0; i < 40 && game.field; i++) game.update({ type: 'tick' })

  t.absent(game.field, 'the excursion is over')

  // Both layers used to narrate this, so the log printed two near identical
  // lines one under the other.
  const church = game.log.filter((l) => String(l).indexOf('iglesia') !== -1)
  t.is(church.length, 1, 'waking up in the church is said once, not twice')

  // And it used to leave you on the cobble next to the gate out to the field,
  // eleven rows from the church, on the doorstep of the thing that killed you.
  let door = null
  const rows = MAPS.city.rows
  for (let y = 0; y < rows.length && door === null; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const tile = TILES[rows[y][x]]
      if (tile && tile.enter && tile.enter.kind === 'church') {
        door = { x, y }
        break
      }
    }
  }
  t.ok(door !== null, 'the town has a church')
  t.is(game.walker.x, door.x, 'you wake up at its door, not near the gate')
  t.is(game.walker.y, door.y)
})

test('the title screen says what the swarm is actually doing', (t) => {
  const fake = (peers, conns) => ({
    others: () => new Array(peers).fill({ name: 'x' }),
    conns: new Set(new Array(conns).fill(0).map((_, i) => i))
  })

  const wired = (peers, conns, started) => {
    const game = new Runa({ presence: false })
    game.update({ type: 'resize', width: 88, height: 26 })
    game.online = true
    game.presence = fake(peers, conns)
    game.presenceStarted = started
    return game
  }

  const solo = new Runa({ presence: false })
  solo.update({ type: 'resize', width: 88, height: 26 })
  t.is(solo.presenceLine(), 'modo un jugador', 'playing alone says so')

  t.is(wired(0, 0, false).presenceLine(), 'la red no arranco, jugas solo')

  // Searching and offline are different claims about the world, and the whole
  // point of putting this on screen is to stop the game being silent about
  // which one is true.
  t.is(wired(0, 0, true).presenceLine(), 'buscando jugadores...')
  t.is(wired(0, 1, true).presenceLine(), 'conectando...')
  t.is(wired(1, 1, true).presenceLine(), '1 jugador mas en linea')
  t.is(wired(3, 1, true).presenceLine(), '3 jugadores mas en linea')

  const screen = style.stripAnsi(wired(3, 1, true).view())
  t.ok(screen.indexOf('3 jugadores mas en linea') !== -1, 'and it reaches the screen')
})

test('the swarm line never pushes the title off its own screen', (t) => {
  const game = new Runa({ presence: false })
  game.online = true
  game.presence = { others: () => [{ name: 'ana' }], conns: new Set([0]) }
  game.presenceStarted = true

  // 64 by 16 is the smallest terminal the game agrees to draw in at all, so it
  // is the size where an extra line is most likely to cost something. The logo
  // and the prompt are what this screen exists for: the status is the first
  // thing that gets dropped, not the last.
  for (const [w, h] of [
    [64, 16],
    [80, 20],
    [88, 26],
    [200, 50]
  ]) {
    game.update({ type: 'resize', width: w, height: h })
    const screen = style.stripAnsi(game.view())
    const lines = screen.split('\n')

    t.is(lines.length, h, 'exactly ' + h + ' rows at ' + w + 'x' + h)
    t.ok(
      lines.every((line) => line.length === w),
      'every row is exactly ' + w + ' wide'
    )
    t.ok(screen.indexOf('RUNA') !== -1, 'the logo survives at ' + w + 'x' + h)
    t.ok(screen.indexOf('cualquier tecla') !== -1, 'and so does the prompt')
  }
})
