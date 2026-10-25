const { test } = require('brittle')
const { Runa } = require('../lib/game.js')
const { MAPS } = require('../lib/map.js')
const { Field, BARBARIAN_SETTLEMENTS, vdist } = require('../lib/field.js')
const { Dungeon } = require('../lib/dungeon.js')
const { BarbarianCamp } = require('../lib/barbarian-camp.js')
const { zones } = require('../lib/content.js')
const estado = require('../scripts/tripo-estado.js')

const KING = MAPS.castle.npcs.find((npc) => npc.id === 'aldren')

function press(game, name) {
  return game.onKey({ type: 'key', is: (...keys) => keys.includes(name) })
}

function newGame() {
  const game = new Runa({ presence: false })
  press(game, 'enter')
  for (const sequence of 'Ada') {
    game.onKey({ type: 'key', sequence, ctrl: false, meta: false, is: () => false })
  }
  press(game, 'enter')
  return game
}

const story = (id, status = 'active') => ({ id, status, giver: null })

test('atlas: the gate graph reads every exit from the game', (t) => {
  const graph = estado.gateGraph()
  const at = (region, to) => graph[region].find((gate) => gate.to === to)
  const field = new Field({ seed: 1 })
  t.alike(at('field', 'city'), { to: 'city', ...field.gate }, 'the meadow gate leads to RUNA')
  t.alike(at('field', 'nox'), { to: 'nox', ...field.noxGate })
  t.alike(at('field', 'crypt-1'), { to: 'crypt-1', ...field.dungeonEntrance })
  t.alike(at('field', 'boss'), { to: 'boss', x: 182, y: 12 }, 'the portal stands at (182,12)')
  for (const camp of BARBARIAN_SETTLEMENTS) {
    t.alike(at('field', 'camp:' + camp.id), { to: 'camp:' + camp.id, x: camp.x, y: camp.y })
    t.is(at('camp:' + camp.id, 'field').to, 'field', 'a camp leads back to the meadow')
  }
  t.ok(at('crypt-1', 'field') && at('crypt-1', 'crypt-2') && at('crypt-2', 'crypt-3'))
  t.absent(at('crypt-3', 'crypt-4'), 'the last floor has no down stairs')
  t.is(at('castle', 'city').x, 56, 'the castle B gate leads to the city')
  t.ok(at('city', 'field') && at('city', 'castle') && at('nox', 'field'))
  t.ok(at('coliseum', 'city'), 'the coliseum Q gate leads to the city')
  t.absent(
    graph.field.find((gate) => gate.to === 'field'),
    'no gate loops on itself'
  )
})

test('atlas: the route from the castle goes through B and the south gate', (t) => {
  const route = estado.routeTo('castle', 'field')
  t.is(route.length, 2)
  t.alike(route[0], { region: 'castle', to: 'city', x: 56, y: 38 }, 'first the castle B gate')
  const exit = MAPS.city.rows.findIndex((row) => row.includes('>'))
  t.alike(
    route[1],
    { region: 'city', to: 'field', x: MAPS.city.rows[exit].indexOf('>'), y: exit },
    'then the city > gate'
  )
  t.alike(estado.routeTo('field', 'field'), [], 'no route when already there')
  t.is(estado.routeTo('field', 'nowhere'), null, 'no route to an unknown region')
  const deep = estado.routeTo('crypt-3', 'castle')
  t.alike(
    deep.map((hop) => hop.to),
    ['crypt-2', 'crypt-1', 'field', 'city', 'castle'],
    'the deep crypt climbs every floor'
  )
  // NOX tiene dos portones a RUNA: el primero es el mas cercano al heroe.
  t.is(estado.routeTo('nox', 'city', { x: 3, y: 120 })[0].x, 1)
  t.is(estado.routeTo('nox', 'city', { x: 34, y: 158 })[0].x, 34)
})

test('atlas: each chapter has a target', (t) => {
  const camps = estado.campsOf({ barbarianState: { cleared: [] } })
  const giver = { map: 'castle', x: KING.x, y: KING.y }
  const king = estado.storyTarget({ ...story('king_trial', 'available'), giver }, 'city', camps)
  t.alike(king, { kind: 'giver', region: 'castle', x: 56, y: 13 }, 'the king waits at (56,13)')
  const fallback = estado.storyTarget(story('barbarian_raid', 'ready'), 'field', camps)
  t.alike(fallback, { kind: 'giver', region: 'castle', x: 56, y: 13 }, 'a ready chapter is paid')
  t.alike(
    estado.storyTarget(story('king_trial'), 'city', camps),
    { kind: 'ring', region: 'field', x: 0, y: 36, radius: zones[0].until },
    'the trial ring is around the RUNA gate'
  )
  t.is(zones[0].until, 34, 'the trial ring is 34 visual cells')
  const raid = estado.storyTarget(story('barbarian_raid'), 'city', camps)
  t.alike(raid, { kind: 'camp', region: 'field', id: 'colmillo-rojo', x: 104, y: 18 })
  const east = estado.storyTarget(story('barbarian_raid'), 'field', camps, { x: 210, y: 55 })
  t.is(east.id, 'cuervos-ceniza', 'the nearest camp to the hero in the meadow')
  const inside = estado.storyTarget(story('barbarian_raid'), 'camp:hachas-negras', camps)
  t.alike(inside, {
    kind: 'camp',
    region: 'camp:hachas-negras',
    id: 'hachas-negras',
    x: null,
    y: null
  })
  t.alike(
    estado.storyTarget(story('colossus_awakening'), 'castle', camps),
    { kind: 'portal', region: 'field', x: 182, y: 12 },
    'the Colossus waits behind the portal'
  )
  t.alike(estado.storyTarget(story('colossus_awakening'), 'boss', camps, null, { x: 104, y: 22 }), {
    kind: 'boss',
    region: 'boss',
    x: 104,
    y: 22
  })
  t.is(estado.storyTarget(story('colossus_awakening', 'done'), 'city', camps), null)
  t.is(estado.storyTarget(null, 'city', camps), null)
})

test('atlas: a cleared camp drops out of the raid target', (t) => {
  const first = estado.campsOf({ barbarianState: { cleared: ['colmillo-rojo'] } })
  t.is(first.find((camp) => camp.id === 'colmillo-rojo').cleared, true)
  const next = estado.storyTarget(story('barbarian_raid'), 'city', first)
  t.is(next.id, 'hachas-negras', 'the next nearest camp from the gate')
  const gate = { x: 0, y: 36 }
  t.ok(vdist(104, 18, gate.x, gate.y) < vdist(158, 53, gate.x, gate.y))
  const all = estado.campsOf({
    barbarianState: { cleared: BARBARIAN_SETTLEMENTS.map((camp) => camp.id) }
  })
  t.is(estado.storyTarget(story('barbarian_raid'), 'field', all), null, 'nothing left to raid')
  // Adentro de un campamento sin nadie en pie ya cuenta como despejado.
  const camp = new BarbarianCamp({ campId: 'colmillo-rojo' })
  for (const foe of camp.foes) foe.dead = true
  const emptied = estado.campsOf({ barbarianState: { cleared: [] }, field: camp })
  t.is(emptied.find((c) => c.id === 'colmillo-rojo').cleared, true)
  t.is(
    estado.storyTarget(story('barbarian_raid'), 'camp:colmillo-rojo', emptied).id,
    'hachas-negras'
  )
})

test('atlas: live state names the region, target and route', (t) => {
  const game = newGame()
  const first = estado.live(game).atlas
  t.is(first.region, game.walker.mapId)
  t.is(first.target.kind, 'giver', 'a new hero is sent to the king')
  t.is(first.route[first.route.length - 1].to, 'castle', 'the route ends at the castle')
  t.is(first.discovered, null, 'no fog of war in this step')
  t.alike(first.players, {}, 'no other players offline')

  game.walker.placeAt('castle', KING.x, KING.y + 1)
  press(game, 'e')
  const trial = estado.live(game).atlas
  t.is(trial.target.kind, 'ring')
  t.alike(
    trial.route.map((hop) => hop.region),
    ['castle', 'city'],
    'from the castle: B, then the south gate'
  )

  game.field = new Field({ player: game.player, seed: game.fieldSeed() })
  t.is(estado.live(game).atlas.region, 'field')
  t.alike(estado.live(game).atlas.route, [], 'already in the meadow')

  game.field = new Dungeon({ player: game.player, floor: 2 })
  const crypt = estado.live(game).atlas
  t.is(crypt.region, 'crypt-2')
  t.alike(
    crypt.route.map((hop) => hop.to),
    ['crypt-1', 'field']
  )

  game.field = new BarbarianCamp({ player: game.player, campId: 'cuervos-ceniza' })
  t.is(estado.live(game).atlas.region, 'camp:cuervos-ceniza')

  game.title = true
  t.is(estado.live(game).atlas, null, 'no atlas on the title menu')
})

test('atlas: other players are counted per region', (t) => {
  const peers = [
    { mapId: 'city' },
    { mapId: 'city' },
    { mapId: 'crypt2' },
    { mapId: 'camp-hachas-negras' },
    { mapId: 'field' }
  ]
  const counts = estado.playersByRegion({ others: () => peers })
  t.alike(counts, { city: 2, 'crypt-2': 1, 'camp:hachas-negras': 1, field: 1 })
  t.is(estado.regionOfMapId('boss'), 'boss')
  t.is(estado.regionOfMapId(''), null)
})

test('dodge aid: the charge of the marked strike and the nearest free cell', (t) => {
  const { WorldBossEvent, FRAME_TICKS } = require('../lib/world-boss-event.js')
  const { bossWindup } = require('../lib/combat-rules.js')
  const { TICK_MS } = require('../lib/game.js')
  t.is(estado.TICK, TICK_MS, 'the same tick as lib/game.js')

  const boss = new WorldBossEvent({ width: 120, height: 36 })
  const player = { x: boss.x - 20, y: boss.y + 3, hp: 20 }
  const field = { mode: 'boss', boss, time: 1, player, width: 120, height: 36 }
  t.is(estado.bossDodge(field), null, 'no marked strike, no aid')
  t.is(estado.bossDodge({ ...field, mode: 'field' }), null, 'only in the ruins')

  boss.activate(0)
  boss.nextAttackAt = 0
  boss.tick(player, 1)
  const total = bossWindup(boss.action.attack, FRAME_TICKS)
  t.ok(total >= boss.action.attack.frames.length * FRAME_TICKS, 'never shorter than its frames')
  field.time = 2
  let aid = estado.bossDodge(field)
  t.is(aid.total, total, 'the windup is the real one (L6: its telegraph)')
  t.is(aid.done, 1, 'one tick into the windup')
  t.is(aid.leftMs, Math.round((total - 1) * TICK_MS))
  t.is(aid.totalMs, Math.round(total * TICK_MS))
  t.is(aid.attack, boss.action.attack.id, 'which strike, for the animation of the Colossus')

  const marked = new Set(boss.action.telegraphs.map((cell) => cell.x + ',' + cell.y))
  const off = { x: 0, y: 0 }
  while (marked.has(off.x + ',' + off.y)) off.x++
  Object.assign(player, off)
  aid = estado.bossDodge(field)
  t.is(aid.danger, false, 'off the marks there is no danger')
  t.is(aid.safe, null)

  // El golpe pega en todo su recorrido y a una celda: se prueba en una copia del
  // Coloso, con el heroe quieto, si lo alcanza antes de que se apaguen los poderes.
  const hits = (x, y) => {
    const copy = new WorldBossEvent({ width: 120, height: 36 })
    Object.assign(copy, boss, {
      action: { ...boss.action },
      hazards: boss.hazards.map((hazard) => ({ ...hazard }))
    })
    const hero = { x, y, hp: 99 }
    for (let time = field.time; time < field.time + 200; time++) {
      const events = copy.tick(hero, time)
      if (events.some((event) => event.type === 'boss-hit')) return true
      if (events.some((event) => event.type === 'boss-cast')) copy.nextAttackAt = Infinity
    }
    return false
  }
  t.is(hits(off.x, off.y), false, 'the far cell is never hit')

  const cell = boss.action.telegraphs[0]
  const next = boss.action.telegraphs[1]
  t.ok(aid.path.length > boss.action.telegraphs.length, 'the path fills the gaps between marks')
  const gap = { x: (cell.x + next.x) / 2, y: (cell.y + next.y) / 2 }
  t.ok(!marked.has(gap.x + ',' + gap.y), 'a gap between two marks')
  for (const spot of [cell, gap, { x: cell.x, y: cell.y + 1 }]) {
    t.ok(hits(spot.x, spot.y), 'standing there gets hit')
    player.x = spot.x
    player.y = spot.y
    aid = estado.bossDodge(field)
    t.is(aid.danger, true, 'and the aid warns about it')
    t.ok(aid.safe, 'a safe cell is offered')
    t.ok(!boss.occupies(aid.safe.x, aid.safe.y), 'outside the body of the Colossus')
    t.is(hits(aid.safe.x, aid.safe.y), false, 'following the arrow dodges the strike')
    const steps = Math.max(Math.abs(aid.safe.x - spot.x), Math.abs(aid.safe.y - spot.y))
    let closer = false
    for (let dy = -steps + 1; dy < steps; dy++) {
      for (let dx = -steps + 1; dx < steps; dx++) {
        const x = spot.x + dx
        const y = spot.y + dy
        if (x < 0 || y < 0 || x >= 120 || y >= 36 || boss.occupies(x, y)) continue
        if (!hits(x, y)) closer = true
      }
    }
    t.is(closer, false, 'no safe cell is fewer steps away')
  }

  field.time = 1 + total + 5
  t.is(estado.bossDodge(field).leftMs, 0, 'the countdown never goes below zero')
})
