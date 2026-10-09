// El mundo de RUNA en 3D. Cada caracter del mapa ASCII del juego sube como un
// bloque con la altura y el color de lo que es, segun la tabla TILES del juego
// (lib/map.js): una pared es pared y una puerta es puerta en los dos lados. Las
// letras que el arte pinta en los edificios quedan como bloques con su letra.
import * as THREE from 'three'

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { document } = globalThis

// Una celda de terminal es el doble de alta que de ancha (lib/map.js): en 3D una
// columna mide CX y una fila CZ.
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

// Lo que sube: altura y material por clase.
const BLOCKS = {
  wall: { h: 2.6, color: 0x8b867b },
  masonry: { h: 2.2, color: 0x6e6a62 },
  roof: { h: 3.3, color: 0x8a3f2e },
  window: { h: 2.9, color: 0xf1c27a, glow: 0.8 },
  ornament: { h: 2.8, color: 0xc9a245, metal: true },
  building: { h: 2.5, color: 0x9c968a },
  fountain: { h: 0.7, color: 0x5aa0c8, glow: 0.35 },
  body: { h: 2.5, color: 0x77726a },
  frame: { h: 2.7, color: 0x5b564e },
  sign: { h: 1.4, color: 0xe0c060, glyph: true },
  door: { h: 0.12, color: 0xe0c060, glow: 1, glyph: true },
  water: { h: 0.08, color: 0x2f6f9f, glow: 0.25, sink: 0.05 },
  lava: { h: 0.12, color: 0xff5a1a, glow: 1.6, sink: 0.04 },
  portal: { h: 1.2, color: 0x9a6bff, glow: 1.4 }
}

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
    if (ch === 'x') return 'ornament'
  }
  if (ch === ' ') return 'body'
  if (!tile) return 'frame'
  if (!tile.solid) return tile.id.startsWith('door.') || tile.id.startsWith('gate.') ? 'door' : null
  if (tile.id === 'tree') return 'tree'
  if (tile.id === 'rock') return 'rock'
  if (tile.id === 'water') return 'water'
  if (tile.id === 'nowhere') return 'frame'
  return BLOCKS[tile.id] ? tile.id : 'frame'
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
  sprite.scale.set(canvas.width / 110, canvas.height / 110, 1)
  sprite.renderOrder = 10
  return sprite
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/**
 * Arma el mapa. `data` es /world/<id>.json. `extras` trae lo que vive en la
 * pagina: figure(color) para los NPC y glb(file) para los modelos de Tripo.
 */
export function buildWorld(data, extras = {}) {
  const { width, height, rows, tiles } = data
  const group = new THREE.Group()
  const toWorld = (x, y) => new THREE.Vector3(x * CX + CX / 2, 0, y * CZ + CZ / 2)

  // Suelo: una textura con un pixel por celda.
  const pixels = new Uint8Array(width * height * 4)
  const color = new THREE.Color()
  const cells = {}
  const add = (kind, cell) => {
    if (!cells[kind]) cells[kind] = []
    cells[kind].push(cell)
  }
  const doors = []
  for (let y = 0; y < height; y++) {
    const row = rows[y] || ''
    for (let x = 0; x < width; x++) {
      const ch = row[x] || ' '
      const tile = tiles[ch]
      const word = data.kind !== 'boss' && (ch === 'o' || ch === 't') && inWord(row, x)
      const kind = word ? 'sign' : classify(ch, tile, data.kind)
      color.setHex(kind ? UNDER : GROUND[ch] || GROUND['`'])
      if (data.kind === 'boss' && !kind) color.setHex(ch === '=' ? 0x3d3530 : 0x2b211c)
      const shade = 0.9 + hash(x, y) * 0.2
      const i = ((height - 1 - y) * width + x) * 4
      pixels[i] = Math.min(255, color.r * 255 * shade)
      pixels[i + 1] = Math.min(255, color.g * 255 * shade)
      pixels[i + 2] = Math.min(255, color.b * 255 * shade)
      pixels[i + 3] = 255
      if (!kind) {
        if (ch === '*') add('flower', [x, y, ch])
        continue
      }
      add(kind, [x, y, ch])
      if (kind === 'door') doors.push({ x, y, ch, name: tile ? tile.name : ch })
    }
  }
  const groundTexture = new THREE.DataTexture(pixels, width, height)
  groundTexture.magFilter = THREE.NearestFilter
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

  // Bloques, una malla instanciada por clase.
  const matrix = new THREE.Matrix4()
  for (const [kind, list] of Object.entries(cells)) {
    const spec = BLOCKS[kind]
    if (!spec) continue
    const geometry = new THREE.BoxGeometry(CX * 0.98, spec.h, CZ * 0.98)
    if (spec.glyph) {
      const glyphs = new Float32Array(list.length * 2)
      list.forEach(([, , ch], i) => glyphs.set(glyphCell(ch), i * 2))
      geometry.setAttribute('glyphCell', new THREE.InstancedBufferAttribute(glyphs, 2))
    }
    const mesh = new THREE.InstancedMesh(geometry, material(spec), list.length)
    list.forEach(([x, y], i) => {
      const p = toWorld(x, y)
      matrix.makeTranslation(p.x, spec.h / 2 - (spec.sink || 0), p.z)
      mesh.setMatrixAt(i, matrix)
    })
    mesh.castShadow = spec.h > 1
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // Arboles, piedras y flores.
  const scatter = (list, geometry, mat) => {
    if (!list || !list.length) return
    const mesh = new THREE.InstancedMesh(geometry, mat, list.length)
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    list.forEach(([x, y], i) => {
      const k = 0.8 + hash(x, y) * 0.5
      q.setFromAxisAngle(up, hash(y, x) * Math.PI * 2)
      matrix.compose(toWorld(x, y), q, s.set(k, k, k))
      mesh.setMatrixAt(i, matrix)
    })
    mesh.castShadow = true
    group.add(mesh)
  }
  scatter(
    cells.tree,
    new THREE.ConeGeometry(0.55, 2.4, 7).translate(0, 1.6, 0),
    new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.9 })
  )
  scatter(
    cells.tree,
    new THREE.CylinderGeometry(0.08, 0.1, 0.5, 6).translate(0, 0.25, 0),
    new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.9 })
  )
  scatter(
    cells.rock,
    new THREE.DodecahedronGeometry(0.28).translate(0, 0.18, 0),
    new THREE.MeshStandardMaterial({ color: 0x7c776f, roughness: 0.95 })
  )
  scatter(
    cells.flower,
    new THREE.SphereGeometry(0.07, 6, 4).translate(0, 0.08, 0),
    new THREE.MeshStandardMaterial({ color: 0xe86fa3, emissive: 0x6a1f3c, roughness: 0.6 })
  )

  // Puertas: una columna de luz y el nombre.
  for (const door of doors) {
    const p = toWorld(door.x, door.y)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3.4, 10, 1, true),
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

  // NPC: stickmen del color que usa la terminal, con su nombre.
  for (const npc of data.npcs || []) {
    if (!extras.figure) break
    const body = extras.figure(npc.color)
    const p = toWorld(npc.x, npc.y)
    body.position.copy(p)
    body.scale.setScalar(0.85)
    body.rotation.y = hash(npc.x, npc.y) * Math.PI * 2
    group.add(body)
    const tag = label(npc.name, '#d8d8d0')
    tag.position.set(p.x, 2.6, p.z)
    group.add(tag)
  }

  // Modelos de Tripo como hitos: la estatua de los heroes es el heroe de Tripo,
  // y el Coloso vive en su arena.
  const loads = []
  const place = (file, center, size) => {
    if (!extras.glb) return
    loads.push(
      extras
        .glb(file)
        .then((object) => {
          if (!object) return
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
      new THREE.CylinderGeometry(1.4, 1.6, 0.8, 24),
      new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 0.9 })
    )
    plinth.position.set(center.x, 0.4, center.z)
    plinth.castShadow = true
    group.add(plinth)
    place('heroe.glb', center.setY(0.8), 3.2)
    const tag = label(mark.name)
    tag.position.set(center.x, 4.8, center.z)
    group.add(tag)
  }
  if (data.boss) place('coloso.glb', toWorld(data.boss.x, data.boss.y), 7)

  return {
    group,
    toWorld,
    size: new THREE.Vector2(width * CX, height * CZ),
    loading: Promise.all(loads),
    dispose() {
      const free = (node) => {
        if (node.userData.shared) return
        if (node.geometry) node.geometry.dispose()
        for (const m of node.material ? [node.material].flat() : []) {
          if (m.map && m.map !== atlas) m.map.dispose()
          m.dispose()
        }
        for (const child of node.children) free(child)
      }
      free(group)
    }
  }
}
