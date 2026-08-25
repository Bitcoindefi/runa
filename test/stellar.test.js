const { test } = require('brittle')
const { Chain } = require('../lib/stellar.js')
const { Field } = require('../lib/field.js')

/**
 * Ni un solo test de aca toca la red.
 *
 * La semilla del dia viene de la cadena, y un test que la pida de verdad se
 * pone rojo cuando falla internet o cuando el RPC publico tiene un mal dia. Eso
 * no es una prueba del juego, es una prueba del clima. Lo que si se prueba es
 * todo lo que decide runa: como se mezcla la semilla, que el campo la use, y
 * que el juego siga andando cuando la cadena no contesta. El RPC se reemplaza
 * por una funcion que devuelve el numero que queramos.
 */

/** Un Chain que no sale a la red: contesta el ledger que le digamos. */
function fakeChain(sequence) {
  const c = new Chain()
  c.rpc = () => Promise.resolve({ sequence, protocolVersion: 27 })
  return c
}

/** Firma de un campo: donde quedaron los bichos despues de un rato. */
function fieldSignature(seed, ticks = 200) {
  const f = new Field({ seed })
  f.populate()
  for (let i = 0; i < ticks; i++) f.tick()
  const parts = f.foes.map((foe) => foe.id + '@' + Math.round(foe.x) + ',' + Math.round(foe.y))
  let h = 2166136261
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h >>> 0
}

test('la cadena esta disponible en este build', (t) => {
  const c = new Chain()
  t.ok(c.available, 'stellar-base cargo dentro de Bare')
  t.is(c.address, null, 'sin cuenta todavia')
})

test('dos jugadores en el mismo dia sacan la misma semilla', async (t) => {
  const a = await fakeChain(4320980).dailySeed()
  const b = await fakeChain(4320980).dailySeed()
  t.is(a.seed, b.seed, 'la semilla no depende de quien pregunta')
  t.is(a.day, b.day)
})

test('el dia no cambia dentro del mismo dia', async (t) => {
  // 17280 ledgers entran en un dia. Dos momentos del mismo bloque son el mismo
  // dia, aunque hayan pasado horas entre uno y otro.
  const manana = await fakeChain(250 * 17280 + 5).dailySeed()
  const noche = await fakeChain(250 * 17280 + 17279).dailySeed()
  t.is(manana.day, 250)
  t.is(noche.day, 250)
  t.is(manana.seed, noche.seed, 'el campo no se rehace en medio del dia')
})

test('el dia siguiente da otra semilla', async (t) => {
  const hoy = await fakeChain(250 * 17280).dailySeed()
  const manana = await fakeChain(251 * 17280).dailySeed()
  t.not(hoy.seed, manana.seed)
  t.is(manana.day, hoy.day + 1)
})

test('dias vecinos dan campos bien distintos, no casi iguales', async (t) => {
  // El indice del dia crece de a uno. Sin mezclarlo, dos dias seguidos saldrian
  // casi calcados, que es peor que no cambiar: parece un error del juego.
  const seeds = []
  for (let d = 0; d < 6; d++) seeds.push((await fakeChain((900 + d) * 17280).dailySeed()).seed)
  const unicas = new Set(seeds)
  t.is(unicas.size, 6, 'seis dias, seis semillas')

  const campos = new Set(seeds.map((s) => fieldSignature(s)))
  t.is(campos.size, 6, 'y seis campos distintos de verdad')
})

test('la misma semilla dibuja el mismo campo', (t) => {
  const a = fieldSignature(3310838056)
  const b = fieldSignature(3310838056)
  t.is(a, b, 'mismo numero, mismo mundo')
})

test('si la cadena no contesta, no se rompe nada', async (t) => {
  const c = new Chain()
  c.rpc = () => Promise.reject(new Error('sin internet'))
  const d = await c.dailySeed()
  t.is(d, null, 'devuelve null en vez de tirar')
  t.is(c.error, 'sin internet', 'y deja dicho por que')
})

test('sin cadena, el campo igual cambia con el jugador', (t) => {
  // La issue #3 se queja de que cada salida al campo es identica. La semilla del
  // dia lo arregla cuando hay linea; sin linea tiene que arreglarlo igual, o el
  // que juega sin internet se queda con el bug.
  const local = (xp, gold) => (Math.imul(xp + 1, 2654435761) ^ Math.imul(gold + 1, 40503)) >>> 0
  const a = fieldSignature(local(0, 0))
  const b = fieldSignature(local(40, 12))
  t.not(a, b, 'otro jugador, otro campo')
})
