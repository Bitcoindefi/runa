// Las murallas y sus portones en la vista 2.5D.
//
// buildWorld (tripo-mundo.js) llama a buildRamparts con el mapa ya clasificado,
// despues de encontrar los edificios. Lo que este modulo dibuja reemplaza a las
// cajas sueltas de esas celdas. Devuelve null si no dibuja nada, y entonces
// quedan las cajas de siempre.
//
// Recibe `world`:
//   data        el mapa (/world/<id>.json): rows, tiles, width, height, kind, id
//   kinds       la clase de cada celda (y * width + x): 'rampart', 'wall',
//               'door', 'tree'... (classify en tripo-mundo.js)
//   inBuilding  1 en las celdas que ya son parte de un edificio
//   doors       las puertas y portones: { x, y, ch, name }
//   toWorld     (x, y) => Vector3 del centro de la celda, en el piso
//   CX, CZ      lo que mide una celda: columna y fila
//   palette     los colores del mapa (PALETTES en tripo-mundo.js)
//   letters     las filas con los carteles en el idioma elegido
//   group       donde se agregan las mallas (se liberan con el mapa)
//   text        traduce un nombre al idioma elegido
//   label       (texto) => cartel que mira a la camara (el de tripo-mundo.js)
//
// Devuelve:
//   skip         Set de clases de celda que ya no suben como cajas
//   cells        Uint8Array (y * width + x): 1 en las celdas que dibuja este
//                modulo, sean de la clase que sean; tampoco suben como cajas
//   gates        Set de 'x,y' de las puertas que este modulo dibujo como porton
//                (o vistio, como el del castillo): no llevan columna de luz ni
//                losa con letra, solo su nombre
//   labelHeight  (door) => a que altura va el nombre de esa puerta (opcional)
//   update       (time) => cada cuadro, para antorchas o banderas (opcional)
//   dispose      () => lo que no cuelgue de `group` (opcional)
//
// Como se arma: primero se lee la grilla (que es muralla, que la rellena, por
// donde se anda y donde hay portones); despues la muralla sube como una masa
// con talud, cordon, parapeto y almenas, que sigue la grilla en las dos
// direcciones; encima van las torres, los portones con su arco (los de las
// fronteras y la salida del castillo cruzan la muralla del borde), puertas,
// rastrillo, antorchas y estandartes, y por ultimo los cercos bajos. Ademas:
// el porton del castillo de la ciudad (un edificio de tripo-mundo.js) recibe
// antorchas, rastrillo y estandartes; los puestos del mercado, mostrador,
// mercaderia y toldo a rayas; el monumento de la plaza, su piso de marmol con
// una rosa de los vientos; el coliseo, su anfiteatro. La piedra va en mallas
// por trozo del mapa y lo demas en una malla por material, con texturas de
// canvas (sillares, tablas, tejas) que se arman una vez y quedan en memoria.
import * as THREE from 'three'

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { document } = globalThis

// Lo que cubre una textura de piedra, en metros: se repite cada TILE.
const TILE = 4
// La piedra se corta en trozos de este lado, asi la camara no dibuja todo.
const CHUNK = 64
// Lo que la muralla del borde crece hacia afuera del mapa, en celdas.
const PAD_X = 5
const PAD_Z = 2

// Las medidas de la muralla, en metros: el talud del pie, el cordon, el
// parapeto y las almenas. OFF despega apenas la cara de la celda.
const OFF = 0.03
const BATTER = 0.16
const FOOT = 1.05
const CORD = 0.07
const PARAPET = 0.3
const BREAST = 0.5
const MERLON = 0.56
const MERLON_H = 0.55
const CRENEL = 0.42

// Cada mapa con su piedra: alto del adarve (curtain), forma de las torres y su
// techo, el color del estandarte y de la llama, como son los cercos bajos, las
// dovelas oscuras de los arcos (voussoir) y la otra raya de los toldos (canvas).
const STYLES = {
  city: {
    stone: 0xdcc8a0,
    walk: 0xb9a582,
    trim: 0xf1e3c2,
    dark: 0x3a2e24,
    curtain: 4.2,
    tower: 'round',
    roof: 'cone',
    banner: 0xb8362a,
    accent: 0xe7b84a,
    flame: [1, 0.72, 0.32],
    fence: 'stone',
    voussoir: 0xc98e6a
  },
  nox: {
    stone: 0x5a536a,
    walk: 0x3f3a4c,
    trim: 0x857ca0,
    dark: 0x120f18,
    curtain: 4.8,
    tower: 'round',
    roof: 'spire',
    banner: 0x5b2f9e,
    accent: 0x5fe8c8,
    flame: [0.45, 1, 0.86],
    veins: true,
    fence: 'iron',
    canvas: 0x2c6f68,
    voussoir: 0x3c3450
  },
  castle: {
    stone: 0xc3bcae,
    walk: 0x9e978a,
    trim: 0xe2dacb,
    dark: 0x2c2620,
    curtain: 5.2,
    tower: 'square',
    roof: 'pyramid',
    banner: 0xa32e2a,
    accent: 0xe7b84a,
    flame: [1, 0.72, 0.32],
    fence: 'stone',
    voussoir: 0x9b948a
  },
  coliseum: {
    stone: 0xdcc9a2,
    walk: 0xbca986,
    trim: 0xefe2c4,
    dark: 0x3a2e24,
    curtain: 4.4,
    tower: 'round',
    roof: 'cone',
    banner: 0xb8362a,
    accent: 0xe7b84a,
    flame: [1, 0.72, 0.32],
    fence: 'stone',
    voussoir: 0xc98e6a
  },
  boss: {
    stone: 0x6a5a52,
    walk: 0x4a3e38,
    trim: 0x8a766a,
    dark: 0x1a1210,
    curtain: 3.6,
    tower: 'round',
    roof: 'none',
    banner: 0x5a1a14,
    accent: 0xff7a2a,
    flame: [1, 0.55, 0.2],
    ruined: true,
    cracks: true,
    fence: 'stone'
  }
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
function smooth(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// --- Texturas -------------------------------------------------------------
// Todas salen de un canvas: no se baja nada. Se arman una vez por pagina.

function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

// Una textura que se repite, compartida entre mapas: no se libera con el mapa.
function tiled(source, srgb) {
  const texture = new THREE.CanvasTexture(source)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  texture.userData.shared = true
  return texture
}

// Ruido de valor que da la vuelta en los bordes: `cells` rasgos por lado.
function wrappedNoise(n, cells, seed) {
  const out = new Float32Array(n * n)
  const step = n / cells
  const at = (i, j) =>
    hash(((i % cells) + cells) % cells, (((j % cells) + cells) % cells) + seed * 977)
  for (let y = 0; y < n; y++) {
    const j = Math.floor(y / step)
    const ty = smooth(0, 1, y / step - j)
    for (let x = 0; x < n; x++) {
      const i = Math.floor(x / step)
      const tx = smooth(0, 1, x / step - i)
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * tx
      const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx
      out[y * n + x] = top + (bottom - top) * ty
    }
  }
  return out
}

// El relieve de un dibujo como mapa de normales (Sobel, da la vuelta en los
// bordes). El lienzo baja en y y la textura sube en v: de ahi el signo.
function normalsFrom(height, w, h, strength) {
  const c = canvas(w, h)
  const g = c.getContext('2d')
  const image = g.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = height[y * w + ((x - 1 + w) % w)]
      const r = height[y * w + ((x + 1) % w)]
      const u = height[((y - 1 + h) % h) * w + x]
      const d = height[((y + 1) % h) * w + x]
      const nx = (l - r) * strength
      const ny = (d - u) * strength
      const k = 1 / Math.hypot(nx, ny, 1)
      const p = (y * w + x) * 4
      image.data[p] = (nx * k * 0.5 + 0.5) * 255
      image.data[p + 1] = (ny * k * 0.5 + 0.5) * 255
      image.data[p + 2] = k * 255
      image.data[p + 3] = 255
    }
  }
  g.putImageData(image, 0, 0)
  return tiled(c, false)
}

function paintGray(values, w, h, warmth) {
  const c = canvas(w, h)
  const g = c.getContext('2d')
  const image = g.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const v = values[i]
    const warm = warmth ? warmth[i] : 0
    image.data[i * 4] = clamp(v * (1 + warm), 0, 1) * 255
    image.data[i * 4 + 1] = clamp(v, 0, 1) * 255
    image.data[i * 4 + 2] = clamp(v * (1 - warm * 1.4), 0, 1) * 255
    image.data[i * 4 + 3] = 255
  }
  g.putImageData(image, 0, 0)
  return c
}

// Sillares: hiladas de 30 a 50 cm, bloques de 45 cm a 1,25 m, juntas de
// mortero hundidas y biseladas, cada bloque con su tono y su grano, y manchas
// grandes de piedra gastada. La textura es casi blanca: el color lo pone cada
// mapa. Ademas devuelve donde estan las juntas, para las venas encendidas.
let stoneSet = null
function stoneTextures() {
  if (stoneSet) return stoneSet
  const n = 512
  const px = n / TILE
  const height = new Float32Array(n * n)
  const value = new Float32Array(n * n)
  const warmth = new Float32Array(n * n)
  const joints = new Float32Array(n * n)
  const stain = wrappedNoise(n, 6, 3)
  const fine = wrappedNoise(n, 48, 5)
  let k = 1
  const rnd = () => hash(k++, 7919)
  let y0 = 0
  while (y0 < n) {
    let ch = Math.round(px * (0.26 + rnd() * 0.16))
    if (n - y0 - ch < px * 0.26) ch = n - y0
    const shift = Math.floor(rnd() * n)
    let x0 = 0
    while (x0 < n) {
      let w = Math.round(px * (0.38 + rnd() * 0.62))
      if (n - x0 - w < px * 0.34) w = n - x0
      // Cada bloque con su tono; uno de cada tantos, mas oscuro o mas calido.
      const odd = rnd()
      const tone = odd < 0.12 ? 0.72 + rnd() * 0.08 : 0.86 + rnd() * 0.14
      const warm = (rnd() - 0.5) * (odd > 0.9 ? 0.2 : 0.08)
      const rough = 0.5 + rnd()
      for (let j = 0; j < ch; j++) {
        for (let i = 0; i < w; i++) {
          const X = (x0 + i + shift) % n
          const p = (y0 + j) * n + X
          const e = Math.min(i, w - 1 - i, j, ch - 1 - j)
          const joint = clamp(1.7 - e, 0, 1)
          const bevel = smooth(0.8, 4.5, e)
          const grain = hash(X * 3 + 1, (y0 + j) * 5 + 2)
          height[p] = 0.25 + 0.75 * bevel - grain * 0.05 * rough - fine[p] * 0.1
          joints[p] = joint
          const worn = 0.84 + 0.26 * stain[p]
          value[p] =
            tone *
            (0.94 + 0.06 * grain) *
            (0.94 + 0.12 * fine[p]) *
            worn *
            (1 - joint * 0.32) *
            (0.9 + 0.1 * bevel)
          warmth[p] = warm
        }
      }
      x0 += w
    }
    y0 += ch
  }
  const map = tiled(paintGray(value, n, n, warmth), true)
  stoneSet = { map, normalMap: normalsFrom(height, n, n, 1.5), joints, n }
  return stoneSet
}

// Lo que brilla en la piedra: en NOX las juntas de algunas hiladas y vetas
// finas (venas), en las ruinas grietas largas con lava (grietas).
const glowSets = {}
function glowTexture(kind) {
  if (glowSets[kind]) return glowSets[kind]
  const { joints, n } = stoneTextures()
  const c = canvas(n, n)
  const g = c.getContext('2d')
  const image = g.createImageData(n, n)
  if (kind === 'veins') {
    // Una de cada tres hiladas lleva la junta encendida, a tramos.
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const p = y * n + x
        const band = hash(Math.floor(y / 40), Math.floor(x / 90)) < 0.42 ? 1 : 0
        const v = joints[p] * band * 255
        image.data[p * 4] = v
        image.data[p * 4 + 1] = v
        image.data[p * 4 + 2] = v
        image.data[p * 4 + 3] = 255
      }
    }
  } else {
    for (let p = 0; p < n * n; p++) image.data[p * 4 + 3] = 255
  }
  g.putImageData(image, 0, 0)
  // Grietas: caminos al azar, dibujados nueve veces corridos para que la
  // textura de la vuelta sin cortes. Cada una con un halo tenue y el centro
  // fino y blanco: brilla desde adentro, no parece pintada.
  g.lineCap = 'round'
  g.lineJoin = 'round'
  let k = kind === 'veins' ? 11 : 29
  const rnd = () => hash(k++, 4243)
  const count = kind === 'veins' ? 5 : 11
  for (let i = 0; i < count; i++) {
    const path = []
    let x = rnd() * n
    let y = rnd() * n
    let a = rnd() * Math.PI * 2
    const steps = 8 + Math.floor(rnd() * 16)
    for (let s = 0; s < steps; s++) {
      path.push([x, y])
      a += (rnd() - 0.5) * 1.3
      x += Math.cos(a) * 10
      y += Math.sin(a) * 10
    }
    const core = kind === 'veins' ? 1 + rnd() * 0.6 : 1.1 + rnd() * 1.3
    for (const [width, style] of [
      [core * 3.2, 'rgba(255,255,255,0.22)'],
      [core, '#ffffff']
    ]) {
      g.lineWidth = width
      g.strokeStyle = style
      for (const dx of [-n, 0, n]) {
        for (const dy of [-n, 0, n]) {
          g.beginPath()
          path.forEach(([px, py], j) =>
            j ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)
          )
          g.stroke()
        }
      }
    }
  }
  glowSets[kind] = tiled(c, true)
  return glowSets[kind]
}

// Tablas verticales de 14 a 22 cm con veta, nudos y la ranura oscura entre
// tablas: puertas, cercos y mostradores. Un metro por lado.
let woodSet = null
function woodTextures() {
  if (woodSet) return woodSet
  const n = 256
  const height = new Float32Array(n * n)
  const value = new Float32Array(n * n)
  const warmth = new Float32Array(n * n)
  let k = 5
  const rnd = () => hash(k++, 3571)
  let x0 = 0
  while (x0 < n) {
    let w = Math.round(n * (0.14 + rnd() * 0.08))
    if (n - x0 - w < n * 0.1) w = n - x0
    const tone = 0.75 + rnd() * 0.25
    const phase = rnd() * 40
    const knot = rnd() < 0.5 ? [x0 + w * (0.3 + rnd() * 0.4), rnd() * n] : null
    for (let i = 0; i < w; i++) {
      for (let y = 0; y < n; y++) {
        const p = y * n + x0 + i
        const e = Math.min(i, w - 1 - i)
        const gap = clamp(2 - e, 0, 1)
        const streak = Math.sin((i + Math.sin(y * 0.05 + phase) * 3) * 0.9 + phase) * 0.5 + 0.5
        let v = tone * (0.82 + 0.18 * streak) * (1 - gap * 0.7)
        if (knot) {
          const d = Math.hypot((x0 + i - knot[0]) * 1.6, y - knot[1])
          v *= 0.7 + 0.3 * smooth(3, 9, d)
        }
        value[p] = v
        warmth[p] = 0.12
        height[p] = (1 - gap) * (0.9 + 0.1 * streak)
      }
    }
    x0 += w
  }
  woodSet = {
    map: tiled(paintGray(value, n, n, warmth), true),
    normalMap: normalsFrom(height, n, n, 1.6)
  }
  return woodSet
}

// Tejas en escama para los techos de las torres: hiladas de 20 cm, cada teja
// con la punta redonda y la sombra de la de arriba. 1,6 m por lado.
let roofSet = null
function roofTextures() {
  if (roofSet) return roofSet
  const n = 256
  const height = new Float32Array(n * n)
  const value = new Float32Array(n * n)
  const row = 32
  const wide = 28
  for (let y = 0; y < n; y++) {
    const r = Math.floor(y / row)
    const ty = (y % row) / row
    const shift = r % 2 ? wide / 2 : 0
    for (let x = 0; x < n; x++) {
      const c = Math.floor((x + shift) / wide)
      const tx = ((x + shift) % wide) / wide - 0.5
      // La punta de la teja es un arco: abajo de el ya es la hilada siguiente.
      const tip = 0.78 + Math.sqrt(Math.max(0, 0.25 - tx * tx)) * 0.44
      const inside = ty < tip ? 1 : 0
      const tone = 0.78 + hash(c, r) * 0.22
      const shade = 0.62 + 0.38 * smooth(0, 0.85, ty)
      const p = y * n + x
      value[p] = inside ? tone * shade : 0.45
      height[p] = inside ? 0.3 + 0.7 * ty : 0.1
    }
  }
  roofSet = {
    map: tiled(paintGray(value, n, n), true),
    normalMap: normalsFrom(height, n, n, 1.4)
  }
  return roofSet
}

// La llama de las antorchas: un punto que brilla, mas blanco en el centro.
let flameSprite = null
function flameTexture() {
  if (flameSprite) return flameSprite
  const c = canvas(64, 64)
  const g = c.getContext('2d')
  const glow = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.18, 'rgba(255,255,255,0.85)')
  glow.addColorStop(0.45, 'rgba(255,255,255,0.28)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 64, 64)
  flameSprite = new THREE.CanvasTexture(c)
  flameSprite.userData.shared = true
  return flameSprite
}

// La reja de hierro de NOX: barrotes con punta de lanza sobre un zocalo. Un
// metro de ancho por 1,2 de alto; lo transparente se descarta (alphaTest).
let ironSet = null
function ironFence() {
  if (ironSet) return ironSet
  const w = 128
  const h = 154
  const c = canvas(w, h)
  const g = c.getContext('2d')
  g.clearRect(0, 0, w, h)
  g.fillStyle = '#ffffff'
  for (let i = 0; i < 8; i++) {
    const x = i * 16 + 7
    g.fillRect(x, 14, 3, h - 14)
    g.beginPath()
    g.moveTo(x - 3, 16)
    g.lineTo(x + 1.5, 2)
    g.lineTo(x + 6, 16)
    g.fill()
  }
  g.fillRect(0, 26, w, 4)
  g.fillRect(0, h - 22, w, 4)
  // Un rulo entre barrotes, arriba.
  g.strokeStyle = '#ffffff'
  g.lineWidth = 2
  for (let i = 0; i < 8; i++) {
    g.beginPath()
    g.arc(i * 16 + 16, 40, 5, 0, Math.PI * 2)
    g.stroke()
  }
  ironSet = tiled(c, true)
  return ironSet
}

// --- Geometria ------------------------------------------------------------

// Recorta un triangulo contra cajas en el plano (x, z), de alto infinito:
// devuelve los pedazos que quedan afuera de todas (Sutherland-Hodgman contra
// cada lado). Cada punto lleva su uv y su color, que se interpolan.
function clipper(boxes) {
  const lerp = (a, b, t) => ({
    p: [
      a.p[0] + (b.p[0] - a.p[0]) * t,
      a.p[1] + (b.p[1] - a.p[1]) * t,
      a.p[2] + (b.p[2] - a.p[2]) * t
    ],
    u: a.u + (b.u - a.u) * t,
    v: a.v + (b.v - a.v) * t,
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  })
  // Lo que queda del lado bajo (below) o alto del plano coord(axis) = value.
  const cut = (poly, axis, value, below) => {
    const out = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const ia = below ? a.p[axis] <= value : a.p[axis] >= value
      const ib = below ? b.p[axis] <= value : b.p[axis] >= value
      if (ia) out.push(a)
      if (ia !== ib) out.push(lerp(a, b, (value - a.p[axis]) / (b.p[axis] - a.p[axis])))
    }
    return out
  }
  const fan = (poly, into) => {
    for (let i = 1; i + 1 < poly.length; i++) into.push([poly[0], poly[i], poly[i + 1]])
  }
  return (tri) => {
    let pieces = [tri]
    for (const box of boxes) {
      const next = []
      for (const t of pieces) {
        const xs = t.map((q) => q.p[0])
        const zs = t.map((q) => q.p[2])
        if (
          Math.max(...xs) <= box.x0 ||
          Math.min(...xs) >= box.x1 ||
          Math.max(...zs) <= box.z0 ||
          Math.min(...zs) >= box.z1
        ) {
          next.push(t)
          continue
        }
        // Afuera de la caja: a un lado en x, o entre x0 y x1 arriba o abajo en z.
        fan(cut(t, 0, box.x0, true), next)
        fan(cut(t, 0, box.x1, false), next)
        const middle = cut(cut(t, 0, box.x0, false), 0, box.x1, true)
        fan(cut(middle, 2, box.z0, true), next)
        fan(cut(middle, 2, box.z1, false), next)
      }
      pieces = next
    }
    return pieces
  }
}

// Junta caras para una sola malla: posicion, normal, uv en metros (el dibujo se
// repite cada `tile`) y color por vertice. Las caras que tocan el piso se
// oscurecen al pie, como piedra con tierra y humedad. Si el taller tiene un
// recorte (state.clip), cada triangulo pasa por el.
function kit(tile = TILE, state = {}) {
  const P = []
  const N = []
  const U = []
  const C = []
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const foot = (y) => 0.6 + 0.4 * smooth(-0.3, 2.2, y)
  const record = (p, u, v, color, grime) => {
    const k = grime ? foot(p[1]) : 1
    return { p, u, v, r: color.r * k, g: color.g * k, b: color.b * k }
  }
  function emit(a, b, c, n) {
    const pieces = state.clip ? state.clip([a, b, c]) : [[a, b, c]]
    for (const tri of pieces) {
      for (const q of tri) {
        P.push(q.p[0], q.p[1], q.p[2])
        N.push(n.x, n.y, n.z)
        U.push(q.u / tile, q.v / tile)
        C.push(q.r, q.g, q.b)
      }
    }
  }
  // El uv sale de hacia donde mira la cara: el dibujo queda a escala en todas.
  function project(p, n) {
    const ax = Math.abs(n.x)
    const ay = Math.abs(n.y)
    const az = Math.abs(n.z)
    if (ay >= ax && ay >= az) return [p[0], p[2]]
    if (ax >= az) return [p[2] * Math.sign(n.x || 1), p[1]]
    return [-p[0] * Math.sign(n.z || 1), p[1]]
  }
  // Un triangulo o un cuadrilatero convexo. Con `out` la cara se da vuelta
  // hasta mirar hacia ese lado. grime oscurece el pie (true por defecto); uvs
  // da el uv de cada punto en metros, si no sale de la proyeccion.
  function face(points, color, out, grime = true, uvs = null) {
    const [a, b, c, d] = points
    ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    ab.cross(ac)
    if (ab.lengthSq() < 1e-12 && d) {
      ab.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
      ac.set(d[0] - a[0], d[1] - a[1], d[2] - a[2])
      ab.cross(ac)
    }
    if (ab.lengthSq() < 1e-12) return
    let list = points
    let maps = uvs
    if (out && ab.x * out[0] + ab.y * out[1] + ab.z * out[2] < 0) {
      list = [...points].reverse()
      if (maps) maps = [...maps].reverse()
      ab.negate()
    }
    ab.normalize()
    const q = list.map((p, i) => {
      const [u, v] = maps ? maps[i] : project(p, ab)
      return record(p, u, v, color, grime)
    })
    emit(q[0], q[1], q[2], ab)
    if (q.length === 4) emit(q[0], q[2], q[3], ab)
  }
  // Caja alineada a los ejes, sin piso salvo que se pida.
  function box(x0, y0, z0, x1, y1, z1, color, { bottom = false, grime = true, top } = {}) {
    const lid = top || color
    face(
      [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1]
      ],
      lid,
      [0, 1, 0],
      grime
    )
    face(
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1]
      ],
      color,
      [0, 0, 1],
      grime
    )
    face(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0]
      ],
      color,
      [0, 0, -1],
      grime
    )
    face(
      [
        [x1, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x1, y1, z0]
      ],
      color,
      [1, 0, 0],
      grime
    )
    face(
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0]
      ],
      color,
      [-1, 0, 0],
      grime
    )
    if (bottom) {
      face(
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1]
        ],
        color,
        [0, -1, 0],
        grime
      )
    }
  }
  // Caja girada en el plano: centro (x, z), eje (dx, dz) a lo largo, largo `len`
  // y ancho `wide`, de y0 a y1.
  function obox(x, z, dx, dz, len, wide, y0, y1, color, opts = {}) {
    const l = len / 2
    const w = wide / 2
    const nx = -dz
    const nz = dx
    const corner = (s, t, y) => [x + dx * s * l + nx * t * w, y, z + dz * s * l + nz * t * w]
    const ring = (y) => [corner(-1, -1, y), corner(1, -1, y), corner(1, 1, y), corner(-1, 1, y)]
    const lo = ring(y0)
    const hi = ring(y1)
    const lid = opts.top || color
    face(hi, lid, [0, 1, 0], opts.grime !== false)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      const mx = (lo[i][0] + lo[j][0]) / 2 - x
      const mz = (lo[i][2] + lo[j][2]) / 2 - z
      face([lo[i], lo[j], hi[j], hi[i]], color, [mx, 0, mz], opts.grime !== false)
    }
    if (opts.bottom) face(lo, color, [0, -1, 0], opts.grime !== false)
  }
  // Una geometria de three.js ya puesta en el mundo. uv 'box' proyecta por
  // cara; 'cyl' envuelve alrededor de (cx, cz) con radio r; 'keep' usa el suyo.
  function add(geometry, color, { uv = 'box', cx = 0, cz = 0, r = 1, grime = true } = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    const pos = g.attributes.position
    const own = g.attributes.uv
    const tri = [[], [], []]
    const n = new THREE.Vector3()
    for (let i = 0; i < pos.count; i += 3) {
      for (let j = 0; j < 3; j++) tri[j] = [pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j)]
      ab.set(tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2])
      ac.set(tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2])
      n.crossVectors(ab, ac)
      if (n.lengthSq() < 1e-14) continue
      n.normalize()
      let uvs
      if (uv === 'cyl') {
        uvs = tri.map((p) => [Math.atan2(p[2] - cz, p[0] - cx) * r, p[1]])
        const span = Math.max(...uvs.map((q) => q[0])) - Math.min(...uvs.map((q) => q[0]))
        if (span > Math.PI * r) for (const q of uvs) if (q[0] < 0) q[0] += Math.PI * 2 * r
        // En las caras casi planas (tapas, techos) el uv sale de arriba.
        if (Math.abs(n.y) > 0.92) uvs = tri.map((p) => [p[0], p[2]])
      } else if (uv === 'keep' && own) {
        uvs = [0, 1, 2].map((j) => [own.getX(i + j) * tile, own.getY(i + j) * tile])
      } else {
        uvs = tri.map((p) => project(p, n))
      }
      const q = [0, 1, 2].map((j) => record(tri[j], uvs[j][0], uvs[j][1], color, grime))
      emit(q[0], q[1], q[2], n)
    }
    if (g !== geometry) g.dispose()
    geometry.dispose()
  }
  function build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3))
    g.computeBoundingSphere()
    return g
  }
  return { face, box, obox, add, build, count: () => P.length / 3 }
}

// Los kits de un mapa, uno por material. La piedra (casi todos los triangulos)
// va ademas por trozos: lo que cae en el mismo trozo va en la misma malla y la
// camara no dibuja los que no ve. Lo demas (techos, madera, telas, rejas,
// venas, colores lisos) pesa poco y va en una sola malla por mapa: cada malla
// es una llamada de dibujo mas. Lo que cae afuera del mapa (w x d metros) va
// al trozo del borde.
const CHUNKED = new Set(['stone'])
function workshop(w, d) {
  const bins = new Map()
  const tiles = { stone: TILE, roof: 1.6, wood: 1, cloth: 1, fence: 1 }
  // state.clip: un recorte que se aplica a todo lo que se agregue mientras este.
  const state = { clip: null }
  const piece = (v, size) => Math.floor(clamp(v, 0, size - 0.01) / CHUNK)
  return {
    at(material, x, z) {
      const key = CHUNKED.has(material)
        ? material + ':' + piece(x, w) + ':' + piece(z, d)
        : material
      if (!bins.has(key)) bins.set(key, { material, kit: kit(tiles[material] || 1, state) })
      return bins.get(key).kit
    },
    state,
    bins
  }
}

// --- La grilla ------------------------------------------------------------

const WALLISH = new Set(['rampart', 'wall', 'masonry'])
// Lo que puede rellenar una muralla: el arte del dibujo entre sus lineas.
const FILLER = new Set(['body', 'frame', 'sign', 'window', 'ornament', 'roof', 'building'])

// Las vecinas de la celda i en una grilla de W de ancho y N celdas: llama a
// fn con cada una que existe, sin armar arreglos (se usa en cada celda de
// mapas de 64.000). Devuelve cuantas habia.
function around(i, W, N, fn) {
  const x = i % W
  let count = 0
  if (i >= W) {
    fn(i - W)
    count++
  }
  if (i + W < N) {
    fn(i + W)
    count++
  }
  if (x > 0) {
    fn(i - 1)
    count++
  }
  if (x < W - 1) {
    fn(i + 1)
    count++
  }
  return count
}

// Lee el mapa: por donde se anda, que es muralla (contorno 1, relleno 2 y
// relleno de torre 3), que es cerco bajo y la altura de cada celda.
function survey(world, style) {
  const { data, kinds, inBuilding, CX, CZ } = world
  const { width: W, height: H, rows, tiles } = data
  const boss = data.kind === 'boss'
  const N = W * H
  const charAt = (x, y) => (rows[y] || '')[x] || ' '

  // Por donde camina el heroe. En las ruinas solo frenan # | - + (BossZone).
  const walk = new Uint8Array(N)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = charAt(x, y)
      const tile = tiles[ch]
      walk[y * W + x] = boss ? ('#|-+'.includes(ch) ? 0 : 1) : tile && !tile.solid ? 1 : 0
    }
  }
  // Lo que se alcanza: la zona caminable mas grande. Lo demas es un patio
  // cerrado que nadie pisa.
  const zone = new Int32Array(N).fill(-1)
  const sizes = []
  for (let s = 0; s < N; s++) {
    if (!walk[s] || zone[s] >= 0) continue
    const id = sizes.length
    const stack = [s]
    zone[s] = id
    const visit = (n) => {
      if (!walk[n] || zone[n] >= 0) return
      zone[n] = id
      stack.push(n)
    }
    let size = 0
    while (stack.length) {
      around(stack.pop(), W, N, visit)
      size++
    }
    sizes.push(size)
  }
  const main = sizes.indexOf(Math.max(0, ...sizes))
  const reach = new Uint8Array(N)
  for (let i = 0; i < N; i++) reach[i] = walk[i] && zone[i] === main ? 1 : 0

  // Las murallas: tramos conectados de #, | - + y _. Con varias celdas # es
  // fortificacion; si no, cerco bajo. En las ruinas todo es muralla caida.
  // Una fila de : (edificio) suelta que sigue a una pared es parte de ese
  // tramo, como los lados de la plaza; sola la sigue subiendo tripo-mundo.js.
  const mass = new Uint8Array(N)
  const low = new Uint8Array(N)
  const comp = new Int32Array(N).fill(-1)
  const comps = []
  const isWall = (i) => !inBuilding[i] && WALLISH.has(kinds[i])
  const joins = (i) => isWall(i) || (!inBuilding[i] && kinds[i] === 'building')
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0 || !isWall(s)) continue
    const id = comps.length
    const cells = []
    let ramparts = 0
    const stack = [s]
    comp[s] = id
    const visit = (n) => {
      if (comp[n] >= 0 || !joins(n)) return
      comp[n] = id
      stack.push(n)
    }
    while (stack.length) {
      const i = stack.pop()
      cells.push(i)
      if (kinds[i] === 'rampart') ramparts++
      around(i, W, N, visit)
    }
    const fort = boss || ramparts >= 8
    for (const i of cells) (fort ? mass : low)[i] = 1
    comps.push({ cells, fort })
  }

  // El relleno: el arte entre las lineas de la muralla (el macizo de un
  // porton, el patio cerrado de una torre). Una region entra si la muralla la
  // rodea en al menos 60% de su borde; si la rodea entera es una torre.
  const eligible = (i) =>
    !mass[i] &&
    !low[i] &&
    !inBuilding[i] &&
    !reach[i] &&
    (kinds[i] === null || kinds[i] === undefined ? walk[i] === 1 : FILLER.has(kinds[i]))
  const seen = new Uint8Array(N)
  // Las torres cerradas, con sus celdas: su nombre va en un cartel arriba.
  const keeps = []
  for (let s = 0; s < N; s++) {
    if (seen[s] || !eligible(s)) continue
    const cells = []
    const stack = [s]
    seen[s] = 1
    let closed = 0
    let open = 0
    const visit = (n) => {
      if (eligible(n)) {
        if (!seen[n]) {
          seen[n] = 1
          stack.push(n)
        }
      } else if (mass[n]) closed++
      else open++
    }
    while (stack.length) {
      const i = stack.pop()
      cells.push(i)
      // Lo que queda afuera del mapa cuenta como cerrado (visit ya sumo lo
      // de adentro: se cuenta aparte, no en la misma suma).
      const inside = around(i, W, N, visit)
      closed += 4 - inside
    }
    const ratio = closed / Math.max(1, closed + open)
    if (cells.length >= 2 && ratio >= 0.6) {
      const tower = open === 0 && cells.length * CX * CZ >= 10
      for (const i of cells) mass[i] = tower ? 3 : 2
      if (tower) keeps.push(cells)
    }
  }
  // Los marcos (=) pegados a la muralla son una terraza baja; los tejados de
  // las diagonales del dibujo (/ y \ junto a dos celdas de muralla), muralla.
  let touching = 0
  const touch = (n) => {
    if (mass[n]) touching++
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      if (mass[i] || low[i] || inBuilding[i] || reach[i]) continue
      const kind = kinds[i]
      if (kind !== 'frame' && kind !== 'roof') continue
      touching = 0
      around(i, W, N, touch)
      if (kind === 'frame' && touching >= 1) mass[i] = 2
      else if (touching >= 2) mass[i] = 1
    }
  }

  // Alturas: el contorno sube al adarve; el relleno que da a un paso queda
  // como terraza baja (no tapa al heroe ni al porton); las torres cerradas,
  // bastante mas altas. El contorno junto a una torre toma su altura.
  const curtain = style.curtain
  const tall = { 1: curtain, 2: 1.3, 3: curtain + 2.2 }
  const high = new Float32Array(N)
  for (let i = 0; i < N; i++) if (mass[i]) high[i] = tall[mass[i]]
  for (let i = 0; i < N; i++) {
    if (mass[i] !== 1) continue
    const x = i % W
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const n = i + dy * W + dx
        if (nx < 0 || nx >= W || n < 0 || n >= N || mass[n] < 2) continue
        high[i] = Math.max(high[i], high[n])
      }
    }
  }
  // En las ruinas la muralla esta rota: el alto cambia a tramos.
  if (style.ruined) {
    for (let i = 0; i < N; i++) {
      if (!mass[i]) continue
      const x = i % W
      const y = (i - x) / W
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1
      const wave = hash(Math.floor(x / 5) + 3, Math.floor(y / 3) + 7)
      const keep = edge ? 0.62 + 0.38 * wave : 0.28 + 0.72 * wave
      high[i] = Math.max(0.7, Math.round((curtain * keep) / 0.3) * 0.3)
    }
  }
  return { W, H, N, walk, reach, mass, low, high, comps, keeps, charAt }
}

// La grilla con margen: la muralla del borde crece hacia afuera del mapa, para
// que tenga espesor de muralla y no de tabique.
function padded(s) {
  const { W, H, mass, high } = s
  const GW = W + PAD_X * 2
  const GH = H + PAD_Z * 2
  const gm = new Uint8Array(GW * GH)
  const gh = new Float32Array(GW * GH)
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = clamp(gx - PAD_X, 0, W - 1)
      const y = clamp(gy - PAD_Z, 0, H - 1)
      const inside = gx - PAD_X === x && gy - PAD_Z === y
      const i = y * W + x
      if (!mass[i]) continue
      // Afuera solo sigue lo que esta en el borde del mapa.
      if (!inside && !(x === 0 || y === 0 || x === W - 1 || y === H - 1)) continue
      gm[gy * GW + gx] = inside ? mass[i] : 1
      gh[gy * GW + gx] = high[i]
    }
  }
  // ghost: celdas que dibuja otra pieza (el bloque de un porton). Cuentan como
  // muralla para las vecinas, pero la masa no las dibuja.
  return { GW, GH, gm, gh, ghost: new Uint8Array(GW * GH) }
}

// --- Portones -------------------------------------------------------------

// Las cuatro direcciones de la grilla.
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]

// Un porton es una puerta gate.* en una linea de muralla: entre dos tramos de
// la misma fila o columna, o pegada a la muralla que la cierra de frente (las
// fronteras). Las puertas de los edificios no son portones: sus vecinas son
// parte del edificio, no de la muralla.
function findGates(world, s, style) {
  const { data, doors } = world
  const gates = []
  for (const door of doors) {
    const tile = data.tiles[door.ch]
    if (!tile || !tile.id.startsWith('gate.')) continue
    const gate = facingGate(world, s, door) || lineGate(world, s, door)
    if (!gate) continue
    gate.door = door
    gate.key = door.x + ',' + door.y
    if (layoutGate(world, s, gate, style)) gates.push(gate)
  }
  return gates
}

// Una puerta pegada a una muralla que la cierra de frente: esa es su unica
// vecina de muralla, y atras y a los costados se camina (la frontera de RUNA y
// NOX). El porton cruza esa muralla, centrado en el camino que llega a ella; si
// del otro lado sigue el camino o se acaba el mapa, se ve de los dos lados.
function facingGate(world, s, door) {
  const { CX, CZ } = world
  const { W, H, mass, walk } = s
  const { x, y } = door
  const inside = (cx, cy) => cx >= 0 && cy >= 0 && cx < W && cy < H
  const isMass = (cx, cy) => !inside(cx, cy) || mass[cy * W + cx] > 0
  const isWalk = (cx, cy) => inside(cx, cy) && walk[cy * W + cx] === 1
  const walls = SIDES.filter(([dx, dy]) => isMass(x + dx, y + dy))
  if (walls.length !== 1) return null
  const [dx, dy] = walls[0]
  if (!isWalk(x - dx, y - dy) || !isWalk(x + dy, y + dx) || !isWalk(x - dy, y - dx)) return null
  // El camino que corre pegado a la muralla, a lo largo de ella.
  const [tx, ty] = [Math.abs(dy), Math.abs(dx)]
  const hugs = (k) => isWalk(x + tx * k, y + ty * k) && isMass(x + tx * k + dx, y + ty * k + dy)
  let a = 0
  while (a < 12 && hugs(-(a + 1))) a++
  let b = 0
  while (b < 12 && hugs(b + 1)) b++
  // Lo grueso de la muralla y lo que hay del otro lado.
  let depth = 1
  while (depth < 6 && inside(x + dx * (depth + 1), y + dy * (depth + 1))) {
    if (!mass[(y + dy * (depth + 1)) * W + x + dx * (depth + 1)]) break
    depth++
  }
  const bx = x + dx * (depth + 1)
  const by = y + dy * (depth + 1)
  const edge = !inside(bx, by)
  const through = edge || walk[by * W + bx] === 1
  const sign = dx || dy
  const line = dx ? x + dx : y + dy
  // En el borde del mapa la muralla sigue hacia afuera (padded): el bloque
  // la cruza entera.
  const far = line + sign * (depth - 1 + (edge ? (dx ? PAD_X : PAD_Z) : 0))
  const cell = dx ? CZ : CX
  const mid = (dx ? y : x) + (b - a) / 2 + 0.5
  const lanes = (a + b + 1) * cell
  return {
    along: dx ? 'z' : 'x',
    line,
    at: mid * cell,
    lanes,
    open: 0,
    face: through ? 0 : -sign,
    outer: sign,
    front: true,
    span: [Math.min(line, far), Math.max(line, far)],
    arch: clamp(lanes - 1.4, 2.4, 4.6)
  }
}

// Una puerta en la linea de una muralla: entre dos tramos de la misma fila (o
// columna). Si se camina de los dos lados, se cruza; si no, es ciega y solo
// muestra la cara que da a lo caminable.
function lineGate(world, s, door) {
  const { CX, CZ } = world
  const { W, H, mass, walk } = s
  const { x, y } = door
  const isWalk = (cx, cy) => cx >= 0 && cy >= 0 && cx < W && cy < H && walk[cy * W + cx] === 1
  // Hasta donde llega lo caminable desde la puerta antes de dar con muralla.
  const scan = (dx, dy, max) => {
    for (let k = 1; k <= max; k++) {
      const cx = x + dx * k
      const cy = y + dy * k
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null
      if (mass[cy * W + cx]) return k
      if (!walk[cy * W + cx]) return null
    }
    return null
  }
  // Lo ancho del camino que llega a la puerta, en celdas.
  const road = (cx, cy, dx, dy) => {
    if (!isWalk(cx, cy)) return 0
    let a = 0
    let b = 0
    while (a < 12 && isWalk(cx - dx * (a + 1), cy - dy * (a + 1))) a++
    while (b < 12 && isWalk(cx + dx * (b + 1), cy + dy * (b + 1))) b++
    return a + b + 1
  }
  let gate = null
  const l = scan(-1, 0, 9)
  const r = scan(1, 0, 9)
  const u = scan(0, -1, 4)
  const d = scan(0, 1, 4)
  if (l && r) {
    const open = l + r - 1
    const lanes = Math.max(open, road(x, y - 1, 1, 0), road(x, y + 1, 1, 0))
    const back = isWalk(x, y - 1) ? (isWalk(x, y + 1) ? 0 : -1) : 1
    gate = {
      along: 'x',
      line: y,
      at: (x - (l - r) / 2 + 0.5) * CX,
      lanes: lanes * CX,
      open: open * CX,
      face: back
    }
  } else if (u && d) {
    const open = u + d - 1
    const lanes = Math.max(open, road(x - 1, y, 0, 1), road(x + 1, y, 0, 1))
    const back = isWalk(x - 1, y) ? (isWalk(x + 1, y) ? 0 : -1) : 1
    gate = {
      along: 'z',
      line: x,
      at: (y - (u - d) / 2 + 0.5) * CZ,
      lanes: lanes * CZ,
      open: open * CZ,
      face: back
    }
  }
  if (!gate) return null
  // Hacia que lado de v queda afuera del mapa: ahi da el rastrillo.
  gate.outer = gate.along === 'x' ? (y > H / 2 ? 1 : -1) : x > W / 2 ? 1 : -1
  // Una puerta ciega cuya muralla de atras llega al borde del mapa es una
  // salida (la del castillo): el porton cruza hasta afuera y se ve de los dos
  // lados.
  if (gate.face) {
    const sign = -gate.face
    const [ax, ay] = gate.along === 'x' ? [0, sign] : [sign, 0]
    const inside = (k) => x + ax * k >= 0 && y + ay * k >= 0 && x + ax * k < W && y + ay * k < H
    let k = 1
    while (inside(k) && mass[(y + ay * k) * W + x + ax * k]) k++
    if (!inside(k)) {
      const far = gate.line + sign * (k - 1 + (gate.along === 'x' ? PAD_Z : PAD_X))
      gate.span = [Math.min(gate.line, far), Math.max(gate.line, far)]
      gate.face = 0
      gate.outer = sign
    }
  }
  gate.arch = clamp(Math.max(gate.open, Math.min(gate.lanes, 3.6)), 2.4, 4.6)
  if (gate.open >= 2.4) gate.arch = Math.min(gate.arch, gate.open)
  return gate
}

// Donde cabe el bloque del porton: los pilares a los lados del arco tienen que
// caer sobre muralla (o afuera del mapa), nunca sobre algo que se pisa. Prueba
// de mas ancho y hondo a menos. Deja en el porton su caja en celdas.
function layoutGate(world, s, g, style) {
  const { CX, CZ } = world
  const { W, H, mass } = s
  const along = g.along === 'x'
  const cu = along ? CX : CZ
  const cv = along ? CZ : CX
  const lim = along ? W : H
  const limV = along ? H : W
  // Celda (i a lo largo, j a traves) es muralla, o afuera del mapa.
  const ok = (i, j) => {
    if (i < 0 || j < 0 || i >= lim || j >= limV) return true
    return mass[along ? j * W + i : i * W + j] > 0
  }
  const half = g.arch / 2
  // Las filas (o columnas) que cruza el bloque: un porton que pasa de lado a
  // lado se centra en su linea; uno ciego se mete en la muralla hacia atras;
  // uno de frente cruza la muralla que lo cierra (span).
  const spans = g.span
    ? [g.span]
    : g.face
      ? [[g.line, g.line - 3 * g.face]]
      : [
          [g.line - 1, g.line + 1],
          [g.line - 2, g.line],
          [g.line, g.line + 2],
          [g.line - 1, g.line],
          [g.line, g.line + 1],
          [g.line, g.line]
        ]
  for (const pier of [1.7, 1.3, 1, 0.75, 0.5, 0.3]) {
    const i0 = Math.floor((g.at - half - pier) / cu + 1e-6)
    const i1 = Math.ceil((g.at + half + pier) / cu - 1e-6) - 1
    for (const [a, b] of spans) {
      const j0 = Math.min(a, b)
      const j1 = Math.max(a, b)
      let fits = true
      for (let j = j0; j <= j1 && fits; j++) {
        for (let i = i0; i <= i1 && fits; i++) {
          // El hueco del arco puede ser cualquier cosa: por ahi se pasa.
          const lo = i * cu
          const hi = (i + 1) * cu
          if (lo >= g.at - half - 0.05 && hi <= g.at + half + 0.05) continue
          if (!ok(i, j)) fits = false
        }
      }
      if (!fits) continue
      Object.assign(g, { i0, i1, j0, j1 })
      g.u0 = i0 * cu - g.at
      g.u1 = (i1 + 1) * cu - g.at
      g.v0 = j0 * cv
      g.v1 = (j1 + 1) * cv
      g.spring = style.ruined ? 2.2 : 2.5
      g.top = Math.max(style.curtain + 1.1, g.spring + half + 1.5)
      return true
    }
  }
  return false
}

// Lleva un punto del porton al mundo: u a lo largo de la muralla (0 en el
// centro del arco), y alto, v a traves (en metros del mundo).
function gateFrame(g) {
  return g.along === 'x' ? (u, y, v) => [g.at + u, y, v] : (u, y, v) => [v, y, g.at + u]
}

// --- Torres ---------------------------------------------------------------

// Una torre entra si todo lo que pisa es muralla o queda afuera del mapa, y no
// se encima con otra. Si no entra, prueba correrse hacia afuera o achicarse.
function towerSite(world, s, towers, x, z, r, out) {
  const { CX, CZ } = world
  const { W, H, mass } = s
  const fits = (cx, cz, rr) => {
    for (const t of towers) if (Math.hypot(t.x - cx, t.z - cz) < (t.r + rr) * 0.92) return false
    const x0 = Math.floor((cx - rr) / CX)
    const x1 = Math.floor((cx + rr) / CX)
    const z0 = Math.floor((cz - rr) / CZ)
    const z1 = Math.floor((cz + rr) / CZ)
    for (let y = z0; y <= z1; y++) {
      for (let xx = x0; xx <= x1; xx++) {
        if (xx < 0 || y < 0 || xx >= W || y >= H) continue
        // La distancia del centro a la celda: si la toca, tiene que ser muralla.
        const dx = Math.max(xx * CX - cx, 0, cx - (xx + 1) * CX)
        const dz = Math.max(y * CZ - cz, 0, cz - (y + 1) * CZ)
        if (dx * dx + dz * dz >= rr * rr * 0.96) continue
        if (!mass[y * W + xx]) return false
      }
    }
    return true
  }
  for (const k of [1, 0.85, 0.7]) {
    for (let push = 0; push <= 3; push += 0.5) {
      const cx = x + out[0] * push
      const cz = z + out[1] * push
      if (fits(cx, cz, r * k)) return { x: cx, z: cz, r: r * k }
    }
  }
  return null
}

// Donde van las torres: en las esquinas salientes de la masa y cada tanto a
// lo largo de las caras largas, siempre que entren. Las que no entran en una
// esquina alta quedan como garitas colgadas arriba (no tocan el piso).
function placeTowers(world, s, grid, gates, style, towers) {
  const { CX, CZ } = world
  const { GW, GH, gm, gh } = grid
  const turrets = []
  if (style.ruined) return turrets
  const solid = (gx, gy) => gx >= 0 && gy >= 0 && gx < GW && gy < GH && gm[gy * GW + gx] > 0
  const X = (gx) => (gx - PAD_X) * CX
  const Z = (gy) => (gy - PAD_Z) * CZ
  const nearGate = (x, z, d) =>
    gates.some((g) => {
      const [gx, , gz] = gateFrame(g)(0, 0, (g.v0 + g.v1) / 2)
      return Math.hypot(gx - x, gz - z) < d
    })
  // Las salidas del mapa: caminos que llegan al borde. Una torre afuera no va
  // delante de una.
  const exits = []
  for (let y = 0; y < s.H; y++) {
    for (let x = 0; x < s.W; x++) {
      const edge = x === 0 || y === 0 || x === s.W - 1 || y === s.H - 1
      if (edge && s.walk[y * s.W + x]) exits.push([(x + 0.5) * CX, (y + 0.5) * CZ])
    }
  }
  const outside = (t) => t.x < 0 || t.z < 0 || t.x > s.W * CX || t.z > s.H * CZ
  const blocksExit = (t) =>
    outside(t) && exits.some(([x, z]) => Math.hypot(x - t.x, z - t.z) < t.r + 3)
  // Lo que se abre desde una celda en una direccion hasta la proxima muralla,
  // en celdas: en la boca de un paso angosto no va garita, que lo taparia.
  const gap = (gx, gy, dx, dy) => {
    let n = 0
    while (n < 12 && !solid(gx + dx * (n + 1), gy + dy * (n + 1))) n++
    return n
  }
  const narrow = (c) => gap(c.gx, c.gy, c.dx, 0) * CX < 3 || gap(c.gx, c.gy, 0, c.dy) * CZ < 3
  // Esquinas salientes: la celda y sus dos vecinas de un lado no son muralla.
  const corners = []
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      if (!solid(gx, gy)) continue
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1]
      ]) {
        if (solid(gx + dx, gy) || solid(gx, gy + dy) || solid(gx + dx, gy + dy)) continue
        // Que las dos caras sigan al menos 2,5 m.
        const alongFace = (k) => solid(gx - dx * k, gy) && !solid(gx - dx * k, gy + dy)
        const downFace = (k) => solid(gx, gy - dy * k) && !solid(gx + dx, gy - dy * k)
        let along = 0
        while (along < 8 && alongFace(along + 1)) along++
        let down = 0
        while (down < 4 && downFace(down + 1)) down++
        if ((along + 1) * CX < 2.4 || (down + 1) * CZ < 2.4) continue
        const x = X(gx) + (dx > 0 ? CX : 0)
        const z = Z(gy) + (dy > 0 ? CZ : 0)
        corners.push({ x, z, dx, dy, gx, gy, h: gh[gy * GW + gx] })
      }
    }
  }
  // Las esquinas del borde primero: son las torres grandes.
  corners.sort((a, b) => b.h - a.h)
  for (const c of corners) {
    if (nearGate(c.x, c.z, 5)) continue
    const out = [c.dx / Math.SQRT2, c.dy / Math.SQRT2]
    const site = towerSite(world, s, towers, c.x - c.dx * 0.6, c.z - c.dy * 0.6, 2.1, out)
    if (site && blocksExit(site)) continue
    if (site) {
      towers.push({ ...site, h: c.h + 2.6, big: true })
      continue
    }
    if (c.h < style.curtain - 0.1 || narrow(c)) continue
    if (turrets.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < 4)) continue
    if (towers.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < t.r + 2)) continue
    turrets.push({ x: c.x + c.dx * 0.15, z: c.z + c.dy * 0.15, r: 0.72, h: c.h })
  }
  // A lo largo de las caras que dan afuera, una torre cada tanto: recorre una
  // fila (o columna) y llama a `emit` en los puntos donde iria cada una.
  const every = 26
  const along = (count, start, cell, at, emit) => {
    let a = 0
    while (a < count) {
      if (!at(a)) {
        a++
        continue
      }
      let b = a
      while (b < count && at(b)) b++
      // Lejos de las puntas: no delante de una abertura ni de una esquina.
      const length = (b - a) * cell - 8
      const n = Math.floor(length / every) + 1
      if (length > 0) {
        for (let k = 1; k <= n; k++) emit(start(a) + 4 + (length * k) / (n + 1))
      }
      a = b
    }
  }
  const tall = (g) => gh[g] >= style.curtain - 0.1
  for (let gy = 0; gy < GH; gy++) {
    for (const dy of [-1, 1]) {
      const z = Z(gy) + (dy > 0 ? CZ : 0)
      along(
        GW,
        X,
        CX,
        (gx) => solid(gx, gy) && !solid(gx, gy + dy) && tall(gy * GW + gx),
        (x) => {
          if (nearGate(x, z, 10)) return
          const site = towerSite(world, s, towers, x, z - dy * 0.4, 1.7, [0, dy])
          if (site && !blocksExit(site)) towers.push({ ...site, h: style.curtain + 2.4 })
        }
      )
    }
  }
  for (let gx = 0; gx < GW; gx++) {
    for (const dx of [-1, 1]) {
      const x = X(gx) + (dx > 0 ? CX : 0)
      along(
        GH,
        Z,
        CZ,
        (gy) => solid(gx, gy) && !solid(gx + dx, gy) && tall(gy * GW + gx),
        (z) => {
          if (nearGate(x, z, 10)) return
          const site = towerSite(world, s, towers, x - dx * 0.4, z, 1.7, [dx, 0])
          if (site && !blocksExit(site)) towers.push({ ...site, h: style.curtain + 2.4 })
        }
      )
    }
  }
  return turrets
}

// --- La masa de la muralla -------------------------------------------------

// Arma la muralla celda por celda pero en tramos largos: tapas por
// rectangulos, una cara donde la altura baja, y en las caras que tocan el piso
// talud, cordon y caras rectas; arriba parapeto y almenas. Sigue la grilla en
// las dos direcciones, asi un paredon vertical es uno solo y no una pila de
// cajas. `blocked(x, z)` dice donde hay una torre (ahi no van almenas). Con
// `paving` las tapas van a otro material, con el uv que diga paving.uv(x, z):
// el piso dibujado de una plaza.
function massGeometry(world, grid, shop, style, colors, blocked, paving = null) {
  const { CX, CZ } = world
  const { GW, GH, gm, gh, ghost } = grid
  const X = (gx) => (gx - PAD_X) * CX
  const Z = (gy) => (gy - PAD_Z) * CZ
  const solid = (gx, gy) => gx >= 0 && gy >= 0 && gx < GW && gy < GH && gm[gy * GW + gx] > 0
  const drawn = (gx, gy) => solid(gx, gy) && !ghost[gy * GW + gx]
  const hAt = (gx, gy) => (solid(gx, gy) ? gh[gy * GW + gx] : 0)
  const chunk = (v) => Math.floor(v / CHUNK)
  const rnd = (a, b) => hash(Math.floor(a * 7.31) + 913, Math.floor(b * 3.17) + 37)

  // Tapas: rectangulos de celdas de la misma altura, sin cruzar trozos.
  const used = new Uint8Array(GW * GH)
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const g = gy * GW + gx
      if (used[g] || !drawn(gx, gy)) continue
      const h = gh[g]
      const cx = chunk(X(gx))
      const cz = chunk(Z(gy))
      let x1 = gx
      while (
        x1 + 1 < GW &&
        !used[gy * GW + x1 + 1] &&
        drawn(x1 + 1, gy) &&
        gh[gy * GW + x1 + 1] === h &&
        chunk(X(x1 + 1)) === cx
      ) {
        x1++
      }
      let y1 = gy
      const rowFits = (yy) => {
        if (chunk(Z(yy)) !== cz) return false
        for (let xx = gx; xx <= x1; xx++) {
          const q = yy * GW + xx
          if (used[q] || !drawn(xx, yy) || gh[q] !== h) return false
        }
        return true
      }
      while (y1 + 1 < GH && rowFits(y1 + 1)) y1++
      for (let yy = gy; yy <= y1; yy++) for (let xx = gx; xx <= x1; xx++) used[yy * GW + xx] = 1
      const a = X(gx)
      const b = X(x1 + 1)
      const c = Z(gy)
      const d = Z(y1 + 1)
      const lid = [
        [a, h, c],
        [b, h, c],
        [b, h, d],
        [a, h, d]
      ]
      if (paving) {
        const uvs = lid.map(([x, , z]) => paving.uv(x, z))
        shop.at(paving.material, a, c).face(lid, colors.white, [0, 1, 0], false, uvs)
      } else {
        shop.at('stone', a, c).face(lid, colors.walk, [0, 1, 0], false)
      }
    }
  }

  // Una cara recta de la muralla: o origen, t a lo largo, n hacia afuera.
  // s0..s1 a lo largo, y0..y1 de alto; ends dice si cada punta es esquina
  // saliente (ahi el talud y el cordon se estiran para cerrar la esquina).
  const P = (o, t, n, s, y, d) => [o[0] + t[0] * s + n[0] * d, y, o[2] + t[2] * s + n[2] * d]
  function wall(k, o, t, n, s0, s1, y0, y1, ends, depth) {
    const out = [n[0], 0, n[2]]
    const [c0, c1] = ends
    if (y0 > 0.01) {
      k.face(
        [
          P(o, t, n, s0, y0, 0),
          P(o, t, n, s1, y0, 0),
          P(o, t, n, s1, y1, 0),
          P(o, t, n, s0, y1, 0)
        ],
        colors.stone,
        out
      )
    } else {
      const e = (c, d) => (c ? d : 0)
      // Talud: abajo sale BATTER mas que la cara.
      const foot = Math.min(FOOT, y1 * 0.4)
      k.face(
        [
          P(o, t, n, s0 - e(c0, OFF + BATTER), 0, OFF + BATTER),
          P(o, t, n, s1 + e(c1, OFF + BATTER), 0, OFF + BATTER),
          P(o, t, n, s1 + e(c1, OFF), foot, OFF),
          P(o, t, n, s0 - e(c0, OFF), foot, OFF)
        ],
        colors.stone,
        out
      )
      let base = foot
      if (y1 > 2.4) {
        // Cordon: una moldura que corre sobre el talud.
        const cy = foot + 0.13
        const cs0 = s0 - e(c0, OFF + CORD)
        const cs1 = s1 + e(c1, OFF + CORD)
        k.face(
          [
            P(o, t, n, cs0, foot, OFF + CORD),
            P(o, t, n, cs1, foot, OFF + CORD),
            P(o, t, n, cs1, cy, OFF + CORD),
            P(o, t, n, cs0, cy, OFF + CORD)
          ],
          colors.trim,
          out
        )
        k.face(
          [
            P(o, t, n, cs0, cy, OFF),
            P(o, t, n, cs1, cy, OFF),
            P(o, t, n, cs1, cy, OFF + CORD),
            P(o, t, n, cs0, cy, OFF + CORD)
          ],
          colors.trim,
          [0, 1, 0]
        )
        base = cy
      }
      k.face(
        [
          P(o, t, n, s0 - e(c0, OFF), base, OFF),
          P(o, t, n, s1 + e(c1, OFF), base, OFF),
          P(o, t, n, s1 + e(c1, OFF), y1, OFF),
          P(o, t, n, s0 - e(c0, OFF), y1, OFF)
        ],
        colors.stone,
        out
      )
      // Saeteras: una ranura oscura cada tanto en los paredones altos.
      const length = s1 - s0
      if (y1 > 3.4 && length > 3.5) {
        const n2 = Math.floor(length / 5.5)
        for (let i = 1; i <= n2; i++) {
          const m = s0 + (length * i) / (n2 + 1)
          const sy = y1 * 0.55
          k.face(
            [
              P(o, t, n, m - 0.07, sy, OFF + 0.006),
              P(o, t, n, m + 0.07, sy, OFF + 0.006),
              P(o, t, n, m + 0.07, sy + 0.75, OFF + 0.006),
              P(o, t, n, m - 0.07, sy + 0.75, OFF + 0.006)
            ],
            colors.dark,
            out,
            false
          )
        }
      }
    }
    // Parapeto y almenas donde la caida es alta; una terraza baja no lleva.
    if (y1 - y0 < 0.6 || y1 < 2.4) return
    const off = y0 > 0.01 ? 0 : OFF
    const pt = Math.min(PARAPET, depth / 2)
    const ps0 = s0 - (c0 ? off : 0)
    const ps1 = s1 + (c1 ? off : 0)
    const top = y1 + BREAST
    const inner = off - pt
    k.face(
      [
        P(o, t, n, ps0, y1, off),
        P(o, t, n, ps1, y1, off),
        P(o, t, n, ps1, top, off),
        P(o, t, n, ps0, top, off)
      ],
      colors.stone,
      out
    )
    k.face(
      [
        P(o, t, n, ps0, y1, inner),
        P(o, t, n, ps1, y1, inner),
        P(o, t, n, ps1, top, inner),
        P(o, t, n, ps0, top, inner)
      ],
      colors.stone,
      [-n[0], 0, -n[2]]
    )
    k.face(
      [
        P(o, t, n, ps0, top, inner),
        P(o, t, n, ps1, top, inner),
        P(o, t, n, ps1, top, off),
        P(o, t, n, ps0, top, off)
      ],
      colors.trim,
      [0, 1, 0]
    )
    for (const [s, sign] of [
      [ps0, -1],
      [ps1, 1]
    ]) {
      k.face(
        [
          P(o, t, n, s, y1, inner),
          P(o, t, n, s, y1, off),
          P(o, t, n, s, top, off),
          P(o, t, n, s, top, inner)
        ],
        colors.stone,
        [t[0] * sign, 0, t[2] * sign]
      )
    }
    const length = ps1 - ps0
    const count = Math.max(1, Math.round((length + CRENEL) / (MERLON + CRENEL)))
    const step = length / count
    const len = Math.min(MERLON, step - 0.14)
    if (len < 0.2) return
    for (let i = 0; i < count; i++) {
      const m = ps0 + step * (i + 0.5)
      const [mx, , mz] = P(o, t, n, m, 0, off - pt / 2)
      if (blocked(mx, mz)) continue
      let mh = MERLON_H * (0.96 + rnd(mx, mz) * 0.08)
      if (style.ruined) {
        const fate = rnd(mz, mx)
        if (fate < 0.45) continue
        mh *= 0.4 + fate * 0.6
      }
      const a = P(o, t, n, m - len / 2, top, inner)
      const b = P(o, t, n, m + len / 2, top + mh, off)
      const tint = colors.stone.clone().multiplyScalar(0.92 + rnd(mx + 1, mz) * 0.16)
      k.box(
        Math.min(a[0], b[0]),
        top,
        Math.min(a[2], b[2]),
        Math.max(a[0], b[0]),
        top + mh,
        Math.max(a[2], b[2]),
        tint,
        {
          top: colors.trim
        }
      )
    }
  }

  // Las caras, por las cuatro direcciones. Las de norte y sur recorren filas;
  // las de este y oeste, columnas: un paredon vertical sale de un solo tramo.
  const sides = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 }
  ]
  for (const { dx, dy } of sides) {
    const rowWise = dy !== 0
    const lines = rowWise ? GH : GW
    const cells = rowWise ? GW : GH
    for (let line = 0; line < lines; line++) {
      let a = 0
      while (a < cells) {
        const gx = rowWise ? a : line
        const gy = rowWise ? line : a
        const y1 = drawn(gx, gy) ? gh[gy * GW + gx] : 0
        const y0 = hAt(gx + dx, gy + dy)
        if (!drawn(gx, gy) || y1 - y0 < 0.01) {
          a++
          continue
        }
        const piece = chunk(rowWise ? X(gx) : Z(gy))
        let b = a + 1
        while (b < cells) {
          const bx = rowWise ? b : line
          const by = rowWise ? line : b
          if (!drawn(bx, by) || gh[by * GW + bx] !== y1 || hAt(bx + dx, by + dy) !== y0) break
          if (chunk(rowWise ? X(bx) : Z(by)) !== piece) break
          b++
        }
        // Las puntas: saliente si la cara dobla, recta si sigue en otro tramo.
        const endAt = (c) => {
          const cx = rowWise ? c : line
          const cy = rowWise ? line : c
          return !solid(cx, cy)
        }
        const ends = [endAt(a - 1), endAt(b)]
        // Cuanto mide la masa hacia adentro, para el espesor del parapeto.
        let depth = 0
        for (let k2 = 0; k2 < 3; k2++) {
          if (!solid(gx - dx * k2, gy - dy * k2)) break
          depth += rowWise ? CZ : CX
        }
        let o
        let t
        let n
        let s0
        let s1
        if (rowWise) {
          const z = dy > 0 ? Z(line + 1) : Z(line)
          o = [0, 0, z]
          t = [1, 0, 0]
          n = [0, 0, dy]
          s0 = X(a)
          s1 = X(b)
        } else {
          const x = dx > 0 ? X(line + 1) : X(line)
          o = [x, 0, 0]
          t = [0, 0, 1]
          n = [dx, 0, 0]
          s0 = Z(a)
          s1 = Z(b)
        }
        const mid = P(o, t, n, (s0 + s1) / 2, 0, 0)
        wall(shop.at('stone', mid[0], mid[2]), o, t, n, s0, s1, y0, y1, ends, depth)
        a = b
      }
    }
  }
}

// --- Torres, garitas y portones: la geometria ------------------------------

// Una torre redonda por perfil (LatheGeometry): talud al pie, cuerpo, una
// moldura de matacanes arriba y el parapeto con su anillo de almenas; con
// techo conico, aguja o abierta (rota en las ruinas).
function roundTower(shop, t, style, colors, flags) {
  const segs = style.roof === 'spire' ? 12 : 16
  const { x, z, r, h } = t
  const k = shop.at('stone', x, z)
  const base = t.base || 0
  const lip = r + 0.2
  const profile = base
    ? [
        [0.05, base - 1.1],
        [r * 0.55, base - 0.7],
        [r, base - 0.05],
        [r, h - 0.35],
        [lip, h - 0.2]
      ]
    : [
        [r + 0.3, 0],
        [r, 1.3],
        [r, h - 0.45],
        [lip, h - 0.25]
      ]
  const roofed = style.roof !== 'none' && !t.open
  const crown = roofed ? h + 0.15 : h + BREAST
  profile.push([lip, crown], [lip - 0.3, crown], [lip - 0.3, h + 0.05], [0, h + 0.05])
  const lathe = new THREE.LatheGeometry(
    profile.map(([pr, py]) => new THREE.Vector2(pr, py)),
    segs
  )
  lathe.translate(x, 0, z)
  k.add(lathe, colors.stone, { uv: 'cyl', cx: x, cz: z, r })
  // Saeteras en el cuerpo.
  if (!base) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + hash(Math.round(x * 10), Math.round(z * 10)) * 6
      const sy = 1.9 + i * 1.1
      if (sy + 0.7 > h - 0.6) break
      const cx = x + Math.cos(a) * (r + 0.01)
      const cz = z + Math.sin(a) * (r + 0.01)
      k.obox(cx, cz, -Math.sin(a), Math.cos(a), 0.14, 0.02, sy, sy + 0.7, colors.dark, {
        grime: false
      })
    }
  }
  if (!roofed) {
    // Almenas alrededor del parapeto.
    const count = Math.max(6, Math.round((Math.PI * 2 * lip) / (MERLON + CRENEL)))
    for (let i = 0; i < count; i++) {
      if (style.ruined && hash(i + 7, Math.round(x * 3)) < 0.5) continue
      const a = ((i + 0.5) / count) * Math.PI * 2
      const mx = x + Math.cos(a) * (lip - 0.15)
      const mz = z + Math.sin(a) * (lip - 0.15)
      const mh = style.ruined ? MERLON_H * (0.3 + hash(i, 5) * 0.7) : MERLON_H
      k.obox(
        mx,
        mz,
        -Math.sin(a),
        Math.cos(a),
        MERLON * 0.9,
        0.3,
        crown,
        crown + mh,
        colors.stone,
        { top: colors.trim, grime: false }
      )
    }
    return crown + MERLON_H
  }
  // El techo: cono de tejas con un alero, o aguja alta en NOX.
  const spire = style.roof === 'spire'
  const rr = lip + 0.25
  const rise = spire ? rr * 3.6 : rr * 2.1
  const roof = new THREE.ConeGeometry(rr, rise, segs, 1, true)
  roof.translate(x, crown + rise / 2, z)
  shop.at('roof', x, z).add(roof, colors.roof, { uv: 'cyl', cx: x, cz: z, r: rr, grime: false })
  const eave = new THREE.RingGeometry(lip - 0.3, rr, segs, 1)
  eave.rotateX(Math.PI / 2)
  eave.translate(x, crown, z)
  shop.at('roof', x, z).add(eave, colors.roof.clone().multiplyScalar(0.4), { grime: false })
  const tip = crown + rise
  // Remate y banderola.
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 1.1, 5)
  pole.translate(x, tip + 0.45, z)
  shop.at('wood', x, z).add(pole, colors.iron, { grime: false })
  if (flags) flags.push({ x, z, y: tip + 0.95, along: [1, 0], size: [0.75, 0.34], pennant: true })
  if (spire) {
    // Un anillo encendido en la base de la aguja.
    const band = new THREE.CylinderGeometry(rr * 0.82, rr * 0.86, 0.12, segs, 1, true)
    band.translate(x, crown + rise * 0.18, z)
    shop.at('glow', x, z).add(band, colors.vein, { grime: false })
  }
  return tip
}

// Una torre cuadrada (el castillo): talud, cordon, parapeto con almenas y
// techo a cuatro aguas de pizarra adentro del parapeto.
function squareTower(shop, t, style, colors, flags) {
  const { x, z, h } = t
  const half = t.r * 0.86
  const k = shop.at('stone', x, z)
  const faces = [
    [
      [x - half, 0, z + half],
      [1, 0, 0],
      [0, 0, 1]
    ],
    [
      [x + half, 0, z - half],
      [-1, 0, 0],
      [0, 0, -1]
    ],
    [
      [x + half, 0, z + half],
      [0, 0, -1],
      [1, 0, 0]
    ],
    [
      [x - half, 0, z - half],
      [0, 0, 1],
      [-1, 0, 0]
    ]
  ]
  const P = (o, tt, n, s, y, d) => [o[0] + tt[0] * s + n[0] * d, y, o[2] + tt[2] * s + n[2] * d]
  const L = half * 2
  for (const [o, tt, n] of faces) {
    const out = [n[0], 0, n[2]]
    k.face(
      [
        P(o, tt, n, -BATTER, 0, BATTER),
        P(o, tt, n, L + BATTER, 0, BATTER),
        P(o, tt, n, L, 1.2, 0),
        P(o, tt, n, 0, 1.2, 0)
      ],
      colors.stone,
      out
    )
    k.face(
      [P(o, tt, n, 0, 1.2, 0), P(o, tt, n, L, 1.2, 0), P(o, tt, n, L, h, 0), P(o, tt, n, 0, h, 0)],
      colors.stone,
      out
    )
    k.face(
      [
        P(o, tt, n, -0.12, h, 0.12),
        P(o, tt, n, L + 0.12, h, 0.12),
        P(o, tt, n, L + 0.12, h + BREAST, 0.12),
        P(o, tt, n, -0.12, h + BREAST, 0.12)
      ],
      colors.stone,
      out
    )
    k.face(
      [
        P(o, tt, n, -0.12, h - 0.2, 0.12),
        P(o, tt, n, L + 0.12, h - 0.2, 0.12),
        P(o, tt, n, L + 0.12, h, 0),
        P(o, tt, n, -0.12, h, 0)
      ],
      colors.trim,
      [n[0], -1, n[2]]
    )
    k.face(
      [
        P(o, tt, n, 0, h + BREAST, -0.2),
        P(o, tt, n, L, h + BREAST, -0.2),
        P(o, tt, n, L + 0.12, h + BREAST, 0.12),
        P(o, tt, n, -0.12, h + BREAST, 0.12)
      ],
      colors.trim,
      [0, 1, 0]
    )
    for (let i = 0; i < 2; i++) {
      const m = L * (0.3 + i * 0.4)
      const sy = 2 + i * 1.3
      k.face(
        [
          P(o, tt, n, m - 0.07, sy, 0.006),
          P(o, tt, n, m + 0.07, sy, 0.006),
          P(o, tt, n, m + 0.07, sy + 0.7, 0.006),
          P(o, tt, n, m - 0.07, sy + 0.7, 0.006)
        ],
        colors.dark,
        out,
        false
      )
    }
    const count = Math.max(2, Math.round((L + CRENEL) / (MERLON + CRENEL)))
    for (let i = 0; i < count; i++) {
      const m = -0.12 + ((L + 0.24) * (i + 0.5)) / count
      const a = P(o, tt, n, m - MERLON * 0.45, 0, -0.18)
      const b = P(o, tt, n, m + MERLON * 0.45, 0, 0.12)
      k.box(
        Math.min(a[0], b[0]),
        h + BREAST,
        Math.min(a[2], b[2]),
        Math.max(a[0], b[0]),
        h + BREAST + MERLON_H,
        Math.max(a[2], b[2]),
        colors.stone,
        { top: colors.trim, grime: false }
      )
    }
  }
  k.face(
    [
      [x - half, h, z - half],
      [x + half, h, z - half],
      [x + half, h, z + half],
      [x - half, h, z + half]
    ],
    colors.walk,
    [0, 1, 0],
    false
  )
  if (style.roof !== 'pyramid') return h + BREAST + MERLON_H
  const rise = half * 1.9
  const roof = new THREE.ConeGeometry(half * 1.2, rise, 4, 1, true)
  roof.rotateY(Math.PI / 4)
  roof.translate(x, h + 0.2 + rise / 2, z)
  shop.at('roof', x, z).add(roof, colors.roof, { uv: 'cyl', cx: x, cz: z, r: half, grime: false })
  const tip = h + 0.2 + rise
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 1.1, 5)
  pole.translate(x, tip + 0.45, z)
  shop.at('wood', x, z).add(pole, colors.iron, { grime: false })
  if (flags) flags.push({ x, z, y: tip + 0.95, along: [1, 0], size: [0.75, 0.34], pennant: true })
  return tip
}

function tower(shop, t, style, colors, flags) {
  return style.tower === 'square' && !t.base
    ? squareTower(shop, t, style, colors, flags)
    : roundTower(shop, t, style, colors, flags)
}

// Dos antorchas en la cara v de un porton, a `reach` del centro del arco: un
// brazo de hierro, la copa y la llama, que tiembla en el shader (flameMesh).
// out dice hacia que lado de v mira la cara.
function torches(wood, at, reach, v, out, colors, decor) {
  for (const side of [-1, 1]) {
    const u = side * reach
    const p = at(u - 0.05, 2.15, v)
    const q = at(u + 0.05, 2.3, v + out * 0.34)
    wood.box(
      Math.min(p[0], q[0]),
      2.15,
      Math.min(p[2], q[2]),
      Math.max(p[0], q[0]),
      2.3,
      Math.max(p[2], q[2]),
      colors.iron,
      { bottom: true, grime: false }
    )
    const cup = at(u, 2.3, v + out * 0.34)
    wood.box(cup[0] - 0.07, 2.3, cup[2] - 0.07, cup[0] + 0.07, 2.55, cup[2] + 0.07, colors.iron, {
      bottom: true,
      grime: false
    })
    decor.flames.push([cup[0], 2.72, cup[2]])
  }
}

// El porton: el bloque con el arco recortado (ExtrudeGeometry de un Shape,
// como el ejemplo de formas extruidas de three.js), dovelas con su clave,
// jambas de sillares, las dos hojas de madera abiertas, el rastrillo subido,
// un matacan sobre el arco, antorchas y estandartes en las caras que se ven.
function gatehouse(shop, g, style, colors, decor) {
  const at = gateFrame(g)
  const half = g.arch / 2
  const spring = g.spring
  const H = g.top
  const D = g.v1 - g.v0
  // Del espacio del Shape (x a lo largo, z la profundidad) al mundo. En una
  // muralla que corre en z se gira un cuarto de vuelta: la profundidad queda en
  // x y el eje del Shape apunta al reves, de ahi `flip`.
  const flip = g.along === 'x' ? 1 : -1
  const place = (geometry, w0 = 0) => {
    const m = new THREE.Matrix4()
    if (g.along === 'x') m.makeTranslation(g.at, 0, g.v0 + w0)
    else m.makeRotationY(Math.PI / 2).setPosition(g.v0 + w0, 0, g.at)
    geometry.applyMatrix4(m)
    return geometry
  }
  const [cxw, , czw] = at(0, 0, (g.v0 + g.v1) / 2)
  const k = shop.at('stone', cxw, czw)
  const wood = shop.at('wood', cxw, czw)

  // El bloque, con el arco de medio punto recortado desde abajo.
  const u0 = g.u0 - 0.03
  const u1 = g.u1 + 0.03
  const shape = new THREE.Shape()
  shape.moveTo(u0 * flip, 0)
  shape.lineTo(-half * flip, 0)
  shape.lineTo(-half * flip, spring)
  shape.absarc(0, spring, half, flip > 0 ? Math.PI : 0, flip > 0 ? 0 : Math.PI, flip > 0)
  shape.lineTo(half * flip, 0)
  shape.lineTo(u1 * flip, 0)
  shape.lineTo(u1 * flip, H)
  shape.lineTo(u0 * flip, H)
  shape.closePath()
  const block = new THREE.ExtrudeGeometry(shape, {
    depth: D,
    bevelEnabled: false,
    curveSegments: 16
  })
  k.add(place(block), colors.stone)

  // Dovelas: nueve cuñas alrededor del arco, la del medio (la clave) mas alta,
  // alternando la piedra clara con la del color de cada reino.
  const n = 9
  for (let i = 0; i < n; i++) {
    const tone = i % 2 ? colors.voussoir : colors.trim
    const a0 = Math.PI - (i / n) * Math.PI - 0.012
    const a1 = Math.PI - ((i + 1) / n) * Math.PI + 0.012
    const r0 = half - 0.05
    const r1 = half + (i === (n - 1) / 2 ? 0.62 : 0.44)
    const wedge = new THREE.Shape()
    wedge.moveTo(Math.cos(a0) * r0 * flip, spring + Math.sin(a0) * r0)
    wedge.lineTo(Math.cos(a0) * r1 * flip, spring + Math.sin(a0) * r1)
    wedge.lineTo(Math.cos(a1) * r1 * flip, spring + Math.sin(a1) * r1)
    wedge.lineTo(Math.cos(a1) * r0 * flip, spring + Math.sin(a1) * r0)
    wedge.closePath()
    const stone = new THREE.ExtrudeGeometry(wedge, { depth: D + 0.12, bevelEnabled: false })
    k.add(place(stone, -0.06), tone, { grime: false })
  }
  // Jambas: sillares alternados a los dos lados del arco, hasta el arranque.
  for (const side of [-1, 1]) {
    for (let j = 0; j * 0.46 < spring - 0.05; j++) {
      const y0 = j * 0.46
      const y1 = Math.min(spring, y0 + 0.44)
      const w = j % 2 ? 0.32 : 0.5
      const a = at(side * (half - 0.04), y0, g.v0 - 0.05)
      const b = at(side * (half + w), y1, g.v1 + 0.05)
      k.box(
        Math.min(a[0], b[0]),
        y0,
        Math.min(a[2], b[2]),
        Math.max(a[0], b[0]),
        y1,
        Math.max(a[2], b[2]),
        colors.trim
      )
    }
  }
  // Un portico (una abertura sin porton) lleva el arco y sus dovelas. En una
  // muralla alta el adarve sigue por encima con sus almenas; si no, termina
  // con una albardilla, asi no tapa lo que hay detras.
  if (g.plain && !g.crown) {
    const a = at(g.u0 - 0.03, H, g.v0 - 0.06)
    const b = at(g.u1 + 0.03, H + 0.1, g.v1 + 0.06)
    k.box(
      Math.min(a[0], b[0]),
      H,
      Math.min(a[2], b[2]),
      Math.max(a[0], b[0]),
      H + 0.1,
      Math.max(a[2], b[2]),
      colors.trim,
      { bottom: true, grime: false }
    )
    return
  }
  // Parapeto y almenas arriba, en los bordes del frente y de atras.
  const edges = [
    [g.u0 - 0.03, g.u1 + 0.03, g.v0 - 0.05, g.v0 + PARAPET - 0.05],
    [g.u0 - 0.03, g.u1 + 0.03, g.v1 - PARAPET + 0.05, g.v1 + 0.05]
  ]
  for (const [ua, ub, va, vb] of edges) {
    const a = at(ua, H, va)
    const b = at(ub, H + BREAST, vb)
    k.box(
      Math.min(a[0], b[0]),
      H,
      Math.min(a[2], b[2]),
      Math.max(a[0], b[0]),
      H + BREAST,
      Math.max(a[2], b[2]),
      colors.stone,
      { top: colors.trim, grime: false }
    )
    const length = ub - ua
    const count = Math.max(2, Math.round((length + CRENEL) / (MERLON + CRENEL)))
    for (let i = 0; i < count; i++) {
      if (style.ruined && hash(i, Math.round(va * 7)) < 0.4) continue
      const m = ua + (length * (i + 0.5)) / count
      const p = at(m - MERLON * 0.45, 0, va)
      const q = at(m + MERLON * 0.45, 0, vb)
      k.box(
        Math.min(p[0], q[0]),
        H + BREAST,
        Math.min(p[2], q[2]),
        Math.max(p[0], q[0]),
        H + BREAST + MERLON_H,
        Math.max(p[2], q[2]),
        colors.stone,
        { top: colors.trim, grime: false }
      )
    }
  }
  if (g.plain) {
    if (g.crown) torches(wood, at, half + 0.55, g.outer > 0 ? g.v1 : g.v0, g.outer, colors, decor)
    return
  }
  // Las caras que se ven: las dos si el porton se cruza; si es ciego, la que
  // da a lo caminable (face dice hacia que lado de v queda).
  const shown = []
  if (g.face <= 0) shown.push({ v: g.v0, out: -1 })
  if (g.face >= 0) shown.push({ v: g.v1, out: 1 })
  for (const f of shown) {
    const v = f.v
    // Matacan: una galeria saliente sobre el arco con sus mensulas.
    if (!style.ruined && H - (spring + half) > 1.2) {
      const span = half + 0.45
      const yb = H - 0.85
      const a = at(-span, yb, v)
      const b = at(span, H + BREAST, v + f.out * 0.42)
      k.box(
        Math.min(a[0], b[0]),
        yb,
        Math.min(a[2], b[2]),
        Math.max(a[0], b[0]),
        H + BREAST,
        Math.max(a[2], b[2]),
        colors.stone,
        { bottom: true, top: colors.trim, grime: false }
      )
      const count = 5
      for (let i = 0; i < count; i++) {
        const m = -span + 0.15 + ((span * 2 - 0.3) * i) / (count - 1)
        const p = at(m - 0.1, yb - 0.45, v)
        const q = at(m + 0.1, yb, v + f.out * 0.36)
        k.box(
          Math.min(p[0], q[0]),
          yb - 0.45,
          Math.min(p[2], q[2]),
          Math.max(p[0], q[0]),
          yb,
          Math.max(p[2], q[2]),
          colors.trim,
          { bottom: true, grime: false }
        )
      }
      for (let i = 0; i < 4; i++) {
        const m = -span + (span * 2 * (i + 0.5)) / 4
        const p = at(m - 0.24, 0, v + f.out * 0.12)
        const q = at(m + 0.24, 0, v + f.out * 0.42)
        k.box(
          Math.min(p[0], q[0]),
          H + BREAST,
          Math.min(p[2], q[2]),
          Math.max(p[0], q[0]),
          H + BREAST + MERLON_H,
          Math.max(p[2], q[2]),
          colors.stone,
          { top: colors.trim, grime: false }
        )
      }
    }
    torches(wood, at, half + 0.62, v, f.out, colors, decor)
    // Estandartes: cuelgan de la cornisa, sobre los pilares o junto al arco.
    const room = Math.min(-g.u0, g.u1) - half
    const bu = room >= 1.1 ? half + room * 0.55 : half + 0.62
    const bw = clamp(room * 0.8, 0.42, 0.95)
    for (const side of [-1, 1]) {
      const [bx, , bz] = at(side * bu, 0, v + f.out * 0.07)
      const along = g.along === 'x' ? [1, 0] : [0, 1]
      decor.banners.push({
        x: bx,
        z: bz,
        y: H - 0.12,
        along,
        size: [bw, Math.min(2.4, H - 3.1)],
        out: g.along === 'x' ? [0, f.out] : [f.out, 0]
      })
    }
  }

  // Las hojas de la puerta, abiertas contra los costados del pasaje, y el
  // rastrillo subido: solo asoman sus puntas bajo la clave. En un porton ciego
  // los dos van del lado que se ve; en uno que se cruza, el rastrillo da
  // afuera y las puertas adentro.
  const doorH = spring + 0.32
  const leaf = half - 0.08
  const outer = g.face || g.outer
  let wFront
  let wGate
  if (g.face) {
    wGate = g.face < 0 ? g.v0 + 0.16 : g.v1 - 0.16
    wFront = g.face < 0 ? g.v0 + 0.45 : g.v1 - 0.45
  } else {
    wGate = outer > 0 ? g.v1 - 0.18 : g.v0 + 0.18
    wFront = outer > 0 ? g.v0 + 0.3 : g.v1 - 0.3
  }
  const dir = (g.face ? -g.face : outer) > 0 ? 1 : -1
  for (const side of [-1, 1]) {
    const u = side * (half - 0.09)
    const p = at(u - 0.05, 0.02, wFront)
    const q = at(u + 0.05, doorH, wFront + dir * leaf)
    wood.box(
      Math.min(p[0], q[0]),
      0.02,
      Math.min(p[2], q[2]),
      Math.max(p[0], q[0]),
      doorH,
      Math.max(p[2], q[2]),
      colors.wood
    )
    for (const y of [0.45, doorH * 0.5, doorH - 0.45]) {
      const a = at(u - side * 0.07, y, wFront + dir * 0.04)
      const b = at(u - side * 0.055, y + 0.09, wFront + dir * (leaf - 0.04))
      wood.box(
        Math.min(a[0], b[0]),
        y,
        Math.min(a[2], b[2]),
        Math.max(a[0], b[0]),
        y + 0.09,
        Math.max(a[2], b[2]),
        colors.iron,
        { grime: false }
      )
    }
  }
  const crownY = spring + half
  const low = crownY - 0.95
  for (let u = -half + 0.16; u <= half - 0.16; u += 0.27) {
    const top = spring + Math.sqrt(Math.max(0, half * half - u * u))
    if (top - low < 0.12) continue
    const a = at(u - 0.025, low, wGate - 0.025)
    const b = at(u + 0.025, top, wGate + 0.025)
    wood.box(
      Math.min(a[0], b[0]),
      low - 0.12,
      Math.min(a[2], b[2]),
      Math.max(a[0], b[0]),
      top,
      Math.max(a[2], b[2]),
      colors.iron,
      { bottom: true, grime: false }
    )
  }
  for (const y of [low + 0.18, low + 0.58]) {
    const reach = Math.sqrt(Math.max(0, half * half - (y - spring) * (y - spring))) - 0.05
    if (reach <= 0.2) continue
    const a = at(-reach, y, wGate - 0.035)
    const b = at(reach, y + 0.06, wGate + 0.035)
    wood.box(
      Math.min(a[0], b[0]),
      y,
      Math.min(a[2], b[2]),
      Math.max(a[0], b[0]),
      y + 0.06,
      Math.max(a[2], b[2]),
      colors.iron,
      { bottom: true, grime: false }
    )
  }
}

// --- Cercos bajos -----------------------------------------------------------

// Los tramos de pared que no son fortificacion: cercos de jardin, bordes de
// plaza, el borde de una fuente. Van por el eje de las celdas, mas finos que
// la celda, con pilares en las puntas y esquinas. Los puestos del mercado ya
// no estan en `low`: los arma stallGeometry.
function lowWalls(world, s, shop, style, colors) {
  const { data, kinds, CX, CZ } = world
  const { W, H, low, comps, charAt } = s
  const kindOf = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : kinds[y * W + x])
  const isLow = (x, y) => x >= 0 && y >= 0 && x < W && y < H && low[y * W + x] === 1
  // Cada tramo se viste segun lo que tiene alrededor.
  const look = new Uint8Array(W * H)
  const LOOK = { wall: 1, rim: 2, curb: 3 }
  for (const c of comps) {
    if (c.fort) continue
    let water = 0
    let masonry = 0
    for (const i of c.cells) {
      const x = i % W
      const y = (i - x) / W
      if (kinds[i] === 'masonry') masonry++
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = kindOf(x + dx, y + dy)
          if (k === 'water' || k === 'fountain') water++
        }
      }
    }
    let kind = LOOK.wall
    if (water) kind = LOOK.rim
    else if (masonry > c.cells.length * 0.6) kind = LOOK.curb
    for (const i of c.cells) look[i] = kind
  }
  const spec = {
    [LOOK.wall]: { t: 0.42, h: style.fence === 'iron' ? 0.42 : data.id === 'castle' ? 1.15 : 0.82 },
    [LOOK.curb]: { t: 0.5, h: 0.62 },
    [LOOK.rim]: { t: 0.36, h: 0.5 }
  }
  const pillars = []
  const fences = []
  // Tramos horizontales (por filas) y verticales (por columnas).
  for (const rowWise of [true, false]) {
    const lines = rowWise ? H : W
    const cells = rowWise ? W : H
    for (let line = 0; line < lines; line++) {
      let a = 0
      while (a < cells) {
        const x = rowWise ? a : line
        const y = rowWise ? line : a
        if (!isLow(x, y)) {
          a++
          continue
        }
        const kind = look[y * W + x]
        // La celda c de esta linea sigue el tramo: es cerco y del mismo tipo.
        const follows = (c) => {
          const cx = rowWise ? c : line
          const cy = rowWise ? line : c
          return isLow(cx, cy) && look[cy * W + cx] === kind
        }
        let b = a
        while (b + 1 < cells && follows(b + 1)) b++
        if (b > a) {
          const { t, h } = spec[kind]
          const c0 = rowWise ? (a + 0.5) * CX : (line + 0.5) * CX
          const c1 = rowWise ? (b + 0.5) * CX : (line + 0.5) * CX
          const z0 = rowWise ? (line + 0.5) * CZ : (a + 0.5) * CZ
          const z1 = rowWise ? (line + 0.5) * CZ : (b + 0.5) * CZ
          const x0 = Math.min(c0, c1) - t / 2
          const x1 = Math.max(c0, c1) + t / 2
          const zz0 = Math.min(z0, z1) - t / 2
          const zz1 = Math.max(z0, z1) + t / 2
          const k = shop.at('stone', (x0 + x1) / 2, (zz0 + zz1) / 2)
          k.box(x0, 0, zz0, x1, h, zz1, colors.stone)
          k.box(x0 - 0.05, h, zz0 - 0.05, x1 + 0.05, h + 0.08, zz1 + 0.05, colors.trim, {
            bottom: true,
            grime: false
          })
          if (kind === LOOK.wall && style.fence === 'iron') {
            fences.push({ rowWise, x0, x1, z0: zz0, z1: zz1, y: h + 0.08 })
          }
        }
        a = b + 1
      }
    }
  }
  // Pilares: en las puntas, esquinas, cruces y los + del dibujo; en los cercos
  // largos, uno cada tanto.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isLow(x, y)) continue
      const kind = look[y * W + x]
      const ch = charAt(x, y)
      const h2 = isLow(x - 1, y) + isLow(x + 1, y)
      const v2 = isLow(x, y - 1) + isLow(x, y + 1)
      const end = h2 + v2 <= 1
      const corner = h2 > 0 && v2 > 0
      const regular = (h2 === 2 && x % 12 === 0) || (v2 === 2 && y % 6 === 0)
      if (end || corner || ch === '+' || (kind === LOOK.wall && regular)) {
        pillars.push({ x, y, kind, ch })
      }
    }
  }
  for (const p of pillars) {
    const cx = (p.x + 0.5) * CX
    const cz = (p.y + 0.5) * CZ
    const { t, h } = spec[p.kind]
    const k = shop.at('stone', cx, cz)
    const w = (p.kind === LOOK.rim ? t + 0.08 : t + 0.2) / 2
    const ph = style.fence === 'iron' && p.kind === LOOK.wall ? 1.6 : h + 0.38
    k.box(cx - w, 0, cz - w, cx + w, ph, cz + w, colors.stone)
    k.box(cx - w - 0.05, ph, cz - w - 0.05, cx + w + 0.05, ph + 0.08, cz + w + 0.05, colors.trim, {
      bottom: true,
      grime: false
    })
    if (p.kind === LOOK.rim) continue
    if (style.fence === 'iron') {
      const cap = new THREE.OctahedronGeometry(0.13, 0)
      cap.translate(cx, ph + 0.24, cz)
      shop.at('glow', cx, cz).add(cap, colors.vein, { grime: false })
    } else {
      const cap = new THREE.SphereGeometry(0.17, 8, 6)
      cap.translate(cx, ph + 0.24, cz)
      k.add(cap, colors.trim, { grime: false })
    }
  }
  // La reja de NOX: un plano con barrotes recortados (alphaTest) sobre el zocalo.
  for (const f of fences) {
    const k = shop.at('fence', (f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2)
    const y0 = f.y
    const y1 = f.y + 1.1
    if (f.rowWise) {
      const z = (f.z0 + f.z1) / 2
      k.face(
        [
          [f.x0, y0, z],
          [f.x1, y0, z],
          [f.x1, y1, z],
          [f.x0, y1, z]
        ],
        colors.white,
        [0, 0, 1],
        false,
        [
          [f.x0, 0],
          [f.x1, 0],
          [f.x1, 1],
          [f.x0, 1]
        ]
      )
    } else {
      const x = (f.x0 + f.x1) / 2
      k.face(
        [
          [x, y0, f.z0],
          [x, y0, f.z1],
          [x, y1, f.z1],
          [x, y1, f.z0]
        ],
        colors.white,
        [1, 0, 0],
        false,
        [
          [f.z0, 0],
          [f.z1, 0],
          [f.z1, 1],
          [f.z0, 1]
        ]
      )
    }
  }
}

// --- Carteles -----------------------------------------------------------------

// Lo que puede haber entre los corchetes de un cartel.
const SIGN_ART = new Set(['sign', 'body', 'window'])

// Los carteles sueltos del mapa: letras entre corchetes en una fila, como
// "[ mercado del alba ]". Las letras las sigue subiendo tripo-mundo.js; aca se
// toman los corchetes y los espacios entre palabras.
function findSigns(world, s) {
  const { kinds, inBuilding } = world
  const { W, H, charAt } = s
  const art = (x, y) => !inBuilding[y * W + x] && SIGN_ART.has(kinds[y * W + x])
  const signs = []
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < W) {
      if (charAt(x, y) !== '[' || !art(x, y)) {
        x++
        continue
      }
      let b = x + 1
      let letters = 0
      while (b < W && charAt(b, y) !== ']' && art(b, y)) {
        if (kinds[y * W + b] === 'sign') letters++
        b++
      }
      if (b < W && charAt(b, y) === ']' && art(b, y) && letters) {
        signs.push({ y, a: x, b })
        x = b + 1
      } else x++
    }
  }
  return signs
}

// Un cartel: los corchetes pasan a ser dos postes de madera con su remate,
// pegados a las puntas de la tabla, y los espacios entre palabras se rellenan
// con la misma tabla amarilla de las letras (las cajas de tripo-mundo.js:
// 1,4 m de alto, casi una celda de ancho y de hondo).
function signGeometry(world, shop, sign, colors) {
  const { kinds, CX, CZ } = world
  const W = world.data.width
  const { y, a, b } = sign
  const z0 = y * CZ + 0.01
  const z1 = (y + 1) * CZ - 0.01
  const zc = (y + 0.5) * CZ
  const board = shop.at('paint', a * CX, zc)
  for (let x = a + 1; x < b; x++) {
    if (kinds[y * W + x] !== 'body') continue
    board.box(x * CX + 0.005, 0, z0, (x + 1) * CX - 0.005, 1.4, z1, colors.board, {
      grime: false
    })
  }
  const wood = shop.at('wood', a * CX, zc)
  const post = colors.wood.clone().multiplyScalar(0.75)
  for (const [x0, x1] of [
    [(a + 1) * CX - 0.2, (a + 1) * CX + 0.01],
    [b * CX - 0.01, b * CX + 0.2]
  ]) {
    wood.box(x0, 0, zc - 0.13, x1, 1.92, zc + 0.13, post)
    wood.box(x0 - 0.04, 1.92, zc - 0.17, x1 + 0.04, 2, zc + 0.17, post, { bottom: true })
    const cap = new THREE.ConeGeometry(0.12, 0.22, 4)
    cap.rotateY(Math.PI / 4)
    cap.translate((x0 + x1) / 2, 2.11, zc)
    wood.add(cap, colors.iron, { grime: false })
  }
}

// Los bancos de las plazas: "[====]" en una fila, fuera de los edificios
// (adentro de uno es una ventana del dibujo).
function findBenches(world, s) {
  const { inBuilding } = world
  const { W, H, charAt } = s
  const free = (x, y) => !inBuilding[y * W + x]
  const benches = []
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (charAt(x, y) !== '[' || !free(x, y)) continue
      let b = x + 1
      while (b < W && charAt(b, y) === '=' && free(b, y)) b++
      if (b - x >= 3 && charAt(b, y) === ']' && free(b, y)) benches.push({ y, a: x, b })
    }
  }
  return benches
}

// Un banco de piedra: patas cada metro y medio y el asiento con su canto
// claro, mas angosto que la celda.
function benchGeometry(world, shop, bench, colors) {
  const { CX, CZ } = world
  const { y, a, b } = bench
  const x0 = a * CX + 0.1
  const x1 = (b + 1) * CX - 0.1
  const z0 = y * CZ + 0.24
  const z1 = (y + 1) * CZ - 0.24
  const k = shop.at('stone', (x0 + x1) / 2, (z0 + z1) / 2)
  const legs = Math.max(2, Math.round((x1 - x0) / 1.5) + 1)
  for (let i = 0; i < legs; i++) {
    const cx = x0 + 0.2 + ((x1 - x0 - 0.4) * i) / (legs - 1)
    k.box(cx - 0.12, 0, z0 + 0.07, cx + 0.12, 0.4, z1 - 0.07, colors.stone)
  }
  k.box(x0, 0.4, z0, x1, 0.5, z1, colors.trim, { bottom: true, grime: false })
}

// --- Puestos del mercado -----------------------------------------------------

// Lo que puede ser parte del dibujo de un puesto.
const STALL_ART = new Set([
  'wall',
  'masonry',
  'roof',
  'window',
  'ornament',
  'sign',
  'body',
  'frame'
])

// Los puestos del mercado: un dibujo chico (celdas que no se pisan, unidas en
// diagonal) con mostrador (_), mercaderia ([] {} ()) y toldo (/\). Devuelve
// cada uno con sus celdas por clase; sus paredes dejan de ser cerco bajo.
function findStalls(world, s) {
  const { kinds, inBuilding } = world
  const { W, H, low, walk } = s
  const piece = new Uint8Array(W * H)
  const stalls = []
  for (let s0 = 0; s0 < W * H; s0++) {
    if (piece[s0] || !low[s0]) continue
    const cells = []
    const stack = [s0]
    piece[s0] = 1
    while (stack.length && cells.length < 120) {
      const i = stack.pop()
      cells.push(i)
      const x = i % W
      const y = (i - x) / W
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const n = ny * W + nx
          if (piece[n] || inBuilding[n] || walk[n] || !STALL_ART.has(kinds[n])) continue
          piece[n] = 1
          stack.push(n)
        }
      }
    }
    const of = (...list) => cells.filter((i) => list.includes(kinds[i]))
    const st = {
      cells,
      roof: of('roof'),
      wares: of('window', 'ornament'),
      counter: of('masonry'),
      posts: of('wall'),
      benches: of('frame')
    }
    if (cells.length >= 120 || st.roof.length < 2 || st.wares.length < 2 || !st.counter.length) {
      continue
    }
    // Un puesto lleva el toldo arriba, en una sola fila. Una escultura con
    // / y \ repartidos en varias filas (el paseo de la luna) no es un puesto.
    const top = Math.min(...cells.map((i) => Math.floor(i / W)))
    if (st.roof.some((i) => Math.floor(i / W) !== top)) continue
    for (const i of cells) low[i] = 0
    stalls.push(st)
  }
  return stalls
}

// Lo que se vende, por el caracter del dibujo: pan y canastas en [], frutas
// en {}, telas y sacos en (). Cada cajon toma uno de su familia.
const GOODS = {
  '[': [0xc8964b, 0xe0b46a, 0x9b6a35],
  ']': [0xc8964b, 0xe0b46a, 0x9b6a35],
  '{': [0xc0392b, 0x7fb03f, 0xe69138],
  '}': [0xc0392b, 0x7fb03f, 0xe69138],
  '(': [0x3d6fb6, 0x8e44ad, 0xeee6d4],
  ')': [0x3d6fb6, 0x8e44ad, 0xeee6d4]
}

// Un puesto: el mostrador de madera a lo largo de cada fila que lo tiene, con
// la mercaderia encima en cajones de colores; postes en los | del dibujo y un
// toldo a rayas que lo cubre entero, bajando hacia el lado del mostrador.
function stallGeometry(world, s, shop, st, colors) {
  const { CX, CZ } = world
  const { W, charAt } = s
  const xy = (i) => [i % W, Math.floor(i / W)]
  const wood = shop.at('wood', 0, 0)
  const dark = colors.wood.clone().multiplyScalar(0.7)
  // El mostrador: por fila, los tramos seguidos de mostrador y mercaderia.
  const counterRows = new Set(st.counter.map((i) => xy(i)[1]))
  const byRow = new Map()
  for (const i of [...st.counter, ...st.wares]) {
    const [x, y] = xy(i)
    if (!counterRows.has(y)) continue
    if (!byRow.has(y)) byRow.set(y, [])
    byRow.get(y).push(x)
  }
  for (const [y, xs] of byRow) {
    xs.sort((a, b) => a - b)
    let a = 0
    while (a < xs.length) {
      let b = a
      while (b + 1 < xs.length && xs[b + 1] === xs[b] + 1) b++
      const x0 = xs[a] * CX
      const x1 = (xs[b] + 1) * CX
      const z0 = y * CZ + 0.18
      const z1 = (y + 1) * CZ - 0.18
      wood.box(x0, 0, z0, x1, 0.84, z1, dark)
      wood.box(x0 - 0.04, 0.84, z0 - 0.07, x1 + 0.04, 0.92, z1 + 0.07, colors.wood, {
        bottom: true
      })
      a = b + 1
    }
  }
  // La mercaderia: un cajon por celda, sobre el mostrador o en el piso.
  for (const i of st.wares) {
    const [x, y] = xy(i)
    const cx = (x + 0.5) * CX
    const cz = (y + 0.5) * CZ
    const base = counterRows.has(y) ? 0.92 : 0
    const family = GOODS[charAt(x, y)] || GOODS['{']
    const tint = new THREE.Color(family[Math.floor(hash(x, y) * family.length)])
    wood.box(cx - 0.21, base, cz - 0.24, cx + 0.21, base + 0.2, cz + 0.24, colors.wood, {
      bottom: !base
    })
    const heap = shop.at('paint', cx, cz)
    heap.box(cx - 0.17, base + 0.2, cz - 0.2, cx + 0.17, base + 0.31, cz + 0.2, tint, {
      grime: false
    })
  }
  // Bancos bajos donde el dibujo tiene otra cosa (=).
  for (const i of st.benches) {
    const [x, y] = xy(i)
    wood.box(x * CX + 0.04, 0, y * CZ + 0.2, (x + 1) * CX - 0.04, 0.45, (y + 1) * CZ - 0.2, dark)
  }
  // El toldo: cubre todo el dibujo; baja hacia el mostrador (o hacia el sur).
  let [bx0, bx1, bz0, bz1] = [Infinity, -Infinity, Infinity, -Infinity]
  for (const i of st.cells) {
    const [x, y] = xy(i)
    bx0 = Math.min(bx0, x)
    bx1 = Math.max(bx1, x)
    bz0 = Math.min(bz0, y)
    bz1 = Math.max(bz1, y)
  }
  const roofRow = st.roof.reduce((sum, i) => sum + xy(i)[1], 0) / st.roof.length
  const counterRow = [...counterRows].reduce((sum, y) => sum + y, 0) / counterRows.size
  const south = counterRow >= roofRow
  const x0 = bx0 * CX - 0.1
  const x1 = (bx1 + 1) * CX + 0.1
  const zBack = south ? bz0 * CZ + 0.1 : (bz1 + 1) * CZ - 0.1
  const zFront = south ? (bz1 + 1) * CZ + 0.12 : bz0 * CZ - 0.12
  const yBack = 2.8
  const yFront = 2.3
  const cloth = shop.at('cloth', (x0 + x1) / 2, (zBack + zFront) / 2)
  const stripes = Math.max(2, Math.round((x1 - x0) / 0.5))
  const tones = [colors.banner, colors.canvas]
  for (let k = 0; k < stripes; k++) {
    const a = x0 + ((x1 - x0) * k) / stripes
    const b = x0 + ((x1 - x0) * (k + 1)) / stripes
    const tone = tones[k % 2]
    // El faldon de adelante tiembla un poco (uv.y); el toldo tenso, no.
    cloth.face(
      [
        [a, yBack, zBack],
        [b, yBack, zBack],
        [b, yFront, zFront],
        [a, yFront, zFront]
      ],
      tone,
      [0, 1, 0],
      false,
      [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0]
      ]
    )
    cloth.face(
      [
        [a, yFront, zFront],
        [b, yFront, zFront],
        [b, yFront - 0.24, zFront],
        [a, yFront - 0.24, zFront]
      ],
      tone,
      [0, 0, south ? 1 : -1],
      false,
      [
        [0, 0],
        [0, 0],
        [0, 0.3],
        [0, 0.3]
      ]
    )
  }
  // Los postes: en los | del dibujo y en las esquinas del toldo que no caen
  // donde se camina.
  const pole = colors.wood.clone().multiplyScalar(0.8)
  const heightAt = (z) => yBack + ((yFront - yBack) * (z - zBack)) / (zFront - zBack)
  const spots = st.posts.map((i) => {
    const [x, y] = xy(i)
    return [(x + 0.5) * CX, (y + 0.5) * CZ]
  })
  for (const zz of [zBack + (south ? 0.06 : -0.06), zFront - (south ? 0.3 : -0.3)]) {
    for (const xx of [x0 + 0.08, x1 - 0.08]) {
      const cell = Math.floor(zz / CZ) * W + Math.floor(xx / CX)
      if (!s.walk[cell]) spots.push([xx, zz])
    }
  }
  for (const [px, pz] of spots) {
    wood.box(px - 0.07, 0, pz - 0.07, px + 0.07, heightAt(pz), pz + 0.07, pole)
  }
}

// --- Telas y llamas ---------------------------------------------------------

// Un estandarte: un paño con cola de golondrina y una franja del color de
// acento arriba, que se mueve con el viento en el shader (la amplitud crece
// hacia abajo). Las banderolas de las torres son triangulos al viento.
function banner(shop, b, colors) {
  const k = shop.at('cloth', b.x, b.z)
  const [w, h] = b.size
  const [ax, az] = b.along
  const P = (s, y, d = 0) => [
    b.x + ax * s + (b.out ? b.out[0] * d : 0),
    y,
    b.z + az * s + (b.out ? b.out[1] * d : 0)
  ]
  // El uv.y de la tela es cuanto se aleja del palo: el shader la mueve mas
  // cuanto mas lejos.
  if (b.pennant) {
    k.face([P(0, b.y, 0), P(w, b.y - h / 2, 0), P(0, b.y - h, 0)], colors.banner, null, false, [
      [0, 0],
      [0, w],
      [0, 0]
    ])
    return
  }
  const top = b.y
  const rows = 6
  const out = b.out ? [b.out[0], 0, b.out[1]] : null
  for (let r = 0; r < rows; r++) {
    const y0 = top - (h * r) / rows
    const y1 = top - (h * (r + 1)) / rows
    const c = r === 0 ? colors.accent : r === 1 ? colors.bannerDark : colors.banner
    const d0 = top - y0
    const d1 = top - y1
    if (r === rows - 1) {
      // La cola de golondrina: el medio sube.
      const notch = y1 + h * 0.16
      const dn = top - notch
      k.face([P(-w / 2, y0), P(0, y0), P(0, notch), P(-w / 2, y1)], c, out, false, [
        [0, d0],
        [0, d0],
        [0, dn],
        [0, d1]
      ])
      k.face([P(0, y0), P(w / 2, y0), P(w / 2, y1), P(0, notch)], c, out, false, [
        [0, d0],
        [0, d0],
        [0, d1],
        [0, dn]
      ])
    } else {
      k.face([P(-w / 2, y0), P(w / 2, y0), P(w / 2, y1), P(-w / 2, y1)], c, out, false, [
        [0, d0],
        [0, d0],
        [0, d1],
        [0, d1]
      ])
    }
  }
  // El palo de arriba.
  const pole = shop.at('wood', b.x, b.z)
  const p = P(-w / 2 - 0.1, top, 0.03)
  const q = P(w / 2 + 0.1, top + 0.08, 0.1)
  pole.box(
    Math.min(p[0], q[0]),
    top,
    Math.min(p[2], q[2]),
    Math.max(p[0], q[0]),
    top + 0.08,
    Math.max(p[2], q[2]),
    colors.iron,
    { bottom: true, grime: false }
  )
}

// El paño se mueve con el viento: una ola que baja por la tela y un temblor
// mas corto. uv.y es cuanto se aleja del palo, asi el borde de arriba no se
// despega. Como la tela es fina, se mueve sobre su propia normal, y casi
// siempre hacia afuera: colgada de una pared, no se mete en ella.
function clothMaterial(clock) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.88
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wind = clock
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float wind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float reach = min( uv.y, 2.4 );
        float sway = sin( wind * 1.9 - reach * 1.6 + position.x * 0.7 + position.z * 0.5 );
        float flutter = sin( wind * 4.7 - reach * 3.3 + position.x * 1.9 - position.z * 1.1 ) * 0.4;
        transformed += objectNormal * ( 0.55 + 0.45 * sway + flutter ) * 0.075 * reach;`
      )
  }
  return material
}

// Las llamas y sus halos: puntos que miran siempre a la camara, mas grandes y
// tenues los halos, y que tiemblan cada uno a su ritmo (en el shader).
function flameMesh(spots, style, clock) {
  if (!spots.length) return null
  const position = []
  const color = []
  const flare = []
  const phase = []
  const [r, g, b] = style.flame
  spots.forEach(([x, y, z], i) => {
    const p = hash(i, 71) * 40
    position.push(x, y + 0.3, z, x, y, z, x, y - 0.06, z)
    color.push(r * 0.5, g * 0.42, b * 0.32, r, g * 0.9, b * 0.75, 1, 1, 0.92)
    flare.push(3.4, 1.15, 0.55)
    phase.push(p, p + 1.3, p + 2.1)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  geometry.setAttribute('flare', new THREE.Float32BufferAttribute(flare, 1))
  geometry.setAttribute('phase', new THREE.Float32BufferAttribute(phase, 1))
  const material = new THREE.PointsMaterial({
    size: 0.62,
    map: flameTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wind = clock
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float wind;\nattribute float flare;\nattribute float phase;'
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float flick = sin( wind * 13.0 + phase ) * sin( wind * 7.7 + phase * 1.9 );
        transformed.y += flick * 0.03 * flare;`
      )
      .replace(
        'gl_PointSize = size;',
        'gl_PointSize = size * flare * ( 0.84 + 0.16 * sin( wind * 11.0 + phase * 2.3 ) );'
      )
  }
  const points = new THREE.Points(geometry, material)
  points.renderOrder = 3
  return points
}

// --- Techos, arcos sueltos y el monumento ----------------------------------

// Un techo a cuatro aguas adentro del parapeto de una torre cerrada, con la
// cumbrera a lo largo del lado largo. El uv corre a lo largo del alero y sube
// por el faldon, asi las hiladas de tejas quedan paralelas al borde.
function hipRoof(shop, box, y, pitch, colors) {
  const { x0, x1, z0, z1 } = box
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const alongX = x1 - x0 >= z1 - z0
  const half = (alongX ? z1 - z0 : x1 - x0) / 2
  const rise = half * pitch
  const r = Math.max(0, (alongX ? x1 - x0 : z1 - z0) / 2 - half)
  const top = y + rise
  const R0 = alongX ? [cx - r, top, cz] : [cx, top, cz - r]
  const R1 = alongX ? [cx + r, top, cz] : [cx, top, cz + r]
  const A = [x0, y, z0]
  const B = [x1, y, z0]
  const C = [x1, y, z1]
  const D = [x0, y, z1]
  const slant = Math.hypot(1, 1 / pitch)
  const k = shop.at('roof', cx, cz)
  // Cada faldon: el alero (e0 a e1) y los puntos de arriba.
  const pane = (e0, e1, ups, out) => {
    const dx = e1[0] - e0[0]
    const dz = e1[2] - e0[2]
    const len = Math.hypot(dx, dz)
    const uv = (p) => [((p[0] - e0[0]) * dx + (p[2] - e0[2]) * dz) / len, (p[1] - y) * slant]
    const points = [e0, e1, ...ups]
    k.face(points, colors.roof, out, false, points.map(uv))
  }
  if (alongX) {
    pane(A, B, [R1, R0], [0, 1, -1])
    pane(C, D, [R0, R1], [0, 1, 1])
    pane(B, C, [R1], [1, 1, 0])
    pane(D, A, [R0], [-1, 1, 0])
  } else {
    pane(D, A, [R0, R1], [-1, 1, 0])
    pane(B, C, [R1, R0], [1, 1, 0])
    pane(A, B, [R0], [0, 1, -1])
    pane(C, D, [R1], [0, 1, 1])
  }
  const cap = shop.at('wood', cx, cz)
  const lo = [Math.min(R0[0], R1[0]) - 0.12, Math.min(R0[2], R1[2]) - 0.12]
  const hi = [Math.max(R0[0], R1[0]) + 0.12, Math.max(R0[2], R1[2]) + 0.12]
  cap.box(
    lo[0],
    top - 0.06,
    lo[1],
    hi[0],
    top + 0.12,
    hi[1],
    colors.roof.clone().multiplyScalar(0.55),
    {
      grime: false
    }
  )
  return top
}

// Los techos de las torres cerradas que son rectangulos llenos. Devuelve la
// altura de cada techo, por torre.
function keepRoofs(world, s, shop, style, colors) {
  const tops = new Map()
  if (style.roof === 'none') return tops
  const { CX, CZ } = world
  const { W } = s
  const pitch = { cone: 0.85, spire: 1.3, pyramid: 1 }[style.roof] || 0.9
  for (const cells of s.keeps) {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const i of cells) {
      const x = i % W
      const y = (i - x) / W
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    if (cells.length < (x1 - x0 + 1) * (y1 - y0 + 1) * 0.85) continue
    const box = {
      x0: x0 * CX - 0.15,
      x1: (x1 + 1) * CX + 0.15,
      z0: y0 * CZ - 0.45,
      z1: (y1 + 1) * CZ + 0.45
    }
    tops.set(cells, hipRoof(shop, box, s.high[cells[0]] + 0.12, pitch, colors))
  }
  return tops
}

// Las aberturas por donde un camino cruza la muralla sin porton: entre dos
// tramos de la misma fila (o columna) y con paso a los dos lados. Llevan un
// arco simple encima, sin puertas ni rastrillo: un portico con la misma forma
// que un porton (plain).
function findOpenings(world, s, style) {
  if (style.ruined) return []
  const { CX, CZ, doors } = world
  const { W, H, mass, walk, high } = s
  const door = new Set(doors.map((d) => d.y * W + d.x))
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mass[y * W + x] > 0
  const open = (x, y) =>
    x >= 0 && y >= 0 && x < W && y < H && walk[y * W + x] === 1 && !mass[y * W + x]
  const pass = (x, y) => x < 0 || y < 0 || x >= W || y >= H || open(x, y)
  const found = []
  for (const along of ['x', 'z']) {
    const lines = along === 'x' ? H : W
    const cells = along === 'x' ? W : H
    const cell = along === 'x' ? CX : CZ
    const deep = along === 'x' ? CZ : CX
    // at(i, j): la celda i a lo largo de la muralla, en la linea j.
    const at = (i, j) => (along === 'x' ? [i, j] : [j, i])
    const runs = new Map()
    for (let j = 0; j < lines; j++) {
      let i = 0
      while (i < cells) {
        if (!open(...at(i, j)) || !solid(...at(i - 1, j)) || !solid(...at(i - 2, j))) {
          i++
          continue
        }
        let e = i
        while (e < cells && open(...at(e, j))) e++
        if (e - i <= 8 && solid(...at(e, j)) && solid(...at(e + 1, j))) {
          const key = i + ':' + e
          if (!runs.has(key)) runs.set(key, [])
          runs.get(key).push(j)
        }
        i = e
      }
    }
    for (const [key, list] of runs) {
      const [i, e] = key.split(':').map(Number)
      // Lo alto de la muralla a los dos lados de la abertura, en la linea j.
      const sides = (j) => {
        const [lx, ly] = at(i - 1, j)
        const [rx, ry] = at(e, j)
        return [high[ly * W + lx], high[ry * W + rx]]
      }
      const tall = (j) => Math.min(...sides(j)) >= 2.4
      // Lineas seguidas con la misma abertura entre murallas altas: un solo
      // portico. Un pasillo entre terrazas bajas no lleva arco; si sigue a una
      // abertura en una muralla alta, el arco va en esa boca.
      let a = 0
      while (a < list.length) {
        if (!tall(list[a])) {
          a++
          continue
        }
        let b = a
        while (b + 1 < list.length && list[b + 1] === list[b] + 1 && tall(list[b + 1])) b++
        let j0 = list[a]
        let j1 = list[b]
        a = b + 1
        const mid = Math.floor((i + e - 1) / 2)
        if (j1 - j0 > 3 || !pass(...at(mid, j0 - 1)) || !pass(...at(mid, j1 + 1))) continue
        let gated = false
        for (let j = j0; j <= j1; j++) {
          for (let q = i; q < e; q++) {
            const [x, y] = at(q, j)
            if (door.has(y * W + x)) gated = true
          }
        }
        const wallTop = Math.max(...sides(j0))
        if (gated) continue
        // Pilares de un metro y medio si la muralla sigue a los lados; si no,
        // de una celda.
        const reach = Math.max(1, Math.round(1.5 / cell))
        let pier = 1
        for (let p = 2; p <= reach; p++) {
          const ok = [at(i - p, j0), at(e + p - 1, j0), at(i - p, j1), at(e + p - 1, j1)].every(
            ([x, y]) => solid(x, y)
          )
          if (!ok) break
          pier = p
        }
        // En el borde del mapa la muralla sigue hacia afuera (padded): el
        // arco la cruza entera.
        const pad = along === 'x' ? PAD_Z : PAD_X
        let outer = 1
        const edge = j0 === 0 || j1 === lines - 1
        if (j1 === lines - 1) j1 += pad
        if (j0 === 0) {
          j0 -= pad
          outer = -1
        }
        const arch = (e - i) * cell
        const top = Math.max(wallTop, 2.2 + arch / 2 + 0.7)
        const g = { along, plain: true, face: 0, outer, arch, at: ((i + e) / 2) * cell, top }
        // En la muralla del borde el adarve sigue sobre el arco, con sus
        // almenas, y afuera lo alumbran dos antorchas: es una salida de la
        // ciudad. Adentro el arco termina bajo, asi deja ver lo que sigue.
        g.crown = edge && wallTop >= style.curtain - 0.1
        Object.assign(g, { i0: i - pier, i1: e + pier - 1, j0, j1, spring: top - 0.7 - arch / 2 })
        g.u0 = (i - pier) * cell - g.at
        g.u1 = (e + pier) * cell - g.at
        g.v0 = j0 * deep
        g.v1 = (j1 + 1) * deep
        found.push(g)
      }
    }
  }
  return found
}

// El monumento de la plaza: el dibujo de la estatua en el mapa (espacios,
// tejados, marcos) se vuelve una plataforma de piedra en dos escalones, y el
// modelo de Tripo queda parado arriba, entero (tripo-mundo.js lo pone). Las
// paredes junto al agua siguen como borde de la fuente.
function monumentGrid(world, s) {
  const { data, kinds, inBuilding } = world
  const { W, H, walk, reach } = s
  // Tambien las piedras del dibujo (los ojos de la estatua) y el piso que el
  // dibujo encierra: nadie lo pisa.
  const ART = new Set([
    'body',
    'wall',
    'masonry',
    'roof',
    'frame',
    'building',
    'window',
    'ornament',
    'rampart',
    'rock'
  ])
  const cells = new Uint8Array(W * H)
  const wetAt = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const k = kinds[ny * W + nx]
        if (k === 'water' || k === 'fountain') return true
      }
    }
    return false
  }
  let any = false
  // La caja del dibujo en metros, y donde esta la estatua (tripo-mundo.js la
  // pone en el medio de esa caja).
  let center = null
  let box = null
  for (const mark of data.landmarks || []) {
    if (mark.id !== 'hero-statue' || !mark.bounds) continue
    const { x1, y1, x2, y2 } = mark.bounds
    const { CX, CZ } = world
    center = [((x1 + x2) / 2 + 0.5) * CX, ((y1 + y2) / 2 + 0.5) * CZ]
    box = { x0: x1 * CX, z0: y1 * CZ, w: (x2 - x1 + 1) * CX, d: (y2 - y1 + 1) * CZ }
    for (let y = Math.max(0, y1); y <= Math.min(H - 1, y2); y++) {
      for (let x = Math.max(0, x1); x <= Math.min(W - 1, x2); x++) {
        const i = y * W + x
        if (inBuilding[i] || reach[i]) continue
        // Piso encerrado (sin clase) o arte del dibujo.
        const floor = walk[i] && !kinds[i]
        if (!floor && (walk[i] || !ART.has(kinds[i]))) continue
        if ((kinds[i] === 'wall' || kinds[i] === 'masonry') && wetAt(x, y)) continue
        cells[i] = 1
        any = true
      }
    }
  }
  if (!any) return null
  // Dos escalones: el de adentro, lejos del borde de la plataforma.
  const GW = W + PAD_X * 2
  const GH = H + PAD_Z * 2
  const gm = new Uint8Array(GW * GH)
  const gh = new Float32Array(GW * GH)
  const inner = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !cells[ny * W + nx]) return false
      }
    }
    return true
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!cells[y * W + x]) continue
      const g = (y + PAD_Z) * GW + x + PAD_X
      gm[g] = 1
      gh[g] = inner(x, y) ? 0.6 : 0.3
    }
  }
  return { cells, center, box, grid: { GW, GH, gm, gh, ghost: new Uint8Array(GW * GH) } }
}

// El piso del monumento, dibujado en un canvas que cubre su caja (box, en
// metros): losas de marmol en damero de un metro con sus juntas, un anillo de
// piedra rojiza alrededor de la estatua con dos filetes dorados y una rosa de
// los vientos de ocho puntas. Se arma una vez por pagina.
let plazaSet = null
function plazaTexture(box, center) {
  const key = [box.x0, box.z0, box.w, box.d].join(':')
  if (plazaSet && plazaSet.key === key) return plazaSet.texture
  const ppm = 44
  const c = canvas(Math.round(box.w * ppm), Math.round(box.d * ppm))
  const g = c.getContext('2d')
  const [cx, cz] = [(center[0] - box.x0) * ppm, (center[1] - box.z0) * ppm]
  // Las losas: cada una con su tono, alternando claras y oscuras.
  for (let y = 0; y < Math.ceil(box.d); y++) {
    for (let x = 0; x < Math.ceil(box.w); x++) {
      const v = ((x + y) % 2 ? 236 : 212) + Math.round((hash(x + 31, y + 17) - 0.5) * 14)
      g.fillStyle = `rgb(${v}, ${v - 9}, ${v - 26})`
      g.fillRect(x * ppm, y * ppm, ppm, ppm)
    }
  }
  // Las juntas entre losas.
  g.strokeStyle = 'rgba(70, 52, 34, 0.35)'
  g.lineWidth = 2
  g.beginPath()
  for (let x = 0; x <= box.w; x++) {
    g.moveTo(x * ppm, 0)
    g.lineTo(x * ppm, c.height)
  }
  for (let y = 0; y <= box.d; y++) {
    g.moveTo(0, y * ppm)
    g.lineTo(c.width, y * ppm)
  }
  g.stroke()
  // La rosa de los vientos: puntas largas a los cuatro vientos, cortas entre
  // ellas, mitad clara y mitad oscura como una estrella tallada.
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4
    const len = (k % 2 ? 4.6 : 6.8) * ppm
    const base = 2.45 * ppm
    const half = (k % 2 ? 0.45 : 0.62) * ppm
    const [dx, dz] = [Math.cos(a), Math.sin(a)]
    const tip = [cx + dx * len, cz + dz * len]
    const root = [cx + dx * base, cz + dz * base]
    for (const [side, fill] of [
      [1, k % 2 ? '#b98a3e' : '#8c4a32'],
      [-1, k % 2 ? '#d6ad5c' : '#a85e40']
    ]) {
      g.fillStyle = fill
      g.beginPath()
      g.moveTo(root[0], root[1])
      g.lineTo(root[0] - dz * half * side, root[1] + dx * half * side)
      g.lineTo(tip[0], tip[1])
      g.closePath()
      g.fill()
    }
  }
  // El anillo y sus filetes.
  g.strokeStyle = '#7e4630'
  g.lineWidth = 0.62 * ppm
  g.beginPath()
  g.arc(cx, cz, 2.18 * ppm, 0, Math.PI * 2)
  g.stroke()
  g.strokeStyle = '#d2a64e'
  g.lineWidth = 0.09 * ppm
  for (const r of [1.82, 2.54]) {
    g.beginPath()
    g.arc(cx, cz, r * ppm, 0, Math.PI * 2)
    g.stroke()
  }
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.userData.shared = true
  plazaSet = { key, texture }
  return texture
}

// Como se pega el piso dibujado sobre las tapas del monumento: el uv sale de
// la posicion en su caja (el canvas baja en y, la textura sube en v).
function monumentPaving(box) {
  return {
    material: 'plaza',
    uv: (x, z) => [(x - box.x0) / box.w, 1 - (z - box.z0) / box.d]
  }
}

// --- El coliseo -------------------------------------------------------------

// Mide el anfiteatro en el mapa: el centro (la fila mas ancha del anillo de
// afuera) y, yendo del centro hacia afuera en x y en z, donde empiezan el
// podio, las gradas, el muro y el afuera. Los anillos del dibujo son elipses
// (lib/coliseum.js): aca se miden, no se copian sus numeros.
function measureArena(world, s) {
  const { kinds, CX, CZ } = world
  const { W, H, walk } = s
  let x0 = W
  let x1 = -1
  const spans = []
  for (let y = 0; y < H; y++) {
    let a = -1
    let b = -1
    for (let x = 0; x < W; x++) {
      if (kinds[y * W + x] !== 'rampart') continue
      if (a < 0) a = x
      b = x
    }
    spans.push([a, b])
    if (a >= 0) {
      x0 = Math.min(x0, a)
      x1 = Math.max(x1, b)
    }
  }
  const widest = []
  spans.forEach(([a, b], y) => {
    if (a === x0 && b === x1) widest.push(y)
  })
  if (x1 < 0 || !widest.length) return null
  const cx = (x0 + x1 + 1) / 2
  const cy = (widest[0] + widest[widest.length - 1] + 1) / 2
  const isWall = (i) => kinds[i] === 'rampart'
  const steps = [isWall, (i) => !isWall(i) && !walk[i], isWall, (i) => walk[i] === 1]
  // Distancias (en metros, desde el centro) al borde de cada anillo.
  const ray = (x, y, dx, dy) => {
    const edges = []
    while (edges.length < 4) {
      const inside = x >= 0 && y >= 0 && x < W && y < H
      if (!inside || steps[edges.length](y * W + x)) {
        const ex = dx < 0 ? x + 1 : x
        const ey = dy < 0 ? y + 1 : y
        edges.push(dx ? Math.abs(ex - cx) * CX : Math.abs(ey - cy) * CZ)
        if (!inside) break
      }
      x += dx
      y += dy
    }
    return edges.length === 4 ? edges : null
  }
  const row = Math.floor(cy) - 1
  const left = ray(Math.floor(cx) - 1, row, -1, 0)
  const right = ray(Math.ceil(cx), row, 1, 0)
  const up = ray(Math.floor(cx), Math.floor(cy) - 1, 0, -1)
  if (!left || !right || !up) return null
  const ex = left.map((v, k) => (v + right[k]) / 2)
  const ax = ex[3]
  const az = up[3]
  const q = [0, 1, 2].map((k) => (ex[k] / ax + up[k] / az) / 2)
  return { X0: cx * CX, Z0: cy * CZ, ax, az, q }
}

// El plan del coliseo: la elipse, los anillos en q (0 el centro, 1 la cara de
// afuera), que celdas son del anillo (las dibuja el coliseo, no la muralla
// comun) y las cajas que se recortan: el tunel del sur y las dos puertas de
// los luchadores, por donde se camina.
function arenaPlan(world, s) {
  const { CX, CZ, kinds } = world
  const { W, H, walk } = s
  const m = measureArena(world, s)
  if (!m) return null
  const { X0, Z0, ax, az } = m
  const qOf = (x, z) => Math.hypot((x - X0) / ax, (z - Z0) / az)
  const center = (i) => qOf(((i % W) + 0.5) * CX, (Math.floor(i / W) + 0.5) * CZ)
  // Las aberturas: grupos de celdas caminables mas alla de la arena que se
  // meten al menos hasta la mitad del podio (el borde escalonado de la arena
  // no cuenta). La que llega al muro de afuera es el tunel.
  const candidate = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const q = center(i)
    if (walk[i] && q > m.q[0] && q <= 0.985) candidate[i] = 1
  }
  const opening = new Uint8Array(W * H)
  const groups = []
  const seen = new Uint8Array(W * H)
  for (let start = 0; start < W * H; start++) {
    if (!candidate[start] || seen[start]) continue
    const stack = [start]
    const cells = []
    seen[start] = 1
    let far = 0
    while (stack.length) {
      const i = stack.pop()
      cells.push(i)
      far = Math.max(far, center(i))
      const x = i % W
      for (const n of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) {
        if (n >= 0 && n < W * H && candidate[n] && !seen[n]) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    if (far <= (m.q[0] + m.q[1]) / 2) continue
    for (const i of cells) opening[i] = 1
    groups.push({ cells, far })
  }
  // El podio arranca justo afuera de la arena, angulo por angulo: ninguna
  // celda que se pisa (y que no sea una abertura) queda tapada, y donde el
  // borde escalonado de la arena se aleja, la cara se le acerca. Se miden las
  // esquinas de cada celda; qAt guarda el radio en cada uno de los N angulos.
  const N = 192
  const qAt = new Float32Array(N + 1).fill(m.q[0] - 0.02)
  const turn = Math.PI * 2
  for (let i = 0; i < W * H; i++) {
    if (!walk[i] || opening[i] || center(i) >= m.q[1]) continue
    const x = i % W
    const y = (i - x) / W
    for (const [px, pz] of [
      [x, y],
      [x + 1, y],
      [x, y + 1],
      [x + 1, y + 1]
    ]) {
      const q = qOf(px * CX, pz * CZ) + 0.004
      const phi = (Math.atan2((pz * CZ - Z0) / az, (px * CX - X0) / ax) + turn) % turn
      const k = Math.floor((phi / turn) * N)
      qAt[k % N] = Math.max(qAt[k % N], q)
      qAt[(k + 1) % N] = Math.max(qAt[(k + 1) % N], q)
    }
  }
  // Un poco de suavizado: cada angulo toma el mayor de sus vecinos.
  const raw = qAt.slice()
  for (let k = 0; k < N; k++) qAt[k] = Math.max(raw[(k + N - 1) % N], raw[k], raw[(k + 1) % N])
  qAt[N] = qAt[0]
  const qA = Math.max(...qAt)
  const qB = Math.max(m.q[1], qA + 0.04)
  const qC = Math.max(m.q[2], qB + 0.12)
  // Las celdas del anillo. Los postes sueltos de la arena (+) quedan como
  // estan: marcan las puertas de los luchadores.
  const ring = new Uint8Array(W * H)
  const inner = Math.min(...qAt.subarray(0, N))
  for (let i = 0; i < W * H; i++) {
    const q = center(i)
    if (!walk[i] && kinds[i] !== 'wall' && q >= inner - 0.03 && q <= 0.985) ring[i] = 1
  }
  const boxes = []
  for (const { cells, far } of groups) {
    let [bx0, bx1, bz0, bz1] = [W, 0, H, 0]
    for (const i of cells) {
      const x = i % W
      const y = (i - x) / W
      bx0 = Math.min(bx0, x)
      bx1 = Math.max(bx1, x)
      bz0 = Math.min(bz0, y)
      bz1 = Math.max(bz1, y)
    }
    const box = { x0: bx0 * CX, x1: (bx1 + 1) * CX, z0: bz0 * CZ, z1: (bz1 + 1) * CZ }
    const cxb = (box.x0 + box.x1) / 2 - X0
    const czb = (box.z0 + box.z1) / 2 - Z0
    box.alongX = Math.abs(cxb / ax) > Math.abs(czb / az)
    box.sign = box.alongX ? Math.sign(cxb) : Math.sign(czb)
    box.tunnel = far > 0.93
    if (box.tunnel) {
      if (box.alongX) box[box.sign > 0 ? 'x1' : 'x0'] = box.sign * 1e4
      else box[box.sign > 0 ? 'z1' : 'z0'] = box.sign * 1e4
    }
    boxes.push(box)
  }
  // El radio del podio en un angulo cualquiera (entre dos de los N).
  const podium = (t) => {
    const f = ((((t % turn) + turn) % turn) / turn) * N
    const k = Math.floor(f)
    return qAt[k] + (qAt[k + 1] - qAt[k]) * (f - k)
  }
  return { ...m, qOf, qA, qAt, podium, N, qB, qC, ring, boxes }
}

// El anfiteatro: el podio con su pasamanos alrededor de la arena, nueve
// gradas con escaleras y un descanso al medio, el muro de afuera con tres
// pisos de arcos (ExtrudeGeometry de un Shape con agujeros, como el ejemplo
// de formas extruidas de three.js) y su galeria oscura detras, el publico en
// las gradas (las "o" del dibujo), estandartes, braseros y mastiles arriba.
function amphitheater(shop, plan, style, colors, decor) {
  const { X0, Z0, ax, az, qB, qC, boxes, qAt, podium } = plan
  const E = (q, t, y = 0) => [X0 + q * ax * Math.cos(t), y, Z0 + q * az * Math.sin(t)]
  const angleOf = (x, z) => Math.atan2((z - Z0) / az, (x - X0) / ax)
  const Hp = 2.7
  const rail = 0.75
  const lip = 0.012
  const tiers = 9
  const Hs = 8.2
  const Ho = 10.4
  const stepQ = (qC - qB) / tiers
  const rise = (Hs - Hp - 0.35) / tiers
  const tierH = (t) => Hp + rise * (t + 1) + (t >= tiers / 2 ? 0.35 : 0)
  const heightAt = (q, t) => {
    const qa = podium(t)
    if (q < qa) return 0
    if (q < qa + lip) return Hp + rail
    if (q < qB) return Hp
    if (q < qC) return tierH(Math.min(tiers - 1, Math.floor((q - qB) / stepQ)))
    return q <= 1 ? Ho : 0
  }
  const seat = [colors.trim.clone().multiplyScalar(0.94), colors.stone.clone().multiplyScalar(1.02)]
  const riser = colors.stone.clone().multiplyScalar(0.78)
  const stairs = colors.trim
  const inside = (x, z) => boxes.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)

  // El anillo, recortado donde se camina.
  shop.state.clip = clipper(boxes)
  const N = plan.N
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const b = ((i + 1) / N) * Math.PI * 2
    const mid = (a + b) / 2
    const out = [Math.cos(mid), 0, Math.sin(mid)]
    const into = [-out[0], 0, -out[2]]
    const [kx, , kz] = E(1, mid)
    const k = shop.at('stone', kx, kz)
    const wall = (q, y0, y1, color, face) =>
      k.face([E(q, a, y0), E(q, b, y0), E(q, b, y1), E(q, a, y1)], color, face)
    const flat = (q0, q1, y, color) =>
      k.face([E(q0, a, y), E(q0, b, y), E(q1, b, y), E(q1, a, y)], color, [0, 1, 0], false)
    // Podio: cara a la arena con el pasamanos, su tapa, su espalda y el paseo.
    // Su radio cambia con el angulo (qAt): sigue de cerca el borde de la arena.
    const pa = qAt[i]
    const pb = qAt[i + 1]
    const top = Hp + rail
    k.face([E(pa, a, 0), E(pb, b, 0), E(pb, b, top), E(pa, a, top)], colors.stone, into)
    k.face(
      [E(pa, a, top), E(pb, b, top), E(pb + lip, b, top), E(pa + lip, a, top)],
      colors.trim,
      [0, 1, 0],
      false
    )
    k.face(
      [E(pa + lip, a, Hp), E(pb + lip, b, Hp), E(pb + lip, b, top), E(pa + lip, a, top)],
      colors.stone,
      out
    )
    k.face(
      [E(pa + lip, a, Hp), E(pb + lip, b, Hp), E(qB, b, Hp), E(qB, a, Hp)],
      colors.walk,
      [0, 1, 0],
      false
    )
    // Gradas: contrahuella y huella; cada tanto una escalera mas clara.
    const stair = i % 12 === 0
    let prev = Hp
    for (let t = 0; t < tiers; t++) {
      const q0 = qB + stepQ * t
      const h = tierH(t)
      wall(q0, prev, h, stair ? stairs : riser, into)
      flat(q0, q0 + stepQ, h, stair ? stairs : seat[t % 2])
      prev = h
    }
    // El muro de afuera: su cara sobre las gradas y la tapa.
    wall(qC, prev, Ho, colors.stone, into)
    flat(qC, 1, Ho, colors.walk)
  }

  // La fachada: arcos repartidos parejo por largo de arco, con uno justo en
  // el tunel (ahi no va arco: pasa el camino).
  const fine = 2048
  const len = [0]
  for (let i = 1; i <= fine; i++) {
    const p = E(1, ((i - 1) / fine) * Math.PI * 2)
    const q = E(1, (i / fine) * Math.PI * 2)
    len.push(len[i - 1] + Math.hypot(q[0] - p[0], q[2] - p[2]))
  }
  const total = len[fine]
  const angleAt = (d) => {
    const v = ((d % total) + total) % total
    let lo = 0
    let hi = fine
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (len[m] < v) lo = m
      else hi = m
    }
    return ((lo + (v - len[lo]) / Math.max(1e-6, len[hi] - len[lo])) / fine) * Math.PI * 2
  }
  // Donde arranca el arco del tunel: el borde de su caja sobre la elipse.
  const tunnel = boxes.find((b) => b.tunnel)
  let start = 0
  let span = total
  if (tunnel && !tunnel.alongX) {
    const side = tunnel.sign
    const t0 = Math.atan2(
      side * Math.sqrt(Math.max(0, 1 - ((tunnel.x1 + 0.5 - X0) / ax) ** 2)),
      (tunnel.x1 + 0.5 - X0) / ax
    )
    const t1 = Math.atan2(
      side * Math.sqrt(Math.max(0, 1 - ((tunnel.x0 - 0.5 - X0) / ax) ** 2)),
      (tunnel.x0 - 0.5 - X0) / ax
    )
    const d0 = (((side > 0 ? t0 : t1) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
    const d1 = (((side > 0 ? t1 : t0) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
    start = len[Math.round(d1 * fine)]
    span = (len[Math.round(d0 * fine)] - start + total) % total
  }
  const bays = Math.max(12, Math.round(span / 3.6))
  const storey = 3
  const sh = 3
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < bays; i++) {
    const pa = E(1, angleAt(start + (span * i) / bays))
    const pb = E(1, angleAt(start + (span * (i + 1)) / bays))
    const t = new THREE.Vector3(pb[0] - pa[0], 0, pb[2] - pa[2])
    const w = t.length()
    t.normalize()
    const n = new THREE.Vector3(t.z, 0, -t.x)
    const mx = (pa[0] + pb[0]) / 2
    const mz = (pa[2] + pb[2]) / 2
    const k = shop.at('stone', mx, mz)
    const basis = new THREE.Matrix4().makeBasis(t, up, n.clone().negate())
    const P = (s2, y, d) => [mx + t.x * s2 + n.x * d, y, mz + t.z * s2 + n.z * d]
    const opening = w * 0.56
    for (let f = 0; f < storey; f++) {
      const shape = new THREE.Shape()
      const y0 = f * sh
      const spring = sh - 0.5 - opening / 2
      if (f === 0) {
        shape.moveTo(-w / 2 - 0.01, 0)
        shape.lineTo(-opening / 2, 0)
        shape.lineTo(-opening / 2, spring)
        shape.absarc(0, spring, opening / 2, Math.PI, 0, true)
        shape.lineTo(opening / 2, 0)
        shape.lineTo(w / 2 + 0.01, 0)
        shape.lineTo(w / 2 + 0.01, sh)
        shape.lineTo(-w / 2 - 0.01, sh)
        shape.closePath()
      } else {
        shape.moveTo(-w / 2 - 0.01, 0)
        shape.lineTo(w / 2 + 0.01, 0)
        shape.lineTo(w / 2 + 0.01, sh)
        shape.lineTo(-w / 2 - 0.01, sh)
        shape.closePath()
        const hole = new THREE.Path()
        hole.moveTo(-opening / 2, 0.55)
        hole.lineTo(opening / 2, 0.55)
        hole.lineTo(opening / 2, spring)
        hole.absarc(0, spring, opening / 2, 0, Math.PI, false)
        hole.lineTo(-opening / 2, 0.55)
        shape.holes.push(hole)
      }
      const frame = new THREE.ExtrudeGeometry(shape, {
        depth: 0.6,
        bevelEnabled: false,
        curveSegments: 10
      })
      frame.applyMatrix4(basis.clone().setPosition(mx, y0, mz))
      k.add(frame, colors.stone)
      // Pilastra en el borde del arco y cornisa arriba de cada piso.
      const [px, , pz] = P(-w / 2, 0, 0.07)
      k.obox(px, pz, t.x, t.z, 0.44, 0.16, y0, y0 + sh - 0.2, colors.trim, { grime: f === 0 })
      const [cx2, , cz2] = P(0, 0, 0.08)
      k.obox(cx2, cz2, t.x, t.z, w + 0.06, 0.28, y0 + sh - 0.22, y0 + sh, colors.trim, {
        grime: false,
        bottom: true
      })
      // La galeria detras: el piso de cada nivel.
      k.face(
        [
          P(-w / 2, y0 + 0.02, -0.6),
          P(w / 2, y0 + 0.02, -0.6),
          P(w / 2, y0 + 0.02, -2.2),
          P(-w / 2, y0 + 0.02, -2.2)
        ],
        colors.dark,
        [0, 1, 0],
        false
      )
    }
    // El fondo oscuro de la galeria y el atico liso con su cornisa.
    k.face(
      [
        P(-w / 2, 0, -2.2),
        P(w / 2, 0, -2.2),
        P(w / 2, storey * sh, -2.2),
        P(-w / 2, storey * sh, -2.2)
      ],
      colors.dark,
      [n.x, 0, n.z],
      false
    )
    k.face(
      [
        P(-w / 2 - 0.01, storey * sh, 0),
        P(w / 2 + 0.01, storey * sh, 0),
        P(w / 2 + 0.01, Ho, 0),
        P(-w / 2 - 0.01, Ho, 0)
      ],
      colors.stone,
      [n.x, 0, n.z],
      false
    )
    const [tx2, , tz2] = P(0, 0, 0.1)
    k.obox(tx2, tz2, t.x, t.z, w + 0.08, 0.32, Ho - 0.05, Ho + 0.22, colors.trim, {
      grime: false,
      bottom: true
    })
    // Un mastil cada tres arcos, con su banderola.
    if (i % 3 === 1) {
      const [mx2, , mz2] = P(0, 0, -0.5)
      shop
        .at('wood', mx2, mz2)
        .obox(mx2, mz2, t.x, t.z, 0.14, 0.14, Ho, Ho + 3.4, colors.wood, { grime: false })
      decor.banners.push({
        x: mx2,
        z: mz2,
        y: Ho + 3.3,
        along: [t.x, t.z],
        size: [1.1, 0.42],
        pennant: true
      })
    }
  }

  // El tunel: sus paredes siguen el corte del anillo (escalonadas como las
  // gradas). Las puertas de los luchadores: un nicho con portón de madera.
  shop.state.clip = null
  for (const box of boxes) {
    if (box.tunnel && !box.alongX) {
      for (const [x, face] of [
        [box.x0, 1],
        [box.x1, -1]
      ]) {
        const dx = (x - X0) / ax
        const inner = Math.min(...qAt)
        const zIn = Z0 + box.sign * az * Math.sqrt(Math.max(0, inner * inner - dx * dx))
        const zOut = Z0 + box.sign * az * Math.sqrt(Math.max(0, 1 - dx * dx))
        const steps = Math.max(2, Math.ceil(Math.abs(zOut - zIn) / 0.25))
        const k = shop.at('stone', x, (zIn + zOut) / 2)
        for (let j = 0; j < steps; j++) {
          const z0 = zIn + ((zOut - zIn) * j) / steps
          const z1 = zIn + ((zOut - zIn) * (j + 1)) / steps
          const zm = (z0 + z1) / 2
          const h = heightAt(plan.qOf(x, zm), angleOf(x, zm))
          if (h <= 0) continue
          k.face(
            [
              [x, 0, z0],
              [x, 0, z1],
              [x, h, z1],
              [x, h, z0]
            ],
            colors.stone,
            [face, 0, 0]
          )
        }
      }
      continue
    }
    if (box.tunnel || !box.alongX) continue
    const zc = (box.z0 + box.z1) / 2
    const dz = (zc - Z0) / az
    const qa = podium(Math.atan2(dz, box.sign))
    const xIn = X0 + box.sign * ax * Math.sqrt(Math.max(0, qa * qa - dz * dz))
    const back = box.sign > 0 ? box.x1 : box.x0
    const lo = Math.min(back, xIn)
    const hi = Math.max(back, xIn)
    const k = shop.at('stone', xIn, zc)
    for (const [z, face] of [
      [box.z0, 1],
      [box.z1, -1]
    ]) {
      k.face(
        [
          [lo, 0, z],
          [hi, 0, z],
          [hi, Hp, z],
          [lo, Hp, z]
        ],
        colors.stone,
        [0, 0, face]
      )
    }
    k.box(lo, Hp - 0.38, box.z0, hi + 0.05, Hp, box.z1, colors.stone, {
      bottom: true,
      top: colors.walk
    })
    // El pasamanos sigue sobre el nicho, del lado del podio.
    const r0 = box.sign > 0 ? xIn : xIn - 0.36
    k.box(r0, Hp, box.z0, r0 + 0.36, Hp + rail, box.z1, colors.stone, { top: colors.trim })
    shop
      .at('wood', back, zc)
      .box(back - 0.04, 0, box.z0 + 0.04, back + 0.04, Hp - 0.38, box.z1 - 0.04, colors.wood)
  }

  // Estandartes colgados del pasamanos, mirando a la arena, y braseros entre
  // ellos; no delante de un nicho ni del tunel.
  const count = 14
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) / count) * Math.PI * 2
    const p = E(podium(t) - 0.004, t)
    const near = (b) =>
      Math.abs(p[0] - (b.x0 + b.x1) / 2) < 3 && Math.abs(p[2] - (b.z0 + b.z1) / 2) < 3
    if (inside(p[0], p[2]) || boxes.some(near)) continue
    const tx = -Math.sin(t) * ax
    const tz = Math.cos(t) * az
    const l = Math.hypot(tx, tz)
    const out = [-Math.cos(t), -Math.sin(t)]
    decor.banners.push({
      x: p[0],
      z: p[2],
      y: Hp + rail - 0.06,
      along: [tx / l, tz / l],
      size: [0.85, 1.7],
      out
    })
    const tb = t + Math.PI / count
    const f = E(podium(tb) + lip / 2, tb)
    shop
      .at('wood', f[0], f[2])
      .box(
        f[0] - 0.14,
        Hp + rail,
        f[2] - 0.14,
        f[0] + 0.14,
        Hp + rail + 0.2,
        f[2] + 0.14,
        colors.iron,
        { bottom: true, grime: false }
      )
    decor.flames.push([f[0], Hp + rail + 0.38, f[2]])
  }
}

// El publico: una figura sentada en cada "o" de las gradas del dibujo,
// mirando a la arena, con la ropa de muchos colores.
function crowd(world, s, shop, plan) {
  const { kinds, CX, CZ } = world
  const { W, H } = s
  const { X0, Z0, ax, az, qB, qC, boxes } = plan
  const tiers = 9
  const stepQ = (qC - qB) / tiers
  const Hp = 2.7
  const rise = (8.2 - Hp - 0.35) / tiers
  const cloth = [
    0xb8362a, 0x2f5f9e, 0x3f7a3a, 0xc9a245, 0xe8e0d0, 0x7a3fa0, 0xd87a2a, 0x2a8a8a
  ].map((c) => new THREE.Color(c))
  const skin = [0xe8b896, 0xc68a62, 0x8a5a3a].map((c) => new THREE.Color(c))
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (kinds[y * W + x] !== 'rock') continue
      const cx = (x + 0.5) * CX
      const cz = (y + 0.5) * CZ
      const q = plan.qOf(cx, cz)
      if (q <= qB || q >= qC) continue
      const near = (b) => cx > b.x0 - 1 && cx < b.x1 + 1 && cz > b.z0 - 1 && cz < b.z1 + 1
      if (boxes.some(near)) continue
      const t = Math.min(tiers - 1, Math.floor((q - qB) / stepQ))
      const angle = Math.atan2((cz - Z0) / az, (cx - X0) / ax)
      const qm = qB + stepQ * (t + 0.55)
      const px = X0 + qm * ax * Math.cos(angle)
      const pz = Z0 + qm * az * Math.sin(angle)
      const h = Hp + rise * (t + 1) + (t >= tiers / 2 ? 0.35 : 0)
      const fx = X0 - px
      const fz = Z0 - pz
      const fl = Math.hypot(fx, fz) || 1
      const k = shop.at('paint', px, pz)
      const tint = cloth[Math.floor(hash(x, y) * cloth.length)]
      k.obox(px, pz, -fz / fl, fx / fl, 0.36, 0.26, h, h + 0.5, tint, { grime: false })
      const hx = px + (fx / fl) * 0.03
      const hz = pz + (fz / fl) * 0.03
      k.obox(
        hx,
        hz,
        -fz / fl,
        fx / fl,
        0.21,
        0.21,
        h + 0.5,
        h + 0.72,
        skin[Math.floor(hash(y, x) * skin.length)],
        { grime: false }
      )
    }
  }
}

// --- Materiales y armado ----------------------------------------------------

// Los colores de un mapa, en el espacio lineal en que pinta three.js.
function colorsFor(style, look) {
  const c = (hex) => new THREE.Color(hex)
  let roof = (look.roofs || [0xa8462c])[0]
  if (style.roof === 'pyramid') roof = look.slate || 0x56606e
  if (style.roof === 'spire') roof = 0x2b3448
  const banner = c(style.banner)
  return {
    stone: c(style.stone),
    walk: c(style.walk),
    trim: c(style.trim),
    dark: c(style.dark),
    roof: c(roof),
    wood: c(look.door || 0x6a4126),
    iron: c(0x2a2a30),
    banner,
    bannerDark: banner.clone().multiplyScalar(0.72),
    accent: c(style.accent),
    vein: c(look.vein || style.accent),
    white: c(0xffffff),
    // La otra raya de los toldos del mercado.
    canvas: c(style.canvas || 0xefe3c8),
    // Las dovelas que alternan con las claras en los arcos de los portones.
    voussoir: c(style.voussoir || style.stone),
    // La tabla de los carteles: el color de las letras (LOOSE.sign en
    // tripo-mundo.js).
    board: c(0xe0c060)
  }
}

// La muralla no tapa al heroe: la camara 2.5D mira desde el sur y arriba, y un
// paredon al sur del heroe lo esconde. Lo que queda entre la camara y el heroe,
// cerca de la linea que los une, se cala con un tramado (dither de Bayer 4x4):
// se ve a traves. El heroe esta donde mira la camara, a un metro del piso (la
// pagina apunta ahi), asi que sale de la propia camara: no hace falta pasarlo.
// tripo-mundo.js lo usa tambien para las casas y los modelos grandes.
// seeView.y es la altura de ese punto: la pagina lo sube cuando levanta lo que
// mira la camara (la pelea con el Coloso), asi el corte termina en el heroe y no
// metros detras de el.
export const seeView = { y: { value: 1 } }
// En un modelo con esqueleto (el Coloso animado) el punto sale despues de los
// huesos, asi el calado sigue la pose y no la de reposo.
export function seeThrough(shader) {
  shader.uniforms.seeY = seeView.y
  const posed = shader.vertexShader.includes('#include <skinning_vertex>')
    ? '#include <skinning_vertex>'
    : '#include <begin_vertex>'
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vCutAt;')
    .replace(posed, posed + '\nvCutAt = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;')
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec3 vCutAt;
      uniform float seeY;
      const float BAYER[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );`
    )
    .replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      vec3 ahead = -vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] );
      if ( ahead.y < -0.2 && vCutAt.y > 0.3 ) {
        vec3 hero = cameraPosition + ahead * ( ( seeY - cameraPosition.y ) / ahead.y );
        vec3 span = hero - cameraPosition;
        float along = clamp( dot( vCutAt - cameraPosition, span ) / dot( span, span ), 0.0, 1.0 );
        float left = ( 1.0 - along ) * length( span );
        float off = length( vCutAt - ( cameraPosition + span * along ) );
        if ( left > 0.35 && left < 9.0 ) {
          float keep = mix( 0.2, 1.0, smoothstep( 0.8, 1.5, off ) );
          ivec2 cell = ivec2( mod( gl_FragCoord.xy, 4.0 ) );
          if ( BAYER[ cell.x + cell.y * 4 ] / 16.0 >= keep ) discard;
        }
      }`
    )
}

// Un material por clase de pieza; las texturas son las mismas para todos los
// mapas (quedan en memoria), los materiales se liberan con el mapa. La piedra
// de NOX lleva las juntas encendidas y la de las ruinas grietas con lava.
// `plaza` es el piso dibujado del monumento, si el mapa lo tiene.
function materialsFor(style, look, clock, plaza) {
  const stone = stoneTextures()
  const roof = roofTextures()
  const wood = woodTextures()
  const rock = new THREE.MeshStandardMaterial({
    map: stone.map,
    normalMap: stone.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    vertexColors: true,
    roughness: 0.92
  })
  const glows = style.veins || style.cracks
  if (glows) {
    rock.emissive = new THREE.Color(
      style.veins ? look.vein || style.accent : look.glow || style.accent
    )
    rock.emissiveMap = glowTexture(style.veins ? 'veins' : 'cracks')
    rock.emissiveIntensity = style.veins ? 0.8 : 1.45
  }
  rock.onBeforeCompile = (shader) => {
    seeThrough(shader)
    // Solo brillan las caras paradas: el adarve y las tapas no, asi desde
    // arriba no se ve una grilla encendida.
    if (!glows) return
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float upright = abs( inverseTransformDirection( normalize( vNormal ), viewMatrix ).y );
      totalEmissiveRadiance *= 1.0 - smoothstep( 0.5, 0.8, upright );`
    )
  }
  const tiles = new THREE.MeshStandardMaterial({
    map: roof.map,
    normalMap: roof.normalMap,
    vertexColors: true,
    roughness: 0.78
  })
  tiles.onBeforeCompile = seeThrough
  return {
    stone: rock,
    roof: tiles,
    wood: new THREE.MeshStandardMaterial({
      map: wood.map,
      normalMap: wood.normalMap,
      vertexColors: true,
      roughness: 0.82
    }),
    cloth: clothMaterial(clock),
    fence: new THREE.MeshStandardMaterial({
      map: ironFence(),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      color: 0x2a2734,
      metalness: 0.5,
      roughness: 0.5
    }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    // Color liso, sin textura: el publico del coliseo, lo que se vende.
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    plaza: plaza
      ? new THREE.MeshStandardMaterial({ map: plaza, vertexColors: true, roughness: 0.6 })
      : null
  }
}

// El nombre escrito adentro de una torre cerrada ("torre nox"): queda tapado
// por la torre, asi que se lee de las letras del mapa y va en un cartel.
function keepNames(world, s) {
  const { letters, CX, CZ } = world
  const { W } = s
  const names = []
  for (const cells of s.keeps) {
    const mine = new Set(cells)
    const rows = new Map()
    let sx = 0
    let sz = 0
    for (const i of cells) {
      const x = i % W
      const y = (i - x) / W
      sx += x
      sz += y
      if (!rows.has(y)) rows.set(y, [x, x])
      const r = rows.get(y)
      r[0] = Math.min(r[0], x)
      r[1] = Math.max(r[1], x)
    }
    let best = ''
    for (const [y, [x0, x1]] of rows) {
      let line = ''
      for (let x = x0; x <= x1; x++) {
        const ch = (letters[y] || '')[x] || ' '
        line += mine.has(y * W + x) && /[a-z ]/.test(ch) ? ch : '|'
      }
      for (const word of line.match(/[a-z]+( [a-z]+)*/g) || []) {
        if (word.length > best.length) best = word
      }
    }
    if (best.length >= 4) {
      names.push({
        name: best,
        cells,
        x: (sx / cells.length + 0.5) * CX,
        z: (sz / cells.length + 0.5) * CZ
      })
    }
  }
  return names
}

// Lo que fortress() (tripo-mundo.js) arma en el porton de un castillo: el
// edificio que tiene un lado de 30 m o mas, el hueco de 1,5 m de medio ancho
// con jambas de 0,42 hundido 0,95 m, el arco que arranca dos pisos arriba y la
// torre del porton de tres pisos y 3,5 m de medio ancho. Si cambia alla,
// cambiar aca.
const CASTLE = { side: 30, half: 1.5, jamb: 0.42, deep: 0.95, block: 3.5, base: 0.8 }

// El porton de un castillo es una puerta del edificio (lo arma fortress()),
// no de una muralla. Aca se le suma lo que tiene un porton: antorchas a los
// lados, el rastrillo subido en el hueco del arco y dos estandartes en la
// torre. Devuelve, por cada uno, su clave 'x,y' y a que altura va el nombre.
function castleGates(world, s, shop, colors, decor) {
  const { data, doors, inBuilding, palette, CX, CZ } = world
  const { W, H } = s
  const found = []
  for (const door of doors) {
    const tile = data.tiles[door.ch]
    if (!tile || !tile.id.startsWith('gate.')) continue
    const box = buildingAround(door, inBuilding, W, H)
    if (!box) continue
    const rect = {
      x0: box.x0 * CX + 0.25,
      x1: (box.x1 + 1) * CX - 0.25,
      z0: box.y0 * CZ + 0.25,
      z1: (box.y1 + 1) * CZ - 0.25
    }
    if (Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0) < CASTLE.side) continue
    // De que lado del edificio esta (como doorway() de tripo-mundo.js).
    const gaps = [
      (box.y1 - door.y) * CZ,
      (door.y - box.y0) * CZ,
      (box.x1 - door.x) * CX,
      (door.x - box.x0) * CX
    ]
    const side = gaps.indexOf(Math.min(...gaps))
    if (Math.abs(gaps[side]) > 1) continue
    const cx = (door.x + 0.5) * CX
    const cz = (door.y + 0.5) * CZ
    // La fachada: o en el plano, t a lo largo y n hacia afuera.
    const frames = [
      { o: [cx, rect.z1], t: [1, 0], n: [0, 1] },
      { o: [cx, rect.z0], t: [-1, 0], n: [0, -1] },
      { o: [rect.x1, cz], t: [0, -1], n: [1, 0] },
      { o: [rect.x0, cz], t: [0, 1], n: [-1, 0] }
    ]
    const { o, t, n } = frames[side]
    const P = (u, y, d) => [o[0] + t[0] * u + n[0] * d, y, o[1] + t[1] * u + n[1] * d]
    const F = palette.floor || 2.8
    const { half, jamb, deep, block, base } = CASTLE
    const spring = base + 2 * F - 0.3 - half - jamb
    const top = base + 3 * F
    const wood = shop.at('wood', cx, cz)
    torches(wood, (u, y, v) => P(u, y, v), half + jamb + 0.45, 0.02, 1, colors, decor)
    // El rastrillo subido: los barrotes asoman bajo el arco, delante de la hoja.
    const grille = -Math.min(0.35, deep * 0.4)
    const low = spring + 0.35
    for (let u = -half + 0.16; u <= half - 0.16 + 1e-6; u += 0.25) {
      const crown = spring + Math.sqrt(Math.max(0, half * half - u * u)) - 0.02
      if (crown - low < 0.1) continue
      const a = P(u - 0.025, 0, grille - 0.025)
      const b = P(u + 0.025, 0, grille + 0.025)
      wood.box(
        Math.min(a[0], b[0]),
        low - 0.14,
        Math.min(a[2], b[2]),
        Math.max(a[0], b[0]),
        crown,
        Math.max(a[2], b[2]),
        colors.iron,
        { bottom: true, grime: false }
      )
    }
    for (const y of [low + 0.12, low + 0.52]) {
      const reach = Math.sqrt(Math.max(0, half * half - (y - spring) * (y - spring))) - 0.04
      if (reach <= 0.2) continue
      const a = P(-reach, 0, grille - 0.035)
      const b = P(reach, 0, grille + 0.035)
      wood.box(
        Math.min(a[0], b[0]),
        y,
        Math.min(a[2], b[2]),
        Math.max(a[0], b[0]),
        y + 0.06,
        Math.max(a[2], b[2]),
        colors.iron,
        { bottom: true, grime: false }
      )
    }
    // Los estandartes, colgados bajo el adarve de las murallas a los dos lados
    // de la torre del porton: la enmarcan.
    for (const u of [-1, 1]) {
      const [bx, , bz] = P(u * (block + 1.1), 0, 0.12)
      decor.banners.push({
        x: bx,
        z: bz,
        y: base + 2 * F - 0.32,
        along: [t[0], t[1]],
        size: [1, 3],
        out: [n[0], n[1]]
      })
    }
    // El nombre va sobre las almenas de la torre: la celda de la puerta queda
    // detras de la fachada y mas abajo lo taparia la pared.
    found.push({ key: door.x + ',' + door.y, label: top + 0.9 + 0.75 })
  }
  return found
}

// La caja del edificio pegado a una puerta: las celdas de edificio unidas a
// sus vecinas (inBuilding de tripo-mundo.js).
function buildingAround(door, inBuilding, W, H) {
  const starts = SIDES.map(([dx, dy]) => [door.x + dx, door.y + dy]).filter(
    ([x, y]) => x >= 0 && y >= 0 && x < W && y < H && inBuilding[y * W + x]
  )
  if (!starts.length) return null
  const seen = new Uint8Array(W * H)
  const stack = starts.map(([x, y]) => y * W + x)
  for (const i of stack) seen[i] = 1
  const box = { x0: W, y0: H, x1: 0, y1: 0 }
  while (stack.length) {
    const i = stack.pop()
    const x = i % W
    const y = (i - x) / W
    box.x0 = Math.min(box.x0, x)
    box.x1 = Math.max(box.x1, x)
    box.y0 = Math.min(box.y0, y)
    box.y1 = Math.max(box.y1, y)
    for (const [dx, dy] of SIDES) {
      const nx = x + dx
      const ny = y + dy
      const j = ny * W + nx
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[j] || !inBuilding[j]) continue
      seen[j] = 1
      stack.push(j)
    }
  }
  return box
}

// Las torres a los lados de cada porton, si entran; no si ya hay una torre
// cerrada pegada (las de las fronteras).
function flankTowers(world, s, gates, style, towers) {
  const { CX, CZ } = world
  const { W, H, mass } = s
  const keepNear = (x, z, d) => {
    for (let y = Math.floor(z - d); y <= Math.ceil(z + d); y++) {
      for (let xx = Math.floor((x - d) / CX); xx <= Math.ceil((x + d) / CX); xx++) {
        if (xx < 0 || y < 0 || xx >= W || y >= H || mass[y * W + xx] !== 3) continue
        if (Math.hypot((xx + 0.5) * CX - x, (y + 0.5) * CZ - z) < d) return true
      }
    }
    return false
  }
  for (const g of gates) {
    if (style.ruined) continue
    const at = gateFrame(g)
    // Un porton que se cruza lleva las torres en la cara de afuera, asi no
    // tapan el arco desde adentro; uno ciego, a los costados del bloque.
    const out = g.face ? -g.face : g.outer
    const mid = g.face ? (g.v0 + g.v1) / 2 : out > 0 ? g.v1 - 0.6 : g.v0 + 0.6
    for (const side of [-1, 1]) {
      const u = g.face ? (side > 0 ? g.u1 + 0.5 : g.u0 - 0.5) : side * (g.arch / 2 + 2.7)
      const [x, , z] = at(u, 0, mid)
      if (keepNear(x, z, 3.2)) continue
      // Si no entra en su lugar, prueba correrse hacia afuera del porton o
      // hacia su frente.
      const [ax, , az] = at(u + side, 0, mid)
      const [bx, , bz] = at(u, 0, mid + out)
      const aside = [ax - x, az - z]
      const ahead = [bx - x, bz - z]
      const [first, then] = g.face ? [aside, ahead] : [ahead, aside]
      const site =
        towerSite(world, s, towers, x, z, 2, first) || towerSite(world, s, towers, x, z, 2, then)
      if (site) towers.push({ ...site, h: g.top + 1.8, gate: g })
    }
  }
}

// El bloque de un porton (o de un portico) lo dibuja el porton: para la masa
// esas celdas son fantasma, de la altura del bloque.
function ghostBlock(grid, g) {
  for (let j = g.j0; j <= g.j1; j++) {
    for (let i = g.i0; i <= g.i1; i++) {
      const gx = (g.along === 'x' ? i : j) + PAD_X
      const gy = (g.along === 'x' ? j : i) + PAD_Z
      if (gx < 0 || gy < 0 || gx >= grid.GW || gy >= grid.GH) continue
      const q = gy * grid.GW + gx
      grid.gm[q] = grid.gm[q] || 1
      grid.gh[q] = g.top
      grid.ghost[q] = 1
    }
  }
}

export function buildRamparts(world) {
  const { data, palette: look, group } = world
  const style = STYLES[data.id] || STYLES.city
  const s = survey(world, style)
  // El monumento de la plaza toma su dibujo: esas paredes no son cerco.
  const monument = monumentGrid(world, s)
  if (monument) for (let i = 0; i < s.N; i++) if (monument.cells[i]) s.low[i] = 0
  // El anillo del coliseo lo dibuja el anfiteatro, no la muralla comun.
  const plan = data.id === 'coliseum' ? arenaPlan(world, s) : null
  if (plan) {
    for (let i = 0; i < s.N; i++) {
      if (!plan.ring[i]) continue
      s.mass[i] = 0
      s.low[i] = 0
    }
  }
  // Los puestos del mercado salen de los cercos bajos: los arma stallGeometry.
  const stalls = findStalls(world, s)
  // Los carteles sueltos: postes en los corchetes y tabla entre las palabras;
  // y los bancos de las plazas.
  const signs = findSigns(world, s)
  const benches = findBenches(world, s)
  const empty = !s.mass.some((v) => v) && !s.low.some((v) => v)
  const extras = stalls.length + signs.length + benches.length
  if (empty && !monument && !plan && !extras) return null
  const grid = padded(s)
  const gates = findGates(world, s, style)
  const porches = findOpenings(world, s, style)
  for (const g of [...gates, ...porches]) ghostBlock(grid, g)
  const towers = []
  flankTowers(world, s, gates, style, towers)
  const turrets = placeTowers(world, s, grid, [...gates, ...porches], style, towers)
  const blocked = (x, z) =>
    towers.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 0.45) ||
    turrets.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 0.35)

  const clock = { value: 0 }
  const colors = colorsFor(style, look)
  const shop = workshop(data.width * world.CX, data.height * world.CZ)
  massGeometry(world, grid, shop, style, colors, blocked)
  const roofs = keepRoofs(world, s, shop, style, colors)
  const flags = []
  for (const t of towers) {
    const top = tower(shop, t, style, colors, flags)
    if (t.gate) t.gate.peak = Math.max(t.gate.peak || 0, top)
  }
  for (const t of turrets) {
    roundTower(shop, { ...t, base: t.h - 0.9, h: t.h + 1.5 }, style, colors, null)
  }
  const decor = { flames: [], banners: [] }
  for (const g of [...gates, ...porches]) gatehouse(shop, g, style, colors, decor)
  const castles = castleGates(world, s, shop, colors, decor)
  lowWalls(world, s, shop, style, colors)
  for (const st of stalls) stallGeometry(world, s, shop, st, colors)
  for (const sign of signs) signGeometry(world, shop, sign, colors)
  for (const bench of benches) benchGeometry(world, shop, bench, colors)
  if (monument) {
    // Piedra clara y pulida: el pedestal del heroe, con su piso de marmol.
    const marble = { ...colors, stone: colors.trim, walk: colors.trim.clone().multiplyScalar(0.92) }
    const paving = monument.box ? monumentPaving(monument.box) : null
    massGeometry(world, monument.grid, shop, style, marble, () => false, paving)
  }
  if (plan) {
    amphitheater(shop, plan, style, colors, decor)
    crowd(world, s, shop, plan)
  }
  for (const b of [...decor.banners, ...flags]) banner(shop, b, colors)

  // Una malla por material y por trozo. La raiz no la libera tripo-mundo.js
  // (shared): la libera dispose(), sin tocar las texturas compartidas. Lo que
  // casi no da sombra (telas, colores lisos, rejas, venas) no se dibuja otra
  // vez en el mapa de sombras: es una llamada menos por cuadro.
  const plaza = monument && monument.box ? plazaTexture(monument.box, monument.center) : null
  const materials = materialsFor(style, look, clock, plaza)
  const root = new THREE.Group()
  root.userData.shared = true
  const shadows = new Set(['stone', 'roof', 'wood'])
  for (const { material, kit: k } of shop.bins.values()) {
    if (!k.count()) continue
    const mesh = new THREE.Mesh(k.build(), materials[material])
    mesh.name = 'murallas:' + material
    mesh.castShadow = shadows.has(material)
    mesh.receiveShadow = material !== 'glow'
    root.add(mesh)
  }
  const flames = flameMesh(decor.flames, style, clock)
  if (flames) root.add(flames)
  group.add(root)

  // El nombre de las torres cerradas, arriba de cada una (y de su techo).
  if (world.label) {
    for (const keep of keepNames(world, s)) {
      const tag = world.label(keep.name)
      tag.position.set(keep.x, (roofs.get(keep.cells) || style.curtain + 3) + 1.2, keep.z)
      group.add(tag)
    }
  }

  const cells = new Uint8Array(s.N)
  for (let i = 0; i < s.N; i++) {
    const art = (monument && monument.cells[i]) || (plan && plan.ring[i])
    cells[i] = s.mass[i] || s.low[i] || art ? 1 : 0
  }
  // Del puesto se toma todo menos las letras del cartel, que siguen siendo
  // las de tripo-mundo.js.
  for (const st of stalls) for (const i of st.cells) if (world.kinds[i] !== 'sign') cells[i] = 1
  for (const { y, a, b } of [...signs, ...benches]) {
    for (let x = a; x <= b; x++) {
      const i = y * s.W + x
      if (world.kinds[i] !== 'sign') cells[i] = 1
    }
  }
  // A que altura va el nombre de cada porton: sobre su bloque y sus torres;
  // en el de un castillo, sobre las almenas.
  const lift = new Map(castles.map((c) => [c.key, c.label]))
  for (const g of gates) {
    lift.set(g.key, Math.max(g.top + BREAST + MERLON_H + 1.3, (g.peak || 0) + 0.9))
  }
  return {
    skip: new Set(['rampart', 'wall', 'masonry']),
    cells,
    gates: new Set(lift.keys()),
    labelHeight(door) {
      return lift.get(door.x + ',' + door.y) || null
    },
    update(time) {
      clock.value = time
    },
    dispose() {
      root.traverse((node) => {
        if (node.geometry) node.geometry.dispose()
      })
      if (flames) flames.material.dispose()
      for (const material of Object.values(materials)) if (material) material.dispose()
    }
  }
}
