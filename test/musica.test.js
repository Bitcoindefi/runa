const { test } = require('brittle')
const musica = require('../scripts/tripo-musica-pistas.mjs')

test('musica: cada mapa de la pagina tiene su pista', (t) => {
  t.is(musica.trackFor('city'), 'city')
  t.is(musica.trackFor('nox'), 'nox')
  t.is(musica.trackFor('castle'), 'castle')
  t.is(musica.trackFor('field'), 'meadow')
  t.is(musica.trackFor('crypt-3'), 'crypt')
  t.is(musica.trackFor('camp:norte'), 'camp')
  t.is(musica.trackFor('boss'), 'boss')
  t.is(musica.trackFor('coliseum'), 'coliseum')
  t.is(musica.trackFor('title'), 'title')
  t.is(musica.trackFor('nowhere'), null)
  t.is(musica.trackFor(null), null)
})

test('musica: nueve pistas con pedido y sin repetir', (t) => {
  const ids = musica.TRACKS.map((track) => track.id)
  t.is(ids.length, 9)
  t.is(new Set(ids).size, 9)
  t.ok(musica.TRACKS.every((track) => track.prompt.length > 20))
})

test('musica: mas baja que las voces y mas baja aun cuando hablan', (t) => {
  const normal = musica.musicVolume({ sound: true })
  const under = musica.musicVolume({ sound: true, speaking: true })
  t.ok(normal > 0 && normal < 0.5)
  t.ok(under < normal)
  t.is(musica.musicVolume({ sound: false }), 0)
})
