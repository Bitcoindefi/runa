// Los campamentos barbaros en 3D: los tres asentamientos de lib/barbarian-camp.js
// (colmillo rojo, hachas negras y cuervos ceniza), que comparten el mismo plano
// de 108x46 y solo cambian de nombre y de color.
//
// Es un lugar de adentro de la pradera (pradera.js addPlace): campPlace(PARTS)
// devuelve { mode: 'barbarian-camp', data, landmarks, hint }. data() trae el
// plano de lugares.js campData sin `build`: el suelo, el pasto y los cerros de
// afuera los arma buildWorld como en la pradera. Lo de aca (landmarks) cuelga
// del grupo del mapa:
//
//   la empalizada del borde y las cuatro cajas de empalizada (estacas en un
//   InstancedMesh, las cajas rellenas de tierra con torres de guardia), los
//   caballos de frisa del norte, la casa del caudillo (hecha en codigo), las
//   carpas de Kenney (kenney-nature) con lo que guarda cada una, el fuego con
//   su llama, una luz y humo, el porton con sus hojas y estandartes, la forja,
//   el corral, el cartel del nombre y los carteles de la terminal
//
// Las piezas de la fachada de la pradera (estacas, torres, totem, cercos,
// estandarte) llegan por PARTS.camp, asi el campamento y su fachada se parecen.
// Lo que cambia en la partida se lee del Field en cada cuadro: cuando no queda
// ningun barbaro (remaining 0 o state.completed) las hojas del porton se abren
// del todo, los estandartes bajan y el cartel del porton dice que esta
// despejado. Los rectangulos de lo solido van a built.blocks con su alto, para
// el brazo de la camara en tercera persona. Los barbaros y el combate son los
// de la pradera (Crowd, Effects).
import * as THREE from 'three'
import { campData } from './lugares.js'
import { labels } from './mundo.js'

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { document, performance } = globalThis

const KENNEY = 'kenney-nature/'
// Las carpas de Kenney miden 0.88 m de ancho: asi quedan de unos 3.8 m.
const TENT_SCALE = 4.3
const STONE = 0x6a6660
const HIDE = 0xc8a878
const HIDE_DARK = 0x8a6a48
const THATCH = 0x7a6040
const GOLD = 0xf2c94a
const EARTH = 0x5a4632
const COAL = 0xff7a2a

// Los nombres de las carpas en ingles (en castellano van como en la terminal).
const TENT_NAMES = {
  'casa del caudillo': "chieftain's hall",
  guerreros: 'warriors',
  jabalinas: 'javelins',
  'pieles y grano': 'hides and grain',
  'botin robado': 'stolen loot'
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

// Un punto blando para el humo y las chispas.
function softDot() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const g = canvas.getContext('2d')
  const halo = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  halo.addColorStop(0, 'rgba(255, 255, 255, 1)')
  halo.addColorStop(0.45, 'rgba(255, 255, 255, 0.45)')
  halo.addColorStop(1, 'rgba(255, 255, 255, 0)')
  g.fillStyle = halo
  g.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Particulas que suben de (x, z) y se apagan arriba: la altura la lleva el
// reloj en la GPU (como las chispas del portal de la pradera). `spec` dice
// cuantas, el ancho, el alto, la velocidad, el tamano, el color y la mezcla.
function rising(x, z, clock, dot, spec) {
  const { count, spread, top, speed, size, color, opacity, additive, drift } = spec
  const position = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const a = hash(i, 3) * Math.PI * 2
    const r = hash(i, 5) * spread
    position[i * 3] = x + Math.cos(a) * r
    position[i * 3 + 1] = hash(i, 9) * top
    position[i * 3 + 2] = z + Math.sin(a) * r
    seed[i] = hash(i, 11)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('seed', new THREE.BufferAttribute(seed, 1))
  const material = new THREE.PointsMaterial({
    map: dot,
    color,
    size,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
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
        float rise = mod( position.y + clock * ${speed.toFixed(2)} * ( 0.6 + seed * 0.8 ), ${top.toFixed(1)} );
        float k = rise / ${top.toFixed(1)};
        transformed.y = 0.6 + rise;
        transformed.x += sin( clock * 0.7 + seed * 20.0 ) * ${drift.toFixed(2)} * k + k * k * ${(drift * 2).toFixed(2)};
        transformed.z += cos( clock * 0.5 + seed * 13.0 ) * ${drift.toFixed(2)} * k;
        vFade = smoothstep( 0.0, 0.12, k ) * ( 1.0 - k );`
      )
      .replace(
        'gl_PointSize = size;',
        `gl_PointSize = size * ( 0.6 + ${additive ? '0.0' : '1.6'} * clamp( transformed.y / ${top.toFixed(1)}, 0.0, 1.0 ) );`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFade;')
  }
  material.customProgramCacheKey = () => 'runa-camp-rise-' + (additive ? 'a' : 'n') + speed
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 4
  return points
}

// ---------------------------------------------------------------------------
// Lo fijo del campamento: se arma una vez cada vez que se muestra.

// Las mallas fijas de cada campamento (por id y medida de celda): son pocas y
// se guardan para la proxima vez que se entra.
const SHAPES = new Map()

// Un juego de piezas que no arma nada: se usa cuando las mallas ya estan
// guardadas y solo hacen falta las listas que salen de recorrer el plano.
class Idle {
  constructor() {
    this.parts = []
  }

  add() {}
  box() {}
  cyl() {}
  cone() {}
  ball() {}
  stick() {}
  geometry() {
    return null
  }
}

function buildCamp(world, ctx, field, parts) {
  const start = performance.now()
  const { Kit, glowMaterial, flameMaterial, flame } = parts
  const pieces = parts.camp
  const plan = world.data.campamento
  const { width, height } = world.data
  const wx = parts.wx
  const wz = parts.wz
  const CX = wx(1) - wx(0)
  const CZ = wz(1) - wz(0)
  const L = ctx.L || ((en, es) => es)
  const color = parts.CAMP_COLORS[plan.id] || 0x8a3a2a
  const WOOD = parts.WOOD
  const WOOD_DARK = parts.WOOD_DARK
  const IRON = parts.IRON
  const BONE = parts.BONE

  const group = new THREE.Group()
  group.name = 'camp-' + plan.id
  // Lo que tarda cada parte, para medir en un celular (group.userData.stages).
  const stages = {}
  let mark = start
  const stage = (name) => {
    const now = performance.now()
    stages[name] = Math.round(now - mark)
    mark = now
  }
  const owned = { geometries: [], materials: [], textures: [] }
  const keep = (mesh) => {
    owned.geometries.push(mesh.geometry)
    for (const m of [mesh.material].flat()) owned.materials.push(m)
    group.add(mesh)
    return mesh
  }
  // Las mallas fijas se arman la primera vez y se guardan por campamento: al
  // volver a entrar solo se cuentan las listas (estacas, modelos, alturas) y
  // las piezas van a un juego que no hace nada.
  const shapeKey = [plan.id, CX, CZ].join('|')
  const cached = SHAPES.get(shapeKey) || null
  const kit = () => (cached ? new Idle() : new Kit())
  const solid = kit()
  const fire = kit()
  const flags = kit()
  const flames = []
  const clock = { value: 0 }
  const stakes = []
  // El alto de lo solido en cada celda, para la camara.
  const tops = new Float32Array(width * height)
  const raise = (x0, y0, x1, y1, top) => {
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) {
        tops[y * width + x] = Math.max(tops[y * width + x], top)
      }
    }
  }

  // Una hilera de estacas de a hacia b (metros), para el InstancedMesh.
  const row = (ax, az, bx, bz, tall = 1) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.36))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      stakes.push({ x, z, k: hash(Math.round(x * 10), Math.round(z * 10)), tall })
    }
  }

  // La empalizada del borde: las cuatro filas de celdas del contorno, con un
  // hueco al sur detras del porton, por donde sale el camino.
  const gate = plan.gate
  const gapW = wx(gate.x0 + 1)
  const gapE = wx(gate.x1 - 1)
  row(wx(0), wz(0), wx(width - 1), wz(0))
  row(wx(0), wz(height - 1), gapW, wz(height - 1))
  row(gapE, wz(height - 1), wx(width - 1), wz(height - 1))
  row(wx(0), wz(0), wx(0), wz(height - 1))
  row(wx(width - 1), wz(0), wx(width - 1), wz(height - 1))
  raise(0, 0, width - 1, 0, 2.6)
  raise(0, height - 1, width - 1, height - 1, 2.6)
  raise(0, 0, 0, height - 1, 2.6)
  raise(width - 1, 0, width - 1, height - 1, 2.6)

  // Los caballos de frisa del norte (los ^ de la fila 1): dos estacas cruzadas
  // que apuntan afuera.
  for (const x of plan.spikes) {
    const cx = wx(x)
    const cz = wz(1)
    for (const s of [-1, 1]) {
      solid.stick([cx - 0.32 * s, 0.02, cz + 0.32], [cx + 0.18 * s, 1.05, cz - 0.38], 0.07, WOOD, {
        tip: 0.012
      })
    }
    solid.box(0.9, 0.09, 0.09, cx, 0.42, cz, WOOD_DARK)
    raise(x, 1, x, 1, 1)
  }

  // Las cajas de empalizada: estacas en el contorno, tierra apisonada adentro
  // con un piso de tablas y una torre de guardia en la punta que da al cruce.
  for (const box of plan.palisades) {
    const x0 = wx(box.x0)
    const x1 = wx(box.x1)
    const z0 = wz(box.y0)
    const z1 = wz(box.y1)
    row(x0, z0, x1, z0)
    row(x0, z1, x1, z1)
    row(x0, z0, x0, z1)
    row(x1, z0, x1, z1)
    const w = x1 - x0 - 0.3
    const d = z1 - z0 - 0.3
    solid.box(w, 1.7, d, (x0 + x1) / 2, 0.85, (z0 + z1) / 2, EARTH)
    solid.box(w, 0.08, d, (x0 + x1) / 2, 1.74, (z0 + z1) / 2, WOOD)
    for (let z = z0 + 0.6; z < z1 - 0.3; z += 1.2) {
      solid.box(w + 0.02, 0.1, 0.12, (x0 + x1) / 2, 1.79, z, WOOD_DARK)
    }
    const north = box.y0 < height / 2
    const ty = north ? box.y1 - 1.6 : box.y0 + 1.6
    pieces.watchtower(solid, (x0 + x1) / 2, wz(ty), color)
    raise(box.x0, box.y0, box.x1, box.y1, 2.6)
    raise(box.x0, Math.floor(ty - 1), box.x1, Math.ceil(ty + 1), 5.3)
  }

  // El cartel del nombre (fila 2): una tabla larga sobre postes con calaveras.
  if (plan.title) {
    const t = plan.title
    const ax = wx(t.x0) - 0.1
    const bx = wx(t.x1) + 0.1
    const z = wz(t.y)
    solid.box(bx - ax, 0.55, 0.1, (ax + bx) / 2, 1.35, z, WOOD)
    solid.box(bx - ax + 0.2, 0.1, 0.16, (ax + bx) / 2, 1.66, z, WOOD_DARK)
    solid.box(bx - ax, 0.08, 0.12, (ax + bx) / 2, 1.08, z + 0.01, color)
    const posts = Math.max(2, Math.round((bx - ax) / 3) + 1)
    for (let i = 0; i < posts; i++) {
      const x = ax + ((bx - ax) * i) / (posts - 1)
      solid.box(0.16, 1.9, 0.16, x, 0.95, z, WOOD_DARK)
      solid.ball(0.13, x, 2.0, z, BONE, { detail: 0 })
    }
    raise(t.x0, t.y, t.x1, t.y, 2.1)
  }

  // Los cercos con cartel (---[ empalizada ]---) y el corral y la forja.
  const corral = plan.signs.find((s) => s.kind === 'pen' && s.label === 'corral')
  const forge = plan.signs.find((s) => s.kind === 'pen' && s.label !== 'corral')
  for (const sign of plan.signs) {
    if (sign.kind !== 'fence') continue
    const z = wz(sign.y)
    pieces.lowFence(solid, wx(sign.x0), wx(sign.x1), z)
    // Escudos del color del campamento colgados del cerco.
    for (let x = wx(sign.x0) + 1.3; x < wx(sign.x1) - 0.8; x += 2.6) {
      solid.cyl(0.32, 0.32, 0.06, 10, x, 0.62, z + 0.08, color, { rx: Math.PI / 2 })
      solid.ball(0.07, x, 0.62, z + 0.12, IRON, { detail: 0 })
    }
    raise(sign.x0, sign.y, sign.x1, sign.y, 1)
  }
  if (corral) {
    const ax = wx(corral.x0)
    const bx = wx(corral.x1)
    const z = wz(corral.y)
    pieces.lowFence(solid, ax, bx, z)
    for (const x of [ax, bx]) solid.cyl(0.12, 0.12, 1.1, 6, x, 0.55, z, WOOD_DARK)
    // El bebedero y las pacas de heno.
    solid.box(1.5, 0.32, 0.42, ax + 1.6, 0.16, z + 0.22, WOOD_DARK)
    solid.box(1.36, 0.04, 0.3, ax + 1.6, 0.31, z + 0.22, 0x3a5a6a, { glow: 0.1 })
    for (let i = 0; i < 3; i++) {
      const x = bx - 1.2 - i * 0.95
      solid.box(0.85, 0.5, 0.55, x, 0.25 + (i === 1 ? 0.5 : 0), z + 0.1, 0xc8a850, {
        ry: (hash(i, 7) - 0.5) * 0.3
      })
    }
    solid.box(0.85, 0.5, 0.55, bx - 2.15, 0.25, z + 0.1, 0xb89a48, { ry: 0.12 })
    raise(corral.x0, corral.y, corral.x1, corral.y, 1.1)
  }
  if (forge) {
    const ax = wx(forge.x0)
    const bx = wx(forge.x1)
    const z = wz(forge.y)
    const mid = (ax + bx) / 2
    // El fogon de piedra con brasas, la campana y la chimenea.
    solid.box(1.5, 0.85, 0.9, mid - 1.4, 0.43, z, STONE)
    solid.box(1.2, 0.08, 0.6, mid - 1.4, 0.88, z, COAL, { glow: 1.4 })
    solid.box(1.3, 0.12, 0.7, mid - 1.4, 1.9, z, STONE)
    solid.cone(0.7, 0.7, 4, mid - 1.4, 2.25, z, STONE, { ry: Math.PI / 4, sz: 0.7 })
    solid.box(0.42, 1.5, 0.42, mid - 1.4, 3.1, z, STONE)
    for (const dx of [-0.65, 0.65]) {
      solid.box(0.12, 1.1, 0.12, mid - 1.4 + dx, 1.35, z + 0.35, WOOD_DARK)
    }
    // El yunque sobre un tronco.
    solid.cyl(0.26, 0.3, 0.55, 8, mid + 0.5, 0.28, z, WOOD)
    solid.box(0.55, 0.16, 0.24, mid + 0.5, 0.64, z, IRON)
    solid.box(0.3, 0.12, 0.16, mid + 0.5, 0.52, z, IRON)
    solid.cone(0.1, 0.3, 4, mid + 0.92, 0.66, z, IRON, { rz: Math.PI / 2 })
    // El barril de templar y el soporte con hachas.
    solid.cyl(0.3, 0.27, 0.7, 10, mid + 1.6, 0.35, z, WOOD_DARK)
    solid.cyl(0.26, 0.26, 0.02, 10, mid + 1.6, 0.68, z, 0x2a3a40)
    const rack = bx - 1.1
    solid.box(1.6, 0.1, 0.1, rack, 1.15, z - 0.2, WOOD_DARK)
    for (const dx of [-0.75, 0.75]) solid.box(0.1, 1.25, 0.1, rack + dx, 0.62, z - 0.2, WOOD_DARK)
    for (let i = 0; i < 3; i++) {
      const x = rack - 0.5 + i * 0.5
      solid.stick([x, 0.05, z + 0.05], [x, 1.25, z - 0.2], 0.03, WOOD)
      solid.box(0.06, 0.28, 0.22, x, 1.2, z - 0.12, IRON)
    }
    raise(forge.x0, forge.y, forge.x1, forge.y, 1.4)
    raise(forge.x0, forge.y, forge.x0 + 6, forge.y, 3.8)
  }

  // El fuego: piedras en ronda, lenos, tres llamas, la olla en su tripode y los
  // bancos de troncos de la fila del cartel.
  let fx = null
  let fz = null
  if (plan.fire) {
    fx = wx(plan.fire.x)
    fz = wz(plan.fire.y)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const r = 1.05 + hash(i, 2) * 0.1
      solid.ball(
        0.2 + hash(i, 4) * 0.06,
        fx + Math.cos(a) * r,
        0.1,
        fz + Math.sin(a) * r * 0.8,
        STONE,
        {
          detail: 0,
          sy: 0.7
        }
      )
    }
    for (const a of [0.4, -0.5, 1.6]) {
      solid.box(1.3, 0.16, 0.16, fx, 0.14, fz, WOOD_DARK, { ry: a })
    }
    solid.cyl(0.7, 0.75, 0.04, 12, fx, 0.03, fz, 0x2a1a12, { glow: 0.5 })
    flames.push([fx, 0.12, fz, 1.5, null])
    flames.push([fx - 0.35, 0.1, fz + 0.15, 0.9, null])
    flames.push([fx + 0.3, 0.1, fz - 0.1, 1.0, null])
    // El tripode con la olla, sobre la fila /||\ que esta al sur del fuego.
    const tz = fz + 1.6
    for (const [dx, dz] of [
      [-0.55, -0.3],
      [0.55, -0.3],
      [0, 0.45]
    ]) {
      solid.stick([fx + dx, 0, tz + dz], [fx, 1.6, tz], 0.04, WOOD_DARK)
    }
    solid.stick([fx, 1.6, tz], [fx, 0.85, tz], 0.012, IRON)
    solid.ball(0.3, fx, 0.7, tz, 0x2a2a2a, { sy: 0.8 })
    // Los bancos de troncos (la fila --- fuego ---).
    const benchZ = fz + 2.6
    for (const [a, b] of [
      [fx - 3.2, fx - 1.0],
      [fx + 1.0, fx + 3.0]
    ]) {
      solid.stick([a, 0.22, benchZ], [b, 0.22, benchZ], 0.2, WOOD, { segments: 7 })
    }
    raise(
      Math.floor(plan.fire.x) - 1,
      Math.floor(plan.fire.y) - 1,
      Math.ceil(plan.fire.x) + 1,
      Math.ceil(plan.fire.y) + 3,
      0.6
    )
  }

  // Las carpas: la mas ancha es la casa del caudillo (hecha en codigo); las
  // otras cuatro llevan tres carpas de Kenney cada una, con lo que guardan.
  const tents = [...plan.tents]
  const hall = tents.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a), tents[0])
  const props = new Map()
  const tentSpots = []
  const prop = (name, x, z, ry, s) => {
    if (!props.has(name)) props.set(name, [])
    props.get(name).push({ x, z, ry, s })
  }
  for (const tent of tents) {
    const x0 = wx(tent.x0) - CX / 2
    const x1 = wx(tent.x1) + CX / 2
    const z0 = wz(tent.y0) - CZ / 2
    const z1 = wz(tent.y1) + CZ / 2
    const mid = (x0 + x1) / 2
    const zc = (z0 + z1) / 2
    if (tent === hall) {
      longhouse(solid, x0, x1, z0, z1, wx(tent.door.x))
      raise(tent.x0, tent.y0, tent.x1, tent.y1, 4.2)
      continue
    }
    const wide = x1 - x0
    for (let i = 0; i < 3; i++) {
      const x = x0 + (wide * (i * 2 + 1)) / 6
      const z = zc - 0.25
      prop(i === 1 ? 'tent_detailedOpen' : 'tent_detailedClosed', x, z, 0, TENT_SCALE)
      tentSpots.push({ name: i === 1 ? 'tent_detailedOpen' : 'tent_detailedClosed', x, z })
    }
    raise(tent.x0, tent.y0, tent.x1, tent.y1, 2.4)
    // Lo que guarda cada carpa, al frente (en la fila del piso, que no se pisa).
    const fz0 = z1 - 0.35
    const what = tent.label
    if (what === 'botin robado') {
      solid.box(0.7, 0.45, 0.45, mid + 0.4, 0.23, fz0, 0x7a4a24)
      solid.box(0.74, 0.08, 0.49, mid + 0.4, 0.47, fz0, 0xd8b050)
      solid.ball(0.32, mid - 0.6, 0.12, fz0, GOLD, { detail: 1, sy: 0.4, glow: 0.25 })
      solid.ball(0.2, mid - 1.2, 0.08, fz0 + 0.05, GOLD, { detail: 1, sy: 0.4, glow: 0.25 })
      prop('pot_large', x1 - 1.3, fz0, 0.4, 1.6)
    } else if (what === 'pieles y grano') {
      for (let i = 0; i < 4; i++) {
        solid.ball(0.26, mid - 0.9 + i * 0.5, 0.24, fz0, 0xc8b080, { detail: 1, sy: 1.2 })
      }
      // Un bastidor con una piel estirada.
      solid.box(0.08, 1.5, 0.08, x0 + 1.0, 0.75, fz0, WOOD_DARK)
      solid.box(0.08, 1.5, 0.08, x0 + 2.2, 0.75, fz0, WOOD_DARK)
      solid.box(1.1, 1.0, 0.03, x0 + 1.6, 0.85, fz0, 0x8a6040)
    } else if (what === 'jabalinas') {
      // Un soporte con jabalinas apoyadas.
      solid.box(2.2, 0.08, 0.08, mid, 1.1, fz0 - 0.15, WOOD_DARK)
      for (let i = 0; i < 7; i++) {
        const x = mid - 1.0 + i * 0.33
        solid.stick([x, 0, fz0 + 0.12], [x + 0.05, 1.9, fz0 - 0.2], 0.025, WOOD, { tip: 0.02 })
        solid.cone(0.04, 0.2, 4, x + 0.055, 2.0, fz0 - 0.22, IRON)
      }
    } else {
      // Guerreros: escudos del campamento apoyados y un leno de hachar.
      for (let i = 0; i < 3; i++) {
        solid.cyl(0.34, 0.34, 0.06, 10, mid - 0.8 + i * 0.8, 0.36, fz0, i === 1 ? WOOD : color, {
          rx: Math.PI / 2 - 0.25
        })
      }
      solid.cyl(0.3, 0.34, 0.5, 8, x1 - 1.4, 0.25, fz0, WOOD)
      solid.box(0.05, 0.5, 0.2, x1 - 1.4, 0.65, fz0, IRON, { rz: 0.4 })
    }
    if (what !== 'botin robado') prop('log_stack', x1 - 0.6, fz0 - 0.5, Math.PI / 2, 1.8)
  }

  // La casa del caudillo: paredes de troncos, techo de dos aguas con la
  // cumbrera a lo largo, cabezas cruzadas en los hastiales, escudos en el
  // frente, la puerta con calaveras, dos totems y el estandarte.
  function longhouse(kit, x0, x1, z0, z1, doorX) {
    // El frente queda mas adentro: los totems y los estandartes van en la
    // ultima fila de la carpa, que no se pisa, y no bajo el alero.
    const ax = x0 + 0.3
    const bx = x1 - 0.3
    const az = z0 + 0.3
    const bz = z1 - 0.95
    const wall = 2.1
    const ridge = 4.7
    const zc = (az + bz) / 2
    for (let i = 0; i < 6; i++) {
      const y = 0.17 + i * 0.34
      const tone = i % 2 ? WOOD : WOOD_DARK
      kit.stick([ax, y, az], [bx, y, az], 0.17, tone, { segments: 6 })
      kit.stick([ax, y, az], [ax, y, bz], 0.17, WOOD_DARK, { segments: 6 })
      kit.stick([bx, y, az], [bx, y, bz], 0.17, WOOD_DARK, { segments: 6 })
      if (y > 1.9) {
        kit.stick([ax, y, bz], [bx, y, bz], 0.17, tone, { segments: 6 })
      } else {
        kit.stick([ax, y, bz], [doorX - 0.8, y, bz], 0.17, tone, { segments: 6 })
        kit.stick([doorX + 0.8, y, bz], [bx, y, bz], 0.17, tone, { segments: 6 })
      }
    }
    // Postes en las esquinas y cada tanto en el frente.
    for (let x = ax; x <= bx + 0.01; x += (bx - ax) / 6) {
      kit.box(0.26, wall + 0.1, 0.26, x, (wall + 0.1) / 2, bz + 0.05, WOOD_DARK)
    }
    // Los hastiales: triangulos de tablas sobre las paredes cortas.
    const gable = new THREE.Shape()
    gable.moveTo(az - zc - 0.1, 0)
    gable.lineTo(bz - zc + 0.1, 0)
    gable.lineTo(0, ridge - wall)
    gable.lineTo(az - zc - 0.1, 0)
    for (const x of [ax, bx]) {
      kit.add(
        new THREE.ExtrudeGeometry(gable, { depth: 0.2, bevelEnabled: false }),
        WOOD,
        x - 0.1,
        wall,
        zc,
        {
          ry: Math.PI / 2
        }
      )
    }
    // El techo de paja: dos faldones en cinco hileras que se pisan, cada una
    // de otro tono y un poco mas afuera que la de arriba, y la cumbrera.
    const run = (bz - az) / 2 + 0.5
    const rise = ridge - wall + 0.3
    const slope = Math.atan2(rise, run)
    const len = Math.hypot(rise, run)
    const long = bx - ax + 1.0
    const TIERS = [THATCH, 0x8c7048, 0x6c5434, 0x846a44, 0x5e4a2e]
    for (const side of [-1, 1]) {
      const cz = zc + (side * run) / 2
      const cy = wall - 0.3 + rise / 2
      TIERS.forEach((tone, i) => {
        const t = (i + 0.5) / TIERS.length - 0.5
        const lift = 0.04 + i * 0.05
        kit.box(
          long + i * 0.06,
          0.2,
          len / TIERS.length + 0.25,
          (ax + bx) / 2,
          cy - t * rise + lift * Math.cos(slope),
          cz + side * (t * run + lift * Math.sin(slope)),
          tone,
          { rx: side * slope }
        )
      })
      // El borde del alero, desparejo.
      kit.box(long + 0.1, 0.12, 0.24, (ax + bx) / 2, wall - 0.3, zc + side * run, 0x4e3a22, {
        rx: side * slope
      })
    }
    kit.box(bx - ax + 1.2, 0.26, 0.26, (ax + bx) / 2, ridge + 0.1, zc, WOOD_DARK)
    // Las cabezas cruzadas en las puntas de la cumbrera.
    for (const [x, out] of [
      [ax - 0.4, -1],
      [bx + 0.4, 1]
    ]) {
      for (const s of [-1, 1]) {
        kit.stick(
          [x, ridge - 0.5, zc + s * 0.6],
          [x + out * 0.25, ridge + 0.9, zc - s * 0.35],
          0.08,
          WOOD_DARK,
          {
            tip: 0.05
          }
        )
      }
      kit.ball(0.16, x + out * 0.2, ridge + 0.95, zc, BONE, { detail: 0 })
    }
    // El agujero del humo.
    kit.box(0.8, 0.45, 0.8, (ax + bx) / 2 + 3, ridge + 0.05, zc, WOOD_DARK)
    // La puerta: hoja oscura, marco, dintel con calaveras y cuernos.
    kit.box(1.5, 1.85, 0.12, doorX, 0.93, bz + 0.05, 0x1a120c)
    for (const dx of [-0.85, 0.85]) kit.box(0.22, 2.05, 0.22, doorX + dx, 1.03, bz + 0.2, WOOD_DARK)
    kit.box(2.1, 0.24, 0.28, doorX, 1.95, bz + 0.22, WOOD_DARK)
    for (const dx of [-0.5, 0, 0.5]) kit.ball(0.12, doorX + dx, 1.95, bz + 0.4, BONE, { detail: 0 })
    kit.cone(0.1, 0.45, 4, doorX - 1.0, 2.05, bz + 0.3, BONE, { rz: 1.0 })
    kit.cone(0.1, 0.45, 4, doorX + 1.0, 2.05, bz + 0.3, BONE, { rz: -1.0 })
    // Escudos a lo largo del frente.
    for (let x = ax + 1.1; x < bx - 0.6; x += 1.4) {
      if (Math.abs(x - doorX) < 1.6) continue
      const k = Math.round((x - ax) / 1.4)
      kit.cyl(0.36, 0.36, 0.06, 10, x, 1.15, bz + 0.2, k % 2 ? color : 0x8a6a42, {
        rx: Math.PI / 2
      })
      kit.ball(0.08, x, 1.15, bz + 0.24, IRON, { detail: 0 })
    }
    // Los totems y los estandartes a los lados de la puerta, fuera del alero.
    const front = z1 - 0.25
    pieces.totem(kit, doorX - 2.6, front)
    pieces.totem(kit, doorX + 2.6, front)
    pieces.banner(kit, doorX - 4.4, front - 0.1, color)
    pieces.banner(kit, doorX + 4.4, front - 0.1, color)
  }

  // El porton: el marco de la terminal (/----.----\ arriba, |    .    | y
  // =====U===== abajo) como una empalizada baja (asi la camara ve por encima),
  // dos postes altos con dintel a cada lado del paso, las hojas (abiertas a
  // medias mientras quedan barbaros) y dos estandartes que bajan cuando el
  // campamento queda despejado.
  const exitX = wx(plan.exit.x)
  const gz0 = wz(gate.y0)
  const gz1 = wz(gate.y1)
  const gw = wx(gate.x0)
  const ge = wx(gate.x1)
  const pass = CX / 2 + 0.05
  for (const z of [gz0, gz1]) {
    row(gw, z, exitX - pass - 0.2, z, 0.55)
    row(exitX + pass + 0.2, z, ge, z, 0.55)
  }
  row(gw, gz0, gw, gz1, 0.55)
  row(ge, gz0, ge, gz1, 0.55)
  // Los dinteles van altos y los postes abiertos (el paso del juego mide una
  // celda, pero los postes se paran sobre la empalizada baja de los costados):
  // la camara de tercera persona, detras del heroe en la entrada, lo ve por el
  // hueco sin que los postes lo encierren, y en un celular parado el dintel
  // queda arriba del cuadro en vez de taparle la mitad.
  const postX = 1.05
  for (const z of [gz0, gz1]) {
    for (const s of [-1, 1]) {
      const x = exitX + s * postX
      solid.box(0.26, 4.65, 0.26, x, 2.33, z, WOOD_DARK)
      solid.ball(0.15, x, 4.78, z, BONE, { detail: 0 })
    }
    solid.box(postX * 2 + 0.4, 0.26, 0.3, exitX, 4.32, z, WOOD_DARK)
  }
  // Una tabla con calaveras sobre el dintel de afuera.
  solid.box(pass * 2 + 0.5, 0.36, 0.08, exitX, 4.68, gz1 + 0.05, WOOD)
  for (const dx of [-0.3, 0.3]) solid.ball(0.11, exitX + dx, 4.68, gz1 + 0.13, BONE, { detail: 0 })
  // El camino de tierra que sale por el hueco de la empalizada.
  solid.box(1.6, 0.02, 4, exitX, 0.01, wz(height - 1) + 1.2, 0x7a6248)
  raise(gate.x0, gate.y0, gate.x1, gate.y1, 1.5)
  for (const x of [gw, ge]) {
    flags.box(0.05, 1.5, 0.9, x + 0.05, 2.9, gz1 + 0.5, color)
    flags.box(0.06, 0.12, 0.95, x + 0.05, 3.66, gz1 + 0.5, WOOD_DARK)
    solid.box(0.12, 4.4, 0.12, x, 2.2, gz1 + 0.05, WOOD_DARK)
    solid.ball(0.15, x, 4.5, gz1 + 0.05, BONE, { detail: 0 })
  }
  // Las hojas del porton: una malla cada una, girando en su bisagra.
  const leaf = kit()
  const leafW = pass + 0.1
  leaf.box(leafW, 2.1, 0.1, leafW / 2, 1.05, 0, WOOD)
  for (const y of [0.45, 1.65]) leaf.box(leafW, 0.14, 0.16, leafW / 2, y, 0.05, WOOD_DARK)
  leaf.stick([0.04, 0.5, 0.1], [leafW - 0.04, 1.6, 0.1], 0.05, WOOD_DARK)
  const leafGeometry = cached ? cached.leaf : leaf.geometry()
  const solidMaterial = glowMaterial({ roughness: 0.88 })
  owned.materials.push(solidMaterial)
  const doors = [-1, 1].map((s) => {
    const mesh = new THREE.Mesh(leafGeometry, solidMaterial)
    mesh.position.set(exitX + s * (pass + 0.12), 0, gz1 + 0.15)
    mesh.scale.x = -s
    mesh.castShadow = true
    group.add(mesh)
    return { mesh, s }
  })

  for (const [x, y, z, h, tint] of flames) flame(fire, x, y, z, h, tint)
  stage('pieces')

  // Las estacas: una geometria, una instancia por estaca.
  const stakeKit = kit()
  stakeKit.cyl(0.13, 0.15, 2.3, 6, 0, 1.15, 0, WOOD)
  stakeKit.cone(0.14, 0.34, 6, 0, 2.47, 0, 0x8a6a42)
  stakeKit.box(0.3, 0.06, 0.06, 0, 1.6, 0.13, WOOD_DARK)
  const shapes = cached || {
    leaf: leafGeometry,
    stake: stakeKit.geometry(),
    solid: solid.geometry(),
    flags: flags.geometry(),
    fire: flames.length ? fire.geometry() : null
  }
  if (!cached) SHAPES.set(shapeKey, shapes)
  const stakeMesh = new THREE.InstancedMesh(shapes.stake, solidMaterial, stakes.length)
  {
    const M = new THREE.Matrix4()
    const Q = new THREE.Quaternion()
    const E = new THREE.Euler()
    const P = new THREE.Vector3()
    const S = new THREE.Vector3()
    const C = new THREE.Color()
    stakes.forEach((s, i) => {
      const lean = (hash(i, 13) - 0.5) * 0.07
      E.set(lean, hash(i, 17) * Math.PI * 2, (hash(i, 19) - 0.5) * 0.07)
      Q.setFromEuler(E)
      M.compose(P.set(s.x, 0, s.z), Q, S.set(1, (0.92 + s.k * 0.22) * s.tall, 1))
      stakeMesh.setMatrixAt(i, M)
      const k = 0.78 + s.k * 0.36
      stakeMesh.setColorAt(i, C.setRGB(k, k * 0.97, k * 0.93))
    })
  }
  stakeMesh.castShadow = true
  stakeMesh.receiveShadow = true
  stakeMesh.computeBoundingSphere()
  stakeMesh.name = 'camp-stakes'
  group.add(stakeMesh)

  stage('stakes')
  const solidMesh = new THREE.Mesh(shapes.solid, solidMaterial)
  solidMesh.castShadow = true
  solidMesh.receiveShadow = true
  solidMesh.name = 'camp-solid'
  group.add(solidMesh)

  const flagMesh = new THREE.Mesh(shapes.flags, solidMaterial)
  flagMesh.castShadow = true
  group.add(flagMesh)

  if (shapes.fire) {
    const material = flameMaterial(clock)
    owned.materials.push(material)
    const fireMesh = new THREE.Mesh(shapes.fire, material)
    fireMesh.renderOrder = 3
    fireMesh.frustumCulled = false
    fireMesh.userData.shared = true
    group.add(fireMesh)
  }
  // Las geometrias guardadas no se liberan con el mapa.
  for (const mesh of [stakeMesh, solidMesh, flagMesh, ...doors.map((d) => d.mesh)]) {
    mesh.userData.shared = true
  }

  // Las carpas de pieles hechas en codigo en el lugar de las de Kenney que no
  // lleguen (o si no hay cc0).
  function standIn(name) {
    // El campamento ya se fue (el modelo fallo despues): no se arma nada.
    if (disposed) return
    const kit = new Kit()
    for (const spot of tentSpots) {
      if (!name || spot.name === name) pieces.hideTent(kit, spot.x, spot.z, HIDE)
    }
    const geometry = kit.geometry()
    if (!geometry) return
    const mesh = new THREE.Mesh(geometry, solidMaterial)
    mesh.castShadow = true
    owned.geometries.push(geometry)
    group.add(mesh)
  }

  // La luz del fuego, el humo y las chispas.
  const dot = softDot()
  owned.textures.push(dot)
  let light = null
  if (fx !== null) {
    light = new THREE.PointLight(0xff8a3a, 0, 16, 1.5)
    light.position.set(fx, 1.3, fz)
    light.castShadow = false
    group.add(light)
    keep(
      rising(fx, fz, clock, dot, {
        count: 46,
        spread: 0.35,
        top: 7,
        speed: 0.55,
        size: 2.2,
        color: 0x4a4440,
        opacity: 0.55,
        additive: false,
        drift: 0.6
      })
    )
    keep(
      rising(fx, fz, clock, dot, {
        count: 36,
        spread: 0.5,
        top: 3.2,
        speed: 1.1,
        size: 0.12,
        color: 0xffa040,
        opacity: 1,
        additive: true,
        drift: 0.35
      })
    )
  }

  // Los modelos de Kenney, uno por InstancedMesh por material. Si un modelo no
  // llega, el campamento sigue sin el (las carpas, con las de reemplazo).
  const cc0 = ctx.cc0
  let disposed = false
  const loads = []
  const M = new THREE.Matrix4()
  const Q = new THREE.Quaternion()
  const P = new THREE.Vector3()
  const S = new THREE.Vector3()
  const TONE = new THREE.Color()
  if (!cc0 || !cc0.parts) standIn(null)
  for (const [name, items] of props) {
    if (!cc0 || !cc0.parts) break
    const path = KENNEY + name + '.glb'
    loads.push(
      cc0
        .parts(path)
        .then((found) => {
          if (disposed) return
          for (const part of found) {
            // La lona roja de Kenney pasa a cuero curtido, cada carpa de un tono.
            const canvas = /^colorRed/.test(part.material.name || '')
            let material = part.material
            if (canvas) {
              material = part.material.clone()
              material.color.setHex(/Dark$/.test(part.material.name) ? HIDE_DARK : HIDE)
              owned.materials.push(material)
            }
            const mesh = new THREE.InstancedMesh(part.geometry, material, items.length)
            mesh.userData.shared = true
            items.forEach((it, i) => {
              Q.setFromAxisAngle(P.set(0, 1, 0), it.ry || 0)
              M.compose(P.set(it.x, 0, it.z), Q, S.setScalar(it.s))
              mesh.setMatrixAt(i, M)
              if (canvas) {
                const k = 0.82 + hash(i, 23) * 0.3
                mesh.setColorAt(i, TONE.setRGB(k, k * (0.94 + hash(i, 29) * 0.08), k * 0.9))
              }
            })
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
            mesh.instanceMatrix.needsUpdate = true
            mesh.computeBoundingSphere()
            mesh.castShadow = true
            mesh.receiveShadow = true
            mesh.name = 'camp-' + name
            group.add(mesh)
          }
        })
        .catch((error) => {
          console.warn('campamento: sin ' + path, error)
          if (name.startsWith('tent_')) standIn(name)
        })
    )
  }

  // La camara: los rectangulos de lo que no se alcanza a pie (y el borde), con
  // el alto de lo que hay encima.
  const rects = [
    ...plan.blocks,
    { x0: 0, x1: width - 1, y0: 0, y1: 0 },
    // El sur, sin el hueco del camino (alli la camara puede pasar).
    { x0: 0, x1: gate.x0, y0: height - 1, y1: height - 1 },
    { x0: gate.x1, x1: width - 1, y0: height - 1, y1: height - 1 },
    { x0: 0, x1: 0, y0: 1, y1: height - 2 },
    { x0: width - 1, x1: width - 1, y0: 1, y1: height - 2 }
  ]
  const blocks = rects.map((r) => {
    let top = 0
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) top = Math.max(top, tops[y * width + x])
    }
    return {
      x0: r.x0 * CX,
      x1: (r.x1 + 1) * CX,
      z0: r.y0 * CZ,
      z1: (r.y1 + 1) * CZ,
      top: top || 0.9
    }
  })

  stage('rest')
  const buildMs = Math.round(performance.now() - start)
  group.userData.buildMs = buildMs
  group.userData.stages = stages
  return {
    group,
    blocks,
    loading: Promise.all(loads),
    camp: { light, doors, flagMesh, fx, fz, exitX, gz1, color, buildMs, stakes: stakes.length },
    update(time) {
      clock.value = time
    },
    dispose() {
      disposed = true
      for (const child of [...group.children]) {
        if (child.isInstancedMesh) child.dispose()
      }
      if (light) light.dispose()
      for (const g of owned.geometries) g.dispose()
      for (const m of owned.materials) m.dispose()
      for (const t of owned.textures) t.dispose()
      // Lo compartido con cc0 no se libera con el mapa.
      group.traverse((node) => {
        if (node.isMesh && !node.userData.shared) node.userData.shared = true
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Lo que cambia: el porton y los estandartes, los carteles, la luz del fuego.

function campLive(world, ctx, field, parts) {
  const L = ctx.L || ((en, es) => es)
  const built = buildCamp(world, ctx, field, parts)
  const plan = world.data.campamento
  const wx = parts.wx
  const wz = parts.wz
  const group = built.group
  const camp = built.camp
  // Los bloques de la camara van con los del mapa mientras se ve.
  const blocks = world.built.blocks || (world.built.blocks = [])
  blocks.push(...built.blocks)
  // Sin techo: la camara sube por encima de carpas y estacas en vez de pegarse
  // al heroe (la pagina, springArm).
  const overheadBefore = world.built.overhead
  world.built.overhead = true

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
  const tr = (text) => (ctx.text ? ctx.text(text) : text)
  if (plan.title) {
    sign(
      L('settlement of ', 'asentamiento ') + tr(plan.name),
      '#e8a070',
      wx((plan.title.x0 + plan.title.x1) / 2),
      3.0,
      wz(plan.title.y)
    )
  }
  for (const tent of plan.tents) {
    const name = L(TENT_NAMES[tent.label] || tent.label, tent.label)
    sign(
      name,
      '#e0c890',
      wx((tent.x0 + tent.x1) / 2),
      tent.x1 - tent.x0 > 30 ? 5.0 : 3.4,
      wz(tent.y0 + 2)
    )
  }
  for (const s of plan.signs) {
    if (s.kind !== 'pen') continue
    const name = s.label === 'corral' ? L('pen', 'corral') : L('forge', s.label)
    sign(name, '#d8c8a0', wx((s.x0 + s.x1) / 2), 2.3, wz(s.y))
  }
  let gateSign = null
  let gateKey = 'nada'
  let cleared = null
  let since = 0
  let last = null

  function leftOf(f) {
    if (!f) return null
    const n = Number(f.remaining)
    return Number.isFinite(n) ? n : null
  }

  function update(time, st, f) {
    const dt = last === null ? 0 : Math.min(0.1, time - last)
    last = time
    built.update(time)
    const left = leftOf(f)
    const done = !!(f && ((f.state && f.state.completed) || left === 0))
    if (cleared === null) {
      cleared = done
      since = done ? -10 : 0
    } else if (cleared !== done) {
      cleared = done
      since = time
    }
    // Las hojas: a medio abrir con barbaros adentro, abiertas del todo despues.
    const k = cleared ? Math.min(1, (time - since) / 1.8) : 0
    const ease = k * k * (3 - 2 * k)
    for (const door of camp.doors) {
      const target = 0.9 + ease * 0.75
      door.mesh.rotation.y = door.s * target
    }
    // Los estandartes bajan por el mastil y quedan caidos.
    camp.flagMesh.position.y = -ease * 2.2
    // El fuego tiembla; despejado, queda en brasas.
    if (camp.light) {
      const base = cleared ? 4 + (1 - ease) * 6 : 10
      camp.light.intensity =
        base * (0.85 + 0.1 * Math.sin(time * 8.3) + 0.06 * Math.sin(time * 21.7 + 1.3))
    }
    // El cartel del porton se arma de nuevo solo si cambia lo que dice.
    const key = cleared ? -1 : left
    if (key !== gateKey) {
      drop(gateSign)
      gateKey = key
      const say = cleared
        ? 'U ' + L('cleared: +', 'despejado: +') + plan.reward + L(' gold', ' oro')
        : 'U ' +
          L('way out · ', 'salida · ') +
          (left === null ? '?' : left) +
          L(' barbarians', ' barbaros')
      gateSign = sign(say, cleared ? '#9cff9a' : '#ff9a6a', camp.exitX, 5.4, camp.gz1)
    }
    // Un cartel que tapa al heroe se aparta (el del porton, al entrar).
    const hero = ctx.hero && ctx.hero.root ? ctx.hero.root.position : null
    if (parts.signsAside) parts.signsAside(signs, ctx.camera, hero, dt)
  }

  return {
    group,
    update,
    loading: built.loading,
    dispose() {
      for (const s of [...signs]) drop(s)
      for (const b of built.blocks) {
        const at = blocks.indexOf(b)
        if (at >= 0) blocks.splice(at, 1)
      }
      world.built.overhead = overheadBefore
      built.dispose()
    }
  }
}

// La ayuda fuera de la pelea: la salida y, despejado, que volver por la U paga.
function campHint(st, field, touch, L) {
  if (!field || !st || !st.location) return ''
  const at = st.location
  const exit = field.layout && field.layout.exit
  const left = Number(field.remaining) || 0
  const near = exit && Math.abs(exit.x - at.x) <= 5 && Math.abs(exit.y - at.y) <= 4
  const reward = field.camp ? field.camp.reward : 0
  // En el celular, corta: entra en una linea sin tapar los botones.
  if (touch && left === 0) {
    return L('U · claim ' + reward + ' gold', 'U · cobrar ' + reward + ' de oro')
  }
  if (touch && near) return L('U · exit · ' + left + ' left', 'U · salir · quedan ' + left)
  if (left === 0) {
    return L(
      'the palisade is silent: step on U to claim ' + reward + ' gold',
      'la empalizada queda en silencio: pisa la U para cobrar ' + reward + ' de oro'
    )
  }
  if (near) {
    return L(
      'U leaves the camp: ' + left + ' barbarians still inside',
      'la U sale del campamento: quedan ' + left + ' barbaros adentro'
    )
  }
  return ''
}

/**
 * El lugar de adentro de los campamentos, para pradera.js addPlace: recibe
 * PARTS (las piezas de la pradera: Kit, flame, camp, CAMP_COLORS...).
 */
export function campPlace(parts) {
  return {
    mode: 'barbarian-camp',
    data: (field, names) => campData(field, names),
    landmarks: (world, ctx, field) => campLive(world, ctx, field, parts),
    hint: campHint
  }
}
