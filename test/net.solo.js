// Presencia de a uno: arranca, camina, mira quien hay, y se va.
//
// La gracia de este test no es que encuentre a alguien, es que ande igual sin
// encontrar a nadie. Eso es lo que va a pasar la mayoria de las veces, y lo que
// tiene que pasar tambien cuando no hay red: nada explota, nada cuelga, y
// others() devuelve el vacio que el juego dibuja como un pueblo desierto.

const { Presence, TOPIC_NAME, GONE_MS } = require('../lib/net.js')

let fails = 0
function ok(cond, what) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what)
  if (!cond) fails++
}

console.log('=== una sesion sola en el pueblo ===')

const net = new Presence({ name: 'leo' })
net.on('join', (name) => console.log('  [log] llego ' + name))
net.on('leave', (name) => console.log('  [log] se fue ' + name))

ok(/^[0-9a-f]{16}$/.test(net.id), 'id efimero de la sesion: ' + net.id)
ok(net.name === 'leo', 'nombre: ' + net.name)
ok(net.glyph === 'L', 'glifo sacado del nombre: ' + net.glyph)
ok(net.others('city').length === 0, 'antes de arrancar no hay nadie')

const up = net.start()
console.log('  start() ->', up, '| online:', net.online)
ok(net.started, 'quedo arrancada')

console.log('\n=== el topic ===')
const t = net.topic()
ok(t.length === 32, 'hash de ' + TOPIC_NAME + ': 32 bytes')
console.log('  ' + t.toString('hex'))
ok(
  new Presence({ name: 'otro' }).topic().toString('hex') === t.toString('hex'),
  'dos sesiones distintas derivan el mismo topic'
)

console.log('\n=== caminar ===')
net.update('city', 8, 6)
ok(net.self.x === 8 && net.self.y === 6, 'update deja al jugador en 8,6')
net.update('city', 9.7, -3)
ok(
  net.self.x === 10 && net.self.y === -3,
  'las coordenadas se redondean: ' + net.self.x + ',' + net.self.y
)
net.update('field', 2, 2)
ok(net.self.mapId === 'field', 'y se cambia de mapa')
net.update('city', 8, 6)

console.log('\n=== others() ===')
ok(Array.isArray(net.others('city')), 'others() devuelve un array')
ok(net.others('city').length === 0, 'solo en la ciudad: ' + JSON.stringify(net.others('city')))
ok(net.others('field').length === 0, 'y solo en el campo tambien')

// Un peer inventado a mano, sin red de por medio: interesa el filtrado y el
// barrido, no el transporte, y hacerlos depender de que aparezca alguien seria
// un test que pasa o falla segun el wifi.
console.log('\n=== un vecino de mentira ===')
net.receive(JSON.stringify({ id: 'ffff', name: 'ana', mapId: 'city', x: 12, y: 4, glyph: 'A' }))
net.receive(JSON.stringify({ id: 'eeee', name: 'bo', mapId: 'field', x: 1, y: 1, glyph: 'B' }))
net.receive('{ esto no es json')
net.receive(JSON.stringify({ id: net.id, name: 'yo mismo', mapId: 'city', x: 0, y: 0 }))

const here = net.others('city')
ok(here.length === 1 && here[0].name === 'ana', 'en la ciudad hay uno: ' + JSON.stringify(here))
ok(here[0].glyph === 'A' && here[0].x === 12 && here[0].y === 4, 'con su glifo y su posicion')
ok(net.others('field').length === 1, 'y otro distinto en el campo')
ok(net.others().length === 2, 'sin filtro vienen los dos')
ok(net.peers.has(net.id) === false, 'el eco de uno mismo no cuenta como vecino')

console.log('\n=== el silencio ===')
// Se le atrasa el reloj a mano en vez de esperar tres segundos de verdad: el
// barrido mira una resta, y hacer que el test dure lo que dura el timeout no
// prueba nada mas.
net.peers.get('ffff').seen -= GONE_MS + 1
net.reap()
ok(net.others('city').length === 0, 'el que se callo se va sin mandar ningun adios')
ok(net.others('field').length === 1, 'el que sigue hablando se queda')

console.log('\n=== bajar la persiana ===')
net.stop()
ok(net.online === false, 'stop() la deja offline')
ok(net.others('city').length === 0, 'y sin nadie: ' + JSON.stringify(net.others('city')))
net.stop()
ok(true, 'stop() dos veces no rompe nada')

const dead = new Presence({ name: 'zz' })
dead.stop()
ok(true, 'stop() sin start() tampoco')

console.log('\n' + (fails ? fails + ' FALLAS' : 'todo ok') + ', y el proceso deberia salir solo')
if (fails) Bare.exitCode = 1
