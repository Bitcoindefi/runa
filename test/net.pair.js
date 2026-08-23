'use strict'

/**
 * Dos procesos de verdad, un pueblo.
 *
 * Esto no se corre solo: se corre DOS VECES en paralelo, cada copia con un
 * nombre distinto, y lo que hay que mirar es si cada una nombra a la otra.
 *
 *   bare test/net.pair.js --name uno --path a --secs 40 &
 *   bare test/net.pair.js --name dos --path b --secs 40 &
 *   wait
 *
 * Cada copia camina su propio recorrido y una vez por segundo imprime a quien
 * esta viendo, con el reloj adelante para poder cruzar las dos salidas despues.
 * No hay asserts: la prueba es la salida, y la lee una persona.
 *
 * Con --die N la copia se muere de golpe a los N segundos, sin stop() y sin
 * despedirse, que es la unica forma honesta de probar el barrido por silencio:
 * el que pierde el wifi no manda ningun adios.
 */

const { Presence, GONE_MS } = require('../lib/net.js')

const argv = (typeof Bare !== 'undefined' && Bare.argv) || []

function flag(name, fallback) {
  for (let i = 0; i < argv.length; i++) {
    if (String(argv[i]) === '--' + name && i + 1 < argv.length) return String(argv[i + 1])
  }
  return fallback
}

const NAME = flag('name', 'uno')
const PATH = flag('path', 'a')
const SECS = Math.max(1, Number(flag('secs', '40')) || 40)
const DIE = Number(flag('die', '0')) || 0
const TOPIC = flag('topic', '')

// Dos recorridos distintos, para que en la salida del otro se vea que las
// coordenadas se mueven y no son un eco de una sola linea repetida.
//   a: de ida y vuelta por una fila
//   b: de ida y vuelta por una columna
const STEP_MS = 200

function walk(tick) {
  if (PATH === 'b') {
    const span = 8
    const t = tick % (span * 2)
    const y = t < span ? t : span * 2 - t
    return { mapId: 'city', x: 20, y: 2 + y }
  }
  const span = 12
  const t = tick % (span * 2)
  const x = t < span ? t : span * 2 - t
  return { mapId: 'city', x: 4 + x, y: 5 }
}

const started = Date.now()

function clock() {
  const s = (Date.now() - started) / 1000
  return '[' + s.toFixed(1).padStart(5) + 's]'
}

function say(text) {
  console.log(clock() + ' ' + NAME + ': ' + text)
}

const opts = { name: NAME }
if (TOPIC) opts.topic = TOPIC

const presence = new Presence(opts)
presence.on('join', (who) => say('LLEGO ' + who))
presence.on('leave', (who) => say('SE FUE ' + who))

const up = presence.start()
say('start() -> ' + up + ' | id ' + presence.id + ' | glifo ' + presence.glyph)
const topic = presence.topic()
say('topic ' + (topic ? topic.toString('hex').slice(0, 16) : 'null'))

let tick = 0
const walker = setInterval(() => {
  tick++
  const at = walk(tick)
  presence.update(at.mapId, at.x, at.y)
}, STEP_MS)

const reporter = setInterval(() => {
  const here = walk(tick)
  const seen = presence.others('city')
  say(
    'yo ' +
      here.x +
      ',' +
      here.y +
      ' | conns ' +
      presence.conns.size +
      ' | veo ' +
      seen.length +
      ': ' +
      JSON.stringify(seen)
  )
}, 1000)

function done(why) {
  clearInterval(walker)
  clearInterval(reporter)
  presence.stop()
  say('fin (' + why + ')')
}

if (DIE > 0) {
  // Muerte subita: ni stop(), ni cerrar sockets, ni avisar. El otro tiene que
  // sacarnos solo, por silencio, dentro de GONE_MS.
  setTimeout(() => {
    say('me muero de golpe, sin avisar (el otro deberia sacarme en ' + GONE_MS + 'ms)')
    Bare.exit(0)
  }, DIE * 1000)
}

setTimeout(() => done('se acabo el tiempo'), SECS * 1000)
