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

// Suelo caminable, por caracter.
const GROUND = {
  '`': 0x343f2a,
  '.': 0x8c7b5c,
  ',': 0x3f5c2b,
  '"': 0x4d7230,
  ';': 0x6f6b64,
  '%': 0x5f5951,
  '*': 0x3f5c2b,
  '=': 0x4a403a
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

  // Primera pasada: que es cada celda, el color del suelo, puertas y flores.
  const kinds = new Array(width * height).fill(null)
  const pixels = new Uint8Array(width * height * 4)
  const color = new THREE.Color()
  const doors = []
  const flowers = []
  const grass = []
  for (let y = 0; y < height; y++) {
    const row = rows[y] || ''
    for (let x = 0; x < width; x++) {
      const ch = row[x] || ' '
      const tile = tiles[ch]
      const word = data.kind !== 'boss' && (ch === 'o' || ch === 't') && inWord(row, x)
      const kind = word ? 'sign' : classify(ch, tile, data.kind)
      kinds[y * width + x] = kind
      color.setHex(kind ? UNDER : GROUND[ch] || GROUND['`'])
      if (data.kind === 'boss' && !kind) color.setHex(ch === '=' ? 0x3d3530 : 0x2b211c)
      const shade = 0.95 + hash(x, y) * 0.1
      const i = ((height - 1 - y) * width + x) * 4
      pixels[i] = Math.min(255, color.r * 255 * shade)
      pixels[i + 1] = Math.min(255, color.g * 255 * shade)
      pixels[i + 2] = Math.min(255, color.b * 255 * shade)
      pixels[i + 3] = 255
      if (!kind && ch === '*') flowers.push([x, y])
      if (!kind && ch === '"') grass.push([x, y])
      if (kind === 'door') doors.push({ x, y, ch, name: tile ? tile.name : ch })
    }
  }
  // Suavizado: el suelo se lee como terreno y no como una grilla de cuadritos.
  const groundTexture = new THREE.DataTexture(pixels, width, height)
  groundTexture.magFilter = THREE.LinearFilter
  groundTexture.minFilter = THREE.LinearMipmapLinearFilter
  groundTexture.generateMipmaps = true
  groundTexture.colorSpace = THREE.SRGBColorSpace
  groundTexture.needsUpdate = true
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width * CX, height * CZ),
    new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 1 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set((width * CX) / 2, 0, (height * CZ) / 2)
  ground.receiveShadow = true
  group.add(ground)

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

  // Arboles, piedras y flores, de pocos poligonos.
  const scatter = (list, geometry, mat) => {
    if (!list.length) return
    const mesh = new THREE.InstancedMesh(geometry, mat, list.length)
    const s = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    list.forEach(([x, y], i) => {
      const k = 0.8 + hash(x, y) * 0.5
      q.setFromAxisAngle(up, hash(y, x) * Math.PI * 2)
      mesh.setMatrixAt(i, m.compose(toWorld(x, y), q, s.set(k, k, k)))
    })
    mesh.castShadow = true
    group.add(mesh)
  }
  const at = (kind) => {
    const list = []
    kinds.forEach((k, i) => {
      if (k === kind) list.push([i % width, Math.floor(i / width)])
    })
    return list
  }
  const trees = at('tree')
  scatter(
    trees,
    new THREE.ConeGeometry(0.6, 2.6, 6).translate(0, 1.7, 0),
    new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.9 })
  )
  scatter(
    trees,
    new THREE.CylinderGeometry(0.08, 0.1, 0.5, 5).translate(0, 0.25, 0),
    new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.9 })
  )
  scatter(
    at('rock'),
    new THREE.DodecahedronGeometry(0.28).translate(0, 0.18, 0),
    new THREE.MeshStandardMaterial({ color: 0x7c776f, roughness: 0.95 })
  )
  scatter(
    flowers,
    new THREE.SphereGeometry(0.08, 5, 3).translate(0, 0.08, 0),
    new THREE.MeshStandardMaterial({ color: 0xe86fa3, emissive: 0x6a1f3c, roughness: 0.6 })
  )
  // Matas en el pasto alto: tres hojas por celda, de pocos poligonos.
  const blades = mergeGeometries(
    [-0.12, 0, 0.12].map((dx, k) =>
      new THREE.ConeGeometry(0.07, 0.5 + k * 0.1, 3)
        .rotateZ(dx * 1.5)
        .translate(dx, 0.25, (k - 1) * 0.08)
    )
  )
  scatter(grass, blades, new THREE.MeshStandardMaterial({ color: 0x5d8a3a, roughness: 0.9 }))

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
