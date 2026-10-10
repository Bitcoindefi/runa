// La pradera en 3D y el combate en el mapa.
//
// La pagina (tripo-heroe.html) la arma una vez con createMeadow(ctx) y la usa en
// la partida y en el recorrido libre. Devuelve null si no dibuja nada: entonces
// la pradera sigue en la pantalla de texto del juego, como hasta ahora.
//
// Recibe `ctx`: scene, camera, hero (el stickman y el heroe de Tripo), CX y CZ
// (lo que mide una celda), session() (la partida en marcha de juego.js, o null
// en el recorrido), bundle() (el modulo juego.js, o null si no cargo), figure(color)
// (una figura simple), label(texto) del mundo, text(nombre) (traduce) y L(en, es)
// (los textos propios en el idioma elegido).
//
// Devuelve:
//   provide(id)       los datos de un mapa que no viene del visor (como
//                     /world/<id>.json: width, height, rows, tiles, npcs...), por
//                     ejemplo 'field'; null si ese mapa no es suyo
//   worldAt(st)       { map, x, y } donde va el heroe cuando la partida esta en
//                     una zona sin mapa fijo (st es runaPage().live); null si no
//                     la dibuja en 3D
//   handlesCombat(st) true si el combate de ese momento se ve en 3D (la pagina no
//                     abre la pantalla de texto)
//   update(time, dt, st, world)  cada cuadro mientras se ve un mapa suyo:
//                     monstruos, golpes, numeros de dano (st es null en el
//                     recorrido; world es { map, built, data } de la pagina)
//   leave(mapId)      la pagina deja de mostrar el mapa mapId (cualquiera): si
//                     era suyo, sacar lo que agrego
//
// Las reglas son las del juego: la pradera es el Field de lib/field.js (el de la
// partida, o uno con semilla fija en el recorrido), los choques y los golpes los
// decide el juego y aca solo se dibuja lo que dice. worldAt ademas deja la celda
// en st.world, como los mapas fijos: asi la pagina camina en 8 direcciones y Tab
// muestra la pantalla de texto tambien en la pradera.
//
// Como se arma: el suelo sale de fieldGroundAt y va por buildWorld como cualquier
// mapa; los lugares (portones, cabana, cartel, cripta, portal, empalizadas) son
// mallas propias juntas en pocas geometrias, y los monstruos van con
// InstancedMesh por tipo: cada tipo cuesta una o dos llamadas de dibujo.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { document, performance } = globalThis

// La semilla de la pradera del recorrido: siempre la misma, como un mapa fijo.
const TOUR_SEED = 2026
// Una celda mide CX de ancho y CZ de fondo (tripo-mundo.js); createMeadow los
// toma de la pagina.
let CX = 0.5
let CZ = 1
const wx = (x) => (x + 0.5) * CX
const wz = (y) => (y + 0.5) * CZ

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

// ---------------------------------------------------------------------------
// El mapa: el suelo del juego en el vocabulario de tripo-mundo.js.

// Como la tabla TILES del juego. `solid` solo frena en el recorrido libre: en
// la partida, los choques los decide el juego.
function meadowTiles(names) {
  return {
    '`': { id: 'quiet-ground', name: 'el pasto', solid: false },
    ',': { id: 'grass', name: 'el pasto', solid: false },
    '"': { id: 'tall-grass', name: 'el pasto alto', solid: false },
    '*': { id: 'flower', name: 'unas flores', solid: false },
    '.': { id: 'road', name: 'el camino', solid: false },
    '%': { id: 'gravel', name: 'la grava', solid: false },
    ';': { id: 'cobble', name: 'los adoquines', solid: false },
    '=': { id: 'flagstone', name: 'las losas', solid: false },
    o: { id: 'rock', name: 'una piedra', solid: true },
    t: { id: 'tree', name: 'un arbol', solid: true },
    // Lo que tapa una pieza dibujada aca (la empalizada, la cabana, un menhir):
    // debajo queda una losa baja.
    '&': { id: 'rubble', name: names.solid, solid: true },
    '<': {
      id: 'gate.city',
      name: names.runa,
      solid: false,
      enter: { kind: 'travel', to: 'city' }
    },
    N: { id: 'gate.nox', name: names.nox, solid: false, enter: { kind: 'travel', to: 'nox' } },
    X: { id: 'gate.crypt', name: names.crypt, solid: false, enter: { kind: 'crypt' } },
    O: {
      id: 'gate.portal',
      name: names.portal,
      solid: false,
      enter: { kind: 'travel', to: 'boss' }
    }
  }
}

// El suelo de fieldGroundAt en el de la vista 3D: el camino de tierra es ':' en
// la terminal y '.' en el mundo; el '.' del anillo cercano es pasto.
const SOIL = { ':': '.', '%': '%', ',': ',', '"': '"', '*': '*', o: 'o', '.': ',' }

// Ruido suave de valor en celdas de `size`: manchas que no siguen la grilla.
function smoothNoise(x, y, size, seed) {
  const fx = x / size
  const fy = y / size
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const at = (a, b) => hash(a + seed * 131, b - seed * 71)
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx
  return top + (bottom - top) * sy
}

// Las celdas de un arte anclado como lo pinta Field.render: la celda (col, row)
// del arte cae en `point`. visit(x, y, ch) por cada celda dentro del mapa.
function eachArt(width, height, art, point, anchorRow, anchorCol, visit) {
  for (let sy = 0; sy < art.length; sy++) {
    const line = art[sy]
    for (let sx = 0; sx < line.length; sx++) {
      const x = point.x + sx - anchorCol
      const y = point.y + sy - anchorRow
      if (x >= 0 && y >= 0 && x < width && y < height) visit(x, y, line[sx])
    }
  }
}

// Cuanto falta, en celdas visuales (una fila vale dos columnas, Y_SCALE), hasta
// el camino: 0 sobre el camino, hasta `cap` lejos. Sale del suelo del juego, asi
// no se copia la geometria de los caminos: el camino es ':' (la grava '%' del
// camino queda adentro de esa banda; la suelta del yermo no es camino).
function roadField(ground, width, height, cap = 6) {
  const far = new Float32Array(width * height).fill(cap)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ground[y * width + x] !== ':') continue
      for (let dy = -3; dy <= 3; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -cap; dx <= cap; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const d = Math.hypot(dx, dy * 2)
          const i = ny * width + nx
          if (d < far[i]) far[i] = d
        }
      }
    }
  }
  return far
}

// La pradera de un Field como datos de mapa (/world/<id>.json): el suelo de
// fieldGroundAt y, encima, el piso de cada lugar y lo que frena en el recorrido.
// Las piezas (portones, cabana, cripta, portal, empalizadas) las dibuja este
// modulo con `meadow`, el plano de donde va cada una.
function meadowMap(kit, field, names) {
  const { width, height } = field
  const ground = new Array(width * height)
  const rows = Array.from({ length: height }, () => new Array(width).fill('`'))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = kit.groundAt(field, x, y)
      ground[y * width + x] = ch
      rows[y][x] = SOIL[ch] || '`'
    }
  }
  const road = roadField(ground, width, height)
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height
  const put = (x, y, ch) => {
    if (inside(x, y)) rows[y][x] = ch
  }
  const away = (x, y) => (inside(x, y) ? road[y * width + x] : 0)

  // El yermo del este se seca: manchas grandes de tierra pelada, cada vez mas
  // hacia NOX, alisadas para que no queden celdas sueltas. Las pizcas de grava
  // que el juego siembra lejos del camino quedan como pasto, y en el anillo
  // cercano crecen matas de flores.
  const dry = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rows[y][x] === '%' && away(x, y) > 1.5) rows[y][x] = ','
      const k = Math.min(1, Math.max(0, (x - 96) / 80))
      if (k > 0 && away(x, y) >= 2.5 && smoothNoise(x, y * 2, 13, 3) > 0.8 - k * 0.12) {
        dry[y * width + x] = 1
      }
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const was = dry.slice()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (inside(x + dx, y + dy) && was[(y + dy) * width + x + dx]) n++
          }
        }
        dry[y * width + x] = n >= 5 ? 1 : 0
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x]
      if (ch !== '`' && ch !== ',') continue
      if (dry[y * width + x]) rows[y][x] = '.'
      else if (x < 80 && away(x, y) >= 3 && smoothNoise(x, y * 2, 5, 8) > 0.86) rows[y][x] = '*'
    }
  }

  const gate = { ...field.gate }
  const nox = { ...field.noxGate }
  const crypt = { ...field.dungeonEntrance }
  const portal = { ...field.worldBossPortal }
  // Los lugares fijos de Field.render: el cruce y el puesto del guardabosques.
  const crossroads = { x: 66, y: gate.y }
  const ranger = { x: 50, y: 33 }

  // Un rectangulo de un suelo: en la grilla de la terminal los bordes rectos se
  // ven prolijos y los redondos, en escalera.
  const yard = (x0, x1, y0, y1, ch) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, ch)
  }
  // Un patio de adoquines frente al porton de RUNA y uno de losas oscuras
  // frente al de NOX, con el camino empedrado que sale de cada uno.
  yard(0, 8, gate.y - 4, gate.y + 4, ';')
  yard(9, 21, gate.y - 1, gate.y + 1, ';')
  yard(width - 9, width - 1, nox.y - 4, nox.y + 4, '=')
  yard(width - 22, width - 10, nox.y - 1, nox.y + 1, '=')

  // La cabana del guardabosques (la mitad de su arte) y su escalon.
  const cabin = { x0: ranger.x - 7, x1: ranger.x + 2, y0: ranger.y - 3, y1: ranger.y }
  for (let y = cabin.y0; y <= cabin.y1; y++) {
    for (let x = cabin.x0; x <= cabin.x1; x++) put(x, y, '&')
  }
  for (let x = ranger.x - 4; x <= ranger.x - 1; x++) put(x, ranger.y + 1, ';')
  // El poste del cruce, al sur del camino, entre "portal" y "cripta".
  const post = { x: crossroads.x, y: crossroads.y + 2 }
  put(post.x, post.y, '&')

  // La cripta: el mausoleo al noreste de la puerta X (afuera del camino), losas
  // y braseros junto a la escalera, lapidas en el resto del arte.
  const tomb = { x0: crypt.x + 3, x1: crypt.x + 13, y0: crypt.y - 8, y1: crypt.y - 3 }
  yard(crypt.x - 4, crypt.x + 5, crypt.y - 1, crypt.y + 2, '=')
  for (let y = tomb.y0; y <= tomb.y1; y++) for (let x = tomb.x0; x <= tomb.x1; x++) put(x, y, '&')
  const braziers = [
    { x: crypt.x - 3, y: crypt.y + 1 },
    { x: crypt.x + 3, y: crypt.y + 1 }
  ]
  for (const b of braziers) put(b.x, b.y, '&')
  const graves = []
  for (let y = crypt.y - 9; y <= crypt.y + 3; y++) {
    for (let x = crypt.x - 15; x <= crypt.x + 17; x++) {
      if (!inside(x, y) || away(x, y) < 3.4) continue
      if (x >= tomb.x0 - 1 && x <= tomb.x1 + 1 && y >= tomb.y0 - 1 && y <= tomb.y1 + 1) continue
      if (Math.abs(x - crypt.x) < 5 && Math.abs(y - crypt.y) < 3) continue
      if (hash(x * 7, y * 13) > 0.09) continue
      if (graves.some((g) => Math.abs(g.x - x) < 3 && Math.abs(g.y - y) < 2)) continue
      graves.push({ x, y, k: hash(x, y) })
      put(x, y, '&')
    }
  }

  // El portal: menhires en circulo, salvo donde llega el camino, y dos
  // cristales como los <> del arte. El piso redondo de losas es una malla
  // (buildLandmarks): en la grilla saldria en escalera.
  const stones = []
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13
    const x = Math.round(portal.x + Math.cos(a) * 10.5)
    const y = Math.round(portal.y + Math.sin(a) * 5.2)
    if (!inside(x, y) || away(x, y) < 3.2) continue
    stones.push({ x, y, k: hash(x, y) })
    put(x, y, '&')
  }
  const crystals = [
    { x: portal.x - 7, y: portal.y - 3 },
    { x: portal.x + 7, y: portal.y - 3 }
  ]
  for (const c of crystals) put(c.x, c.y, '&')

  // Las empalizadas frenan en el juego (settlementStructureAt): ahi va la losa;
  // adentro, tierra pisada.
  const camps = []
  for (const settlement of field.settlements) {
    const art = kit.camp(settlement.name)
    const row = art.findIndex((line) => line.includes('J'))
    const col = art[row].indexOf('J')
    eachArt(width, height, art, settlement, row, col, (x, y, ch) => {
      put(x, y, ch === ' ' ? '.' : '&')
    })
    camps.push({
      id: settlement.id,
      name: settlement.name,
      x: settlement.x,
      y: settlement.y,
      // Donde cae la columna 0 y la fila 0 del arte.
      left: settlement.x - col,
      top: settlement.y - row
    })
  }

  // Las puertas del juego, en su celda.
  put(gate.x, gate.y, '<')
  put(nox.x, nox.y, 'N')
  put(crypt.x, crypt.y, 'X')
  put(portal.x, portal.y, 'O')

  return {
    id: 'field',
    kind: 'map',
    name: 'pradera',
    width,
    height,
    rows: rows.map((line) => line.join('')),
    tiles: meadowTiles(names),
    npcs: field.guides.map((guide) => ({
      id: guide.id,
      name: guide.name,
      role: guide.role,
      line: guide.line,
      // El dibujo de tunica verde y morral: el de una guardabosques.
      kind: 'resident',
      action: null,
      x: guide.x,
      y: guide.y,
      color: 'green'
    })),
    landmarks: [],
    // Donde arranca el recorrido: al lado del porton de RUNA, como en la partida.
    start: [gate.x + 1, gate.y],
    meadow: {
      width,
      height,
      gate,
      nox,
      crypt,
      portal,
      crossroads,
      ranger,
      cabin,
      post,
      tomb,
      braziers,
      graves,
      stones,
      crystals,
      camps,
      guides: field.guides.map(({ name, x, y }) => ({ name, x, y }))
    }
  }
}

// ---------------------------------------------------------------------------
// Piezas: geometria sin indices con color y brillo por vertice, para juntar
// muchas en una sola malla (un dibujado).

const M4 = new THREE.Matrix4()
const Q4 = new THREE.Quaternion()
const E3 = new THREE.Euler()
const V3 = new THREE.Vector3()
const S3 = new THREE.Vector3()

function piece(geometry, hex, glow = 0) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position') g.deleteAttribute(name)
  }
  g.computeVertexNormals()
  const n = g.attributes.position.count
  const color = new THREE.Color(hex)
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1))
  return g
}

// Lleva una pieza a su lugar: posicion, giro en x, y, z (en ese orden) y escala.
function place(g, x, y, z, o = {}) {
  E3.set(o.rx || 0, o.ry || 0, o.rz || 0)
  Q4.setFromEuler(E3)
  const sx = o.sx === undefined ? 1 : o.sx
  const sy = o.sy === undefined ? sx : o.sy
  const sz = o.sz === undefined ? sx : o.sz
  M4.compose(V3.set(x, y, z), Q4, S3.set(sx, sy, sz))
  g.applyMatrix4(M4)
  return g
}

// Un juego de piezas que termina en una geometria. `o` lleva el giro (rx, ry,
// rz), la escala (sx, sy, sz) y el brillo (glow) de cada pieza.
class Kit {
  constructor() {
    this.parts = []
  }

  add(geometry, hex, x, y, z, o = {}) {
    const g = place(piece(geometry, hex, o.glow || 0), x, y, z, o)
    this.parts.push(g)
    return g
  }

  box(w, h, d, x, y, z, hex, o) {
    return this.add(new THREE.BoxGeometry(w, h, d), hex, x, y, z, o)
  }

  cyl(top, bottom, h, segments, x, y, z, hex, o) {
    return this.add(new THREE.CylinderGeometry(top, bottom, h, segments), hex, x, y, z, o)
  }

  cone(r, h, segments, x, y, z, hex, o) {
    return this.add(new THREE.ConeGeometry(r, h, segments), hex, x, y, z, o)
  }

  ball(r, x, y, z, hex, o = {}) {
    const detail = o.detail === undefined ? 1 : o.detail
    return this.add(new THREE.IcosahedronGeometry(r, detail), hex, x, y, z, o)
  }

  // Un palo de a hacia b (puntos [x, y, z]) de radio r, que se afina a `tip`.
  stick(a, b, r, hex, o = {}) {
    const from = new THREE.Vector3(...a)
    const to = new THREE.Vector3(...b)
    const tip = o.tip === undefined ? r : o.tip
    const g = piece(
      new THREE.CylinderGeometry(tip, r, from.distanceTo(to), o.segments || 5),
      hex,
      o.glow || 0
    )
    Q4.setFromUnitVectors(V3.set(0, 1, 0), to.clone().sub(from).normalize())
    M4.compose(from.clone().add(to).multiplyScalar(0.5), Q4, S3.set(1, 1, 1))
    g.applyMatrix4(M4)
    this.parts.push(g)
    return g
  }

  geometry() {
    return this.parts.length ? mergeGeometries(this.parts) : null
  }
}

// Material con color por vertice y brillo propio: el atributo `glow` suma luz
// emitida del mismo color (ventanas, runas, ojos). `pulse` es un uniform que lo
// multiplica, para lo que late.
function glowMaterial(options = {}, pulse = null) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    ...options
  })
  material.onBeforeCompile = (shader) => {
    if (pulse) shader.uniforms.glowPulse = pulse
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float glow;\nvarying float vGlow;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vGlow;' + (pulse ? '\nuniform float glowPulse;' : '')
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow' +
          (pulse ? ' * glowPulse;' : ';')
      )
  }
  material.customProgramCacheKey = () => (pulse ? 'runa-glow-pulse' : 'runa-glow')
  return material
}

// Llamas: color por vertice, se suman a lo de atras y tiemblan con el reloj. El
// atributo `glow` dice que tan arriba de su llama esta cada vertice.
function flameMaterial(clock) {
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.clock = clock
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float clock;\nattribute float glow;\nvarying float vFlick;'
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float seed = position.x * 2.3 + position.z * 3.1;
        transformed.x += sin( clock * 9.0 + seed ) * 0.05 * glow;
        transformed.z += cos( clock * 7.0 + seed ) * 0.05 * glow;
        transformed.y += sin( clock * 11.0 + seed * 1.7 ) * 0.06 * glow;
        vFlick = 0.8 + 0.25 * sin( clock * 13.0 + seed * 3.0 );`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlick;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb *= vFlick;'
      )
  }
  material.customProgramCacheKey = () => 'runa-flame'
  return material
}

// Una llama de alto h en (x, y, z): dos conos, rojo afuera y amarillo adentro.
// tint cambia los colores (verde en la cripta, turquesa en NOX).
function flame(kit, x, y, z, h, tint = null) {
  const low = tint ? tint[0] : 0xffd27a
  const high = tint ? tint[1] : 0xff5a1a
  for (const [r, k, c] of [
    [0.16, 1, high],
    [0.1, 0.65, low]
  ]) {
    const tall = h * k
    const g = piece(new THREE.ConeGeometry(r * (h / 0.6), tall, 6, 1, true), c, 0)
    const position = g.attributes.position
    const glow = g.attributes.glow
    for (let i = 0; i < position.count; i++) glow.setX(i, (position.getY(i) + tall / 2) / tall)
    kit.parts.push(place(g, x, y + tall / 2, z))
  }
}

// ---------------------------------------------------------------------------
// Los lugares de la pradera.

const LOOK = {
  runa: {
    stone: 0xd6c39b,
    dark: 0xa8946c,
    roof: 0xa8462c,
    banner: 0xb8362a,
    emblem: 0xe7b84a,
    glow: 0xffb050,
    beyond: 0x8a6a3a
  },
  nox: {
    stone: 0x3d3849,
    dark: 0x262230,
    roof: 0x1f2838,
    banner: 0x5b2f9e,
    emblem: 0x5fe8c8,
    glow: 0x8f6bff,
    beyond: 0x3a2a6a
  }
}
const WOOD = 0x6b4a2c
const WOOD_DARK = 0x4a3220
const IRON = 0x3c3c40
const BONE = 0xe8e2cc

// Una muralla de reino a lo largo del borde del mapa (oeste para RUNA, este
// para NOX), con torres y el porton en la fila de la puerta del juego. Queda
// toda afuera del mapa: el heroe nunca la atraviesa.
function kingdomWall(kit, flames, layout, side) {
  const look = LOOK[side]
  const west = side === 'runa'
  const W = layout.width * CX
  const H = layout.height * CZ
  const door = west ? layout.gate : layout.nox
  const gz = wz(door.y)
  const thick = 1.8
  // La cara de la muralla que mira a la pradera, y hacia donde queda afuera.
  const face = west ? -1.0 : W + 1.0
  const out = west ? -1 : 1
  const cx = face + (out * thick) / 2
  const tall = 5.4
  const open = 1.7
  const tower = open + 3.2
  const lo = -16
  const hi = H + 16
  // Panos por tramos de 4 m, cada uno de un tono apenas distinto, con almenas
  // del lado de la pradera y el camino de ronda arriba.
  for (const [a, b] of [
    [lo, gz - tower - 1.4],
    [gz + tower + 1.4, hi]
  ]) {
    for (let z = a; z < b; z += 4) {
      const end = Math.min(b, z + 4)
      const tone = new THREE.Color(look.stone).offsetHSL(
        0,
        0,
        (hash(Math.round(z), 7) - 0.5) * 0.06
      )
      kit.box(thick, tall, end - z, cx, tall / 2, (z + end) / 2, tone.getHex())
      for (let m = z + 0.4; m < end - 0.3; m += 1.3) {
        kit.box(0.5, 0.7, 0.7, face + out * 0.25, tall + 0.35, m + 0.35, look.dark)
      }
    }
    kit.box(thick - 0.5, 0.12, b - a, cx + out * 0.2, tall + 0.06, (a + b) / 2, look.dark)
  }
  // Torres redondas: el par del porton y una cada 22 m, apoyadas por fuera.
  const towers = [gz - tower, gz + tower]
  for (let z = gz - 22; z > lo + 3; z -= 22) towers.push(z)
  for (let z = gz + 22; z < hi - 3; z += 22) towers.push(z)
  towers.forEach((z, i) => {
    const big = i < 2
    const r = big ? 1.9 : 1.5
    const h = big ? 6.6 : 6.4
    const tx = face + out * (r + 0.1)
    kit.cyl(r, r + 0.15, h, 14, tx, h / 2, z, look.stone)
    kit.cyl(r + 0.25, r + 0.25, 0.3, 14, tx, h - 0.15, z, look.dark)
    if (west) kit.cone(r + 0.4, big ? 3.2 : 2.8, 14, tx, h + (big ? 1.6 : 1.4), z, look.roof)
    else {
      kit.cone(r + 0.3, big ? 5.4 : 4.6, 8, tx, h + (big ? 2.7 : 2.3), z, look.roof)
      // Las vetas que brillan en NOX, del lado de la pradera.
      for (const turn of [-0.6, 0, 0.6]) {
        const a = Math.PI + turn
        kit.box(
          0.09,
          h - 1.4,
          0.09,
          tx + Math.cos(a) * (r + 0.04),
          (h - 1.4) / 2 + 0.5,
          z + Math.sin(a) * (r + 0.04),
          look.emblem,
          { glow: 1.4 }
        )
      }
    }
    // Una ventana encendida del lado de la pradera.
    kit.box(0.14, 0.8, 0.45, tx - out * r, h * 0.62, z, look.glow, { glow: 1.1 })
    if (big) {
      // El estandarte colgado frente a la torre, con su emblema.
      const surface = tx - out * (r + 0.05)
      kit.box(0.06, 2.8, 1.1, surface, 4.6, z, look.banner)
      kit.box(0.07, 0.6, 0.5, surface - out * 0.01, 4.9, z, look.emblem, { glow: 0.35 })
      kit.box(0.06, 0.12, 1.25, surface, 6.05, z, WOOD_DARK)
    }
  })
  // El porton: el arco, las dovelas, el rastrillo levantado y, al fondo, la luz
  // de la ciudad (o la violeta de NOX).
  const half = tower - 0.2
  const shape = new THREE.Shape()
  shape.moveTo(-half, 0)
  shape.lineTo(half, 0)
  shape.lineTo(half, tall + 0.4)
  shape.lineTo(-half, tall + 0.4)
  shape.lineTo(-half, 0)
  const hole = new THREE.Path()
  hole.moveTo(-open, 0)
  hole.lineTo(-open, 2.2)
  hole.absarc(0, 2.2, open, Math.PI, 0, true)
  hole.lineTo(open, 0)
  hole.lineTo(-open, 0)
  shape.holes.push(hole)
  const depth = thick + 0.2
  const arch = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 })
  // El dibujo va en x, y; girado, su x queda a lo largo de la muralla (z del
  // mundo) y la extrusion la atraviesa.
  kit.add(arch, look.stone, face - out * 0.1, 0, gz, { ry: west ? -Math.PI / 2 : Math.PI / 2 })
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI - (i / 8) * Math.PI
    kit.box(
      0.14,
      0.45,
      0.3,
      face - out * 0.16,
      2.2 + Math.sin(a) * (open + 0.13),
      gz + Math.cos(a) * (open + 0.13),
      look.dark,
      { rx: Math.PI / 2 - a }
    )
  }
  for (let i = -3; i <= 3; i++) {
    kit.box(0.08, 1.3, 0.08, cx, 3.35, gz + i * 0.48, IRON)
    kit.cone(0.06, 0.18, 4, cx, 2.62, gz + i * 0.48, IRON, { rx: Math.PI })
  }
  kit.box(0.08, 0.1, open * 2, cx, 3.0, gz, IRON)
  kit.box(0.2, 3.9, open * 2 + 0.2, face + out * (thick - 0.1), 1.95, gz, look.beyond, {
    glow: west ? 0.55 : 0.8
  })
  // El umbral: las losas del camino siguen bajo el arco hasta el borde del mapa.
  const edge = west ? 0 : W
  const deep = Math.abs(face - edge) + thick
  kit.box(
    deep,
    0.05,
    open * 2 + 0.6,
    edge + (out * deep) / 2,
    0.025,
    gz,
    west ? 0x8f897b : 0x3e3a46
  )
  // Antorchas a los lados del arco.
  for (const z of [gz - open - 0.6, gz + open + 0.6]) {
    kit.box(0.12, 0.5, 0.12, face - out * 0.2, 2.7, z, IRON)
    flames.push([face - out * 0.24, 2.95, z, 0.5, west ? null : [0xa0fff0, 0x3fc8b0]])
  }
}

// La cabana del puesto del guardabosques: troncos, techo a dos aguas, la
// puerta al camino, el pizarron de mapas, un farol y la lena.
function rangerCabin(kit, flames, layout) {
  const { cabin, ranger } = layout
  const x0 = cabin.x0 * CX + 0.1
  const x1 = (cabin.x1 + 1) * CX - 0.1
  const z0 = cabin.y0 * CZ + 0.3
  const z1 = (cabin.y1 + 1) * CZ - 0.2
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const w = x1 - x0
  const d = z1 - z0
  const logs = 8
  const r = 0.14
  kit.box(w + 0.3, 0.18, d + 0.3, cx, 0.09, cz, 0x5a4634)
  for (let i = 0; i < logs; i++) {
    const y = 0.25 + i * r * 1.85
    const tone = i % 2 ? WOOD : 0x7a5634
    kit.cyl(r, r, w + 0.3, 7, cx, y, z0, tone, { rz: Math.PI / 2 })
    kit.cyl(r, r, w + 0.3, 7, cx, y, z1, tone, { rz: Math.PI / 2 })
    kit.cyl(r, r, d + 0.3, 7, x0, y + r * 0.9, cz, tone, { rx: Math.PI / 2 })
    kit.cyl(r, r, d + 0.3, 7, x1, y + r * 0.9, cz, tone, { rx: Math.PI / 2 })
  }
  const wall = 0.25 + logs * r * 1.85
  // Los hastiales y el techo de tejuelas verdes, con alero y cumbrera.
  const rise = 1.5
  for (const x of [x0, x1]) {
    const gable = new THREE.Shape()
    gable.moveTo(-d / 2, 0)
    gable.lineTo(d / 2, 0)
    gable.lineTo(0, rise)
    gable.lineTo(-d / 2, 0)
    kit.add(
      new THREE.ExtrudeGeometry(gable, { depth: 0.24, bevelEnabled: false }),
      0x7a5634,
      x - 0.12,
      wall,
      cz,
      { ry: Math.PI / 2 }
    )
  }
  const slope = Math.atan2(rise, d / 2)
  const span = Math.hypot(rise, d / 2) + 0.45
  for (const side of [-1, 1]) {
    kit.box(w + 0.9, 0.16, span, cx, wall + rise / 2 + 0.08, cz + side * (d / 4 + 0.08), 0x3f5a36, {
      rx: side * slope
    })
  }
  kit.box(w + 0.95, 0.14, 0.22, cx, wall + rise + 0.1, cz, 0x2f4428)
  kit.box(0.5, 1.6, 0.5, x0 + 0.6, wall + rise * 0.55, cz - 0.4, 0x7a746a)
  // La puerta y la ventana en la fachada sur, y el farol encendido.
  const door = wx(ranger.x - 2.5)
  kit.box(0.95, 1.75, 0.1, door, 0.95, z1 + 0.12, WOOD_DARK)
  kit.box(0.08, 0.08, 0.06, door + 0.3, 1.0, z1 + 0.2, 0xd8b050)
  kit.box(0.7, 0.55, 0.08, cx - 1.4, 1.35, z1 + 0.14, 0xffc879, { glow: 0.9 })
  kit.box(0.82, 0.08, 0.14, cx - 1.4, 1.05, z1 + 0.16, WOOD)
  kit.box(0.08, 2.1, 0.08, door - 0.75, 1.05, z1 + 0.5, WOOD_DARK)
  kit.box(0.22, 0.28, 0.22, door - 0.75, 2.2, z1 + 0.5, IRON)
  flames.push([door - 0.75, 2.12, z1 + 0.5, 0.22, null])
  // El pizarron de mapas, con un pergamino.
  const board = wx(ranger.x + 0.5)
  for (const dx of [-0.55, 0.55]) kit.box(0.09, 1.6, 0.09, board + dx, 0.8, z1 + 1.0, WOOD_DARK)
  kit.box(1.3, 0.85, 0.07, board, 1.25, z1 + 1.0, WOOD)
  kit.box(1.05, 0.62, 0.02, board, 1.25, z1 + 1.045, 0xe6d6a8)
  kit.box(0.5, 0.05, 0.01, board - 0.15, 1.35, z1 + 1.06, 0x8a5a3a)
  kit.box(0.04, 0.4, 0.01, board + 0.2, 1.22, z1 + 1.06, 0x4a7a4a)
  // La lena junto a la pared oeste y un banderin verde.
  for (let i = 0; i < 7; i++) {
    kit.cyl(
      0.11,
      0.11,
      0.9,
      6,
      x0 - 0.35,
      0.12 + Math.floor(i / 3) * 0.2,
      z0 + 0.6 + (i % 3) * 0.23,
      0x8a6a42,
      { rx: Math.PI / 2 }
    )
  }
  kit.box(0.06, 3.2, 0.06, x1 + 0.4, 1.6, z1 - 0.2, WOOD_DARK)
  kit.box(0.04, 0.45, 0.75, x1 + 0.4, 2.9, z1 + 0.2, 0x3f7a3a)
}

// El poste del cruce con sus cuatro flechas: a RUNA, a NOX, al portal y a la
// cripta, cada una con la punta del color de su lugar.
function signpost(kit, layout) {
  const { post } = layout
  const x = wx(post.x)
  const z = wz(post.y)
  kit.box(0.18, 2.6, 0.18, x, 1.3, z, WOOD_DARK)
  kit.cone(0.16, 0.25, 4, x, 2.72, z, WOOD_DARK, { ry: Math.PI / 4 })
  const aim = (to) => Math.atan2(-(wz(to.y) - z), wx(to.x) - x)
  for (const [a, y, tip] of [
    [aim(layout.gate), 2.25, 0xe0c060],
    [aim(layout.nox), 2.0, 0x8f6bff],
    [aim(layout.portal), 1.75, 0xb07aff],
    [aim(layout.crypt), 1.5, 0x7ad08a]
  ]) {
    const cos = Math.cos(a)
    const sin = -Math.sin(a)
    kit.box(1.05, 0.2, 0.05, x + cos * 0.55, y, z + sin * 0.55, 0x9a7448, { ry: a })
    kit.cone(0.16, 0.26, 3, x + cos * 1.18, y, z + sin * 1.18, tip, {
      rz: -Math.PI / 2,
      ry: a,
      sz: 0.3
    })
  }
}

// La cripta: un mausoleo al noreste de la puerta, la escalera que baja en la
// celda X con braseros de fuego verde, lapidas y una calavera de piedra.
function cryptRuins(kit, flames, layout) {
  const { tomb, crypt } = layout
  const stone = 0x7d8278
  const dark = 0x4c514b
  const x0 = tomb.x0 * CX + 0.2
  const x1 = (tomb.x1 + 1) * CX - 0.2
  const z0 = tomb.y0 * CZ + 0.4
  const z1 = (tomb.y1 + 1) * CZ - 0.2
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const w = x1 - x0
  const d = z1 - z0
  // Zocalo, cuerpo y cornisa.
  kit.box(w + 0.6, 0.4, d + 0.6, cx, 0.2, cz, dark)
  kit.box(w, 3.2, d, cx, 2.0, cz, stone)
  kit.box(w + 0.35, 0.3, d + 0.35, cx, 3.65, cz, dark)
  // Techo a dos aguas de pizarra, con el hastial al frente (sur).
  const rise = 1.6
  const slope = Math.atan2(rise, w / 2)
  const span = Math.hypot(rise, w / 2) + 0.2
  for (const side of [-1, 1]) {
    kit.box(span, 0.18, d + 0.5, cx + side * (w / 4), 3.8 + rise / 2, cz, 0x353a40, {
      rz: -side * slope
    })
  }
  const gable = new THREE.Shape()
  gable.moveTo(-w / 2, 0)
  gable.lineTo(w / 2, 0)
  gable.lineTo(0, rise)
  gable.lineTo(-w / 2, 0)
  kit.add(
    new THREE.ExtrudeGeometry(gable, { depth: 0.3, bevelEnabled: false }),
    stone,
    cx,
    3.8,
    z1 - 0.3
  )
  // La cupula con su cruz de hierro.
  kit.ball(1.1, cx, 3.8 + rise + 0.2, cz - 0.6, dark, { detail: 2, sy: 0.75 })
  kit.cyl(0.07, 0.07, 1.4, 5, cx, 3.8 + rise + 1.4, cz - 0.6, IRON)
  kit.box(0.5, 0.07, 0.07, cx, 3.8 + rise + 1.65, cz - 0.6, IRON)
  // La fachada: puerta en arco cerrada, columnas, el roseton verde y la calavera.
  kit.box(1.3, 2.3, 0.12, cx, 1.55, z1 + 0.04, 0x23261f)
  kit.cyl(0.65, 0.65, 0.12, 12, cx, 2.7, z1 + 0.04, 0x23261f, { rx: Math.PI / 2 })
  for (const dx of [-1.15, 1.15]) {
    kit.cyl(0.2, 0.24, 3.2, 8, cx + dx, 1.8, z1 + 0.25, 0x969b90)
    kit.box(0.55, 0.22, 0.55, cx + dx, 3.4, z1 + 0.25, dark)
  }
  kit.cyl(0.42, 0.42, 0.1, 12, cx, 4.45, z1 + 0.02, 0x7cff9a, { rx: Math.PI / 2, glow: 1.3 })
  kit.ball(0.3, cx, 3.25, z1 + 0.18, 0xd8d2c0, { detail: 1, sz: 0.7 })
  for (const dx of [-0.1, 0.1]) kit.ball(0.06, cx + dx, 3.28, z1 + 0.37, 0x0a0a0a, { detail: 0 })
  // La escalera en la celda X: un pozo oscuro con escalones que bajan al sur y
  // un borde de piedra baja, abierto del lado del camino.
  const sx = wx(crypt.x)
  const sz = wz(crypt.y) + 0.35
  for (let i = 0; i < 5; i++) {
    const shade = new THREE.Color(0x3a3e36).multiplyScalar(1 - i * 0.19).getHex()
    kit.box(1.5, 0.02, 0.36, sx, 0.012 + 0.001 * i, sz - 0.5 + i * 0.32, shade)
  }
  kit.box(1.5, 0.02, 0.6, sx, 0.02, sz + 1.1, 0x050505)
  kit.box(0.25, 0.35, 2.4, sx - 0.88, 0.17, sz + 0.4, dark)
  kit.box(0.25, 0.35, 2.4, sx + 0.88, 0.17, sz + 0.4, dark)
  kit.box(2.0, 0.35, 0.25, sx, 0.17, sz + 1.55, dark)
  // Braseros de fuego verde a los lados.
  for (const b of layout.braziers) {
    const bx = wx(b.x)
    const bz = wz(b.y)
    kit.cyl(0.08, 0.12, 1.0, 6, bx, 0.5, bz, IRON)
    kit.cyl(0.28, 0.16, 0.25, 8, bx, 1.1, bz, IRON)
    flames.push([bx, 1.2, bz, 0.55, [0xc8ffb0, 0x30d060]])
  }
  // Lapidas: redondeadas o en cruz, torcidas por los anos.
  for (const g of layout.graves) {
    const x = wx(g.x)
    const z = wz(g.y)
    const tilt = (g.k - 0.5) * 0.3
    const tone = new THREE.Color(0x8a8e84).offsetHSL(0, 0, (g.k - 0.5) * 0.12).getHex()
    if (g.k < 0.5) {
      kit.box(0.5, 0.7, 0.14, x, 0.33, z, tone, { rz: tilt })
      kit.cyl(0.25, 0.25, 0.14, 8, x, 0.68, z, tone, { rx: Math.PI / 2, rz: tilt })
    } else {
      kit.box(0.14, 0.95, 0.12, x, 0.47, z, tone, { rz: tilt })
      kit.box(0.5, 0.13, 0.12, x, 0.7, z, tone, { rz: tilt })
    }
    kit.box(0.6, 0.06, 0.9, x, 0.03, z + 0.5, 0x4a5a3a)
  }
}

// El portal del Coloso: un circulo de losas con runas que laten, menhires
// alrededor, dos cristales y en el centro un anillo de piedra parado, que mira
// al camino, con el remolino adentro (ese lo arma buildLandmarks).
function colossusPortal(kit, pulse, layout, facing) {
  const { portal } = layout
  const x = wx(portal.x)
  const z = wz(portal.y)
  // El piso: anillos de losas sobre la junta oscura, redondo de verdad.
  const flat = { rx: -Math.PI / 2 }
  kit.add(new THREE.CircleGeometry(4.55, 40), 0x24212a, x, 0.02, z, flat)
  kit.add(new THREE.CircleGeometry(1.3, 12), 0x55505c, x, 0.032, z, flat)
  for (const [r0, r1, n] of [
    [1.38, 2.55, 11],
    [2.63, 3.55, 17],
    [3.63, 4.48, 23]
  ]) {
    for (let i = 0; i < n; i++) {
      const start = (i / n) * Math.PI * 2 + n * 0.1
      const span = (Math.PI * 2) / n - 0.09 / r1
      const tone = new THREE.Color(0x5a5560).offsetHSL(0, 0, (hash(i, n) - 0.5) * 0.1).getHex()
      kit.add(new THREE.RingGeometry(r0, r1, 3, 1, start, span), tone, x, 0.032, z, flat)
    }
  }
  for (const [r, w] of [
    [3.4, 0.12],
    [2.1, 0.08]
  ]) {
    pulse.add(new THREE.RingGeometry(r - w, r, 48), 0xb07aff, x, 0.045, z, {
      rx: -Math.PI / 2,
      glow: 1.4
    })
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    pulse.box(0.34, 0.03, 0.12, x + Math.cos(a) * 2.75, 0.05, z + Math.sin(a) * 2.75, 0xc9a0ff, {
      ry: -a,
      glow: 1.4
    })
  }
  for (const s of layout.stones) {
    const sx = wx(s.x)
    const sz = wz(s.y)
    const h = 2.4 + s.k * 1.2
    const yaw = Math.atan2(x - sx, z - sz)
    kit.box(0.85, h, 0.55, sx, h / 2, sz, 0x3d3746, { ry: yaw, rz: (s.k - 0.5) * 0.12 })
    kit.box(0.95, 0.25, 0.65, sx, 0.12, sz, 0x2c2834, { ry: yaw })
    pulse.box(
      0.1,
      h * 0.55,
      0.04,
      sx + Math.sin(yaw) * 0.29,
      h * 0.55,
      sz + Math.cos(yaw) * 0.29,
      0xb07aff,
      { ry: yaw, glow: 1.6 }
    )
  }
  for (const c of layout.crystals) {
    const cx = wx(c.x)
    const cz = wz(c.y)
    kit.box(0.7, 0.5, 0.7, cx, 0.25, cz, 0x2c2834)
    pulse.add(new THREE.OctahedronGeometry(0.5, 0), 0xa070ff, cx, 1.6, cz, { sy: 2.2, glow: 1.1 })
  }
  // El anillo: su plano es perpendicular a `facing` (el camino), asi se entra
  // derecho; se apoya en una base y dos pies.
  kit.add(new THREE.TorusGeometry(1.55, 0.24, 8, 28), 0x4a4256, x, 1.85, z, { ry: facing })
  kit.box(3.6, 0.35, 0.9, x, 0.17, z, 0x2c2834, { ry: facing })
  for (const side of [-1, 1]) {
    kit.box(
      0.6,
      0.7,
      0.7,
      x + Math.cos(facing) * side * 1.6,
      0.35,
      z - Math.sin(facing) * side * 1.6,
      0x3d3746,
      { ry: facing }
    )
  }
}

// Una empalizada barbara como su arte: estacas en el contorno, dos torres de
// guardia al norte, el porton cerrado al sur, las carpas de pieles y de botin,
// el fogon con un totem y un estandarte con el color del campamento.
const CAMP_COLORS = {
  'colmillo-rojo': 0xb02a20,
  'hachas-negras': 0x2a2624,
  'cuervos-ceniza': 0x7a7a80
}
function barbarianCamp(kit, flames, camp) {
  const cell = (col, row) => [wx(camp.left + col), wz(camp.top + row)]
  const stake = (x, z, k) => {
    const h = 2.1 + k * 0.5
    kit.cyl(0.13, 0.15, h, 6, x, h / 2, z, k > 0.5 ? WOOD : 0x5d4026)
    kit.cone(0.14, 0.32, 6, x, h + 0.16, z, 0x8a6a42)
  }
  const line = (a, b) => {
    const [ax, az] = a
    const [bx, bz] = b
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.36))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      stake(x, z, hash(Math.round(x * 10), Math.round(z * 10)))
    }
  }
  // El contorno: arriba (fila 2), los costados (columnas 2 y 32) y abajo (fila
  // 8), con el porton entre las columnas 12 y 20.
  line(cell(3, 2), cell(30, 2))
  line(cell(2.5, 2.4), cell(2.5, 7.6))
  line(cell(31.5, 2.4), cell(31.5, 7.6))
  line(cell(3, 8), cell(12.3, 8))
  line(cell(19.7, 8), cell(31, 8))
  const color = CAMP_COLORS[camp.id] || 0x8a3a2a
  // El porton: dos postes altos con calaveras y las hojas cerradas.
  const [gx, gz] = cell(16, 8)
  for (const dx of [-1.85, 1.85]) {
    kit.box(0.34, 3.4, 0.34, gx + dx, 1.7, gz, WOOD_DARK)
    kit.ball(0.17, gx + dx, 3.55, gz + 0.05, BONE, { detail: 0 })
  }
  kit.box(3.4, 2.2, 0.16, gx, 1.15, gz, WOOD)
  for (const y of [0.55, 1.75]) kit.box(3.4, 0.16, 0.22, gx, y, gz + 0.05, WOOD_DARK)
  kit.box(4.1, 0.3, 0.3, gx, 3.1, gz, WOOD_DARK)
  // Torres de guardia sobre el lado norte.
  for (const col of [7.5, 22.5]) {
    const [tx, tz] = cell(col, 1.2)
    for (const [dx, dz] of [
      [-0.55, -0.45],
      [0.55, -0.45],
      [-0.55, 0.45],
      [0.55, 0.45]
    ]) {
      kit.box(0.14, 3.6, 0.14, tx + dx, 1.8, tz + dz, WOOD_DARK)
    }
    kit.box(1.5, 0.14, 1.3, tx, 3.5, tz, WOOD)
    kit.box(1.5, 0.5, 0.08, tx, 3.8, tz + 0.62, WOOD)
    kit.cone(1.15, 1.2, 4, tx, 4.75, tz, 0x9a8250, { ry: Math.PI / 4 })
    kit.box(0.6, 0.5, 0.06, tx, 3.2, tz + 0.7, color)
  }
  // Las carpas: de pieles al oeste y del botin al este, con oro y un cofre.
  const tent = (col, hex) => {
    const [x, z] = cell(col, 4.8)
    const shape = new THREE.Shape()
    shape.moveTo(-1.3, 0)
    shape.lineTo(1.3, 0)
    shape.lineTo(0, 1.9)
    shape.lineTo(-1.3, 0)
    kit.add(
      new THREE.ExtrudeGeometry(shape, { depth: 1.8, bevelEnabled: false }),
      hex,
      x,
      0,
      z - 0.9
    )
    kit.box(0.6, 1.0, 0.04, x, 0.5, z + 0.92, 0x2a1a10)
    return [x, z]
  }
  tent(8.5, 0xa88a60)
  const [lx, lz] = tent(24.5, 0x8a6a48)
  kit.box(0.7, 0.45, 0.45, lx + 1.6, 0.23, lz + 0.6, 0x7a4a24)
  kit.box(0.74, 0.08, 0.49, lx + 1.6, 0.47, lz + 0.6, 0xd8b050)
  kit.ball(0.32, lx - 1.7, 0.12, lz + 0.7, 0xf2c94a, { detail: 1, sy: 0.4, glow: 0.25 })
  // El fogon con piedras y el totem con calavera.
  const [fx, fz] = cell(14.5, 4.2)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    kit.ball(0.14, fx + Math.cos(a) * 0.5, 0.08, fz + Math.sin(a) * 0.5, 0x6a6660, { detail: 0 })
  }
  kit.box(0.7, 0.1, 0.12, fx, 0.1, fz, WOOD_DARK, { ry: 0.6 })
  kit.box(0.7, 0.1, 0.12, fx, 0.12, fz, WOOD_DARK, { ry: -0.6 })
  flames.push([fx, 0.12, fz, 0.9, null])
  const [px, pz] = cell(17.5, 5.6)
  kit.cyl(0.14, 0.17, 2.6, 6, px, 1.3, pz, 0x7a5a3a)
  kit.ball(0.2, px, 2.7, pz + 0.05, BONE, { detail: 1 })
  kit.box(0.9, 0.12, 0.12, px, 2.3, pz, 0x7a5a3a)
  kit.cone(0.08, 0.35, 4, px - 0.45, 2.45, pz, BONE, { rz: 0.5 })
  kit.cone(0.08, 0.35, 4, px + 0.45, 2.45, pz, BONE, { rz: -0.5 })
  // El cerco bajo que separa las carpas del patio del porton.
  for (const [a, b] of [
    [4, 15.4],
    [19.6, 30.5]
  ]) {
    const [ax, az] = cell(a, 6)
    const [bx] = cell(b, 6)
    kit.box(bx - ax, 0.12, 0.08, (ax + bx) / 2, 0.75, az, WOOD)
    kit.box(bx - ax, 0.12, 0.08, (ax + bx) / 2, 0.35, az, WOOD)
    for (let x = ax; x <= bx + 0.01; x += 0.9) kit.box(0.1, 0.95, 0.1, x, 0.47, az, WOOD_DARK)
  }
  // El estandarte junto al porton.
  const [bx, bz] = cell(21.5, 8.6)
  kit.box(0.1, 4.2, 0.1, bx, 2.1, bz, WOOD_DARK)
  kit.box(0.05, 1.3, 0.9, bx + 0.05, 3.4, bz + 0.48, color)
  kit.ball(0.14, bx, 4.3, bz, BONE, { detail: 0 })
}

// Un remolino violeta para el centro del portal, en un canvas.
function swirlTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const g = canvas.getContext('2d')
  const glow = g.createRadialGradient(128, 128, 4, 128, 128, 128)
  glow.addColorStop(0, 'rgba(255, 235, 255, 1)')
  glow.addColorStop(0.25, 'rgba(190, 120, 255, 0.85)')
  glow.addColorStop(0.7, 'rgba(90, 30, 170, 0.45)')
  glow.addColorStop(1, 'rgba(40, 0, 80, 0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = 'rgba(240, 210, 255, 0.55)'
  g.lineWidth = 6
  for (let arm = 0; arm < 4; arm++) {
    g.beginPath()
    for (let i = 0; i <= 60; i++) {
      const t = i / 60
      const a = arm * (Math.PI / 2) + t * 4.2
      const r = 10 + t * 110
      const px = 128 + Math.cos(a) * r
      const py = 128 + Math.sin(a) * r
      if (i) g.lineTo(px, py)
      else g.moveTo(px, py)
    }
    g.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Chispas violetas que suben alrededor del portal y se apagan arriba: la
// altura la lleva el reloj en la GPU.
function portalMotes(x, z, clock) {
  const count = 90
  const position = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const a = hash(i, 3) * Math.PI * 2
    const r = 0.3 + hash(i, 5) * 3.2
    position[i * 3] = x + Math.cos(a) * r
    position[i * 3 + 1] = hash(i, 9) * 4
    position[i * 3 + 2] = z + Math.sin(a) * r
    seed[i] = hash(i, 11)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('seed', new THREE.BufferAttribute(seed, 1))
  const material = new THREE.PointsMaterial({
    color: 0xc9a0ff,
    size: 0.16,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.clock = clock
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float clock;\nattribute float seed;\nvarying float vFade;'
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float rise = mod( position.y + clock * ( 0.5 + seed * 0.7 ), 4.0 );
        transformed.y = rise;
        transformed.x += sin( clock * 1.3 + seed * 20.0 ) * 0.15;
        vFade = sin( rise / 4.0 * 3.14159 );`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFade;')
  }
  material.customProgramCacheKey = () => 'runa-motes'
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return points
}

// Un cartel de varias lineas con la letra de la terminal, como el del cruce.
function asciiSign(lines, color = '#e0c060') {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')
  const font = '28px ui-monospace, Consolas, monospace'
  g.font = font
  const width = Math.max(...lines.map((line) => g.measureText(line).width))
  canvas.width = Math.ceil(width) + 24
  canvas.height = lines.length * 32 + 14
  g.font = font
  g.fillStyle = 'rgba(11, 11, 12, 0.72)'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = color
  g.textBaseline = 'middle'
  lines.forEach((line, i) => g.fillText(line, 12, 23 + i * 32))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true })
  )
  sprite.scale.set(canvas.width / 80, canvas.height / 80, 1)
  sprite.renderOrder = 10
  return sprite
}

// Arma todos los lugares de la pradera: una malla solida, una de runas que
// laten, una de llamas, el remolino, las chispas y los carteles. Cuelga todo de
// `group`, que la pagina libera con el mapa.
function buildLandmarks(layout, ctx, names) {
  const group = new THREE.Group()
  const solid = new Kit()
  const runes = new Kit()
  const fire = new Kit()
  const flames = []
  // El portal mira al cruce, de donde llega el camino.
  const px = wx(layout.portal.x)
  const pz = wz(layout.portal.y)
  const facing = Math.atan2(wx(layout.crossroads.x) - px, wz(layout.crossroads.y) - pz)
  kingdomWall(solid, flames, layout, 'runa')
  kingdomWall(solid, flames, layout, 'nox')
  rangerCabin(solid, flames, layout)
  signpost(solid, layout)
  cryptRuins(solid, flames, layout)
  colossusPortal(solid, runes, layout, facing)
  for (const camp of layout.camps) barbarianCamp(solid, flames, camp)
  for (const [x, y, z, h, tint] of flames) flame(fire, x, y, z, h, tint)

  const pulse = { value: 1 }
  const clock = { value: 0 }
  const mesh = new THREE.Mesh(solid.geometry(), glowMaterial({ roughness: 0.88 }))
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  group.add(new THREE.Mesh(runes.geometry(), glowMaterial({ roughness: 0.5 }, pulse)))
  const fires = new THREE.Mesh(fire.geometry(), flameMaterial(clock))
  fires.renderOrder = 3
  fires.frustumCulled = false
  group.add(fires)

  const swirl = new THREE.Mesh(
    new THREE.CircleGeometry(1.42, 40),
    new THREE.MeshBasicMaterial({
      map: swirlTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  )
  swirl.position.set(px, 1.85, pz)
  swirl.rotation.y = facing
  swirl.renderOrder = 3
  group.add(swirl)
  group.add(portalMotes(px, pz, clock))

  // Los carteles: el puesto, las empalizadas y el cruce, como en la terminal.
  const tag = (sprite, x, y, z) => {
    sprite.position.set(x, y, z)
    group.add(sprite)
  }
  const cabin = layout.cabin
  tag(
    ctx.label(ctx.text('puesto del guardabosques')),
    wx((cabin.x0 + cabin.x1) / 2),
    5.4,
    wz(cabin.y0)
  )
  for (const camp of layout.camps) {
    tag(ctx.label(ctx.text(camp.name), '#e8a070'), wx(camp.left + 16), 5.4, wz(camp.top + 5))
  }
  tag(asciiSign(names.crossroads), wx(layout.post.x), 4.3, wz(layout.post.y))

  return {
    group,
    update(time) {
      clock.value = time
      pulse.value = 0.75 + 0.35 * Math.sin(time * 2.2)
      swirl.rotation.z = -time * 1.6
      swirl.material.opacity = 0.75 + 0.2 * Math.sin(time * 3.1)
    }
  }
}

// ---------------------------------------------------------------------------
// Los monstruos: una figura de pocos poligonos por tipo, en el estilo de los NPC.

// El color de cada uno en la terminal (render.js FIELD_SPRITES), para su nombre.
const TERMINAL = {
  magenta: '#d97fd9',
  cyan: '#6fd3e0',
  yellow: '#e8c860',
  red: '#e07a6a',
  green: '#7fd36f',
  gray: '#c8c8c0'
}

// El mosquito: cuerpo oscuro, abdomen magenta a rayas, ojos rojos, trompa
// larga y alas claras que aletean (se aplastan y estiran en su raiz).
function mosquitoModel() {
  const body = new Kit()
  const wings = new Kit()
  const dark = 0x2e2230
  const shell = 0x4a2a46
  const stripe = 0xc24fc0
  body.ball(0.26, 0, 0, 0, shell, { sy: 0.85, sz: 1.1 })
  body.ball(0.17, 0, 0.05, 0.36, dark)
  body.ball(0.08, 0.1, 0.11, 0.45, 0xff3a4a, { glow: 1.2, detail: 0 })
  body.ball(0.08, -0.1, 0.11, 0.45, 0xff3a4a, { glow: 1.2, detail: 0 })
  body.stick([0, 0, 0.5], [0, -0.32, 1.02], 0.025, dark, { tip: 0.008 })
  body.stick([0.05, 0.16, 0.44], [0.2, 0.42, 0.62], 0.012, dark)
  body.stick([-0.05, 0.16, 0.44], [-0.2, 0.42, 0.62], 0.012, dark)
  body.ball(0.22, 0, -0.06, -0.5, stripe, { sx: 0.85, sy: 0.72, sz: 1.75 })
  for (const [z, r] of [
    [-0.32, 0.19],
    [-0.52, 0.19],
    [-0.72, 0.15]
  ]) {
    body.cyl(r, r, 0.07, 10, 0, -0.06, z, dark, { rx: Math.PI / 2, sx: 0.88, sz: 0.78 })
  }
  for (const [z, reach] of [
    [0.16, 0.55],
    [0, 0.62],
    [-0.16, 0.55]
  ]) {
    for (const side of [1, -1]) {
      const knee = [side * reach, 0.05, z + 0.05]
      body.stick([side * 0.12, -0.12, z], knee, 0.018, dark)
      body.stick(knee, [side * (reach + 0.18), -0.85, z * 1.6], 0.014, dark, { tip: 0.006 })
    }
  }
  for (const side of [1, -1]) {
    wings.add(new THREE.CircleGeometry(0.5, 14), 0xe8f0ff, side * 0.48, 0.24, -0.12, {
      rx: -Math.PI / 2,
      ry: side * 0.15,
      rz: side * 0.35,
      sx: 1,
      sy: 0.32,
      sz: 1
    })
  }
  return {
    parts: [
      { geometry: body.geometry(), motion: 'body' },
      { geometry: wings.geometry(), motion: 'wings', material: 'wing', pivot: [0, 0.22, 0] }
    ],
    height: 0.5,
    girth: 0.55,
    hover: 1.15,
    scale: 1.35,
    style: 'fly',
    color: 'magenta'
  }
}

// El golem: arenisca con musgo, ojos y una runa amarilla en el pecho, y brazos
// enormes que van aparte para el golpe.
function golemModel() {
  const body = new Kit()
  const arms = new Kit()
  const rock = 0xb2a174
  const dark = 0x857858
  const moss = 0x5e7a3a
  for (const side of [1, -1]) {
    body.box(0.46, 0.75, 0.5, side * 0.34, 0.38, 0, dark, { ry: side * 0.06 })
    body.box(0.55, 0.22, 0.62, side * 0.34, 0.11, 0.06, rock)
  }
  body.box(0.95, 0.35, 0.62, 0, 0.88, 0, dark)
  body.box(1.3, 1.0, 0.82, 0, 1.55, 0, rock, { rx: 0.08 })
  body.box(1.05, 0.25, 0.55, 0, 2.08, -0.08, dark)
  body.ball(0.42, 0.72, 2.0, 0, rock, { detail: 0, sy: 0.85 })
  body.ball(0.42, -0.72, 2.0, 0, rock, { detail: 0, sy: 0.85 })
  body.box(0.55, 0.12, 0.5, 0.6, 2.32, -0.05, moss)
  body.box(0.4, 0.1, 0.45, -0.55, 1.95, 0.25, moss)
  body.box(0.5, 0.42, 0.48, 0, 2.35, 0.12, dark, { rx: 0.1 })
  body.box(0.12, 0.07, 0.04, 0.12, 2.38, 0.37, 0xffd040, { glow: 1.6 })
  body.box(0.12, 0.07, 0.04, -0.12, 2.38, 0.37, 0xffd040, { glow: 1.6 })
  body.box(0.08, 0.42, 0.04, 0, 1.6, 0.43, 0xffcf3a, { glow: 1.2, rx: 0.08 })
  body.box(0.36, 0.08, 0.04, 0, 1.68, 0.43, 0xffcf3a, { glow: 1.2, rx: 0.08 })
  for (const side of [1, -1]) {
    arms.box(0.42, 0.75, 0.45, side * 0.85, 1.6, 0.05, dark)
    arms.box(0.55, 0.62, 0.55, side * 0.88, 0.95, 0.12, rock)
    arms.box(0.3, 0.1, 0.3, side * 0.88, 0.62, 0.25, moss)
  }
  return {
    parts: [
      { geometry: body.geometry(), motion: 'body' },
      { geometry: arms.geometry(), motion: 'arms', pivot: [0, 1.95, 0] }
    ],
    height: 2.55,
    girth: 0.75,
    hover: 0,
    scale: 1,
    style: 'stomp',
    color: 'yellow'
  }
}

// El slime: una gota verde y brillante con ojos, que salta.
function slimeModel() {
  const body = new Kit()
  body.add(
    new THREE.SphereGeometry(0.5, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.62),
    0x5fd35a,
    0,
    0,
    0,
    { sy: 0.85 }
  )
  body.cyl(0.4, 0.4, 0.06, 14, 0, 0.03, 0, 0x3a9a38)
  body.ball(0.16, 0.05, 0.22, 0.05, 0x9af58a, { detail: 1, glow: 0.25 })
  for (const side of [1, -1]) {
    body.ball(0.09, side * 0.15, 0.3, 0.38, 0xffffff, { detail: 1 })
    body.ball(0.05, side * 0.15, 0.31, 0.45, 0x101010, { detail: 0 })
  }
  body.box(0.18, 0.04, 0.04, 0, 0.18, 0.46, 0x1a3a18)
  return {
    parts: [{ geometry: body.geometry(), motion: 'body', material: 'gloss' }],
    height: 0.75,
    girth: 0.5,
    hover: 0,
    scale: 1.15,
    style: 'bounce',
    color: 'green'
  }
}

// El espectro: una figura encapuchada y transparente que flota, con ojos cian.
function specterModel() {
  const body = new Kit()
  const robe = 0xbfeef2
  const outline = [
    [0.02, 0],
    [0.55, 0.05],
    [0.46, 0.5],
    [0.36, 1.0],
    [0.3, 1.35],
    [0.22, 1.6]
  ].map(([r, y]) => new THREE.Vector2(r, y))
  body.add(new THREE.LatheGeometry(outline, 12), robe, 0, 0, 0)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    body.cone(0.1, 0.35, 4, Math.cos(a) * 0.48, -0.1, Math.sin(a) * 0.48, robe, { rx: Math.PI })
  }
  body.ball(0.3, 0, 1.75, 0, robe, { detail: 1, sy: 1.1 })
  body.ball(0.22, 0, 1.72, 0.12, 0x10242a, { detail: 1, sz: 0.8 })
  body.ball(0.06, 0.08, 1.76, 0.3, 0x7ff8ff, { detail: 0, glow: 2 })
  body.ball(0.06, -0.08, 1.76, 0.3, 0x7ff8ff, { detail: 0, glow: 2 })
  for (const side of [1, -1]) {
    body.stick([side * 0.3, 1.3, 0.05], [side * 0.45, 0.95, 0.55], 0.09, robe, { tip: 0.02 })
  }
  return {
    parts: [{ geometry: body.geometry(), motion: 'body', material: 'ghost' }],
    height: 2.0,
    girth: 0.5,
    hover: 0.35,
    scale: 1,
    style: 'float',
    color: 'cyan'
  }
}

// Una figura humana de bloques, como los NPC pintados: piernas, tronco, cabeza
// y brazos; lo demas (armas, cuernos, capa) lo agrega `dress`.
function humanoid(spec, dress) {
  const body = new Kit()
  const { skin, shirt, pants, boots } = spec
  for (const side of [1, -1]) {
    body.box(0.22, 0.62, 0.26, side * 0.14, 0.42, 0, pants)
    body.box(0.24, 0.16, 0.32, side * 0.14, 0.08, 0.03, boots)
  }
  body.box(0.56, 0.68, 0.32, 0, 1.08, 0, shirt)
  body.box(0.58, 0.12, 0.34, 0, 0.78, 0, spec.belt || 0x3a2614)
  body.box(0.44, 0.44, 0.42, 0, 1.66, 0, skin)
  body.box(0.07, 0.06, 0.02, 0.1, 1.7, 0.215, 0x1a1a1a)
  body.box(0.07, 0.06, 0.02, -0.1, 1.7, 0.215, 0x1a1a1a)
  for (const side of [1, -1]) {
    body.box(0.18, 0.62, 0.22, side * 0.38, 1.08, 0.02, spec.sleeve || shirt, { rz: side * 0.08 })
    body.box(0.16, 0.16, 0.18, side * 0.41, 0.72, 0.04, skin)
  }
  dress(body)
  return body.geometry()
}

// Un esqueleto: huesos finos, craneo, costillas; las variantes suman armadura,
// escudo, arco o corona, y cada una tiene ojos de otro color.
function skeleton(kind) {
  const body = new Kit()
  const shade = 0xbdb59c
  const eyes =
    {
      skeleton_knight: 0x60d0ff,
      skeleton_archer: 0xffd040,
      skeleton_elite: 0xe060ff,
      skeleton_king: 0xff4020
    }[kind] || 0xff5040
  for (const side of [1, -1]) {
    body.stick([side * 0.12, 0.85, 0], [side * 0.13, 0.45, 0.02], 0.045, BONE)
    body.stick([side * 0.13, 0.45, 0.02], [side * 0.12, 0.06, 0], 0.04, BONE)
    body.box(0.13, 0.07, 0.24, side * 0.12, 0.04, 0.05, shade)
  }
  body.box(0.34, 0.12, 0.2, 0, 0.9, 0, shade)
  body.stick([0, 0.95, -0.02], [0, 1.5, -0.04], 0.04, shade)
  for (let i = 0; i < 4; i++) {
    const ribs = new THREE.TorusGeometry(0.17 - i * 0.012, 0.022, 4, 12, Math.PI * 1.6)
    body.add(ribs, BONE, 0, 1.18 + i * 0.1, -0.02, { rx: Math.PI / 2, rz: Math.PI * 0.7 })
  }
  for (const side of [1, -1]) {
    body.stick([side * 0.24, 1.48, 0], [side * 0.3, 1.12, 0.06], 0.035, BONE)
    body.stick([side * 0.3, 1.12, 0.06], [side * 0.3, 0.82, 0.18], 0.03, BONE)
  }
  body.box(0.48, 0.07, 0.12, 0, 1.5, -0.02, BONE)
  body.ball(0.2, 0, 1.75, 0, BONE, { detail: 1, sy: 1.08 })
  body.box(0.24, 0.1, 0.16, 0, 1.6, 0.06, BONE)
  body.ball(0.055, 0.075, 1.78, 0.16, eyes, { detail: 0, glow: 1.8 })
  body.ball(0.055, -0.075, 1.78, 0.16, eyes, { detail: 0, glow: 1.8 })
  if (kind === 'skeleton_knight' || kind === 'skeleton_elite') {
    const plate = kind === 'skeleton_elite' ? 0x2a2230 : 0x5a6470
    body.box(0.5, 0.5, 0.34, 0, 1.28, 0, plate)
    body.ball(0.24, 0, 1.82, -0.01, plate, { detail: 1, sy: 0.75 })
    body.box(0.08, 0.3, 0.1, 0, 1.78, 0.2, plate)
    for (const side of [1, -1]) body.ball(0.14, side * 0.3, 1.5, 0, plate, { detail: 0 })
    body.cyl(
      0.32,
      0.32,
      0.06,
      12,
      0.36,
      1.05,
      0.25,
      kind === 'skeleton_elite' ? 0x6a2a7a : 0x3a5a8a,
      { rx: Math.PI / 2 }
    )
    body.stick([-0.33, 0.8, 0.2], [-0.36, 1.85, 0.32], 0.035, 0xc0c8d0)
  }
  if (kind === 'skeleton_elite') {
    body.cone(0.08, 0.3, 4, 0.12, 2.0, 0, 0x8a3aa0, { glow: 0.6 })
    body.cone(0.08, 0.3, 4, -0.12, 2.0, 0, 0x8a3aa0, { glow: 0.6 })
  }
  if (kind === 'skeleton_archer') {
    const bow = new THREE.TorusGeometry(0.55, 0.025, 4, 14, Math.PI * 0.9)
    body.add(bow, 0x8a5a2a, -0.36, 1.1, 0.25, { ry: Math.PI / 2, rz: -Math.PI * 0.45 })
    body.box(0.16, 0.55, 0.16, 0.12, 1.3, -0.2, 0x6a4a2a, { rz: -0.3 })
  }
  if (kind === 'skeleton_king') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      body.cone(0.06, 0.2, 4, Math.cos(a) * 0.17, 2.0, Math.sin(a) * 0.17, 0xf2c94a, { glow: 0.5 })
    }
    body.cyl(0.21, 0.21, 0.08, 12, 0, 1.92, 0, 0xf2c94a, { glow: 0.4 })
    body.box(0.7, 1.4, 0.06, 0, 1.0, -0.25, 0x8a1a1a, { rx: 0.12 })
    body.stick([0.32, 0.6, 0.2], [0.34, 2.0, 0.26], 0.035, 0xf2c94a)
    body.ball(0.09, 0.34, 2.05, 0.26, 0xff5030, { detail: 0, glow: 1.5 })
  }
  return body.geometry()
}

// Los barbaros: abrigo de piel, casco con cuernos, hacha o jabalinas, y la capa
// roja del caudillo.
function barbarian(kind) {
  const chief = kind === 'barbarian_chief'
  const thrower = kind === 'barbarian_thrower'
  return humanoid(
    {
      skin: 0xd9a07a,
      shirt: chief ? 0x6a3a22 : 0x7a5232,
      sleeve: 0xd9a07a,
      pants: 0x4a3626,
      boots: 0x2e2018,
      belt: 0x2a1a10
    },
    (body) => {
      body.box(0.66, 0.2, 0.42, 0, 1.38, 0, chief ? 0x9a8a7a : 0xb8a888)
      body.box(0.34, 0.24, 0.12, 0, 1.45, 0.2, 0xb0562a)
      body.box(0.48, 0.16, 0.46, 0, 1.92, 0, IRON)
      body.cone(0.07, 0.4, 5, 0.3, 2.1, 0, BONE, { rz: -0.9 })
      body.cone(0.07, 0.4, 5, -0.3, 2.1, 0, BONE, { rz: 0.9 })
      if (thrower) {
        body.stick([-0.4, 0.5, 0.3], [-0.42, 2.3, 0.36], 0.025, 0x8a6a42)
        body.cone(0.05, 0.2, 4, -0.42, 2.4, 0.36, 0xc0c8d0)
        for (const dx of [-0.08, 0.04, 0.14]) {
          body.stick([dx, 0.9, -0.24], [dx + 0.05, 2.0, -0.3], 0.02, 0x8a6a42)
        }
      } else {
        body.stick([-0.42, 0.55, 0.25], [-0.44, 1.6, 0.3], 0.03, 0x6a4a2a)
        body.box(0.1, 0.32, 0.26, -0.44, 1.5, 0.42, 0xb0b8c0)
        if (chief) body.box(0.1, 0.32, 0.26, -0.44, 1.5, 0.18, 0xb0b8c0)
      }
      if (chief) {
        body.box(0.8, 1.35, 0.06, 0, 1.0, -0.24, 0x9a1e1a, { rx: 0.1 })
        for (let i = 0; i < 4; i++) {
          body.ball(0.06, -0.12 + i * 0.08, 1.33, 0.22, BONE, { detail: 0 })
        }
      }
    }
  )
}

// Un tipo de una sola parte con su estilo de movimiento.
const walker = (geometry, height, scale, color) => ({
  parts: [{ geometry, motion: 'body' }],
  height,
  girth: 0.38,
  hover: 0,
  scale,
  style: 'walk',
  color
})

const FOE_MODELS = {
  mosquito: mosquitoModel,
  golem: golemModel,
  slime: slimeModel,
  espectro: specterModel,
  skeleton: () => walker(skeleton('skeleton'), 1.95, 1, 'gray'),
  skeleton_knight: () => walker(skeleton('skeleton_knight'), 2.0, 1.05, 'cyan'),
  skeleton_archer: () => walker(skeleton('skeleton_archer'), 1.95, 1, 'yellow'),
  skeleton_elite: () => walker(skeleton('skeleton_elite'), 2.2, 1.15, 'magenta'),
  skeleton_king: () => walker(skeleton('skeleton_king'), 2.5, 1.3, 'red'),
  barbarian_raider: () => walker(barbarian('barbarian_raider'), 2.2, 1.05, 'yellow'),
  barbarian_thrower: () => walker(barbarian('barbarian_thrower'), 2.3, 1, 'cyan'),
  barbarian_chief: () => walker(barbarian('barbarian_chief'), 2.6, 1.2, 'red')
}

// Un monstruo que todavia no tiene figura: una gota violeta con ojos.
function unknownModel() {
  const body = new Kit()
  body.ball(0.45, 0, 0.5, 0, 0x9a6ad0, { detail: 1, sy: 1.1 })
  body.ball(0.07, 0.14, 0.7, 0.4, 0xffffff, { detail: 0, glow: 1 })
  body.ball(0.07, -0.14, 0.7, 0.4, 0xffffff, { detail: 0, glow: 1 })
  return {
    parts: [{ geometry: body.geometry(), motion: 'body' }],
    height: 1.0,
    girth: 0.45,
    hover: 0,
    scale: 1,
    style: 'bounce',
    color: 'magenta'
  }
}

// Cada tipo se arma una vez y queda para toda la pagina.
const models = new Map()
function modelOf(kind) {
  if (!models.has(kind)) models.set(kind, (FOE_MODELS[kind] || unknownModel)())
  return models.get(kind)
}

// Los materiales de los monstruos, compartidos por todos.
let foeMaterials = null
function materialsForFoes() {
  if (!foeMaterials) {
    foeMaterials = {
      solid: glowMaterial({ roughness: 0.72 }),
      gloss: glowMaterial({ roughness: 0.22, metalness: 0.05 }),
      ghost: glowMaterial({ roughness: 0.6, transparent: true, opacity: 0.72, depthWrite: false }),
      wing: new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    }
  }
  return foeMaterials
}

// La sombra blanda al pie, para todos los monstruos (una sola malla).
let blobTexture = null
function softBlob() {
  if (!blobTexture) {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const g = canvas.getContext('2d')
    const shade = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.5)')
    shade.addColorStop(0.6, 'rgba(0, 0, 0, 0.28)')
    shade.addColorStop(1, 'rgba(0, 0, 0, 0)')
    g.fillStyle = shade
    g.fillRect(0, 0, 64, 64)
    blobTexture = new THREE.CanvasTexture(canvas)
  }
  return blobTexture
}

// ---------------------------------------------------------------------------
// Numeros, barras y chispas: carteles de canvas que miran a la camara.

// Una estrella de cuatro puntas con un halo, blanca: el material le da el color.
function sparkTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')
  const halo = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  halo.addColorStop(0, 'rgba(255, 255, 255, 1)')
  halo.addColorStop(0.18, 'rgba(255, 255, 255, 0.7)')
  halo.addColorStop(0.5, 'rgba(255, 255, 255, 0.12)')
  halo.addColorStop(1, 'rgba(255, 255, 255, 0)')
  g.fillStyle = halo
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = 'rgba(255, 255, 255, 0.95)'
  for (const turn of [0, Math.PI / 2]) {
    g.save()
    g.translate(64, 64)
    g.rotate(turn)
    g.beginPath()
    g.moveTo(-62, 0)
    g.lineTo(0, -7)
    g.lineTo(62, 0)
    g.lineTo(0, 7)
    g.closePath()
    g.fill()
    g.restore()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function textSprite(text, color, size = 40) {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')
  const font = `bold ${size}px ui-monospace, Consolas, monospace`
  g.font = font
  canvas.width = Math.ceil(g.measureText(text).width) + 16
  canvas.height = size + 14
  g.font = font
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = 6
  g.strokeStyle = '#140c0a'
  g.strokeText(text, 8, canvas.height / 2 + 1)
  g.fillStyle = color
  g.fillText(text, 8, canvas.height / 2 + 1)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, w: canvas.width / 60, h: canvas.height / 60 }
}

// La barra de vida sobre un monstruo herido: se repinta solo si cambia.
function healthBar() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 18
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true })
  )
  sprite.scale.set(1.5, 0.21, 1)
  sprite.renderOrder = 11
  let shown = ''
  return {
    sprite,
    set(share) {
      const fill = share > 0.5 ? '#e0583a' : share > 0.25 ? '#e8902a' : '#ff3020'
      const key = share.toFixed(3)
      if (key === shown) return
      shown = key
      const g = canvas.getContext('2d')
      g.clearRect(0, 0, 128, 18)
      g.fillStyle = 'rgba(10, 8, 8, 0.85)'
      g.fillRect(0, 0, 128, 18)
      g.fillStyle = fill
      g.fillRect(3, 3, Math.max(0, Math.round(122 * share)), 12)
      g.strokeStyle = 'rgba(255, 235, 200, 0.55)'
      g.lineWidth = 2
      g.strokeRect(1, 1, 126, 16)
      texture.needsUpdate = true
    },
    dispose() {
      texture.dispose()
      sprite.material.dispose()
    }
  }
}

// ---------------------------------------------------------------------------
// La pagina: estilos y cajas propias del combate (la barra del monstruo, la
// ayuda de teclas, el destello rojo y el aviso de derrota).

const CSS = `
#foebar {
  position: absolute;
  left: 50%;
  top: 16px;
  transform: translateX(-50%);
  width: min(420px, calc(100vw - 340px));
  text-align: center;
  color: #f0d8c8;
  text-shadow: 0 1px 3px #000;
}
#foebar .bar i {
  background: #d8483a;
}
#meadow-hint {
  position: absolute;
  left: 50%;
  bottom: 150px;
  transform: translateX(-50%);
  padding: 4px 12px;
  color: var(--accent);
  background: var(--panel);
  border: 1px solid var(--accent);
  white-space: nowrap;
}
#meadow-hint.fight {
  color: #ffd2c8;
  border-color: #d8483a;
}
#meadow-flash {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(200, 30, 20, 0) 45%, rgba(200, 30, 20, 0.5) 100%);
  opacity: 0;
  transition: opacity 0.4s ease-out;
  z-index: 1;
}
#meadow-flash.on {
  opacity: 1;
  transition: none;
}
#meadow-fell {
  position: fixed;
  left: 50%;
  top: 38%;
  transform: translate(-50%, -50%);
  padding: 14px 22px;
  color: #ffd2c8;
  background: rgba(30, 6, 4, 0.88);
  border: 1px solid #d8483a;
  text-align: center;
  font-size: 18px;
  letter-spacing: 0.06em;
  pointer-events: none;
  z-index: 6;
}
#meadow-fell small {
  display: block;
  margin-top: 4px;
  font-size: 13px;
  color: #d8b0a8;
  letter-spacing: 0;
}
@media (max-width: 640px) {
  #foebar {
    top: 150px;
    width: calc(100vw - 32px);
  }
}
@media (pointer: coarse) {
  #meadow-hint {
    top: 196px;
    bottom: auto;
  }
}
`

function pageBits() {
  if (!document.getElementById('meadow-css')) {
    const style = document.createElement('style')
    style.id = 'meadow-css'
    style.textContent = CSS
    document.head.append(style)
  }
  const box = (id, parent) => {
    let el = document.getElementById(id)
    if (!el) {
      el = document.createElement('div')
      el.id = id
      el.hidden = true
      parent.append(el)
    }
    return el
  }
  // La barra y la ayuda van con la ficha (se esconden con ella cuando se abre
  // la pantalla de texto); el destello y el aviso, sobre todo.
  const play = document.getElementById('play') || document.body
  return {
    foebar: box('foebar', play),
    hint: box('meadow-hint', play),
    flash: box('meadow-flash', document.body),
    fell: box('meadow-fell', document.body)
  }
}

// El aviso de derrota: rojo, un par de segundos.
let fellTimer = 0
function showFall(box, L) {
  const note = document.createElement('small')
  note.textContent = L(
    'You wake up in the church of your city.',
    'Te despertas en la iglesia de tu ciudad.'
  )
  box.replaceChildren(L('You fell in battle', 'Caiste en combate'), note)
  box.hidden = false
  globalThis.clearTimeout(fellTimer)
  // La pagina arma la ciudad enseguida y eso traba un momento: la cuenta
  // empieza con el primer cuadro que se ve.
  globalThis.requestAnimationFrame(() => {
    fellTimer = globalThis.setTimeout(() => {
      box.hidden = true
    }, 2800)
  })
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
}

// ---------------------------------------------------------------------------
// La gente de la pradera: un InstancedMesh por tipo y parte, con el estado de
// cada monstruo para moverlo suave entre celdas.

const BASE = new THREE.Matrix4()
const LOCAL = new THREE.Matrix4()
const PART = new THREE.Matrix4()
const TINT = new THREE.Color()

class Crowd {
  constructor(ctx, world, L) {
    this.ctx = ctx
    this.world = world
    this.L = L
    this.group = new THREE.Group()
    ctx.scene.add(this.group)
    this.kinds = new Map()
    this.foes = new Map()
    this.labels = new Map()
    this.blobs = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: softBlob(), transparent: true, depthWrite: false }),
      64
    )
    this.blobs.frustumCulled = false
    this.blobs.count = 0
    this.blobs.renderOrder = -1
    this.group.add(this.blobs)
    this.tick = 0
    this.populated = false
    // El monstruo de la pelea en curso, y cuando cae si gano el heroe.
    this.engaged = null
    this.fallAt = 0
  }

  count() {
    return this.foes.size
  }

  // Las mallas de un tipo, con lugar para `need` monstruos (crecen de a dobles).
  meshes(kind, need) {
    let entry = this.kinds.get(kind)
    if (entry && entry.capacity >= need) return entry
    const model = modelOf(kind)
    const capacity = Math.max(8, need * 2, entry ? entry.capacity * 2 : 0)
    const materials = materialsForFoes()
    if (entry) {
      for (const mesh of entry.parts) {
        this.group.remove(mesh)
        mesh.dispose()
      }
    }
    const parts = model.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(
        part.geometry,
        materials[part.material || 'solid'],
        capacity
      )
      mesh.frustumCulled = false
      mesh.castShadow = part.motion !== 'wings'
      mesh.count = 0
      mesh.userData.motion = part.motion
      mesh.userData.pivot = new THREE.Vector3(...(part.pivot || [0, 0, 0]))
      mesh.setColorAt(0, TINT.setRGB(1, 1, 1))
      this.group.add(mesh)
      return mesh
    })
    entry = { model, parts, capacity }
    this.kinds.set(kind, entry)
    return entry
  }

  // El cartel con el nombre, uno por tipo e idioma, del color de la terminal.
  label(kind, name) {
    const key = kind + ':' + this.L('en', 'es')
    if (!this.labels.has(key)) {
      const model = modelOf(kind)
      const color = TERMINAL[model.color] || '#d8d8d0'
      this.labels.set(key, this.ctx.label(this.ctx.text(name || kind), color))
    }
    const template = this.labels.get(key)
    const sprite = new THREE.Sprite(template.material)
    sprite.scale.copy(template.scale)
    sprite.renderOrder = 10
    return sprite
  }

  add(foe, time) {
    const model = modelOf(foe.kind)
    const at = this.world.built.toWorld(foe.x, foe.y)
    const tag = this.label(foe.kind, foe.name)
    this.group.add(tag)
    const state = {
      id: foe.id,
      kind: foe.kind,
      name: foe.name,
      model,
      cell: { x: foe.x, y: foe.y },
      pos: at.clone(),
      from: at.clone(),
      to: at.clone(),
      moveStart: -1,
      moveDur: 0.4,
      yaw: hash(foe.x, foe.y) * Math.PI * 2,
      phase: hash(Number(foe.id) * 7 + 3, 3) * 10,
      // Los que aparecen con el mapa ya estaban; los que reviven crecen.
      born: this.populated ? time : -10,
      flash: -10,
      lunge: -10,
      recoil: -10,
      dying: -1,
      gone: false,
      tag,
      bar: null,
      offset: new THREE.Vector3()
    }
    this.foes.set(foe.id, state)
    return state
  }

  remove(state) {
    this.group.remove(state.tag)
    if (state.bar) {
      this.group.remove(state.bar.sprite)
      state.bar.dispose()
    }
    this.foes.delete(state.id)
  }

  // Los monstruos del juego: los nuevos aparecen, los que se movieron van a su
  // celda nueva y los que faltan se van (o caen, si eran el de la pelea).
  sync(list, time) {
    const seen = new Set()
    for (const foe of list) {
      seen.add(foe.id)
      let state = this.foes.get(foe.id)
      if (state && state.kind !== foe.kind) {
        this.remove(state)
        state = null
      }
      if (!state) state = this.add(foe, time)
      if (state.dying >= 0) continue
      if (state.cell.x !== foe.x || state.cell.y !== foe.y) this.moveTo(state, foe, time)
    }
    for (const state of this.foes.values()) {
      if (seen.has(state.id) || state.dying >= 0) continue
      if (state.id === this.engaged && this.fallAt) state.dying = this.fallAt
      else state.gone = true
    }
    this.populated = true
  }

  moveTo(state, foe, time) {
    const to = this.world.built.toWorld(foe.x, foe.y)
    state.cell = { x: foe.x, y: foe.y }
    state.from.copy(state.pos)
    state.to.copy(to)
    state.moveStart = time
    const far = state.from.distanceTo(to)
    const speed =
      { fly: 3.2, float: 1.5, stomp: 1.1, bounce: 2.2, walk: 2.2 }[state.model.style] || 2
    state.moveDur = Math.min(1.4, Math.max(0.22, far / speed))
  }

  // En el recorrido el campo del juego avanza solo, a su ritmo: los monstruos
  // deambulan y nadie pelea (el jugador del campo se queda en el porton, donde
  // ninguno llega).
  tour(field, meadow, dt, time) {
    this.tick += Math.min(dt, 0.25) * meadow.tps
    let steps = 0
    while (this.tick >= 1 && steps < 8) {
      field.tick()
      this.tick -= 1
      steps++
    }
    const list = []
    for (const foe of field.foes) {
      if (foe.dead) continue
      const def = meadow.foes[foe.kind] || {}
      list.push({ id: foe.id, kind: foe.kind, name: def.name || foe.kind, x: foe.x, y: foe.y })
    }
    this.sync(list, time)
  }

  update(time, dt) {
    const hero = this.ctx.hero.root.position
    const poses = []
    const counts = new Map()
    for (const state of [...this.foes.values()]) {
      if (state.gone) {
        this.remove(state)
        continue
      }
      let k = 1
      if (state.moveStart >= 0) {
        k = Math.min(1, (time - state.moveStart) / state.moveDur)
        state.pos.lerpVectors(state.from, state.to, k * k * (3 - 2 * k))
        if (k >= 1) state.moveStart = -1
      }
      const moving = state.moveStart >= 0
      // El que pelea se aparta del heroe lo que mide su cuerpo; el resto, si se
      // le encima, tambien. Solo se dibuja asi: la celda es la del juego.
      const engaged = state.id === this.engaged
      const dx = state.pos.x - hero.x
      const dz = state.pos.z - hero.z
      const near = Math.hypot(dx, dz)
      const room = 0.55 + state.model.girth * state.model.scale + (engaged ? 0.3 : 0.05)
      state.offset.set(0, 0, 0)
      if ((engaged || near < room) && state.dying < 0 && near < room) {
        const ux = near > 0.05 ? dx / near : Math.sin(state.yaw)
        const uz = near > 0.05 ? dz / near : Math.cos(state.yaw)
        state.offset.set(ux * (room - near), 0, uz * (room - near))
      }
      // Mira hacia donde va; quieto, al heroe si esta cerca.
      let want = state.yaw
      if (moving) want = Math.atan2(state.to.x - state.from.x, state.to.z - state.from.z)
      else if (engaged || near < 9) want = Math.atan2(-dx, -dz)
      const turn = engaged ? 10 : moving ? 8 : 2.5
      const delta = Math.atan2(Math.sin(want - state.yaw), Math.cos(want - state.yaw))
      state.yaw += delta * Math.min(1, dt * turn)
      const pose = this.pose(state, time, k, moving)
      if (!pose) {
        this.remove(state)
        continue
      }
      const slot = counts.get(state.kind) || 0
      counts.set(state.kind, slot + 1)
      poses.push([state, pose, slot])
      // El nombre arriba de la cabeza, si esta cerca del heroe o pelea.
      const top = pose.y + state.model.height * pose.scale
      // En la pelea el nombre va en la barra de arriba: aca queda la de vida.
      state.tag.position.set(pose.x, top + 0.55, pose.z)
      state.tag.visible = state.dying < 0 && !engaged && near < 16
      if (state.bar) {
        state.bar.sprite.position.set(pose.x, top + 0.35, pose.z)
        state.bar.sprite.visible = state.dying < 0 || time < state.dying + 0.5
      }
    }
    let blobs = 0
    for (const [state, pose, slot] of poses) {
      const entry = this.meshes(state.kind, counts.get(state.kind))
      this.write(entry, slot, pose, state, time)
      // La sombra blanda, mas chica si vuela alto.
      const size = state.model.scale * (state.model.style === 'stomp' ? 1.7 : 1.1)
      const lift = 1 + Math.max(0, pose.y) * 0.4
      M4.compose(
        V3.set(pose.x, 0.025, pose.z),
        Q4.identity(),
        S3.set(size / lift, 1, (size * 0.8) / lift)
      )
      if (blobs < 64) this.blobs.setMatrixAt(blobs++, M4)
    }
    for (const [kind, entry] of this.kinds) {
      const used = counts.get(kind) || 0
      for (const mesh of entry.parts) {
        mesh.count = used
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    }
    this.blobs.count = blobs
    this.blobs.instanceMatrix.needsUpdate = true
  }

  // Como se ve un monstruo en este cuadro: posicion, giro, inclinacion, escala y
  // lo que hacen sus partes (alas, brazos). null si ya termino de caer.
  pose(state, time, k, moving) {
    const t = time + state.phase
    const style = state.model.style
    const base = state.model.hover
    let y = base
    let tilt = 0
    let roll = 0
    let squash = 1
    let wing = 1
    let arms = 0
    if (style === 'fly') {
      y += Math.sin(t * 3.1) * 0.12 + Math.sin(t * 7.3) * 0.03
      tilt = moving ? 0.35 : Math.sin(t * 1.7) * 0.08
      roll = Math.sin(t * 2.3) * 0.12
      wing = 0.25 + Math.abs(Math.sin(t * 38)) * 1.1
    } else if (style === 'float') {
      y += Math.sin(t * 1.6) * 0.15
      roll = Math.sin(t * 0.9) * 0.06
    } else if (style === 'stomp') {
      const stride = moving ? Math.abs(Math.sin(k * Math.PI * 2)) : 0
      y += stride * 0.12
      roll = moving ? Math.sin(k * Math.PI * 2) * 0.08 : Math.sin(t * 0.8) * 0.02
      squash = 1 + Math.sin(t * 1.4) * 0.015
      arms = Math.sin(t * 0.9) * 0.05 + (moving ? Math.sin(k * Math.PI * 2) * 0.25 : 0)
    } else if (style === 'bounce') {
      const hop = moving ? Math.sin(k * Math.PI) : Math.max(0, Math.sin(t * 2.6)) * 0.25
      y += hop * 0.45
      squash = 1 + (moving ? -Math.cos(k * Math.PI * 2) * 0.12 : Math.sin(t * 5.2) * 0.06)
    } else {
      y += moving ? Math.abs(Math.sin(k * Math.PI * 2)) * 0.06 : 0
      roll = Math.sin(t * 1.3) * 0.03
      squash = 1 + Math.sin(t * 2) * 0.012
    }
    // Ataque: se lanza hacia el heroe y vuelve; golpeado: retrocede.
    const lunge = time - state.lunge
    let reach = 0
    if (lunge >= 0 && lunge < 0.42) {
      const s = Math.sin((lunge / 0.42) * Math.PI)
      reach = s * (style === 'stomp' ? 0.35 : 0.6)
      if (style === 'stomp') arms = -1.3 * s
      if (style === 'bounce') y += s * 0.3
    }
    const hit = time - state.recoil
    const back = hit >= 0 && hit < 0.35 ? (1 - hit / 0.35) ** 2 * 0.35 : 0
    // Al revivir crece desde el suelo; al caer se tumba y se hunde.
    let scale = state.model.scale
    const born = time - state.born
    if (born >= 0 && born < 0.6) scale *= Math.sqrt(born / 0.6)
    let fall = 0
    if (state.dying >= 0 && time >= state.dying) {
      const d = time - state.dying
      if (d > 2.4) return null
      fall = Math.min(1, d / 0.45)
      const bounce = d > 0.45 && d < 0.7 ? Math.sin(((d - 0.45) / 0.25) * Math.PI) * 0.06 : 0
      wing = 0
      y = base * (1 - fall) + bounce - Math.max(0, d - 1.1) * 1.4
    }
    const fx = Math.sin(state.yaw)
    const fz = Math.cos(state.yaw)
    return {
      x: state.pos.x + state.offset.x + fx * (reach - back),
      y,
      z: state.pos.z + state.offset.z + fz * (reach - back),
      yaw: state.yaw,
      tilt: tilt - fall * 1.45,
      roll,
      squash,
      wing,
      arms,
      scale
    }
  }

  write(entry, slot, pose, state, time) {
    E3.set(pose.tilt, pose.yaw, pose.roll, 'YXZ')
    Q4.setFromEuler(E3)
    const wide = pose.scale / Math.sqrt(pose.squash)
    BASE.compose(V3.set(pose.x, pose.y, pose.z), Q4, S3.set(wide, pose.scale * pose.squash, wide))
    const flash = time - state.flash
    const bright =
      flash >= 0 && flash < 0.14 ? 2.6 : state.dying >= 0 && time - state.dying < 0.2 ? 2 : 1
    TINT.setRGB(bright, bright, bright)
    for (const mesh of entry.parts) {
      const motion = mesh.userData.motion
      const pivot = mesh.userData.pivot
      if (motion === 'wings' || (motion === 'arms' && pose.arms)) {
        LOCAL.makeTranslation(pivot.x, pivot.y, pivot.z)
        if (motion === 'wings') LOCAL.multiply(PART.makeScale(1, pose.wing, 1))
        else LOCAL.multiply(PART.makeRotationX(pose.arms))
        LOCAL.multiply(PART.makeTranslation(-pivot.x, -pivot.y, -pivot.z))
        mesh.setMatrixAt(slot, PART.multiplyMatrices(BASE, LOCAL))
      } else mesh.setMatrixAt(slot, BASE)
      mesh.setColorAt(slot, TINT)
    }
  }

  // Lo que el combate le pide a un monstruo: destello y retroceso, o el ataque.
  hit(id, time) {
    const state = this.foes.get(id)
    if (!state) return
    state.flash = time
    state.recoil = time
  }

  strike(id, time) {
    const state = this.foes.get(id)
    if (state) state.lunge = time
  }

  // Donde se ve (para los numeros y los golpes), cuanto mide y que es.
  spot(id) {
    const state = this.foes.get(id)
    if (!state) return null
    return {
      x: state.pos.x + state.offset.x,
      z: state.pos.z + state.offset.z,
      top: state.model.hover + state.model.height * state.model.scale,
      style: state.model.style,
      kind: state.kind,
      name: state.name
    }
  }

  // La barra de vida de un monstruo herido (share de 0 a 1).
  health(id, share) {
    const state = this.foes.get(id)
    if (!state) return
    if (!state.bar) {
      state.bar = healthBar()
      this.group.add(state.bar.sprite)
    }
    state.bar.set(Math.max(0, Math.min(1, share)))
  }

  dispose() {
    this.ctx.scene.remove(this.group)
    for (const entry of this.kinds.values()) for (const mesh of entry.parts) mesh.dispose()
    for (const state of this.foes.values()) if (state.bar) state.bar.dispose()
    // Los nombres: cada tipo tiene su textura; los carteles la comparten.
    for (const template of this.labels.values()) {
      template.material.map.dispose()
      template.material.dispose()
    }
    this.blobs.geometry.dispose()
    this.blobs.material.dispose()
    this.blobs.dispose()
    this.foes.clear()
    this.kinds.clear()
  }
}

// ---------------------------------------------------------------------------
// El combate en el mapa: lo que paso en cada turno (el juego resuelve varios
// ticks por ataque) se cuenta con golpes, numeros, barras y la ayuda de teclas.

const WEAPON_STYLE = {
  dagger: 'slash',
  sword: 'slash',
  warhammer: 'smash',
  spear: 'thrust',
  crossbow: 'shot',
  longbow: 'shot'
}
// Los monstruos que pegan de lejos tiran algo: piedra, jabalina, flecha, rayo.
const FOE_SHOT = {
  golem: 0xb2a174,
  barbarian_thrower: 0xd8c090,
  skeleton_archer: 0xd8c090,
  espectro: 0x7ff8ff
}

class Effects {
  constructor(ctx, crowd, bits, L) {
    this.ctx = ctx
    this.crowd = crowd
    this.bits = bits
    this.L = L
    this.group = new THREE.Group()
    ctx.scene.add(this.group)
    this.last = null
    this.engaged = null
    this.spot = null
    this.barHp = 0
    this.zoom = { k: 0, base: 0 }
    this.queue = []
    this.numbers = []
    this.textures = new Map()
    this.heroLunge = -10
    this.heroRecoil = -10
    this.slashAt = -10
    this.slashYaw = 0
    this.slashSide = 1
    this.boltAt = -10
    this.burstAt = -10
    this.boltFrom = new THREE.Vector3()
    this.boltTo = new THREE.Vector3()
    const additive = (color) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    // El arco del tajo, el proyectil y la onda del golpe: uno de cada uno.
    // El tajo no se suma a lo de atras: sobre el pasto claro se perderia.
    this.slash = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 1.4, 28, 1, -1.05, 2.1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xfff6d8,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    )
    this.bolt = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.75),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8 })
    )
    this.burst = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.34, 28).rotateX(-Math.PI / 2),
      additive(0xffffff)
    )
    // Los aros de la pelea: rojo bajo el monstruo, dorado bajo el heroe.
    this.foeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.86, 36).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xff4030,
        transparent: true,
        opacity: 0.7,
        depthWrite: false
      })
    )
    this.heroRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.66, 36).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xe0c060,
        transparent: true,
        opacity: 0.6,
        depthWrite: false
      })
    )
    for (const mesh of [this.slash, this.bolt, this.burst, this.foeRing, this.heroRing]) {
      mesh.visible = false
      mesh.renderOrder = 4
      this.group.add(mesh)
    }
    // La chispa del impacto: una estrella que se abre y se apaga.
    this.spark = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sparkTexture(),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      })
    )
    this.spark.visible = false
    this.spark.renderOrder = 13
    this.sparkAt = -10
    this.group.add(this.spark)
  }

  // La estrella en un punto, del color del golpe.
  sparkle(x, y, z, hex, time) {
    this.sparkAt = time
    this.spark.position.set(x, y, z)
    this.spark.material.color.setHex(hex)
  }

  fighting() {
    return this.engaged !== null
  }

  debug() {
    return {
      engaged: this.engaged,
      queue: this.queue.length,
      numbers: this.numbers.length,
      bar: this.barHp,
      last: this.last ? { hp: this.last.hp, foeHp: this.last.foeHp, tick: this.last.tick } : null
    }
  }

  texture(text, color) {
    const key = text + color
    if (!this.textures.has(key)) this.textures.set(key, textSprite(text, color))
    return this.textures.get(key)
  }

  // Un numero que sube y se apaga desde (x, y, z), `delay` segundos despues.
  number(text, color, x, y, z, time, delay = 0) {
    const { texture, w, h } = this.texture(text, color)
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false
      })
    )
    sprite.scale.set(w, h, 1)
    sprite.renderOrder = 12
    sprite.visible = false
    sprite.position.set(x + (hash(this.numbers.length, Math.round(time * 100)) - 0.5) * 0.3, y, z)
    this.group.add(sprite)
    this.numbers.push({ sprite, start: time + delay, y, w, h })
    if (this.numbers.length > 10) this.drop(this.numbers[0])
  }

  drop(entry) {
    this.group.remove(entry.sprite)
    entry.sprite.material.dispose()
    this.numbers.splice(this.numbers.indexOf(entry), 1)
  }

  // Cada cuadro de la partida, antes de mover a los monstruos: compara la pelea
  // con la del cuadro anterior y arma lo que paso. st.fight es la pelea del
  // juego (tripo-estado.js fightOf), field el campo (por el registro de la pelea
  // que termino) y said el registro del juego (por lo que cobro el heroe).
  sync(st, field, said, time, touch) {
    const fight = st.fight
    const crowd = this.crowd
    if (fight && (!this.last || this.last.id !== fight.id)) {
      // Contacto: los dos se miran, aparecen los aros y la barra.
      this.engaged = fight.id
      crowd.engaged = fight.id
      crowd.fallAt = 0
      this.barHp = fight.foeHp
      const spot = crowd.spot(fight.id)
      if (spot) this.number('!', '#ffd040', spot.x, spot.top + 0.9, spot.z, time)
    } else if (fight && fight.tick !== this.last.tick) {
      this.turn(this.last, fight, fight.log, time)
    } else if (!fight && this.last) {
      // Termino. Si gano el heroe, el juego ya anoto la pelea entera en
      // lastFight: se cuenta el ultimo turno y el monstruo cae despues del golpe.
      const ended = field && field.lastFight ? field.lastFight : null
      const won = !!ended && ended.over === 'ganaste'
      if (ended) {
        const after = { ...this.last, tick: Infinity, foeHp: won ? 0 : this.last.foeHp, hp: st.hp }
        const blow = this.turn(this.last, after, ended.log, time)
        if (won) {
          crowd.fallAt = time + blow + 0.08
          this.victory(said, crowd.fallAt)
        }
      }
      this.engaged = null
      // El que cae sigue marcado hasta que crowd.sync lo vea irse.
      if (!won) crowd.engaged = null
    }
    this.last = fight
    if (fight) this.spot = crowd.spot(fight.id) || this.spot
    this.hud(st, fight, touch)
  }

  // Despues de crowd.sync: el que cayo ya quedo marcado.
  settle() {
    if (this.engaged === null) this.crowd.engaged = null
  }

  // La barra del monstruo arriba (como la del Coloso) y la ayuda de teclas.
  hud(st, fight, touch) {
    const { foebar, hint } = this.bits
    const L = this.L
    if (fight) {
      const name = this.ctx.text(this.spot ? this.spot.name : fight.kind)
      const share = Math.max(0, Math.min(1, this.barHp / Math.max(1, fight.foeMaxhp)))
      foebar.innerHTML =
        `<b>${escapeHtml(name)}</b>` +
        `<div class="bar"><i style="width:${(share * 100).toFixed(1)}%"></i>` +
        `<span>${this.barHp}/${fight.foeMaxhp}</span></div>`
      foebar.hidden = false
      this.crowd.health(fight.id, share)
      hint.className = 'fight'
      hint.textContent = touch
        ? L('F or the pad toward it: attack', 'F o la cruceta hacia el: atacar')
        : L('F, Space or a step toward it: attack', 'F, Espacio o un paso hacia el: atacar')
      hint.hidden = false
      return
    }
    foebar.hidden = true
    hint.className = ''
    const near = this.nearHint(st)
    hint.textContent = near
    hint.hidden = !near
  }

  // La ayuda fuera de la pelea: hablar con la guardabosques, entrar a la cripta
  // o al portal, volver a la ciudad.
  nearHint(st) {
    const L = this.L
    const meadow = this.crowd.world.data.meadow
    const at = st.location
    if (!at) return ''
    const close = (p, rx, ry) => Math.abs(p.x - at.x) <= rx && Math.abs(p.y - at.y) <= ry
    for (const guide of meadow.guides) {
      if (close(guide, 2, 2)) return L('E · talk to ', 'E · hablar con ') + guide.name
    }
    if (close(meadow.crypt, 6, 3)) {
      return L('X · step on it to go down to the crypt', 'X · pisala para bajar a la cripta')
    }
    if (close(meadow.portal, 9, 5)) {
      return L('O · step into the portal of the Colossus', 'O · entra al portal del Coloso')
    }
    if (close(meadow.gate, 7, 3)) return L('< or T · back to RUNA', '< o T · volver a RUNA')
    if (close(meadow.nox, 7, 3)) return L('N · cross into NOX', 'N · cruzar a NOX')
    // Herido y lejos: T vuelve a la ciudad (en la iglesia se cura).
    if (st.maxhp && st.hp / st.maxhp < 0.4) {
      return L('Low HP · T: back to RUNA to heal', 'Poca vida · T: volver a RUNA a curarte')
    }
    return ''
  }

  // Un turno: lo que dicen las lineas nuevas de la pelea, en orden (el heroe
  // pega primero dentro del mismo tick, world.js step). Devuelve cuando cae el
  // ultimo golpe del heroe, en segundos desde ahora.
  turn(before, after, log, time) {
    const events = []
    for (const entry of log || []) {
      if (entry.tick <= before.tick) continue
      const mine = /^pegas (\d+)/.exec(entry.text)
      const theirs = / te pega (\d+)/.exec(entry.text)
      if (mine) events.push({ who: 'hero', amount: Number(mine[1]) })
      else if (theirs) events.push({ who: 'foe', amount: Number(theirs[1]) })
      else if (/pocion/.test(entry.text)) events.push({ who: 'potion' })
    }
    if (!events.length) {
      // Sin lineas: se cuenta por las vidas; si nada cambio, el heroe amaga.
      const dealt = before.foeHp - after.foeHp
      if (dealt > 0) events.push({ who: 'hero', amount: dealt })
      if (after.hp < before.hp) events.push({ who: 'foe', amount: before.hp - after.hp })
      if (!events.length) events.push({ who: 'feint' })
    }
    let delay = 0
    let blow = 0
    let foeHp = before.foeHp
    for (const event of events) {
      const at = time + delay
      if (event.who === 'feint') {
        this.queue.push({ at, kind: 'advance' })
        delay += 0.2
      } else if (event.who === 'hero') {
        foeHp = Math.max(0, foeHp - event.amount)
        this.queue.push(
          { at, kind: 'swing', weapon: after.weapon, id: before.id },
          { at: at + 0.12, kind: 'foe-hit', id: before.id, amount: event.amount, hp: foeHp }
        )
        blow = delay + 0.12
        delay += 0.26
      } else if (event.who === 'foe') {
        this.queue.push({ at, kind: 'foe-swing', id: before.id })
        this.queue.push({ at: at + 0.16, kind: 'hero-hit', amount: event.amount })
        delay += 0.3
      } else {
        this.queue.push({ at, kind: 'potion' })
        delay += 0.2
      }
    }
    return blow
  }

  // El oro y la experiencia sobre el monstruo que cae: lo que el juego dijo que
  // cobro ("cae el mosquito: +12 oro, +18 exp"), no la tabla del monstruo, que
  // el reparto del juego ajusta.
  victory(said, at) {
    const spot = this.spot
    if (!spot) return
    const L = this.L
    let paid = null
    for (let i = said.length - 1; i >= Math.max(0, said.length - 6) && !paid; i--) {
      paid = /^cae el .*: \+(\d+) oro, \+(\d+) exp/.exec(String(said[i]))
    }
    if (!paid) return
    // Sobre el heroe, que es quien cobra, del lado contrario al monstruo (ahi
    // todavia sube el numero del ultimo golpe) y despues de que cae.
    const hero = this.ctx.hero.root.position
    const away = Math.sign(hero.x - spot.x) || -1
    const x = hero.x + away * 0.9
    const [gold, xp] = [Number(paid[1]), Number(paid[2])]
    if (gold > 0) {
      this.number(`+${gold} ${L('gold', 'oro')}`, '#f2c94a', x, 3.1, hero.z, at, 0.5)
    }
    if (xp > 0) {
      this.number(`+${xp} ${L('XP', 'exp')}`, '#8fc8ff', x, 2.55, hero.z, at, 0.8)
    }
  }

  update(time, dt) {
    const hero = this.ctx.hero.root
    for (let i = 0; i < this.queue.length; ) {
      if (this.queue[i].at > time) i++
      else this.play(this.queue.splice(i, 1)[0], time)
    }
    if (this.engaged !== null) this.spot = this.crowd.spot(this.engaged) || this.spot
    // El heroe mira al monstruo mientras pelea.
    if (this.engaged !== null && this.spot) {
      const want = Math.atan2(this.spot.x - hero.position.x, this.spot.z - hero.position.z)
      const delta = Math.atan2(Math.sin(want - hero.rotation.y), Math.cos(want - hero.rotation.y))
      hero.rotation.y += delta * Math.min(1, dt * 10)
    }
    this.dolly(dt)
    // El heroe se lanza al golpe y retrocede si le pegan: la figura, no la celda.
    const lunge = time - this.heroLunge
    const recoil = time - this.heroRecoil
    let forward = 0
    let lean = 0
    if (lunge >= 0 && lunge < 0.3) {
      const k = Math.sin((lunge / 0.3) * Math.PI)
      forward += k * 0.55
      lean += k * 0.3
    }
    if (recoil >= 0 && recoil < 0.3) {
      const k = (1 - recoil / 0.3) ** 2
      forward -= k * 0.28
      lean -= k * 0.18
    }
    for (const child of hero.children) {
      child.position.z = forward
      child.rotation.x = lean
    }
    // El tajo gira y se apaga; el proyectil vuela; la onda se abre.
    const slash = time - this.slashAt
    this.slash.visible = slash >= 0 && slash < 0.28
    if (this.slash.visible) {
      // El arco abre hacia +x; girado yaw - 90 grados queda de cara al monstruo
      // y barre de un lado al otro (el siguiente tajo, al reves).
      const k = slash / 0.28
      this.slash.material.opacity = (1 - k * k) * 0.95
      this.slash.rotation.y = this.slashYaw - Math.PI / 2 + (k - 0.5) * 1.4 * this.slashSide
      this.slash.position.set(hero.position.x, 1.1, hero.position.z)
    }
    const bolt = time - this.boltAt
    this.bolt.visible = bolt >= 0 && bolt < 0.16
    if (this.bolt.visible) {
      this.bolt.position.lerpVectors(this.boltFrom, this.boltTo, bolt / 0.16)
      this.bolt.lookAt(this.boltTo)
    }
    const burst = time - this.burstAt
    this.burst.visible = burst >= 0 && burst < 0.3
    if (this.burst.visible) {
      const k = burst / 0.3
      this.burst.scale.setScalar(1 + k * 3.2)
      this.burst.material.opacity = (1 - k) * 0.9
    }
    const spark = time - this.sparkAt
    this.spark.visible = spark >= 0 && spark < 0.22
    if (this.spark.visible) {
      const k = spark / 0.22
      this.spark.scale.setScalar(0.7 + Math.sin(k * Math.PI * 0.5) * 1.3)
      this.spark.material.opacity = 1 - k * k
      this.spark.material.rotation = k * 0.8
    }
    const fighting = this.engaged !== null && !!this.spot
    this.foeRing.visible = fighting
    this.heroRing.visible = fighting
    if (fighting) {
      const pulse = 1 + Math.sin(time * 6) * 0.06
      this.foeRing.position.set(this.spot.x, 0.035, this.spot.z)
      this.foeRing.scale.setScalar(pulse * (this.spot.style === 'stomp' ? 1.35 : 1))
      this.heroRing.position.set(hero.position.x, 0.035, hero.position.z)
    }
    for (const entry of [...this.numbers]) {
      const k = (time - entry.start) / 1.1
      if (k < 0) continue
      if (k >= 1) {
        this.drop(entry)
        continue
      }
      entry.sprite.visible = true
      entry.sprite.position.y = entry.y + k * 1.1
      entry.sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.55 : 1.15 - Math.min(0.15, (k - 0.12) * 0.5)
      entry.sprite.scale.set(entry.w * pop, entry.h * pop, 1)
    }
  }

  // La camara se acerca durante la pelea y vuelve despues, sin perder el angulo
  // ni la distancia que eligio quien juega: solo cambia el largo de su brazo.
  dolly(dt) {
    const zoom = this.zoom
    const want = this.engaged !== null
    if (!want && zoom.k <= 0) return
    const camera = this.ctx.camera
    const hero = this.ctx.hero.root.position
    const target = V3.set(hero.x, 1, hero.z)
    const arm = camera.position.clone().sub(target)
    if (zoom.k <= 0) zoom.base = arm.length()
    zoom.k = Math.max(0, Math.min(1, zoom.k + (want ? dt * 2.2 : -dt * 1.6)))
    const ease = zoom.k * zoom.k * (3 - 2 * zoom.k)
    arm.setLength(zoom.base * (1 - 0.42 * ease))
    camera.position.copy(target).add(arm)
  }

  // Lo que pasa en un momento de la cola.
  play(item, time) {
    const hero = this.ctx.hero.root.position
    const spot = item.id === undefined ? null : this.crowd.spot(item.id) || this.spot
    if (item.kind === 'advance') {
      // Un turno sin golpe (el heroe se acerca o espera su arma): solo el paso.
      this.heroLunge = time
    } else if (item.kind === 'swing') {
      this.heroLunge = time
      const style = WEAPON_STYLE[item.weapon] || 'punch'
      if (style === 'shot' && spot) {
        this.boltFrom.set(hero.x, 1.35, hero.z)
        this.boltTo.set(spot.x, Math.max(0.8, spot.top * 0.6), spot.z)
        this.boltAt = time + 0.02
        this.bolt.material.color.setHex(0xe8d8a0)
      } else if (spot) {
        this.slashAt = time
        this.slashYaw = Math.atan2(spot.x - hero.x, spot.z - hero.z)
        this.slashSide = -this.slashSide
        const tone = { smash: 0xffd080, punch: 0xffe8d0, thrust: 0xfff8e0 }[style] || 0xfff2c8
        this.slash.material.color.setHex(tone)
        this.slash.scale.setScalar(style === 'smash' ? 1.25 : style === 'punch' ? 0.7 : 1)
      }
    } else if (item.kind === 'foe-hit' && spot) {
      this.crowd.hit(item.id, time)
      this.burstAt = time
      this.burst.position.set(spot.x, Math.max(0.3, spot.top * 0.55), spot.z)
      this.burst.material.color.setHex(0xfff0c8)
      this.sparkle(spot.x, Math.max(0.6, spot.top * 0.6), spot.z, 0xfff0b0, time)
      this.number(`-${item.amount}`, '#fff4e0', spot.x, spot.top + 0.3, spot.z, time)
      this.barHp = item.hp
    } else if (item.kind === 'foe-swing') {
      this.crowd.strike(item.id, time)
      const shot = spot ? FOE_SHOT[spot.kind] : undefined
      if (shot !== undefined) {
        this.boltFrom.set(spot.x, Math.max(0.9, spot.top * 0.6), spot.z)
        this.boltTo.set(hero.x, 1.2, hero.z)
        this.boltAt = time + 0.04
        this.bolt.material.color.setHex(shot)
      }
    } else if (item.kind === 'hero-hit') {
      this.heroRecoil = time
      this.burstAt = time
      this.burst.position.set(hero.x, 1.0, hero.z)
      this.burst.material.color.setHex(0xff5040)
      this.sparkle(hero.x, 1.3, hero.z, 0xff7050, time)
      this.number(`-${item.amount}`, '#ff6a50', hero.x, 2.6, hero.z, time)
      const flash = this.bits.flash
      flash.hidden = false
      flash.classList.add('on')
      globalThis.requestAnimationFrame(() => flash.classList.remove('on'))
    } else if (item.kind === 'potion') {
      this.number(this.L('+potion', '+pocion'), '#7fe08a', hero.x, 2.6, hero.z, time)
    }
  }

  dispose() {
    this.ctx.scene.remove(this.group)
    for (const entry of [...this.numbers]) this.drop(entry)
    for (const { texture } of this.textures.values()) texture.dispose()
    for (const mesh of [this.slash, this.bolt, this.burst, this.foeRing, this.heroRing]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    this.spark.material.map.dispose()
    this.spark.material.dispose()
    for (const child of this.ctx.hero.root.children) {
      child.position.z = 0
      child.rotation.x = 0
    }
    this.bits.foebar.hidden = true
    this.bits.hint.hidden = true
    this.bits.hint.textContent = ''
  }
}

// ---------------------------------------------------------------------------
// La pradera.

export function createMeadow(ctx) {
  CX = ctx.CX || CX
  CZ = ctx.CZ || CZ
  const L = ctx.L || ((en, es) => es)
  const session = () => (ctx.session ? ctx.session() : null)
  const touch = globalThis.matchMedia ? globalThis.matchMedia('(pointer: coarse)').matches : false

  // Los nombres de las puertas y carteles, en el idioma elegido.
  function names() {
    return {
      // Las puertas de los reinos van con su nombre solo: el cartel queda chico y
      // no se mete en la muralla.
      runa: 'RUNA',
      nox: 'NOX',
      crypt: L('the crypt', 'la cripta'),
      portal: L('Colossus portal', 'portal del Coloso'),
      solid: L('a palisade', 'una empalizada'),
      crossroads: ['runa <---+---> nox', '         |', L('   portal|crypt', '   portal|cripta')]
    }
  }

  // Lo que el juego empaquetado ofrece de la pradera (juego.js meadow), o null
  // si todavia no llego.
  const kit = () => {
    const game = ctx.bundle ? ctx.bundle() : null
    return game && game.meadow ? game.meadow : null
  }

  // Los datos se arman una vez por campo (semilla, empalizadas que quedan) e
  // idioma: el mapa se vuelve a armar al cambiar de idioma.
  const cache = new Map()
  const stats = { dataMs: 0, landmarksMs: 0, foes: 0 }
  function dataFor(meadow, field) {
    const key = [field.seed, field.settlements.map((s) => s.id).join(','), L('en', 'es')].join('|')
    if (!cache.has(key)) {
      const start = performance.now()
      cache.set(key, meadowMap(meadow, field, names()))
      stats.dataMs = Math.round((performance.now() - start) * 10) / 10
      while (cache.size > 3) cache.delete(cache.keys().next().value)
    }
    return cache.get(key)
  }

  // La pradera del recorrido: un Field del juego con semilla fija, sin partida.
  let tourField = null
  function tourMeadow(meadow) {
    if (!tourField) tourField = new meadow.Field({ seed: TOUR_SEED })
    return tourField
  }

  // El juego empaquetado tarda en llegar: el recorrido puede pedir la pradera
  // antes. Se espera hasta 20 s y despues se rinde (la pagina avisa).
  function whenKit() {
    return new Promise((resolve, reject) => {
      const begin = performance.now()
      const wait = () => {
        const meadow = kit()
        if (meadow) resolve(meadow)
        else if (performance.now() - begin > 20000) reject(new Error('sin el juego'))
        else globalThis.setTimeout(wait, 150)
      }
      wait()
    })
  }

  // El campo de la partida, si esta en la pradera.
  function liveField() {
    const game = session()
    const field = game && game.runa ? game.runa.field : null
    return field && field.mode === 'field' ? field : null
  }

  function provide(id) {
    if (id !== 'field') return null
    const meadow = kit()
    const field = liveField()
    if (meadow && field) return dataFor(meadow, field)
    if (meadow && !session()) return dataFor(meadow, tourMeadow(meadow))
    return whenKit().then((loaded) => dataFor(loaded, liveField() || tourMeadow(loaded)))
  }

  function worldAt(st) {
    if (!st || st.field !== 'field' || !st.location) return null
    const at = { map: 'field', x: st.location.x, y: st.location.y }
    st.world = at
    return at
  }

  // Lo que la pagina muestra ahora de la pradera: el mapa, sus lugares, los
  // monstruos y el combate.
  let shown = null
  let places = null
  let crowd = null
  let fx = null
  let bits = null

  function handlesCombat(st) {
    return !!(st && st.combat && st.field === 'field' && shown)
  }

  function setUp(world) {
    shown = world
    const start = performance.now()
    places = buildLandmarks(world.data.meadow, ctx, names())
    world.built.group.add(places.group)
    stats.landmarksMs = Math.round(performance.now() - start)
    bits = pageBits()
    crowd = new Crowd(ctx, world, L)
    fx = new Effects(ctx, crowd, bits, L)
  }

  function tearDown() {
    if (crowd) crowd.dispose()
    if (fx) fx.dispose()
    crowd = null
    fx = null
    places = null
    shown = null
  }

  function update(time, dt, st, world) {
    if (!world || world.map !== 'field' || !world.data || !world.data.meadow) return
    if (!shown || shown.built !== world.built) {
      if (shown) tearDown()
      setUp(world)
    }
    places.update(time)
    if (st) {
      const game = session()
      const said = game && game.runa && Array.isArray(game.runa.log) ? game.runa.log : []
      fx.sync(st, liveField(), said, time, touch)
      crowd.sync(st.foes || [], time)
      fx.settle()
    } else {
      const meadow = kit()
      if (meadow && tourField) crowd.tour(tourField, meadow, dt, time)
    }
    crowd.update(time, dt)
    fx.update(time, dt)
    stats.foes = crowd.count()
  }

  function leave(mapId) {
    if (mapId !== 'field' || !shown) return
    // Si el juego saco al heroe del campo en medio de una pelea, cayo: ya lo
    // puso en la iglesia. Se avisa un momento. (Cambiar de idioma o salir al
    // titulo tambien deja el mapa, pero el juego sigue en el campo o termino.)
    const game = session()
    const fell = !!fx && fx.fighting() && !!game && !!game.runa && !game.runa.field
    tearDown()
    if (fell && bits) showFall(bits.fell, L)
  }

  // Para medir y probar desde la consola: lo que tarda en armarse, lo que esta
  // pasando, el campo que se ve y apagar partes para ver cuanto cuesta cada una.
  globalThis.runaMeadow = () => ({
    ...stats,
    shown: shown ? shown.map : null,
    fight: fx ? fx.debug() : null
  })
  globalThis.runaMeadowField = () => liveField() || tourField
  globalThis.runaMeadowRows = (x0, y0, x1, y1) =>
    shown ? shown.data.rows.slice(y0, y1).map((row) => row.slice(x0, x1)) : null
  globalThis.runaMeadowToggle = (what, on) => {
    if (what === 'places' && places) places.group.visible = on
    if (what === 'crowd' && crowd) crowd.group.visible = on
    if (what === 'world' && shown) {
      for (const child of shown.built.group.children) {
        if (!places || child !== places.group) child.visible = on
      }
    }
    return true
  }

  return { provide, worldAt, handlesCombat, update, leave }
}
