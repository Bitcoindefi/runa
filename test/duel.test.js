const { test } = require('brittle')
const { MAPS } = require('../lib/map.js')
const { Duel, sideFor, otherSide } = require('../lib/duel.js')

const arena = MAPS.coliseum

function nuevo(self = 'ana', rival = 'beto') {
  return new Duel({ arena, self, rival })
}

test('los lados se calculan igual desde las dos puntas', (t) => {
  // Esto es lo que evita un mensaje de coordinacion. Los dos jugadores hacen la
  // cuenta con los mismos dos nombres y les tiene que dar lados opuestos, sin
  // haberse puesto de acuerdo en nada.
  const desdeAna = sideFor('ana', 'beto')
  const desdeBeto = sideFor('beto', 'ana')
  t.is(desdeAna, 'west')
  t.is(desdeBeto, 'east')
  t.is(otherSide(desdeAna), desdeBeto, 'nunca pueden caer del mismo lado')
})

test('el reparto de lados no depende del orden en que se pregunte', (t) => {
  const nombres = ['zoe', 'ana', 'beto', 'carlos', 'diana', 'ur', 'A', 'a', '0']
  for (const a of nombres) {
    for (const b of nombres) {
      if (a === b) continue
      t.is(otherSide(sideFor(a, b)), sideFor(b, a), a + ' vs ' + b)
    }
  }
})

test('las coordenadas salen del mapa, no de este modulo', (t) => {
  // La nota de coordinacion lo pide asi: sin copiar numeros a otro modulo. Si
  // Codex mueve el arte del Coliseo, el duelo tiene que seguirlo solo.
  const d = nuevo()
  const oeste = arena.duelSpawns.find((s) => s.id === 'west')
  t.alike(d.spawnFor('west'), { ...oeste })
  t.is(d.spawnFor('west').x, oeste.x)
  t.is(d.spawnFor('west').y, oeste.y)
})

test('el punto que devuelve es una copia, no el del mapa', (t) => {
  // Devolver el objeto original dejaria que quien lo reciba le mueva las
  // coordenadas al Coliseo sin querer, y el proximo duelo empezaria torcido.
  const d = nuevo()
  const antes = arena.duelSpawns.find((s) => s.id === 'west').x
  const copia = d.spawnFor('west')
  copia.x = 999
  t.is(arena.duelSpawns.find((s) => s.id === 'west').x, antes, 'el mapa quedo intacto')
})

test('los dos miran hacia el centro', (t) => {
  const d = nuevo()
  t.is(d.spawnFor('west').facing, 'east')
  t.is(d.spawnFor('east').facing, 'west')
})

test('entrar guarda de donde vino', (t) => {
  const d = nuevo()
  const donde = d.begin({ mapId: 'city', x: 12, y: 34 })
  t.is(donde.mapId, 'coliseum')
  t.is(donde.x, d.spawnFor().x)
  t.ok(d.active)
  t.alike(d.from, { mapId: 'city', x: 12, y: 34 })
})

test('no se entra sin decir de donde', (t) => {
  // Sin `from` no habria como devolverlo, y el jugador quedaria varado en el
  // Coliseo. Es mejor negarse a empezar que empezar algo sin salida.
  const d = nuevo()
  t.exception(() => d.begin(), /de donde vino/)
  t.exception(() => d.begin({ x: 1, y: 2 }), /de donde vino/)
  t.absent(d.active)
})

test('terminar devuelve al lugar exacto del que salio', (t) => {
  const d = nuevo()
  d.begin({ mapId: 'city', x: 12, y: 34 })
  const vuelta = d.end('gano ana')
  t.alike(vuelta, { mapId: 'city', x: 12, y: 34 })
  t.absent(d.active)
  t.is(d.reason, 'gano ana')
})

test('rendirse y desconectarse vuelven al mismo lugar que ganar', (t) => {
  // La diferencia entre esos tres casos es de puntaje y de premio, no de
  // geografia. El que se queda sin internet no puede quedar preso del Coliseo.
  const destinos = ['gano', 'se rindio', 'se desconecto'].map((motivo) => {
    const d = nuevo()
    d.begin({ mapId: 'field', x: 7, y: 8 })
    return d.end(motivo)
  })
  t.alike(destinos[0], destinos[1])
  t.alike(destinos[1], destinos[2])
})

test('terminar dos veces no rompe ni cambia el destino', (t) => {
  // Puede llegar el aviso de que el rival se fue justo despues de que el duelo
  // ya termino por otra via. La segunda vez tiene que ser inofensiva.
  const d = nuevo()
  d.begin({ mapId: 'city', x: 5, y: 6 })
  const primera = d.end('gano')
  const segunda = d.end('se desconecto')
  t.alike(segunda, primera)
  t.is(d.reason, 'gano', 'el primer motivo es el que vale')
})

test('la salida Q se bloquea solo mientras el duelo vive', (t) => {
  const d = nuevo()
  t.absent(d.blocksExit(), 'antes de empezar se puede salir')
  d.begin({ mapId: 'city', x: 1, y: 1 })
  t.ok(d.blocksExit(), 'con la pelea viva, no')
  d.end()
  t.absent(d.blocksExit(), 'al terminar se libera')
})

test('nadie se escapa a las gradas', (t) => {
  const d = nuevo()
  const b = arena.arenaBounds
  t.alike(d.clamp(b.x1 - 40, b.y1 - 40), { x: b.x1, y: b.y1 })
  t.alike(d.clamp(b.x2 + 40, b.y2 + 40), { x: b.x2, y: b.y2 })
  t.alike(d.clamp(b.center.x, b.center.y), { x: b.center.x, y: b.center.y }, 'el centro no se toca')
  t.ok(d.inside(b.center.x, b.center.y))
  t.absent(d.inside(b.x1 - 1, b.center.y))
  t.absent(d.inside(b.center.x, b.y2 + 1))
})

test('los dos puntos de salida caen adentro del campo', (t) => {
  // Si el arte del Coliseo se moviera y un spawn quedara fuera de arenaBounds,
  // el jugador apareceria ya empujado contra un borde. Este test lo caza.
  const d = nuevo()
  for (const s of arena.duelSpawns) {
    t.ok(d.inside(s.x, s.y), 'el lado ' + s.id + ' esta dentro del campo')
  }
})

test('los dos lados son simetricos respecto del centro', (t) => {
  // Se mide contra el centro geometrico del campo y no contra
  // `arenaBounds.center.x`, que viene redondeado. El Coliseo mide 128 de ancho,
  // asi que su centro real cae en 63.5: contra 64 los dos lados darian 24 y 23 y
  // pareceria que el mapa esta torcido cuando no lo esta.
  const b = arena.arenaBounds
  const centro = (b.x1 + b.x2) / 2
  const oeste = arena.duelSpawns.find((s) => s.id === 'west')
  const este = arena.duelSpawns.find((s) => s.id === 'east')
  t.is(oeste.y, este.y, 'a la misma altura')
  t.is(centro - oeste.x, este.x - centro, 'a la misma distancia del centro')
})

test('el lugar del arbitro esta reservado y es una copia', (t) => {
  const d = nuevo()
  const r = d.refereeSpawn()
  t.ok(r, 'el mapa lo publica')
  t.ok(d.inside(r.x, r.y), 'y cae dentro del campo')
  r.x = 999
  t.not(arena.refereeSpawn.x, 999)
})

test('un duelo necesita un mapa que publique los puntos', (t) => {
  t.exception(() => new Duel({ arena: {}, self: 'a', rival: 'b' }), /duelSpawns/)
  t.exception(
    () => new Duel({ arena: { duelSpawns: [1, 2] }, self: 'a', rival: 'b' }),
    /arenaBounds/
  )
})

test('un duelo no se puede empezar dos veces', (t) => {
  const d = nuevo()
  d.begin({ mapId: 'city', x: 1, y: 1 })
  t.exception(() => d.begin({ mapId: 'city', x: 2, y: 2 }), /ya empezo/)
  d.end()
  t.exception(() => d.begin({ mapId: 'city', x: 3, y: 3 }), /ya termino/)
})
