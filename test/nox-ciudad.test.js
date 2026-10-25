const { test } = require('brittle')
const { Runa } = require('../lib/game.js')
const { MAPS, TILES } = require('../lib/map.js')
const { Field } = require('../lib/field.js')
const { NOX_BUILDINGS } = require('../lib/nox.js')
const { withLanguage, mapLabels, t: tr } = require('../lib/locale.js')

function press(game, name) {
  return game.onKey({ type: 'key', is: (...keys) => keys.includes(name) })
}

// Crea un heroe en el reino elegido con la misma pantalla que un jugador.
function newHero(realm) {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 88, height: 30 })
  press(game, 'enter')
  for (const sequence of 'Nyra') {
    game.onKey({ type: 'key', sequence, ctrl: false, meta: false, is: () => false })
  }
  if (realm === 'nox') press(game, 'right')
  press(game, 'enter')
  return game
}

const last = (game) => game.log[game.log.length - 1]
const solid = (map, x, y) => {
  const tile = TILES[map.rows[y][x]]
  return !tile || tile.solid
}

// Las celdas que se pisan desde el punto de nacimiento de NOX.
function reachable() {
  const nox = MAPS.nox
  const seen = new Set([nox.spawn.y * nox.width + nox.spawn.x])
  const queue = [[nox.spawn.x, nox.spawn.y]]
  while (queue.length) {
    const [x, y] = queue.shift()
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= nox.width || ny >= nox.height) continue
      if (solid(nox, nx, ny) || seen.has(ny * nox.width + nx)) continue
      seen.add(ny * nox.width + nx)
      queue.push([nx, ny])
    }
  }
  return seen
}

test('NOX: la tecla t devuelve a cada heroe a su propia capital', (t) => {
  const nox = newHero('nox')
  t.is(nox.realm, 'nox')
  nox.field = new Field({ player: nox.player, arrival: 'nox' })
  t.ok(nox.returnToCity())
  t.is(nox.walker.mapId, 'nox', 'un ciudadano de NOX no cae en RUNA')
  t.is(nox.walker.x, MAPS.nox.arrivals.meadow.x)
  t.is(nox.walker.y, MAPS.nox.arrivals.meadow.y)
  t.is(nox.field, null)

  const runa = newHero('runa')
  runa.field = new Field({ player: runa.player })
  t.ok(runa.returnToCity())
  t.is(runa.walker.mapId, 'city', 'un ciudadano de RUNA sigue volviendo a la ciudad')
  t.is(last(runa), 'volves a la ciudad')
})

test('NOX: la llegada desde la pradera y el nacimiento quedan en la avenida abierta', (t) => {
  const { meadow } = MAPS.nox.arrivals
  t.ok(meadow.y < 184, 'se aparece al norte de la caseta de la puerta sur')
  t.absent(solid(MAPS.nox, meadow.x, meadow.y))
  t.absent(solid(MAPS.nox, MAPS.nox.spawn.x, MAPS.nox.spawn.y))
  t.ok(MAPS.nox.spawn.y < 128, 'se nace al norte del cartel del mercado')
  const open = reachable()
  t.ok(open.has(meadow.y * MAPS.nox.width + meadow.x), 'la llegada se une con el nacimiento')
})

test('NOX: el muro del palacio queda cerrado y no promete una entrada', (t) => {
  const palace = NOX_BUILDINGS.find((b) => b.id === 'palace')
  const wallY = palace.y + palace.h - 1
  t.is(MAPS.nox.rows[wallY].slice(159, 162), '###')
  t.absent(solid(MAPS.nox, 160, wallY + 1), 'la avenida llega hasta la fachada')
})

test('NOX: la sacerdotisa, el posadero y la alquimista hablan con su nombre', (t) => {
  const game = newHero('nox')
  const npc = (id) => MAPS.nox.npcs.find((n) => n.id === id)

  game.player.hp = 1
  game.interactNpc(npc('nox-priestess'))
  t.is(game.player.hp, game.player.maxHp)
  t.is(last(game), 'Ilyra cura todas tus heridas')

  const nym = npc('nox-merchant')
  t.alike(nym.action, { kind: 'tavern' }, 'Nym atiende la posada del velo')
  t.is(nym.x, 224)
  t.is(nym.y, 117)
  game.interactNpc(nym)
  t.is(last(game), 'Nym: ya estas descansado')

  const alchemist = MAPS.nox.npcs.find((n) => n.action && n.action.shop === 'potions')
  t.ok(alchemist, 'NOX tiene alquimista frente a la botica')
  t.is(alchemist.x, 285)
  t.ok(reachable().has(alchemist.y * MAPS.nox.width + alchemist.x))

  const runa = newHero('runa')
  runa.player.hp = 1
  runa.interactNpc(MAPS.city.npcs.find((n) => n.id === 'alma'))
  t.is(last(runa), 'hermana Alma cura todas tus heridas', 'RUNA no cambia')
  runa.interactNpc(MAPS.city.npcs.find((n) => n.id === 'bruno'))
  t.is(last(runa), 'Bruno: ya estas descansado')
})

test('NOX: las puertas dicen el nombre de sus edificios', (t) => {
  const game = newHero('nox')
  const door = (id) => NOX_BUILDINGS.find((b) => b.id === id)
  const step = (id) => {
    const b = door(id)
    game.walker.placeAt('nox', b.doorX, b.y + b.h - 1)
    game.enter()
    return last(game)
  }
  t.is(step('weapons'), 'entras a forja umbria')
  game.shop = null
  t.is(step('armor'), 'entras a armeria de obsidiana')
  game.shop = null
  game.player.hp = 1
  t.is(step('church'), 'descansas en el santuario de la luna, vida al maximo')
  t.is(game.player.hp, game.player.maxHp)
})

test('NOX: el obelisco del eclipse abre el ranking como la estatua de RUNA', (t) => {
  const landmark = (MAPS.nox.landmarks || []).find((l) => l.action && l.action.kind === 'ranking')
  t.ok(landmark, 'NOX tiene un monumento con ranking')
  t.not(landmark.id, 'hero-statue', 'no dibuja una segunda estatua de RUNA en 3D')
  const open = reachable()
  const b = landmark.bounds
  let near = null
  for (let y = b.y1 - 2; y <= b.y2 + 2 && !near; y++) {
    for (let x = b.x1 - 2; x <= b.x2 + 2 && !near; x++) {
      if (open.has(y * MAPS.nox.width + x)) near = { x, y }
    }
  }
  t.ok(near, 'se llega a pararse junto al obelisco')
  const game = newHero('nox')
  game.walker.placeAt('nox', near.x, near.y)
  t.is(game.nearbyLandmark(2), landmark)
})

test('NOX: los arboles son arboles y no pisan los caminos', (t) => {
  const rows = MAPS.nox.rows
  t.ok(rows.join('').includes('t'), 'los jardines usan la celda de arbol')
  for (let y = 25; y <= 27; y++) {
    t.absent(/[t|()]/.test(rows[y].slice(5, 70)), `el camino del jardin queda libre (y ${y})`)
  }
  const awning = (x) => (rows[130].slice(x).match(/^[/\\]+/) || [''])[0].length
  t.is(awning(98), '| hongos y sal |'.length, 'el toldo cubre el cartel oeste')
  t.is(awning(194), '| seda y cristal |'.length, 'el toldo cubre el cartel este')
  t.is(rows[197][176], '|', 'el cartel de la pradera no pisa el muro de la torre')
})

test('NOX: los heroes de NOX leen las fronteras desde su reino', (t) => {
  const game = newHero('nox')
  game.walker.placeAt('nox', 1, 120)
  game.enter()
  t.is(game.walker.mapId, 'city')
  t.is(last(game), 'cruzas la frontera hacia RUNA, el reino rival')
  let gate = null
  MAPS.city.rows.forEach((row, y) => {
    for (let x = 0; x < row.length && !gate; x++) {
      const tile = TILES[row[x]]
      if (tile && tile.enter && tile.enter.to === 'nox') gate = { x, y }
    }
  })
  t.ok(gate, 'RUNA tiene su porton a NOX')
  game.walker.placeAt('city', gate.x, gate.y)
  game.enter()
  t.is(game.walker.mapId, 'nox')
  t.is(last(game), 'volves a NOX, tu reino')
})

test('NOX: los carteles y mensajes nuevos tienen ingles completo', (t) => {
  withLanguage('en', () => {
    const text = MAPS.nox.rows.map((row) => mapLabels(row)).join('\n')
    t.absent(
      / of (la|esporas|amatista|obsidiana|sombras|nox)\b/.test(text.replace('crown of nox', ''))
    )
    t.absent(/\bla meadow\b|jardin |paseo |santuario /.test(text))
    for (const source of [
      'la frontera al reino de runa',
      'la frontera al reino enemigo',
      'salis por la puerta sur de NOX a la pradera: RUNA queda al oeste',
      'cuervos de ceniza',
      'asentamiento cuervos de ceniza',
      'obelisco del eclipse',
      'Ilyra cura todas tus heridas',
      'volves a NOX, tu reino',
      'cruzas la frontera hacia RUNA, el reino rival'
    ]) {
      t.absent(/\b(la|de|por|hacia|reino|ceniza|cura)\b/.test(tr(source)), source)
    }
    for (const building of NOX_BUILDINGS) {
      t.not(tr(building.name), building.name, building.name)
    }
  })
})
