const { test } = require('brittle')
const { style } = require('bare-tui')
const { Runa } = require('../lib/game.js')
const { MAPS, TILES } = require('../lib/map.js')
const { reward, xpToLeave } = require('../lib/shop.js')
const render = require('../lib/render.js')
const fs = require('bare-fs')

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

test('city art stays rectangular, known and walkable', (t) => {
  const city = MAPS.city

  // This used to assert that the art contained a fountain and some flowers.
  // That is a test of the decoration, not of the map, and it meant any artist
  // who improved the town broke the suite for no reason. It did exactly that.
  //
  // What actually has to hold is structural: the rows are a rectangle, every
  // glyph is one the game knows how to draw and walk on, and the doors the code
  // looks for are all there.
  t.ok(city.rows.length > 0, 'the town has rows')
  t.ok(
    city.rows.every((row) => row.length === city.width),
    'every row is the same width'
  )
  t.is(city.rows.length, city.height, 'and the height matches the art')

  const unknown = new Set()
  for (const row of city.rows) {
    for (const ch of row) if (!TILES[ch]) unknown.add(ch)
  }
  t.is(unknown.size, 0, 'no glyph the game cannot draw: ' + [...unknown].join(''))

  for (const glyph of ['C', 'I', 'P', 'A', 'D']) {
    t.ok(
      city.rows.some((row) => row.indexOf(glyph) !== -1),
      'the door ' + glyph + ' exists'
    )
  }
  t.ok(
    city.rows.some((row) => row.indexOf('>') !== -1),
    'and the way out to the field'
  )
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
  // The crossbow is gated behind level 2, so the experience comes first. Found
  // by watching the buy come back `necesitas nivel 2` and the hand stay empty.
  game.player.gainXp(200)
  game.player.buy('crossbow', 'weapons')
  const town = style.stripAnsi(game.view())
  t.ok(town.indexOf('izq') !== -1, 'the sheet has an equipment row')

  // The crossbow is bought here rather than the sword so the fight is not a
  // race. The starting rule sheet reaches for the crossbow while the foe is far
  // and only falls back to the sword up close, so a player who owns just the
  // sword holds nothing at all until something closes in. That is correct
  // behaviour and it makes a test that waits for "something in hand" depend on
  // where a monster happens to be standing.

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

test('the payout stays on the numbers the game was actually tuned against', (t) => {
  const mosquito = reward('mosquito')
  const golem = reward('golem')

  t.ok(mosquito.xp < golem.xp, 'the easy thing is worth less experience')
  t.ok(mosquito.gold < golem.gold, 'and less gold')

  // This is a balance lock, not a description of how reward() is written.
  //
  // content.js carries a `drop` table that reward() has never read, because it
  // tested `def.drops` and the table has always been `drop`. Making the names
  // match looks like an obvious one word fix and it is not: the table pays a
  // mosquito 3 xp where the formula pays 18, so levelling goes from one kill to
  // four and the crossbow from five kills to fifteen. Every price and every xp
  // threshold in this game was tuned against the formula. Whoever wants to move
  // the economy should move it deliberately and change this test on purpose.
  t.is(mosquito.xp, 18, 'a mosquito is still worth 18 experience')
  t.is(mosquito.gold, 12, 'and 12 gold')
  t.ok(reward('mosquito').xp >= xpToLeave(1), 'one kill still clears the first level')
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

test('a rule cannot equip what the player does not own, and says so', (t) => {
  const game = new Runa({ presence: false, save: false })
  game.update({ type: 'resize', width: 88, height: 26 })
  game.onKey({ type: 'key', is: (...keys) => keys.includes('x') })

  t.absent(game.player.owns('crossbow'), 'no crossbow to start with')
  t.ok(game.player.owns('sword'), 'but a sword, so the first fight is winnable')

  t.ok(pickAFight(game), 'a fight starts out in the field')
  for (let i = 0; i < 200 && game.field.combat; i++) game.update({ type: 'tick' })

  // `ownedOnly` was written for exactly this, documented with this call site in
  // its own comment, and called by nothing. `equip crossbow` handed over a
  // crossbow nobody had bought, which made every shop in the game decoration.
  const seen = game.log.join(' | ')
  t.ok(seen.indexOf('no tenes ballesta') !== -1, 'the refusal is said out loud, not swallowed')

  const held = game.field.combat ? game.field.combat.world.held : { left: null, right: null }
  const wielded = [held.left, held.right].filter(Boolean).map((i) => i.id)
  for (const id of wielded) t.ok(game.player.owns(id), 'only owned gear reaches the hand: ' + id)
})

test('the character survives being closed and reopened', (t) => {
  // Relative, not /tmp. The first version of this hardcoded a POSIX path and
  // the Windows runners failed on D:\\tmp, which does not exist. Save paths are
  // relative to the working directory everywhere, so this is the portable one.
  const save = 'save.test-abierto.json'

  const first = new Runa({ presence: false, savePath: save })
  first.update({ type: 'resize', width: 88, height: 26 })
  first.onKey({ type: 'key', is: (...keys) => keys.includes('x') })
  first.player.gold = 777
  first.player.gainXp(40)
  first.player.buy('crossbow', 'weapons')
  t.ok(first.savePlayer(), 'the character is written down')

  // The whole reason this test exists: toJSON, fromJSON and migrate were all
  // written, exported and tested, and the only writeFileSync in the entire
  // program wrote script.txt. Nothing ever called them, so closing the game
  // threw the character away and every run started at level 1 with 30 gold.
  const second = new Runa({ presence: false, savePath: save })
  second.update({ type: 'resize', width: 88, height: 26 })
  t.ok(second.loadPlayer(), 'and read back on the next run')
  t.is(second.player.gold, first.player.gold, 'the gold survives')
  t.is(second.player.xp, first.player.xp, 'the experience survives')
  t.ok(second.player.owns('crossbow'), 'and so does what you bought')

  try {
    fs.unlinkSync(save)
  } catch {}
})

test('a save that cannot be read never costs you the character silently', (t) => {
  const save = 'save.test-roto.json'
  fs.writeFileSync(save, 'esto no es json')

  const game = new Runa({ presence: false, savePath: save })
  game.update({ type: 'resize', width: 88, height: 26 })
  t.absent(game.loadPlayer(), 'a broken save does not load')
  t.ok(
    game.log.join(' | ').indexOf('no pude leer tu partida') !== -1,
    'and the player is told rather than quietly restarted'
  )
  t.ok(fs.existsSync(save + '.roto'), 'the unreadable file is kept, not overwritten')

  try {
    fs.unlinkSync(save + '.roto')
  } catch {}
  try {
    fs.unlinkSync(save)
  } catch {}
})

test('the way out of town is a gate you can find', (t) => {
  const city = MAPS.city
  const gates = []
  for (let y = 0; y < city.rows.length; y++) {
    for (let x = 0; x < city.rows[y].length; x++) {
      if (city.rows[y][x] === '>') gates.push({ x, y })
    }
  }

  // A single character in a sixty-wide wall does not read as an exit, it reads
  // as a flaw in the wall, and players could not find it. The opening is five
  // tiles now, flanked by towers, with a cobbled path leading to it.
  t.ok(gates.length >= 3, 'the opening is wide enough to read as an opening')

  const ys = gates.map((g) => g.y)
  t.ok(
    ys.every((y) => y === ys[0]),
    'and it is one gate, not several exits in different walls'
  )
  const xs = gates.map((g) => g.x).sort((a, b) => a - b)
  t.ok(
    xs.every((x, i) => i === 0 || x === xs[i - 1] + 1),
    'the opening is continuous, with no wall left standing inside it'
  )

  // Every tile of it has to actually travel, or the wide gate is a wide lie.
  for (const g of gates) {
    const tile = TILES[city.rows[g.y][g.x]]
    t.is(tile.enter.kind, 'travel', 'every tile of the gate leads out')
    t.is(tile.solid, false)
  }

  // And you have to be able to walk to it from where the game drops you.
  const walker = new Runa({ presence: false, save: false }).walker
  const seen = new Set()
  const queue = [[city.spawn.x, city.spawn.y]]
  seen.add(city.spawn.x + ',' + city.spawn.y)
  while (queue.length) {
    const [x, y] = queue.pop()
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const nx = x + dx
      const ny = y + dy
      const key = nx + ',' + ny
      if (seen.has(key)) continue
      if (ny < 0 || ny >= city.rows.length || nx < 0 || nx >= city.rows[ny].length) continue
      const tile = TILES[city.rows[ny][nx]]
      if (!tile || tile.solid !== false) continue
      seen.add(key)
      queue.push([nx, ny])
    }
  }
  t.ok(walker !== null, 'the town has a walker')
  t.ok(
    gates.every((g) => seen.has(g.x + ',' + g.y)),
    'the whole gate is reachable on foot from the spawn'
  )
})

test('the field footer does not name a key that is not a key', (t) => {
  const game = new Runa({ presence: false, save: false })
  game.update({ type: 'resize', width: 88, height: 26 })
  game.onKey({ type: 'key', is: (...keys) => keys.includes('x') })
  // Walk out through the gate without picking a fight. Mid combat the footer
  // belongs to the encounter card, which is a different line entirely, and the
  // first version of this test read that one and found nothing.
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
  game.walker.placeAt('city', gate.x, gate.y)
  game.onKey({ type: 'key', is: (...keys) => keys.includes('e') })
  t.ok(game.field, 'we are out in the field')

  const screen = style.stripAnsi(game.view())
  const footer = screen.split('\n').filter((l) => l.indexOf('q salir') !== -1)[0] || ''

  // `<` is the gate painted on the west edge of the field, not a key. The
  // footer named it as if you could press it, so people pressed it, nothing
  // happened, and they were stuck in the meadow. Same mistake as the line that
  // said `s` opened the script.
  t.ok(footer.length > 0, 'there is a footer')
  t.absent(/\|\s*<\s+volver/.test(footer), 'it no longer offers `<` as a key')
  t.ok(footer.indexOf('camina') !== -1, 'it says to walk there instead')
})
