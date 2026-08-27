const M = require('../lib/map.js')

let fails = 0
function ok(cond, what) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what)
  if (!cond) fails++
}

function scan(map, glyph) {
  const at = []
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (map.rows[y][x] === glyph) at.push([x, y])
  }
  return at
}

console.log(
  '=== CIUDAD entera (' +
    M.MAPS.city.width +
    'x' +
    M.MAPS.city.height +
    '), jugador en el spawn ==='
)
const w = new M.Walker('city')
console.log(M.render(w.map, { at: w }))
console.log('spawn:', w.x, w.y, '->', w.here().name)

console.log('\n=== colision ===')
// La prueba se coloca debajo de la puerta de casa, con la mamposteria de la
// fachada a ambos lados.
const home = scan(M.MAPS.city, 'C')[0]
w.placeAt('city', home[0], home[1] + 1)
let r = w.move(0, -1)
ok(r.moved && w.here().id === 'door.home', 'arriba entra a la puerta de casa: ' + w.here().name)
r = w.move(0, -1)
// La fachada es solida: el dibujo del edificio no debe convertirse en un
// pasillo oculto al caminar contra la puerta.
ok(
  !r.moved && r.blocked.solid,
  'otra vez arriba choca contra ' + r.blocked.name + ' (' + r.blocked.id + ')'
)
ok(
  ['masonry', 'window'].includes(r.blocked.id),
  '  y lo que bloquea sigue siendo parte de la fachada'
)
ok(w.x === home[0] && w.y === home[1], 'no se movio: sigue en ' + w.x + ',' + w.y)
r = w.move(-1, 0)
ok(
  !r.moved && r.blocked.id === 'masonry',
  'izquierda desde la puerta choca contra la mamposteria de la casa'
)
r = w.move(1, 0)
ok(
  !r.moved && r.blocked.id === 'masonry',
  'derecha desde la puerta choca contra la mamposteria de la casa'
)
console.log('  accion parado en la puerta:', JSON.stringify(w.action()))

w.placeAt('city', 1, 1)
r = w.move(-1, 0)
ok(!r.moved && r.blocked.id === 'wall', 'contra la muralla oeste: ' + r.blocked.name)
r = w.move(0, -1)
ok(!r.moved && r.blocked.id === 'wall', 'contra la muralla norte')
w.placeAt('city', 1, 1)
r = w.move(-1, -1)
ok(!r.moved, 'la diagonal a la esquina tambien choca')

console.log('\n=== puertas: una sola de cada una, y todas alcanzables ===')
function flood(map, from) {
  const seen = new Set()
  const q = [from]
  while (q.length) {
    const [x, y] = q.pop()
    const k = x + ',' + y
    if (seen.has(k)) continue
    if (M.tileAt(map, x, y).solid) continue
    seen.add(k)
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }
  return seen
}
const city = M.MAPS.city
const reach = flood(city, [city.spawn.x, city.spawn.y])
for (const g of ['C', 'I', 'P', 'A', 'D', 'T', 'K', '>', 'N']) {
  const at = scan(city, g)
  const named = M.TILES[g].name
  ok(at.length === 1, 'ciudad: ' + g + ' (' + named + ') aparece 1 vez, aparece ' + at.length)
  ok(
    at.length === 1 && reach.has(at[0][0] + ',' + at[0][1]),
    '  y se llega caminando desde el spawn: ' + JSON.stringify(at[0])
  )
}
const nox = M.MAPS.nox
const nreach = flood(nox, [nox.spawn.x, nox.spawn.y])
for (const g of ['C', 'I', 'P', 'A', 'D', 'R']) {
  const at = scan(nox, g)
  const named = M.TILES[g].name
  ok(at.length === 1, 'nox: ' + g + ' (' + named + ') aparece 1 vez, aparece ' + at.length)
  ok(
    at.length === 1 && nreach.has(at[0][0] + ',' + at[0][1]),
    '  y se llega caminando desde el spawn de NOX: ' + JSON.stringify(at[0])
  )
}
const field = M.MAPS.field
const freach = flood(field, [field.spawn.x, field.spawn.y])
const back = scan(field, '<')
ok(back.length === 1, 'campo: < aparece 1 vez')
ok(freach.has(back[0][0] + ',' + back[0][1]), 'campo: se llega a la entrada de la ciudad')
const castle = M.MAPS.castle
const creach = flood(castle, [castle.spawn.x, castle.spawn.y])
const ruins = scan(castle, 'V')
ok(ruins.length === 1, 'castillo: V aparece 1 vez')
ok(creach.has(ruins[0][0] + ',' + ruins[0][1]), 'castillo: se llega a la escalera a las ruinas')
const dungeon = M.MAPS.dungeon
const dreach = flood(dungeon, [dungeon.spawn.x, dungeon.spawn.y])
const stairs = scan(dungeon, 'U')
ok(stairs.length === 1, 'dungeon: U aparece 1 vez')
ok(dreach.has(stairs[0][0] + ',' + stairs[0][1]), 'dungeon: se llega a la salida al castillo')
console.log(
  '  celdas caminables ciudad:',
  reach.size,
  '| nox:',
  nreach.size,
  '| campo:',
  freach.size
)

console.log('\n=== viaje ciudad -> campo por el porton ===')
const gate = scan(city, '>')[0]
w.placeAt('city', gate[0], gate[1] - 1)
r = w.move(0, 1)
ok(r.moved && w.here().id === 'gate.field', 'bajando en la calle central se pisa el porton sur')
const act = w.action()
ok(act && act.kind === 'travel' && act.to === 'field', 'el porton ofrece: ' + JSON.stringify(act))
w.travel(act.to)
ok(w.mapId === 'field', 'ahora estas en ' + w.map.name + ' en ' + w.x + ',' + w.y)
ok(w.action() === null, 'no aterrizas encima de la entrada, asi que no rebotas de vuelta')
ok(w.peek(0, -1).id === 'gate.city', 'la entrada a la ciudad queda un paso al norte')

console.log(
  '\n=== ventana 46x14 sobre el campo (que mide ' + field.width + 'x' + field.height + ') ==='
)
w.placeAt('field', 40, 3)
let v = M.viewport(field, w, 46, 14)
console.log('viewport en la entrada:', JSON.stringify(v))
console.log(M.render(field, { at: w, width: 46, height: 14 }))
const lines = M.renderLines(field, { at: w, width: 46, height: 14 })
ok(lines.length === 14, 'salen 14 filas')
ok(
  lines.every((l) => l.length === 46),
  'todas de 46 columnas'
)
ok(
  lines.some((l) => l.includes('@')),
  'el jugador esta dibujado'
)

console.log('\n=== la ventana se pega a los bordes, no se sale del mapa ===')
v = M.viewport(field, { x: 0, y: 0 }, 46, 14)
ok(v.x === 0 && v.y === 0, 'esquina noroeste: ' + JSON.stringify(v))
v = M.viewport(field, { x: 999, y: 999 }, 46, 14)
ok(v.x === field.width - 46 && v.y === field.height - 14, 'esquina sudeste: ' + JSON.stringify(v))
v = M.viewport(city, { x: 30, y: 9 }, 500, 500)
ok(
  v.width === city.width && v.height === city.height,
  'pantalla mas grande que el mapa: ' + JSON.stringify(v)
)

console.log('\n=== esquina sudeste del campo, jugador dibujado en el borde ===')
w.placeAt('field', 78, 24)
console.log(M.render(field, { at: w, width: 46, height: 10 }))

console.log('\n=== rincon: mapa ragged ===')
try {
  M.defineMap({
    id: 'roto',
    name: 'x',
    rows: ['###', '##'],
    spawn: { x: 1, y: 1 },
    arrive: { x: 1, y: 1 }
  })
  ok(false, 'un mapa desparejo deberia explotar')
} catch (err) {
  ok(true, 'un mapa desparejo explota al definirlo: ' + err.message)
}

console.log('\n' + (fails === 0 ? 'TODO OK' : fails + ' FALLAS'))
