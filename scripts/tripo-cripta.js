// La cripta en 3D: los tres pisos de lib/dungeon.js (las cisternas del limo, las
// galerias del osario y la necropolis de la corona) armados con piezas hechas en
// codigo y los modelos libres de KayKit (assets/cc0/kaykit-dungeon).
//
// Es un lugar de adentro de la pradera (pradera.js addPlace): cryptPlace(PARTS)
// devuelve { mode: 'dungeon', data, landmarks, hint }. data() trae el plano de
// lugares.js cryptData con `build`, asi tripo-mundo.js buildWorld no arma
// terreno, murallas ni la paleta de la ciudad y devuelve lo de aca:
//
//   group, toWorld(x, y), blocks, terrainHeight(x, z), update(t), dispose(),
//   colossus() (null), loading (los modelos de KayKit) y crypt (lo que usa
//   landmarks: las luces, el sello, las medidas)
//
// Lo fijo se arma una vez por piso: el piso de losas, las paredes de roca (solo
// las caras que dan a algo que se pisa, con el borde de arriba y la roca honda
// como una tapa oscura, sin techo), las escaleras con su alto por fila, el agua,
// los puentes, las tumbas, los huesos, el trono y la rotonda. La luz de las
// antorchas queda horneada en los vertices (con la vista de celda a celda, asi
// no cruza la roca) y las cuatro antorchas mas cercanas al heroe (dos en un
// celular) suman una luz de verdad que tiembla. Las llamas van todas en una
// malla y los modelos de KayKit en InstancedMesh, uno por modelo.
//
// Lo que cambia en la partida se lee del Field en cada cuadro (landmarks): el
// sello de la escalera de bajada (remaining), los carteles y el trono vacio.
// Los monstruos y el combate son los de la pradera (Crowd, Effects).
import * as THREE from 'three'
import { cryptData, cryptHeights, cryptLights, cryptSees, CRYPT } from './lugares.js'
import { labels } from './mundo.js'

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { document, performance } = globalThis

// El aspecto de cada piso: la piedra de las paredes y del piso, el borde, el
// musgo, las antorchas (llama de afuera y de adentro, y su luz), los braseros,
// el agua, el acento de las runas y los estandartes de KayKit.
const LOOKS = {
  1: {
    wall: 0x7f897c,
    floor: 0x6e766a,
    trim: 0x4c574e,
    moss: 0x56703c,
    flame: [0xffd27a, 0xff6a1a],
    torch: 0xffa458,
    brazier: [0xf0ffb0, 0xa0d040],
    brazierLight: 0xe8e49a,
    water: 0x0f3a30,
    rune: 0x7cff9a,
    banners: []
  },
  2: {
    wall: 0x968a76,
    floor: 0x80755f,
    trim: 0x5e5446,
    moss: 0x6a5a40,
    flame: [0xffd27a, 0xff5a1a],
    torch: 0xff9a48,
    brazier: [0xffd27a, 0xff5a1a],
    brazierLight: 0xffa050,
    water: 0x1e2a26,
    rune: 0xff6a3a,
    banners: ['banner_thin_red']
  },
  3: {
    wall: 0x746e80,
    floor: 0x6c6678,
    trim: 0x4a4458,
    moss: 0x5a5068,
    flame: [0xffe08a, 0xff6a1a],
    torch: 0xffaa60,
    brazier: [0xc8ffb0, 0x30d060],
    brazierLight: 0x70ff9a,
    water: 0x1a1a2a,
    rune: 0xc89aff,
    marble: 0xc4bcd4,
    gold: 0xd8a838,
    banners: ['banner_patternA_red', 'banner_triple_red']
  }
}
const IRON = 0x34343a
const BONE = 0xe2dac2
const KAYKIT = 'kaykit-dungeon/'
// KayKit mide la pared en 4 unidades; aca mide CRYPT.wall.
const KK = CRYPT.wall / 4

// Cuanta luz da cada fuente fija y hasta donde: intensidad, radio suave y
// radio maximo, en metros.
const SOURCES = {
  torch: [2.1, 2.2, 9],
  brazier: [2.4, 2.4, 9.5],
  throne: [2.2, 2.4, 9],
  arch: [2.4, 3.2, 11]
}
// La luz que queda lejos de toda antorcha, para que la roca no sea negra pura.
const AMBIENT = [0.028, 0.026, 0.03]

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

// ---------------------------------------------------------------------------
// La textura: un atlas de 1024 x 512 pintado una vez. Cada region va en
// [u0, v0, u1, v1] (v crece hacia arriba, como las UV de three.js).
//   brick  la pared: 2 m de largo por todo el alto
//   flag   una losa del piso de 1 x 1 m con su junta
//   rough  piedra sin labrar (escalones, tapas, tumbas)
//   plain  casi blanco, para lo que pone el color en el vertice (hueso, oro)

const REGION = {
  brick: [0, 0, 0.5, 1],
  flag: [0.5, 0.5, 0.75, 1],
  rough: [0.75, 0.5, 1, 1],
  plain: [0.5, 0, 1, 0.5]
}
// Un margen adentro de cada region para que los mipmaps no mezclen vecinas.
const INSET = 3 / 1024

let atlas = null
function cryptAtlas() {
  if (atlas) return atlas
  const W = 1024
  const H = 512
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  let seed = 9173
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed / 4294967296
  }
  const grey = (v) => `rgb(${v},${v},${v})`
  const speckle = (x0, y0, w, h, count, lo, hi, size = 2) => {
    for (let i = 0; i < count; i++) {
      const v = Math.round(lo + rand() * (hi - lo))
      g.fillStyle = `rgba(${v},${v},${v},0.35)`
      const s = size * (0.5 + rand())
      g.fillRect(x0 + rand() * w, y0 + rand() * h, s, s)
    }
  }
  // La pared: hiladas de bloques de alto parecido y largo distinto, con la
  // junta oscura; se repite a lo ancho sin costura.
  g.fillStyle = grey(52)
  g.fillRect(0, 0, 512, 512)
  const courses = [0, 46, 108, 172, 238, 302, 366, 430, 512]
  for (let c = 0; c < courses.length - 1; c++) {
    const top = courses[c]
    const bottom = courses[c + 1]
    let x = -rand() * 120
    while (x < 512) {
      const w = 70 + rand() * 110
      const v = Math.round(150 + rand() * 70)
      for (const shift of [0, -512, 512]) {
        g.fillStyle = grey(v)
        g.fillRect(x + shift + 3, top + 3, w - 6, bottom - top - 6)
        // Un borde mas claro arriba y uno mas oscuro abajo: el bloque sobresale.
        g.fillStyle = 'rgba(255,255,255,0.10)'
        g.fillRect(x + shift + 3, top + 3, w - 6, 5)
        g.fillStyle = 'rgba(0,0,0,0.16)'
        g.fillRect(x + shift + 3, bottom - 9, w - 6, 6)
      }
      x += w
    }
  }
  speckle(0, 0, 512, 512, 1500, 40, 240)
  // Las losas: una piedra con la junta alrededor y alguna grieta.
  g.fillStyle = grey(46)
  g.fillRect(512, 0, 256, 256)
  g.fillStyle = grey(196)
  g.fillRect(512 + 7, 7, 242, 242)
  g.fillStyle = 'rgba(255,255,255,0.08)'
  g.fillRect(512 + 7, 7, 242, 8)
  speckle(512 + 7, 7, 242, 242, 500, 90, 250)
  g.strokeStyle = 'rgba(30,30,30,0.45)'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(512 + 60, 40)
  g.lineTo(512 + 92, 96)
  g.lineTo(512 + 84, 150)
  g.moveTo(512 + 92, 96)
  g.lineTo(512 + 140, 120)
  g.stroke()
  // Piedra sin labrar.
  g.fillStyle = grey(168)
  g.fillRect(768, 0, 256, 256)
  speckle(768, 0, 256, 256, 800, 70, 240, 3)
  // Casi blanco.
  g.fillStyle = grey(236)
  g.fillRect(512, 256, 512, 256)
  speckle(512, 256, 512, 256, 300, 200, 255)
  // El grano: un cuadro de ruido de 128 px (sin leer el lienzo) pintado encima
  // de todo el atlas.
  const grain = document.createElement('canvas')
  grain.width = 128
  grain.height = 128
  const gg = grain.getContext('2d')
  const image = gg.createImageData(128, 128)
  for (let i = 0; i < image.data.length; i += 4) {
    const v = rand() < 0.5 ? 0 : 255
    image.data[i] = v
    image.data[i + 1] = v
    image.data[i + 2] = v
    image.data[i + 3] = Math.round(rand() * 26)
  }
  gg.putImageData(image, 0, 0)
  for (let y = 0; y < H; y += 128) {
    for (let x = 0; x < W; x += 128) g.drawImage(grain, x, y)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  atlas = texture
  return atlas
}

// Una sub-region: la parte [a, b] x [c, d] (de 0 a 1) de una region.
function sub(region, a, b, c, d) {
  const [u0, v0, u1, v1] = region
  const w = u1 - u0 - 2 * INSET
  const h = v1 - v0 - 2 * INSET
  return [u0 + INSET + a * w, v0 + INSET + c * h, u0 + INSET + b * w, v0 + INSET + d * h]
}

// ---------------------------------------------------------------------------
// Los materiales. La luz horneada va en el color del vertice (o de la
// instancia) y se suma como luz propia sobre el color de la piedra: asi las
// luces de verdad (las antorchas cercanas, el hemisferio) iluminan la piedra
// por su color y no por lo oscura que quedo.

function bakedMaterial(options = {}, clock = null) {
  const material = new THREE.MeshStandardMaterial({
    map: cryptAtlas(),
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    ...options
  })
  material.onBeforeCompile = (shader) => {
    if (clock) shader.uniforms.clock = clock
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 albedo;\nvarying vec3 vAlbedo;\nvarying vec2 vPlace;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvAlbedo = albedo;\nvPlace = (modelMatrix * vec4(transformed, 1.0)).xz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vAlbedo;\nvarying vec2 vPlace;' +
          (clock ? '\nuniform float clock;' : '')
      )
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vAlbedo;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vColor.rgb;' +
          // El agua: ondas largas que se mueven, con su brillo propio (el del
          // limo en las cisternas) y la luz de las antorchas temblando encima.
          (clock
            ? '\nfloat wave = sin(vPlace.x * 1.7 + clock * 0.9 + sin(vPlace.y * 1.1 + clock * 0.5) * 1.6);' +
              '\nwave = wave * 0.5 + 0.5;' +
              '\ntotalEmissiveRadiance += vAlbedo * (0.45 + 0.55 * wave) + vColor.rgb * 0.3 * wave;'
            : '')
      )
  }
  material.customProgramCacheKey = () => (clock ? 'runa-crypt-water' : 'runa-crypt-stone')
  return material
}

// Un modelo de KayKit con la luz horneada en el color de cada instancia.
function propMaterial(source) {
  const material = source.clone()
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance += diffuseColor.rgb * vColor.rgb;\n#endif'
      )
  }
  material.customProgramCacheKey = () => 'runa-crypt-prop'
  return material
}

// Un punto suave para los halos de las llamas y el polvo.
function softDot() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const g = canvas.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// La luz que baja por la escalera de subida: blanca arriba, nada abajo.
function beamTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 128
  const g = canvas.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.3)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// El sello de runas sobre la escalera de bajada: un circulo con signos.
function sealTexture(color) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const g = canvas.getContext('2d')
  g.fillStyle = '#000'
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = color
  g.fillStyle = color
  g.lineWidth = 5
  for (const r of [112, 86]) {
    g.beginPath()
    g.arc(128, 128, r, 0, Math.PI * 2)
    g.stroke()
  }
  // Doce runas de trazos rectos (sin letras: la fuente de las runas no esta
  // en todas las maquinas y buscarla demora el primer piso).
  g.lineWidth = 3
  g.lineCap = 'round'
  const strokes = [
    [0, -1, 0, 1, 0, -1, 0.6, -0.4, 0.6, -0.4, 0, 0.1],
    [-0.4, -1, -0.4, 1, -0.4, -1, 0.5, -0.3, 0.5, -0.3, 0.5, 1],
    [0, -1, 0, 1, -0.5, -0.3, 0.5, 0.3],
    [0, -1, 0, 1, 0, -0.8, 0.6, -0.3, 0, -0.2, 0.6, 0.3],
    [0, -1, 0, 1, -0.6, -0.6, 0, 0, 0.6, -0.6, 0, 0],
    [-0.6, 1, 0, 0, 0.6, 1, 0, 0, 0, 0, -0.5, -0.6, -0.5, -0.6, 0.5, -0.6]
  ]
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const rune = strokes[i % strokes.length]
    g.save()
    g.translate(128 + Math.cos(a) * 99, 128 + Math.sin(a) * 99)
    g.rotate(a + Math.PI / 2)
    g.scale(i % 2 ? -8 : 8, 8)
    g.lineWidth = 3 / 8
    g.beginPath()
    for (let k = 0; k < rune.length; k += 4) {
      g.moveTo(rune[k], rune[k + 1])
      g.lineTo(rune[k + 2], rune[k + 3])
    }
    g.stroke()
    g.restore()
  }
  // Una estrella de cinco puntas en el medio.
  g.lineWidth = 4
  g.beginPath()
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + ((i * 2) % 5) * ((Math.PI * 2) / 5)
    const x = 128 + Math.cos(a) * 70
    const y = 128 + Math.sin(a) * 70
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// ---------------------------------------------------------------------------
// El albanil: junta cuadrados y piezas en una sola geometria con posicion,
// normal, UV del atlas, el color de la piedra (albedo) y, al final, la luz
// horneada (color). La luz se calcula en muestras: una por esquina de cada
// cuadrado y una sola por pieza (su centro), y cada vertice toma la de su
// muestra. Cada muestra recuerda su celda libre (desde donde se ve la luz) y
// cuanto envuelve la luz (wrap: 0 para la piedra, mas para las piezas redondas
// que reciben luz de costado).

const E1 = new THREE.Vector3()
const E2 = new THREE.Vector3()
const NV = new THREE.Vector3()
const V = new THREE.Vector3()
const MAT = new THREE.Matrix4()
const NORMAL = new THREE.Matrix3()
const ROT = new THREE.Quaternion()
const EULER = new THREE.Euler()
const SCALE = new THREE.Vector3()
const Y_UP = new THREE.Vector3(0, 1, 0)

// Las formas de base (caja, cilindro, bola, cono) de tamano 1, sin indice, una
// vez por pagina: cada pieza las copia con su matriz.
const SHAPES = new Map()
function shape(key, make) {
  if (!SHAPES.has(key)) {
    const made = make()
    const g = made.index ? made.toNonIndexed() : made
    SHAPES.set(key, {
      pos: g.attributes.position.array.slice(),
      nrm: g.attributes.normal.array.slice(),
      uv: g.attributes.uv ? g.attributes.uv.array.slice() : null
    })
    if (g !== made) g.dispose()
    made.dispose()
  }
  return SHAPES.get(key)
}

class Mason {
  constructor() {
    this.p = []
    this.n = []
    this.uv = []
    this.a = []
    this.at = []
    // Las muestras de luz: posicion, normal, celda y wrap.
    this.sp = []
    this.sn = []
    this.cell = []
    this.wrap = []
  }

  sample(x, y, z, nx, ny, nz, cell, wrap) {
    this.sp.push(x, y, z)
    this.sn.push(nx, ny, nz)
    this.cell.push(cell)
    this.wrap.push(wrap)
    return this.cell.length - 1
  }

  vertex(x, y, z, nx, ny, nz, u, v, color, sample) {
    this.p.push(x, y, z)
    this.n.push(nx, ny, nz)
    this.uv.push(u, v)
    this.a.push(color.r, color.g, color.b)
    this.at.push(sample)
  }

  // Un cuadrado a, b, c, d (en orden alrededor) que mira hacia n. La UV va de
  // [u0, v0] en a a [u1, v1] en c.
  quad(a, b, c, d, n, uv, color, cell, wrap = 0) {
    E1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    E2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    NV.crossVectors(E1, E2)
    const [u0, v0, u1, v1] = uv
    let tb = [u1, v0]
    let td = [u0, v1]
    if (NV.x * n[0] + NV.y * n[1] + NV.z * n[2] < 0) {
      ;[b, d] = [d, b]
      ;[tb, td] = [td, tb]
    }
    const points = [a, b, c, d]
    const uvs = [[u0, v0], tb, [u1, v1], td]
    const corners = points.map((p) => this.sample(p[0], p[1], p[2], n[0], n[1], n[2], cell, wrap))
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = points[i]
      this.vertex(p[0], p[1], p[2], n[0], n[1], n[2], uvs[i][0], uvs[i][1], color, corners[i])
    }
  }

  // Una forma de base llevada por la matriz `m`, con su UV en una region del
  // atlas y una sola muestra de luz en su centro.
  form(base, m, color, cell, region, wrap) {
    NORMAL.getNormalMatrix(m)
    V.set(0, 0, 0).applyMatrix4(m)
    const s = this.sample(V.x, V.y, V.z, 0, 1, 0, cell, wrap)
    const r = sub(region, 0, 1, 0, 1)
    const c = color.isColor ? color : new THREE.Color(color)
    const { pos, nrm, uv } = base
    for (let i = 0; i < pos.length / 3; i++) {
      V.fromArray(pos, i * 3).applyMatrix4(m)
      const x = V.x
      const y = V.y
      const z = V.z
      V.fromArray(nrm, i * 3)
        .applyMatrix3(NORMAL)
        .normalize()
      const u = uv ? uv[i * 2] : 0.5
      const v = uv ? uv[i * 2 + 1] : 0.5
      this.vertex(x, y, z, V.x, V.y, V.z, r[0] + (r[2] - r[0]) * u, r[1] + (r[3] - r[1]) * v, c, s)
    }
  }

  // Una pieza de three.js ya ubicada (se libera despues de copiarla).
  piece(geometry, color, cell, region = REGION.rough, wrap = 0.5) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    if (!g.attributes.normal) g.computeVertexNormals()
    g.computeBoundingSphere()
    const center = g.boundingSphere.center
    // La muestra va en el centro: la forma se corre al origen y la matriz la
    // vuelve a poner donde estaba.
    const pos = g.attributes.position.array.slice()
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] -= center.x
      pos[i + 1] -= center.y
      pos[i + 2] -= center.z
    }
    const base = {
      pos,
      nrm: g.attributes.normal.array,
      uv: g.attributes.uv ? g.attributes.uv.array : null
    }
    this.form(base, MAT.makeTranslation(center.x, center.y, center.z), color, cell, region, wrap)
    if (g !== geometry) g.dispose()
    geometry.dispose()
  }

  // Una caja de w x h x d con el centro en (x, y, z), girada ry y despues rz.
  box(w, h, d, x, y, z, color, cell, o = {}) {
    const base = shape('box', () => new THREE.BoxGeometry(1, 1, 1))
    ROT.setFromEuler(EULER.set(0, o.ry || 0, o.rz || 0, 'ZYX'))
    MAT.compose(V.set(x, y, z), ROT, SCALE.set(w, h, d))
    this.form(base, MAT, color, cell, o.region || REGION.rough, o.wrap === undefined ? 0.4 : o.wrap)
  }

  // Un cilindro de radio top arriba y bottom abajo, girado rx, rz y despues ry.
  cyl(top, bottom, h, segments, x, y, z, color, cell, o = {}) {
    const ratio = Math.round((top / bottom) * 100) / 100
    const base = shape(
      'cyl:' + ratio + ':' + segments,
      () => new THREE.CylinderGeometry(ratio, 1, 1, segments)
    )
    ROT.setFromEuler(EULER.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YZX'))
    MAT.compose(V.set(x, y, z), ROT, SCALE.set(bottom, h, bottom))
    this.form(base, MAT, color, cell, o.region || REGION.rough, 0.6)
  }

  ball(r, x, y, z, color, cell, o = {}) {
    const detail = o.detail === undefined ? 1 : o.detail
    const base = shape('ball:' + detail, () => new THREE.IcosahedronGeometry(1, detail))
    ROT.identity()
    MAT.compose(V.set(x, y, z), ROT, SCALE.set(r * (o.sx || 1), r * (o.sy || 1), r * (o.sz || 1)))
    this.form(base, MAT, color, cell, REGION.plain, 0.7)
  }

  cone(r, h, segments, x, y, z, color, cell, o = {}) {
    const base = shape('cone:' + segments, () => new THREE.ConeGeometry(1, 1, segments))
    ROT.setFromEuler(EULER.set(0, o.ry || 0, 0))
    MAT.compose(V.set(x, y, z), ROT, SCALE.set(r, h, r))
    this.form(base, MAT, color, cell, o.region || REGION.plain, 0.6)
  }

  // Un hueso largo de a a b: un palo fino con una bola en cada punta.
  bone(a, b, r, color, cell) {
    const base = shape('cyl:1:5', () => new THREE.CylinderGeometry(1, 1, 1, 5))
    const from = new THREE.Vector3(...a)
    const to = new THREE.Vector3(...b)
    ROT.setFromUnitVectors(Y_UP, to.clone().sub(from).normalize())
    MAT.compose(from.clone().add(to).multiplyScalar(0.5), ROT, SCALE.set(r, from.distanceTo(to), r))
    this.form(base, MAT, color, cell, REGION.plain, 0.7)
    for (const end of [from, to]) {
      this.ball(r * 1.8, end.x, end.y, end.z, color, cell, { detail: 0 })
    }
  }

  // Lista para dibujar: bake(x, y, z, nx, ny, nz, cell, wrap) da la luz
  // horneada de cada muestra.
  geometry(bake) {
    const samples = this.cell.length
    const lit = new Float32Array(samples * 3)
    for (let i = 0; i < samples; i++) {
      const [r, g, b] = bake(
        this.sp[i * 3],
        this.sp[i * 3 + 1],
        this.sp[i * 3 + 2],
        this.sn[i * 3],
        this.sn[i * 3 + 1],
        this.sn[i * 3 + 2],
        this.cell[i],
        this.wrap[i]
      )
      lit[i * 3] = r
      lit[i * 3 + 1] = g
      lit[i * 3 + 2] = b
    }
    const count = this.at.length
    const light = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const s = this.at[i] * 3
      light[i * 3] = lit[s]
      light[i * 3 + 1] = lit[s + 1]
      light[i * 3 + 2] = lit[s + 2]
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    geometry.setAttribute('albedo', new THREE.Float32BufferAttribute(this.a, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(light, 3))
    geometry.computeBoundingSphere()
    return geometry
  }
}

// ---------------------------------------------------------------------------
// El piso armado.

function buildCrypt(data, ctx, parts) {
  const start = performance.now()
  const CX = ctx.CX || 0.5
  const CZ = ctx.CZ || 1
  const { width, height, rows } = data
  const plan = data.cripta
  const look = LOOKS[plan.floor] || LOOKS[1]
  const H = CRYPT.wall
  const at = (x, y) => (rows[y] && rows[y][x]) || '#'
  const rock = (x, y) => at(x, y) === '#'
  const idx = (x, y) => y * width + x
  const wx = (x) => (x + 0.5) * CX
  const wz = (y) => (y + 0.5) * CZ
  const heights = cryptHeights(data)
  const heightOf = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? H : heights[idx(x, y)])
  const inBox = (b, x, y) => !!b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
  const upBox = plan.stairs.up
  const downBox = plan.stairs.down
  const stairCell = (x, y) =>
    (inBox(upBox, x, y) || inBox(downBox, x, y)) && at(x, y) !== ' ' && !rock(x, y)

  const group = new THREE.Group()
  group.name = data.id
  const owned = { geometries: [], materials: [], textures: [] }
  const keep = (mesh) => {
    owned.geometries.push(mesh.geometry)
    for (const m of [mesh.material].flat()) owned.materials.push(m)
    group.add(mesh)
    return mesh
  }

  // Las luces fijas y desde que celdas se ven (una vez por celda).
  const lights = cryptLights(data, { cx: CX, cz: CZ })
  const lightColor = (l) =>
    new THREE.Color(
      l.kind === 'arch'
        ? plan.floor === 1
          ? 0xfff0d0
          : 0xd8e0ff
        : l.kind === 'throne' || l.kind === 'brazier'
          ? look.brazierLight
          : look.torch
    )
  for (const l of lights) {
    l.color = lightColor(l)
    l.source = SOURCES[l.kind]
  }
  const seen = new Map()
  function visible(cell) {
    if (cell < 0) return []
    if (!seen.has(cell)) {
      const x = cell % width
      const y = (cell - x) / width
      const here = { x: wx(x), z: wz(y) }
      seen.set(
        cell,
        lights.filter(
          (l) =>
            Math.hypot(l.x - here.x, l.z - here.z) < l.source[2] + 1 &&
            cryptSees(data, l.cell, { x, y })
        )
      )
    }
    return seen.get(cell)
  }
  function bake(px, py, pz, nx, ny, nz, cell, wrap) {
    let r = AMBIENT[0]
    let g = AMBIENT[1]
    let b = AMBIENT[2]
    for (const l of visible(cell)) {
      const dx = l.x - px
      const dy = l.y - py
      const dz = l.z - pz
      const d = Math.hypot(dx, dy, dz) || 1e-3
      const [power, soft, reach] = l.source
      if (d >= reach) continue
      const edge = 1 - (d / reach) * (d / reach)
      const fall = (power / (1 + (d / soft) * (d / soft))) * edge * edge
      const facing = (dx * nx + dy * ny + dz * nz) / d
      const k = fall * Math.max(0, wrap + (1 - wrap) * facing)
      r += l.color.r * k
      g += l.color.g * k
      b += l.color.b * k
    }
    return [Math.min(r, 2), Math.min(g, 2), Math.min(b, 2)]
  }

  // La celda libre mas cercana a una de roca o de pieza, para la luz.
  function openNear(x, y) {
    for (let r = 0; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = x + dx
          const cy = y + dy
          if (cx >= 0 && cy >= 0 && cx < width && cy < height && !rock(cx, cy)) {
            return idx(cx, cy)
          }
        }
      }
    }
    return -1
  }

  const stages = {}
  let mark = performance.now()
  const stage = (name) => {
    const now = performance.now()
    stages[name] = Math.round(now - mark)
    mark = now
  }
  stage('lights')
  const stone = new Mason()
  const shade = (hex, k, toward = null, t = 0) => {
    const c = new THREE.Color(hex).multiplyScalar(k)
    if (toward !== null) c.lerp(new THREE.Color(toward).multiplyScalar(k), t)
    return c
  }
  // El musgo de las cisternas: mas cerca del agua, mas verde.
  const wet = (x, y) => {
    if (plan.floor !== 1) return 0
    let near = 0
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -6; dx <= 6; dx++) if (at(x + dx, y + dy) === '~') near++
    }
    return Math.min(0.75, near / 18 + hash(x >> 2, y >> 1) * 0.25)
  }

  // El piso: una losa de 1 x 1 m cada dos celdas, corridas una fila si y otra no.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rock(x, y)) continue
      const ch = at(x, y)
      const h = heights[idx(x, y)]
      const x0 = x * CX
      const x1 = (x + 1) * CX
      const z0 = y * CZ
      const z1 = (y + 1) * CZ
      const cell = idx(x, y)
      let color
      let uv
      if (ch === '~') {
        color = shade(look.water, 0.5)
        uv = sub(REGION.rough, 0, 0.5, 0, 0.5)
      } else if (stairCell(x, y)) {
        const k = 0.82 + hash(x, y * 3) * 0.1
        color = shade(look.floor, k * 1.05)
        uv = sub(REGION.rough, (x % 4) / 4, (x % 4) / 4 + 0.25, 0, 0.4)
      } else {
        const bond = (x + (y & 1)) & 1
        const stoneX = (x + (y & 1)) >> 1
        const k = 0.78 + hash(stoneX, y) * 0.32
        if (ch === '.' && look.marble) {
          color = shade(look.marble, 0.9 + hash(stoneX, y) * 0.12)
        } else if (ch === ':') {
          color = shade(look.floor, k * 0.85, look.moss, 0.25)
        } else {
          color = shade(look.floor, k, look.moss, wet(x, y))
        }
        uv = sub(REGION.flag, bond * 0.5, bond * 0.5 + 0.5, 0, 1)
      }
      stone.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], uv, color, cell)
    }
  }

  stage('floor')
  // Los escalones, el borde de las cisternas y los pozos: entre dos celdas de
  // distinto alto, una cara que mira a la mas baja.
  const riser = (ax, ay, bx, by) => {
    const ha = heightOf(ax, ay)
    const hb = heightOf(bx, by)
    const ra = rock(ax, ay)
    const rb = rock(bx, by)
    if (ra && rb) return
    let lo
    let hi
    let low
    if (ra || rb) {
      // Contra la roca solo hace falta lo que queda bajo el piso: la pared
      // tapa de 0 para arriba.
      const open = ra ? [bx, by] : [ax, ay]
      const h = heightOf(open[0], open[1])
      if (h >= 0) return
      lo = h
      hi = 0
      low = open
    } else {
      if (Math.abs(ha - hb) < 1e-3) return
      lo = Math.min(ha, hb)
      hi = Math.max(ha, hb)
      low = ha < hb ? [ax, ay] : [bx, by]
    }
    const cell = idx(low[0], low[1])
    const water = at(low[0], low[1]) === '~'
    const color = shade(
      water ? look.trim : look.wall,
      water ? 0.7 : 0.72,
      look.moss,
      water ? 0.4 : 0
    )
    const uv = sub(REGION.rough, 0, 1, 0, Math.min(1, (hi - lo) / 1.2))
    if (ay === by) {
      // Una cara en x = borde entre las dos columnas, mirando a la baja.
      const x = Math.max(ax, bx) * CX
      const nx = low[0] === Math.min(ax, bx) ? -1 : 1
      const z0 = ay * CZ
      const z1 = (ay + 1) * CZ
      stone.quad([x, lo, z0], [x, lo, z1], [x, hi, z1], [x, hi, z0], [nx, 0, 0], uv, color, cell)
    } else {
      const z = Math.max(ay, by) * CZ
      const nz = low[1] === Math.min(ay, by) ? -1 : 1
      const x0 = ax * CX
      const x1 = (ax + 1) * CX
      stone.quad([x0, lo, z], [x1, lo, z], [x1, hi, z], [x0, hi, z], [0, 0, nz], uv, color, cell)
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x + 1 < width) riser(x, y, x + 1, y)
      if (y + 1 < height) riser(x, y, x, y + 1)
    }
  }

  stage('risers')
  // Las paredes: solo las caras de roca que dan a algo libre, en tiras de una
  // celda y cuatro bandas de alto. Las vetas de adentro se corren un poco hacia
  // afuera o hacia adentro (la roca no es lisa); las puntas y el borde de arriba
  // quedan quietos para que las esquinas y la tapa cierren.
  const BANDS = [0, 0.35, 1.1, 1.85, H]
  const STEP = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }
  const bump = (a, b, c) =>
    (hash(Math.round(a * 20) + 7, Math.round(b * 20) * 31 + Math.round(c * 20)) - 0.5) * 0.1
  for (const face of plan.faces) {
    const [dx, dy] = STEP[face.side]
    const across = face.side === 'n' || face.side === 's'
    const count = across ? face.x1 - face.x0 + 1 : face.y1 - face.y0 + 1
    const len = across ? CX : CZ
    for (let i = 0; i < count; i++) {
      const rx = across ? face.x0 + i : face.x0
      const ry = across ? face.y0 : face.y0 + i
      const cell = idx(rx + dx, ry + dy)
      // El plano de la pared y el largo a lo largo de ella, en metros.
      const plane = across ? (dy < 0 ? ry * CZ : (ry + 1) * CZ) : dx < 0 ? rx * CX : (rx + 1) * CX
      const s0 = across ? rx * CX : ry * CZ
      const u0 = (s0 % 2) / 2
      const u1 = u0 + len / 2
      const k = 0.86 + hash(rx * 3 + 1, ry * 5) * 0.2
      for (let band = 0; band < BANDS.length - 1; band++) {
        const ya = BANDS[band]
        const yb = BANDS[band + 1]
        const tone = band === 0 ? 0.72 : 1
        const color = shade(
          look.wall,
          k * tone,
          look.moss,
          band === 0 ? wet(rx, ry) : wet(rx, ry) * 0.3
        )
        const point = (s, y) => {
          // Lo de adentro del tramo se mueve; las puntas y arriba y abajo no.
          const inner =
            y > 0 &&
            y < H &&
            s > (across ? face.x0 * CX : face.y0 * CZ) + 1e-3 &&
            s < (across ? (face.x1 + 1) * CX : (face.y1 + 1) * CZ) - 1e-3
          const off = inner ? bump(s, y, plane) : 0
          return across ? [s, y, plane + dy * off] : [plane + dx * off, y, s]
        }
        stone.quad(
          point(s0, ya),
          point(s0 + len, ya),
          point(s0 + len, yb),
          point(s0, yb),
          [dx, 0, dy],
          sub(REGION.brick, u0, u1, ya / H, yb / H),
          color,
          cell
        )
      }
    }
    // El borde de arriba: una hilada que sobresale un poco hacia lo libre.
    const lip = shade(look.trim, 0.9)
    if (across) {
      const z = dy < 0 ? face.y0 * CZ : (face.y0 + 1) * CZ
      const x0 = face.x0 * CX
      const x1 = (face.x1 + 1) * CX
      stone.box(
        x1 - x0,
        0.12,
        0.26,
        (x0 + x1) / 2,
        H + 0.04,
        z - dy * 0.09,
        lip,
        idx(face.x0, face.y0 + dy),
        {
          wrap: 0.2
        }
      )
    } else {
      const x = dx < 0 ? face.x0 * CX : (face.x0 + 1) * CX
      const z0 = face.y0 * CZ
      const z1 = (face.y1 + 1) * CZ
      stone.box(
        0.26,
        0.12,
        z1 - z0,
        x - dx * 0.09,
        H + 0.04,
        (z0 + z1) / 2,
        lip,
        idx(face.x0 + dx, face.y0),
        {
          wrap: 0.2
        }
      )
    }
  }

  stage('walls')
  // La roca honda: una tapa oscura a la altura de la pared, sin luz.
  const capColor = shade(0x16130f, 1)
  for (const r of plan.rock) {
    const x0 = r.x0 * CX
    const x1 = (r.x1 + 1) * CX
    const z0 = r.y0 * CZ
    const z1 = (r.y1 + 1) * CZ
    stone.quad(
      [x0, H, z1],
      [x1, H, z1],
      [x1, H, z0],
      [x0, H, z0],
      [0, 1, 0],
      sub(REGION.rough, 0, 1, 0, 1),
      capColor,
      -1
    )
  }

  // Las piezas que se instancian con KayKit: [ruta, lista de { x, y, z, ry,
  // s (escala [x, y, z]), cell }].
  const props = new Map()
  const prop = (name, item) => {
    if (!props.has(name)) props.set(name, [])
    props.get(name).push(item)
  }

  // Los pilares: el de KayKit, angosto para que entre en la celda.
  for (const p of plan.pillars) {
    const special = plan.floor === 3
    prop(special ? 'pillar_decorated' : 'pillar', {
      x: wx(p.x),
      y: 0,
      z: wz(p.y),
      ry: 0,
      s: special ? [KK * 0.5, KK, KK * 0.62] : [KK * 0.55, KK, KK * 0.62],
      cell: openNear(p.x, p.y)
    })
  }

  // Las tumbas: base, tapa con un relieve del muerto y velas.
  for (const t of plan.tombs) {
    const x = wx(t.x)
    const z = wz(t.y)
    const cell = openNear(t.x, t.y)
    const tone = shade(look.wall, 0.9 + hash(t.x, t.y) * 0.1)
    stone.box(1.38, 0.5, 0.72, x, 0.25, z, shade(look.trim, 1.05), cell)
    stone.box(1.2, 0.08, 0.6, x, 0.52, z, tone, cell)
    stone.box(1.48, 0.1, 0.8, x, 0.6, z, tone, cell)
    // El muerto tallado en la tapa, la cabeza al oeste.
    stone.box(0.72, 0.1, 0.26, x + 0.08, 0.7, z, shade(look.wall, 1.12), cell)
    stone.ball(0.12, x - 0.4, 0.72, z, shade(look.wall, 1.12), cell, { detail: 0, sy: 0.7 })
    prop('candle_triple', {
      x: x + 0.56,
      y: 0.65,
      z: z - 0.2,
      ry: hash(t.x, 9) * 6,
      s: [0.42, 0.42, 0.42],
      cell
    })
  }

  // Los huesos del osario: una repisa baja con craneos (o) y femures (%).
  const bone = shade(BONE, 0.95)
  for (const b of plan.bones) {
    const x = wx(b.x)
    const z = wz(b.y)
    const cell = openNear(b.x, b.y)
    const k = hash(b.x * 7, b.y)
    stone.box(CX * 0.98, 0.32, 0.84, x, 0.16, z, shade(look.trim, 0.95), cell)
    if (b.ch === 'o') {
      for (const [dx, dz, dy] of [
        [-0.1, -0.2, 0],
        [0.1, 0.12, 0],
        [0, -0.02, 0.2]
      ]) {
        const sx = x + dx
        const sz = z + dz
        const sy = 0.44 + dy
        stone.ball(0.12, sx, sy, sz, bone, cell, { detail: 1, sy: 0.92 })
        stone.box(0.13, 0.07, 0.1, sx, sy - 0.1, sz + 0.06, bone, cell, { region: REGION.plain })
        for (const e of [-0.045, 0.045]) {
          stone.ball(0.03, sx + e, sy + 0.01, sz + 0.105, 0x141010, cell, { detail: 0 })
        }
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const y = 0.38 + i * 0.075
        const tilt = (hash(b.x + i, b.y * 3) - 0.5) * 0.25
        stone.bone(
          [x - 0.2, y, z - 0.3 + tilt],
          [x + 0.2, y + 0.02, z + 0.3 - tilt],
          0.028,
          bone,
          cell
        )
      }
      if (k > 0.5) stone.ball(0.11, x, 0.72, z, bone, cell, { detail: 1 })
    }
  }

  // Los puentes de las cisternas: un pretil bajo del lado del agua.
  const bridgeStone = shade(look.wall, 0.85)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) !== ':' || stairCell(x, y)) continue
      const cell = idx(x, y)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        if (at(x + dx, y + dy) !== '~') continue
        if (dx) {
          const px = wx(x) + dx * (CX / 2 - 0.05)
          stone.box(0.1, 0.32, CZ, px, 0.16, wz(y), bridgeStone, cell)
          if ((y & 1) === 0) stone.box(0.16, 0.42, 0.16, px, 0.21, wz(y) - 0.5, bridgeStone, cell)
        } else {
          const pz = wz(y) + dy * (CZ / 2 - 0.05)
          stone.box(CX, 0.32, 0.1, wx(x), 0.16, pz, bridgeStone, cell)
          if ((x & 1) === 0) {
            stone.box(0.16, 0.42, 0.16, wx(x) - CX / 2, 0.21, pz, bridgeStone, cell)
          }
        }
      }
    }
  }

  // Las escaleras. En cada punta de fila del arte, un poste con lo suyo: un
  // craneo en el osario, una bola de oro en la corona.
  const stairPost = (x, y, h) => {
    const cell = idx(x, y)
    const px = wx(x)
    const pz = wz(y)
    stone.box(0.24, 0.42, 0.24, px, h + 0.21, pz, shade(look.trim, 1.1), cell)
    const ch = at(x, y)
    if (ch === 'o') stone.ball(0.13, px, h + 0.54, pz, bone, cell, { detail: 1 })
    if (ch === '+' && look.gold) {
      stone.ball(0.1, px, h + 0.52, pz, shade(look.gold, 1), cell, { detail: 1 })
    }
  }
  for (const box of [upBox, downBox]) {
    if (!box) continue
    for (let y = box.y0; y <= box.y1; y++) {
      let first = -1
      let last = -1
      for (let x = box.x0; x <= box.x1; x++) {
        if (at(x, y) === ' ' || rock(x, y)) continue
        if (first < 0) first = x
        last = x
      }
      if (first < 0) continue
      const h = Math.max(0, heights[idx(first, y)])
      stairPost(first, y, h)
      stairPost(last, y, h)
    }
  }

  // El arco de la escalera de subida, sobre la fila de arriba (el dintel del
  // arte): dos jambas, el dintel y la puerta llena de la luz de arriba.
  let doorway = null
  {
    let first = -1
    let last = -1
    for (let x = upBox.x0; x <= upBox.x1; x++) {
      if (at(x, upBox.y0) === ' ' || rock(x, upBox.y0)) continue
      if (first < 0) first = x
      last = x
    }
    const top = heights[idx(first, upBox.y0)]
    const x0 = first * CX
    const x1 = (last + 1) * CX
    const zBack = upBox.y0 * CZ
    const cell = idx(plan.up.x + 2, upBox.y0 + 1)
    const frame = shade(look.trim, 1.15)
    // La losa de atras, para quien la mira desde el otro lado.
    const behind = openNear(first, upBox.y0 - 1)
    stone.box(
      x1 - x0,
      top + 2.3,
      0.2,
      (x0 + x1) / 2,
      (top + 2.3) / 2,
      zBack + 0.1,
      shade(look.wall, 0.8),
      behind,
      {
        wrap: 0.1
      }
    )
    for (const x of [x0 + 0.25, x1 - 0.25]) {
      stone.box(0.5, 2.3, 0.5, x, top + 1.15, zBack + 0.3, frame, cell)
    }
    stone.box(x1 - x0 + 0.3, 0.36, 0.6, (x0 + x1) / 2, top + 2.4, zBack + 0.3, frame, cell)
    stone.box(0.7, 0.5, 0.2, (x0 + x1) / 2, top + 2.45, zBack + 0.62, shade(look.trim, 1.3), cell)
    doorway = { x0: x0 + 0.5, x1: x1 - 0.5, y0: top, y1: top + 2.22, z: zBack + 0.21 }
  }

  // El trono de la necropolis: una tarima, el asiento en la T, el respaldo alto
  // con la corona, los brazos (=) y dos postes con braseros verdes ([ y ]). Una
  // alfombra baja hacia el sur.
  if (plan.throneBox && look.gold) {
    const box = plan.throneBox
    const t = plan.throne
    const cell = idx(t.x, t.y + 1)
    const gold = shade(look.gold, 1)
    const dark = shade(look.trim, 0.9)
    const cx = wx(t.x)
    const x0 = box.x0 * CX
    const x1 = (box.x1 + 1) * CX
    stone.box(x1 - x0 + 1, 0.06, 2.6, cx, 0.03, wz(box.y0) + 0.6, dark, cell, { wrap: 0.2 })
    stone.box(
      x1 - x0 + 0.4,
      0.06,
      1.9,
      cx,
      0.09,
      wz(box.y0) + 0.35,
      shade(look.marble, 0.8),
      cell,
      { wrap: 0.2 }
    )
    // El asiento, el respaldo y la corona.
    const zSeat = wz(t.y) - 0.15
    stone.box(0.9, 0.5, 0.75, cx, 0.37, zSeat, dark, cell)
    stone.box(0.8, 0.08, 0.66, cx, 0.66, zSeat, shade(0x7a1a22, 1), cell, { region: REGION.plain })
    const zBack = wz(box.y0) + 0.05
    stone.box(1.15, 2.6, 0.3, cx, 1.42, zBack, dark, cell)
    stone.box(0.8, 1.9, 0.06, cx, 1.55, zBack + 0.17, shade(0x7a1a22, 1), cell, {
      region: REGION.plain
    })
    stone.box(1.3, 0.14, 0.4, cx, 2.76, zBack, gold, cell, { region: REGION.plain })
    for (let i = -2; i <= 2; i++) {
      stone.cone(
        0.08,
        0.38 - Math.abs(i) * 0.06,
        5,
        cx + i * 0.24,
        3.0 - Math.abs(i) * 0.03,
        zBack,
        gold,
        cell
      )
    }
    stone.ball(0.09, cx, 3.3, zBack, shade(look.rune, 1), cell, { detail: 1 })
    // Los brazos.
    for (const dx of [-1, 1]) {
      const ax = wx(t.x + dx)
      stone.box(0.24, 0.72, 0.8, ax, 0.42, zSeat, dark, cell)
      stone.box(0.28, 0.08, 0.86, ax, 0.82, zSeat, gold, cell, { region: REGION.plain })
    }
    // Los postes con braseros (las luces 'throne' de cryptLights).
    for (const l of lights.filter((l) => l.kind === 'throne')) {
      stone.box(0.36, 1.3, 0.36, l.x, 0.65, l.z, dark, cell)
      stone.box(0.44, 0.12, 0.44, l.x, 1.33, l.z, gold, cell, { region: REGION.plain })
      stone.cyl(0.3, 0.16, 0.24, 8, l.x, 1.5, l.z, shade(IRON, 1), cell)
    }
    // La alfombra, de la tarima hasta la sala.
    const carpet = shade(0x6a141c, 1)
    for (let y = box.y1 + 2; y <= box.y1 + 8; y++) {
      for (let x = t.x - 1; x <= t.x + 1; x++) {
        if (at(x, y) !== ' ') continue
        const edge = x !== t.x
        stone.quad(
          [x * CX, 0.012, (y + 1) * CZ],
          [(x + 1) * CX, 0.012, (y + 1) * CZ],
          [(x + 1) * CX, 0.012, y * CZ],
          [x * CX, 0.012, y * CZ],
          [0, 1, 0],
          sub(REGION.plain, 0, 0.2, 0, 0.2),
          edge ? shade(look.gold, 0.55) : carpet,
          idx(x, y)
        )
      }
    }
  }

  // La rotonda: un anillo de oro alrededor del pilar del medio.
  if (look.gold && plan.rotunda.length) {
    const center = plan.pillars.find((p) => at(p.x - 1, p.y) === '.' && at(p.x + 1, p.y) === '.')
    if (center) {
      const cx = wx(center.x)
      const cz = wz(center.y)
      for (const r of [1.4, 2.6]) {
        const ring = new THREE.RingGeometry(r - 0.06, r, 40)
        ring.rotateX(-Math.PI / 2)
        ring.scale(1, 1, 1)
        ring.translate(cx, 0.01, cz)
        stone.piece(
          ring,
          shade(look.gold, 0.8),
          openNear(center.x + 1, center.y),
          REGION.plain,
          0.3
        )
      }
    }
  }

  // Los braseros de pie, en cada lampara (*) del juego.
  for (const l of lights.filter((l) => l.kind === 'brazier')) {
    const cell = idx(l.cell.x, l.cell.y)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      stone.cyl(
        0.03,
        0.03,
        1.12,
        4,
        l.x + Math.cos(a) * 0.14,
        0.52,
        l.z + Math.sin(a) * 0.14,
        shade(IRON, 1),
        cell,
        {
          rz: Math.cos(a) * 0.22,
          rx: -Math.sin(a) * 0.22
        }
      )
    }
    stone.cyl(0.3, 0.14, 0.2, 8, l.x, 1.05, l.z, shade(IRON, 1.2), cell)
  }

  // Lo que se ve de la pared: antorchas de KayKit, estandartes, escombros y,
  // junto a la escalera de subida, barriles y cajones (metidos en la roca).
  const torches = lights.filter((l) => l.kind === 'torch')
  for (const l of torches) {
    prop('torch_mounted', {
      x: l.x - l.nx * 0.3,
      y: 1.36,
      z: l.z - l.nz * 0.3,
      ry: Math.atan2(l.nx, l.nz),
      s: [KK, KK, KK],
      cell: idx(l.cell.x, l.cell.y)
    })
  }
  const nearTorch = (x, z, d) => lights.some((l) => Math.hypot(l.x - x, l.z - z) < d)
  const dressing = []
  for (const face of plan.faces) {
    const [dx, dy] = STEP[face.side]
    const across = face.side === 'n' || face.side === 's'
    const length = across ? face.x1 - face.x0 + 1 : face.y1 - face.y0 + 1
    if (length < (across ? 6 : 3)) continue
    const mid = Math.floor(length / 2)
    const x = across ? face.x0 + mid : face.x0
    const y = across ? face.y0 : face.y0 + mid
    const fx = x + dx
    const fy = y + dy
    if (at(fx, fy) !== ' ' || inBox(upBox, fx, fy) || inBox(downBox, fx, fy)) continue
    const px = wx(x) + dx * (CX / 2)
    const pz = wz(y) + dy * (CZ / 2)
    dressing.push({ px, pz, dx, dy, cell: idx(fx, fy), k: hash(x * 13, y * 7) })
  }
  dressing.sort((a, b) => a.k - b.k)
  let banners = 0
  let rubble = 0
  for (const d of dressing) {
    if (nearTorch(d.px, d.pz, 3.5)) continue
    const ry = Math.atan2(d.dx, d.dy)
    if (look.banners.length && banners < 10) {
      prop(look.banners[banners % look.banners.length], {
        x: d.px - d.dx * 0.2,
        y: 0,
        z: d.pz - d.dy * 0.2,
        ry,
        s: [KK, KK * 0.92, KK],
        cell: d.cell
      })
      banners++
    } else if (plan.floor < 3 && rubble < 5) {
      prop(rubble % 2 ? 'rubble_half' : 'rubble_large', {
        x: d.px - d.dx * 0.1,
        y: 0,
        z: d.pz - d.dy * 0.1,
        ry: ry + Math.PI / 2,
        s: rubble % 2 ? [0.18, 0.2, 0.18] : [0.14, 0.18, 0.14],
        cell: d.cell
      })
      rubble++
    }
  }
  // Barriles y cajones contra la roca, cerca de la escalera de subida.
  {
    const near = plan.faces
      .filter((f) => (f.side === 'e' || f.side === 'w') && f.y1 - f.y0 >= 1)
      .map((f) => {
        const [dx] = STEP[f.side]
        const y = f.y0
        return { f, dx, y, d: Math.hypot(f.x0 - plan.up.x, (y - plan.up.y) * 2) }
      })
      .filter((c) => at(c.f.x0 + c.dx, c.y) === ' ' && !inBox(upBox, c.f.x0 + c.dx, c.y))
      .sort((a, b) => a.d - b.d)
    const spot = near[0]
    if (spot) {
      const px = wx(spot.f.x0) + spot.dx * (CX / 2)
      const cell = idx(spot.f.x0 + spot.dx, spot.y)
      prop('barrel_small_stack', {
        x: px,
        y: 0,
        z: wz(spot.y) + 0.1,
        ry: Math.atan2(spot.dx, 0),
        s: [0.42, 0.42, 0.42],
        cell
      })
      prop('crates_stacked', {
        x: px,
        y: 0,
        z: wz(spot.y) + 1.1,
        ry: hash(spot.y, 3),
        s: [0.38, 0.38, 0.38],
        cell
      })
    }
  }
  // El oro de la corona, a los lados del trono.
  if (plan.throneBox) {
    const t = plan.throne
    for (const dx of [-7, 7]) {
      const x = t.x + dx
      let y = t.y
      while (y > 0 && !rock(x, y - 1)) y--
      if (rock(x, y)) continue
      prop('chest_gold', {
        x: wx(x),
        y: 0,
        z: y * CZ + 0.3,
        ry: 0,
        s: [0.45, 0.45, 0.45],
        cell: idx(x, y)
      })
    }
  }

  stage('pieces')
  cryptAtlas()
  stage('atlas')
  // El material es de este piso; el atlas queda para el proximo.
  const walls = keep(new THREE.Mesh(stone.geometry(bake), bakedMaterial()))
  walls.receiveShadow = true
  walls.name = 'crypt-stone'

  stage('bake')
  // El agua de las cisternas, en su propia malla transparente.
  const clock = { value: 0 }
  if (plan.water.length) {
    const water = new Mason()
    // En el agua el color es el brillo propio (el del limo en las cisternas).
    const color = shade(look.water, 2)
    for (const r of plan.water) {
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) {
          const x0 = x * CX
          const x1 = (x + 1) * CX
          const z0 = y * CZ
          const z1 = (y + 1) * CZ
          const h = CRYPT.water
          water.quad(
            [x0, h, z1],
            [x1, h, z1],
            [x1, h, z0],
            [x0, h, z0],
            [0, 1, 0],
            sub(REGION.plain, 0, 0.1, 0, 0.1),
            color,
            idx(x, y)
          )
        }
      }
    }
    const material = bakedMaterial(
      { transparent: true, opacity: 0.9, roughness: 0.08, metalness: 0.2, depthWrite: false },
      clock
    )
    const mesh = keep(new THREE.Mesh(water.geometry(bake), material))
    mesh.renderOrder = 1
    mesh.name = 'crypt-water'
  }

  // Las llamas (una malla) y sus halos (puntos sumados).
  const flames = new parts.Kit()
  const halos = []
  for (const l of lights) {
    if (l.kind === 'arch') continue
    const tint = l.kind === 'torch' ? look.flame : look.brazier
    const base = l.kind === 'torch' ? l.y - 0.02 : l.kind === 'throne' ? 1.6 : 1.12
    const tall = l.kind === 'torch' ? 0.34 : 0.55
    parts.flame(flames, l.x, base, l.z, tall, tint)
    halos.push(l.x, base + tall * 0.45, l.z, l.color.r, l.color.g, l.color.b)
  }
  const fireMesh = new THREE.Mesh(flames.geometry(), parts.flameMaterial(clock))
  fireMesh.renderOrder = 3
  fireMesh.frustumCulled = false
  fireMesh.name = 'crypt-flames'
  keep(fireMesh)
  const dot = softDot()
  owned.textures.push(dot)
  {
    const geometry = new THREE.BufferGeometry()
    const pos = []
    const col = []
    for (let i = 0; i < halos.length; i += 6) {
      pos.push(halos[i], halos[i + 1], halos[i + 2])
      col.push(halos[i + 3] * 0.5, halos[i + 4] * 0.42, halos[i + 5] * 0.3)
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        map: dot,
        size: 1.5,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    points.renderOrder = 4
    points.name = 'crypt-halos'
    keep(points)
  }

  // La luz de arriba en la puerta del arco y unos rayos que bajan la escalera.
  const beam = beamTexture()
  owned.textures.push(beam)
  if (doorway) {
    const day = plan.floor === 1 ? 0xfff2d8 : 0xdce4ff
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(doorway.x1 - doorway.x0, doorway.y1 - doorway.y0),
      new THREE.MeshBasicMaterial({ color: day, map: beam, transparent: true, fog: true })
    )
    glow.position.set((doorway.x0 + doorway.x1) / 2, (doorway.y0 + doorway.y1) / 2, doorway.z)
    keep(glow)
    const rays = []
    for (let i = 0; i < 3; i++) {
      const g = new THREE.PlaneGeometry(0.7 + i * 0.25, 4.2)
      g.translate(0, -2.1, 0)
      g.rotateX(-0.75 - i * 0.12)
      g.translate(
        doorway.x0 + 0.4 + (doorway.x1 - doorway.x0 - 0.8) * (i / 2),
        doorway.y1,
        doorway.z
      )
      rays.push(g)
    }
    const rayMesh = new THREE.Mesh(
      parts.mergeGeometries(rays),
      new THREE.MeshBasicMaterial({
        color: day,
        map: beam,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      })
    )
    for (const g of rays) g.dispose()
    rayMesh.renderOrder = 4
    keep(rayMesh)
  }

  // El sello de la escalera de bajada: una losa con runas que tapa el pozo.
  // landmarks lo abre cuando no quedan monstruos.
  let seal = null
  if (downBox) {
    let x0 = Infinity
    let x1 = -Infinity
    for (let y = downBox.y0 + 1; y <= downBox.y1; y++) {
      for (let x = downBox.x0; x <= downBox.x1; x++) {
        if (at(x, y) === ' ' || rock(x, y)) continue
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
      }
    }
    const w = (x1 - x0 + 1) * CX
    const d = (downBox.y1 - downBox.y0) * CZ
    const runes = sealTexture('#ffffff')
    owned.textures.push(runes)
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.08, d),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(look.trim).multiplyScalar(0.8),
        roughness: 0.85,
        emissive: new THREE.Color(look.rune),
        emissiveMap: runes,
        emissiveIntensity: 1.2,
        transparent: true
      })
    )
    slab.position.set(x0 * CX + w / 2, 0.04, (downBox.y0 + 1) * CZ + d / 2)
    slab.name = 'crypt-seal'
    keep(slab)
    // Lo que sube del pozo cuando se abre.
    const below = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.9, d * 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: look.rune,
        map: dot,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    below.position.set(slab.position.x, -0.9, slab.position.z)
    keep(below)
    seal = { slab, below, open: null, since: 0 }
  }

  // Los modelos de KayKit, uno por InstancedMesh, con la luz horneada en el
  // color de cada instancia. Si un modelo no llega, el piso sigue sin el.
  const cc0 = ctx.cc0
  let disposed = false
  const loads = []
  const UP = [0, 1, 0]
  const M = new THREE.Matrix4()
  const Q = new THREE.Quaternion()
  const P = new THREE.Vector3()
  const S = new THREE.Vector3()
  const C = new THREE.Color()
  for (const [name, items] of props) {
    if (!cc0 || !cc0.parts) break
    const path = KAYKIT + name + (name.startsWith('chest') ? '.glb' : '.gltf.glb')
    loads.push(
      cc0
        .parts(path)
        .then((found) => {
          if (disposed) return
          for (const part of found) {
            const material = propMaterial(part.material)
            owned.materials.push(material)
            const mesh = new THREE.InstancedMesh(part.geometry, material, items.length)
            mesh.userData.shared = true
            items.forEach((it, i) => {
              Q.setFromAxisAngle(P.set(0, 1, 0), it.ry || 0)
              M.compose(P.set(it.x, it.y, it.z), Q, S.set(...it.s))
              mesh.setMatrixAt(i, M)
              // Las piezas brillan menos que la piedra: son chicas y estan
              // cerca de las antorchas.
              const [r, g, b] = bake(it.x, it.y + 1, it.z, ...UP, it.cell, 0.75)
              const k = 0.6 / Math.max(1, Math.max(r, g, b) * 0.6)
              mesh.setColorAt(i, C.setRGB(r * k, g * k, b * k))
            })
            mesh.instanceMatrix.needsUpdate = true
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
            mesh.computeBoundingSphere()
            mesh.name = 'crypt-' + name
            group.add(mesh)
          }
        })
        .catch((error) => console.warn('cripta: sin ' + path, error))
    )
  }

  // La camara: los rectangulos que frenan (roca, pilares, tumbas, huesos y lo
  // solido de las escaleras y del trono) con su alto.
  const topOf = (x, y) => {
    const ch = at(x, y)
    if (ch === '#') return H
    if (ch === '+') return H
    if (ch === '[' || ch === ']' || ch === '=') {
      if (inBox(plan.throneBox, x, y)) return 1.6
      if (stairCell(x, y)) return Math.max(0, heights[idx(x, y)]) + 2.6
      return 0.8
    }
    if (ch === '%' || ch === 'o') return stairCell(x, y) ? 0.8 : 0.9
    return 1
  }
  const blocks = plan.blocks.map((r) => {
    let top = 0
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) top = Math.max(top, topOf(x, y))
    }
    return { x0: r.x0 * CX, x1: (r.x1 + 1) * CX, z0: r.y0 * CZ, z1: (r.y1 + 1) * CZ, top }
  })

  const toWorld = (x, y) => new THREE.Vector3(wx(x), 0, wz(y))
  const terrainHeight = (x, z) => {
    const cx = Math.floor(x / CX)
    const cy = Math.floor(z / CZ)
    const h = heightOf(cx, cy)
    return h > 0 ? h : 0
  }
  // Donde pisa el heroe: los escalones suben y bajan, el resto del piso es 0.
  const walkHeight = (x, z) => {
    const cx = Math.floor(x / CX)
    const cy = Math.floor(z / CZ)
    return stairCell(cx, cy) ? heights[idx(cx, cy)] : 0
  }

  const buildMs = Math.round(performance.now() - start)
  stage('rest')
  // Para medir desde la consola (runaView.scene, el grupo crypt-<piso>).
  group.userData.buildMs = buildMs
  group.userData.stages = stages
  return {
    group,
    toWorld,
    blocks,
    terrainHeight,
    walkHeight,
    // Sin techo: la camara de tercera persona sube por encima de la roca en vez
    // de pegarse al heroe (la pagina, springArm).
    overhead: true,
    colossus: () => null,
    loading: Promise.all(loads),
    crypt: { lights, seal, look, floor: plan.floor, CX, CZ, buildMs, dot },
    update(time) {
      clock.value = time
    },
    dispose() {
      disposed = true
      for (const child of group.children) {
        if (child.isInstancedMesh) child.dispose()
      }
      for (const g of owned.geometries) g.dispose()
      for (const m of owned.materials) m.dispose()
      for (const t of owned.textures) t.dispose()
    }
  }
}

// ---------------------------------------------------------------------------
// Lo que cambia: el sello, los carteles, las luces de verdad cerca del heroe,
// el polvo y la niebla medida desde el heroe.

function cryptLive(world, ctx, field, parts) {
  const built = world.built
  const crypt = built.crypt
  if (!crypt) return null
  const group = new THREE.Group()
  const L = ctx.L || ((en, es) => es)
  const plan = world.data.cripta
  const touch = globalThis.matchMedia ? globalThis.matchMedia('(pointer: coarse)').matches : false
  const CX = crypt.CX
  const CZ = crypt.CZ
  const wx = (x) => (x + 0.5) * CX
  const wz = (y) => (y + 0.5) * CZ

  // Las luces de verdad: K para las antorchas mas cercanas; cuando cambia cual
  // es la mas cercana, la que sobra se apaga despacio y despues se muda.
  const K = touch ? 2 : 4
  const sources = crypt.lights.filter((l) => l.kind !== 'arch')
  const pool = []
  for (let i = 0; i < K; i++) {
    const light = new THREE.PointLight(0xffa050, 0, 8, 1.7)
    light.castShadow = false
    group.add(light)
    pool.push({ light, src: null, level: 0 })
  }
  // Las K antorchas mas cercanas a menos de 16 m, de la mas cercana a la mas
  // lejana, sin armar listas nuevas en cada eleccion.
  const wanted = []
  const wantedAt = []
  function pickNearest(hero) {
    wanted.length = 0
    wantedAt.length = 0
    for (const l of sources) {
      const d = Math.hypot(l.x - hero.x, l.z - hero.z)
      if (d >= 16) continue
      let i = wanted.length
      while (i > 0 && wantedAt[i - 1] > d) i--
      if (i >= K) continue
      wanted.splice(i, 0, l)
      wantedAt.splice(i, 0, d)
      if (wanted.length > K) {
        wanted.pop()
        wantedAt.pop()
      }
    }
  }
  // La primera de las elegidas que todavia no tiene luz.
  function unlit() {
    for (const l of wanted) {
      let lit = false
      for (const s of pool) if (s.src === l) lit = true
      if (!lit) return l
    }
    return null
  }
  let nextPick = 0
  let last = null

  // El polvo: motas que flotan alrededor del heroe.
  const MOTES = touch ? 70 : 160
  const motePos = new Float32Array(MOTES * 3)
  const moteSeed = new Float32Array(MOTES)
  for (let i = 0; i < MOTES; i++) {
    motePos[i * 3] = (Math.random() - 0.5) * 14
    motePos[i * 3 + 1] = Math.random() * 3
    motePos[i * 3 + 2] = (Math.random() - 0.5) * 14
    moteSeed[i] = Math.random() * 100
  }
  const moteGeo = new THREE.BufferGeometry()
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3))
  const moteMat = new THREE.PointsMaterial({
    map: crypt.dot,
    color: crypt.floor === 1 ? 0xb8d8a8 : 0xe8cfa0,
    size: 0.07,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const motes = new THREE.Points(moteGeo, moteMat)
  motes.frustumCulled = false
  motes.renderOrder = 5
  group.add(motes)
  const center = new THREE.Vector3()

  // Los carteles. El de la escalera de bajada cambia con lo que queda.
  const signs = []
  function sign(text, color, x, y, z) {
    const sprite = ctx.label(text, color)
    sprite.position.set(x, y, z)
    group.add(sprite)
    signs.push(sprite)
    return sprite
  }
  function drop(sprite) {
    if (!sprite) return
    group.remove(sprite)
    labels.delete(sprite)
    sprite.material.map.dispose()
    sprite.material.dispose()
    const at = signs.indexOf(sprite)
    if (at >= 0) signs.splice(at, 1)
  }
  const floorName = ctx.text ? ctx.text(plan.name) : plan.name
  const upBox = plan.stairs.up
  const upX = wx((upBox.x0 + upBox.x1) / 2 + 2)
  sign(L('floor ', 'piso ') + plan.floor + ' · ' + floorName, '#d8c8a0', upX, 5.2, wz(upBox.y0))
  sign(
    plan.floor === 1
      ? L('^ up to the meadow', '^ sube a la pradera')
      : L('^ up to floor ', '^ sube al piso ') + (plan.floor - 1),
    '#e0c060',
    upX,
    4.3,
    wz(upBox.y0)
  )
  let downSign = null
  let downSaid = 'nada'
  let throneSign = null
  let throneSaid = 'nada'

  function remainingOf(f) {
    if (!f) return null
    const n = Number(f.remaining)
    return Number.isFinite(n) ? n : null
  }

  function update(time, st, f) {
    const dt = last === null ? 0 : Math.min(0.1, time - last)
    last = time
    const hero = ctx.hero && ctx.hero.root ? ctx.hero.root.position : null

    // La niebla se mide desde el heroe (ctx.effects: los efectos de la pagina).
    const fx = ctx.effects
    if (hero && ctx.camera && fx && fx.fogFromHero) {
      fx.fogFromHero(ctx.camera.position.distanceTo(hero))
    }

    // Las luces de verdad.
    if (hero && time >= nextPick) {
      nextPick = time + 0.25
      pickNearest(hero)
    }
    for (const slot of pool) {
      const keepIt = slot.src && wanted.includes(slot.src)
      slot.level += ((keepIt ? 1 : 0) - slot.level) * Math.min(1, dt * 3)
      if (!keepIt && slot.level < 0.04) {
        const free = unlit()
        slot.src = free || null
        if (free) {
          slot.light.color.copy(free.color)
          slot.light.position.set(
            free.x + (free.nx || 0) * 0.15,
            free.y + 0.15,
            free.z + (free.nz || 0) * 0.15
          )
        }
      }
      const seed = slot.src ? slot.src.x * 1.7 + slot.src.z : 0
      const flicker =
        0.82 + 0.1 * Math.sin(time * 9.3 + seed) + 0.08 * Math.sin(time * 23.1 + seed * 3)
      slot.light.intensity = slot.src ? 9 * slot.level * flicker : 0
    }

    // El polvo sigue al heroe y sube despacio.
    if (hero) {
      center.copy(hero)
      for (let i = 0; i < MOTES; i++) {
        const s = moteSeed[i]
        let x = motePos[i * 3] + Math.sin(time * 0.3 + s) * 0.002
        let y = motePos[i * 3 + 1] + 0.0025 + Math.sin(time * 0.7 + s) * 0.001
        let z = motePos[i * 3 + 2] + Math.cos(time * 0.25 + s) * 0.002
        if (y > 3.2) y = 0.1
        if (x - center.x > 7) x -= 14
        if (x - center.x < -7) x += 14
        if (z - center.z > 7) z -= 14
        if (z - center.z < -7) z += 14
        motePos[i * 3] = x
        motePos[i * 3 + 1] = y
        motePos[i * 3 + 2] = z
      }
      moteGeo.attributes.position.needsUpdate = true
    }

    // El sello y su cartel.
    const left = remainingOf(f)
    if (plan.down) {
      const locked = left === null ? true : left > 0
      const seal = crypt.seal
      if (seal) {
        if (seal.open === null) {
          seal.open = !locked
          seal.since = locked ? 0 : -10
        } else if (seal.open === locked) {
          seal.open = !locked
          seal.since = time
        }
        const k = seal.open ? Math.min(1, (time - seal.since) / 1.6) : 0
        seal.slab.visible = k < 1
        seal.slab.position.y = 0.04 - k * 1.3
        seal.slab.material.opacity = 1 - k * 0.8
        seal.slab.material.emissiveIntensity = seal.open
          ? 1.2 * (1 - k)
          : 0.9 + 0.35 * Math.sin(time * 2.4)
        seal.below.material.opacity = seal.open ? k * (0.5 + 0.12 * Math.sin(time * 3)) : 0
      }
      // El cartel se arma de nuevo solo si cambia lo que dice.
      const key = locked ? left : -1
      if (key !== downSaid) {
        const say = locked
          ? 'v ' + L('sealed: ', 'sellada: ') + (left === null ? '?' : left) + L(' left', ' quedan')
          : 'v ' + L('down to floor ', 'baja al piso ') + (plan.floor + 1)
        drop(downSign)
        downSaid = key
        downSign = sign(
          say,
          locked ? '#ff8a6a' : '#9cff9a',
          wx(plan.down.x),
          3.2,
          wz(plan.down.y) + 1
        )
      }
    }
    // El trono: con el rey o vacio.
    if (plan.throne) {
      const done = !!(f && f.state && f.state.kingDefeated)
      if (done !== throneSaid) {
        const say = done
          ? L('the empty throne', 'el trono vacio')
          : L('the throne of the crown', 'el trono de la corona')
        drop(throneSign)
        throneSaid = done
        throneSign = sign(
          say,
          done ? '#c8c0d8' : '#e8c060',
          wx(plan.throne.x),
          4.4,
          wz(plan.throne.y)
        )
      }
    }
    // Un cartel que tapa al heroe se aparta (el de la v con el heroe al lado).
    if (parts && parts.signsAside) parts.signsAside(signs, ctx.camera, hero, dt)
  }

  return {
    group,
    update,
    dispose() {
      for (const s of [...signs]) drop(s)
      for (const slot of pool) slot.light.dispose()
      moteGeo.dispose()
      moteMat.dispose()
    }
  }
}

// La ayuda fuera de la pelea: que hay en la escalera o en el trono.
function cryptHint(st, field, touch, L) {
  if (!field || !st || !st.location) return ''
  const at = st.location
  const layout = field.layout
  const close = (p, rx, ry) => p && Math.abs(p.x - at.x) <= rx && Math.abs(p.y - at.y) <= ry
  if (close(layout.up, 5, 3)) {
    return field.floor === 1
      ? L('^ step on it to climb out to the meadow', '^ pisala para salir a la pradera')
      : L('^ step on it to go up to floor ', '^ pisala para subir al piso ') + (field.floor - 1)
  }
  if (close(layout.down, 5, 3)) {
    const left = Number(field.remaining) || 0
    return left > 0
      ? L('the stairs are sealed: ', 'la escalera esta sellada: ') +
          left +
          L(' monsters left', ' monstruos quedan')
      : L('v step on it to go down to floor ', 'v pisala para bajar al piso ') + (field.floor + 1)
  }
  if (close(layout.throne, 6, 4)) {
    return field.state && field.state.kingDefeated
      ? L('the crown king is gone', 'el rey de la corona ya no esta')
      : L('the crown king guards his throne', 'el rey de la corona cuida su trono')
  }
  return ''
}

/**
 * El lugar de adentro de la cripta, para pradera.js addPlace: recibe PARTS (las
 * piezas de la pradera: Kit, flame, flameMaterial, mergeGeometries...).
 */
export function cryptPlace(parts) {
  return {
    mode: 'dungeon',
    data(field, names, ctx) {
      // buildWorld llama a build con estos mismos datos (o una copia con los
      // carteles en otro idioma).
      return { ...cryptData(field, names), build: (data) => buildCrypt(data, ctx, parts) }
    },
    landmarks: (world, ctx, field) => cryptLive(world, ctx, field, parts),
    hint: cryptHint
  }
}
