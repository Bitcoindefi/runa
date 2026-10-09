// El mundo de RUNA en 2.5D. El mapa ASCII del juego se levanta con la tabla TILES
// del juego (lib/map.js): cada edificio cerrado del arte es una caja alta con
// techo a dos aguas y ventanas encendidas; las murallas, cercos y carteles sueltos
// suben por tramos; el suelo lleva el color de su caracter. Todo va en pocas
// mallas para que ande liviano: los edificios de un mapa son una sola.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { document } = globalThis

// Una celda de terminal es el doble de alta que de ancha (lib/map.js): en 3D una
// columna mide CX y una fila CZ. El heroe mide 2.
export const CX = 0.5
export const CZ = 1

// Suelo caminable, por caracter. Los que tienen nombre van bajo los arboles
// (musgo), el agua (lecho) y la lava (quemado), en las ruinas (ceniza) y donde
// un adoquin suelto asoma entre el pasto (piedras).
const GROUND = {
  '`': 0x3b5029,
  '.': 0x8c7b5c,
  ',': 0x43602c,
  '"': 0x3d6128,
  ';': 0x7a756c,
  '%': 0x8b7d66,
  '*': 0x43602c,
  '=': 0x4d4540,
  moss: 0x2e3b22,
  bed: 0x233739,
  ash: 0x2e2521,
  scorch: 0x5c2512,
  stones: 0x827f71
}
const UNDER = 0x1a1814

// Colores de los edificios por mapa.
// Cada edificio toma su tono alrededor de estos; roofs son las familias de
// techo. pitch es la pendiente del techo, floor la altura de cada piso y arch la
// forma de las puertas. timber pone entramado de madera, masonry paredes de
// sillares, vein enciende las juntas y spire levanta agujas. keep, slate y
// banner visten el castillo.
const PALETTES = {
  city: {
    wall: 0xdcccab,
    roofs: [0xa8462c, 0xa8462c, 0x8a5434, 0x5f6670],
    glow: 0xffc879,
    stone: 0x8a8272,
    trim: 0x5c3f2a,
    frame: 0x4b3424,
    door: 0x6a4126,
    shutters: [0x3f6e4c, 0x39598a, 0x8a3b2c, 0x9a7a34],
    arch: ['round', 'flat'],
    pitch: 0.62,
    floor: 2.8,
    chimneys: 0.75,
    timber: true,
    keep: 0xbdb4a3,
    slate: 0x56606e,
    banner: 0xb8362a
  },
  nox: {
    wall: 0x3a3347,
    roofs: [0x1f2838, 0x2c2040, 0x16302f],
    glow: 0xb78cff,
    stone: 0x26222d,
    trim: 0x8a80a6,
    frame: 0x16121e,
    door: 0x2a1f38,
    vein: 0x5fe8c8,
    arch: ['pointed'],
    pitch: 1.15,
    floor: 3,
    chimneys: 0.5,
    spire: true
  },
  castle: {
    wall: 0xaaa293,
    roofs: [0x7a3328, 0x6c3a2c],
    glow: 0xffc879,
    stone: 0x6f685d,
    trim: 0xc2b9a6,
    frame: 0x5e574c,
    door: 0x4e3424,
    arch: ['round'],
    pitch: 0.75,
    floor: 2.8,
    chimneys: 0.5,
    masonry: true
  },
  coliseum: {
    wall: 0xb9a27c,
    roofs: [0x7a5a3a],
    glow: 0xffc879,
    stone: 0x7a6a52,
    trim: 0xd2bf98,
    frame: 0x5e4a33,
    door: 0x4e3424,
    arch: ['round'],
    pitch: 0.6,
    floor: 2.8,
    chimneys: 0
  },
  boss: {
    wall: 0x5a4a42,
    roofs: [0x3a2a24],
    glow: 0xff7a2a,
    stone: 0x2e2420,
    trim: 0x7a5a48,
    frame: 0x2a1d18,
    door: 0x2a1d18,
    arch: ['pointed'],
    pitch: 0.9,
    floor: 2.8,
    chimneys: 0
  }
}

// Lo que sube fuera de los edificios: altura y material por clase.
const LOOSE = {
  rampart: { h: 3.4, color: 0x8b867b },
  wall: { h: 2.2, color: 0x8b867b },
  masonry: { h: 1.1, color: 0x6e6a62 },
  roof: { h: 2.6, color: 0x8a3f2e },
  window: { h: 2.2, color: 0xf1c27a, glow: 0.8 },
  ornament: { h: 1.6, color: 0xc9a245, metal: true },
  building: { h: 2.4, color: 0x9c968a },
  body: { h: 2.2, color: 0x77726a },
  frame: { h: 2, color: 0x5b564e },
  fountain: { h: 0.7, color: 0x5aa0c8, glow: 0.35 },
  sign: { h: 1.4, color: 0xe0c060, glyph: true },
  door: { h: 0.12, color: 0xe0c060, glow: 1, glyph: true },
  water: { h: 0.08, color: 0x2f6f9f, glow: 0.25, sink: 0.05 },
  lava: { h: 0.12, color: 0xff5a1a, glow: 1.6, sink: 0.04 },
  // El portal y el escombro de las ruinas se pisan: van al ras del piso.
  portal: { h: 0.15, color: 0x9a6bff, glow: 1.4 },
  rubble: { h: 0.16, color: 0x5a4a42 }
}

// Lo que puede formar parte de un edificio.
const STRUCTURE = new Set([
  'rampart',
  'wall',
  'masonry',
  'roof',
  'window',
  'ornament',
  'building',
  'body',
  'frame',
  'sign',
  'fountain'
])

// En el arte, una "o" o una "t" dentro de una palabra es una letra del cartel,
// no una piedra ni un arbol.
const letter = (ch) => ch >= 'a' && ch <= 'z'
function inWord(row, x) {
  return letter(row[x - 1] || '') || letter(row[x + 1] || '')
}

function classify(ch, tile, kind) {
  if (kind === 'boss') {
    if (ch === '~') return 'lava'
    if (ch === '=' || ch === '.' || ch === ',') return null
    if (ch === 'O') return 'portal'
    // En las ruinas solo frenan # | - + (BossZone.isWalkable): el resto se pisa,
    // asi que se dibuja como escombro bajo y no como un bloque que el heroe
    // atravesaria.
    if (!'#|-+'.includes(ch)) return 'rubble'
  }
  if (ch === ' ') return 'body'
  if (!tile) return 'frame'
  if (!tile.solid) return tile.id.startsWith('door.') || tile.id.startsWith('gate.') ? 'door' : null
  if (tile.id === 'wall') return ch === '#' ? 'rampart' : 'wall'
  if (tile.id === 'tree') return 'tree'
  if (tile.id === 'rock') return 'rock'
  if (tile.id === 'water') return 'water'
  if (tile.id === 'nowhere') return 'frame'
  return LOOSE[tile.id] ? tile.id : 'frame'
}

// Atlas de glifos ASCII 32..127: 16 columnas por 8 filas de 64 px.
let atlas = null
function glyphAtlas() {
  if (atlas) return atlas
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const g = canvas.getContext('2d')
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#2a1e0a'
  g.font = 'bold 52px ui-monospace, Consolas, monospace'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (let code = 32; code < 128; code++) {
    const i = code - 32
    g.fillText(String.fromCharCode(code), (i % 16) * 64 + 32, Math.floor(i / 16) * 64 + 34)
  }
  atlas = new THREE.CanvasTexture(canvas)
  atlas.colorSpace = THREE.SRGBColorSpace
  atlas.anisotropy = 4
  return atlas
}

function glyphCell(ch) {
  const i = Math.max(0, Math.min(95, ch.charCodeAt(0) - 32))
  return [i % 16, 7 - Math.floor(i / 16)]
}

function material(spec) {
  const options = { color: spec.color, roughness: spec.metal ? 0.35 : 0.85 }
  if (spec.metal) options.metalness = 0.8
  if (spec.glow) {
    options.emissive = spec.color
    options.emissiveIntensity = spec.glow
  }
  if (spec.glyph) options.map = glyphAtlas()
  const m = new THREE.MeshStandardMaterial(options)
  if (spec.glyph) {
    // Cada instancia lee su letra del atlas.
    m.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'attribute vec2 glyphCell;\n' +
        shader.vertexShader.replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (vMapUv + glyphCell) * vec2(1.0 / 16.0, 1.0 / 8.0);\n#endif'
        )
    }
  }
  return m
}

// Una etiqueta que siempre mira a la camara.
export function label(text, color = '#e0c060') {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')
  const font = '28px ui-monospace, Consolas, monospace'
  g.font = font
  canvas.width = Math.ceil(g.measureText(text).width) + 24
  canvas.height = 44
  g.font = font
  g.fillStyle = 'rgba(11, 11, 12, 0.72)'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = color
  g.textBaseline = 'middle'
  g.fillText(text, 12, 23)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true })
  )
  sprite.scale.set(canvas.width / 80, canvas.height / 80, 1)
  sprite.renderOrder = 10
  return sprite
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

// Terreno: el suelo con textura fina y lo que crece encima.

// Lo que lleva cada suelo de GROUND ademas de su color: su grano suelto, el
// dibujo fino que le pone el shader (1 adoquines, -1 grava) y su familia: dentro
// de una familia los suelos se funden suave, como pasto con pasto; entre
// familias el borde es neto, como el de un camino.
const SOIL = {
  '`': { grain: 0.05, family: 1 },
  ',': { grain: 0.06, family: 1 },
  '"': { grain: 0.06, family: 1 },
  '*': { grain: 0.06, family: 1 },
  moss: { grain: 0.06, family: 1 },
  bed: { grain: 0.03, family: 1 },
  stones: { grain: 0.04, pattern: 1, family: 1 },
  '.': { grain: 0.12, pattern: -0.45, family: 2 },
  ';': { grain: 0.04, pattern: 1, family: 3 },
  '%': { grain: 0.12, pattern: -1, family: 4 },
  '=': { grain: 0.04, pattern: 1, family: 5 },
  ash: { grain: 0.1, pattern: -0.5, family: 6 },
  scorch: { grain: 0.05, family: 6 }
}

// El tono de cada mapa: un factor sobre los colores del suelo (tint) y el de las
// manchas grandes que pinta el shader en los suelos lisos y oscuros, como el
// pasto (patch). En los claros o con dibujo (tierra, grava, adoquines, ceniza)
// las manchas solo oscurecen: asi el borde entre dos de ellos no se aclara. El
// pasto tiene manchas secas; NOX es de noche y frio, con manchas lilas; en las
// ruinas el suelo junto a la lava se aclara.
const MOOD = {
  city: { tint: [1, 1, 1], patch: [1.9, 1.45, 1.15] },
  nox: { tint: [0.72, 0.8, 1.02], patch: [1.35, 1.2, 1.7] },
  boss: { tint: [1, 1, 1], patch: [1.7, 1.55, 1.5] }
}

// Cuanto oscurece el suelo al pie de lo que ocupa toda su celda. Los arboles y
// las piedras no la llenan: su sombra es redonda, desde el centro.
const SHADE = {
  rampart: 1,
  wall: 1,
  masonry: 0.8,
  roof: 1,
  window: 1,
  ornament: 0.8,
  building: 1,
  body: 1,
  frame: 1,
  sign: 0.8,
  fountain: 0.7,
  rubble: 0.5
}
const ROUND = { tree: [1.05, 0.34], rock: [0.5, 0.3] }

// Colores de las flores por mapa; en NOX ademas brillan.
const BLOOM = {
  city: [0xe86fa3, 0xf2d24b, 0xf4efe6, 0xd9493b, 0x9a7be0, 0xf09a3e],
  nox: [0x6fe0e8, 0xb78cff, 0xe06fe0, 0x8cb4ff],
  castle: [0xd9493b, 0xf4efe6, 0xf2d24b, 0xe86fa3]
}

// Copas de pino, roble y alamo por mapa; de vez en cuando un roble de otono.
const LEAVES = {
  city: [
    [0x3b7038, 0x356a3e, 0x44773a],
    [0x4b7a32, 0x5a8636, 0x6a8b3a, 0xb0682c],
    [0x5f8f3b, 0x709b43]
  ],
  nox: [
    [0x2a4253, 0x2a3a4e],
    [0x4a416e, 0x3e4a72],
    [0x37596d, 0x3b5068]
  ]
}

const smooth01 = (t) => t * t * (3 - 2 * t)

// Ruido de valor suave en una grilla de nx por nz puntos: cada octava es
// [tamano del rasgo en puntos, peso, semilla]. Da manchas que no siguen la
// grilla del mapa.
function noiseField(nx, nz, octaves) {
  const out = new Float32Array(nx * nz)
  for (const [size, weight, seed] of octaves) {
    const lx = Math.ceil(nx / size) + 2
    const lz = Math.ceil(nz / size) + 2
    const lattice = new Float32Array(lx * lz)
    for (let i = 0; i < lattice.length; i++) {
      lattice[i] = hash((i % lx) + seed * 1013, Math.floor(i / lx) - seed * 7919)
    }
    for (let z = 0; z < nz; z++) {
      const j = Math.floor(z / size)
      const tz = smooth01(z / size - j)
      for (let x = 0; x < nx; x++) {
        const i = Math.floor(x / size)
        const tx = smooth01(x / size - i)
        const k = j * lx + i
        const top = lattice[k] + (lattice[k + 1] - lattice[k]) * tx
        const bottom = lattice[k + lx] + (lattice[k + lx + 1] - lattice[k + lx]) * tx
        out[z * nx + x] += (top + (bottom - top) * tz) * weight
      }
    }
  }
  return out
}

// Numeros al azar fijos para el grano de cada texel: mas barato que un hash.
const DICE = new Float32Array(65536).map((_, i) => hash(i, 977))
const dice = (u, v, seed) =>
  DICE[(Math.imul(u, 0x9e3779b1) ^ Math.imul(v + seed, 0x85ebca77) ^ seed) >>> 16]

// Grano fino del suelo, el mismo para todos los mapas: R y A grano en dos
// escalas, G adoquines y B grava. Cubre 2 x 2 unidades y se repite.
let soilGrain = null
function soilDetail() {
  if (soilGrain) return soilGrain
  const n = 256
  // Ruido de valor que da la vuelta en el borde, con `cells` rasgos por lado.
  const wrapped = (cells, seed) => {
    const out = new Float32Array(n * n)
    const step = n / cells
    const lattice = new Float32Array((cells + 1) * (cells + 1))
    for (let j = 0; j <= cells; j++) {
      for (let i = 0; i <= cells; i++) {
        lattice[j * (cells + 1) + i] = hash((i % cells) + seed * 977, (j % cells) - seed * 613)
      }
    }
    for (let y = 0; y < n; y++) {
      const j = Math.floor(y / step)
      const ty = smooth01(y / step - j)
      for (let x = 0; x < n; x++) {
        const i = Math.floor(x / step)
        const tx = smooth01(x / step - i)
        const k = j * (cells + 1) + i
        const top = lattice[k] + (lattice[k + 1] - lattice[k]) * tx
        const bottom =
          lattice[k + cells + 1] + (lattice[k + cells + 2] - lattice[k + cells + 1]) * tx
        out[y * n + x] = top + (bottom - top) * ty
      }
    }
    return out
  }
  // Piedras: cada una es la zona del punto mas cercano, con un punto movido al
  // azar por casilla de una grilla de `cells` por lado. Da el tono de cada
  // piedra y cuanto falta para la junta, en texeles.
  const stones = (cells, seed) => {
    const tone = new Float32Array(n * n)
    const edge = new Float32Array(n * n)
    const step = n / cells
    const sites = []
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        sites.push([
          0.15 + hash(i + seed, j) * 0.7,
          0.15 + hash(j - seed, i + seed * 3) * 0.7,
          hash(i * 7 + seed, j * 11)
        ])
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const ci = Math.floor(x / step)
        const cj = Math.floor(y / step)
        let d1 = Infinity
        let d2 = Infinity
        let t = 0
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const i = ci + di
            const j = cj + dj
            const site =
              sites[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]
            const dx = x + 0.5 - (i + site[0]) * step
            const dy = y + 0.5 - (j + site[1]) * step
            const d = Math.sqrt(dx * dx + dy * dy)
            if (d < d1) {
              d2 = d1
              d1 = d
              t = site[2]
            } else if (d < d2) d2 = d
          }
        }
        tone[y * n + x] = t
        edge[y * n + x] = (d2 - d1) / 2
      }
    }
    return { tone, edge }
  }
  const fine = wrapped(32, 1)
  const fine2 = wrapped(16, 2)
  const broad = wrapped(8, 3)
  const cobble = stones(8, 4)
  const gravel = stones(32, 5)
  const pixels = new Uint8ClampedArray(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const joint = smooth01(Math.min(1, cobble.edge[i] / 5))
    const pebble = smooth01(Math.min(1, gravel.edge[i] / 1.6))
    pixels[i * 4] = (fine[i] * 0.6 + fine2[i] * 0.4) * 255
    pixels[i * 4 + 1] = (0.6 + cobble.tone[i] * 0.4) * (0.3 + joint * 0.7) * 255
    pixels[i * 4 + 2] = (0.35 + gravel.tone[i] * 0.65) * (0.45 + pebble * 0.55) * 255
    pixels[i * 4 + 3] = broad[i] * 255
  }
  soilGrain = new THREE.DataTexture(new Uint8Array(pixels.buffer), n, n)
  soilGrain.wrapS = THREE.RepeatWrapping
  soilGrain.wrapT = THREE.RepeatWrapping
  soilGrain.magFilter = THREE.LinearFilter
  soilGrain.minFilter = THREE.LinearMipmapLinearFilter
  soilGrain.generateMipmaps = true
  soilGrain.anisotropy = 8
  soilGrain.needsUpdate = true
  return soilGrain
}

// Cuantos texeles lleva cada columna del suelo (cada fila el doble, asi el texel
// es cuadrado): hasta 4, sin pasar de unos 600 mil por mapa, porque se arma en
// la CPU cada vez que se entra al mapa. El grano mas fino lo pone el shader.
function soilDensity(width, height) {
  const fit = Math.floor(Math.sqrt(6e5 / (width * height * 2)))
  return Math.max(1, Math.min(4, fit, Math.floor(4096 / width), Math.floor(2048 / height)))
}

// El color de un suelo en 0..255 con el tono del mapa.
function soilColor(hex, tint) {
  return [((hex >> 16) & 255) * tint[0], ((hex >> 8) & 255) * tint[1], (hex & 255) * tint[2]]
}

// Pinta una fila de texeles del suelo (ver soilTexture). Mezcla las cuatro
// celdas que rodean cada texel: si son el mismo suelo no hay nada que mezclar;
// si no, el borde se tuerce con ruido y se funde segun la familia. Despues van el
// grano, las flores, la sombra al pie de lo alto y bajo las copas, y el resplandor
// de la lava. Sin crear objetos: corre medio millon de veces por mapa.
function soilRow(job, v) {
  const { width, height, tx, tw, th, soil, shade, heat, near, base, grain, pattern } = job
  const { family, warp, own, colA, colB, along, gridF, pixels } = job
  const reach = 0.42
  const glow = 0.95
  const cy = (v + 0.5) / (tx * 2)
  const cellY = Math.floor(cy)
  const top = Math.floor(cy - 0.5)
  const down = cy - 0.5 - top
  const ya = Math.max(0, top) * width
  const yb = Math.min(height - 1, top + 1) * width
  const gz = (v + 0.5) / tx
  const nx = width + 40
  const g = Math.floor(gz) * nx
  const gzf = gz - Math.floor(gz)
  const pz = cy * CZ
  let o = (th - 1 - v) * tw * 4
  for (let u = 0; u < tw; u++, o += 4) {
    const s00 = soil[ya + colA[u]]
    const s10 = soil[ya + colB[u]]
    const s01 = soil[yb + colA[u]]
    const s11 = soil[yb + colB[u]]
    let r = 0
    let gr = 0
    let b = 0
    let loose = 0
    let draw = 0
    if (s00 === s10 && s00 === s01 && s00 === s11) {
      r = base[s00 * 3]
      gr = base[s00 * 3 + 1]
      b = base[s00 * 3 + 2]
      loose = grain[s00]
      draw = pattern[s00]
    } else {
      const k = g + own[u]
      const f = gridF[u]
      const top0 = warp[k] + (warp[k + 1] - warp[k]) * f
      const wx = top0 + (warp[k + nx] + (warp[k + nx + 1] - warp[k + nx]) * f - top0) * gzf - 0.5
      const top1 = warp[k + 37] + (warp[k + 38] - warp[k + 37]) * f
      const wz =
        top1 + (warp[k + nx + 37] + (warp[k + nx + 38] - warp[k + nx + 37]) * f - top1) * gzf - 0.5
      const f00 = family[s00]
      const same = f00 === family[s10] && f00 === family[s01] && f00 === family[s11]
      const fx = Math.min(1, Math.max(0, along[u] + wx * 0.5))
      const fz = Math.min(1, Math.max(0, down + wz * 0.25))
      const sx = smooth01(same ? fx : Math.min(1, Math.max(0, (fx - 0.5) * 2.5 + 0.5)))
      const sz = smooth01(same ? fz : Math.min(1, Math.max(0, (fz - 0.5) * 5 + 0.5)))
      for (let c = 0; c < 4; c++) {
        const s = c === 0 ? s00 : c === 1 ? s10 : c === 2 ? s01 : s11
        const w = (c & 1 ? sx : 1 - sx) * (c & 2 ? sz : 1 - sz)
        r += base[s * 3] * w
        gr += base[s * 3 + 1] * w
        b += base[s * 3 + 2] * w
        loose += grain[s] * w
        draw += pattern[s] * w
      }
    }
    const speck = (dice(u, v, 1) - 0.5) * loose
    r += speck
    gr += speck
    b += speck * 0.8
    // Flores: el pasto florido se tine apenas con sus colores.
    const cell = cellY * width + own[u]
    if (soil[cell] === job.flowery && dice(u, v, 2) < 0.12) {
      const hex = job.blooms[Math.floor(dice(u, v, 3) * job.blooms.length)]
      r += (((hex >> 16) & 255) - r) * 0.35
      gr += (((hex >> 8) & 255) - gr) * 0.35
      b += ((hex & 255) - b) * 0.35
    }
    let lit = 1
    if (near[cell]) {
      const px = ((u + 0.5) * CX) / tx
      if (near[cell] & 5) {
        let occ = 0
        let warm = 0
        for (let ny = Math.max(0, cellY - 1); ny <= Math.min(height - 1, cellY + 1); ny++) {
          const z0 = ny * CZ
          const dz = pz < z0 ? z0 - pz : pz > z0 + CZ ? pz - z0 - CZ : 0
          if (dz >= glow) continue
          for (let cx = Math.max(0, own[u] - 1); cx <= Math.min(width - 1, own[u] + 1); cx++) {
            const n = ny * width + cx
            if (!shade[n] && !heat[n]) continue
            const x0 = cx * CX
            const dx = px < x0 ? x0 - px : px > x0 + CX ? px - x0 - CX : 0
            const d = Math.sqrt(dx * dx + dz * dz)
            if (d < reach) occ = Math.max(occ, shade[n] * (1 - d / reach) * (1 - d / reach))
            if (heat[n] && d < glow) warm = Math.max(warm, (1 - d / glow) * (1 - d / glow))
          }
        }
        lit -= 0.4 * occ
        r += (176 - r) * warm * 0.6
        gr += (64 - gr) * warm * 0.6
        b += (22 - b) * warm * 0.6
      }
      if (near[cell] & 2) {
        const casters = job.roundAt.get(cell)
        for (let k = 0; k < casters.length; k++) {
          const caster = casters[k]
          const ax = px - caster[0]
          const az = pz - caster[1]
          const d = Math.sqrt(ax * ax + az * az) / caster[2]
          if (d < 1) lit -= caster[3] * (1 - d) * (1 - d)
        }
      }
      lit = Math.max(0.45, lit)
    }
    pixels[o] = r * lit
    pixels[o + 1] = gr * lit
    pixels[o + 2] = b * lit
    pixels[o + 3] = 128 + 127 * draw
  }
}

// El suelo del mapa como textura: el color de cada celda, con grano y bordes que
// se funden con ruido, mas la sombra al pie de las paredes, piedras y arboles.
// Las manchas grandes y el relieve los pinta el shader. El alfa le dice que
// dibujo fino lleva: 0,5 ninguno, mas es adoquin y menos es grava.
function soilTexture(data, kinds) {
  const { width, height, rows } = data
  const boss = data.kind === 'boss'
  const { tint } = MOOD[data.id] || MOOD.city
  const keys = Object.keys(SOIL)
  // El ultimo suelo es lo que queda tapado del todo, dentro de un edificio.
  const count = keys.length + 1
  const hidden = count - 1
  const base = new Float32Array(count * 3)
  const grain = new Float32Array(count)
  const pattern = new Float32Array(count)
  const family = new Uint8Array(count)
  keys.forEach((key, k) => {
    base.set(soilColor(GROUND[key], tint), k * 3)
    grain[k] = SOIL[key].grain * 255
    pattern[k] = SOIL[key].pattern || 0
    family[k] = SOIL[key].family
  })
  base.set(soilColor(UNDER, tint), hidden * 3)
  family[hidden] = 9
  const index = Object.fromEntries(keys.map((key, k) => [key, k]))
  const blooms = BLOOM[data.id] || BLOOM.city

  // El suelo de cada celda. Lo alto (paredes, edificios) toma el de una vecina,
  // asi su borde no se oscurece de golpe: la sombra al pie va aparte.
  const cells = width * height
  const NONE = 255
  const soil = new Uint8Array(cells).fill(NONE)
  const shade = new Float32Array(cells)
  const heat = new Uint8Array(cells)
  const round = []
  const paved = (x, y) => ((rows[y] || '')[x] === ';' ? 1 : 0)
  for (let y = 0; y < height; y++) {
    const row = rows[y] || ''
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const kind = kinds[i]
      const ch = row[x] || ' '
      let key = null
      if (boss) {
        if (kind === 'lava') key = 'scorch'
        else if (!kind) key = ch === '=' ? '=' : 'ash'
      } else if (!kind) key = SOIL[ch] ? ch : '`'
      else if (kind === 'tree') key = 'moss'
      else if (kind === 'water') key = 'bed'
      // Un adoquin suelto entre el pasto es una piedra que asoma, no una baldosa.
      if (
        key === ';' &&
        paved(x + 1, y) + paved(x - 1, y) + paved(x, y + 1) + paved(x, y - 1) < 2
      ) {
        key = 'stones'
      }
      if (key) soil[i] = index[key]
      shade[i] = SHADE[kind] || 0
      heat[i] = kind === 'lava' ? 1 : 0
      if (ROUND[kind]) round.push([(x + 0.5) * CX, (y + 0.5) * CZ, ...ROUND[kind]])
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < cells; i++) {
      if (soil[i] !== NONE) continue
      const x = i % width
      if (x > 0 && soil[i - 1] !== NONE) soil[i] = soil[i - 1]
      else if (x < width - 1 && soil[i + 1] !== NONE) soil[i] = soil[i + 1]
      else if (i >= width && soil[i - width] !== NONE) soil[i] = soil[i - width]
      else if (i + width < cells && soil[i + width] !== NONE) soil[i] = soil[i + width]
    }
  }
  for (let i = 0; i < cells; i++) if (soil[i] === NONE) soil[i] = hidden

  // Las celdas con algo alto al lado (bit 1), bajo una sombra redonda (bit 2) o
  // junto a la lava (bit 4): solo ahi se calcula sombra o calor.
  const near = new Uint8Array(cells)
  for (let i = 0; i < cells; i++) {
    if (!shade[i] && !heat[i]) continue
    const x = i % width
    const y = (i - x) / width
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
        near[ny * width + nx] |= shade[i] ? 1 : 4
      }
    }
  }
  const roundAt = new Map()
  for (const caster of round) {
    const [wx, wz, far] = caster
    const x0 = Math.max(0, Math.floor((wx - far) / CX))
    const x1 = Math.min(width - 1, Math.floor((wx + far) / CX))
    const y0 = Math.max(0, Math.floor((wz - far) / CZ))
    const y1 = Math.min(height - 1, Math.floor((wz + far) / CZ))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x
        near[i] |= 2
        if (!roundAt.has(i)) roundAt.set(i, [])
        roundAt.get(i).push(caster)
      }
    }
  }
  // Lo que necesita cada fila de texeles. Siempre con las mismas claves, asi el
  // pintor de filas se compila una vez y queda rapido para todos los mapas.
  const tx = soilDensity(width, height)
  const tw = width * tx
  const th = height * tx * 2
  const job = {
    width,
    height,
    tx,
    tw,
    th,
    soil,
    shade,
    heat,
    near,
    roundAt,
    base,
    grain,
    pattern,
    family,
    flowery: index['*'],
    blooms,
    // Ruido que tuerce los bordes entre suelos, en una grilla de media unidad
    // (una columna de ancho, media fila de alto). El de z se lee corrido.
    warp: noiseField(width + 40, height * 2 + 2, [[3, 1, 5]]),
    // Por columna de texeles: su celda, las dos celdas que mezcla (a izquierda y
    // derecha de su punto), cuanto avanzo hacia la segunda y su punto de ruido.
    own: new Int32Array(tw),
    colA: new Int32Array(tw),
    colB: new Int32Array(tw),
    along: new Float32Array(tw),
    gridF: new Float32Array(tw),
    pixels: new Uint8ClampedArray(tw * th * 4)
  }
  for (let u = 0; u < tw; u++) {
    const cx = (u + 0.5) / tx
    const left = Math.floor(cx - 0.5)
    job.own[u] = Math.floor(cx)
    job.colA[u] = Math.max(0, left)
    job.colB[u] = Math.min(width - 1, left + 1)
    job.along[u] = cx - 0.5 - left
    job.gridF[u] = cx - job.own[u]
  }
  for (let v = 0; v < th; v++) soilRow(job, v)
  const texture = new THREE.DataTexture(new Uint8Array(job.pixels.buffer), tw, th)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

// El campo alrededor del mapa, para que no flote en el vacio: un plano grande y
// apenas mas bajo, del pasto que mas hay en el borde (ceniza en las ruinas), que
// se oscurece lejos del mapa hasta perderse en la niebla.
function soilSkirt(data) {
  const { width, height, rows } = data
  const w = width * CX
  const d = height * CZ
  const far = 70
  const seen = {}
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x > 2 && y > 2 && x < width - 3 && y < height - 3) continue
      const ch = (rows[y] || '')[x]
      if (SOIL[ch] && SOIL[ch].family === 1) seen[ch] = (seen[ch] || 0) + 1
    }
  }
  const meadow = Object.keys(seen).sort((a, b) => seen[b] - seen[a])[0] || '`'
  const mood = MOOD[data.id] || MOOD.city
  const color = soilColor(GROUND[data.kind === 'boss' ? 'ash' : meadow], mood.tint)
  const n = 32
  const pixels = new Uint8ClampedArray(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const wx = ((x + 0.5) / n) * (w + far * 2) - far
      const wz = (1 - (y + 0.5) / n) * (d + far * 2) - far
      const fade = 1 - 0.55 * Math.min(1, Math.max(0, -wx, wx - w, -wz, wz - d) / far)
      pixels.set([color[0] * fade, color[1] * fade, color[2] * fade, 128], (y * n + x) * 4)
    }
  }
  const texture = new THREE.DataTexture(new Uint8Array(pixels.buffer), n, n)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  const skirt = new THREE.Mesh(
    new THREE.PlaneGeometry(w + far * 2, d + far * 2),
    soilMaterial(texture, data, w + far * 2, d + far * 2, -far)
  )
  skirt.rotation.x = -Math.PI / 2
  skirt.position.set(w / 2, -0.02, d / 2)
  skirt.receiveShadow = true
  return skirt
}

// El material del suelo: la textura del mapa con, encima, manchas grandes del
// tono del mapa, relieve y grano fino, y segun el alfa adoquines o grava. Todo va
// a escala del mundo: el plano mide w por d unidades y empieza en `from`, asi el
// campo de afuera sigue las mismas manchas que el mapa.
function soilMaterial(texture, data, w, d, from = 0) {
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1 })
  const { patch } = MOOD[data.id] || MOOD.city
  material.onBeforeCompile = (shader) => {
    shader.uniforms.soilDetail = { value: soilDetail() }
    shader.uniforms.soilSize = { value: new THREE.Vector3(w, d, from) }
    shader.uniforms.soilPatch = { value: new THREE.Vector3(...patch) }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        `#include <map_pars_fragment>
        uniform sampler2D soilDetail;
        uniform vec3 soilSize;
        uniform vec3 soilPatch;`
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec2 soilAt = vec2( vMapUv.x, 1.0 - vMapUv.y ) * soilSize.xy + soilSize.z;
          vec4 fine = texture2D( soilDetail, soilAt * 0.5 );
          float broad = texture2D( soilDetail, soilAt * 0.11 + vec2( 0.37, 0.61 ) ).a;
          float spots = texture2D( soilDetail, soilAt * 0.031 + vec2( 0.13, 0.71 ) ).a;
          float cobble = clamp( ( sampledDiffuseColor.a - 0.53 ) * 2.2, 0.0, 1.0 );
          float gravel = clamp( ( 0.47 - sampledDiffuseColor.a ) * 2.2, 0.0, 1.0 );
          float lum = dot( sampledDiffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
          float plain = ( 1.0 - smoothstep( 0.02, 0.1, abs( sampledDiffuseColor.a - 0.5 ) ) ) *
            ( 1.0 - smoothstep( 0.1, 0.14, lum ) );
          vec3 tone = mix( vec3( 0.86, 0.83, 0.8 ), soilPatch, plain );
          vec3 soil = sampledDiffuseColor.rgb * mix( vec3( 1.0 ), tone, smoothstep( 0.34, 0.66, spots ) );
          soil *= 0.82 + 0.36 * ( fine.r * 0.4 + broad * 0.6 );
          soil *= mix( 1.0, 0.4 + 0.9 * fine.g, cobble );
          soil *= mix( 1.0, 0.62 + 0.62 * fine.b, gravel );
          diffuseColor.rgb *= soil;
        #endif`
      )
  }
  return material
}

// Las partes de una planta o piedra, listas para juntarse en una forma: sin uv,
// con normales planas (el look de pocos poligonos), su color y `tint`, cuanto
// toma del color de cada copia (el tronco 0, la copa 1). `shade` oscurece la
// parte de abajo: una sombra propia barata.
function plantPart(geometry, shade = 0, hex = 0xffffff, tint = 1) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  if (flat.attributes.uv) flat.deleteAttribute('uv')
  flat.computeVertexNormals()
  flat.computeBoundingBox()
  const { min, max } = flat.boundingBox
  const span = max.y - min.y || 1
  const position = flat.attributes.position
  const color = new THREE.Color(hex)
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const k = 1 - shade * (1 - (position.getY(i) - min.y) / span)
    colors.set([color.r * k, color.g * k, color.b * k], i * 3)
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  flat.setAttribute(
    'tint',
    new THREE.BufferAttribute(new Float32Array(position.count).fill(tint), 1)
  )
  return flat
}

// Mueve cada vertice de un poliedro segun su lugar, siempre igual para el mismo
// punto: asi las caras vecinas no se separan y la piedra sale irregular.
function lumpy(geometry, amount, squash) {
  const position = geometry.attributes.position
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const k =
      1 -
      amount +
      hash(Math.round(x * 997), Math.round(y * 991) * 7 + Math.round(z * 983)) * amount * 2
    position.setXYZ(i, x * k, y * k * squash, z * k)
  }
  return geometry
}

// Pino, roble y alamo de pocos poligonos, de unos 3 de alto (el heroe mide 2,1).
// El tronco no toma el color de la copia; la copa si, mas clara arriba.
function treeGeometries() {
  const gray = (k) => new THREE.Color(k, k, k)
  const trunk = (r, h) => {
    const bark = new THREE.CylinderGeometry(r * 0.65, r, h, 6, 1, true)
    return plantPart(bark.translate(0, h / 2, 0), 0, 0x5b3d24, 0)
  }
  // Pino: tres conos, mas oscuros abajo. [radio, alto, base, gris]
  const pine = [
    [0.66, 1.3, 0.55, 0.78],
    [0.52, 1.15, 1.25, 0.9],
    [0.36, 1.0, 1.9, 1]
  ].map(([r, h, y, k]) =>
    plantPart(new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0), 0.25, gray(k))
  )
  // Roble: una copa de cuatro bolas facetadas. [radio, x, y, z, gris]
  const oak = [
    [0.78, 0, 2, 0, 0.9],
    [0.56, 0.44, 1.72, 0.2, 0.74],
    [0.56, -0.4, 1.78, -0.22, 0.74],
    [0.5, 0.06, 2.58, 0.04, 1]
  ].map(([r, x, y, z, k]) =>
    plantPart(new THREE.IcosahedronGeometry(r).translate(x, y, z), 0.3, gray(k))
  )
  // Alamo: una copa alta y angosta.
  const poplar = new THREE.IcosahedronGeometry(0.5).scale(1, 2.1, 1).translate(0, 1.95, 0)
  return [
    [trunk(0.12, 0.9), ...pine],
    [trunk(0.15, 1.5), ...oak],
    [trunk(0.1, 0.9), plantPart(poplar, 0.45)]
  ].map((parts) => mergeGeometries(parts))
}

// Una mata baja que no pasa del ancho de su celda (media unidad). [radio, x, y, z]
function bushGeometry() {
  const lumps = [
    [0.22, 0, 0.15, 0],
    [0.16, 0.08, 0.12, 0.1],
    [0.16, -0.08, 0.11, -0.09]
  ]
  return mergeGeometries(
    lumps.map(([r, x, y, z]) =>
      plantPart(lumpy(new THREE.IcosahedronGeometry(r), 0.12, 0.8).translate(x, y, z), 0.45)
    )
  )
}

// Una piedra irregular con dos chicas delante y detras, a lo largo de su celda,
// que mide media unidad de ancho y una de largo. [forma, deformacion, x, y, z]
function rockGeometry() {
  const parts = [
    [new THREE.DodecahedronGeometry(0.2), 0.2, 0, 0.1, 0],
    [new THREE.OctahedronGeometry(0.09), 0.25, 0.05, 0.03, 0.3],
    [new THREE.OctahedronGeometry(0.08), 0.25, -0.04, 0.03, -0.3]
  ]
  return mergeGeometries(
    parts.map(([shape, amount, x, y, z]) =>
      plantPart(lumpy(shape, amount, 0.7).translate(x, y, z), 0.35)
    )
  )
}

// Una piedrita suelta, chata.
function pebbleGeometry() {
  return plantPart(
    lumpy(new THREE.OctahedronGeometry(0.075), 0.3, 0.55).translate(0, 0.015, 0),
    0.3
  )
}

// Una mata de pasto: hojas angostas que se abren desde el centro, oscuras al pie
// y claras en la punta. Las normales miran al cielo, como el suelo, asi la mata
// no se ve negra del lado de atras.
function tuftGeometry() {
  const position = []
  const color = []
  const foot = new THREE.Color(0x2c4a1c)
  const tip = new THREE.Color(0x8db552)
  const blades = 7
  for (let k = 0; k < blades; k++) {
    const angle = (k / blades) * Math.PI * 2 + hash(k, 1) * 0.7
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const out = 0.04 + hash(k, 2) * 0.05
    const lean = out + 0.1 + hash(k, 3) * 0.14
    const tall = 0.32 + hash(k, 4) * 0.28
    const half = 0.035 + hash(k, 5) * 0.015
    position.push(c * out - s * half, 0, s * out + c * half)
    position.push(c * out + s * half, 0, s * out - c * half)
    position.push(c * lean, tall, s * lean)
    color.push(foot.r, foot.g, foot.b, foot.r, foot.g, foot.b, tip.r, tip.g, tip.b)
  }
  const count = position.length / 3
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  const up = new Float32Array(count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0))
  geometry.setAttribute('normal', new THREE.BufferAttribute(up, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  geometry.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1))
  return geometry
}

// Una flor: tallo fino y una corola chata que mira al cielo, para que se lea
// desde la camara alta. El tallo queda verde; la corola toma el color de la copia.
function flowerGeometry() {
  const stem = (turn) => {
    const strip = new THREE.PlaneGeometry(0.035, 0.34).translate(0, 0.17, 0).rotateY(turn)
    return plantPart(strip, 0, 0x3f6a2a, 0)
  }
  const corolla = new THREE.CircleGeometry(0.13, 6).rotateX(-Math.PI / 2).translate(0, 0.34, 0)
  corolla.attributes.position.setY(0, 0.38)
  return mergeGeometries([stem(0), stem(Math.PI / 2), plantPart(corolla)])
}

// Material de las plantas: el color de cada copia pesa segun `tint`, la punta se
// mece con el viento (clock, en segundos) y con `glow` lo tenido brilla solo,
// como las flores de NOX. Con dos caras, la normal no se da vuelta atras.
function plantMaterial(clock, { sway = 0, glow = 0, side = THREE.FrontSide } = {}) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.clock = clock
    shader.uniforms.sway = { value: sway }
    shader.uniforms.glow = { value: glow }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float tint;\nuniform float clock;\nuniform float sway;\nvarying float vTint;'
      )
      .replace(
        '#include <color_vertex>',
        `vColor = vec4( 1.0 );
        vColor.rgb *= color;
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, tint );
        #endif
        vTint = tint;`
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        float bend = sway * transformed.y * transformed.y;
        mvPosition.x += sin( clock * 1.9 + mvPosition.x * 0.7 + mvPosition.z * 0.45 ) * bend;
        mvPosition.z += sin( clock * 1.4 + mvPosition.z * 0.6 - mvPosition.x * 0.3 ) * bend * 0.6;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float glow;\nvarying float vTint;')
      .replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal = normalize( vNormal );\n#endif'
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vTint * glow;'
      )
  }
  return material
}

// Muchas copias de una forma. Con `zone` van en mallas por zona del mapa: la
// camara ve pocas a la vez y three.js descarta las que quedan fuera de cuadro.
// Cada item: [x, z, giro, escala, alto, color, variacion, inclinacion].
function plantMeshes(geometry, material, items, { zone = 0, shadow = false } = {}) {
  const zones = new Map()
  for (const item of items) {
    const key = zone ? Math.floor(item[0] / zone) * 4096 + Math.floor(item[1] / zone) : 0
    if (!zones.has(key)) zones.set(key, [])
    zones.get(key).push(item)
  }
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const c = new THREE.Color()
  return [...zones.values()].map((list) => {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length)
    list.forEach(([x, z, yaw, size, tall, hex, vary, tilt = 0], i) => {
      e.set(tilt * Math.cos(vary * 40), yaw, tilt * Math.sin(vary * 40))
      mesh.setMatrixAt(
        i,
        m.compose(p.set(x, 0, z), q.setFromEuler(e), s.set(size, size * tall, size))
      )
      mesh.setColorAt(i, c.setHex(hex).offsetHSL((vary - 0.5) * 0.05, 0, (vary - 0.5) * 0.1))
    })
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    return mesh
  })
}

// Agua y lava: una superficie por liquido sobre los bloques chatos de la tercera
// pasada, con un cuadro por celda. `shore` vale 1 en las esquinas que tocan
// tierra: ahi el agua es baja y la lava se enfria. En el borde baja un faldon
// corto que tapa el costado del bloque de abajo.
function liquidMesh(data, kinds, kind, y, material) {
  const { width, height } = data
  const wet = (x, z) => x >= 0 && z >= 0 && x < width && z < height && kinds[z * width + x] === kind
  const dry = (x, z) => (wet(x - 1, z - 1) && wet(x, z - 1) && wet(x - 1, z) && wet(x, z) ? 0 : 1)
  const position = []
  const normal = []
  const shore = []
  // Un cuadro de cuatro esquinas (a b c d, en dos triangulos a b c y c b d) con su
  // normal y la orilla de cada esquina.
  const quad = (corners, n, s) => {
    for (const k of [0, 1, 2, 2, 1, 3]) {
      position.push(corners[k * 3], corners[k * 3 + 1], corners[k * 3 + 2])
      normal.push(...n)
      shore.push(s[k])
    }
  }
  // El faldon de un borde seco, de a hacia b mirando hacia afuera (n), apenas
  // corrido para quedar delante del bloque de abajo.
  const low = -0.06
  const wall = (ax, az, bx, bz, n) => {
    const [ox, oz] = [n[0] * 0.004, n[2] * 0.004]
    const corners = [
      ax + ox,
      y,
      az + oz,
      ax + ox,
      low,
      az + oz,
      bx + ox,
      y,
      bz + oz,
      bx + ox,
      low,
      bz + oz
    ]
    quad(corners, n, [1, 1, 1, 1])
  }
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (!wet(x, z)) continue
      const [x0, x1, z0, z1] = [x * CX, (x + 1) * CX, z * CZ, (z + 1) * CZ]
      const s = [dry(x, z), dry(x, z + 1), dry(x + 1, z), dry(x + 1, z + 1)]
      quad([x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z1], [0, 1, 0], s)
      if (!wet(x, z + 1)) wall(x0, z1, x1, z1, [0, 0, 1])
      if (!wet(x, z - 1)) wall(x1, z0, x0, z0, [0, 0, -1])
      if (!wet(x - 1, z)) wall(x0, z0, x0, z1, [-1, 0, 0])
      if (!wet(x + 1, z)) wall(x1, z1, x1, z0, [1, 0, 0])
    }
  }
  if (!position.length) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setAttribute('shore', new THREE.Float32BufferAttribute(shore, 1))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return mesh
}

// Un liquido que se mueve: dos capas del grano grueso que corren en direcciones
// distintas. `paint` es GLSL que usa wave (0..2) y shore (0..1) para cambiar
// diffuseColor y dejar la luz propia en `liquidGlow`.
function liquidMaterial(clock, options, paint) {
  const material = new THREE.MeshStandardMaterial(options)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.clock = clock
    shader.uniforms.soilDetail = { value: soilDetail() }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float shore;\nvarying float vShore;\nvarying vec2 vLiquid;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvShore = shore;\nvLiquid = position.xz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float clock;\nuniform sampler2D soilDetail;\nvarying float vShore;\nvarying vec2 vLiquid;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float waveA = texture2D( soilDetail, vLiquid * 0.21 + vec2( 0.031, 0.017 ) * clock ).a;
        float waveB = texture2D( soilDetail, vLiquid * 0.27 - vec2( 0.023, -0.027 ) * clock ).a;
        float wave = waveA + waveB;
        float shore = vShore;
        vec3 liquidGlow = vec3( 0.0 );
        ${paint}`
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += liquidGlow;'
      )
  }
  return material
}

// Agua: honda en el medio y mas clara en la orilla, con ondas suaves y algunos
// brillos chicos que corren con el viento.
const WATER = `
  diffuseColor.rgb *= 0.92 + 0.2 * ( wave - 1.0 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.36, 0.38 ), smoothstep( 0.55, 1.0, shore ) * 0.6 );
  float glint = texture2D( soilDetail, vLiquid * 0.37 + vec2( 0.05, -0.03 ) * clock ).b;
  glint *= texture2D( soilDetail, vLiquid * 0.29 - vec2( 0.04, 0.035 ) * clock ).b;
  liquidGlow = vec3( 0.75, 0.9, 1.0 ) * smoothstep( 0.62, 0.8, glint ) * ( 1.0 - shore ) * 0.9;
`
// Lava: placas de costra oscura (las piedras del canal G, grandes y torcidas por
// el oleaje) que derivan despacio; entre ellas y en los charcos la roca brilla.
// En la orilla la costra se enfria y apenas reluce.
const LAVA = `
  vec2 drift = vLiquid * 0.2 + vec2( 0.019, 0.011 ) * clock + ( vec2( waveA, waveB ) - 0.5 ) * 0.3;
  float plate = texture2D( soilDetail, drift ).g;
  float molten = max( 1.0 - smoothstep( 0.24, 0.44, plate ), smoothstep( 1.2, 1.4, wave ) );
  molten *= 1.0 - 0.75 * smoothstep( 0.4, 1.0, shore );
  diffuseColor.rgb *= ( 0.4 + 0.5 * plate ) * ( 1.0 - molten );
  float flicker = 0.9 + 0.1 * sin( clock * 1.7 + vLiquid.x * 0.35 + vLiquid.y * 0.2 );
  liquidGlow = mix( vec3( 0.22, 0.05, 0.01 ), vec3( 1.6, 0.62, 0.14 ), molten ) * flicker;
`

// Arboles, matas, piedras, flores, pasto y piedritas. Lo que se ve solido
// (arbol, mata, piedra) va solo en celdas que no se pisan; en las que se pisan,
// solo pasto, flores y piedritas. Las que se repiten mucho van por zonas.
function natureMeshes(data, kinds, clock) {
  const { width, height, rows } = data
  const boss = data.kind === 'boss'
  const night = data.id === 'nox'
  const leaves = LEAVES[data.id] || LEAVES.city
  const blooms = BLOOM[data.id] || BLOOM.city
  const grassTone = night ? 0x8ab8b4 : 0xffffff
  const stones = boss ? [0x2a2420, 0x3b332e, 0x4a2a1e] : [0xa39c8f, 0x857e73, 0xb8b0a0, 0x6f695f]
  const trees = [[], [], []]
  const bushes = []
  const rocks = []
  const flowers = []
  const tufts = []
  const pebbles = []
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height
  // Lo que no es estructura deja ver: un arbol o una piedra rodeados de edificio
  // quedan tapados y no se dibujan.
  const clear = (x, y) => inside(x, y) && !STRUCTURE.has(kinds[y * width + x])
  const land = (x, y) => inside(x, y) && !kinds[y * width + x]
  // El numero al azar k de la celda, siempre el mismo.
  const r = (x, y, k) => hash(x * 31 + k * 7919, y * 17 - k * 104729)
  const pick = (options, x, y, k) => options[Math.floor(r(x, y, k) * options.length)]
  // Deja una copia en un punto al azar de la celda, sin tocar el borde: [x, z,
  // giro, escala, alto, color, variacion, inclinacion].
  const drop = (list, x, y, k, size, hex, tilt) =>
    list.push([
      (x + 0.5 + (r(x, y, k) - 0.5) * 0.68) * CX,
      (y + 0.5 + (r(x, y, k + 50) - 0.5) * 0.84) * CZ,
      r(x, y, k + 1) * 6.3,
      size,
      1,
      hex,
      r(x, y, k + 2),
      tilt
    ])
  for (let y = 0; y < height; y++) {
    const row = rows[y] || ''
    for (let x = 0; x < width; x++) {
      const kind = kinds[y * width + x]
      const ch = row[x] || ' '
      const cx = (x + 0.5) * CX
      const cz = (y + 0.5) * CZ
      const spin = r(x, y, 4) * 6.3
      const vary = r(x, y, 8)
      if (kind === 'tree' || kind === 'rock') {
        if (!clear(x + 1, y) && !clear(x - 1, y) && !clear(x, y + 1) && !clear(x, y - 1)) continue
        const size = 0.85 + r(x, y, 5) * 0.35
        if (kind === 'rock') {
          // Girada de punta a punta nada mas: asi no se sale de su celda.
          const [turn, hex] = [Math.round(spin / Math.PI) * Math.PI, night ? 0x6c6a7c : 0x857f76]
          rocks.push([
            cx,
            cz,
            turn + (vary - 0.5) * 0.4,
            size * 0.9,
            0.8 + vary * 0.4,
            hex,
            vary,
            0.1
          ])
          continue
        }
        const species = r(x, y, 1) < 0.42 ? 0 : r(x, y, 1) < 0.8 ? 1 : 2
        const [tx, tz] = [cx + (r(x, y, 2) - 0.5) * 0.08, cz + (r(x, y, 3) - 0.5) * 0.14]
        const [tall, leaf] = [0.9 + r(x, y, 6) * 0.25, pick(leaves[species], x, y, 7)]
        trees[species].push([tx, tz, spin, size, tall, leaf, vary, 0.05])
        // Una mata al pie, del lado de la camara.
        const bush = night ? 0x3b3f66 : 0x3f6e2e
        bushes.push([tx, cz + 0.22, spin + 2, 0.8 + r(x, y, 11) * 0.2, 1, bush, vary])
      } else if (kind === 'water') {
        // Juncos en la orilla, dentro del agua y del lado de la tierra.
        const side = land(x + 1, y) ? 1 : land(x - 1, y) ? -1 : 0
        const shore = side ? 0 : land(x, y + 1) ? 1 : land(x, y - 1) ? -1 : 0
        if ((side || shore) && r(x, y, 1) < 0.35) {
          const [rx, rz] = [cx + side * CX * 0.3, cz + shore * CZ * 0.3]
          tufts.push([rx, rz, spin, 0.9 + r(x, y, 3) * 0.3, 1.8, 0xd8d08a, vary, 0.05])
        }
      } else if (kind) continue
      else if (boss) {
        // En las ruinas: piedritas de ceniza y escoria.
        const hex = pick(stones, x, y, 6)
        if (r(x, y, 1) < 0.12) drop(pebbles, x, y, 2, 0.8 + r(x, y, 5) * 0.9, hex, 0.3)
      } else if (ch === '*') {
        for (let k = 0; k < 3; k++) {
          const hex = pick(blooms, x, y, 40 + k)
          drop(flowers, x, y, 10 + k * 3, 0.85 + r(x, y, 30 + k) * 0.45, hex, 0.12)
        }
      } else if (ch === '"') {
        for (let k = 0; k < 3; k++) {
          drop(tufts, x, y, 10 + k * 3, 1.1 + r(x, y, 30 + k) * 0.45, grassTone, 0.1)
        }
      } else if (ch === ',' || ch === '`') {
        // Pasto: matas sueltas; en el suelo quieto, alguna de vez en cuando.
        const [often, size] = ch === ',' ? [0.75, 0.6] : [0.03, 0.5]
        if (r(x, y, 1) < often) drop(tufts, x, y, 2, size + r(x, y, 5) * 0.3, grassTone, 0.1)
      } else if ((ch === '.' || ch === '%') && r(x, y, 1) < (ch === '.' ? 0.14 : 0.2)) {
        drop(pebbles, x, y, 2, 0.7 + r(x, y, 5) * 0.9, pick(stones, x, y, 6), 0.3)
      }
    }
  }
  const leafy = plantMaterial(clock, { sway: 0.004 })
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })
  const both = THREE.DoubleSide
  const petals = plantMaterial(clock, { sway: 0.5, glow: night ? 0.9 : 0.12, side: both })
  const blades = plantMaterial(clock, { sway: 0.25, side: both })
  const [pine, oak, poplar] = treeGeometries()
  const water = { color: 0x22607f, roughness: 0.25, metalness: 0.1, emissive: 0x082230 }
  return [
    ...plantMeshes(pine, leafy, trees[0], { shadow: true }),
    ...plantMeshes(oak, leafy, trees[1], { shadow: true }),
    ...plantMeshes(poplar, leafy, trees[2], { shadow: true }),
    ...plantMeshes(bushGeometry(), plantMaterial(clock), bushes, { shadow: true }),
    ...plantMeshes(rockGeometry(), stone, rocks, { shadow: true }),
    ...plantMeshes(pebbleGeometry(), stone, pebbles, { zone: 48 }),
    ...plantMeshes(flowerGeometry(), petals, flowers, { zone: 48 }),
    ...plantMeshes(tuftGeometry(), blades, tufts, { zone: 48 }),
    liquidMesh(data, kinds, 'water', 0.045, liquidMaterial(clock, water, WATER)),
    liquidMesh(data, kinds, 'lava', 0.095, liquidMaterial(clock, { color: 0x3a1408 }, LAVA))
  ].filter(Boolean)
}

// Pinta una geometria de un color, para juntar muchas en una sola malla.
function paint(geometry, hex) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  flat.deleteAttribute('uv')
  const c = new THREE.Color(hex)
  const colors = new Float32Array(flat.attributes.position.count * 3)
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i)
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return flat
}

const UP = [0, 1, 0]
const DOWN = [0, -1, 0]
const mix = (p, q, s) => [
  p[0] + (q[0] - p[0]) * s,
  p[1] + (q[1] - p[1]) * s,
  p[2] + (q[2] - p[2]) * s
]

// Un color cerca de otro: cada edificio tiene su tono sin salirse de la paleta.
// k va de 0 a 1; hue y light dicen cuanto se puede mover el tono y la luz.
function vary(hex, k, hue, light) {
  const c = new THREE.Color(hex)
  const hsl = c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace)
  const l = hsl.l + (hash(Math.floor(k * 9973), 31) - 0.5) * light
  const h = hsl.h + (k - 0.5) * hue + 1
  return c.setHSL(h, hsl.s, Math.min(0.92, Math.max(0.03, l)), THREE.SRGBColorSpace)
}

// Caras planas con color por vertice: todos los edificios de un mapa terminan
// en una sola malla, o sea en un solo dibujado.
function mason() {
  const position = []
  const normal = []
  const color = []
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  // Un triangulo o un cuadrilatero convexo, de un color o de uno por punto. Con
  // `out` la cara se da vuelta hasta mirar hacia ese lado: no importa el orden.
  function face(points, tint, out) {
    const [a, b, c, d] = points
    ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    ab.cross(ac)
    if (ab.lengthSq() < 1e-10 && d) {
      ab.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
      ac.set(d[0] - a[0], d[1] - a[1], d[2] - a[2])
      ab.cross(ac)
    }
    let list = points
    let tints = Array.isArray(tint) ? tint : null
    if (out && ab.x * out[0] + ab.y * out[1] + ab.z * out[2] < 0) {
      list = [...points].reverse()
      if (tints) tints = [...tints].reverse()
      ab.negate()
    }
    ab.normalize()
    for (const k of list.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]) {
      const p = list[k]
      const t = tints ? tints[k] : tint
      position.push(p[0], p[1], p[2])
      normal.push(ab.x, ab.y, ab.z)
      color.push(t.r, t.g, t.b)
    }
  }
  // Caja alineada con los ejes. Sin piso: siempre apoya en algo. Cada esquina
  // es un numero: el bit 1 elige x, el 2 la altura y el 4 z.
  function box(x0, y0, z0, x1, y1, z1, tint) {
    const corner = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0]
    for (const quad of [
      [4, 5, 7, 6],
      [1, 0, 2, 3],
      [5, 1, 3, 7],
      [0, 4, 6, 2],
      [6, 7, 3, 2]
    ]) {
      face(quad.map(corner), tint)
    }
  }
  // Una viga de seccion cuadrada entre dos puntos: cumbreras, limatones y
  // mensulas.
  function beam(a, b, size, tint) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
    const side = new THREE.Vector3(-d.z, 0, d.x)
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
    side.setLength(size / 2)
    const up = new THREE.Vector3().crossVectors(side, d).setLength(size / 2)
    const turns = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ]
    const ring = (p) =>
      turns.map(([s, u]) => [
        p[0] + side.x * s + up.x * u,
        p[1] + side.y * s + up.y * u,
        p[2] + side.z * s + up.z * u
      ])
    const A = ring(a)
    const B = ring(b)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      const s = turns[i][0] + turns[j][0]
      const u = turns[i][1] + turns[j][1]
      const o = [side.x * s + up.x * u, side.y * s + up.y * u, side.z * s + up.z * u]
      face([A[i], A[j], B[j], B[i]], tint, o)
    }
    face(A, tint, [-d.x, -d.y, -d.z])
    face(B, tint, [d.x, d.y, d.z])
  }
  // Una aguja de cuatro caras.
  function spike(x, y, z, size, height, tint) {
    const tip = [x, y + height, z]
    const base = [
      [x - size, y, z - size],
      [x + size, y, z - size],
      [x + size, y, z + size],
      [x - size, y, z + size]
    ]
    base.forEach((p, i) => {
      const q = base[(i + 1) % 4]
      face([p, q, tip], tint, [(p[0] + q[0]) / 2 - x, 0, (p[2] + q[2]) / 2 - z])
    })
  }
  // Un faldon por hiladas paralelas al alero, con una linea oscura abajo de
  // cada una: de lejos se lee como tejas y no como un plano liso.
  function slope(e0, e1, t1, t0, tint, seed) {
    const run = Math.hypot(
      (t0[0] + t1[0] - e0[0] - e1[0]) / 2,
      (t0[1] + t1[1] - e0[1] - e1[1]) / 2,
      (t0[2] + t1[2] - e0[2] - e1[2]) / 2
    )
    const rows = Math.max(2, Math.round(run / 0.8))
    const line = tint.clone().multiplyScalar(0.55)
    for (let i = 0; i < rows; i++) {
      const s0 = i / rows
      const s1 = (i + 1) / rows
      const s2 = s0 + 0.2 / rows
      face([mix(e0, t0, s0), mix(e1, t1, s0), mix(e1, t1, s2), mix(e0, t0, s2)], line, UP)
      const row = tint.clone().multiplyScalar(0.9 + 0.16 * hash(seed, i))
      face([mix(e0, t0, s2), mix(e1, t1, s2), mix(e1, t1, s1), mix(e0, t0, s1)], row, UP)
    }
  }
  function geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
    return g
  }
  return { face, box, beam, spike, slope, geometry, count: () => position.length / 3 }
}

// Techo con espesor sobre el rectangulo de las paredes: a cuatro aguas o a dos
// aguas. El alero sale siguiendo la pendiente, el canto muestra el espesor y
// arriba va la cumbrera. Devuelve la cumbrera y la altura del techo en cada
// punto, para apoyar las chimeneas.
function roof(m, spec) {
  const { x0, x1, z0, z1, H, rise, hip, alongX, tint } = spec
  const t = spec.thick || 0.3
  const reach = spec.reach || 0.9
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const hu = (alongX ? x1 - x0 : z1 - z0) / 2
  const hv = (alongX ? z1 - z0 : x1 - x0) / 2
  const P = (u, y, v) => (alongX ? [cx + u, y, cz + v] : [cx + v, y, cz + u])
  const dir = (u, v) => (alongX ? [u, 0, v] : [v, 0, u])
  // r: media cumbrera. En el de cuatro aguas los faldones de las puntas caen
  // mas parados, asi el alero queda a la misma altura alrededor.
  const r = hip ? Math.min(hu * 0.7, Math.max(0, hu - hv) + hu * (spec.ridge ?? 0.2)) : hu
  const s = rise / hv
  const ov = Math.min(reach, Math.max(0.2, 0.4 / s))
  const drop = s * ov
  const ou = hip ? (drop * (hu - r)) / rise : Math.min(reach, 0.45)
  const U = hu + ou
  const V = hv + ov
  const ye = H + t - drop
  const yr = H + t + rise
  const faces = hip
    ? [
        [P(-U, ye, V), P(U, ye, V), P(r, yr, 0), P(-r, yr, 0)],
        [P(U, ye, -V), P(-U, ye, -V), P(-r, yr, 0), P(r, yr, 0)],
        [P(U, ye, V), P(U, ye, -V), P(r, yr, 0), P(r, yr, 0)],
        [P(-U, ye, -V), P(-U, ye, V), P(-r, yr, 0), P(-r, yr, 0)]
      ]
    : [
        [P(-U, ye, V), P(U, ye, V), P(U, yr, 0), P(-U, yr, 0)],
        [P(U, ye, -V), P(-U, ye, -V), P(-U, yr, 0), P(U, yr, 0)]
      ]
  const under = tint.clone().multiplyScalar(0.4)
  const low = (p) => [p[0], p[1] - t, p[2]]
  faces.forEach(([e0, e1, t1, t0], i) => {
    m.slope(e0, e1, t1, t0, tint, spec.seed + i)
    m.face([low(e0), low(e1), low(t1), low(t0)], under, DOWN)
  })
  // El canto del techo: de lejos lo despega de la pared.
  const rim = (a, b, o) => m.face([a, b, low(b), low(a)], spec.edge, o)
  rim(P(-U, ye, V), P(U, ye, V), dir(0, 1))
  rim(P(U, ye, -V), P(-U, ye, -V), dir(0, -1))
  if (hip) {
    rim(P(U, ye, V), P(U, ye, -V), dir(1, 0))
    rim(P(-U, ye, -V), P(-U, ye, V), dir(-1, 0))
    m.beam(P(-r - 0.15, yr + 0.04, 0), P(r + 0.15, yr + 0.04, 0), 0.36, spec.cap)
    for (const [a, b] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1]
    ]) {
      m.beam(P(a * r, yr, 0), P(a * U, ye, b * V), 0.26, spec.cap)
    }
  } else {
    for (const k of [-1, 1]) {
      rim(P(k * U, ye, V), P(k * U, yr, 0), dir(k, 0))
      rim(P(k * U, yr, 0), P(k * U, ye, -V), dir(k, 0))
      // El hastial: la pared en triangulo bajo el techo.
      if (spec.wall) {
        m.face([P(k * hu, H, -hv), P(k * hu, H, hv), P(k * hu, H + rise, 0)], spec.wall, dir(k, 0))
      }
    }
    m.beam(P(-U - 0.08, yr + 0.04, 0), P(U + 0.08, yr + 0.04, 0), 0.36, spec.cap)
  }
  // Venas encendidas sobre la cumbrera, los limatones y los bordes del hastial:
  // de lejos dibujan la silueta del techo.
  if (spec.veins) {
    const { m: glow, tint: vein } = spec.veins
    const lines = hip
      ? [-1, 1].flatMap((a) => [
          [P(a * r, yr + 0.17, 0), P(a * U, ye + 0.17, V)],
          [P(a * r, yr + 0.17, 0), P(a * U, ye + 0.17, -V)]
        ])
      : [-1, 1].flatMap((a) => [
          [P(a * U, yr + 0.05, 0), P(a * U, ye + 0.05, V)],
          [P(a * U, yr + 0.05, 0), P(a * U, ye + 0.05, -V)]
        ])
    lines.push([P(hip ? -r - 0.1 : -U, yr + 0.24, 0), P(hip ? r + 0.1 : U, yr + 0.24, 0)])
    for (const [a, b] of lines) glow.beam(a, b, 0.07, vein)
  }
  // Cresteria: puntas de hierro a lo largo de la cumbrera.
  const ridge = hip ? r : U
  if (spec.crest) {
    const count = Math.floor((2 * ridge) / 0.8)
    for (let i = 0; i <= count; i++) {
      const p = P(count ? -ridge + ((2 * ridge) / count) * i : 0, yr + 0.15, 0)
      m.spike(p[0], p[1], p[2], 0.07, 0.6, spec.cap)
    }
  }
  const height = (x, z) => {
    const u = Math.abs(alongX ? x - cx : z - cz)
    const v = Math.abs(alongX ? z - cz : x - cx)
    const y = yr - ((yr - ye) / V) * v
    return hip ? Math.min(y, yr - ((yr - ye) / (U - r)) * Math.max(0, u - r)) : y
  }
  return { top: yr, height, r, U, V, ends: [P(-ridge, yr, 0), P(ridge, yr, 0)] }
}

// Chimenea apoyada en el faldon, con su sombrerete oscuro.
function chimney(m, x, z, roofAt, tint) {
  const s = 0.45
  const ys = [
    roofAt(x - s, z - s),
    roofAt(x + s, z - s),
    roofAt(x + s, z + s),
    roofAt(x - s, z + s)
  ]
  const top = Math.max(...ys) + 1.5
  m.box(x - s, Math.min(...ys) - 0.4, z - s, x + s, top, z + s, tint)
  const cap = tint.clone().multiplyScalar(0.4)
  m.box(x - s - 0.12, top, z - s - 0.12, x + s + 0.12, top + 0.22, z + s + 0.12, cap)
}

// Una buhardilla sobre un faldon: el frente con su hastial, las mejillas en
// triangulo y un techito a dos aguas que muere justo contra el techo grande.
// at(u, y, d) lleva al mundo: u a lo largo del faldon, d desde el frente hacia
// la cumbrera; slope es la pendiente del faldon.
function dormer(m, spec) {
  const { at, y, slope, rise, tint, cap, wall, out, side } = spec
  const half = 0.75
  const wide = half + 0.15
  const high = 1.45
  const t = 0.15
  const yw = y + high
  const yr = yw + t + rise
  const eave = high / slope
  const ridge = (yr - y) / slope
  const lip = -0.2
  m.face(
    [at(-half, y - 0.2, 0), at(half, y - 0.2, 0), at(half, yw, 0), at(-half, yw, 0)],
    wall,
    out
  )
  m.face([at(-half, yw, 0), at(half, yw, 0), at(0, yr - t, 0)], wall, out)
  for (const k of [-1, 1]) {
    const cheek = [side[0] * k, 0, side[2] * k]
    m.face([at(k * half, y, 0), at(k * half, yw, 0), at(k * half, yw, eave)], wall, cheek)
    m.slope(
      at(k * wide, yw, lip),
      at(k * wide, yw, eave),
      at(0, yr, ridge),
      at(0, yr, lip),
      tint,
      spec.seed + k
    )
    m.face(
      [at(k * wide, yw, lip), at(0, yr, lip), at(0, yr - t, lip), at(k * wide, yw - t, lip)],
      cap,
      out
    )
  }
  m.beam(at(0, yr + 0.02, lip), at(0, yr + 0.02, ridge), 0.22, cap)
}

// Una casa: zocalo de piedra por bloques, paredes con bandas entre pisos y
// esquineros, techo con alero, buhardillas y chimeneas, ventanas con marco y la
// puerta en la fachada de su celda de puerta, metida en la pared para que la
// celda se vea. opts cambia pisos, pendiente, techo, la corona (almenas en vez
// de techo) y suma el porton grande, las torrecillas, el estandarte o el
// campanario. Devuelve la altura mas alta.
function house(site, rect, opts) {
  const { m, look } = site
  const rand = (i) => hash(opts.seed, i)
  const { x0, x1, z0, z1 } = rect
  const W = x1 - x0
  const D = z1 - z0
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const narrow = Math.min(W, D)
  const tower = narrow < 4.5 && Math.max(W, D) < 8
  const floors = opts.floors || (tower ? 3 : Math.min(3, Math.max(1, Math.round(narrow / 9))))
  const F = look.floor
  const base = 0.8
  const H = base + floors * F
  const wall = vary(look.wall, rand(1), 0.06, 0.16)
  const stone = vary(look.stone, rand(2), 0.02, 0.1)
  const trim = vary(look.trim, rand(3), 0.03, 0.08)
  const family = opts.roof || look.roofs[Math.floor(rand(4) * look.roofs.length)]
  const tile = vary(family, rand(5), 0.03, 0.12)
  const cap = tile.clone().multiplyScalar(0.55)
  const edge = vary(look.frame, rand(6), 0.02, 0.06)
  const shade = (v) => wall.clone().multiplyScalar(0.68 + 0.32 * Math.min(1, v / H))
  // Donde ira el campanario, si es una iglesia: ahi no van ventanas.
  const belfry = opts.belfry ? { x0: x0 - 0.4, x1: x0 + 4.6, z0: z1 - 4.6, z1: z1 + 0.4 } : null
  const sides = [
    { id: 0, o: [cx, z1], u: [1, 0], n: [0, 1], len: W },
    { id: 1, o: [cx, z0], u: [-1, 0], n: [0, -1], len: W },
    { id: 2, o: [x1, cz], u: [0, -1], n: [1, 0], len: D },
    { id: 3, o: [x0, cz], u: [0, 1], n: [-1, 0], len: D }
  ]
  // De coordenadas de fachada (a lo largo, altura, hacia afuera) al mundo.
  const at = (s, u, v, n = 0) => [
    s.o[0] + s.u[0] * u + s.n[0] * n,
    v,
    s.o[1] + s.u[1] * u + s.n[1] * n
  ]
  const out = (s) => [s.n[0], 0, s.n[1]]
  const block = (mm, s, u0, u1, v0, v1, n0, n1, tint) => {
    const a = at(s, u0, v0, n0)
    const b = at(s, u1, v1, n1)
    mm.box(
      Math.min(a[0], b[0]),
      v0,
      Math.min(a[2], b[2]),
      Math.max(a[0], b[0]),
      v1,
      Math.max(a[2], b[2]),
      tint
    )
  }

  // Paredes lisas, oscuras abajo y claras arriba; en los mapas de piedra, por
  // hiladas de sillares trabados, cada uno de su tono.
  const course = 1.05
  const joint = 2.6
  const rows = (a, b, fn) => {
    for (let row = Math.floor(a / course); row * course < b - 1e-3; row++) {
      fn(row, Math.max(a, row * course), Math.min(b, (row + 1) * course))
    }
  }
  const ashlar = (s, row, u, v) => {
    const k = Math.floor((u + (row % 2) * joint * 0.5) / joint) + 4096
    return shade(v).multiplyScalar(0.84 + 0.26 * hash(k, row * 7 + s.id + opts.seed))
  }
  const panel = (s, u0, u1, v0, v1) => {
    if (!look.masonry) {
      m.face(
        [at(s, u0, v0), at(s, u1, v0), at(s, u1, v1), at(s, u0, v1)],
        [shade(v0), shade(v0), shade(v1), shade(v1)],
        out(s)
      )
      return
    }
    rows(v0, v1, (row, a, b) => {
      const shift = (row % 2) * joint * 0.5
      let p = u0
      while (p < u1 - 1e-3) {
        const next = (Math.floor((p + shift) / joint + 1e-6) + 1) * joint - shift
        const q = Math.min(u1, next > p + 1e-3 ? next : p + joint)
        const tone = ashlar(s, row, (p + q) / 2, (a + b) / 2)
        m.face([at(s, p, a), at(s, q, a), at(s, q, b), at(s, p, b)], tone, out(s))
        p = q
      }
    })
  }
  // La pared sobre el hueco de la puerta baja hasta el arco.
  const above = (s, ua, va, ub, vb) => {
    if (!look.masonry) {
      m.face(
        [at(s, ua, va), at(s, ub, vb), at(s, ub, H), at(s, ua, H)],
        [shade(va), shade(vb), shade(H), shade(H)],
        out(s)
      )
      return
    }
    const low = Math.max(va, vb)
    const first = Math.min(H, (Math.floor(low / course) + 1) * course)
    const mid = (ua + ub) / 2
    m.face(
      [at(s, ua, va), at(s, ub, vb), at(s, ub, first), at(s, ua, first)],
      ashlar(s, Math.floor(low / course), mid, low),
      out(s)
    )
    rows(first, H, (row, a, b) => {
      const tone = ashlar(s, row, mid, (a + b) / 2)
      m.face([at(s, ua, a), at(s, ub, a), at(s, ub, b), at(s, ua, b)], tone, out(s))
    })
  }

  // La puerta: un hueco con arco o dintel, hondo, con la hoja de tablas al fondo.
  // El porton de un castillo es mas ancho y sube dos pisos.
  let door = null
  if (opts.door) {
    const s = sides[opts.door.side]
    const half = opts.grand ? 1.5 : 0.95
    const jamb = opts.grand ? 0.42 : 0.32
    const room = s.len / 2 - half - jamb - 0.5
    const along = (opts.door.x - s.o[0]) * s.u[0] + (opts.door.z - s.o[1]) * s.u[1]
    if (room > 0) {
      const style = look.arch[Math.floor(rand(7) * look.arch.length)]
      const storeys = opts.grand && floors > 2 ? 2 : 1
      const limit = floors > storeys ? base + storeys * F - 0.3 : H - 0.6
      const k = style === 'pointed' ? Math.sqrt(3) : 1
      const spring = style === 'flat' ? limit - jamb : limit - k * half - jamb
      const u = Math.max(-room, Math.min(room, along))
      // El borde del hueco: t va de 0 a 1 de un arranque al otro; grow lo agranda.
      const curve = (t, grow) => {
        if (style === 'flat') return [u - half - grow + 2 * (half + grow) * t, spring + grow]
        if (style === 'round') {
          const a = Math.PI * (1 - t)
          return [u + (half + grow) * Math.cos(a), spring + (half + grow) * Math.sin(a)]
        }
        const left = t <= 0.5
        const a = Math.PI - ((2 * Math.PI) / 3) * (left ? t : 1 - t)
        const r = 2 * half + grow
        const du = half + r * Math.cos(a)
        return [u + (left ? du : -du), spring + r * Math.sin(a)]
      }
      // La altura del hueco a una distancia du del centro.
      const heightAt = (du) => {
        if (style === 'flat') return spring
        if (style === 'round') return spring + Math.sqrt(Math.max(0, half * half - du * du))
        return spring + Math.sqrt(Math.max(0, 4 * half * half - (Math.abs(du) + half) ** 2))
      }
      const top = style === 'flat' ? spring + jamb : curve(0.5, jamb)[1] + 0.16
      door = { side: opts.door.side, u, half, jamb, spring, curve, heightAt, style, top }
    }
  }

  // Paredes; en la de la puerta queda el hueco.
  const N = 10
  for (const s of sides) {
    if (!door || door.side !== s.id) {
      panel(s, -s.len / 2, s.len / 2, 0, H)
      continue
    }
    panel(s, -s.len / 2, door.u - door.half, 0, H)
    panel(s, door.u + door.half, s.len / 2, 0, H)
    for (let i = 0; i < N; i++) {
      const [ua, va] = door.curve(i / N, 0)
      const [ub, vb] = door.curve((i + 1) / N, 0)
      above(s, ua, va, ub, vb)
    }
  }

  if (door) {
    const s = sides[door.side]
    const { u, half, jamb, spring, style } = door
    const deep = 0.95
    const jut = 0.18
    const dark = shade(0).multiplyScalar(0.4)
    const frame = look.vein ? edge : trim
    // Los costados y el techo del hueco.
    for (const k of [-1, 1]) {
      const e = u + k * half
      m.face([at(s, e, 0), at(s, e, 0, -deep), at(s, e, spring, -deep), at(s, e, spring)], dark, [
        -k * s.u[0],
        0,
        -k * s.u[1]
      ])
    }
    for (let i = 0; i < N; i++) {
      const [ua, va] = door.curve(i / N, 0)
      const [ub, vb] = door.curve((i + 1) / N, 0)
      const du = u - (ua + ub) / 2
      const dv = spring - (va + vb) / 2
      const inward = style === 'flat' ? DOWN : [du * s.u[0], dv, du * s.u[1]]
      m.face(
        [at(s, ua, va), at(s, ub, vb), at(s, ub, vb, -deep), at(s, ua, va, -deep)],
        dark,
        inward
      )
      // El marco: el arco (o el dintel) que sobresale de la pared.
      const [oa, ova] = door.curve(i / N, jamb)
      const [ob, ovb] = door.curve((i + 1) / N, jamb)
      m.face(
        [at(s, ua, va, jut), at(s, ub, vb, jut), at(s, ob, ovb, jut), at(s, oa, ova, jut)],
        frame,
        out(s)
      )
      // En NOX el borde de adentro del arco brilla, como un portal.
      if (look.vein) {
        const [ga, gva] = door.curve(i / N, 0.08)
        const [gb, gvb] = door.curve((i + 1) / N, 0.08)
        const n = jut + 0.01
        site.glow.face(
          [at(s, ua, va, n), at(s, ub, vb, n), at(s, gb, gvb, n), at(s, ga, gva, n)],
          site.vein,
          out(s)
        )
      }
      const ou = (oa + ob) / 2 - u
      const outward = style === 'flat' ? UP : [ou * s.u[0], (ova + ovb) / 2 - spring, ou * s.u[1]]
      m.face(
        [at(s, oa, ova), at(s, ob, ovb), at(s, ob, ovb, jut), at(s, oa, ova, jut)],
        frame,
        outward
      )
    }
    for (const k of [-1, 1]) {
      const e = u + k * half
      block(m, s, e, e + k * jamb, 0, spring, -0.05, jut, frame)
      if (look.vein) block(site.glow, s, e, e + k * 0.08, 0, spring, jut, jut + 0.01, site.vein)
    }
    if (style !== 'flat') {
      const apex = door.curve(0.5, 0)[1]
      block(m, s, u - 0.2, u + 0.2, apex - 0.1, apex + jamb + 0.16, -0.05, jut + 0.07, frame)
    }
    // La hoja: tablas de dos tonos y flejes de hierro.
    const leaf = vary(look.door, rand(8), 0.03, 0.12)
    const planks = opts.grand ? 8 : 6
    for (let i = 0; i < planks; i++) {
      const a = u - half + (2 * half * i) / planks
      const b = a + (2 * half) / planks
      m.face(
        [
          at(s, a, 0, -deep),
          at(s, b, 0, -deep),
          at(s, b, door.heightAt(b - u), -deep),
          at(s, a, door.heightAt(a - u), -deep)
        ],
        leaf.clone().multiplyScalar(i % 2 ? 0.82 : 1),
        out(s)
      )
    }
    for (const v of [spring * 0.26, spring * 0.68]) {
      block(m, s, u - half, u + half, v, v + 0.1, -deep, -deep + 0.03, dark)
    }
    // Sobre la puerta de dintel, un tejadito con dos mensulas.
    if (style === 'flat') {
      const y = spring + jamb + 0.12
      const a = at(s, u - 1.4, 0, -0.1)
      const b = at(s, u + 1.4, 0, 0.95)
      roof(m, {
        x0: Math.min(a[0], b[0]),
        x1: Math.max(a[0], b[0]),
        z0: Math.min(a[2], b[2]),
        z1: Math.max(a[2], b[2]),
        H: y,
        rise: 0.5,
        hip: false,
        alongX: s.n[0] !== 0,
        tint: tile,
        cap,
        edge,
        reach: 0.25,
        thick: 0.16,
        seed: opts.seed + 9
      })
      for (const k of [-1, 1]) {
        m.beam(at(s, u + k * 1.2, y - 0.8, 0), at(s, u + k * 1.2, y, 0.85), 0.14, trim)
      }
    }
  }

  // Zocalo de piedra: bloques de distinto tono a lo largo de la base.
  const plinth = (s, from, to) => {
    const front = 0.2
    const ledge = stone.clone().multiplyScalar(0.92)
    m.face(
      [
        at(s, from, base, -0.3),
        at(s, to, base, -0.3),
        at(s, to, base, front),
        at(s, from, base, front)
      ],
      ledge,
      UP
    )
    for (const [e, sign] of [
      [from, -1],
      [to, 1]
    ]) {
      m.face(
        [at(s, e, 0, -0.3), at(s, e, 0, front), at(s, e, base, front), at(s, e, base, -0.3)],
        stone,
        [sign * s.u[0], 0, sign * s.u[1]]
      )
    }
    let a = from
    let i = s.id * 97
    while (a < to - 0.02) {
      const b = Math.min(to, a + 1.2 + rand(i) * 0.9)
      const tone = stone.clone().multiplyScalar(0.8 + 0.34 * rand(300 + i))
      m.face(
        [at(s, a, 0, front), at(s, b, 0, front), at(s, b, base, front), at(s, a, base, front)],
        tone,
        out(s)
      )
      a = b
      i++
    }
  }
  for (const s of sides) {
    const end = s.id < 2 ? s.len / 2 + 0.26 : s.len / 2 - 0.3
    if (door && door.side === s.id) {
      plinth(s, -end, door.u - door.half - door.jamb)
      plinth(s, door.u + door.half + door.jamb, end)
    } else plinth(s, -end, end)
  }

  // Esquineros y bandas entre pisos: de lejos dibujan las aristas y los pisos.
  const post = 0.3
  const postTop = look.spire ? H + 1.2 : H - 0.3
  const corners = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1]
  ]
  for (const [x, z] of corners) {
    m.box(x - post, base, z - post, x + post, postTop, z + post, trim)
    if (look.spire) m.spike(x, postTop, z, post + 0.05, 1.3, trim)
  }
  for (const s of sides) {
    const end = s.id < 2 ? s.len / 2 + 0.17 : s.len / 2
    for (let f = 1; f < floors; f++) {
      const v = base + f * F
      const cut = door && door.side === s.id && door.top > v - 0.12
      const pieces = cut
        ? [
            [-s.len / 2, door.u - door.half - door.jamb],
            [door.u + door.half + door.jamb, s.len / 2]
          ]
        : [[-s.len / 2, s.len / 2]]
      for (const [a, b] of pieces) {
        block(m, s, a, b, v - 0.12, v + 0.12, -0.05, 0.1, trim)
        if (look.vein) block(site.glow, s, a, b, v - 0.03, v + 0.03, 0.1, 0.12, site.vein)
      }
    }
    if (look.vein) block(site.glow, s, -s.len / 2, s.len / 2, base, base + 0.05, 0, 0.05, site.vein)
    if (opts.crown !== 'battlement') block(m, s, -end, end, H - 0.34, H, -0.05, 0.17, trim)
  }

  // Ventanas por piso en las cuatro fachadas, parejas y lejos de las esquinas;
  // se saltean las que pisarian la puerta.
  const shutter = look.shutters
    ? vary(look.shutters[Math.floor(rand(9) * look.shutters.length)], rand(10), 0.02, 0.1)
    : null
  const addWindow = (s, u, v, panels = shutter) => {
    const p = at(s, u, v)
    const hidden =
      belfry &&
      p[0] > belfry.x0 - 1.3 &&
      p[0] < belfry.x1 + 1.3 &&
      p[2] > belfry.z0 - 1.3 &&
      p[2] < belfry.z1 + 1.3
    if (!hidden) site.windows.push([p[0], v, p[2], Math.atan2(s.n[0], s.n[1]), panels])
  }
  const columns = (s) => {
    const span = s.len - 2.4
    if (s.len < 2) return []
    if (span < 0 || opts.windows === 'single') return [0]
    const count = Math.floor(span / 3.2) + 1
    if (count < 2) return [0]
    return Array.from({ length: count }, (_, i) => -span / 2 + (span / (count - 1)) * i)
  }
  if (opts.windows !== false) {
    for (const s of sides) {
      for (let f = 0; f < floors; f++) {
        const v = base + f * F + 1.45
        for (const u of columns(s)) {
          const blocked =
            door &&
            door.side === s.id &&
            Math.abs(u - door.u) < door.half + door.jamb + 0.75 &&
            v - 0.7 < door.top
          if (blocked) continue
          addWindow(s, u, v)
        }
      }
    }
  }
  // Entramado: en algunas casas de la ciudad, pies derechos de madera entre las
  // ventanas de los pisos de arriba.
  if (look.timber && rand(30) < 0.6 && opts.windows !== false) {
    for (const s of sides) {
      const us = columns(s)
      const studs = us.slice(1).map((u, i) => (u + us[i]) / 2)
      for (let f = 1; f < floors; f++) {
        const v0 = base + f * F + 0.12
        const v1 = f === floors - 1 ? H - 0.34 : base + (f + 1) * F - 0.12
        for (const u of studs) block(m, s, u - 0.09, u + 0.09, v0, v1, -0.05, 0.06, trim)
      }
    }
  }

  // Saeteras: rendijas oscuras en los muros sin ventanas.
  if (opts.slits) {
    const slit = shade(0).multiplyScalar(0.3)
    for (const s of sides) {
      const count = Math.floor((s.len - 2) / 3)
      for (let i = 0; i < count; i++) {
        const u = (i - (count - 1) / 2) * 3
        const v0 = base + 1.6
        const v1 = base + 2.9
        m.face(
          [
            at(s, u - 0.1, v0, 0.02),
            at(s, u + 0.1, v0, 0.02),
            at(s, u + 0.1, v1, 0.02),
            at(s, u - 0.1, v1, 0.02)
          ],
          slit,
          out(s)
        )
      }
    }
  }

  // Corona: almenas sobre un adarve, o el techo. En una muralla las almenas van
  // solo del lado de afuera (opts.outer).
  if (opts.crown === 'battlement') {
    const walk = stone.clone().multiplyScalar(0.75)
    m.face(
      [
        [x0, H, z1],
        [x1, H, z1],
        [x1, H, z0],
        [x0, H, z0]
      ],
      walk,
      UP
    )
    for (const s of sides) {
      const end = s.id < 2 ? s.len / 2 + 0.1 : s.len / 2 - 0.5
      block(m, s, -end, end, H - 0.3, H, -0.05, 0.14, trim)
      if (opts.outer !== undefined && opts.outer !== s.id) continue
      const count = Math.max(1, Math.round((2 * end) / 1.5))
      for (let i = 0; i < count; i++) {
        const a = -end + ((2 * end) / count) * i
        block(m, s, a, a + 0.85, H, H + 0.9, -0.5, 0.1, shade(H))
      }
    }
    return H + 0.9
  }
  const hip = tower || Math.max(W, D) / narrow < 1.3
  const alongX = hip && !tower ? true : W >= D
  const pitch = (opts.pitch || look.pitch) * (tower ? 2 : 1)
  const hu = (alongX ? W : D) / 2
  const hv = (alongX ? D : W) / 2
  const rise = pitch * hv
  const top = roof(m, {
    x0,
    x1,
    z0,
    z1,
    H,
    rise,
    hip,
    alongX,
    tint: tile,
    cap,
    edge,
    wall: shade(H),
    crest: look.spire,
    veins: look.vein ? { m: site.glow, tint: site.vein.clone().multiplyScalar(0.75) } : null,
    ridge: opts.ridge ?? (tower ? 0.1 : 0.2),
    seed: opts.seed
  })
  let peak = top.top
  // En los hastiales, una ventana de altillo.
  if (!hip && rise > 2.2 && opts.windows !== false) {
    for (const s of alongX ? [sides[2], sides[3]] : [sides[0], sides[1]]) {
      addWindow(s, 0, H + rise * 0.36)
    }
  }
  // Buhardillas en los faldones que miran al sur y al norte, los que ve la
  // camara: cortan el plano del techo y prenden una ventana mas.
  const L = (u, v) => (alongX ? [cx + u, cz + v] : [cx + v, cz + u])
  if (opts.dormers !== false && !tower && alongX && rise > 2.4) {
    const vf = hv * 0.62
    const lift = Math.max(0.5, pitch * 0.8)
    const back = vf - 1.45 / pitch
    const usable = (hip ? top.r + (top.U - top.r) * (back / top.V) : top.U) - 1.4
    const fits = usable > 0 && vf - (1.6 + lift) / pitch > 0.2
    const count = fits ? Math.min(3, Math.floor((2 * usable) / 3.4) + 1) : 0
    for (const k of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const du = (i - (count - 1) / 2) * 3.4
        const [fx, fz] = L(du, k * vf)
        const y = top.height(fx, fz)
        dormer(m, {
          at: (u, h, d) => {
            const [x, z] = L(du + u, k * (vf - d))
            return [x, h, z]
          },
          y,
          slope: pitch,
          out: [0, 0, k],
          side: [1, 0, 0],
          rise: lift,
          tint: tile,
          cap,
          wall: shade(H),
          seed: opts.seed + 20 + i
        })
        site.windows.push([fx, y + 0.78, fz, k > 0 ? 0 : Math.PI, null])
      }
    }
  }
  // Chimeneas cerca de la cumbrera, lejos de las buhardillas.
  const chance = opts.chimneys ?? look.chimneys
  const chimneys = rand(11) < chance ? (W * D > 260 ? 2 : 1) : 0
  for (let i = 0; i < chimneys; i++) {
    const a = (i ? 1 : -1) * hu * (0.3 + 0.25 * rand(12 + i))
    const b = (rand(14 + i) < 0.5 ? -1 : 1) * hv * (0.04 + 0.1 * rand(16 + i))
    const [x, z] = L(a, b)
    chimney(m, x, z, top.height, stone.clone().multiplyScalar(1.15))
  }
  if (look.spire) {
    for (const p of top.ends) m.spike(p[0], p[1], p[2], 0.2, tower ? 2.6 : 1.8, trim)
    peak += tower ? 2.6 : 1.8
  }
  // Un estandarte en la punta del techo.
  if (opts.flag) {
    const [x, y, z] = top.ends[1]
    m.beam([x, y - 0.3, z], [x, y + 2.8, z], 0.12, edge)
    const cloth = new THREE.Color(opts.flag)
    const flag = [
      [x + 0.06, y + 2.7, z],
      [x + 1.8, y + 2.45, z],
      [x + 1.8, y + 1.8, z],
      [x + 0.06, y + 1.95, z]
    ]
    m.face(flag, cloth, [0, 0, 1])
    m.face(flag, cloth.clone().multiplyScalar(0.7), [0, 0, -1])
    peak = Math.max(peak, y + 2.8)
  }
  // Torrecillas en las esquinas, sobre mensulas y con su cono.
  if (opts.turrets) {
    const y = H - 2.6
    for (const [x, z] of corners) {
      const tx = x + (x === x0 ? -0.4 : 0.4)
      const tz = z + (z === z0 ? -0.4 : 0.4)
      m.box(tx - 1, y - 0.8, tz - 1, tx + 1, y, tz + 1, trim)
      m.box(tx - 1.35, y, tz - 1.35, tx + 1.35, H + 1.6, tz + 1.35, shade(H))
      m.spike(tx, H + 1.6, tz, 1.65, 3.6, tile)
    }
    peak = Math.max(peak, H + 5.2)
  }
  // El campanario de una iglesia: una torre de piedra con aguja en la esquina
  // del frente, sin postigos y, en la ciudad, con un remate dorado.
  if (belfry) {
    const plain = { ...look, masonry: true, shutters: null, timber: false }
    const spec = {
      seed: opts.seed + 77,
      floors: floors + 2,
      pitch: 2.4,
      ridge: 0,
      chimneys: 0,
      dormers: false,
      windows: 'single'
    }
    const tip = house({ ...site, look: plain }, belfry, spec)
    if (!look.spire) {
      const x = (belfry.x0 + belfry.x1) / 2
      const z = (belfry.z0 + belfry.z1) / 2
      m.spike(x, tip - 0.1, z, 0.14, 1.6, new THREE.Color(look.glow))
    }
    peak = Math.max(peak, tip + 1.5)
  }
  return peak
}

// El castillo: torres en las esquinas, murallas almenadas entre ellas, el
// porton grande sobre su celda de puerta y la torre del homenaje en el patio.
function fortress(site, rect, opts) {
  const { x0, x1, z0, z1 } = rect
  const T = 7.5
  const thick = 2.4
  const ward = new THREE.Color(site.look.stone).multiplyScalar(0.7)
  site.m.face(
    [
      [x0, 0.03, z1],
      [x1, 0.03, z1],
      [x1, 0.03, z0],
      [x0, 0.03, z0]
    ],
    ward,
    UP
  )
  // Todo de sillares, con arcos redondos y sin postigos de colores.
  const look = {
    ...site.look,
    wall: site.look.keep || site.look.wall,
    trim: site.look.stone,
    arch: ['round'],
    shutters: null,
    timber: false,
    masonry: true
  }
  const castle = { ...site, look }
  let top = 0
  let parts = 0
  const raise = (r, more) => {
    const seed = opts.seed + ++parts * 7919
    top = Math.max(top, house(castle, r, { seed, ...more }))
  }
  const tower = {
    floors: 3,
    pitch: 1.5,
    ridge: 0,
    chimneys: 0,
    dormers: false,
    windows: 'single',
    roof: site.look.slate,
    flag: site.look.banner || site.look.glow
  }
  for (const [x, z] of [
    [x0, z0],
    [x1 - T, z0],
    [x0, z1 - T],
    [x1 - T, z1 - T]
  ]) {
    raise({ x0: x, x1: x + T, z0: z, z1: z + T }, tower)
  }
  // Las murallas, cortadas donde va el porton.
  const gate = opts.door
  const curtains = [
    [0, { x0: x0 + T, x1: x1 - T, z0: z1 - thick, z1 }],
    [1, { x0: x0 + T, x1: x1 - T, z0, z1: z0 + thick }],
    [2, { x0: x1 - thick, x1, z0: z0 + T, z1: z1 - T }],
    [3, { x0, x1: x0 + thick, z0: z0 + T, z1: z1 - T }]
  ]
  for (const [side, r] of curtains) {
    const curtain = {
      floors: 2,
      crown: 'battlement',
      outer: side,
      windows: false,
      chimneys: 0,
      slits: true
    }
    if (!gate || gate.side !== side) {
      raise(r, curtain)
      continue
    }
    const alongX = side < 2
    const at = alongX ? gate.x : gate.z
    const [lo, hi] = alongX ? [r.x0, r.x1] : [r.z0, r.z1]
    const g0 = Math.max(lo + 1, at - 3.5)
    const g1 = Math.min(hi - 1, at + 3.5)
    const piece = (a, b) => (alongX ? { ...r, x0: a, x1: b } : { ...r, z0: a, z1: b })
    if (g0 - lo > 1) raise(piece(lo, g0), curtain)
    if (hi - g1 > 1) raise(piece(g1, hi), curtain)
    // El porton entra en el patio mas que la muralla.
    const deep = thick + 1.6
    const gr = alongX
      ? { x0: g0, x1: g1, z0: side === 0 ? z1 - deep : z0, z1: side === 0 ? z1 : z0 + deep }
      : { x0: side === 2 ? x1 - deep : x0, x1: side === 2 ? x1 : x0 + deep, z0: g0, z1: g1 }
    raise(gr, { floors: 3, crown: 'battlement', chimneys: 0, door: gate, grand: true })
  }
  // La torre del homenaje, en el medio del patio y un poco hacia atras.
  const mx = (x1 - x0) * 0.27
  raise(
    { x0: x0 + mx, x1: x1 - mx, z0: z0 + (z1 - z0) * 0.2, z1: z1 - (z1 - z0) * 0.34 },
    {
      floors: 3,
      chimneys: 1,
      roof: site.look.roofs[0],
      turrets: true,
      door: { side: 0, x: (x0 + x1) / 2, z: z1 }
    }
  )
  return top
}

// Donde va la puerta de un edificio: su celda de puerta en el borde, o la de un
// porton. Si no tiene, el hueco por donde entra el camino en la fila de abajo,
// entre dos celdas del edificio; y si tampoco, el medio de la fachada sur.
// side: 0 sur, 1 norte, 2 este, 3 oeste.
function doorway(box, doors, tiles, kinds, width) {
  for (const prefix of ['door.', 'gate.']) {
    for (const d of doors) {
      const tile = tiles[d.ch]
      if (!tile || !tile.id.startsWith(prefix)) continue
      if (d.x < box.x0 - 1 || d.x > box.x1 + 1 || d.y < box.y0 - 1 || d.y > box.y1 + 1) continue
      const gaps = [
        (box.y1 - d.y) * CZ,
        (d.y - box.y0) * CZ,
        (box.x1 - d.x) * CX,
        (d.x - box.x0) * CX
      ]
      const side = gaps.indexOf(Math.min(...gaps))
      if (Math.abs(gaps[side]) <= 1) return { side, x: (d.x + 0.5) * CX, z: (d.y + 0.5) * CZ }
    }
  }
  const z = (box.y1 + 0.5) * CZ
  let start = -1
  for (let x = box.x0; x <= box.x1; x++) {
    const open = !STRUCTURE.has(kinds[box.y1 * width + x])
    if (open && start < 0) start = x
    if (!open && start >= 0) {
      if (start > box.x0 && x - start <= 9) return { side: 0, x: ((start + x) / 2) * CX, z }
      start = -1
    }
  }
  return { side: 0, x: ((box.x0 + box.x1 + 1) / 2) * CX, z }
}

// Las palabras dentro de un edificio: la mas larga es su nombre.
function nameOf(rows, box) {
  let best = ''
  for (let y = box.y0; y <= box.y1; y++) {
    const words = (rows[y] || '').slice(box.x0, box.x1 + 1).match(/[a-z]+( [a-z]+)*/g) || []
    for (const word of words) if (word.length > best.length) best = word
  }
  return best.length >= 3 ? best : ''
}

// NPC pintados: un PNG por tipo en assets/npcs, recortado de una hoja hecha con
// Higgsfield en el estilo del heroe de Tripo. Los tipos salen de NPC_SPRITES
// (lib/map.js); uno sin dibujo usa la figura de la pagina.
const NPC_ART = new Set([
  'priest',
  'resident',
  'tavern',
  'alchemist',
  'smith',
  'armorer',
  'guard',
  'king',
  'villager'
])
// La figura mediana mide 256 px y 1,8 en el mundo. El cartel no se achica al
// mirar desde arriba: asi se ve de la altura del heroe con la camara 2.5D.
const NPC_PX = 1.8 / 256

// Una textura y un material por tipo, compartidos por todos los mapas. Si el PNG
// no llega, se olvida para volver a pedirlo en el proximo mapa.
const npcLooks = new Map()
function npcLook(kind) {
  if (!npcLooks.has(kind)) {
    const look = new THREE.TextureLoader()
      .loadAsync('assets/npcs/' + kind + '.png')
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        const material = new THREE.SpriteMaterial({ map: texture, alphaTest: 0.05 })
        material.onBeforeCompile = npcShader
        return material
      })
      .catch(() => {
        npcLooks.delete(kind)
        return null
      })
    npcLooks.set(kind, look)
  }
  return npcLooks.get(kind)
}

// Un cartel que mira a la camara queda entero a la profundidad de sus pies: desde
// arriba se hundiria en la pared de atras y el heroe que pasa detras le taparia
// la cabeza. Cada vertice se acerca a la camara por su propio rayo segun su
// altura en el cartel, como una figura parada; en pantalla se ve igual.
// Ademas la textura se lee medio nivel de mipmap mas nitida: de lejos el NPC
// mide unos 60 px y el filtro lo borronea.
function npcShader(shader) {
  shader.vertexShader = shader.vertexShader.replace(
    'gl_Position = projectionMatrix * mvPosition;',
    'mvPosition.xyz *= 1.0 - alignedPosition.y * 0.9 / length( mvPosition.xyz );\n' +
      'gl_Position = projectionMatrix * mvPosition;'
  )
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    'diffuseColor *= texture2D( map, vMapUv, -0.5 );'
  )
}

// La sombra blanda al pie de cada NPC, para que no flote.
function blobTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const g = canvas.getContext('2d')
  const shade = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.55)')
  shade.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)')
  shade.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.fillStyle = shade
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

/**
 * Arma el mapa. `data` es /world/<id>.json. `extras` trae lo que vive en la
 * pagina: figure(color) para los NPC y glb(file) para los modelos de Tripo.
 */
export function buildWorld(data, extras = {}) {
  const { width, height, rows, tiles } = data
  const palette = PALETTES[data.id] || PALETTES.city
  const group = new THREE.Group()
  const toWorld = (x, y) => new THREE.Vector3(x * CX + CX / 2, 0, y * CZ + CZ / 2)

  // Primera pasada: que es cada celda y donde van las puertas.
  const kinds = new Array(width * height).fill(null)
  const doors = []
  for (let y = 0; y < height; y++) {
    const row = rows[y] || ''
    for (let x = 0; x < width; x++) {
      const ch = row[x] || ' '
      const tile = tiles[ch]
      const word = data.kind !== 'boss' && (ch === 'o' || ch === 't') && inWord(row, x)
      const kind = word ? 'sign' : classify(ch, tile, data.kind)
      kinds[y * width + x] = kind
      if (kind === 'door') doors.push({ x, y, ch, name: tile ? tile.name : ch })
    }
  }
  // El suelo se lee como terreno y no como una grilla de cuadritos: varios
  // texeles por celda, manchas, bordes que se funden y sombra al pie de lo alto.
  // El shader le suma el grano fino y el dibujo de adoquines y grava.
  const clock = { value: 0 }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width * CX, height * CZ),
    soilMaterial(soilTexture(data, kinds), data, width * CX, height * CZ)
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set((width * CX) / 2, 0, (height * CZ) / 2)
  ground.receiveShadow = true
  // El viento en el pasto y las olas del agua y la lava siguen al reloj en cada
  // cuadro en que se dibuja el suelo: no hace falta que la pagina lo llame.
  ground.onBeforeRender = () => {
    clock.value = globalThis.performance.now() / 1000
  }
  group.add(ground, soilSkirt(data))

  // Segunda pasada: edificios. Un grupo cerrado y lleno de celdas de estructura
  // que no toca el borde del mapa es un edificio.
  const inBuilding = new Uint8Array(width * height)
  const seen = new Uint8Array(width * height)
  const buildings = []
  for (let start = 0; start < kinds.length; start++) {
    if (seen[start] || !STRUCTURE.has(kinds[start])) continue
    const stack = [start]
    const cells = []
    seen[start] = 1
    const box = { x0: width, y0: height, x1: 0, y1: 0 }
    while (stack.length) {
      const i = stack.pop()
      cells.push(i)
      const x = i % width
      const y = (i - x) / width
      box.x0 = Math.min(box.x0, x)
      box.x1 = Math.max(box.x1, x)
      box.y0 = Math.min(box.y0, y)
      box.y1 = Math.max(box.y1, y)
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1]
      ]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const n = ny * width + nx
        if (!seen[n] && STRUCTURE.has(kinds[n])) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    const bw = box.x1 - box.x0 + 1
    const bh = box.y1 - box.y0 + 1
    const edge = box.x0 === 0 || box.y0 === 0 || box.x1 === width - 1 || box.y1 === height - 1
    const fill = cells.length / (bw * bh)
    if (!edge && cells.length >= 30 && bw >= 6 && bh >= 4 && fill >= 0.55) {
      for (const i of cells) inBuilding[i] = 1
      buildings.push(box)
    }
  }

  // Los edificios van en una sola malla con color por vertice; las ventanas, sus
  // marcos y los postigos se repiten con InstancedMesh. El mas grande del mapa,
  // si es enorme, es un castillo.
  const site = {
    look: palette,
    m: mason(),
    glow: mason(),
    vein: new THREE.Color(palette.vein || palette.glow),
    windows: []
  }
  for (const box of buildings) {
    const rect = {
      x0: box.x0 * CX + 0.25,
      x1: (box.x1 + 1) * CX - 0.25,
      z0: box.y0 * CZ + 0.25,
      z1: (box.y1 + 1) * CZ - 0.25
    }
    const name = nameOf(rows, box)
    const opts = {
      seed: box.x0 * 92821 + box.y0 * 68917,
      door: doorway(box, doors, tiles, kinds, width),
      belfry: /iglesia|santuario|templo|capilla/.test(name)
    }
    const big = Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0) >= 30
    const top = big ? fortress(site, rect, opts) : house(site, rect, opts)
    if (name) {
      const tag = label(name)
      tag.position.set((rect.x0 + rect.x1) / 2, top + 1.2, (rect.z0 + rect.z1) / 2)
      group.add(tag)
    }
  }
  if (site.m.count()) {
    const houses = new THREE.Mesh(
      site.m.geometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
    )
    houses.castShadow = true
    houses.receiveShadow = true
    group.add(houses)
  }
  // Las juntas encendidas de NOX no reciben luz: brillan solas.
  if (site.glow.count()) {
    const veins = new THREE.MeshBasicMaterial({ vertexColors: true })
    group.add(new THREE.Mesh(site.glow.geometry(), veins))
  }
  if (site.windows.length) {
    const count = site.windows.length
    // El vidrio va apenas delante del marco y el parteluz delante del vidrio.
    const lit = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.6, 1).translate(0, 0, 0.075),
      new THREE.MeshStandardMaterial({
        color: palette.glow,
        emissive: palette.glow,
        emissiveIntensity: 0.9
      }),
      count
    )
    // El marco, el alfeizar y el parteluz, solo con las caras que se ven.
    const wood = palette.frame
    const plate = (w, h, x, y, z, tilt = 0, turn = 0) =>
      paint(new THREE.PlaneGeometry(w, h).rotateX(tilt).rotateY(turn).translate(x, y, z), wood)
    const flat = -Math.PI / 2
    const frames = new THREE.InstancedMesh(
      mergeGeometries([
        plate(0.86, 1.26, 0, 0, 0.06),
        plate(0.86, 0.06, 0, 0.63, 0.03, flat),
        plate(0.06, 1.26, -0.43, 0, 0.03, 0, flat),
        plate(0.06, 1.26, 0.43, 0, 0.03, 0, -flat),
        plate(1.04, 0.1, 0, -0.66, 0.24),
        plate(1.04, 0.24, 0, -0.61, 0.12, flat),
        plate(0.24, 0.1, -0.52, -0.66, 0.12, 0, flat),
        plate(0.24, 0.1, 0.52, -0.66, 0.12, 0, -flat),
        plate(0.07, 1, 0, 0, 0.09),
        plate(0.6, 0.07, 0, 0.12, 0.092)
      ]),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
      count
    )
    frames.receiveShadow = true
    // Postigos a los lados, del color de cada casa.
    const shut = site.windows.filter((w) => w[4]).length
    const shutters = shut
      ? new THREE.InstancedMesh(
          mergeGeometries([
            new THREE.PlaneGeometry(0.36, 1.2).translate(-0.64, 0, 0.05),
            new THREE.PlaneGeometry(0.36, 1.2).translate(0.64, 0, 0.05)
          ]),
          new THREE.MeshStandardMaterial({ roughness: 0.8 }),
          shut
        )
      : null
    const pose = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const one = new THREE.Vector3(1, 1, 1)
    const spot = new THREE.Vector3()
    let k = 0
    site.windows.forEach(([x, y, z, yaw, tint], i) => {
      pose.compose(spot.set(x, y, z), q.setFromAxisAngle(up, yaw), one)
      lit.setMatrixAt(i, pose)
      frames.setMatrixAt(i, pose)
      if (!tint) return
      shutters.setMatrixAt(k, pose)
      shutters.setColorAt(k++, tint)
    })
    group.add(lit, frames)
    if (shutters) {
      shutters.receiveShadow = true
      group.add(shutters)
    }
  }

  // Tercera pasada: lo que sube fuera de los edificios, por tramos de una fila.
  // Las letras y puertas van de a una, porque cada una lleva su glifo.
  const runs = {}
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      const i = y * width + x
      const kind = kinds[i]
      if (!kind || inBuilding[i] || !LOOSE[kind]) {
        x++
        continue
      }
      let end = x + 1
      if (!LOOSE[kind].glyph) {
        while (end < width && kinds[y * width + end] === kind && !inBuilding[y * width + end]) end++
      }
      if (!runs[kind]) runs[kind] = []
      runs[kind].push([x, end - x, y, (rows[y] || '')[x] || ' '])
      x = end
    }
  }
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  for (const [kind, list] of Object.entries(runs)) {
    const spec = LOOSE[kind]
    const geometry = new THREE.BoxGeometry(CX, spec.h, CZ * 0.98)
    if (spec.glyph) {
      const glyphs = new Float32Array(list.length * 2)
      list.forEach(([, , , ch], i) => glyphs.set(glyphCell(ch), i * 2))
      geometry.setAttribute('glyphCell', new THREE.InstancedBufferAttribute(glyphs, 2))
    }
    const mesh = new THREE.InstancedMesh(geometry, material(spec), list.length)
    list.forEach(([x, len, y], i) => {
      const position = new THREE.Vector3(
        (x + len / 2) * CX,
        spec.h / 2 - (spec.sink || 0),
        y * CZ + CZ / 2
      )
      mesh.setMatrixAt(i, m.compose(position, q, new THREE.Vector3(len * 0.98, 1, 1)))
    })
    mesh.castShadow = spec.h > 1.5
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // Arboles, piedras y flores, de pocos poligonos: tres especies de arbol, matas,
  // piedras, flores con tallo, pasto y piedritas en los caminos, cada copia con
  // su tamano, giro y color. El agua y la lava llevan una superficie que se mueve.
  for (const mesh of natureMeshes(data, kinds, clock)) group.add(mesh)

  // Puertas: una columna de luz y el nombre.
  for (const door of doors) {
    const p = toWorld(door.x, door.y)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3.4, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xe0c060,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    )
    beam.position.set(p.x, 1.7, p.z)
    group.add(beam)
    const tag = label(door.name)
    tag.position.set(p.x, 3.9, p.z)
    group.add(tag)
  }

  // NPC: el dibujo de su tipo, parado en su celda y mirando a la camara, con una
  // sombra al pie y el nombre arriba. Sin dibujo, la figura de la pagina.
  const npcs = data.npcs || []
  const idlers = []
  if (npcs.length) {
    const blobs = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 0.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
      npcs.length
    )
    const spot = new THREE.Matrix4()
    npcs.forEach((npc, i) => {
      const p = toWorld(npc.x, npc.y)
      blobs.setMatrixAt(i, spot.makeTranslation(p.x, 0.02, p.z))
    })
    // Antes que los carteles, que la tapan donde se cruzan.
    blobs.renderOrder = -1
    group.add(blobs)
  }
  // 0,6 es lo que se ve de una altura con la camara 2.5D: asi el nombre queda
  // justo sobre la cabeza de un cartel de alto h.
  const over = (h) => (h + 0.4) / 0.6
  for (const npc of npcs) {
    const p = toWorld(npc.x, npc.y)
    const tag = label(npc.name, '#d8d8d0')
    tag.position.set(p.x, over(NPC_PX * 256), p.z)
    group.add(tag)
    const figure = () => {
      if (!extras.figure) return group.remove(tag)
      tag.position.y = 2.6
      const body = extras.figure(npc.color)
      body.position.copy(p)
      body.rotation.y = hash(npc.x, npc.y) * Math.PI * 2
      group.add(body)
    }
    if (!NPC_ART.has(npc.kind)) {
      figure()
      continue
    }
    npcLook(npc.kind).then((material) => {
      if (!material) return figure()
      // Dos NPC del mismo tipo no miden exactamente lo mismo.
      const size = NPC_PX * (0.96 + hash(npc.y, npc.x) * 0.08)
      const sprite = new THREE.Sprite(material)
      sprite.center.set(0.5, 0)
      sprite.position.copy(p)
      sprite.scale.set(material.map.image.width * size, material.map.image.height * size, 1)
      // Comparte textura y material con los demas NPC de su tipo.
      sprite.userData.shared = true
      group.add(sprite)
      tag.position.y = over(sprite.scale.y)
      idlers.push({ sprite, w: sprite.scale.x, h: sprite.scale.y, phase: hash(npc.x, npc.y) * 7 })
    })
  }

  // Modelos de Tripo como hitos: la estatua de los heroes es el heroe de Tripo,
  // y el Coloso vive en su arena.
  const loads = []
  // Tripo entrega los modelos mirando hacia +x: yaw los gira hacia donde tienen
  // que mirar.
  const place = (file, center, size, yaw = 0) => {
    if (!extras.glb) return
    loads.push(
      extras
        .glb(file)
        .then((object) => {
          if (!object) return
          object.rotation.y = yaw
          object.updateMatrixWorld(true)
          const box = new THREE.Box3().setFromObject(object)
          object.scale.multiplyScalar(size / box.getSize(new THREE.Vector3()).y)
          object.updateMatrixWorld(true)
          const placed = new THREE.Box3().setFromObject(object)
          const mid = placed.getCenter(new THREE.Vector3())
          object.position.x += center.x - mid.x
          object.position.z += center.z - mid.z
          object.position.y += center.y - placed.min.y
          object.traverse((child) => {
            if (child.isMesh) child.castShadow = true
          })
          // Es una copia del GLB en cache: comparte geometria y materiales.
          object.userData.shared = true
          group.add(object)
        })
        .catch(() => {})
    )
  }
  for (const mark of data.landmarks || []) {
    if (mark.id !== 'hero-statue' || !mark.bounds) continue
    const { x1, y1, x2, y2 } = mark.bounds
    const center = toWorld((x1 + x2) / 2, (y1 + y2) / 2)
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.6, 0.8, 16),
      new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 0.9 })
    )
    plinth.position.set(center.x, 0.4, center.z)
    plinth.castShadow = true
    group.add(plinth)
    // La estatua mira al sur, hacia la plaza.
    place('heroe.glb', center.setY(0.8), 3.2, -Math.PI / 2)
    const tag = label(mark.name)
    tag.position.set(center.x, 4.8, center.z)
    group.add(tag)
  }
  // El Coloso mira al oeste, hacia el portal por donde llega el heroe.
  if (data.boss) place('coloso.glb', toWorld(data.boss.x, data.boss.y), 7, Math.PI)

  return {
    group,
    toWorld,
    buildings: buildings.length,
    loading: Promise.all(loads),
    // Los NPC respiran: se estiran apenas desde los pies, cada uno a su ritmo.
    update(time) {
      for (const n of idlers) {
        const k = Math.sin(time * 2.2 + n.phase)
        n.sprite.scale.set(n.w * (1 - k * 0.012), n.h * (1 + k * 0.025), 1)
      }
    },
    dispose() {
      const free = (node) => {
        if (node.userData.shared) return
        // Las instancias tienen sus propios buffers de posiciones y colores.
        if (node.isInstancedMesh) node.dispose()
        if (node.geometry) node.geometry.dispose()
        for (const mat of node.material ? [node.material].flat() : []) {
          if (mat.map && mat.map !== atlas) mat.map.dispose()
          mat.dispose()
        }
        for (const child of node.children) free(child)
      }
      free(group)
    }
  }
}
