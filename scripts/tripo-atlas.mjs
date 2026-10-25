// El minimapa y el mapa de la region de la pagina (tripo-heroe.html).
//
//  - Minimapa: redondo, arriba a la derecha dentro de la zona segura (132 px en
//    la PC, 104 en un telefono). Gira con la camara (adelante queda arriba), la
//    capa de fondo se arma una vez por mapa y se repinta solo si algo cambio, a
//    10 Hz como mucho, con la densidad de pixeles hasta 2. Marca al heroe, los
//    portones, las puertas, los campamentos, los monstruos, los otros jugadores,
//    el objetivo de la historia y, si queda fuera, una flecha en el borde.
//  - Mapa: se abre con M o tocando el minimapa. La pestana Region muestra el
//    mapa entero con el norte arriba (arrastrar, pellizcar o la rueda para el
//    zoom) y una leyenda; la pestana Reino pone cada region en su lugar, con las
//    lineas de los portones de verdad, el camino al objetivo y cuantos jugadores
//    de la sala hay en cada una.
//
// Todo sale del estado del juego (tripo-estado.js atlasOf: la region, los
// portones, el objetivo y el camino) y de los datos del mapa 3D en pantalla
// (rows y tiles). Aca no se decide nada del juego: solo se dibuja.
//
// Sin three.js ni el juego: .mjs para que las pruebas lo carguen en Bare.

// Lo que se ve alrededor del heroe en el minimapa, en metros de radio.
export const MINI_RADIUS = 30
// El repintado del minimapa: como mucho 10 por segundo.
export const MINI_MS = 100
// La densidad de pixeles de los lienzos, como mucho 2.
export const MAX_DPR = 2

// El color de cada celda del fondo, por el id del tile (como los TILES de
// lib/map.js, la pradera, la cripta y los campamentos). En las ruinas del
// Coloso el agua es lava.
const COLORS = {
  road: '#a08c66',
  cobble: '#968a74',
  flagstone: '#8a8274',
  gravel: '#8c7c62',
  bridge: '#9a7a4a',
  lamp: '#8a8274',
  grass: '#4c7038',
  'tall-grass': '#456a32',
  'quiet-ground': '#557a40',
  flower: '#5c7c40',
  tree: '#2a4a24',
  rock: '#5c5c58',
  water: '#2c5c8c',
  rubble: '#6a4c32',
  wall: '#3a3530',
  roof: '#6c4a3a',
  masonry: '#5e5850',
  window: '#5e5850',
  ornament: '#5e5850',
  building: '#5e5850',
  fountain: '#3a6c9c',
  sign: '#7a6a4a',
  pillar: '#3e3a34',
  bones: '#7a7262',
  tomb: '#4e4a44',
  throne: '#f2c94a',
  'stairs.up': '#e8d080',
  'stairs.down': '#e8d080'
}

// El suelo de NOX en los tonos nocturnos de tripo-terreno.js; caminos,
// muros y puertas quedan como en RUNA para que se lean igual.
const NOX_GROUND = {
  grass: '#1f2c2a',
  'tall-grass': '#293838',
  'quiet-ground': '#2a3a3a',
  flower: '#33434a'
}

/**
 * El color de una celda: por el id de su tile, las puertas y portones en oro,
 * y un respaldo para lo que no tiene tile (el espacio es piso).
 * @param {{id?: string, solid?: boolean}|undefined} tile
 * @param {string} ch
 * @param {string} [kind] el tipo del mapa ('boss' pinta la lava)
 * @param {string} [mapId] el id del mapa ('nox' pinta el suelo de noche)
 */
export function tileColor(tile, ch, kind, mapId) {
  if (mapId === 'nox') {
    if (tile && Object.hasOwn(NOX_GROUND, tile.id)) return NOX_GROUND[tile.id]
    if (!tile && (ch === ' ' || ch === undefined) && kind === 'map') return NOX_GROUND.grass
  }
  if (tile && tile.id) {
    if (kind === 'boss' && tile.id === 'water') return '#c8501e'
    if (Object.hasOwn(COLORS, tile.id)) return COLORS[tile.id]
    if (tile.id.startsWith('door.') || tile.id.startsWith('gate.')) return '#d8b450'
    return tile.solid ? '#3a3632' : '#7e7668'
  }
  if (ch === ' ' || ch === undefined) return kind === 'map' ? '#4c7038' : '#6e685c'
  return '#3a3632'
}

// El reino en la pestana Reino: cada region en su lugar (unidades de una caja
// de 100 x 76). La pradera es la franja de abajo, con RUNA al oeste y NOX al
// este; adentro van sus portones donde estan de verdad (celdas de 260 x 72).
export const KINGDOM = {
  width: 100,
  height: 76,
  meadow: { x: 4, y: 36, w: 92, h: 24, cols: 260, rows: 72 },
  boxes: {
    castle: { x: 15, y: 3, w: 18, h: 9 },
    dungeon: { x: 2, y: 3, w: 11, h: 9 },
    city: { x: 10, y: 16, w: 26, h: 14 },
    coliseum: { x: 1, y: 18, w: 7, h: 9 },
    nox: { x: 66, y: 16, w: 26, h: 14 },
    boss: { x: 44, y: 4, w: 18, h: 10 },
    field: { x: 4, y: 36, w: 92, h: 24 },
    'crypt-1': { x: 38, y: 65, w: 15, h: 8 },
    'crypt-2': { x: 57, y: 65, w: 15, h: 8 },
    'crypt-3': { x: 76, y: 65, w: 15, h: 8 }
  }
}

/** Donde cae una celda de la pradera en la pestana Reino. */
export function meadowPoint(x, y) {
  const m = KINGDOM.meadow
  return { x: m.x + ((x + 0.5) / m.cols) * m.w, y: m.y + ((y + 0.5) / m.rows) * m.h }
}

/**
 * La caja de una region en la pestana Reino. Los campamentos son cajas chicas
 * sobre su porton de la pradera (camps: atlas.camps).
 */
export function kingdomBox(id, camps = []) {
  if (Object.hasOwn(KINGDOM.boxes, id)) return KINGDOM.boxes[id]
  if (typeof id === 'string' && id.startsWith('camp:')) {
    const camp = camps.find((c) => 'camp:' + c.id === id)
    if (!camp) return null
    const p = meadowPoint(camp.x, camp.y)
    return { x: p.x - 5, y: p.y - 3, w: 10, h: 6, camp: true }
  }
  return null
}

// Los nombres de las regiones para los carteles (L elige el idioma, tr traduce
// lo que viene del juego en castellano).
export function regionName(id, { L, tr, camps = [] }) {
  const fixed = {
    city: 'RUNA',
    nox: 'NOX',
    castle: L('Castle', 'Castillo'),
    dungeon: L('Ruins', 'Ruinas'),
    coliseum: L('Colosseum', 'Coliseo'),
    field: L('Meadow', 'Pradera'),
    boss: L('Volcanic ruins', 'Ruinas volcanicas')
  }
  if (Object.hasOwn(fixed, id)) return fixed[id]
  const crypt = /^crypt-(\d+)$/.exec(id || '')
  if (crypt) return L('Crypt ', 'Cripta ') + crypt[1]
  if (typeof id === 'string' && id.startsWith('camp:')) {
    const camp = camps.find((c) => 'camp:' + c.id === id)
    return camp ? tr(camp.name) : L('Camp', 'Campamento')
  }
  return String(id || '')
}

// Lo que pide el objetivo, en una linea.
export function goalText(target, { L, tr, camps = [] }) {
  if (!target) return ''
  const texts = {
    giver: () => L('Talk to King Aldren in the castle', 'Habla con el rey Aldren en el castillo'),
    ring: () => L('Hunt mosquitoes near the RUNA gate', 'Caza mosquitos cerca del porton de RUNA'),
    camp: () =>
      L('Raid the camp ', 'Asalta el campamento ') +
      regionName('camp:' + target.id, { L, tr, camps }),
    portal: () => L('Cross the portal to the Colossus', 'Cruza el portal hacia el Coloso'),
    boss: () => L('Strike the Colossus', 'Golpea al Coloso')
  }
  return Object.hasOwn(texts, target.kind) ? texts[target.kind]() : ''
}

/**
 * La transformacion de una vista: el centro (metros), la escala (px por metro),
 * el giro (radianes, el yaw de la camara) y el centro en pantalla (px).
 * project(mx, mz) devuelve [px, py] en la pantalla.
 */
export function viewTransform({ cx, cz, k, yaw = 0, ox, oy }) {
  const c = Math.cos(-yaw)
  const s = Math.sin(-yaw)
  return {
    project(mx, mz) {
      const dx = mx - cx
      const dz = mz - cz
      return [ox + (dx * c - dz * s) * k, oy + (dx * s + dz * c) * k]
    },
    unproject(px, py) {
      const rx = (px - ox) / k
      const ry = (py - oy) / k
      return [cx + rx * c + ry * s, cz - rx * s + ry * c]
    }
  }
}

/**
 * El paso de un pellizco: con los dos dedos de antes y de ahora, el zoom nuevo
 * y el punto de la pantalla que tiene que quedar quieto bajo los dedos.
 */
export function pinchStep(before, after, k, { min = 0.2, max = 40 } = {}) {
  const span = (a) => Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y) || 1
  const mid = (a) => ({ x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 })
  const next = Math.min(max, Math.max(min, (k * span(after)) / span(before)))
  return { k: next, from: mid(before), to: mid(after) }
}

// El relleno de los campamentos en la pestana Reino (tambien en su leyenda).
const CAMP_BOX = { camp: 'rgba(120, 40, 30, 0.9)', cleared: 'rgba(90, 86, 78, 0.9)' }

// Los colores de las marcas (tambien en la leyenda).
const MARK = {
  hero: '#ffffff',
  goal: '#ffd84a',
  next: '#ffb030',
  exit: '#e8e0c8',
  shop: '#d8b450',
  camp: '#e07a2a',
  cleared: '#8a8478',
  foe: '#ff3a5a',
  player: '#58b4ff',
  boss: '#ff7a2a'
}

const CSS = `
:root { --mini: 132px; }
@media (pointer: coarse), (max-width: 640px) { :root { --mini: 104px; } }
#minimap {
  position: fixed; top: calc(var(--sat) + 16px); right: calc(var(--sar) + 16px);
  width: var(--mini); height: var(--mini); padding: 0; margin: 0;
  border-radius: 50%; border: 2px solid var(--ui-edge, #a8843a);
  background: #0d0d0f; box-shadow: 0 2px 8px rgba(0,0,0,.55), inset 0 0 0 1px rgba(0,0,0,.7);
  overflow: hidden; cursor: pointer; pointer-events: auto; touch-action: none;
  -webkit-tap-highlight-color: transparent; z-index: 2;
}
#minimap canvas { display: block; width: 100%; height: 100%; }
#minimap:focus-visible { outline: 2px solid var(--ui-edge-hi, #f0d27a); outline-offset: 2px; }
@media (pointer: coarse) {
  #minimap { top: calc(var(--sat) + var(--gut)); right: calc(var(--sar) + var(--gut)); }
}
@media (pointer: coarse) and (orientation: portrait) {
  body:has(#bossbar:not([hidden])) #minimap { top: calc(var(--sat) + var(--gut) + 44px); }
}
@media (pointer: coarse) and (max-height: 520px) {
  body:has(#minimap:not([hidden])) :is(#bossbar, #rivalbar) {
    right: calc(var(--sar) + var(--gut) + var(--mini) + var(--gap));
  }
}
@media (pointer: coarse) and (orientation: portrait) {
  body:has(#minimap:not([hidden])) #rotate {
    left: calc(var(--sal) + var(--gut)); transform: none;
    max-width: calc(100vw - var(--sal) - var(--sar) - 2 * var(--gut) - var(--mini) - var(--gap));
  }
}
body:has(#minimap:not([hidden])) #gait { top: calc(16px + var(--mini) + 10px); }
#atlas {
  position: fixed; inset: 0; z-index: 20; display: flex; flex-direction: column;
  background: #08080a; color: var(--fg, #d8d8d0);
  padding: var(--sat) var(--sar) var(--sab) var(--sal); box-sizing: border-box;
  touch-action: none; -webkit-user-select: none; user-select: none;
}
#atlas[hidden] { display: none; }
#atlas .atlas-top { display: flex; align-items: center; gap: 8px; padding: 10px 12px; flex-wrap: wrap; }
#atlas .atlas-tabs { display: flex; gap: 6px; }
#atlas button {
  font: inherit; color: var(--ui-ink, #efe6cc); background: var(--ui-surface, rgba(18,14,9,.84));
  border: 1px solid var(--ui-edge, #a8843a); border-radius: 8px; padding: 6px 12px; min-height: 40px; cursor: pointer;
}
#atlas button[aria-pressed='true'] { background: var(--ui-surface-press, rgba(52,40,16,.92)); border-color: var(--ui-edge-hi, #f0d27a); color: var(--ui-gold-hi, #f6dc8f); }
#atlas .atlas-title { flex: 1; min-width: 0; color: var(--accent, #e0c060); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#atlas .atlas-goal { padding: 0 12px 8px; font-size: 13px; color: var(--ui-label, #cfc4a4); }
#atlas .atlas-goal b { color: ${MARK.goal}; font-weight: normal; }
#atlas .atlas-stage { position: relative; flex: 1; min-height: 0; }
#atlas canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: grab; }
#atlas .atlas-legend {
  position: absolute; left: 12px; bottom: 12px; margin: 0; padding: 6px 10px; list-style: none;
  background: var(--panel, rgba(11,11,12,.84)); border: 1px solid var(--line, #3a3a36);
  font-size: 12px; display: grid; grid-template-columns: repeat(2, auto); gap: 2px 14px; pointer-events: none;
}
#atlas .atlas-legend i { display: inline-block; width: 9px; height: 9px; margin-right: 6px; border-radius: 50%; vertical-align: -1px; }
#atlas .atlas-legend i.sq { border-radius: 1px; transform: rotate(45deg) scale(.85); }
#atlas .atlas-legend i.box { border-radius: 1px; }
#atlas .atlas-legend i.tri { border-radius: 0; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
#atlas .atlas-legend i.star { border-radius: 0; clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); width: 11px; height: 11px; }
#atlas .atlas-hint { position: absolute; right: 12px; bottom: 12px; font-size: 12px; color: var(--dim, #7a7a72); pointer-events: none; }
@media (pointer: coarse) and (orientation: portrait) {
  #atlas .atlas-legend { grid-template-columns: repeat(3, auto); right: 12px; left: 12px; }
  #atlas .atlas-hint { display: none; }
}
@media (max-height: 520px) {
  #atlas .atlas-top { padding: 6px 10px; }
  #atlas .atlas-goal { padding-bottom: 4px; }
  #atlas .atlas-legend { font-size: 11px; left: auto; right: 12px; bottom: auto; top: 8px; grid-template-columns: auto; opacity: 0.92; }
  #atlas .atlas-hint { display: none; }
}
`

/**
 * El minimapa y el mapa de la pagina.
 *
 * ctx:
 *   L(en, es), tr(text)  los textos de la pagina
 *   view()               { yaw, heroAt: {x, z} | null, facing } la camara y el heroe
 *   onOpen(), onClose()  la pagina suelta las teclas y el stick
 *
 * frame(st, data, toWorld, hidden) en cada cuadro: st es session.state(), data el mapa
 * 3D en pantalla (rows, tiles, width, height) o null, toWorld(x, y) el de ese
 * mapa (built.toWorld: la celda en metros), hidden si algo
 * tapa la vista (la pantalla de texto, un menu, la pausa, un duelo).
 */
export function createAtlas(ctx) {
  const { document, devicePixelRatio, performance } = globalThis
  const L = ctx.L
  const tr = ctx.tr
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)

  const mini = document.createElement('button')
  mini.id = 'minimap'
  mini.type = 'button'
  mini.hidden = true
  const miniCanvas = document.createElement('canvas')
  mini.append(miniCanvas)
  document.body.append(mini)

  const panel = document.createElement('div')
  panel.id = 'atlas'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  const bar = document.createElement('div')
  bar.className = 'atlas-top'
  const tabs = document.createElement('div')
  tabs.className = 'atlas-tabs'
  const tabButton = (id, text) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.tab = id
    b.textContent = text
    b.addEventListener('click', () => show(id))
    tabs.append(b)
    return b
  }
  const regionTab = tabButton('region', '')
  const kingdomTab = tabButton('kingdom', '')
  const title = document.createElement('div')
  title.className = 'atlas-title'
  const closer = document.createElement('button')
  closer.type = 'button'
  closer.className = 'atlas-close'
  closer.addEventListener('click', () => close())
  bar.append(tabs, title, closer)
  const goal = document.createElement('div')
  goal.className = 'atlas-goal'
  const stage = document.createElement('div')
  stage.className = 'atlas-stage'
  const canvas = document.createElement('canvas')
  const legend = document.createElement('ul')
  legend.className = 'atlas-legend'
  const hint = document.createElement('div')
  hint.className = 'atlas-hint'
  stage.append(canvas, legend, hint)
  panel.append(bar, goal, stage)
  document.body.append(panel)
  // Los textos fijos, en el idioma de ahora: se rearman al abrir el mapa y al
  // volver a mostrar el minimapa (el idioma se cambia desde la pausa).
  function fillChrome() {
    mini.setAttribute('aria-label', L('Map (M)', 'Mapa (M)'))
    mini.title = L('Map (M)', 'Mapa (M)')
    panel.setAttribute('aria-label', L('Map', 'Mapa'))
    regionTab.textContent = L('Region', 'Region')
    kingdomTab.textContent = L('Kingdom', 'Reino')
    closer.textContent = L('Close (M)', 'Cerrar (M)')
    hint.textContent = L(
      'Drag to move, wheel or pinch to zoom · Tab switches · M or Esc closes',
      'Arrastra para mover, rueda o pellizco para el zoom · Tab cambia · M o Esc cierra'
    )
  }
  fillChrome()
  // Safari hace zoom de la pagina con un pellizco aunque el lienzo lo atienda.
  for (const name of ['gesturestart', 'gesturechange']) {
    panel.addEventListener(name, (event) => event.preventDefault())
  }

  let st = null
  let data = null
  // El mapa de la ultima vez: si cambia, el fondo y la vista se rearman.
  let shown = null
  let toWorld = null
  let fullAt = 0
  let base = null
  let baseFor = null
  let miniKey = ''
  let miniAt = 0
  let opened = false
  let tab = 'region'
  let fullDirty = true
  let fullKey = ''
  // La vista de la pestana Region: centro en metros y px por metro (null:
  // encuadrar el mapa entero la proxima vez).
  let cam = null

  const dprNow = () => Math.min(MAX_DPR, devicePixelRatio || 1)
  const named = (id) => regionName(id, { L, tr, camps: (st && st.atlas && st.atlas.camps) || [] })

  // Las medidas de una celda en metros, con toWorld del mapa 3D.
  function grid() {
    const o = toWorld(0, 0)
    const e = toWorld(1, 0)
    const s = toWorld(0, 1)
    return { ox: o.x, oz: o.z, sx: e.x - o.x || 0.5, sz: s.z - o.z || 1 }
  }
  const cellToWorld = (g, x, y) => [g.ox + x * g.sx, g.oz + y * g.sz]

  // La capa de fondo: un pixel por celda, una vez por mapa.
  function baseLayer(d) {
    if (baseFor === d && base) return base
    const c = document.createElement('canvas')
    c.width = d.width
    c.height = d.height
    const g = c.getContext('2d')
    const img = g.createImageData(d.width, d.height)
    const cache = new Map()
    const rgb = (hex) => {
      let v = cache.get(hex)
      if (!v) {
        const n = parseInt(hex.slice(1), 16)
        v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        cache.set(hex, v)
      }
      return v
    }
    for (let y = 0; y < d.height; y++) {
      const row = d.rows[y] || ''
      for (let x = 0; x < d.width; x++) {
        const ch = row[x]
        const [r, gg, b] = rgb(tileColor(d.tiles[ch], ch, d.kind, d.id))
        const i = (y * d.width + x) * 4
        img.data[i] = r
        img.data[i + 1] = gg
        img.data[i + 2] = b
        img.data[i + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    base = c
    baseFor = d
    return c
  }

  function fit(c, cssW, cssH) {
    const dpr = dprNow()
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const g = c.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    return g
  }

  // --- Las marcas ---------------------------------------------------------

  function dot(g, x, y, r, fill, edge = '#000') {
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fillStyle = fill
    g.fill()
    g.lineWidth = 1
    g.strokeStyle = edge
    g.stroke()
  }
  function diamond(g, x, y, r, fill) {
    g.beginPath()
    g.moveTo(x, y - r)
    g.lineTo(x + r, y)
    g.lineTo(x, y + r)
    g.lineTo(x - r, y)
    g.closePath()
    g.fillStyle = fill
    g.fill()
    g.lineWidth = 1
    g.strokeStyle = '#000'
    g.stroke()
  }
  function tent(g, x, y, r, fill) {
    g.beginPath()
    g.moveTo(x, y - r)
    g.lineTo(x + r, y + r * 0.8)
    g.lineTo(x - r, y + r * 0.8)
    g.closePath()
    g.fillStyle = fill
    g.fill()
    g.lineWidth = 1
    g.strokeStyle = '#000'
    g.stroke()
  }
  function star(g, x, y, r, fill) {
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const rr = i % 2 ? r * 0.45 : r
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    g.closePath()
    g.fillStyle = fill
    g.fill()
    g.lineWidth = 1.2
    g.strokeStyle = '#1a1409'
    g.stroke()
  }
  function arrow(g, x, y, angle, r, fill) {
    g.save()
    g.translate(x, y)
    g.rotate(angle)
    g.beginPath()
    g.moveTo(r, 0)
    g.lineTo(-r * 0.7, r * 0.65)
    g.lineTo(-r * 0.35, 0)
    g.lineTo(-r * 0.7, -r * 0.65)
    g.closePath()
    g.fillStyle = fill
    g.fill()
    g.lineWidth = 1.2
    g.strokeStyle = '#000'
    g.stroke()
    g.restore()
  }

  // Adonde apunta el objetivo en este mapa: el objetivo si esta aca, si no el
  // proximo porton del camino. null si no hay nada que marcar.
  function aimOf(atlas) {
    if (!atlas || !atlas.target) return null
    const t = atlas.target
    if (t.region === atlas.region) {
      if (t.x === null || t.x === undefined) return null
      return { x: t.x, y: t.y, goal: true }
    }
    const next = atlas.route && atlas.route[0]
    return next ? { x: next.x, y: next.y, goal: false, to: next.to } : null
  }

  // Todo lo que va arriba del fondo, con project(x, y) de celdas a pantalla.
  // scale: el tamano de las marcas; labels: los nombres de los portones.
  function marks(g, d, place, { scale = 1, labels = false, ringPx = null } = {}) {
    const atlas = st.atlas
    const aim = aimOf(atlas)
    const t = atlas.target
    // El anillo de los mosquitos.
    if (t && t.kind === 'ring' && t.region === atlas.region && ringPx) {
      const [x, y] = place(t.x, t.y)
      g.beginPath()
      g.arc(x, y, ringPx, 0, Math.PI * 2)
      g.lineWidth = 2
      g.setLineDash([6, 4])
      g.strokeStyle = MARK.goal
      g.stroke()
      g.setLineDash([])
    }
    const campOf = (id) => atlas.camps.find((c) => 'camp:' + c.id === id)
    for (const exit of atlas.exits) {
      const [x, y] = place(exit.x, exit.y)
      const next = aim && !aim.goal && aim.x === exit.x && aim.y === exit.y
      const camp = exit.to.startsWith('camp:') ? campOf(exit.to) : null
      if (camp) tent(g, x, y, 5 * scale, camp.cleared ? MARK.cleared : MARK.camp)
      else diamond(g, x, y, (next ? 6 : 4.5) * scale, next ? MARK.next : MARK.exit)
      if (labels) {
        g.font = `${Math.round(11 * scale)}px ui-monospace, monospace`
        g.fillStyle = next ? MARK.next : '#efe6cc'
        g.strokeStyle = 'rgba(0,0,0,.85)'
        g.lineWidth = 3
        const text = (camp ? '' : '→ ') + named(exit.to)
        g.strokeText(text, x + 8 * scale, y + 4 * scale)
        g.fillText(text, x + 8 * scale, y + 4 * scale)
      }
    }
    for (const shop of d.shops || []) {
      const [x, y] = place(shop.x, shop.y)
      dot(g, x, y, 2.5 * scale, MARK.shop)
    }
    for (const foe of st.foes || []) {
      const [x, y] = place(foe.x, foe.y)
      dot(g, x, y, 2 * scale, MARK.foe, 'rgba(0,0,0,.6)')
    }
    if (st.boss && !st.boss.defeated) {
      const [x, y] = place(st.boss.x, st.boss.y)
      dot(g, x, y, 5 * scale, MARK.boss)
    }
    for (const peer of st.players || []) {
      const [x, y] = place(peer.x, peer.y)
      dot(g, x, y, 3 * scale, MARK.player)
    }
    if (aim && aim.goal) {
      const [x, y] = place(aim.x, aim.y)
      star(g, x, y, 7 * scale, MARK.goal)
    }
    return aim
  }

  // --- El minimapa ---------------------------------------------------------

  function paintMini(now) {
    const size = mini.clientWidth || 132
    const view = ctx.view()
    const g0 = grid()
    const hero = view.heroAt || {
      x: cellToWorld(g0, st.location.x, st.location.y)[0],
      z: cellToWorld(g0, st.location.x, st.location.y)[1]
    }
    const yaw = view.yaw || 0
    const foes = (st.foes || []).reduce((sum, f) => sum + f.x * 31 + f.y * 7 + 1, 0)
    const peers = (st.players || []).reduce((sum, p) => sum + p.x * 31 + p.y * 7 + 1, 0)
    const atlas = st.atlas
    const key = [
      size,
      dprNow(),
      Math.round(hero.x * 8),
      Math.round(hero.z * 8),
      Math.round(yaw * 90),
      Math.round((view.facing || 0) * 20),
      foes,
      peers,
      st.boss ? `${st.boss.x},${st.boss.y}` : '',
      JSON.stringify(atlas.target),
      atlas.route && atlas.route[0] ? atlas.route[0].to : '',
      atlas.camps.map((c) => (c.cleared ? 1 : 0)).join(''),
      data.id
    ].join('|')
    if (key === miniKey) return
    if (now - miniAt < MINI_MS) return
    miniKey = key
    miniAt = now
    const g = fit(miniCanvas, size, size)
    const r = size / 2
    const k = r / MINI_RADIUS
    g.clearRect(0, 0, size, size)
    g.save()
    g.beginPath()
    g.arc(r, r, r, 0, Math.PI * 2)
    g.clip()
    g.fillStyle = '#0d0d0f'
    g.fillRect(0, 0, size, size)
    // El fondo, girado con la camara.
    g.save()
    g.translate(r, r)
    g.rotate(-yaw)
    g.scale(k, k)
    g.translate(-hero.x, -hero.z)
    g.imageSmoothingEnabled = false
    g.globalAlpha = 0.92
    g.drawImage(
      baseLayer(data),
      g0.ox - g0.sx / 2,
      g0.oz - g0.sz / 2,
      data.width * g0.sx,
      data.height * g0.sz
    )
    g.restore()
    const tf = viewTransform({ cx: hero.x, cz: hero.z, k, yaw, ox: r, oy: r })
    const place = (x, y) => tf.project(...cellToWorld(g0, x, y))
    const t = atlas.target
    const aim = marks(g, data, place, {
      scale: size < 120 ? 0.85 : 1,
      ringPx: t && t.radius ? t.radius * g0.sx * k : null
    })
    g.restore()
    // El borde: el norte y, si el objetivo queda afuera, una flecha hacia el.
    const rim = (px, py) => {
      const dx = px - r
      const dy = py - r
      const len = Math.hypot(dx, dy) || 1
      return {
        a: Math.atan2(dy, dx),
        out: len > r - 8,
        x: r + (dx / len) * (r - 9),
        y: r + (dy / len) * (r - 9)
      }
    }
    const north = tf.project(hero.x, hero.z - 1000)
    const n = rim(north[0], north[1])
    g.font = 'bold 10px ui-monospace, monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = '#000'
    g.fillText('N', n.x + 1, n.y + 1)
    g.fillStyle = '#f0d27a'
    g.fillText('N', n.x, n.y)
    if (aim) {
      const [px, py] = place(aim.x, aim.y)
      const e = rim(px, py)
      if (e.out) arrow(g, e.x, e.y, e.a, 7, aim.goal ? MARK.goal : MARK.next)
    } else if (t && t.kind === 'ring' && t.region === atlas.region) {
      const [px, py] = place(t.x, t.y)
      const e = rim(px, py)
      const inside = Math.hypot(px - r, py - r) < t.radius * g0.sx * k
      if (e.out && !inside) arrow(g, e.x, e.y, e.a, 7, MARK.goal)
    }
    // El heroe en el centro, mirando a donde mira.
    const f = view.facing
    const fa =
      f === null || f === undefined
        ? -Math.PI / 2
        : (() => {
            const [fx, fy] = tf.project(hero.x + Math.sin(f), hero.z + Math.cos(f))
            return Math.atan2(fy - r, fx - r)
          })()
    arrow(g, r, r, fa, 7, MARK.hero)
  }

  // --- El mapa grande -------------------------------------------------------

  function regionView(cssW, cssH) {
    const g0 = grid()
    const W = data.width * g0.sx
    const H = data.height * g0.sz
    const fitK = Math.min(cssW / W, cssH / H) * 0.94
    if (!cam) {
      cam = { cx: g0.ox - g0.sx / 2 + W / 2, cz: g0.oz - g0.sz / 2 + H / 2, k: fitK }
    }
    cam.min = fitK * 0.6
    cam.max = Math.max(fitK * 14, 40)
    return { g0, W, H }
  }

  function paintRegion() {
    const rect = stage.getBoundingClientRect()
    const g = fit(canvas, rect.width, rect.height)
    g.clearRect(0, 0, rect.width, rect.height)
    if (!data || !st || !st.atlas || st.atlas.region !== data.id) {
      g.fillStyle = '#7a7a72'
      g.font = '14px ui-monospace, monospace'
      g.textAlign = 'center'
      g.fillText(L('No map here', 'Aca no hay mapa'), rect.width / 2, rect.height / 2)
      return
    }
    const { g0 } = regionView(rect.width, rect.height)
    const tf = viewTransform({
      cx: cam.cx,
      cz: cam.cz,
      k: cam.k,
      ox: rect.width / 2,
      oy: rect.height / 2
    })
    const [x0, y0] = tf.project(g0.ox - g0.sx / 2, g0.oz - g0.sz / 2)
    g.imageSmoothingEnabled = false
    g.drawImage(baseLayer(data), x0, y0, data.width * g0.sx * cam.k, data.height * g0.sz * cam.k)
    g.strokeStyle = '#3a3a36'
    g.lineWidth = 1
    g.strokeRect(x0, y0, data.width * g0.sx * cam.k, data.height * g0.sz * cam.k)
    const place = (x, y) => tf.project(...cellToWorld(g0, x, y))
    const view = ctx.view()
    const hero = view.heroAt
      ? tf.project(view.heroAt.x, view.heroAt.z)
      : place(st.location.x, st.location.y)
    const t = st.atlas.target
    const aim = aimOf(st.atlas)
    // El camino: del heroe al objetivo o al proximo porton.
    if (aim) {
      const [ax, ay] = place(aim.x, aim.y)
      g.beginPath()
      g.moveTo(hero[0], hero[1])
      g.lineTo(ax, ay)
      g.setLineDash([8, 6])
      g.lineWidth = 2.5
      g.strokeStyle = aim.goal ? MARK.goal : MARK.next
      g.stroke()
      g.setLineDash([])
    }
    marks(g, data, place, {
      scale: 1.2,
      labels: true,
      ringPx: t && t.radius ? t.radius * g0.sx * cam.k : null
    })
    const f = view.facing
    let fa = -Math.PI / 2
    if (f !== null && f !== undefined && view.heroAt) {
      const [fx, fy] = tf.project(view.heroAt.x + Math.sin(f), view.heroAt.z + Math.cos(f))
      fa = Math.atan2(fy - hero[1], fx - hero[0])
    }
    arrow(g, hero[0], hero[1], fa, 9, MARK.hero)
  }

  function paintKingdom() {
    const rect = stage.getBoundingClientRect()
    const g = fit(canvas, rect.width, rect.height)
    g.clearRect(0, 0, rect.width, rect.height)
    const atlas = st && st.atlas
    if (!atlas) return
    const pad = 16
    const legendRoom = rect.width < rect.height ? 70 : 0
    const k = Math.min(
      (rect.width - pad * 2) / KINGDOM.width,
      (rect.height - pad * 2 - legendRoom) / KINGDOM.height
    )
    const ox = (rect.width - KINGDOM.width * k) / 2
    const oy = pad + (rect.height - pad * 2 - legendRoom - KINGDOM.height * k) / 2
    const P = (x, y) => [ox + x * k, oy + y * k]
    const camps = atlas.camps
    const box = (id) => kingdomBox(id, camps)
    const center = (b) => P(b.x + b.w / 2, b.y + b.h / 2)
    const onRoute = new Set((atlas.route || []).flatMap((hop) => [hop.region, hop.to]))
    // Donde toca la linea de un porton en su region: en la pradera, la celda del
    // porton; en las otras, el centro de la caja.
    const anchor = (id, gate) => {
      if (id === 'field' && gate) return P(...Object.values(meadowPoint(gate.x, gate.y)))
      const b = box(id)
      return b ? center(b) : null
    }
    const seen = new Set()
    for (const link of atlas.links) {
      const pair = [link.from, link.to].sort().join('>')
      if (seen.has(pair)) continue
      seen.add(pair)
      // La celda del porton en la pradera, de cualquiera de las dos puntas.
      const meadowGate =
        link.from === 'field'
          ? link
          : atlas.links.find((l) => l.from === 'field' && l.to === link.from) || null
      const a = anchor(link.from, link.from === 'field' ? link : null)
      const b = anchor(link.to, link.to === 'field' ? meadowGate : null)
      if (!a || !b) continue
      const hot = onRoute.has(link.from) && onRoute.has(link.to)
      g.beginPath()
      g.moveTo(a[0], a[1])
      g.lineTo(b[0], b[1])
      g.lineWidth = hot ? 3 : 1.5
      g.strokeStyle = hot ? MARK.next : 'rgba(216, 180, 80, 0.45)'
      if (hot) g.setLineDash([7, 5])
      g.stroke()
      g.setLineDash([])
    }
    const ids = [...Object.keys(KINGDOM.boxes), ...camps.map((c) => 'camp:' + c.id)]
    const fontPx = Math.max(10, Math.min(14, k * 2.2))
    for (const id of ids) {
      const b = box(id)
      if (!b) continue
      const [x, y] = P(b.x, b.y)
      const w = b.w * k
      const h = b.h * k
      const here = id === atlas.region
      const camp = b.camp ? camps.find((c) => 'camp:' + c.id === id) : null
      g.fillStyle =
        id === 'field'
          ? 'rgba(76, 112, 56, 0.35)'
          : camp
            ? camp.cleared
              ? CAMP_BOX.cleared
              : CAMP_BOX.camp
            : 'rgba(24, 22, 18, 0.92)'
      g.fillRect(x, y, w, h)
      g.lineWidth = here ? 3 : 1.2
      g.strokeStyle = here ? MARK.hero : onRoute.has(id) ? MARK.next : '#6a5a3a'
      g.strokeRect(x, y, w, h)
    }
    // Lo que hay adentro de la pradera: la cripta y el portal, como en el juego.
    // Van antes de los nombres para no taparlos.
    const inMeadow = atlas.links.filter((l) => l.from === 'field')
    const gatePoints = []
    for (const gate of inMeadow) {
      if (gate.to.startsWith('camp:')) continue
      const [x, y] = P(...Object.values(meadowPoint(gate.x, gate.y)))
      gatePoints.push([x, y])
      diamond(g, x, y, 5, onRoute.has(gate.to) ? MARK.next : MARK.exit)
    }
    // Si un porton cae donde iria el nombre (x0..x1, y0..y1), el nombre se corre.
    const hitsGate = (x0, y0, x1, y1) =>
      gatePoints.some(([gx, gy]) => gx >= x0 - 6 && gx <= x1 + 6 && gy >= y0 - 6 && gy <= y1 + 6)
    for (const id of ids) {
      const b = box(id)
      if (!b) continue
      const [x, y] = P(b.x, b.y)
      const w = b.w * k
      const h = b.h * k
      const here = id === atlas.region
      const camp = b.camp ? camps.find((c) => 'camp:' + c.id === id) : null
      g.font = `${fontPx}px ui-monospace, monospace`
      g.textAlign = 'center'
      g.textBaseline = id === 'field' ? 'top' : 'middle'
      g.fillStyle = here ? MARK.hero : '#efe6cc'
      const label = named(id)
      const ly = id === 'field' ? y + 4 : y + h / 2
      if (camp) {
        // Abajo de su caja, o arriba si ahi abajo hay un porton.
        const small = Math.max(9, fontPx - 2)
        g.font = `${small}px ui-monospace, monospace`
        const half = g.measureText(label).width / 2
        const below = !hitsGate(x + w / 2 - half, y + h, x + w / 2 + half, y + h + small + 2)
        g.textBaseline = below ? 'top' : 'bottom'
        g.fillText(label, x + w / 2, below ? y + h + 2 : y - 2)
      } else if (id !== 'field' && g.measureText(label).width > w - 4) {
        // Una caja angosta (el Coliseo): el nombre va abajo, alineado con la
        // caja y sobre un fondo, por si pisa el borde de la caja de al lado.
        const small = Math.max(9, fontPx - 2)
        g.font = `${small}px ui-monospace, monospace`
        g.textAlign = 'left'
        g.textBaseline = 'top'
        const tw = g.measureText(label).width
        const lx = Math.max(2, Math.min(x, rect.width - tw - 2))
        g.fillStyle = 'rgba(8, 8, 10, 0.85)'
        g.fillRect(lx - 2, y + h + 1, tw + 4, small + 3)
        g.fillStyle = here ? MARK.hero : '#efe6cc'
        g.fillText(label, lx, y + h + 2)
        g.textAlign = 'center'
      } else g.fillText(label, x + w / 2, ly)
      const count = atlas.players[id] || 0
      if (count) {
        dot(g, x + w - 2, y + 2, 8, MARK.player)
        g.fillStyle = '#04121e'
        g.font = 'bold 10px ui-monospace, monospace'
        g.textBaseline = 'middle'
        g.fillText(String(count), x + w - 2, y + 2.5)
      }
    }
    // El heroe en su region y el objetivo.
    const hereBox = box(atlas.region)
    if (hereBox) {
      // En su caja, en la esquina (el centro es del nombre); en la pradera, donde esta.
      let at = P(hereBox.x + 2.2, hereBox.y + 2.2)
      if (atlas.region === 'field' && st.location) {
        at = P(...Object.values(meadowPoint(st.location.x, st.location.y)))
      }
      dot(g, at[0], at[1], 6, MARK.hero)
    }
    const t = atlas.target
    if (t) {
      let at = null
      if (t.region === 'field' && t.x !== null) at = P(...Object.values(meadowPoint(t.x, t.y)))
      else if (box(t.region)) {
        // En la esquina de arriba a la derecha de su caja: el centro es del nombre.
        const b = box(t.region)
        at = P(b.x + b.w, b.y)
      }
      if (at) star(g, at[0], at[1], 10, MARK.goal)
    }
  }

  function fillLegend() {
    const items =
      tab === 'region'
        ? [
            ['hero', L('You', 'Vos')],
            ['goal', L('Goal', 'Objetivo'), 'star'],
            ['next', L('Next gate', 'Proximo porton'), 'sq'],
            ['exit', L('Gate', 'Porton'), 'sq'],
            ['shop', L('Door, shop', 'Puerta, tienda')],
            ['camp', L('Camp', 'Campamento'), 'tri'],
            ['cleared', L('Cleared camp', 'Campamento despejado'), 'tri'],
            ['foe', L('Monster', 'Monstruo')],
            ['player', L('Player', 'Jugador')]
          ]
        : [
            ['hero', L('You are here', 'Estas aca')],
            ['goal', L('Goal', 'Objetivo'), 'star'],
            ['next', L('Route', 'Camino')],
            ['player', L('Players in the region', 'Jugadores en la region')],
            ['camp', L('Camp', 'Campamento'), 'box', CAMP_BOX.camp],
            ['cleared', L('Cleared camp', 'Campamento despejado'), 'box', CAMP_BOX.cleared]
          ]
    legend.replaceChildren(
      ...items.map(([mark, text, square, color]) => {
        const li = document.createElement('li')
        const i = document.createElement('i')
        i.style.background = color || MARK[mark]
        if (square) i.className = square
        li.append(i, text)
        return li
      })
    )
  }

  function fillHeader() {
    const atlas = st && st.atlas
    const here = atlas ? named(atlas.region) : ''
    title.textContent = here
    if (!atlas || !atlas.target) {
      goal.textContent = ''
      return
    }
    const camps = atlas.camps
    const text = goalText(atlas.target, { L, tr, camps })
    const next = atlas.route && atlas.route[0]
    goal.replaceChildren()
    const b = document.createElement('b')
    b.textContent = '★ ' + text
    goal.append(b)
    if (next) {
      const to = regionName(next.to, { L, tr, camps })
      goal.append(' · ' + L('Next: the gate to ', 'Siguiente: el porton a ') + to)
    } else if (atlas.target.region === atlas.region) goal.append(' · ' + L('It is here', 'Es aca'))
  }

  function paintFull() {
    if (!opened) return
    if (tab === 'region') paintRegion()
    else paintKingdom()
  }

  function show(which) {
    tab = which === 'kingdom' ? 'kingdom' : 'region'
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.tab === tab))
    fillLegend()
    fullDirty = true
  }

  function open(which = tab) {
    if (opened) return show(which)
    opened = true
    panel.hidden = false
    cam = null
    fullKey = ''
    fillChrome()
    show(which)
    fillHeader()
    if (ctx.onOpen) ctx.onOpen()
  }

  function close() {
    if (!opened) return false
    opened = false
    panel.hidden = true
    pointers.clear()
    if (ctx.onClose) ctx.onClose()
    return true
  }

  // --- Arrastrar, pellizcar y la rueda ------------------------------------

  const pointers = new Map()
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    // Un puntero que ya no existe no se captura: igual cuenta para arrastrar.
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      // sin captura
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  })
  canvas.addEventListener('pointermove', (event) => {
    const was = pointers.get(event.pointerId)
    if (!was || tab !== 'region' || !cam) return
    const before = [...pointers.values()].map((p) => ({ ...p }))
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const after = [...pointers.values()]
    if (after.length >= 2) {
      const step = pinchStep(before.slice(0, 2), after.slice(0, 2), cam.k, {
        min: cam.min,
        max: cam.max
      })
      zoomAt(step.k, step.from, step.to)
    } else {
      cam.cx -= (event.clientX - was.x) / cam.k
      cam.cz -= (event.clientY - was.y) / cam.k
    }
    fullDirty = true
  })
  const lift = (event) => pointers.delete(event.pointerId)
  canvas.addEventListener('pointerup', lift)
  canvas.addEventListener('pointercancel', lift)
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      if (tab !== 'region' || !cam) return
      const at = { x: event.clientX, y: event.clientY }
      const k = Math.min(cam.max, Math.max(cam.min, cam.k * Math.exp(-event.deltaY * 0.0015)))
      zoomAt(k, at, at)
      fullDirty = true
    },
    { passive: false }
  )
  // El punto `from` de la pantalla (antes) queda en `to` (despues) con el zoom k.
  function zoomAt(k, from, to) {
    const r = canvas.getBoundingClientRect()
    const before = viewTransform({
      cx: cam.cx,
      cz: cam.cz,
      k: cam.k,
      ox: r.left + r.width / 2,
      oy: r.top + r.height / 2
    })
    const [mx, mz] = before.unproject(from.x, from.y)
    cam.k = k
    // Que (mx, mz) caiga en `to`.
    cam.cx = mx - (to.x - (r.left + r.width / 2)) / k
    cam.cz = mz - (to.y - (r.top + r.height / 2)) / k
  }

  mini.addEventListener('pointerdown', (event) => {
    // El toque es del minimapa: ni el stick ni la camara lo reciben.
    event.stopPropagation()
  })
  mini.addEventListener('click', (event) => {
    event.stopPropagation()
    open('region')
  })

  // --- Lo que llama la pagina ----------------------------------------------

  function frame(state, mapData, mapToWorld, hidden) {
    toWorld = mapToWorld
    st = state
    data =
      mapData &&
      toWorld &&
      state &&
      state.atlas &&
      state.atlas.region === mapData.id &&
      mapData.rows
        ? mapData
        : null
    if (data !== shown) {
      shown = data
      base = null
      baseFor = null
      miniKey = ''
      cam = null
    }
    const showMini = !!data && !hidden && !opened
    if (mini.hidden === showMini) {
      mini.hidden = !showMini
      if (showMini) fillChrome()
    }
    const now = performance.now()
    if (showMini) paintMini(now)
    if (opened) {
      // Un duelo que empieza o un menu que aparece (un desafio que llega) lo
      // cierran: el mapa no tapa la pelea ni se traga las teclas.
      if (!state || state.title || !state.atlas || state.duel || state.overlay) {
        close()
        return
      }
      const view = ctx.view()
      const key = [
        tab,
        stage.clientWidth,
        stage.clientHeight,
        data ? data.id : '',
        Math.round(((view.heroAt && view.heroAt.x) || 0) * 4),
        Math.round(((view.heroAt && view.heroAt.z) || 0) * 4),
        JSON.stringify(state.atlas.target),
        JSON.stringify(state.atlas.players),
        (state.foes || []).length
      ].join('|')
      if (key !== fullKey && now - fullAt >= MINI_MS) {
        fullKey = key
        fullAt = now
        fillHeader()
        fullDirty = true
      }
      if (fullDirty) {
        fullDirty = false
        paintFull()
      }
    }
  }

  /**
   * Las teclas mientras se juega: M abre o cierra (si se puede abrir), y con el
   * mapa abierto Esc lo cierra, Tab cambia de pestana, las flechas mueven y + o
   * - hacen zoom; ninguna llega al juego. Devuelve si la tecla fue del mapa.
   */
  function key(event, down, canOpen) {
    const k = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (!opened) {
      if (k === 'm' && canOpen && st && st.atlas) {
        if (down && !event.repeat) open('region')
        event.preventDefault()
        return true
      }
      return false
    }
    event.preventDefault()
    if (!down) return true
    if (k === 'm' || k === 'Escape') close()
    else if (k === 'Tab') show(tab === 'region' ? 'kingdom' : 'region')
    else if (cam && tab === 'region') {
      const step = 60 / cam.k
      const pan = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
        a: [-step, 0],
        d: [step, 0],
        w: [0, -step],
        s: [0, step]
      }[k]
      if (pan) {
        cam.cx += pan[0]
        cam.cz += pan[1]
      } else if (k === '+' || k === '=') cam.k = Math.min(cam.max, cam.k * 1.25)
      else if (k === '-') cam.k = Math.max(cam.min, cam.k / 1.25)
      fullDirty = true
    }
    return true
  }

  return {
    frame,
    key,
    open,
    close,
    isOpen: () => opened,
    // Para las pruebas en el navegador (window.runaPage).
    debug: () => ({
      open: opened,
      tab,
      mini: !mini.hidden,
      region: st && st.atlas ? st.atlas.region : null,
      zoom: cam ? cam.k : null
    })
  }
}
