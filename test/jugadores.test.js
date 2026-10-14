const { test } = require('brittle')
const jugadores = require('../scripts/tripo-jugadores.mjs')
const estado = require('../scripts/tripo-estado.js')
const { Runa } = require('../lib/game.js')
const { Presence } = require('../lib/net.js')
const { Field } = require('../lib/field.js')
const { Dungeon } = require('../lib/dungeon.js')

const { createTrack, placeOf, nearest, gaitOf, lerpAngle, DELAY_MS, SNAP_GAP, RING } = jugadores

test('jugadores: se dibuja DELAY_MS atras, entre dos poses', (t) => {
  const track = createTrack()
  t.is(track.at(0), null, 'sin poses no hay donde dibujarlo')
  // Diez poses por segundo, caminando a 5 m/s hacia +x, con su reloj y numero.
  for (let i = 0; i < 6; i++) {
    track.push(
      { x: i * 0.5, z: 0, yaw: Math.PI / 2, g: 2, t: 5000 + i * 100, s: i + 1 },
      1000 + i * 100
    )
  }
  t.is(track.size, 6)
  const at = track.at(1500 + 50)
  // 1550 - 250 = 1300: entre la pose 3 (x 1.5) y la 4 (x 2.0).
  t.ok(Math.abs(at.x - 1.5) < 1e-9, 'la pose de hace DELAY_MS: ' + at.x)
  t.is(at.g, 2)
  t.ok(Math.abs(at.speed - 5) < 1e-9, 'la velocidad sale de las poses')
  const mid = track.at(1500 + 100)
  t.ok(Math.abs(mid.x - 1.75) < 1e-9, 'a mitad de camino entre dos poses')
  t.is(DELAY_MS, 250)
})

test('jugadores: las lineas que llegan a los saltos se ven parejas', (t) => {
  const track = createTrack()
  // Salen cada 100 ms pero llegan de a dos: el reloj del otro (t) las espacia.
  const arrive = [1000, 1000, 1200, 1200, 1400, 1400, 1600, 1600]
  arrive.forEach((now, i) => track.push({ x: i, z: 0, g: 1, t: 70000 + i * 100, s: i + 1 }, now))
  const xs = []
  for (let now = 1350; now <= 1750; now += 50) xs.push(track.at(now).x)
  const steps = xs.slice(1).map((x, i) => x - xs[i])
  t.ok(
    steps.every((step) => Math.abs(step - steps[0]) < 0.05),
    'el paso es parejo: ' + steps.map((s) => s.toFixed(2)).join(' ')
  )
})

test('jugadores: extrapola un intervalo como mucho y nunca si esta quieto', (t) => {
  const track = createTrack()
  track.push({ x: 0, z: 0, g: 2, t: 0, s: 1 }, 1000)
  track.push({ x: 1, z: 0, g: 2, t: 100, s: 2 }, 1100)
  // Muy pasado de la ultima: avanza un intervalo y se queda.
  t.is(track.at(1100 + DELAY_MS + 1000).x, 2, 'un intervalo de mas, no mas')
  t.is(track.at(1100 + DELAY_MS + 50).x, 1.5)

  const still = createTrack()
  still.push({ x: 0, z: 0, g: 2, t: 0, s: 1 }, 1000)
  still.push({ x: 1, z: 0, g: 0, t: 100, s: 2 }, 1100)
  t.is(still.at(1100 + DELAY_MS + 80).x, 1, 'parado no se pasa ni vuelve')
  t.is(still.at(1100 + DELAY_MS + 80).g, 0)
})

test('jugadores: un salto largo se aparece y el anillo guarda RING poses', (t) => {
  const track = createTrack()
  for (let i = 0; i < 12; i++) track.push({ x: i * 0.1, z: 0, t: i * 100, s: i + 1 }, i * 100)
  t.is(track.size, RING)
  const before = track.at(2000).snaps
  track.push({ x: 50, z: 0, t: 1200, s: 13 }, 1200)
  t.is(track.size, 1, 'una puerta: se olvida el camino')
  const at = track.at(1200)
  t.is(at.x, 50, 'aparece ya, sin cruzar el mapa caminando')
  t.is(at.snaps, before + 1, 'la pagina sabe que aparecio')
  t.ok(SNAP_GAP === 6)
  // La misma linea dos veces no cuenta.
  t.absent(track.push({ x: 51, z: 0, t: 1300, s: 13 }, 1300))
  t.absent(
    track.push({ x: 49.9, z: 0, t: 1100, s: 12 }, 1310),
    'una vieja que llega tarde no cuenta'
  )
})

test('jugadores: el giro va por el camino corto y el paso sale de g', (t) => {
  const a = Math.PI - 0.1
  const b = -Math.PI + 0.1
  const half = lerpAngle(a, b, 0.5)
  t.ok(Math.abs(Math.abs(half) - Math.PI) < 1e-9, 'pasa por atras, no da toda la vuelta')
  const track = createTrack()
  track.push({ x: 0, z: 0, yaw: a, g: 1, t: 0, s: 1 }, 0)
  track.push({ x: 0.2, z: 0, yaw: b, g: 1, t: 100, s: 2 }, 100)
  t.ok(Math.abs(Math.abs(track.at(300).yaw) - Math.PI) < 1e-9)
  t.is(gaitOf(1, 9), 1, 'el paso de la red gana')
  t.is(gaitOf(undefined, 5), 2, 'sin g, corre si va rapido')
  t.is(gaitOf(undefined, 1), 1)
  t.is(gaitOf(undefined, 0), 0)
  // Una terminal sin pose: mira hacia donde va.
  const old = createTrack()
  old.push({ x: 0, z: 0 }, 0)
  old.push({ x: 0, z: 1 }, 100)
  t.is(old.at(1000).yaw, 0, 'hacia +z')
})

test('jugadores: la posicion 3D vale si cae cerca de su celda', (t) => {
  const cell = { x: 10, z: 10 }
  t.alike(placeOf(cell, { px: 10.6, pz: 9.8 }), { x: 10.6, z: 9.8, exact: true })
  t.alike(placeOf(cell, { px: 40, pz: 10 }), { x: 10, z: 10, exact: false }, 'lejos: la celda')
  t.alike(placeOf(cell, {}), { x: 10, z: 10, exact: false }, 'sin pose: la celda')
})

test('jugadores: el heroe animado va a los mas cercanos', (t) => {
  const list = [
    { id: 'e', d: 9 },
    { id: 'b', d: 2 },
    { id: 'a', d: 2 },
    { id: 'c', d: 30 },
    { id: 'd', d: 1 }
  ]
  t.alike([...nearest(list, 3)].sort(), ['a', 'b', 'd'])
  t.alike([...nearest(list, 2)].sort(), ['a', 'd'], 'a igual distancia gana el id menor')
  t.is(nearest(list, 0).size, 0)
  t.is(jugadores.RIGS.phone, 3)
  t.is(jugadores.RIGS.desktop, 5)
})

test('jugadores: el que ya lleva el heroe animado lo conserva salvo contra uno claramente mas cerca', (t) => {
  const kept = nearest(
    [
      { id: 'a', d: 4.2 },
      { id: 'b', d: 4.8 }
    ],
    1
  )
  t.alike([...kept], ['a'])
  const swapped = [
    { id: 'a', d: 5.9 },
    { id: 'b', d: 4.1 }
  ]
  t.alike([...nearest(swapped, 1)], ['b'], 'sin memoria salta')
  t.alike([...nearest(swapped, 1, kept)], ['a'], 'con memoria se queda')
  const far = [
    { id: 'a', d: 9 },
    { id: 'b', d: 4 }
  ]
  t.alike([...nearest(far, 1, kept)], ['b'], 'uno mucho mas cerca: cambia')
  const close = [
    { id: 'a', d: 3.6 },
    { id: 'b', d: 1.9 }
  ]
  t.alike([...nearest(close, 1, kept)], ['b'], 'de cerca alcanza con KEEP_GAP metros')
  // Siete jugadores entrando y saliendo entre 4 y 6 m (como scratchpad
  // churn.cjs), una vuelta cada medio segundo durante 12 s.
  const churn = (count, memory) => {
    let ranked = new Set()
    let swaps = 0
    for (let pass = 0; pass < 32; pass++) {
      const list = []
      for (let i = 0; i < 7; i++) {
        const phase = (i * Math.PI * 2) / 7
        list.push({ id: 'p' + i, d: 5 + Math.sin(pass * 0.45 + phase * 3) })
      }
      const next = nearest(list, count, memory ? ranked : null)
      if (pass >= 8) for (const id of next) if (!ranked.has(id)) swaps++
      ranked = next
    }
    return swaps
  }
  for (const count of [jugadores.RIGS.phone, jugadores.RIGS.desktop]) {
    t.ok(churn(count, false) > 3, 'sin memoria se turnan: ' + churn(count, false))
    t.is(churn(count, true), 0, 'con memoria nadie cambia en la banda de 4 a 6 m')
  }
})

function connect(a, b) {
  const handlers = [{}, {}]
  const conns = handlers.map((own, i) => ({
    destroyed: false,
    on(event, listener) {
      ;(own[event] ||= []).push(listener)
    },
    emit(event, value) {
      for (const listener of own[event] || []) listener(value)
    },
    write(value) {
      conns[1 - i].emit('data', value)
    },
    destroy() {}
  }))
  b.onConnection(conns[1])
  a.onConnection(conns[0])
  a.beat()
  b.beat()
}

test('jugadores: afuera se ven los de la misma region, con su pose', (t) => {
  const ana = new Runa({ presence: false, name: 'Ana' })
  const beto = new Runa({ presence: false, name: 'Beto' })
  ana.title = false
  beto.title = false
  const pa = new Presence({ name: 'Ana', offline: true })
  const pb = new Presence({ name: 'Beto', offline: true })
  ana.attachPresence(pa)
  beto.attachPresence(pb)
  ana.presenceStarted = true
  beto.presenceStarted = true
  connect(pa, pb)

  ana.field = new Field({ player: ana.player, seed: 27 })
  beto.field = new Field({ player: beto.player, seed: 27 })
  beto.field.player.x = 40
  beto.field.player.y = 18
  beto.announce()
  pb.pose({ px: 3.5, pz: -2, yaw: 0.5, g: 1 })
  pb.beat()
  const seen = estado.live(ana).players
  t.is(seen.length, 1, 'el de la pradera se ve en la pradera')
  t.is(seen[0].map, 'field')
  t.is(seen[0].x, 40)
  t.is(seen[0].pose.px, 3.5)
  t.is(seen[0].pose.g, 1)
  t.absent(seen[0].challenge, 'afuera no se desafia')

  beto.field = new Dungeon({ player: beto.player, floor: 2 })
  beto.announce()
  pb.beat()
  t.is(estado.live(ana).players.length, 0, 'en la cripta ya no esta en la pradera')
  ana.field = new Dungeon({ player: ana.player, floor: 2 })
  const crypt = estado.live(ana).players
  t.is(crypt.length, 1, 'en el mismo piso de la cripta si')
  t.is(crypt[0].map, 'crypt-2')

  ana.field = null
  beto.field = null
  beto.announce()
  pb.beat()
  const town = estado.live(ana).players
  t.is(town.length, ana.walker.mapId === beto.walker.mapId ? 1 : 0)
  if (town.length) t.ok(town[0].challenge, 'en la ciudad si se desafia')
})
