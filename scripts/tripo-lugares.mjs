// Los lugares de adentro de la pradera como datos: los pisos de la cripta
// (lib/dungeon.js) y los campamentos barbaros (lib/barbarian-camp.js), leidos
// del Field que el juego tiene abierto. Sin three.js: la pagina lo pide como
// lugares.js y las pruebas (test/lugares.test.js) lo cargan en Bare.
//
//   placeId(field)          'field', 'crypt-<piso>' o 'camp:<id>': el id del mapa
//                           3D de ese Field, o null si no es ninguno de esos
//   placeOfId(id)           al reves: { mode, floor } o { mode, campId }, o null
//   mergeRects(w, h, test)  las celdas donde test(x, y) es true, en rectangulos
//                           { x0, y0, x1, y1 } (bordes incluidos) que no se pisan
//   cryptData(field, names) el piso de la cripta como datos de mapa, con `cripta`
//   campData(field, names)  el campamento como datos de mapa, con `campamento`
//   moodKey(data, moods)    que clima de efectos.js le toca a un mapa
//   heroFog(fog, distance)  la niebla de un lugar cerrado, medida desde el heroe
//   cryptHeights(data)      el alto del piso de cada celda de la cripta (CRYPT)
//   cryptSees(data, a, b)   si la luz va de la celda a a la b sin cruzar roca
//   cryptLights(data, o)    las luces fijas de un piso: braseros, el trono, la
//                           luz de la escalera de subida y las antorchas
//
// cryptData y campData leen solo field.layout, field.floor, field.camp y el tamano:
// lo que cambia en la partida (monstruos, sello de la escalera, despejado) se
// lee del Field en cada cuadro, no queda en estos datos. Se guardan por piso o
// campamento y por idioma.
//
// Las tablas de glifos copian walkable() de lib/dungeon.js y de
// lib/barbarian-camp.js; las pruebas comparan las dos contra el juego.

// Lo que frena en la cripta (lib/dungeon.js walkable).
export const CRYPT_BLOCKED = '#|-=[]~%o+'
// Lo unico que se pisa en un campamento (lib/barbarian-camp.js walkable).
export const CAMP_WALKABLE = ' .,:;*U'

export const cryptWalkable = (ch) => typeof ch === 'string' && !CRYPT_BLOCKED.includes(ch)
export const campWalkable = (ch) =>
  typeof ch === 'string' && ch.length === 1 && CAMP_WALKABLE.includes(ch)

export function placeId(field) {
  if (!field) return null
  if (field.mode === 'field') return 'field'
  if (field.mode === 'dungeon') return 'crypt-' + field.floor
  if (field.mode === 'barbarian-camp' && field.camp) return 'camp:' + field.camp.id
  return null
}

export function placeOfId(id) {
  if (typeof id !== 'string') return null
  if (id === 'field') return { mode: 'field' }
  const crypt = /^crypt-(\d+)$/.exec(id)
  if (crypt) return { mode: 'dungeon', floor: Number(crypt[1]) }
  if (id.startsWith('camp:') && id.length > 5) {
    return { mode: 'barbarian-camp', campId: id.slice(5) }
  }
  return null
}

// El clima de un mapa en la tabla `known` (MOODS de efectos.js): el de su id
// (crypt-2), si no el de su tipo (boss, crypt, camp) y si no el de la ciudad. La
// pradera ('field', kind 'map') sigue con el de la ciudad. null sin mapa.
export function moodKey(data, known) {
  if (!data) return null
  if (Object.hasOwn(known, data.id)) return data.id
  if (Object.hasOwn(known, data.kind)) return data.kind
  return 'city'
}

// La niebla de un lugar cerrado se mide desde el heroe y no desde la camara:
// [cerca, lejos] del clima mas lo que hay de la camara al heroe, asi la vista
// alta y la de tercera persona ven el mismo pedazo de cripta.
export function heroFog(fog, distance) {
  const away = Number.isFinite(distance) && distance > 0 ? distance : 0
  return [fog[1] + away, fog[2] + away]
}

// Rectangulos golosos: el primero toma la fila mas larga que puede desde su
// esquina y despues baja mientras la fila de abajo este entera y libre.
export function mergeRects(width, height, test) {
  const used = new Uint8Array(width * height)
  const free = (x, y) => !used[y * width + x] && test(x, y)
  const rects = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!free(x, y)) continue
      let x1 = x
      while (x1 + 1 < width && free(x1 + 1, y)) x1++
      let y1 = y
      for (;;) {
        const ny = y1 + 1
        if (ny >= height) break
        let whole = true
        for (let cx = x; cx <= x1 && whole; cx++) whole = free(cx, ny)
        if (!whole) break
        y1 = ny
      }
      for (let cy = y; cy <= y1; cy++) {
        for (let cx = x; cx <= x1; cx++) used[cy * width + cx] = 1
      }
      rects.push({ x0: x, y0: y, x1, y1 })
    }
  }
  return rects
}

// Las celdas alcanzables a pie desde `from`, en 8 direcciones como el juego
// (walk recibe dx y dy de -1 a 1).
function reach(width, height, from, open) {
  const seen = new Uint8Array(width * height)
  if (!open(from.x, from.y)) return seen
  const queue = [from.y * width + from.x]
  seen[queue[0]] = 1
  for (let head = 0; head < queue.length; head++) {
    const x = queue[head] % width
    const y = (queue[head] - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const i = ny * width + nx
        if (seen[i] || !open(nx, ny)) continue
        seen[i] = 1
        queue.push(i)
      }
    }
  }
  return seen
}

// Las caras de roca que dan a algo que no es roca, juntas en tramos: side es
// hacia donde mira la cara ('n' es hacia y menor). Un tramo n/s va de x0 a x1 en
// la fila y; uno e/w, de y0 a y1 en la columna x.
function rockFaces(width, height, rock) {
  const faces = []
  const open = (x, y) => x >= 0 && y >= 0 && x < width && y < height && !rock(x, y)
  for (const [side, dx, dy] of [
    ['n', 0, -1],
    ['s', 0, 1]
  ]) {
    for (let y = 0; y < height; y++) {
      let start = -1
      for (let x = 0; x <= width; x++) {
        const face = x < width && rock(x, y) && open(x + dx, y + dy)
        if (face && start < 0) start = x
        if (!face && start >= 0) {
          faces.push({ side, x0: start, x1: x - 1, y0: y, y1: y })
          start = -1
        }
      }
    }
  }
  for (const [side, dx, dy] of [
    ['w', -1, 0],
    ['e', 1, 0]
  ]) {
    for (let x = 0; x < width; x++) {
      let start = -1
      for (let y = 0; y <= height; y++) {
        const face = y < height && rock(x, y) && open(x + dx, y + dy)
        if (face && start < 0) start = y
        if (!face && start >= 0) {
          faces.push({ side, x0: x, x1: x, y0: start, y1: y - 1 })
          start = -1
        }
      }
    }
  }
  return faces
}

const inBox = (box, x, y) => !!box && x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1

// Lo que se guarda: pocos pisos y campamentos por idioma.
const cache = new Map()
function remember(key, make) {
  if (!cache.has(key)) {
    cache.set(key, make())
    while (cache.size > 12) cache.delete(cache.keys().next().value)
  }
  return cache.get(key)
}

// ---------------------------------------------------------------------------
// La cripta.

// Los nombres de los glifos de la cripta, como la tabla TILES de un mapa fijo.
// `solid` solo sirve para un recorrido sin partida: en el juego frena Dungeon.
function cryptTiles(names) {
  const rock = { id: 'wall', name: names.rock || 'la roca', solid: true }
  return {
    '#': rock,
    '|': rock,
    '-': rock,
    '~': { id: 'water', name: names.water || 'el agua', solid: true },
    ':': { id: 'bridge', name: names.bridge || 'el puente', solid: false },
    '+': { id: 'pillar', name: names.pillar || 'un pilar', solid: true },
    '*': { id: 'lamp', name: names.lamp || 'una lampara', solid: false },
    '%': { id: 'bones', name: names.bones || 'los huesos', solid: true },
    o: { id: 'bones', name: names.bones || 'los huesos', solid: true },
    '[': { id: 'tomb', name: names.tomb || 'una tumba', solid: true },
    '=': { id: 'tomb', name: names.tomb || 'una tumba', solid: true },
    ']': { id: 'tomb', name: names.tomb || 'una tumba', solid: true },
    '.': { id: 'flagstone', name: names.floor || 'las losas', solid: false },
    '^': { id: 'stairs.up', name: names.up || 'la escalera de subida', solid: false },
    v: { id: 'stairs.down', name: names.down || 'la escalera de bajada', solid: false },
    T: { id: 'throne', name: names.throne || 'el trono', solid: false }
  }
}

// Donde cae el arte de cada escalera (lib/dungeon.js staircase): la de subida
// termina en la fila del ^ y arranca 4 columnas antes; la de bajada empieza en la
// fila de la v, 8 columnas antes. Las dos miden 5 filas y hasta 13 columnas.
function stairBoxes(layout) {
  const up = layout.up
  const down = layout.down
  return {
    up: { x0: up.x - 4, x1: up.x + 8, y0: up.y - 4, y1: up.y },
    down: down ? { x0: down.x - 8, x1: down.x + 4, y0: down.y, y1: down.y + 4 } : null
  }
}

/**
 * Un piso de la cripta (un Dungeon del juego) como datos de mapa. `rows` son los
 * glifos del juego tal cual; `cripta` es el plano para armarlo en 3D. Todas las
 * celdas van en coordenadas del juego (x columna, y fila).
 */
export function cryptData(field, names = {}) {
  const layout = field.layout
  const floor = field.floor
  const key = ['crypt', floor, names.key || ''].join('|')
  return remember(key, () => {
    const { width, height } = field
    const rows = layout.rows
    const at = (x, y) => (rows[y] && rows[y][x]) || '#'
    const walk = (x, y) => cryptWalkable(at(x, y))
    const boxes = stairBoxes(layout)
    const inStairs = (x, y) => inBox(boxes.up, x, y) || inBox(boxes.down, x, y)
    const throneBox = layout.throne
      ? {
          x0: layout.throne.x - 2,
          x1: layout.throne.x + 2,
          y0: layout.throne.y - 1,
          y1: layout.throne.y
        }
      : null
    const fixed = (x, y) => inStairs(x, y) || inBox(throneBox, x, y)
    const rock = (x, y) => at(x, y) === '#'

    const pillars = []
    const lamps = []
    const bones = []
    const tombs = []
    const cells = (want) => {
      const found = []
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) if (want(x, y)) found.push({ x, y })
      }
      return found
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ch = at(x, y)
        if (fixed(x, y)) continue
        if (ch === '+') pillars.push({ x, y })
        else if (ch === '*') lamps.push({ x, y })
        else if (ch === '%' || ch === 'o') bones.push({ x, y, ch })
        else if (ch === '[' && at(x + 1, y) === '=' && at(x + 2, y) === ']') {
          tombs.push({ x: x + 1, y, x0: x, x1: x + 2 })
        }
      }
    }

    // Lo que tapa la vista de la camara: la roca, los pilares, las tumbas, los
    // huesos y lo que frena del arte de las escaleras y del trono. El agua no:
    // queda baja.
    const solid = (x, y) => !walk(x, y) && at(x, y) !== '~'
    // Un escalon: lo que se pisa dentro del arte, menos el piso suelto.
    const step = (box) => (x, y) => inBox(box, x, y) && walk(x, y) && at(x, y) !== ' '
    return {
      id: 'crypt-' + floor,
      kind: 'crypt',
      name: layout.name,
      width,
      height,
      rows: rows.slice(),
      tiles: cryptTiles(names),
      npcs: [],
      landmarks: [],
      start: [layout.up.x + 2, layout.up.y],
      // Desde donde mira la camara de tercera persona al llegar (grados desde el
      // sur, como runaView.frame): bajando, se llega junto al ^ contra la pared
      // del sur y la camara va al oeste mirando al piso; subiendo, se llega
      // junto a la v y va al noreste, mirando al suroeste.
      arrive: [
        { x: layout.up.x + 2, y: layout.up.y, azimuth: -75 },
        ...(layout.down ? [{ x: layout.down.x - 2, y: layout.down.y, azimuth: 135 }] : [])
      ],
      cripta: {
        floor,
        name: layout.name,
        stairStyle: layout.stairStyle,
        up: { ...layout.up },
        down: layout.down ? { ...layout.down } : null,
        throne: layout.throne ? { ...layout.throne } : null,
        // Las cajas del arte de las escaleras y del trono, y sus celdas que se
        // pisan (los escalones).
        stairs: {
          up: { ...boxes.up, steps: cells(step(boxes.up)) },
          down: boxes.down ? { ...boxes.down, steps: cells(step(boxes.down)) } : null
        },
        throneBox,
        // La roca en rectangulos (cada celda # en uno solo) y las caras que dan
        // al aire: solo esas llevan pared.
        rock: mergeRects(width, height, rock),
        faces: rockFaces(width, height, rock),
        // Lo que va en built.blocks para el brazo de la camara.
        blocks: mergeRects(width, height, solid),
        water: mergeRects(width, height, (x, y) => at(x, y) === '~'),
        bridges: mergeRects(width, height, (x, y) => at(x, y) === ':' && !fixed(x, y)),
        rotunda: mergeRects(width, height, (x, y) => at(x, y) === '.' && !fixed(x, y)),
        pillars,
        lamps,
        bones,
        tombs,
        spawnPoints: (layout.spawnPoints || []).map((p) => ({ ...p }))
      }
    }
  })
}

// Las medidas de la cripta en 3D, en metros: el alto de la pared de roca, el de
// cada escalon, el fondo de las cisternas y la superficie del agua.
export const CRYPT = { wall: 2.4, step: 0.3, basin: -0.45, water: -0.22 }

/**
 * El alto del piso de cada celda (indice y * width + x), en metros. La roca
 * lleva el alto de la pared; el agua, el fondo de la cisterna. La escalera de
 * subida sube un escalon por fila desde el ^ hasta el dintel; la de bajada baja
 * uno por fila desde la v. El resto de lo que no es roca queda en 0, que es
 * donde camina el heroe (la pagina no lo sube ni lo baja).
 */
export function cryptHeights(data) {
  const { width, height, rows } = data
  const plan = data.cripta
  const at = (x, y) => (rows[y] && rows[y][x]) || '#'
  const heights = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = at(x, y)
      heights[y * width + x] = ch === '#' ? CRYPT.wall : ch === '~' ? CRYPT.basin : 0
    }
  }
  const up = plan.stairs.up
  const down = plan.stairs.down
  for (const [box, rise] of [
    [up, (y) => (up.y1 - y) * CRYPT.step],
    [down, (y) => -(y - down.y0) * CRYPT.step]
  ]) {
    if (!box) continue
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const ch = at(x, y)
        if (ch !== ' ' && ch !== '#') heights[y * width + x] = rise(y)
      }
    }
  }
  return heights
}

// Si se ve la celda b desde la celda a sin cruzar roca (las dos puntas no
// cuentan): un paso por celda a lo largo de la recta.
export function cryptSees(data, a, b) {
  const rows = data.rows
  const dx = b.x - a.x
  const dy = b.y - a.y
  const n = Math.max(Math.abs(dx), Math.abs(dy))
  for (let i = 1; i < n; i++) {
    const x = Math.round(a.x + (dx * i) / n)
    const y = Math.round(a.y + (dy * i) / n)
    if (((rows[y] && rows[y][x]) || '#') === '#') return false
  }
  return true
}

const FACE_STEP = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }

/**
 * Las luces fijas de un piso, en metros (cx y cz: lo que mide una celda):
 *   brazier  un brasero de pie en cada lampara (*) del juego
 *   throne   los dos braseros verdes a los lados del trono
 *   arch     la luz de arriba que baja por la escalera de subida
 *   torch    antorchas de pared, repartidas con una semilla fija sobre las caras
 *            de roca que dan a piso libre, a `spacing` metros o mas de las demas
 * Cada una: { kind, x, y, z, cell: { x, y } (la celda libre desde donde se ve,
 * para la luz horneada), nx, nz (hacia donde mira, solo las de pared) }.
 */
export function cryptLights(data, { cx = 0.5, cz = 1, spacing = 6.5 } = {}) {
  const rows = data.rows
  const plan = data.cripta
  const at = (x, y) => (rows[y] && rows[y][x]) || '#'
  const mx = (x) => (x + 0.5) * cx
  const mz = (y) => (y + 0.5) * cz
  const lights = []
  for (const p of plan.lamps) {
    lights.push({ kind: 'brazier', x: mx(p.x), y: 1.25, z: mz(p.y), cell: { x: p.x, y: p.y } })
  }
  if (plan.throneBox) {
    const { x0, x1 } = plan.throneBox
    const y = plan.throne.y
    for (const x of [x0, x1]) {
      lights.push({ kind: 'throne', x: mx(x), y: 1.75, z: mz(y), cell: { x, y: y + 1 } })
    }
  }
  const up = plan.stairs.up
  lights.push({
    kind: 'arch',
    x: mx((up.x0 + up.x1) / 2 + 2),
    y: 2.6,
    z: mz(up.y0) + 0.3,
    cell: { x: plan.up.x + 2, y: up.y0 + 1 }
  })

  // Las antorchas: una por celda de cara candidata, en un orden que da la
  // semilla, y se queda si no hay otra luz cerca.
  const boxes = [plan.stairs.up, plan.stairs.down, plan.throneBox].filter(Boolean)
  const busy = (x, y) =>
    boxes.some((b) => x >= b.x0 - 1 && x <= b.x1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1)
  const plain = (x, y) => (at(x, y) === ' ' || at(x, y) === '.') && !busy(x, y)
  const candidates = []
  for (const face of plan.faces) {
    const [dx, dy] = FACE_STEP[face.side]
    const across = face.side === 'n' || face.side === 's'
    const length = across ? face.x1 - face.x0 + 1 : face.y1 - face.y0 + 1
    // Un tramo corto es una esquina o un diente de la roca: ahi no.
    if (length < (across ? 4 : 2)) continue
    for (let i = across ? 1 : 0; i < length - (across ? 1 : 0); i++) {
      const x = across ? face.x0 + i : face.x0
      const y = across ? face.y0 : face.y0 + i
      if (!plain(x + dx, y + dy)) continue
      // La pared esta en el borde de la celda de roca; la antorcha sale 0,3 m.
      const wallX = mx(x) + dx * (cx / 2)
      const wallZ = mz(y) + dy * (cz / 2)
      candidates.push({
        kind: 'torch',
        x: wallX + dx * 0.3,
        y: 1.75,
        z: wallZ + dy * 0.3,
        cell: { x: x + dx, y: y + dy },
        nx: dx,
        nz: dy,
        order: hashCell(x * 4 + 'nsew'.indexOf(face.side), y)
      })
    }
  }
  candidates.sort((a, b) => a.order - b.order)
  const far = (c) => lights.every((l) => Math.hypot(l.x - c.x, l.z - c.z) >= spacing)
  for (const c of candidates) {
    if (!far(c)) continue
    delete c.order
    lights.push(c)
  }
  return lights
}

function hashCell(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

// ---------------------------------------------------------------------------
// Los campamentos.

// Como meadowTiles de la pradera: el campamento va por buildWorld con el mismo
// vocabulario de suelo. Lo que frena es '&' (una losa baja debajo de la pieza).
function campTiles(names) {
  return {
    '`': { id: 'quiet-ground', name: names.ground || 'la tierra', solid: false },
    ',': { id: 'grass', name: names.grass || 'el pasto', solid: false },
    '.': { id: 'road', name: names.road || 'el camino', solid: false },
    '%': { id: 'gravel', name: names.fire || 'la grava', solid: false },
    '&': { id: 'rubble', name: names.solid || 'una empalizada', solid: true },
    U: { id: 'road', name: names.exit || 'la salida', solid: false }
  }
}

// Las carpas de campRows: el techo /^^^\ arriba, el piso \___/ tres filas mas
// abajo y el cartel en la fila de abajo del techo.
function campTents(rows) {
  const tents = []
  for (let y = 0; y < rows.length - 3; y++) {
    for (const match of rows[y].matchAll(/\/\^+\\/g)) {
      const x0 = match.index
      const x1 = x0 + match[0].length - 1
      if (rows[y + 3][x0] !== '\\' || rows[y + 3][x1] !== '/') continue
      const label = rows[y + 1].slice(x0 + 1, x1).trim()
      tents.push({
        x0,
        x1,
        y0: y,
        y1: y + 3,
        label,
        door: { x: Math.round((x0 + x1) / 2), y: y + 4 }
      })
    }
  }
  return tents
}

// Los tramos con cartel: ---[ empalizada ]--- y o== corral ==o.
function campSigns(rows) {
  const signs = []
  rows.forEach((row, y) => {
    for (const [kind, pattern] of [
      ['fence', /-{3}\[ ([^\]]+?) \]-{3}/g],
      ['pen', /o== (.+?) ==o/g]
    ]) {
      for (const match of row.matchAll(pattern)) {
        signs.push({
          kind,
          label: match[1],
          x0: match.index,
          x1: match.index + match[0].length - 1,
          y
        })
      }
    }
  })
  return signs
}

/**
 * Un campamento (un BarbarianCamp del juego) como datos de mapa. Va por
 * buildWorld: `rows` en el vocabulario del suelo de la pradera, con '&' en todo
 * lo que no se alcanza a pie. `campamento` es el plano para las piezas.
 */
export function campData(field, names = {}) {
  const layout = field.layout
  const camp = field.camp
  const key = ['camp', camp.id, names.key || ''].join('|')
  return remember(key, () => {
    const { width, height } = field
    const rows = layout.rows
    const at = (x, y) => (rows[y] && rows[y][x]) || '#'
    const walk = (x, y) => campWalkable(at(x, y))
    // Adentro de las carpas y de las cajas de empalizada se puede pisar, pero no
    // se llega: para el mapa 3D eso es parte de la pieza.
    const reached = reach(width, height, layout.spawn, walk)
    const open = (x, y) => !!reached[y * width + x]
    const road = (x, y) => at(x, y) === '.' || at(x, y) === 'U'

    const out = rows.map((row, y) =>
      Array.from({ length: width }, (_, x) => {
        if (!open(x, y)) return '&'
        const ch = at(x, y)
        if (ch === 'U') return 'U'
        if (ch === '.') return '.'
        if (ch === '*') return '%'
        return ch === ',' ? ',' : '`'
      }).join('')
    )

    // Las cajas de empalizada: las manchas de # que no tocan el borde.
    const ring = (x, y) => x === 0 || y === 0 || x === width - 1 || y === height - 1
    const palisades = []
    const taken = new Uint8Array(width * height)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (at(x, y) !== '#' || taken[y * width + x]) continue
        const box = { x0: x, x1: x, y0: y, y1: y }
        const queue = [[x, y]]
        taken[y * width + x] = 1
        while (queue.length) {
          const [cx, cy] = queue.pop()
          box.x0 = Math.min(box.x0, cx)
          box.x1 = Math.max(box.x1, cx)
          box.y0 = Math.min(box.y0, cy)
          box.y1 = Math.max(box.y1, cy)
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1]
          ]) {
            const nx = cx + dx
            const ny = cy + dy
            if (ring(nx, ny) || at(nx, ny) !== '#' || taken[ny * width + nx]) continue
            taken[ny * width + nx] = 1
            queue.push([nx, ny])
          }
        }
        palisades.push(box)
      }
    }

    // El fuego: las brasas (*) y lo que las rodea en el arte.
    const embers = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) if (at(x, y) === '*') embers.push({ x, y })
    }
    const fire = embers.length
      ? {
          x: embers.reduce((s, p) => s + p.x, 0) / embers.length,
          y: embers.reduce((s, p) => s + p.y, 0) / embers.length,
          embers
        }
      : null

    const exit = { ...layout.exit }
    // El nombre escrito en la fila 2 (asentamiento <nombre>): letras que frenan.
    const titleText = 'asentamiento ' + camp.name
    const titleRow = rows.findIndex((row) => row.includes(titleText))
    const title =
      titleRow < 0
        ? null
        : {
            x0: rows[titleRow].indexOf(titleText),
            x1: rows[titleRow].indexOf(titleText) + titleText.length - 1,
            y: titleRow
          }
    return {
      id: 'camp:' + camp.id,
      kind: 'camp',
      name: 'asentamiento ' + camp.name,
      width,
      height,
      rows: out,
      tiles: campTiles(names),
      npcs: [],
      landmarks: [],
      start: [layout.spawn.x, layout.spawn.y],
      // Al entrar, la camara de tercera persona va al sur del heroe, del lado
      // del porton (lo ve por el hueco), y mira al norte, hacia el campamento.
      arrive: [{ x: layout.spawn.x, y: layout.spawn.y, azimuth: 0 }],
      campamento: {
        id: camp.id,
        name: camp.name,
        reward: camp.reward,
        exit,
        spawn: { ...layout.spawn },
        // El porton: el arco de la salida, tres filas sobre la U.
        gate: { x0: exit.x - 5, x1: exit.x + 5, y0: exit.y - 2, y1: exit.y, exit },
        wall: { x0: 0, y0: 0, x1: width - 1, y1: height - 1 },
        title,
        spikes: [...(rows[1] || '')].flatMap((ch, x) => (ch === '^' ? [x] : [])),
        tents: campTents(rows),
        palisades,
        signs: campSigns(rows),
        fire,
        roads: mergeRects(width, height, (x, y) => open(x, y) && road(x, y)),
        // Lo que va en built.blocks: todo lo que no se alcanza, menos el borde.
        blocks: mergeRects(width, height, (x, y) => !ring(x, y) && !open(x, y)),
        spawnPoints: (layout.spawnPoints || []).map((p) => ({ ...p }))
      }
    }
  })
}
