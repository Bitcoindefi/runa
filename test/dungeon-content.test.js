const { test } = require('brittle')
const { Runa } = require('../lib/game.js')
const M = require('../lib/map.js')

function press(game, name) {
  return game.onKey({ type: 'key', is: (...keys) => keys.includes(name) })
}

function startGame(game, name = 'Tomas') {
  press(game, 'enter')
  for (const ch of String(name)) {
    game.onKey({ type: 'key', sequence: ch, ctrl: false, meta: false, is: () => false })
  }
  press(game, 'enter')
}

test('the ruins host three residents on walkable ground (#10)', (t) => {
  const npcs = M.MAPS.dungeon.npcs
  t.ok(Array.isArray(npcs) && npcs.length >= 3, 'dungeon defines its own residents')
  for (const n of npcs) {
    t.ok(!M.isSolid(M.MAPS.dungeon, n.x, n.y), `${n.name} stands on open floor at ${n.x},${n.y}`)
  }
})

test('the east wall of the ruins is one straight line now (#10)', (t) => {
  const city = M.MAPS.dungeon
  const w = city.width
  let aligned = true
  for (let y = 0; y < city.height; y++) {
    if (city.rows[y].length !== w || city.rows[y][w - 1] !== '#') aligned = false
    if (!M.isSolid(city, w - 1, y)) aligned = false
  }
  t.is(w, 61, 'normalized to a single declared width')
  t.ok(aligned, 'column 60 is wall on every row - no more jagged mouth')
})

test('talking inside the ruins reaches a resident instead of void (#10)', (t) => {
  const game = new Runa({ presence: false })
  startGame(game)

  const npc = M.MAPS.dungeon.npcs[0]
  game.walker.placeAt('dungeon', npc.x + 1, npc.y)
  press(game, 'e')

  t.ok(
    !game.log.some((line) => String(line).includes('aca no hay nada')),
    'the resident answers instead of the void'
  )
})