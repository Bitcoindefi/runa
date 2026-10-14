const { test } = require('brittle')
const { Dungeon, DUNGEON } = require('../lib/dungeon.js')
const { BarbarianCamp } = require('../lib/barbarian-camp.js')
const { BARBARIAN_SETTLEMENTS } = require('../lib/field.js')
const lugares = require('../scripts/tripo-lugares.mjs')

const FLOORS = [1, 2, 3]
const CAMPS = BARBARIAN_SETTLEMENTS.map((camp) => camp.id)

// Cuantas veces cubre cada celda una lista de rectangulos.
function coverage(width, height, rects) {
  const count = new Uint8Array(width * height)
  for (const r of rects) {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) count[y * width + x]++
    }
  }
  return count
}

// Las celdas a las que se llega a pie desde `from`, en 8 direcciones como walk.
function reachable(field, from) {
  const seen = new Set([from.x + ',' + from.y])
  const queue = [from]
  while (queue.length) {
    const { x, y } = queue.shift()
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = x + dx + ',' + (y + dy)
        if (seen.has(key) || !field.isWalkable(x + dx, y + dy)) continue
        seen.add(key)
        queue.push({ x: x + dx, y: y + dy })
      }
    }
  }
  return seen
}

test('lugares: the glyph tables match the game walkable rules', (t) => {
  for (const floor of FLOORS) {
    const field = new Dungeon({ floor })
    let same = true
    field.layout.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (lugares.cryptWalkable(row[x]) !== field.isWalkable(x, y)) same = false
      }
    })
    t.ok(same, 'crypt floor ' + floor + ' walks like lib/dungeon.js')
  }
  for (const campId of CAMPS) {
    const field = new BarbarianCamp({ campId })
    let same = true
    field.layout.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (lugares.campWalkable(row[x]) !== field.isWalkable(x, y)) same = false
      }
    })
    t.ok(same, campId + ' walks like lib/barbarian-camp.js')
  }
})

test('lugares: mergeRects covers every chosen cell exactly once', (t) => {
  const pick = (x, y) => (x * 7 + y * 3) % 5 !== 0 && !(x > 4 && x < 9 && y === 3)
  const rects = lugares.mergeRects(12, 8, pick)
  const count = coverage(12, 8, rects)
  let ok = true
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 12; x++) if (count[y * 12 + x] !== (pick(x, y) ? 1 : 0)) ok = false
  }
  t.ok(ok, 'no gaps, no overlaps, nothing outside')
  t.alike(
    lugares.mergeRects(3, 2, () => true),
    [{ x0: 0, y0: 0, x1: 2, y1: 1 }],
    'a full grid is one rect'
  )
  t.is(lugares.mergeRects(3, 2, () => false).length, 0, 'an empty grid has none')
})

test('lugares: crypt floors as 3D map data', (t) => {
  const ids = new Set()
  for (const floor of FLOORS) {
    const field = new Dungeon({ floor })
    const data = lugares.cryptData(field, { key: 'es' })
    const plan = data.cripta
    const { width, height, rows } = data
    ids.add(data.id)
    t.is(data.id, 'crypt-' + floor, 'floor ' + floor + ' id')
    t.is(data.kind, 'crypt')
    t.is(lugares.placeId(field), data.id, 'placeId names the same map')
    t.is(lugares.cryptData(field, { key: 'es' }), data, 'the data is kept per floor and language')
    t.is(width, DUNGEON.width)
    t.is(height, DUNGEON.height)

    const rock = coverage(width, height, plan.rock)
    let rockOnce = true
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (rock[y * width + x] !== (rows[y][x] === '#' ? 1 : 0)) rockOnce = false
      }
    }
    t.ok(rockOnce, 'floor ' + floor + ': the rock rects cover every # exactly once')

    const blocks = coverage(width, height, plan.blocks)
    let clear = true
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (blocks[y * width + x] && field.isWalkable(x, y)) clear = false
      }
    }
    t.ok(clear, 'floor ' + floor + ': no camera block covers a walkable cell')

    let facesOk = plan.faces.length > 0
    const step = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }
    for (const face of plan.faces) {
      const [dx, dy] = step[face.side]
      for (let y = face.y0; y <= face.y1; y++) {
        for (let x = face.x0; x <= face.x1; x++) {
          const beside = (rows[y + dy] || '')[x + dx]
          if (rows[y][x] !== '#' || beside === undefined || beside === '#') facesOk = false
        }
      }
    }
    t.ok(facesOk, 'floor ' + floor + ': every wall face is rock looking at open space')

    t.is(rows[plan.up.y][plan.up.x], '^', 'up stairs on the ^')
    t.ok(
      plan.stairs.up.steps.some((c) => c.x === plan.up.x && c.y === plan.up.y),
      'the ^ is a step'
    )
    if (floor < 3) {
      t.is(rows[plan.down.y][plan.down.x], 'v', 'down stairs on the v')
      t.ok(plan.stairs.down.steps.some((c) => c.x === plan.down.x && c.y === plan.down.y))
      t.is(plan.throne, null, 'no throne above the necropolis')
    } else {
      t.is(plan.down, null, 'the necropolis has no way down')
      t.is(rows[plan.throne.y][plan.throne.x], 'T', 'the throne sits on the T')
    }

    const seen = reachable(field, plan.up)
    const goal = plan.down || plan.throne
    t.ok(
      seen.has(goal.x + ',' + goal.y),
      'floor ' + floor + ': walkable path from the ^ to the goal'
    )
    t.ok(
      plan.lamps.every((p) => rows[p.y][p.x] === '*') &&
        plan.pillars.every((p) => rows[p.y][p.x] === '+') &&
        plan.tombs.every((p) => rows[p.y].slice(p.x0, p.x1 + 1) === '[=]'),
      'lamps, pillars and tombs sit on their glyphs'
    )
  }
  t.is(ids.size, 3, 'every floor has its own map id')
  t.ok(
    lugares.cryptData(new Dungeon({ floor: 1 })).cripta.water.length > 0,
    'the cisterns hold water'
  )
  t.ok(
    lugares.cryptData(new Dungeon({ floor: 2 })).cripta.bones.length > 0,
    'the ossuary has bones'
  )
})

test('lugares: crypt heights, line of sight and fixed lights', (t) => {
  const { CRYPT } = lugares
  for (const floor of FLOORS) {
    const field = new Dungeon({ floor })
    const data = lugares.cryptData(field, { key: 'es' })
    const plan = data.cripta
    const { width, height, rows } = data
    const heights = lugares.cryptHeights(data)
    const h = (x, y) => heights[y * width + x]

    // Donde camina el heroe: la pagina lo deja en 0, asi que todo lo que se
    // pisa fuera de las escaleras tiene que estar en 0.
    const stairs = [plan.stairs.up, plan.stairs.down].filter(Boolean)
    const inStairs = (x, y) => stairs.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)
    let flat = true
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (field.isWalkable(x, y) && !inStairs(x, y) && h(x, y) !== 0) flat = false
      }
    }
    t.ok(flat, 'floor ' + floor + ': every walkable cell off the stairs is at 0')
    t.is(h(plan.up.x, plan.up.y), 0, 'the ^ is the foot of the stairs, at 0')
    t.ok(h(plan.up.x + 4, plan.stairs.up.y0) > 0, 'the stairs climb toward the lintel')
    if (plan.down) {
      t.is(h(plan.down.x, plan.down.y), 0, 'the v is the brink of the well, at 0')
      t.ok(h(plan.down.x - 4, plan.stairs.down.y1) < 0, 'the stairs go down from the v')
    }
    let rockTall = true
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (rows[y][x] === '#' && h(x, y) !== Math.fround(CRYPT.wall)) rockTall = false
        if (rows[y][x] === '~' && h(x, y) !== Math.fround(CRYPT.basin)) rockTall = false
      }
    }
    t.ok(rockTall, 'rock is a wall high and water sits in its basin')

    const lights = lugares.cryptLights(data)
    const torches = lights.filter((l) => l.kind === 'torch')
    t.ok(torches.length >= 10, 'floor ' + floor + ': ' + torches.length + ' wall torches')
    t.is(lights.filter((l) => l.kind === 'brazier').length, plan.lamps.length, 'a brazier per *')
    t.is(lights.filter((l) => l.kind === 'arch').length, 1, 'one light down the up stairs')
    t.is(lights.filter((l) => l.kind === 'throne').length, plan.throne ? 2 : 0, 'throne braziers')
    let wallOk = true
    for (const l of torches) {
      const rock = { x: l.cell.x - l.nx, y: l.cell.y - l.nz }
      if (rows[rock.y][rock.x] !== '#' || !field.isWalkable(l.cell.x, l.cell.y)) wallOk = false
    }
    t.ok(wallOk, 'every torch hangs on rock over a walkable cell')
    let apart = true
    for (let i = 0; i < lights.length; i++) {
      for (let j = i + 1; j < lights.length; j++) {
        const a = lights[i]
        const b = lights[j]
        if (b.kind === 'torch' && Math.hypot(a.x - b.x, a.z - b.z) < 6.5) apart = false
      }
    }
    t.ok(apart, 'torches keep their distance')
    t.alike(lugares.cryptLights(data), lights, 'the same floor gives the same torches')
  }

  const data = lugares.cryptData(new Dungeon({ floor: 1 }), { key: 'es' })
  t.ok(lugares.cryptSees(data, { x: 10, y: 33 }, { x: 25, y: 33 }), 'an open hall sees itself')
  t.absent(lugares.cryptSees(data, { x: 10, y: 33 }, { x: 10, y: 10 }), 'rock hides the light')
})

test('lugares: barbarian camps as 3D map data', (t) => {
  const ids = new Set()
  for (const campId of CAMPS) {
    const field = new BarbarianCamp({ campId })
    const data = lugares.campData(field, { key: 'es' })
    const plan = data.campamento
    const { width, height } = data
    ids.add(data.id)
    t.is(data.id, 'camp:' + campId)
    t.is(data.kind, 'camp')
    t.is(lugares.placeId(field), data.id)
    t.alike(plan.exit, { x: 54, y: 44 }, campId + ': exit gate at (54,44)')
    t.is(data.rows[44][54], 'U', 'the exit stays a U in the map rows')
    t.is(plan.tents.length, 5, campId + ': five tents')
    t.alike(
      plan.tents.map((tent) => tent.label),
      ['casa del caudillo', 'guerreros', 'jabalinas', 'pieles y grano', 'botin robado'],
      'tent labels in order'
    )
    t.is(plan.palisades.length, 4, 'four palisade boxes')
    t.ok(plan.fire && plan.fire.embers.length > 0, 'the fire pit has embers')

    const reached = reachable(field, field.layout.spawn)
    const title = plan.title
    t.is(
      title && field.layout.rows[title.y].slice(title.x0, title.x1 + 1),
      'asentamiento ' + field.camp.name,
      campId + ': the title board spans the written name'
    )
    let titleSolid = true
    for (let x = title.x0; x <= title.x1; x++) {
      const letter = field.layout.rows[title.y][x] !== ' '
      if (letter && reached.has(x + ',' + title.y)) titleSolid = false
    }
    t.ok(titleSolid, campId + ': the letters of the title cannot be walked on')
    const blocks = coverage(width, height, plan.blocks)
    let clear = true
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!blocks[y * width + x]) continue
        const ch = field.layout.rows[y][x]
        if (reached.has(x + ',' + y) || ch === 'U' || ch === '.') clear = false
      }
    }
    t.ok(clear, campId + ': no block covers a reachable cell, the U or a road')
    let rowsAgree = true
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((data.rows[y][x] === '&') === reached.has(x + ',' + y)) rowsAgree = false
      }
    }
    t.ok(rowsAgree, campId + ': & marks exactly what cannot be reached')
  }
  t.is(ids.size, CAMPS.length, 'every camp has its own map id')
})

test('lugares: map ids, moods and the indoor fog', (t) => {
  t.alike(lugares.placeOfId('crypt-2'), { mode: 'dungeon', floor: 2 })
  t.alike(lugares.placeOfId('camp:hachas-negras'), {
    mode: 'barbarian-camp',
    campId: 'hachas-negras'
  })
  t.alike(lugares.placeOfId('field'), { mode: 'field' })
  t.is(lugares.placeOfId('city'), null)
  t.is(lugares.placeId(null), null)

  const moods = { city: 1, boss: 2, 'crypt-1': 3, crypt: 4, camp: 5 }
  t.is(lugares.moodKey({ id: 'crypt-1', kind: 'crypt' }, moods), 'crypt-1', 'own id first')
  t.is(lugares.moodKey({ id: 'crypt-9', kind: 'crypt' }, moods), 'crypt', 'then the kind')
  t.is(lugares.moodKey({ id: 'camp:x', kind: 'camp' }, moods), 'camp')
  t.is(lugares.moodKey({ id: 'ruins', kind: 'boss' }, moods), 'boss')
  t.is(
    lugares.moodKey({ id: 'field', kind: 'map' }, moods),
    'city',
    'the meadow keeps the city mood'
  )
  t.is(lugares.moodKey(null, moods), null, 'no map, showcase')

  t.alike(lugares.heroFog([0, 4, 24], 7), [11, 31], 'fog starts at the hero')
  t.alike(lugares.heroFog([0, 4, 24], NaN), [4, 24])
})
