const { test } = require('brittle')
const vecinos = require('../scripts/tripo-vecinos.mjs')
const { MAPS, NPC_SPRITES, tileAt } = require('../lib/map.js')
const { FIELD_GUIDES } = require('../lib/field.js')

const CX = 0.5
const CZ = 1

// Los NPC como los arma el visor (/world/<id>.json): el tipo sale del dibujo.
function npcsOf(mapId) {
  const kindOf = (sprite) =>
    Object.keys(NPC_SPRITES).find((kind) => NPC_SPRITES[kind] === sprite) || 'villager'
  return MAPS[mapId].npcs.map((npc) => ({
    id: npc.id,
    name: npc.name,
    kind: kindOf(npc.sprite),
    x: npc.x,
    y: npc.y,
    color: npc.color
  }))
}

function walkableOf(map) {
  return (x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height && !tileAt(map, x, y).solid
}

// La celda donde esta un NPC que se corrio (x, z) metros de su celda.
const cellAt = (home, w) => ({ x: home.x + Math.round(w.x / CX), y: home.y + Math.round(w.z / CZ) })

test('vecinos: every NPC of the city, NOX, the castle and the meadow gets its own look', (t) => {
  const all = []
  for (const mapId of ['city', 'nox', 'castle']) {
    for (const npc of npcsOf(mapId)) all.push([mapId, npc])
  }
  for (const guide of FIELD_GUIDES) {
    all.push(['field', { id: guide.id, name: guide.name, kind: 'resident', color: 'green' }])
  }
  t.ok(all.length >= 25, 'all the inhabited maps are covered')
  const looks = new Map()
  for (const [mapId, npc] of all) {
    const look = vecinos.lookOf(mapId, npc)
    looks.set(npc.id, look)
    t.ok(Number.isInteger(look.tint), `${npc.id} has a clothing colour`)
    t.ok(Number.isInteger(look.cap), `${npc.id} has a headwear colour`)
    t.ok(look.mix > 0.5 && look.mix <= 1, `${npc.id} reads as its own colour, not the hero's`)
    t.ok(look.height >= 1.7 && look.height <= 2.4, `${npc.id} has a human height`)
    t.ok(look.roam > 0 && look.roam <= vecinos.RADIUS, `${npc.id} strolls within the radius`)
    t.alike(vecinos.lookOf(mapId, npc), look, `${npc.id} looks the same every time`)
  }

  const king = looks.get('aldren')
  t.ok(king.crown && king.scepter, 'King Aldren has a crown and a scepter')
  t.ok(
    [...looks.values()].every((look) => look === king || look.height < king.height),
    'the king is the tallest'
  )
  t.is(king.tint, 0xe2b84a, 'the king dresses in gold')
  t.is(looks.get('roan').weapon, 'spear', 'the guard carries a spear')
  t.is(looks.get('roan').hold, 'up', 'and holds it upright')
  t.is(looks.get('brom').weapon, 'warhammer', 'the smith carries a hammer')
  t.ok(
    looks.get('cedric').weapon === 'sword' && looks.get('cedric').shield,
    'the knight has sword and shield'
  )
  t.ok(looks.get('alma').staff, 'the priestess has a staff')
  t.is(looks.get('eira').weapon, 'longbow', 'Eira carries the longbow')
  t.ok(looks.get('nox-mycologist').staff, 'the NOX druid has a staff')
  for (const npc of npcsOf('nox')) {
    t.is(looks.get(npc.id).slim, 0.9, `${npc.id} is a slender elf`)
  }
  t.not(
    looks.get('nox-sentinel').tint,
    looks.get('roan').tint,
    'the two kingdoms dress differently'
  )
  t.not(looks.get('nora').tint, looks.get('elian').tint, 'villagers keep their terminal colour')
})

test('vecinos: wander spots stay within the radius, on walkable cells, with a clear path', (t) => {
  let total = 0
  for (const mapId of ['city', 'nox', 'castle']) {
    const map = MAPS[mapId]
    const walkable = walkableOf(map)
    const npcs = npcsOf(mapId)
    const homes = new Set(npcs.map((npc) => npc.x + ',' + npc.y))
    for (const npc of npcs) {
      const look = vecinos.lookOf(mapId, npc)
      const rand = vecinos.seeded(look.seed)
      const spots = vecinos.wanderSpots({ x: npc.x, y: npc.y }, walkable, rand, {
        cx: CX,
        cz: CZ,
        radius: look.roam,
        count: 3,
        avoid: (x, y) => homes.has(x + ',' + y)
      })
      t.ok(spots.length <= 3, `${npc.id}: at most three spots`)
      for (const spot of spots) {
        total++
        const d = Math.hypot(spot.dx * CX, spot.dy * CZ)
        if (d > look.roam + 1e-9) t.fail(`${npc.id}: spot ${spot.dx},${spot.dy} is ${d} m away`)
        if (!walkable(npc.x + spot.dx, npc.y + spot.dy)) t.fail(`${npc.id}: spot on a wall`)
        if (homes.has(npc.x + spot.dx + ',' + (npc.y + spot.dy))) t.fail(`${npc.id}: on a home`)
        if (!vecinos.clearPath({ x: npc.x, y: npc.y }, spot.dx, spot.dy, walkable)) {
          t.fail(`${npc.id}: no straight path to ${spot.dx},${spot.dy}`)
        }
        t.is(spot.x, spot.dx * CX)
        t.is(spot.z, spot.dy * CZ)
      }
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          const gap = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)
          if (gap < 1.2) t.fail(`${npc.id}: two spots ${gap} m apart`)
        }
      }
    }
  }
  t.ok(total > 40, 'most NPCs have somewhere to stroll')

  // Encerrado entre paredes: se queda en su celda.
  const boxed = vecinos.wanderSpots({ x: 5, y: 5 }, (x, y) => x === 5 && y === 5, Math.random)
  t.alike(boxed, [], 'a walled-in NPC has no spots')
  // Una pared en el medio corta el camino recto aunque la otra punta se pise.
  const wall = (x, y) => !(x === 6 && y === 5)
  t.absent(vecinos.clearPath({ x: 5, y: 5 }, 2, 0, wall), 'a wall blocks the straight path')
  t.ok(vecinos.clearPath({ x: 5, y: 5 }, 0, 2, wall), 'another direction is free')
  // En diagonal se miran solo las celdas que la recta cruza: de (5,5) a (7,6)
  // pasa por (6,5) y no por (5,6).
  const crossed = (x, y) => !(x === 6 && y === 5)
  const beside = (x, y) => !(x === 5 && y === 6)
  t.absent(vecinos.clearPath({ x: 5, y: 5 }, 2, 1, crossed), 'a crossed corner cell blocks')
  t.ok(vecinos.clearPath({ x: 5, y: 5 }, 2, 1, beside), 'a cell beside the line does not')
})

test('vecinos: a long stroll never leaves the radius nor steps off walkable ground', (t) => {
  const map = MAPS.city
  const walkable = walkableOf(map)
  const npcs = npcsOf('city')
  const homes = new Set(npcs.map((npc) => npc.x + ',' + npc.y))
  let walked = 0
  for (const npc of npcs) {
    const look = vecinos.lookOf('city', npc)
    const rand = vecinos.seeded(look.seed)
    const spots = vecinos.wanderSpots({ x: npc.x, y: npc.y }, walkable, rand, {
      cx: CX,
      cz: CZ,
      radius: look.roam,
      count: 3,
      avoid: (x, y) => homes.has(x + ',' + y)
    })
    const w = vecinos.createWander(spots, rand, 0)
    let far = 0
    let bad = null
    let moved = 0
    for (let step = 0; step < 30 * 120; step++) {
      vecinos.stepWander(w, 1 / 30, null)
      far = Math.max(far, Math.hypot(w.x, w.z))
      if (w.gait === 'Walk') moved++
      const cell = cellAt(npc, w)
      if (!bad && !walkable(cell.x, cell.y)) bad = cell
    }
    t.ok(far <= look.roam + 1e-6, `${npc.id} stays within ${look.roam} m (${far.toFixed(2)})`)
    t.absent(bad, `${npc.id} only steps on walkable cells`)
    if (spots.length) {
      t.ok(moved > 0, `${npc.id} walks in two minutes`)
      walked++
    }
  }
  t.ok(walked >= 12, 'most of the city strolls')
})

test('vecinos: the hero brings the NPC home, it faces the hero and nods when greeted', (t) => {
  const rand = vecinos.seeded(0.25)
  const w = vecinos.createWander([{ dx: 4, dy: 0, x: 2, z: 0 }], rand, 0)
  // Que llegue a su punto de paseo.
  for (let i = 0; i < 30 * 30 && !(w.x === 2 && w.mode === 'pause'); i++) {
    vecinos.stepWander(w, 1 / 30, null)
  }
  t.is(w.x, 2, 'it reached its spot')
  // El heroe aparece a 3 m de la celda, al sur: vuelve y lo mira.
  const hero = { x: 0.5, z: 3 }
  for (let i = 0; i < 30 * 5; i++) vecinos.stepWander(w, 1 / 30, hero)
  t.is(w.x, 0, 'back on its cell')
  t.is(w.z, 0)
  t.is(w.gait, 'Idle')
  const want = vecinos.yawTo(0, 0, hero.x, hero.z)
  t.ok(Math.abs(vecinos.wrapAngle(w.yaw - want)) < 0.01, 'it faces the hero')

  // Lejos de FACE pero cerca de ATTEND: espera en su celda sin pasear.
  const near = { x: 0, z: (vecinos.FACE + vecinos.ATTEND) / 2 }
  for (let i = 0; i < 30 * 20; i++) vecinos.stepWander(w, 1 / 30, near)
  t.is(Math.hypot(w.x, w.z), 0, 'it waits on its cell while the hero is around')

  vecinos.greet(w)
  t.is(w.talk, vecinos.TALK, 'greeting starts the talk gesture')
  let nodded = 0
  for (let i = 0; i < 30 * 3; i++) {
    const g = vecinos.gesture(w.talk)
    nodded = Math.max(nodded, g.nod)
    vecinos.stepWander(w, 1 / 30, hero)
    t.is(Math.hypot(w.x, w.z), 0)
  }
  t.ok(nodded > 0.2, 'it nods')
  t.is(w.talk, 0, 'the gesture ends')
  t.alike(vecinos.gesture(0), { nod: 0, sway: 0 }, 'no gesture when not talking')

  // Se va el heroe: despues de una pausa sigue paseando.
  let strolled = false
  for (let i = 0; i < 30 * 15; i++) {
    vecinos.stepWander(w, 1 / 30, null)
    if (w.gait === 'Walk') strolled = true
  }
  t.ok(strolled, 'it strolls again once the hero leaves')
})

test('vecinos: the phone budget animates only the nearest rigs within range', (t) => {
  const { rigs, range } = vecinos.BUDGET.phone
  t.ok(rigs <= 8, 'at most eight animated rigs on a phone')
  t.ok(range <= 25, 'only within 25 m')
  const list = []
  for (let i = 0; i < 17; i++) list.push({ i, d: (i * 7) % 40 })
  const active = vecinos.pickActive(list, rigs, range)
  const expected = list
    .filter((entry) => entry.d <= range)
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, rigs)
    .map((entry) => entry.i)
  t.alike(
    [...active].sort((a, b) => a - b),
    expected.sort((a, b) => a - b),
    'the nearest ones'
  )
  t.ok(active.size <= rigs)
  t.ok(
    [...active].every((i) => list[i].d <= range),
    'nobody beyond the range'
  )
  t.is(vecinos.pickActive(list, 0, range).size, 0)

  // Al borde: el que ya se animaba no se apaga por centimetros.
  const edge = [
    { i: 0, d: 10 },
    { i: 1, d: 10.5 }
  ]
  t.alike([...vecinos.pickActive(edge, 1, range)], [0])
  t.alike([...vecinos.pickActive(edge, 1, range, new Set([1]))], [1], 'hysteresis keeps it')
  t.alike([...vecinos.pickActive([{ i: 3, d: range + 1 }], 8, range, new Set([3]))], [3])
  t.is(vecinos.pickActive([{ i: 3, d: range + 2 }], 8, range, new Set([3])).size, 0)
})

test('vecinos: the walk clip follows the ground speed without skating', (t) => {
  const pace = (vecinos.WALK_PACE * 1.8) / vecinos.WALK_HEIGHT
  t.ok(Math.abs(vecinos.walkScale(pace, 1.8) - 1) < 1e-9, 'at its pace the clip plays as is')
  t.is(vecinos.walkScale(100, 1.8), vecinos.WALK_MOST, 'never faster than the cap')
  t.is(vecinos.walkScale(0, 1.8), 0.5, 'never slower than half')
  t.ok(
    vecinos.walkScale(vecinos.STROLL, 2.3) < vecinos.walkScale(vecinos.STROLL, 1.8),
    'tall legs step slower'
  )
})
