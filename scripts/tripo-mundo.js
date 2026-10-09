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
const PALETTES = {
  city: { wall: 0xc9bea8, roof: 0x9a4430, glow: 0xffc879 },
  nox: { wall: 0x4d475e, roof: 0x2c2740, glow: 0xb78cff },
  castle: { wall: 0x9e978a, roof: 0x5b2f2a, glow: 0xffc879 },
  coliseum: { wall: 0xb9a27c, roof: 0x7a5a3a, glow: 0xffc879 },
  boss: { wall: 0x5a4a42, roof: 0x3a2a24, glow: 0xff7a2a }
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

// Techo a dos aguas sobre un rectangulo de w por d, con la cumbrera a lo largo.
function gable(w, d, rise) {
  const along = w >= d
  const [a, b] = along ? [w / 2, d / 2] : [d / 2, w / 2]
  const p = (u, y, v) => (along ? [u, y, v] : [v, y, u])
  const A = p(-a, 0, -b)
  const B = p(a, 0, -b)
  const C = p(a, 0, b)
  const D = p(-a, 0, b)
  const E = p(-a, rise, 0)
  const F = p(a, rise, 0)
  const tris = [A, E, F, A, F, B, D, C, F, D, F, E, A, D, E, B, F, C]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3))
  geometry.computeVertexNormals()
  return geometry
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

  const parts = []
  const windows = []
  for (const box of buildings) {
    const w = (box.x1 - box.x0 + 1) * CX
    const d = (box.y1 - box.y0 + 1) * CZ
    const cx = box.x0 * CX + w / 2
    const cz = box.y0 * CZ + d / 2
    const h = Math.min(9, Math.max(4.5, 3.6 + Math.min(w, d) * 0.3))
    const rise = Math.min(3, Math.min(w, d) * 0.3)
    parts.push(
      paint(new THREE.BoxGeometry(w * 0.98, h, d * 0.98).translate(cx, h / 2, cz), palette.wall)
    )
    parts.push(paint(gable(w * 1.04, d * 1.04, rise).translate(cx, h, cz), palette.roof))
    // Ventanas en las cuatro fachadas, por pisos.
    for (const [len, axis, sign] of [
      [w, 'x', 1],
      [w, 'x', -1],
      [d, 'z', 1],
      [d, 'z', -1]
    ]) {
      const across = Math.max(1, Math.floor((len - 0.8) / 1.6))
      for (let floor = 1.5; floor < h - 0.8; floor += 2) {
        for (let k = 0; k < across; k++) {
          const t = -len / 2 + (len / across) * (k + 0.5)
          windows.push(
            axis === 'x'
              ? [cx + t, floor, cz + sign * (d * 0.49 + 0.02), sign > 0 ? 0 : Math.PI]
              : [cx + sign * (w * 0.49 + 0.02), floor, cz + t, (sign * Math.PI) / 2]
          )
        }
      }
    }
    const name = nameOf(rows, box)
    if (name) {
      const tag = label(name)
      tag.position.set(cx, h + rise + 1, cz)
      group.add(tag)
    }
  }
  if (parts.length) {
    const houses = new THREE.Mesh(
      mergeGeometries(parts),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
    )
    houses.castShadow = true
    houses.receiveShadow = true
    group.add(houses)
  }
  if (windows.length) {
    const lit = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.42, 0.72),
      new THREE.MeshStandardMaterial({
        color: palette.glow,
        emissive: palette.glow,
        emissiveIntensity: 0.9
      }),
      windows.length
    )
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const one = new THREE.Vector3(1, 1, 1)
    windows.forEach(([x, y, z, yaw], i) => {
      q.setFromAxisAngle(up, yaw)
      lit.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, one))
    })
    group.add(lit)
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

  // NPC: figuras del color que usa la terminal, con su nombre.
  for (const npc of data.npcs || []) {
    if (!extras.figure) break
    const body = extras.figure(npc.color)
    const p = toWorld(npc.x, npc.y)
    body.position.copy(p)
    body.rotation.y = hash(npc.x, npc.y) * Math.PI * 2
    group.add(body)
    const tag = label(npc.name, '#d8d8d0')
    tag.position.set(p.x, 2.6, p.z)
    group.add(tag)
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
    dispose() {
      const free = (node) => {
        if (node.userData.shared) return
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
