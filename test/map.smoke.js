const M = require('../lib/map.js')

let fails = 0
function ok(cond, what) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what)
  if (!cond) fails++
}

console.log('=== CIUDAD entera (60x18), jugador en el spawn ===')
const w = new M.Walker('city')
console.log(M.render(w.map, { at: w }))
console.log('spawn:', w.x, w.y, '->', w.here().name)

console.log('\n=== colision ===')
// El spawn esta justo debajo de la puerta de casa, con la pared de la casa
// pegada a la izquierda y a la derecha de esa puerta.
w.placeAt('city', 8, 6)
let r = w.move(0, -1)
ok(
  r.moved && w.here().id === 'door.home',
  'arriba desde (8,6) entra a la puerta de casa: ' + w.here().name
)
r = w.move(0, -1)
// (8,4) cae sobre la letra a de la palabra casa, pintada adentro del edificio.
// Las letras del cartel son solidas igual que la pared: si no, el nombre del
// negocio seria un agujero en su propia fachada.
ok(
  !r.moved && r.blocked.solid,
  'otra vez arriba choca contra ' + r.blocked.name + ' (' + r.blocked.id + ')'
)
ok(r.blocked.id === 'sign', '  y lo que bloquea es la letra del cartel, no una pared')
ok(w.x === 8 && w.y === 5, 'no se movio: sigue en ' + w.x + ',' + w.y)
r = w.move(-1, 0)
ok(
  !r.moved && r.blocked.id === 'wall',
  'izquierda desde la puerta choca contra la pared de la casa'
)
r = w.move(1, 0)
ok(!r.moved && r.blocked.id === 'wall', 'derecha desde la puerta choca contra la pared de la casa')
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
function scan(map, glyph) {
  const at = []
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (map.rows[y][x] === glyph) at.push([x, y])
  }
  return at
}
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
for (const g of ['C', 'I', 'P', 'A', 'D', '>']) {
  const at = scan(city, g)
  const named = M.TILES[g].name
  ok(at.length === 1, 'ciudad: ' + g + ' (' + named + ') aparece 1 vez, aparece ' + at.length)
  ok(
    at.length === 1 && reach.has(at[0][0] + ',' + at[0][1]),
    '  y se llega caminando desde el spawn: ' + JSON.stringify(at[0])
  )
}
const field = M.MAPS.field
const freach = flood(field, [field.spawn.x, field.spawn.y])
const back = scan(field, '<')
ok(back.length === 1, 'campo: < aparece 1 vez')
ok(freach.has(back[0][0] + ',' + back[0][1]), 'campo: se llega a la entrada de la ciudad')
console.log('  celdas caminables ciudad:', reach.size, '| campo:', freach.size)

console.log('\n=== viaje ciudad -> campo por el porton ===')
w.placeAt('city', 30, 16)
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
v = M.viewport(city, { x: 30, y: 9 }, 200, 200)
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
