// El terreno de la vista 2.5D: lo que buildWorld (tripo-mundo.js) suma alrededor
// y encima del suelo del mapa, despues de los edificios y la vegetacion.
//
//  - El paisaje de afuera: el mapa ya no termina en un plano. Alrededor suben
//    lomas suaves junto a la muralla, bosques y, lejos, montanas que se pierden
//    en la niebla. Es un campo de alturas con ruido de Perlin (ImprovedNoise,
//    como el ejemplo webgl_geometry_terrain de three.js) sobre anillos que
//    rodean el mapa: finos junto al borde y anchos lejos. Cada vertice toma
//    color por altura y pendiente (pasto, tierra, roca, nieve) y de cada porton
//    del borde sale un camino que serpentea entre las lomas. Los arboles y las
//    piedras de afuera van en la misma malla: un solo dibujado.
//  - El pasto: matas instanciadas alrededor de lo que mira la camara, solo donde
//    el mapa tiene pasto (y en el campo de afuera, junto al borde). Se mecen con
//    el viento, se abren al paso del heroe y son menos en una pantalla chica.
//
// Recibe `world`:
//   data        el mapa (/world/<id>.json): rows, tiles, width, height, kind, id
//   kinds       la clase de cada celda (y * width + x)
//   inBuilding  1 en las celdas que ya son parte de un edificio
//   toWorld     (x, y) => Vector3 del centro de la celda, en el piso
//   CX, CZ      lo que mide una celda: columna y fila
//   palette     los colores del mapa
//   ground      la malla del suelo del mapa (y = 0, el heroe camina ahi)
//   clock       { value }: segundos, se actualiza al dibujar el suelo
//   group       donde se agregan las mallas (se liberan con el mapa)
//   detail      la textura de grano del suelo, compartida: R grano, G adoquines,
//               B grava, A manchas grandes (no se libera aca)
//   mood        el tono del suelo del mapa: { tint, patch }
//
// Devuelve { update(time), dispose() } (los dos opcionales) o null.
import * as THREE from 'three'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { matchMedia } = globalThis

const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

// Hasta donde llega el paisaje, en metros desde el borde del mapa: la niebla de
// los mapas termina a 150 m de la camara.
const REACH = 215

// El paisaje de cada mapa. seed elige el relieve; hills es el alto de las lomas
// junto al mapa y peaks el de las montanas, que crecen entre far[0] y far[1]
// metros del borde; span es el ancho de sus crestas y snow donde empieza la
// nieve. Los colores: meadow va del valle a la loma seca, forest es el suelo
// bajo los arboles, rock la roca de lo empinado, top la de las cumbres y
// snowColor la nieve. pines y oaks son las copas y trunk los troncos; trees
// cuanto bosque hay, oak cuantos son robles, cypress cambia los pinos cercanos
// por cipreses y rocks cuantas piedras sueltas hay. glow enciende el suelo: vetas
// de lava en las ruinas, musgo en NOX; fungi cuantas rondas de hongos que brillan
// crecen junto al mapa.
const LANDS = {
  city: {
    seed: 3,
    hills: 7.5,
    peaks: 44,
    far: [58, 150],
    span: 64,
    snow: 25,
    meadow: [0x43692a, 0x5a8434, 0x8c9a4b],
    forest: 0x2a4321,
    rock: 0x766f62,
    top: 0x8b8679,
    snowColor: 0xf1f4f7,
    pines: [0x2a5230, 0x305b34, 0x3a6838, 0x27492e],
    oaks: [0x4a7a32, 0x578536, 0x668b3a, 0xa8682c],
    trunk: 0x5b3d24,
    trees: 0.5,
    oak: 0.38,
    rocks: 0.1
  },
  castle: {
    seed: 7,
    hills: 8,
    peaks: 46,
    far: [50, 140],
    span: 60,
    snow: 26,
    meadow: [0x43692a, 0x5a8434, 0x8c9a4b],
    forest: 0x2a4321,
    rock: 0x766f62,
    top: 0x8b8679,
    snowColor: 0xf1f4f7,
    pines: [0x2a5230, 0x305b34, 0x3a6838, 0x27492e],
    oaks: [0x4a7a32, 0x578536, 0x668b3a, 0xa8682c],
    trunk: 0x5b3d24,
    trees: 0.55,
    oak: 0.3,
    rocks: 0.12
  },
  nox: {
    seed: 11,
    hills: 9,
    peaks: 52,
    far: [55, 145],
    span: 52,
    snow: 34,
    meadow: [0x1f2c2a, 0x293838, 0x3a4446],
    forest: 0x161e20,
    rock: 0x37334a,
    top: 0x4a465e,
    snowColor: 0x9aa6c8,
    pines: [0x1c2c38, 0x223444, 0x262f45, 0x1a2630],
    oaks: [0x3a365c, 0x443e6c, 0x2e3a52],
    trunk: 0x2a2230,
    trees: 0.48,
    oak: 0.25,
    rocks: 0.16,
    glow: 'fungi',
    fungi: 0.3
  },
  coliseum: {
    seed: 5,
    hills: 6,
    peaks: 34,
    far: [55, 150],
    span: 75,
    snow: 99,
    meadow: [0x5f7434, 0x8a8c45, 0xb59f5e],
    forest: 0x46562a,
    rock: 0x9a7b58,
    top: 0xb09070,
    snowColor: 0xf1f4f7,
    pines: [0x2a4628, 0x2f4e2c, 0x35552f],
    oaks: [0x6b7a46, 0x7a8752, 0x5f7040],
    trunk: 0x5e4630,
    trees: 0.3,
    oak: 0.55,
    rocks: 0.14,
    cypress: true
  },
  boss: {
    seed: 13,
    hills: 10,
    peaks: 58,
    far: [45, 130],
    span: 48,
    snow: 99,
    meadow: [0x3a332f, 0x4b423c, 0x5d5249],
    forest: 0x2a2320,
    rock: 0x1b1819,
    top: 0x4f4741,
    snowColor: 0x8a8079,
    pines: [0x2a2420],
    oaks: [0x2a2420],
    trunk: 0x1e1816,
    trees: 0,
    oak: 0,
    rocks: 0.6,
    glow: 'lava'
  }
}

// Ruido fractal de Perlin: `octaves` capas, cada una del doble de detalle y la
// mitad de peso. Va de -1 a 1, casi siempre dentro de +-0,6.
function fractal(perlin, seed) {
  return (x, z, octaves) => {
    let sum = 0
    let weight = 1
    let total = 0
    let f = 1
    for (let o = 0; o < octaves; o++) {
      sum += perlin.noise(x * f, z * f, seed + o * 7.31) * weight
      total += weight
      weight *= 0.5
      f *= 2.03
    }
    return sum / total
  }
}

// Crestas: el ruido doblado sobre si mismo (1 - |n|), al cuadrado, con cada capa
// pesada por la anterior. Da cordilleras con filos y valles anchos. De 0 a 1.
function ridges(perlin, seed) {
  return (x, z, octaves) => {
    let sum = 0
    let weight = 1
    let total = 0
    let f = 1
    let prev = 1
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(perlin.noise(x * f, z * f, seed + 50 + o * 3.7))
      const v = n * n * prev
      prev = clamp(v * 1.6, 0, 1)
      sum += v * weight
      total += weight
      weight *= 0.5
      f *= 2.1
    }
    return sum / total
  }
}

// Los portones que dan al campo: los que estan a pocos metros del borde del mapa
// (no las escaleras a las ruinas). De cada uno sale un camino derecho hacia
// afuera que despues serpentea entre las lomas. Hasta cuatro por mapa.
function gateRoads(data, CX, CZ) {
  const { width, height, rows, tiles } = data
  const W = width * CX
  const D = height * CZ
  const roads = []
  for (let y = 0; y < height && roads.length < 4; y++) {
    const row = rows[y] || ''
    for (let x = 0; x < width && roads.length < 4; x++) {
      const tile = tiles[row[x]]
      if (!tile || !tile.id.startsWith('gate.') || tile.id.includes('dungeon')) continue
      const cx = (x + 0.5) * CX
      const cz = (y + 0.5) * CZ
      // [distancia al borde, direccion hacia afuera, punto del borde]
      const sides = [
        [cz, 0, -1, cx, 0],
        [W - cx, 1, 0, W, cz],
        [D - cz, 0, 1, cx, D],
        [cx, -1, 0, 0, cz]
      ].sort((a, b) => a[0] - b[0])
      const [gap, dx, dz, ox, oz] = sides[0]
      if (gap > 8) continue
      roads.push({
        ox,
        oz,
        dx,
        dz,
        amp: 4 + hash(x, y) * 6,
        phase: hash(y, x) * 6.28,
        half: 1.35,
        length: 165
      })
    }
  }
  return roads
}

// Donde cae un punto respecto de un camino: cuanto avanzo desde el porton (t) y
// a que distancia de su eje esta. El eje sale derecho y despues ondula.
function roadOffset(road, t) {
  return road.amp * Math.sin(t * 0.05 + road.phase) * smooth(0, 30, t)
}
function roadDistance(road, x, z) {
  const qx = x - road.ox
  const qz = z - road.oz
  const t = qx * road.dx + qz * road.dz
  if (t < 0) return [t, Infinity]
  const side = -qx * road.dz + qz * road.dx
  return [t, Math.abs(side - roadOffset(road, t))]
}

// La altura del paisaje en (x, z), en metros: 0 dentro del mapa y en su borde.
// Junto al mapa las lomas suben despacio, y del lado sur mas despacio todavia: la
// camara del juego mira desde el sur y una loma alta taparia al heroe. Lejos
// crecen las montanas. Cerca de un camino el suelo se aplana como un valle.
function heightField(land, W, D, roads) {
  const perlin = new ImprovedNoise()
  const seed = land.seed * 13.7
  const fbm = fractal(perlin, seed)
  const ridge = ridges(perlin, seed)
  const height = (x, z) => {
    const dx = x < 0 ? -x : x > W ? x - W : 0
    const dz = z < 0 ? -z : z > D ? z - D : 0
    const r = Math.hypot(dx, dz)
    if (r < 1e-6) return 0
    // 1 al norte del mapa, -1 al sur.
    const north = ((z < 0 ? 1 : z > D ? -1 : 0) * dz) / r
    const k = (north + 1) / 2
    const rise = smooth(4 - 3 * k, 48 - 26 * k, r)
    const swell = fbm(x / 34, z / 34, 4) * 0.5 + 0.5
    const broad = fbm(x / 150 + 7.3, z / 150 - 2.1, 2) * 0.5 + 0.5
    let h = rise * land.hills * (0.2 + swell * 0.95) * (0.55 + broad * 0.9)
    const far = smooth(land.far[0], land.far[1], r)
    if (far > 0) {
      const crest = Math.max(0, ridge(x / land.span, z / land.span, 4) - 0.28) / 0.72
      h += far * land.peaks * crest * (0.55 + broad * 0.7)
    }
    for (const road of roads) {
      const [t, d] = roadDistance(road, x, z)
      if (d === Infinity) continue
      const valley = (1 - smooth(road.half + 1, road.half + 13, d)) * (1 - smooth(110, 170, t))
      h *= 1 - valley * 0.9
    }
    return h
  }
  height.fbm = fbm
  return height
}

// Los puntos del borde del mapa con su normal hacia afuera, en orden: cada lado
// cada `step` metros y cada esquina en un abanico de `arc` puntos. Un anillo del
// paisaje es este borde corrido r metros hacia afuera: [x, z, nx, nz].
function perimeter(W, D, step, arc) {
  const out = []
  const side = (x0, z0, x1, z1, nx, nz) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step))
    for (let i = 0; i < n; i++) {
      out.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, nx, nz])
    }
  }
  const corner = (x, z, from) => {
    for (let i = 0; i < arc; i++) {
      const a = from + ((i / arc) * Math.PI) / 2
      out.push([x, z, Math.cos(a), Math.sin(a)])
    }
  }
  side(0, 0, W, 0, 0, -1)
  corner(W, 0, -Math.PI / 2)
  side(W, 0, W, D, 1, 0)
  corner(W, D, 0)
  side(W, D, 0, D, 0, 1)
  corner(0, D, Math.PI / 2)
  side(0, D, 0, 0, -1, 0)
  corner(0, 0, Math.PI)
  return out
}

// Arboles, piedras y hongos de afuera, armados una vez: cada parte con sus caras
// planas (el look de pocos poligonos), y por vertice si es copa (1) o tronco (0),
// cuanto se oscurece abajo y si brilla sola (shine, el sombrero de un hongo). Los
// de lejos tienen menos caras.
let shapes = null
function landShapes() {
  if (shapes) return shapes
  const part = (geometry, leaf, shade, shine = 0) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    flat.computeVertexNormals()
    flat.computeBoundingBox()
    const { min, max } = flat.boundingBox
    const p = flat.attributes.position
    const n = flat.attributes.normal
    const out = { position: [], normal: [], leaf: [], dark: [], shine: [] }
    for (let i = 0; i < p.count; i++) {
      out.position.push(p.getX(i), p.getY(i), p.getZ(i))
      out.normal.push(n.getX(i), n.getY(i), n.getZ(i))
      out.leaf.push(leaf)
      out.dark.push(1 - shade * (1 - (p.getY(i) - min.y) / (max.y - min.y || 1)))
      out.shine.push(shine)
    }
    return out
  }
  const join = (parts) => {
    const out = { position: [], normal: [], leaf: [], dark: [], shine: [] }
    for (const p of parts) for (const key in out) out[key].push(...p[key])
    return out
  }
  // Un hongo: pie palido y sombrero chato que brilla. [radio, alto, x, z]
  const mushroom = ([r, h, x, z]) => [
    part(
      new THREE.CylinderGeometry(r * 0.22, r * 0.3, h, 5, 1, true).translate(x, h / 2, z),
      0,
      0.3
    ),
    part(new THREE.ConeGeometry(r, r * 0.55, 7).translate(x, h + r * 0.2, z), 1, 0.15, 1)
  ]
  const trunk = (r, h, sides = 3) =>
    part(new THREE.CylinderGeometry(r * 0.6, r, h, sides, 1, true).translate(0, h / 2, 0), 0, 0)
  const cone = (r, h, y, sides) =>
    part(new THREE.ConeGeometry(r, h, sides, 1, true).translate(0, y + h / 2, 0), 1, 0.4)
  // Una piedra: un icosaedro con cada vertice corrido segun su lugar.
  const stone = new THREE.IcosahedronGeometry(1, 0)
  const sp = stone.attributes.position
  for (let i = 0; i < sp.count; i++) {
    const [x, y, z] = [sp.getX(i), sp.getY(i), sp.getZ(i)]
    const k = 0.72 + hash(Math.round(x * 97), Math.round(y * 89) * 3 + Math.round(z * 83)) * 0.5
    sp.setXYZ(i, x * k, y * k * 0.62, z * k)
  }
  shapes = {
    pine: join([trunk(0.16, 1.1), cone(1.05, 2.1, 0.7, 6), cone(0.74, 1.7, 1.9, 6)]),
    oak: join([
      trunk(0.2, 1.6),
      part(new THREE.IcosahedronGeometry(1.25, 0).scale(1, 0.86, 1).translate(0, 2.4, 0), 1, 0.45)
    ]),
    cypress: join([trunk(0.12, 0.6), cone(0.52, 3.6, 0.35, 6)]),
    farPine: cone(0.95, 3.2, 0.2, 5),
    farOak: part(new THREE.OctahedronGeometry(1.3).scale(1, 0.9, 1).translate(0, 2, 0), 1, 0.4),
    rock: part(stone, 0, 0.35),
    // Una ronda de hongos de NOX, grandes como para verse desde la camara alta.
    fungi: join(
      [
        [0.42, 0.55, 0, 0],
        [0.3, 0.4, 0.62, 0.25],
        [0.24, 0.3, -0.45, 0.5],
        [0.2, 0.26, 0.15, -0.6],
        [0.16, 0.2, -0.55, -0.35]
      ].flatMap(mushroom)
    )
  }
  return shapes
}

// El material del paisaje: el color de cada vertice con el mismo grano y las
// mismas manchas que el suelo del mapa (asi el borde no se nota), mas manchas
// mas grandes lejos, los caminos que salen de los portones y, segun el mapa,
// vetas de lava o manchas de hongos que brillan solas. `road` es el color de los
// caminos.
function landMaterial(world, land, roads, road) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 })
  const patch = (world.mood && world.mood.patch) || [1.9, 1.45, 1.15]
  const clock = world.clock || { value: 0 }
  const palette = world.palette || {}
  const glow = new THREE.Color(land.glow === 'lava' ? 0xff5a1a : palette.glow || 0xb78cff)
  const vein = new THREE.Color(palette.vein || palette.glow || 0x5fe8c8)
  const lanes = roads.map((r) => new THREE.Vector4(r.ox, r.oz, r.dx, r.dz))
  const waves = roads.map((r) => new THREE.Vector4(r.amp, r.phase, r.half, r.length))
  while (lanes.length < 4) {
    lanes.push(new THREE.Vector4())
    waves.push(new THREE.Vector4())
  }
  if (land.glow === 'lava') material.defines = { LAND_LAVA: '' }
  if (land.glow === 'fungi') material.defines = { LAND_FUNGI: '' }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      clock,
      landDetail: { value: world.detail },
      landPatch: { value: new THREE.Vector3(...patch) },
      landRoads: { value: lanes },
      landWaves: { value: waves },
      landRoadCount: { value: roads.length },
      landRoad: { value: road },
      landGlow: { value: glow },
      landVein: { value: vein }
    })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 land;\nvarying vec3 vLand;\nvarying float vLandEdge;\nvarying float vLandShine;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLand = position;\nvLandEdge = land.x;\nvLandShine = land.y;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D landDetail;
        uniform vec3 landPatch;
        uniform vec4 landRoads[4];
        uniform vec4 landWaves[4];
        uniform int landRoadCount;
        uniform vec3 landRoad;
        uniform vec3 landGlow;
        uniform vec3 landVein;
        uniform float clock;
        varying vec3 vLand;
        varying float vLandEdge;
        varying float vLandShine;
        // Ruido de valor calculado y no leido de una textura: sus curvas de nivel
        // quedan netas a cualquier distancia (las de una textura de 8 bits se
        // escalonan). De 0 a 1.
        float landHash( vec2 p ) {
          return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
        }
        float landNoise( vec2 p ) {
          vec2 i = floor( p );
          vec2 f = fract( p );
          vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
          float a = landHash( i );
          float b = landHash( i + vec2( 1.0, 0.0 ) );
          float c = landHash( i + vec2( 0.0, 1.0 ) );
          float d = landHash( i + vec2( 1.0, 1.0 ) );
          return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
        }
        // Cuanto camino hay en p (x) y cuanto de sus huellas de carro (y), a 75 cm
        // del eje como las del mapa: el eje sale del porton y ondula como en la CPU.
        vec2 landRoadAt( vec2 p, float grain ) {
          vec2 lane = vec2( 0.0 );
          for ( int i = 0; i < 4; i ++ ) {
            if ( i >= landRoadCount ) break;
            vec2 q = p - landRoads[ i ].xy;
            vec2 d = landRoads[ i ].zw;
            vec4 w = landWaves[ i ];
            float t = dot( q, d );
            float side = dot( q, vec2( - d.y, d.x ) ) - w.x * sin( t * 0.05 + w.y ) * smoothstep( 0.0, 30.0, t );
            float wide = w.z * ( 1.0 + 0.25 * smoothstep( 20.0, 120.0, t ) ) + ( grain - 0.5 ) * 0.6;
            float on = 1.0 - smoothstep( wide - 0.35, wide + 0.35, abs( side ) );
            on *= step( 0.0, t ) * ( 1.0 - smoothstep( w.w * 0.7, w.w, t ) );
            if ( on > lane.x ) {
              float track = abs( abs( side ) - 0.75 );
              lane = vec2( on, on * ( 1.0 - smoothstep( 0.0, 0.26, track ) ) );
            }
          }
          return lane;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 landAt = vLand.xz;
        vec4 fine = texture2D( landDetail, landAt * 0.5 );
        float broad = texture2D( landDetail, landAt * 0.11 + vec2( 0.37, 0.61 ) ).a;
        float spots = texture2D( landDetail, landAt * 0.031 + vec2( 0.13, 0.71 ) ).a;
        float macro = texture2D( landDetail, landAt * 0.0071 + vec2( 0.52, 0.24 ) ).a;
        float lum = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
        vec3 tone = mix( vec3( 0.86, 0.83, 0.8 ), landPatch, 1.0 - smoothstep( 0.1, 0.14, lum ) );
        diffuseColor.rgb *= mix( vec3( 1.0 ), tone, smoothstep( 0.34, 0.66, spots ) );
        diffuseColor.rgb *= 0.82 + 0.36 * ( fine.r * 0.4 + broad * 0.6 );
        diffuseColor.rgb *= mix( 1.0, 0.78 + 0.44 * macro, smoothstep( 3.0, 30.0, vLandEdge ) );
        // El camino lleva el mismo grano y la misma grava que el del mapa, y sus
        // huellas, asi del porton para afuera sigue igual.
        vec2 lane = landRoadAt( landAt, fine.r );
        float road = lane.x;
        vec3 dirt = landRoad * mix( 1.0, 0.62 + 0.62 * fine.b, 0.45 ) * ( 0.82 + 0.36 * ( fine.r * 0.4 + broad * 0.6 ) );
        dirt *= vec3( 1.0 - 0.36 * lane.y, 1.0 - 0.4 * lane.y, 1.0 - 0.46 * lane.y );
        diffuseColor.rgb = mix( diffuseColor.rgb * ( 1.0 - 0.12 * road ), dirt, road * 0.92 );
        vec3 landShine = vec3( 0.0 );
        #ifdef LAND_LAVA
          // La ceniza se agrieta en placas como la de las ruinas, y de lejos las
          // grietas se pierden.
          float plates = texture2D( landDetail, landAt * 0.085 + vec2( 0.41, 0.17 ) ).g;
          float ashCrack = ( 1.0 - smoothstep( 0.16, 0.36, plates ) ) * ( 1.0 - smoothstep( 35.0, 80.0, vLandEdge ) );
          diffuseColor.rgb *= 1.0 - 0.55 * ashCrack;
          // Rios de lava: donde el ruido grande cruza su mitad, desde unos metros
          // afuera de la muralla. El cauce brilla amarillo en el medio y rojo en el
          // borde; a los costados la lava se enfrio en una costra negra con alguna
          // grieta todavia al rojo. Coladas viejas oscurecen la ceniza en manchones.
          vec2 flowAt = landAt * 0.021 + vec2( 3.7, 1.3 );
          float course = landNoise( flowAt ) * 0.7 + landNoise( flowAt * 2.7 + 5.1 ) * 0.3;
          float vein = abs( course - 0.5 ) + ( fine.r - 0.5 ) * 0.006;
          float edge = fwidth( vein ) * 0.75;
          float away = smoothstep( 6.0, 16.0, vLandEdge );
          float lava = ( 1.0 - smoothstep( 0.016 - edge, 0.016 + edge, vein ) ) * away;
          float core = 1.0 - smoothstep( 0.0, 0.01, vein );
          float crust = ( 1.0 - smoothstep( 0.03, 0.05 + edge, vein ) ) * away;
          float flowsOld = smoothstep( 0.55, 0.7, macro ) * smoothstep( 4.0, 12.0, vLandEdge );
          diffuseColor.rgb *= 1.0 - 0.45 * flowsOld;
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.035, 0.025, 0.022 ) * ( 0.7 + 0.6 * fine.g ), max( lava, crust ) );
          float pulse = 0.82 + 0.18 * sin( clock * 1.3 + landAt.x * 0.05 + landAt.y * 0.03 );
          vec3 molten = mix( vec3( 1.5, 0.3, 0.05 ), vec3( 2.6, 1.3, 0.3 ), core );
          float cracks = crust * ( 1.0 - lava ) * ( 1.0 - smoothstep( 0.2, 0.32, fine.g ) );
          landShine = ( molten * lava + vec3( 0.6, 0.1, 0.02 ) * cracks ) * pulse;
        #endif
        #ifdef LAND_FUNGI
          // Musgo humedo en manchones grandes, apenas tenido de los colores de la
          // luz de NOX. Lo que brilla son los hongos, caras de la malla (vLandShine):
          // un musgo que brillara de lejos se ve como niebla.
          float colony = smoothstep( 0.6, 0.82, texture2D( landDetail, landAt * 0.019 + vec2( 0.7, 0.1 ) ).a );
          float moss = colony * smoothstep( 3.0, 9.0, vLandEdge );
          vec3 mossTone = mix( landGlow, landVein, texture2D( landDetail, landAt * 0.007 + vec2( 0.4, 0.2 ) ).a );
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ( 0.62 + 0.5 * mossTone ), moss * 0.55 );
        #endif`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += landShine;
        #ifdef USE_COLOR
          totalEmissiveRadiance += vColor.rgb * vLandShine * 1.6;
        #endif`
      )
  }
  return material
}

// La malla del suelo de afuera: anillos alrededor del mapa, cada vez mas
// separados (de 1 m junto al borde a 14 m lejos), sobre los puntos del borde.
// Cada vertice guarda en `info` su distancia al mapa.
function ringGrid(W, D, height) {
  const rings = [0]
  while (rings[rings.length - 1] < REACH) {
    const r = rings[rings.length - 1]
    rings.push(r + Math.min(14, 1 + r * 0.12))
  }
  const around = perimeter(W, D, 3, 18)
  const n = around.length
  const count = rings.length * n
  const position = new Float32Array(count * 3)
  const info = new Float32Array(count * 2)
  for (let k = 0; k < rings.length; k++) {
    for (let i = 0; i < n; i++) {
      const [px, pz, nx, nz] = around[i]
      const x = px + nx * rings[k]
      const z = pz + nz * rings[k]
      position.set([x, k ? height(x, z) : 0, z], (k * n + i) * 3)
      info[(k * n + i) * 2] = rings[k]
    }
  }
  // Dos triangulos por cuadro, con la cara hacia arriba.
  const index = []
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = k * n + i
      const b = k * n + ((i + 1) % n)
      index.push(a, b, a + n, b, b + n, a + n)
    }
  }
  const terrain = new THREE.BufferGeometry()
  terrain.setAttribute('position', new THREE.BufferAttribute(position, 3))
  terrain.setIndex(index)
  terrain.computeVertexNormals()
  const normal = terrain.attributes.normal.array
  terrain.dispose()
  return { rings, around, n, count, position, info, index, normal }
}

// Lee un texel del suelo del mapa en (x, z): su color y si es un suelo liso (no
// adoquin ni grava). Sin textura devuelve null.
function groundTexel(ground, W, D) {
  const map = ground && ground.material && ground.material.map && ground.material.map.image
  const color = new THREE.Color()
  return (x, z) => {
    if (!map || !map.data) return null
    const u = Math.floor(clamp(x / W, 0, 0.9999) * map.width)
    const v = Math.floor(clamp(z / D, 0, 0.9999) * map.height)
    const o = ((map.height - 1 - v) * map.width + u) * 4
    const [r, g, b, a] = map.data.slice(o, o + 4)
    color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
    return { color, plain: Math.abs(a - 128) <= 6 }
  }
}

// El color de cada vertice del suelo de afuera: del valle a la loma seca, el
// bosque mas oscuro, tierra y roca en lo empinado, roca en las cumbres y nieve
// arriba. Junto al mapa toma el color del borde del mapa (si es un suelo liso),
// con una sombra al pie de la muralla.
function landColors(world, land, grid, texel, fbm, woods) {
  const { data, kinds, CX, CZ } = world
  const { width, height } = data
  const { rings, around, n, position, normal } = grid
  const C = (hex) => new THREE.Color(hex)
  const meadow = land.meadow.map(C)
  const [forest, rock, top, snow] = [C(land.forest), C(land.rock), C(land.top), C(land.snowColor)]
  const walled = (px, pz, nx, nz) => {
    const cx = clamp(Math.floor((px - nx * 0.25) / CX), 0, width - 1)
    const cy = clamp(Math.floor((pz - nz * 0.25) / CZ), 0, height - 1)
    return ['rampart', 'wall'].includes(kinds[cy * width + cx])
  }
  const color = new Float32Array(grid.count * 3)
  const c = new THREE.Color()
  for (let k = 0; k < rings.length; k++) {
    const r = rings[k]
    for (let i = 0; i < n; i++) {
      const v = k * n + i
      const [x, y, z] = position.slice(v * 3, v * 3 + 3)
      const slope = 1 - normal[v * 3 + 1]
      const wobble = fbm(x / 21, z / 21, 2)
      const lift = clamp(y / (land.hills * 1.3) + wobble * 0.7, 0, 1)
      c.copy(meadow[0])
        .lerp(meadow[1], smooth(0.1, 0.55, lift))
        .lerp(meadow[2], smooth(0.6, 1, lift))
      c.lerp(forest, woods(x, z) * smooth(6, 14, r) * 0.7)
      c.lerp(rock, smooth(0.22, 0.42, slope + wobble * 0.12))
      c.lerp(top, smooth(0.42, 0.68, slope) * 0.85)
      c.lerp(top, smooth(land.snow - 14, land.snow - 5, y + wobble * 6) * 0.7)
      c.lerp(
        snow,
        smooth(land.snow, land.snow + 5, y + wobble * 6) * (1 - smooth(0.5, 0.78, slope))
      )
      const [px, pz, nx, nz] = around[i]
      const edge = r < 7 && texel(px - nx * 1.75, pz - nz * 1.75)
      if (edge && edge.plain) c.lerp(edge.color, 1 - smooth(1, 7, r))
      if (r < 1.5 && walled(px, pz, nx, nz)) c.multiplyScalar(0.72 + 0.28 * smooth(0, 1.5, r))
      color.set([c.r, c.g, c.b], v * 3)
    }
  }
  return color
}

// Copia una forma de landShapes en `out` en [x, y, z], girada `yaw`, escalada
// `size` (y `tall` mas en alto) y con sus colores: las caras de copa con `leaf`,
// las de tronco con `bark`. `r` es su distancia al mapa y `glow` cuanto brilla
// lo que brilla, para el shader.
const paint = new THREE.Color()
function placeShape(out, shape, [x, y, z], { yaw, size, tall = 1, leaf, bark, r, glow = 0 }) {
  const cs = Math.cos(yaw)
  const sn = Math.sin(yaw)
  for (let j = 0; j < shape.leaf.length; j++) {
    const [lx, ly, lz] = shape.position.slice(j * 3, j * 3 + 3)
    const [ax, ay, az] = shape.normal.slice(j * 3, j * 3 + 3)
    out.position.push(
      x + (lx * cs + lz * sn) * size,
      y + ly * size * tall,
      z + (lz * cs - lx * sn) * size
    )
    out.normal.push(ax * cs + az * sn, ay, az * cs - ax * sn)
    paint.copy(shape.leaf[j] ? leaf : bark).multiplyScalar(shape.dark[j])
    out.color.push(paint.r, paint.g, paint.b)
    out.land.push(r, shape.shine[j] * glow)
  }
}

// Arboles y piedras de afuera. En cada cuadro de la malla, segun su area, puntos
// al azar sobre el triangulo que les toca: asi quedan apoyados en la malla y no
// en el ruido, que tiene mas detalle. Cerca del mapa hay mas arboles y con mas
// caras; nada junto al borde, sobre los caminos, en lo muy empinado ni en la
// nieve. Las piedras sueltas abundan en lo empinado.
function landObjects(land, roads, grid, woods) {
  const { rings, n, position, normal } = grid
  const kit = landShapes()
  const out = { position: [], normal: [], color: [], land: [] }
  const rock = new THREE.Color(land.rock)
  const top = new THREE.Color(land.top)
  const bark = new THREE.Color(land.trunk)
  const tint = new THREE.Color()
  const leaf = new THREE.Color()
  const nearRoad = (x, z) => roads.some((road) => roadDistance(road, x, z)[1] < road.half + 5)
  const onQuad = (a, b, c, d, u, v) => {
    const [p, q, s, fu, fv] = u + v <= 1 ? [a, b, c, u, v] : [d, c, b, 1 - u, 1 - v]
    return [0, 1, 2].map((e) => {
      const o = position[p * 3 + e]
      return o + (position[q * 3 + e] - o) * fu + (position[s * 3 + e] - o) * fv
    })
  }
  for (let k = 1; k < rings.length - 2; k++) {
    const r = rings[k]
    if (r < 7) continue
    const near = r < 62
    for (let i = 0; i < n; i++) {
      const a = k * n + i
      const b = k * n + ((i + 1) % n)
      const [c, d] = [a + n, b + n]
      const side = Math.hypot(
        position[b * 3] - position[a * 3],
        position[b * 3 + 2] - position[a * 3 + 2]
      )
      const area = side * (rings[k + 1] - r)
      const up = (normal[a * 3 + 1] + normal[b * 3 + 1] + normal[c * 3 + 1] + normal[d * 3 + 1]) / 4
      const steep = Math.sqrt(Math.max(0, 1 - up * up)) / Math.max(0.2, up)
      const [mx, my, mz] = onQuad(a, b, c, d, 0.5, 0.5)
      if (my > land.snow - 3) continue
      const forested = woods(mx, mz) * land.trees + land.trees * 0.06 * smooth(10, 30, r)
      const trees = steep > 0.75 ? 0 : (forested * area) / (near ? 19 : 36)
      const stones = (land.rocks * (0.25 + steep * 1.4) * area) / (near ? 60 : 160)
      const many = Math.floor(trees + stones + hash(i * 7 + k, k * 13 - i))
      for (let t = 0; t < many; t++) {
        const seed = i * 31 + k * 977 + t * 7919
        const at = onQuad(a, b, c, d, hash(seed, 1), hash(seed, 2))
        if (nearRoad(at[0], at[2])) continue
        const yaw = hash(seed, 3) * 6.28
        if (hash(seed, 5) * (trees + stones) < stones) {
          // Piedras medio enterradas, mas chatas cuanto mas grandes.
          tint.copy(rock).lerp(top, hash(seed, 6))
          const size = (near ? 0.45 : 0.8) + hash(seed, 7) * (near ? 0.9 : 1.6)
          at[1] -= size * 0.34
          const tall = 1 - Math.min(0.35, size * 0.12)
          placeShape(out, kit.rock, at, { yaw, size, tall, leaf: tint, bark: tint, r })
          continue
        }
        const oak = land.oak > hash(seed, 8)
        const list = oak ? land.oaks : land.pines
        leaf.setHex(list[Math.floor(hash(seed, 9) * list.length)])
        leaf.offsetHSL(0, 0, (hash(seed, 10) - 0.5) * 0.06)
        let shape = near ? kit.pine : kit.farPine
        if (oak) shape = near ? kit.oak : kit.farOak
        if (land.cypress && !oak) shape = near ? kit.cypress : kit.farPine
        const size =
          (near ? 1.6 : 2.1) * (0.85 + hash(seed, 4) * 0.5) * (1 + smooth(40, 160, r) * 0.6)
        at[1] -= 0.2
        const tall = 1 + hash(seed, 11) * 0.25
        placeShape(out, shape, at, { yaw, size, tall, leaf, bark, r })
      }
      if (land.fungi && r < 46 && steep < 0.6) {
        landFungi(out, land, [a, b, c, d], onQuad, { i, k, r, area, woods, nearRoad })
      }
    }
  }
  return out
}

// Las rondas de hongos que brillan junto al mapa (en NOX): mas en el bosque y
// ninguna sobre un camino; cada una toma uno de los colores de la luz del mapa
// (glows). `quad` son los cuatro vertices del cuadro de la malla y `onQuad` el
// punto (u, v) sobre el.
function landFungi(out, land, quad, onQuad, { i, k, r, area, woods, nearRoad }) {
  const kit = landShapes()
  const [mx, , mz] = onQuad(...quad, 0.5, 0.5)
  const many = (land.fungi * (0.35 + woods(mx, mz)) * area) / 40 + hash(i * 3 - k, k * 7 + i)
  const cap = new THREE.Color()
  const stem = new THREE.Color(0x8a86a0)
  for (let t = 0; t < Math.floor(many); t++) {
    const seed = i * 53 + k * 641 + t * 3571
    const at = onQuad(...quad, hash(seed, 1), hash(seed, 2))
    if (nearRoad(at[0], at[2])) continue
    cap.setHex(land.glows[Math.floor(hash(seed, 3) * land.glows.length)])
    const size = 0.8 + hash(seed, 4) * 0.7
    at[1] -= 0.05
    const yaw = hash(seed, 5) * 6.28
    placeShape(out, kit.fungi, at, { yaw, size, leaf: cap, bark: stem, r, glow: 0.9 })
  }
}

// Une el suelo (con sus indices) y lo que tiene encima (caras sueltas) en una
// sola geometria.
function joinLand(grid, color, extra) {
  const base = grid.count
  const added = extra.color.length / 3
  const join = (own, more, size) => {
    const all = new Float32Array((base + added) * size)
    all.set(own)
    all.set(more, base * size)
    return new THREE.BufferAttribute(all, size)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', join(grid.position, extra.position, 3))
  geometry.setAttribute('normal', join(grid.normal, extra.normal, 3))
  geometry.setAttribute('color', join(color, extra.color, 3))
  geometry.setAttribute('land', join(grid.info, extra.land, 2))
  const index = grid.index.slice()
  for (let v = base; v < base + added; v++) index.push(v)
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

// El paisaje de afuera: el campo de alturas sobre los anillos, pintado por
// altura y pendiente, con los arboles y las piedras en la misma malla. Los
// caminos toman el color del camino del mapa en su porton.
function landscape(world, land, roads) {
  const W = world.data.width * world.CX
  const D = world.data.height * world.CZ
  const height = heightField(land, W, D, roads)
  const woods = (x, z) =>
    smooth(0.02, 0.2, height.fbm(x / 46, z / 46, 3) + (land.trees - 0.5) * 0.7)
  const grid = ringGrid(W, D, height)
  const texel = groundTexel(world.ground, W, D)
  const color = landColors(world, land, grid, texel, height.fbm, woods)
  const geometry = joinLand(grid, color, landObjects(land, roads, grid, woods))
  const gate = roads[0] && texel(roads[0].ox - roads[0].dx * 1.75, roads[0].oz - roads[0].dz * 1.75)
  const road = gate ? gate.color.clone() : new THREE.Color(0x8c7b5c)
  const mesh = new THREE.Mesh(geometry, landMaterial(world, land, roads, road))
  mesh.receiveShadow = true
  mesh.userData.height = height
  return mesh
}

// El pasto de cada mapa: cuanto crece en cada suelo (0 nada, 1 tupido) y que tan
// alto. La base de cada hoja toma el color del suelo de su celda; la punta va
// hacia `tip`. En algunas matas (bloom: cuantas y cuanto brillan) dos hojas
// terminan en una flor silvestre de `blooms`; en NOX brillan solas. Las ruinas
// no tienen pasto.
const MEADOW = {
  soils: { '`': 0.8, ',': 0.97, '"': 1, '*': 0.75 },
  tall: { '`': 0.5, ',': 0.72, '"': 1, '*': 0.6 },
  tip: 0x92bd4c,
  blooms: [0xf4efe6, 0xf2d24b, 0xe86fa3, 0x9a7be0],
  bloom: [0.07, 0]
}
const GRASS = {
  city: MEADOW,
  castle: MEADOW,
  nox: {
    soils: { '`': 0.72, ',': 0.9, '"': 1, '*': 0.6 },
    tall: { '`': 0.55, ',': 0.75, '"': 1, '*': 0.6 },
    tip: 0x2f6f6a,
    blooms: [0x6fe0e8, 0xb78cff, 0x5fe8c8, 0x8cb4ff],
    bloom: [0.03, 0.9]
  },
  coliseum: {
    soils: { '`': 0.7, ',': 0.92, '"': 1, '*': 0.6 },
    tall: { '`': 0.5, ',': 0.65, '"': 1, '*': 0.6 },
    tip: 0xa8a85a,
    blooms: [0xf2d24b, 0xf4efe6, 0xd9493b, 0xe8a03e],
    bloom: [0.03, 0]
  }
}

// La mascara del pasto, una celda por texel y un margen afuera del mapa: R cuanto
// pasto, G que tan alto y B la altura del paisaje (de 0 a 12,75 m). Al borde de
// un camino el pasto esta pisoteado, mas bajo y mas ralo. Afuera el pasto sigue
// unos metros por la loma, si no es camino ni roca. `outside` trae el paisaje:
// su altura (height), sus caminos (roads) y su pasto (meadow).
const MARGIN = [36, 18]
function grassMask(world, spec, outside) {
  const { data, kinds, inBuilding, CX, CZ } = world
  const { width, height, rows } = data
  const [mx, my] = MARGIN
  const tw = width + mx * 2
  const th = height + my * 2
  const pixels = new Uint8Array(tw * th * 4)
  const W = width * CX
  const D = height * CZ
  // Lo que se pisa y no es pasto: tierra, adoquines, grava o arena.
  const paved = (x, y) =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    !kinds[y * width + x] &&
    '.;%='.includes((rows[y] || '')[x] || ' ')
  const trodden = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (paved(x + dx, y + dy)) return true
    }
    return false
  }
  // Afuera, primero la altura del paisaje en cada texel (adentro es 0); la
  // pendiente sale despues de sus vecinos.
  const lift = new Float32Array(tw * th)
  for (let v = 0; v < th; v++) {
    for (let u = 0; u < tw; u++) {
      lift[v * tw + u] = outside.height((u - mx + 0.5) * CX, (v - my + 0.5) * CZ)
    }
  }
  const at = (u, v) => lift[clamp(v, 0, th - 1) * tw + clamp(u, 0, tw - 1)]
  for (let v = 0; v < th; v++) {
    for (let u = 0; u < tw; u++) {
      const x = u - mx
      const y = v - my
      const o = (v * tw + u) * 4
      if (x >= 0 && y >= 0 && x < width && y < height) {
        const i = y * width + x
        const ch = (rows[y] || '')[x] || ' '
        const kind = kinds[i]
        let amount = 0
        let tall = 0
        if (!kind && !inBuilding[i] && spec.soils[ch]) {
          const worn = trodden(x, y) ? 0.5 : 1
          amount = spec.soils[ch] * (0.6 + 0.4 * worn)
          tall = spec.tall[ch] * worn
        } else if (kind === 'tree') {
          amount = 0.35
          tall = 0.45
        }
        pixels[o] = amount * 255
        pixels[o + 1] = tall * 255
        continue
      }
      // Afuera del mapa: el centro de la celda en el mundo.
      const wx = (x + 0.5) * CX
      const wz = (y + 0.5) * CZ
      const dx = wx < 0 ? -wx : wx > W ? wx - W : 0
      const dz = wz < 0 ? -wz : wz > D ? wz - D : 0
      const r = Math.hypot(dx, dz)
      const h = at(u, v)
      // Cuanto falta para el borde del camino mas cercano.
      let edge = Infinity
      for (const road of outside.roads) {
        edge = Math.min(edge, roadDistance(road, wx, wz)[1] - road.half)
      }
      const steep = Math.hypot(
        (at(u + 1, v) - at(u - 1, v)) / (2 * CX),
        (at(u, v + 1) - at(u, v - 1)) / (2 * CZ)
      )
      const worn = edge < 1.8 ? 0.5 : 1
      const field = (1 - smooth(9, 16, r)) * (1 - smooth(0.35, 0.6, steep)) * 0.8
      const amount = edge < 0.6 ? 0 : field * (0.6 + 0.4 * worn)
      pixels[o] = amount * 255
      pixels[o + 1] = 0.6 * worn * 255
      pixels[o + 2] = clamp(h / 12.75, 0, 1) * 255
    }
  }
  const texture = new THREE.DataTexture(pixels, tw, th)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return { texture, size: [tw * CX, th * CZ], from: [-mx * CX, -my * CZ] }
}

// Una mata de pasto: hojas angostas que se abren desde el centro. `blade` dice
// por vertice que tan arriba de la hoja esta (0 al pie, 1 en la punta) y un azar
// de la hoja, ordenado: la hoja k cae entre k/6 y (k+1)/6, asi las dos primeras
// son las que pueden dar flor. Las normales miran al cielo, como el suelo.
function clumpGeometry() {
  const position = []
  const blade = []
  const blades = 6
  for (let k = 0; k < blades; k++) {
    const angle = (k / blades) * Math.PI * 2 + hash(k, 11) * 0.8
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const out = 0.02 + hash(k, 12) * 0.08
    const lean = 0.08 + hash(k, 13) * 0.12
    const tall = 0.24 + hash(k, 14) * 0.2
    const half = 0.04 + hash(k, 15) * 0.022
    position.push(c * out - s * half, 0, s * out + c * half)
    position.push(c * out + s * half, 0, s * out - c * half)
    position.push(c * (out + lean), tall, s * (out + lean))
    const r = (k + hash(k, 16)) / blades
    blade.push(0, r, 0, r, 1, r)
  }
  const geometry = new THREE.InstancedBufferGeometry()
  const count = position.length / 3
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  const up = new Float32Array(count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0))
  geometry.setAttribute('normal', new THREE.BufferAttribute(up, 3))
  geometry.setAttribute('blade', new THREE.Float32BufferAttribute(blade, 2))
  return geometry
}

// Donde toca el suelo (y = 0) el rayo de la camara que pasa por la altura `ndcY`
// de la pantalla (-1 abajo, 1 arriba), sin pasar de `reach` metros.
const ray = new THREE.Vector3()
function groundHit(camera, ndcY, reach, out) {
  ray.set(0, ndcY, 0.5).unproject(camera).sub(camera.position).normalize()
  const down = -ray.y
  const t = down > 0.02 ? Math.min(reach, camera.position.y / down) : reach
  return out.copy(camera.position).addScaledVector(ray, t)
}

// El pasto: `count` matas repartidas en un rectangulo que se repite como
// baldosa. El shader lleva cada mata a la copia de la baldosa que cae sobre el
// suelo que se ve, asi el pasto no se mueve al caminar y alcanzan unas miles de
// matas para todo el mapa. La baldosa cubre `area` metros cuadrados y toma la
// forma de la pantalla: ancha en una compu, larga en un telefono parado, que ve
// mucho mas lejos que ancho. Cada mata mira la mascara: sin pasto en su celda no
// crece. `outside` es el paisaje (ver grassMask).
function grassField(world, spec, outside) {
  const crowded =
    (matchMedia && matchMedia('(pointer: coarse)').matches) ||
    Math.min(globalThis.innerWidth || 1280, globalThis.innerHeight || 720) < 600
  const count = crowded ? 5600 : 14400
  const area = crowded ? 2300 : 3600
  const geometry = clumpGeometry()
  // Cada mata en el cuadrado unidad; el shader la estira a la baldosa.
  const spots = new Float32Array(count * 4)
  const n = Math.ceil(Math.sqrt(count))
  for (let k = 0; k < count; k++) {
    const i = k % n
    const j = Math.floor(k / n)
    spots.set(
      [
        (i + hash(i, j * 3 + 1)) / n,
        (j + hash(j + 7, i)) / n,
        hash(i * 5, j) * 6.283,
        hash(j * 3, i * 11)
      ],
      k * 4
    )
  }
  geometry.setAttribute('spot', new THREE.InstancedBufferAttribute(spots, 4))
  geometry.instanceCount = count
  const mask = grassMask(world, spec, outside)
  const map = world.ground.material.map
  const patch = (world.mood && world.mood.patch) || [1.9, 1.45, 1.15]
  const uniforms = {
    clock: world.clock,
    grassMask: { value: mask.texture },
    grassSoil: { value: map },
    grassNoise: { value: world.detail },
    grassField: { value: new THREE.Vector4(0, 0, 60, 60) },
    grassArea: {
      value: new THREE.Vector4(mask.from[0], mask.from[1], 1 / mask.size[0], 1 / mask.size[1])
    },
    grassMap: {
      value: new THREE.Vector2(world.data.width * world.CX, world.data.height * world.CZ)
    },
    grassHero: { value: new THREE.Vector3(0, 0, 0) },
    grassTip: { value: new THREE.Color(spec.tip) },
    grassMeadow: { value: new THREE.Color(outside.meadow) },
    grassPatch: { value: new THREE.Vector3(...patch) },
    grassBlooms: { value: spec.blooms.map((hex) => new THREE.Color(hex)) },
    grassBloom: { value: new THREE.Vector2(...spec.bloom) }
  }
  // Lambert: una hoja de pasto es mate y no necesita el sombreado fisico, y son
  // decenas de miles de triangulos en pantalla.
  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 spot;
        attribute vec2 blade;
        uniform float clock;
        uniform sampler2D grassMask;
        uniform sampler2D grassSoil;
        uniform sampler2D grassNoise;
        uniform vec4 grassField;
        uniform vec4 grassArea;
        uniform vec2 grassMap;
        uniform vec3 grassHero;
        uniform vec3 grassTip;
        uniform vec3 grassMeadow;
        uniform vec3 grassPatch;
        uniform vec3 grassBlooms[ 4 ];
        uniform vec2 grassBloom;
        varying vec3 vGrass;
        varying vec3 vBloom;
        varying vec2 vFlower;`
      )
      .replace(
        '#include <color_vertex>',
        `// La copia de la mata que cae cerca del centro del pasto.
        vec2 tile = grassField.zw;
        vec2 root = grassField.xy + mod( spot.xy * tile - grassField.xy + 0.5 * tile, tile ) - 0.5 * tile;
        // La mascara se lee un poco corrida en cada mata: el borde del pasto con
        // un camino queda desparejo, gastado, y no sigue la grilla de celdas.
        vec2 ragged = ( vec2( fract( spot.w * 91.7 ), fract( spot.w * 53.3 ) ) - 0.5 ) * vec2( 0.45, 0.7 );
        vec4 mask = texture2D( grassMask, ( root + ragged - grassArea.xy ) * grassArea.zw );
        vec2 inMap = root / grassMap;
        float inside = step( 0.0, inMap.x ) * step( inMap.x, 1.0 ) * step( 0.0, inMap.y ) * step( inMap.y, 1.0 );
        vec2 rim = abs( root - grassField.xy ) / ( 0.5 * tile );
        float size = smoothstep( spot.w, spot.w + 0.1, mask.r ) * ( 1.0 - smoothstep( 0.84, 1.0, max( rim.x, rim.y ) ) );
        // Un prado no es parejo: hay manchones de pasto alto y claros mas ralos,
        // de unos diez metros.
        float meadow = texture2D( grassNoise, root * 0.012 + vec2( 0.31, 0.87 ) ).a;
        float tall = ( 0.5 + 0.75 * mask.g ) * ( 0.8 + 0.45 * fract( spot.w * 37.13 ) ) * size;
        tall *= 0.62 + 0.76 * smoothstep( 0.2, 0.8, meadow );
        // El viento: rafagas que corren por el campo y una onda chica de cada mata.
        float gust = texture2D( grassNoise, root * 0.019 - clock * vec2( 0.034, 0.013 ) ).a;
        float sway = ( gust - 0.4 ) * 0.95 + sin( clock * 2.4 - root.x * 0.5 + root.y * 0.23 + spot.w * 6.0 ) * 0.14;
        vec2 bend = vec2( 0.93, 0.36 ) * sway;
        // El heroe abre el pasto a su paso.
        vec2 away = root - grassHero.xy;
        bend += away / max( length( away ), 0.05 ) * ( 1.0 - smoothstep( 0.2, 0.95, length( away ) ) ) * 1.25;
        float c = cos( spot.z );
        float s = sin( spot.z );
        vec3 leaf = vec3( c * position.x - s * position.z, position.y, s * position.x + c * position.z );
        float tip = blade.x * blade.x;
        // Flores silvestres: en algunas matas dos hojas suben, se abren mas y
        // terminan en una espiga de color, como un lupino (ver el fragment).
        float flowering = step( 1.0 - grassBloom.x, fract( spot.w * 29.31 + spot.z * 0.173 ) ) * step( blade.y, 0.34 );
        leaf.xz = leaf.xz * size * ( 1.0 + 0.5 * flowering ) + bend * tip * 0.34 * tall;
        leaf.y *= tall * ( 1.0 - 0.28 * tip * min( 1.0, length( bend ) ) ) * ( 1.0 + 0.3 * flowering );
        float ground = mix( mask.b * 12.75 - 0.03, 0.0, inside );
        vec3 grassAt = vec3( root.x + leaf.x, ground + leaf.y, root.y + leaf.z );
        // El color: al pie el del suelo, con sus mismas manchas, para que la mata
        // nazca de el; la punta es la del pasto del mapa, apenas mas seca en las
        // manchas secas y mas clara cuando la dobla una rafaga.
        vec3 soil = mix( grassMeadow, texture2D( grassSoil, inMap ).rgb, inside );
        vec4 patches = texture2D( grassNoise, root * 0.031 + vec2( 0.13, 0.71 ) );
        float dry = smoothstep( 0.34, 0.66, patches.a );
        float broad = patches.r;
        soil *= mix( vec3( 1.0 ), grassPatch, dry ) * ( 0.82 + 0.36 * broad );
        vec3 top = grassTip * ( 0.72 + 0.4 * broad ) * mix( vec3( 1.0 ), grassPatch * 0.62, dry * 0.28 );
        top *= 0.88 + 0.24 * fract( spot.w * 7.31 );
        vGrass = mix( soil * 0.74, top * ( 0.9 + 0.28 * gust ), tip * 0.85 + 0.15 * blade.y * tip );
        vBloom = grassBlooms[ int( fract( spot.w * 13.17 ) * 3.99 ) ];
        vFlower = vec2( flowering, blade.x );
        #ifdef USE_COLOR
          vColor = vec4( 1.0 );
        #endif`
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = grassAt;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec2 grassBloom;
        varying vec3 vGrass;
        varying vec3 vBloom;
        varying vec2 vFlower;`
      )
      .replace(
        '#include <color_fragment>',
        `// En una hoja con flor, tallo verde hasta un poco mas de la mitad y despues
        // la flor, con el borde neto (en el vertex quedaria un degrade).
        float petal = vFlower.x * smoothstep( 0.5, 0.62, vFlower.y );
        diffuseColor.rgb *= mix( vGrass, vBloom, petal );`
      )
      .replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize( vNormal );'
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vBloom * petal * grassBloom.y;'
      )
  }
  const mesh = new THREE.Mesh(geometry, material)
  // Las matas se mueven en el shader: three.js no sabe donde quedan.
  mesh.frustumCulled = false
  mesh.receiveShadow = true
  // Antes de dibujar: la baldosa toma la forma de la pantalla, con el lado largo
  // hacia donde mira la camara, y se centra en el suelo que se ve, entre el pie y
  // el borde de arriba de la pantalla; si ese tramo no entra, cubre lo cercano.
  // El heroe es el objetivo de la camara (a 1 m de alto).
  const look = new THREE.Vector3()
  const near = new THREE.Vector3()
  const far = new THREE.Vector3()
  mesh.onBeforeRender = (renderer, scene, camera) => {
    camera.getWorldDirection(look)
    const p = camera.position
    const ratio = clamp((camera.aspect || 1) * 0.85, 0.4, 1.6)
    const wide = Math.sqrt(area * ratio)
    const deep = Math.sqrt(area / ratio)
    const alongZ = Math.abs(look.z) >= Math.abs(look.x)
    const [sx, sz] = alongZ ? [wide, deep] : [deep, wide]
    groundHit(camera, -1, 120, near)
    groundHit(camera, 1, 120, far)
    const span = Math.hypot(far.x - near.x, far.z - near.z) || 1
    const reach = Math.min(span / 2, 0.4 * (alongZ ? sz : sx))
    uniforms.grassField.value.set(
      near.x + ((far.x - near.x) / span) * reach,
      near.z + ((far.z - near.z) / span) * reach,
      sx,
      sz
    )
    const down = Math.max(0.12, -look.y)
    const hero = Math.min(80, Math.max(0, p.y - 1) / down)
    uniforms.grassHero.value.set(p.x + look.x * hero, p.z + look.z * hero, 0)
  }
  return { mesh, mask }
}

export function buildTerrain(world) {
  const { data, group } = world
  if (!data || !world.detail) return null
  const palette = world.palette || {}
  // Los hongos de afuera brillan con los colores de la luz del mapa.
  const glows = [palette.glow || 0xb78cff, palette.vein || palette.glow || 0x5fe8c8]
  const land = { ...(LANDS[data.id] || (data.kind === 'boss' ? LANDS.boss : LANDS.city)), glows }
  const roads = gateRoads(data, world.CX, world.CZ)
  const mesh = landscape(world, land, roads)
  group.add(mesh)
  const made = []
  const spec = GRASS[data.id] || (data.kind === 'boss' ? null : GRASS.city)
  if (spec && world.ground && world.ground.material.map) {
    const outside = { height: mesh.userData.height, roads, meadow: land.meadow[0] }
    const grass = grassField(world, spec, outside)
    group.add(grass.mesh)
    made.push(grass.mask.texture)
  }
  return {
    // La altura del paisaje en (x, z): 0 dentro del mapa. La camara de la
    // pagina la usa para no bajar dentro de los cerros.
    height: mesh.userData.height,
    dispose() {
      for (const texture of made) texture.dispose()
    }
  }
}
