// El inventario de la partida como un panel de la pagina, en vez de la pantalla
// de texto del juego.
//
// La pagina (tripo-heroe.html) lo arma una vez con createInventory(ctx) y en cada
// cuadro de la partida llama a sync(st, session): si el juego tiene abierta una
// pantalla que el panel sabe mostrar (st.overlay, por ejemplo 'inventory'), el
// panel la muestra, refleja el estado del juego y devuelve true, y la pagina no
// abre la pantalla de texto; si no, lo esconde y devuelve false. Las reglas
// siguen siendo las del juego: el panel lee el modelo (session.runa) y actua con
// las mismas teclas que la terminal (session.press). Devuelve null si no arma
// nada.
//
// Recibe `ctx`: tr(texto) (traduce nombres del juego), L(en, es) (textos de la
// pagina en el idioma elegido) y settings (las opciones de quien juega). Si
// tambien trae models() (los GLB de Tripo que hay) y loadGlb(file) (el GLB, del
// cache de la pagina), el objeto elegido que tiene modelo de Tripo (el yelmo de
// hierro) gira en 3D en su ficha, como el yelmo del inventario de la terminal.
//
// Lo que muestra sale de lib/game.js tal cual: la mochila es inventoryItems() en
// el orden del juego, el cursor es inventoryCursor, los totales son duelStats()
// (lo mismo que dibuja la terminal) y el precio es el de la tienda que lo vende
// (player.canBuy, que solo consulta). Lo unico que el panel escribe en el modelo
// es inventoryCursor, al elegir un objeto con el mouse o el dedo; equipar,
// quitar, depositar, retirar, cambiar de pestana y cerrar son las teclas Enter,
// X, Tab y Esc, como en la terminal. El teclado sigue andando igual y el panel
// sigue al cursor del juego y a su registro.
//
// window.runaInventory() cuenta que muestra el panel, para probarlo.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { document, performance } = globalThis

// Las ranuras del juego (lib/shop.js EQUIPMENT_SLOTS), en su orden.
const SLOTS = ['left_hand', 'right_hand', 'chest', 'head', 'boots']
// Donde va cada una en el muneco.
const AREAS = {
  left_hand: 'left',
  right_hand: 'right',
  chest: 'chest',
  head: 'head',
  boots: 'boots'
}

// Como se llama cada ranura en el muneco: por lo que va ahi.
const SLOT_NAMES = {
  left_hand: ['Weapon', 'Arma'],
  right_hand: ['Shield', 'Escudo'],
  chest: ['Chest', 'Pecho'],
  head: ['Head', 'Casco'],
  boots: ['Boots', 'Botas']
}
// Y donde se lleva, como lo dice la terminal (lib/render.js EQUIPMENT_LABELS).
const WORN_ON = {
  left_hand: ['left hand', 'mano izquierda'],
  right_hand: ['right hand', 'mano derecha'],
  chest: ['chest', 'pecho'],
  head: ['head', 'cabeza'],
  boots: ['feet', 'pies']
}
const KINDS = {
  weapon: ['Weapon', 'Arma'],
  shield: ['Shield', 'Escudo'],
  armor: ['Armor', 'Armadura'],
  helmet: ['Helmet', 'Casco'],
  boots: ['Boots', 'Botas']
}
// El dibujo de una ranura vacia: lo que suele ir ahi.
const SLOT_ICONS = {
  left_hand: 'sword',
  right_hand: 'shield',
  chest: 'leather',
  head: 'iron_helmet',
  boots: 'boots'
}
const KIND_ICONS = {
  weapon: 'sword',
  shield: 'shield',
  armor: 'leather',
  helmet: 'iron_helmet',
  boots: 'boots'
}

// Los numeros de un objeto (lib/content.js) y hacia donde es mejor cada uno:
// menos recarga es mejor, el resto suma.
const STATS = [
  { id: 'atk', name: ['Attack', 'Ataque'], icon: 'sword', sign: true, better: 1 },
  { id: 'defense', name: ['Defense', 'Defensa'], icon: 'shield', sign: true, better: 1 },
  { id: 'reach', name: ['Reach', 'Alcance'], icon: 'target', better: 1 },
  { id: 'cooldown', name: ['Cooldown', 'Recarga'], icon: 'hourglass', better: -1 },
  { id: 'speed', name: ['Speed', 'Velocidad'], icon: 'wind', sign: true, better: 1, decimals: 2 }
]

// --- Iconos ------------------------------------------------------------------
// Dibujos de linea en un cuadro de 48, con el color del texto (ambar sobre
// oscuro, como la pagina). Cada objeto del juego tiene el suyo; uno nuevo usa el
// de su tipo.

const BODY = 'fill="currentColor" fill-opacity=".16"'
const TUNIC = 'M17 7 L8 12 L4 21 L10 24 L13 19 V41 H35 V19 L38 24 L44 21 L40 12 L31 7 Q24 13 17 7 Z'

// Los anillos de la cota de malla, en filas corridas.
function rings() {
  let dots = ''
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 16 + col * 4 + (row % 2) * 2
      if (x <= 33) dots += `<circle cx="${x}" cy="${19 + row * 5}" r="1.15"/>`
    }
  }
  return dots
}

const ICONS = {
  dagger:
    '<g transform="rotate(45 24 24)">' +
    `<path d="M24 9 L28 15 V28 H20 V15 Z" ${BODY}/>` +
    '<path d="M16.5 28.5 H31.5"/><path d="M24 30 V36" stroke-width="3.6"/>' +
    '<circle cx="24" cy="39.4" r="2.2"/></g>',
  sword:
    '<g transform="rotate(45 24 24)">' +
    `<path d="M24 2.5 L27 7 V30 H21 V7 Z" ${BODY}/>` +
    '<path d="M24 8 V27" stroke-width="1.1" opacity=".55"/>' +
    '<path d="M15 31 H33"/><path d="M24 32.5 V40" stroke-width="3.6"/>' +
    '<circle cx="24" cy="43.2" r="2.3"/></g>',
  spear:
    '<g transform="rotate(45 24 24)"><path d="M24 16 V46"/>' +
    `<path d="M24 1.5 Q30.5 9 24 15.5 Q17.5 9 24 1.5 Z" ${BODY}/>` +
    '<path d="M21.5 18 H26.5"/></g>',
  warhammer:
    '<g transform="rotate(40 24 24)"><path d="M24 15 V45" stroke-width="3"/>' +
    `<rect x="12" y="4" width="24" height="11" rx="2" ${BODY}/>` +
    '<path d="M17 9.5 H31" stroke-width="1.2" opacity=".7"/></g>',
  crossbow:
    '<path d="M6 21 Q24 6 42 21"/><path d="M6 21 L24 28 L42 21" stroke-width="1.3"/>' +
    '<path d="M24 12 V44" stroke-width="3.2"/><path d="M20 10 L24 5 L28 10"/>' +
    '<path d="M21 37 H27"/>',
  longbow:
    '<path d="M17 4 C35 12 35 36 17 44" stroke-width="2.7"/>' +
    '<path d="M17 4 V44" stroke-width="1.2"/><path d="M8 24 H42"/>' +
    '<path d="M37 19.5 L42.5 24 L37 28.5"/><path d="M8 24 L5 20.5 M8 24 L5 27.5"/>',
  shield:
    `<circle cx="24" cy="24" r="18" ${BODY}/>` +
    '<circle cx="24" cy="24" r="11" stroke-width="1.4" stroke-dasharray="3 3"/>' +
    '<circle cx="24" cy="24" r="4" fill="currentColor"/>',
  boots:
    `<path d="M16 6 H28 V27 L38 30 Q42 31.5 42 36 V40 H12 V31 Q16 27 16 20 Z" ${BODY}/>` +
    '<path d="M16 11 H28" stroke-width="1.3"/><path d="M12 36 H42" stroke-width="1.3"/>',
  leather:
    `<path d="${TUNIC}" ${BODY}/>` +
    '<path d="M24 12 V24" stroke-width="1.3"/>' +
    '<path d="M21.5 15 L26.5 17 M21.5 19.5 L26.5 21.5" stroke-width="1.1"/>' +
    '<path d="M13 33 H35" stroke-width="1.3"/>',
  chainmail:
    `<path d="${TUNIC}" ${BODY}/>` +
    `<g fill="currentColor" stroke="none" opacity=".8">${rings()}</g>`,
  plate:
    `<path d="M15 10 Q24 15 33 10 L39 16 V29 Q39 38 24 43 Q9 38 9 29 V16 Z" ${BODY}/>` +
    '<path d="M24 15 V40" stroke-width="1.3"/>' +
    '<path d="M9 16 Q4 18 4 24 M39 16 Q44 18 44 24"/>' +
    '<path d="M14 26 Q24 30 34 26" stroke-width="1.3"/>',
  leather_cap:
    '<path d="M8 38 Q7 9 24 8 Q41 9 40 38 Q34 41 33 34 Q33 22 24 22 Q15 22 15 34 Q14 41 8 38 Z" ' +
    `${BODY}/><path d="M24 8 Q20 15 21 22" stroke-width="1.2"/>`,
  iron_helmet:
    `<path d="M11 27 Q11 7 24 6 Q37 7 37 27 V37 Q31 42 24 42 Q17 42 11 37 Z" ${BODY}/>` +
    '<path d="M14 23 H34" stroke-width="2.8"/><path d="M24 23 V37" stroke-width="2"/>' +
    '<path d="M24 6 V13" stroke-width="1.3"/>' +
    '<circle cx="16" cy="31" r="1" fill="currentColor"/>' +
    '<circle cx="32" cy="31" r="1" fill="currentColor"/>',
  potion:
    '<path d="M19.5 5 H28.5"/>' +
    '<path d="M21 5 V15 Q11 19 11 30 A13 13 0 0 0 37 30 Q37 19 27 15 V5"/>' +
    '<path d="M13.5 28 Q24 25 34.5 28 Q35 41 24 42 Q13 41 13.5 28 Z" fill="currentColor" ' +
    'fill-opacity=".5" stroke="none"/>',
  coin:
    `<circle cx="24" cy="24" r="16" ${BODY}/>` +
    '<circle cx="24" cy="24" r="11" stroke-width="1.3"/>' +
    '<path d="M24 16 L29 24 L24 32 L19 24 Z" stroke-width="1.6"/>',
  heart:
    '<path d="M24 41 L9 26 Q3 19 9 12 Q16 6 24 14 Q32 6 39 12 Q45 19 39 26 Z" ' +
    'fill="currentColor" fill-opacity=".25"/>',
  target:
    '<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="9.5"/>' +
    '<circle cx="24" cy="24" r="2.6" fill="currentColor"/>',
  hourglass:
    '<path d="M13 6 H35 M13 42 H35"/>' +
    '<path d="M15 6 Q15 18 24 24 Q33 18 33 6 M15 42 Q15 30 24 24 Q33 30 33 42"/>',
  wind: '<path d="M6 17 H29 Q35 17 35 11.5 Q35 6 30 6 M6 27 H37 Q42 27 42 32 Q42 37 37 37 M6 37 H22"/>',
  check: '<path d="M11 25 L20 34 L37 15" stroke-width="4.5"/>',
  close: '<path d="M14 14 L34 34 M34 14 L14 34" stroke-width="3"/>',
  unknown:
    '<rect x="10" y="10" width="28" height="28" rx="4"/>' +
    '<path d="M20 19 Q20 14 24 14 Q28 14 28 18 Q28 21 24 23 V27 M24 32 V33"/>'
}

function icon(name) {
  return (
    '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="none" ' +
    'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    (ICONS[name] || ICONS.unknown) +
    '</svg>'
  )
}

// El de un objeto: el suyo, el de su tipo o el de su ranura.
function itemIcon(item) {
  if (!item) return 'unknown'
  if (ICONS[item.id]) return item.id
  return KIND_ICONS[item.kind] || SLOT_ICONS[item.slot] || 'unknown'
}

// --- El modelo de Tripo en la ficha ------------------------------------------
// Los objetos con modelo, como los viste el heroe de la pagina (SKINS en
// tripo-heroe.html): el yelmo es yelmo.glb y Tripo lo entrega mirando hacia +x.
// Un GLB llamado como el id del objeto (spear.glb) tambien se usa solo.
const TRIPO = { iron_helmet: { file: 'yelmo.glb', yaw: -Math.PI / 2 } }

// Centrado, de un metro y mirando a la camara; la camara se aleja lo que haga
// falta para que entre girando (userData.distance, con 28 grados de lente).
function fitModel(object, spec) {
  object.rotation.y = spec.yaw || 0
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  const dims = box.getSize(new THREE.Vector3())
  const most = Math.max(dims.x, dims.y, dims.z, 1e-6)
  object.position.sub(box.getCenter(new THREE.Vector3()))
  const holder = new THREE.Group()
  holder.add(object)
  holder.scale.setScalar(1 / most)
  const radius = (Math.hypot(dims.x, dims.z) / 2 / most) * 1.02
  const tall = dims.y / 2 / most
  holder.userData.distance = Math.max(radius, tall) / Math.sin(THREE.MathUtils.degToRad(14)) + 0.15
  return holder
}

// Un modelo de Tripo girando en el cuadro del objeto elegido. Tiene su propio
// lienzo WebGL, chico, que se dibuja solo mientras se ve; si algo falla queda el
// dibujo de linea.
function createTurntable(ctx) {
  if (typeof ctx.loadGlb !== 'function' || typeof ctx.models !== 'function') return null
  const canvas = document.createElement('canvas')
  canvas.className = 'inv-model'
  const models = new Map()
  let renderer = null
  let broken = false
  let scene = null
  let camera = null
  let shown = null
  let wanted = null
  let host = null
  let since = 0
  let drawnAt = 0
  let size = ''

  function specOf(id) {
    const spec = TRIPO[id] || { file: id + '.glb', yaw: 0 }
    try {
      const list = ctx.models()
      return list && list.has(spec.file) ? spec : null
    } catch {
      return null
    }
  }

  function setup() {
    if (renderer || broken) return !!renderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    } catch {
      broken = true
      return false
    }
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
    scene = new THREE.Scene()
    // El metal de Tripo necesita algo que reflejar, como en la pagina.
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    scene.environmentIntensity = 0.7
    const key = new THREE.DirectionalLight(0xffe6b8, 2.2)
    key.position.set(2, 3, 4)
    const rim = new THREE.DirectionalLight(0xe0c060, 1.6)
    rim.position.set(-3, 1.5, -3)
    scene.add(new THREE.HemisphereLight(0xfff1d6, 0x1a1408, 1.2), key, rim)
    camera = new THREE.PerspectiveCamera(28, 1, 0.01, 20)
    return true
  }

  function load(id, spec) {
    if (!models.has(id)) {
      models.set(
        id,
        Promise.resolve()
          .then(() => ctx.loadGlb(spec.file))
          .then((object) => (object ? fitModel(object, spec) : null))
          .catch(() => null)
      )
    }
    return models.get(id)
  }

  function place(id, object, el) {
    if (wanted !== id || host !== el || !el.isConnected || !setup()) return
    const fresh = !shown || shown.object !== object
    if (fresh) {
      if (shown) scene.remove(shown.object)
      scene.add(object)
      shown = { id, object }
      since = performance.now()
      const d = object.userData.distance
      camera.position.set(0, d * 0.28, d)
      camera.lookAt(0, 0, 0)
    }
    // La ficha se rearma (al equipar, por ejemplo): el lienzo se muda al cuadro
    // nuevo y sigue girando donde iba.
    el.classList.add('model')
    el.append(canvas)
    size = ''
    if (fresh && canvas.animate) {
      canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' })
    }
  }

  // El cuadro del objeto elegido: si tiene modelo, el lienzo tapa el dibujo
  // cuando el modelo esta listo. Sin id, deja de dibujar.
  function attach(id, el) {
    wanted = id
    host = el
    const spec = id && el ? specOf(id) : null
    if (!spec) return
    load(id, spec).then((object) => {
      if (object) place(id, object, el)
    })
  }

  // A 30 cuadros por segundo alcanza para un objeto que gira despacio, y el
  // mundo de atras se queda con el resto.
  function frame(now) {
    if (!renderer || !shown || shown.id !== wanted || !host || !host.isConnected) return
    if (now - drawnAt < 30) return
    drawnAt = now
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    if (size !== w + 'x' + h) {
      size = w + 'x' + h
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    shown.object.rotation.y = ((now - since) / 1000) * 0.9
    renderer.render(scene, camera)
  }

  return { attach, frame }
}

// El stickman del juego detras de las ranuras del muneco.
const FIGURE =
  '<svg class="inv-figure" viewBox="0 0 120 150" aria-hidden="true" focusable="false" ' +
  'fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round">' +
  '<circle cx="60" cy="22" r="13"/><path d="M60 35 V90"/>' +
  '<path d="M60 47 L32 76 M60 47 L88 76"/><path d="M60 90 L42 136 M60 90 L78 136"/></svg>'

// --- Estilo ------------------------------------------------------------------

const CSS = `
.inv {
  --inv-gold: var(--accent, #e0c060);
  --inv-line: var(--line, #3a3a36);
  --inv-dim: var(--dim, #7a7a72);
  --inv-fg: var(--fg, #d8d8d0);
  --inv-glow: rgba(224, 192, 96, 0.16);
  --inv-cell: 56px;
  position: fixed;
  z-index: 4;
  top: 16px;
  right: 16px;
  bottom: 16px;
  width: clamp(440px, 44vw, 640px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 12px;
  color: var(--inv-fg);
  background:
    radial-gradient(120% 50% at 50% 0%, rgba(224, 192, 96, 0.07), rgba(224, 192, 96, 0) 60%),
    linear-gradient(180deg, #13120f, #09090a);
  border: 1px solid var(--inv-line);
  border-radius: 10px;
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(224, 192, 96, 0.14);
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  container-type: inline-size;
  overflow: hidden;
  animation: inv-in 0.22s ease-out;
}
.inv::before {
  content: '';
  position: absolute;
  inset: 0 12% auto 12%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--inv-gold), transparent);
  opacity: 0.75;
}
.inv button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.inv kbd {
  font: inherit;
  font-size: 11px;
  line-height: 1;
  padding: 3px 5px;
  border: 1px solid currentColor;
  border-radius: 4px;
  opacity: 0.7;
}
.inv-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--inv-line);
}
.inv-title {
  margin: 0;
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--inv-gold);
  white-space: nowrap;
}
.inv-who {
  flex: 1;
  min-width: 0;
  text-align: right;
  color: var(--inv-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inv-who b {
  color: var(--inv-fg);
  font-weight: 600;
}
.inv-close {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 40px;
  height: 38px;
  justify-content: center;
  padding: 0 10px;
  background: rgba(11, 11, 12, 0.8);
  border: 1px solid var(--inv-line);
  border-radius: 6px;
}
.inv-close svg {
  width: 16px;
  height: 16px;
}
.inv-close:hover,
.inv-act:hover,
.inv-tab:hover {
  border-color: var(--inv-gold);
  color: var(--inv-gold);
}
.inv-top {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 18px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--inv-line);
}
.inv-doll {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, var(--inv-cell));
  grid-template-rows: repeat(3, var(--inv-cell));
  gap: 6px;
  grid-template-areas: '. head .' 'left chest right' '. boots .';
}
.inv-figure {
  position: absolute;
  inset: -4px 0;
  width: 100%;
  height: calc(100% + 8px);
  color: var(--inv-gold);
  opacity: 0.1;
  pointer-events: none;
}
.inv-slot {
  position: relative;
  display: grid;
  place-items: center;
  padding: 0;
  background: rgba(16, 15, 13, 0.92);
  border: 1px dashed #4b4840;
  border-radius: 9px;
  color: var(--inv-dim);
  transition: border-color 0.2s, box-shadow 0.2s, color 0.2s;
}
.inv-slot svg {
  width: 58%;
  height: 58%;
  margin-bottom: 9px;
  opacity: 0.28;
}
.inv-slot.on {
  border-style: solid;
  border-color: rgba(224, 192, 96, 0.62);
  color: var(--inv-gold);
  box-shadow: 0 0 16px var(--inv-glow), inset 0 0 14px rgba(224, 192, 96, 0.07);
}
.inv-slot.on svg {
  opacity: 1;
}
.inv-slot.pick {
  border-color: var(--inv-gold);
  box-shadow: 0 0 0 2px rgba(224, 192, 96, 0.4), 0 0 18px rgba(224, 192, 96, 0.28);
}
.inv-slot:hover {
  border-color: var(--inv-gold);
}
.inv-slot small {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 4px;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: center;
  color: var(--inv-dim);
  white-space: nowrap;
  overflow: hidden;
}
.inv-sheet {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.inv-bar {
  position: relative;
  height: 20px;
  background: #1a1a1c;
  border: 1px solid var(--inv-line);
  border-radius: 4px;
  overflow: hidden;
}
.inv-bar i {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(180deg, #d9584a, var(--hp, #c8483a));
  transition: width 0.25s;
}
.inv-bar span {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding-left: 6px;
  font-size: 12px;
}
.inv-bar svg {
  width: 13px;
  height: 13px;
}
.inv-totals {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.inv-total {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 6px 4px 5px;
  background: rgba(16, 15, 13, 0.85);
  border: 1px solid var(--inv-line);
  border-radius: 7px;
  min-width: 0;
}
.inv-total svg {
  width: 18px;
  height: 18px;
  color: var(--inv-gold);
}
.inv-total b {
  font-size: 20px;
  line-height: 1.1;
  color: var(--inv-fg);
}
.inv-total small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--inv-dim);
}
.inv-purse {
  display: flex;
  gap: 18px;
}
.inv-purse span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.inv-purse svg {
  width: 20px;
  height: 20px;
}
.inv-coin {
  color: var(--inv-gold);
}
.inv-potion {
  color: #e07a6a;
}
.inv-tabs {
  display: flex;
  gap: 6px;
  padding-top: 12px;
}
.inv-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  background: rgba(11, 11, 12, 0.7);
  border: 1px solid var(--inv-line);
  border-radius: 6px;
  letter-spacing: 0.06em;
}
.inv-tab[aria-selected='true'] {
  color: var(--inv-gold);
  border-color: var(--inv-gold);
  background: rgba(224, 192, 96, 0.12);
}
.inv-tab small {
  color: var(--inv-dim);
}
.inv-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(150px, 1fr) auto;
  gap: 12px;
  padding-top: 12px;
}
.inv-pack {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.inv-pack-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--inv-dim);
}
.inv-pack-head b {
  color: var(--inv-gold);
  font-weight: normal;
}
.inv-keys {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.inv-list {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 4px 0 0;
  list-style: none;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  scrollbar-width: thin;
  scrollbar-color: #4b4840 transparent;
}
.inv-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  margin-bottom: 3px;
  padding: 3px 8px 3px 5px;
  border: 1px solid transparent;
  border-left-width: 3px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.inv-row:hover {
  background: rgba(224, 192, 96, 0.06);
}
.inv-row.sel {
  background: rgba(224, 192, 96, 0.13);
  border-color: rgba(224, 192, 96, 0.4);
  border-left-color: var(--inv-gold);
}
.inv-row > svg {
  display: block;
  width: 32px;
  height: 32px;
  color: #cfc6a8;
}
.inv-row.sel > svg,
.inv-row.worn > svg {
  color: var(--inv-gold);
}
.inv-row-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}
.inv-row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inv-row.sel .inv-row-name {
  color: var(--inv-gold);
}
.inv-row-text small {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--inv-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inv-row.worn .inv-row-text small {
  color: var(--inv-gold);
}
.inv-mark {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #14120c;
  background: var(--inv-gold);
}
.inv-mark svg {
  width: 14px;
  height: 14px;
}
.inv-empty {
  margin: 8px 2px;
  color: var(--inv-dim);
}
.inv-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  background: rgba(16, 15, 13, 0.75);
  border: 1px solid var(--inv-line);
  border-radius: 9px;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #4b4840 transparent;
}
.inv-detail-top {
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}
.inv-art {
  position: relative;
  display: grid;
  place-items: center;
  width: 66px;
  height: 66px;
  overflow: hidden;
  border-radius: 11px;
  color: var(--inv-gold);
  background:
    radial-gradient(circle at 50% 45%, rgba(224, 192, 96, 0.2), rgba(224, 192, 96, 0) 68%),
    #111;
  border: 1px solid rgba(224, 192, 96, 0.38);
}
.inv-art.worn {
  box-shadow: 0 0 18px rgba(224, 192, 96, 0.22);
}
.inv-art svg {
  width: 72%;
  height: 72%;
  transition: opacity 0.3s;
}
.inv-art.model svg {
  opacity: 0;
}
.inv-model {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.inv-name {
  margin: 0;
  font-size: 17px;
  line-height: 1.25;
  color: var(--inv-gold);
}
.inv-kind {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--inv-dim);
}
.inv-badge {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 7px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid var(--inv-gold);
  border-radius: 4px;
  color: var(--inv-gold);
}
.inv-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 4px 16px;
}
.inv-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.inv-stat span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--inv-dim);
  white-space: nowrap;
}
.inv-stat svg {
  width: 15px;
  height: 15px;
  color: var(--inv-gold);
  opacity: 0.8;
}
.inv-stat b {
  font-weight: normal;
  white-space: nowrap;
}
.inv-up,
.inv-down {
  margin-left: 6px;
  font-size: 12px;
}
.inv-up {
  color: #8fdc7f;
}
.inv-down {
  color: #e8897a;
}
.inv-about {
  margin: 0;
  color: #bdb8a8;
  font-style: italic;
  font-size: 13px;
}
.inv-price,
.inv-versus {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 12px;
  color: var(--inv-dim);
}
.inv-price svg {
  width: 17px;
  height: 17px;
  color: var(--inv-gold);
}
.inv-price b,
.inv-versus b {
  color: var(--inv-fg);
  font-weight: normal;
}
.inv-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--inv-line);
}
.inv-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.inv-act {
  flex: 1 1 150px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 12px;
  background: rgba(11, 11, 12, 0.8);
  border: 1px solid var(--inv-line);
  border-radius: 7px;
  letter-spacing: 0.04em;
}
.inv-act.main {
  color: var(--inv-gold);
  border-color: rgba(224, 192, 96, 0.75);
  background: rgba(224, 192, 96, 0.15);
  box-shadow: inset 0 0 18px rgba(224, 192, 96, 0.08);
}
.inv-act.main:hover {
  background: rgba(224, 192, 96, 0.24);
}
.inv-status {
  min-height: 1.5em;
  margin: 0;
  font-size: 12px;
  color: var(--inv-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inv-status.said {
  color: var(--inv-fg);
}
@container (min-width: 470px) {
  .inv-body {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .inv-stats {
    grid-template-columns: minmax(0, 1fr);
  }
}
@container (max-width: 420px) {
  .inv {
    --inv-cell: 50px;
  }
  .inv-top {
    gap: 12px;
    padding: 10px 0;
  }
  .inv-total b {
    font-size: 17px;
  }
  .inv-detail {
    gap: 8px;
    padding: 10px;
  }
  .inv-detail-top {
    grid-template-columns: 54px minmax(0, 1fr);
  }
  .inv-art {
    width: 54px;
    height: 54px;
  }
  .inv-name {
    font-size: 16px;
  }
  .inv-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px 14px;
  }
}
@keyframes inv-in {
  from {
    opacity: 0;
    transform: translateX(18px);
  }
}
@keyframes inv-up {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}
@media (pointer: coarse) {
  .inv kbd,
  .inv-keys {
    display: none;
  }
}
/* Celular y ventanas chicas: el panel ocupa la pantalla, sin transparencia, y
   tapa el aviso de la pagina (#toast): la linea de estado ya dice lo mismo. */
@media (max-width: 899px), (max-height: 539px) {
  .inv {
    z-index: 6;
    inset: 0;
    width: auto;
    padding: max(12px, env(safe-area-inset-top)) 12px max(10px, env(safe-area-inset-bottom));
    background:
      radial-gradient(120% 40% at 50% 0%, rgba(224, 192, 96, 0.08), rgba(224, 192, 96, 0) 60%),
      #0c0b0a;
    border: 0;
    border-radius: 0;
    animation-name: inv-up;
  }
  .inv-detail {
    max-height: 38vh;
  }
}
/* Celular acostado: el muneco a la izquierda y la mochila al lado. */
@media (max-height: 539px) and (min-width: 600px) {
  .inv {
    --inv-cell: 44px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    column-gap: 16px;
  }
  .inv-head {
    grid-column: 1 / -1;
  }
  .inv-top {
    grid-column: 1;
    grid-row: 2 / 5;
    grid-template-columns: auto;
    align-content: start;
    border-bottom: 0;
  }
  .inv-tabs {
    grid-column: 2;
    grid-row: 2;
  }
  .inv-body {
    grid-column: 2;
    grid-row: 3;
  }
  .inv-foot {
    grid-column: 2;
    grid-row: 4;
  }
  .inv-detail {
    max-height: none;
  }
}
/* Pantallas altas (1080p): la ficha del objeto como una carta, con el dibujo
   grande arriba. */
@media (min-width: 900px) and (min-height: 860px) {
  .inv-detail-top {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    text-align: center;
  }
  .inv-art {
    width: 136px;
    height: 136px;
    border-radius: 16px;
  }
}
`

function addStyle() {
  if (document.getElementById('inv-style')) return
  const style = document.createElement('style')
  style.id = 'inv-style'
  style.textContent = CSS
  document.head.append(style)
}

const esc = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )

// Los nombres del juego vienen en minuscula ("espada"): en el panel van como
// titulo.
const title = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '')

function number(value, stat) {
  const n = Number(value) || 0
  const text = stat.decimals ? n.toFixed(stat.decimals) : String(n)
  return stat.sign && n > 0 ? '+' + text : text
}

// Un salto corto, como el pop de equipar del heroe 3D.
function bounce(element) {
  if (!element.animate) return
  element.animate(
    [
      { transform: 'scale(0.6)' },
      { transform: 'scale(1.14)', offset: 0.6 },
      { transform: 'scale(1)' }
    ],
    { duration: 450, easing: 'ease-out' }
  )
}

// Un brillo que se apaga: algo recien llegado.
function glow(element) {
  if (!element.animate) return
  element.animate(
    [
      { color: '#e0c060', textShadow: '0 0 10px rgba(224, 192, 96, 0.6)' },
      { color: 'inherit', textShadow: '0 0 0 transparent' }
    ],
    { duration: 1400, easing: 'ease-out' }
  )
}

// La pestana del inventario que se ve: el cofre solo existe en el hogar.
const tabOf = (runa) =>
  runa.inventoryHome && runa.inventoryTab === 'stored' ? 'stored' : 'carried'

// Lo que pide por el objeto la tienda que lo vende (player.canBuy solo consulta,
// y dice el precio aunque ya lo tengas); 0 si ninguna lo vende.
function priceOf(runa, id) {
  try {
    const deal = runa.player.canBuy(id)
    return deal && deal.price > 0 ? deal.price : 0
  } catch {
    return 0
  }
}

// La diferencia con lo que ya tiene puesto en esa ranura: verde si mejora.
function change(stat, mine, theirs) {
  const diff = mine - theirs
  if (Math.abs(diff) < 1e-9) return ''
  const good = diff * stat.better > 0
  const size = stat.decimals ? Math.abs(diff).toFixed(stat.decimals) : String(Math.abs(diff))
  const arrow = diff > 0 ? '&#9650;' : '&#9660;'
  return `<i class="${good ? 'inv-up' : 'inv-down'}">${arrow}${size}</i>`
}

// --- El panel ----------------------------------------------------------------

export function createInventory(ctx) {
  if (!document || !document.body || !ctx || typeof ctx.L !== 'function') return null
  const L = ctx.L
  const pick = (pair) => L(pair[0], pair[1])
  const tr = (text) => (text ? String(ctx.tr(String(text)) || text) : '')
  const lang = () => (ctx.settings && ctx.settings.lang) || 'en'
  const touch = () =>
    !!(globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches)

  addStyle()
  const turntable = createTurntable(ctx)
  const root = document.createElement('section')
  root.className = 'inv'
  root.hidden = true
  root.setAttribute('role', 'dialog')
  root.innerHTML =
    '<header class="inv-head"><h2 class="inv-title"></h2><div class="inv-who"></div>' +
    `<button type="button" class="inv-close" data-key="escape">${icon('close')}<kbd>Esc</kbd></button>` +
    '</header>' +
    `<div class="inv-top"><div class="inv-doll">${FIGURE}</div><div class="inv-sheet"></div></div>` +
    '<nav class="inv-tabs" role="tablist" hidden></nav>' +
    '<div class="inv-body"><div class="inv-pack"><div class="inv-pack-head"></div>' +
    '<ul class="inv-list" role="listbox"></ul></div><article class="inv-detail"></article></div>' +
    '<footer class="inv-foot"><div class="inv-actions"></div>' +
    '<p class="inv-status" aria-live="polite"></p></footer>'
  document.body.append(root)
  const part = (selector) => root.querySelector(selector)
  const ui = {
    title: part('.inv-title'),
    who: part('.inv-who'),
    close: part('.inv-close'),
    doll: part('.inv-doll'),
    sheet: part('.inv-sheet'),
    tabs: part('.inv-tabs'),
    packHead: part('.inv-pack-head'),
    list: part('.inv-list'),
    detail: part('.inv-detail'),
    actions: part('.inv-actions'),
    status: part('.inv-status')
  }
  const slots = {}
  for (const slot of SLOTS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'inv-slot'
    b.dataset.slot = slot
    b.style.gridArea = AREAS[slot]
    ui.doll.append(b)
    slots[slot] = b
  }

  let session = null
  let view = null
  let shown = false
  // Lo que ya esta dibujado, por parte: cada una se rehace solo si cambio lo
  // suyo, asi un clic no se pierde porque la fila se rearmo debajo del mouse.
  let drawn = {}
  let wornBefore = null
  // Lo ultimo que dijo el juego cuando se abrio el panel: lo que llegue despues
  // va abajo, en la linea de estado.
  let saidAt = null
  // Elegir algo de la otra pestana (en el hogar): primero Tab, despues el cursor.
  let want = null
  let failure = null
  // El inventario ya se mostro en el panel desde que se abrio.
  let visited = false

  // --- Lo que dice el juego ----------------------------------------------------

  function read(runa, st) {
    const home = !!runa.inventoryHome
    const tab = tabOf(runa)
    const carried = runa.inventoryItems('carried')
    const stored = home ? runa.inventoryItems('stored') : []
    const list = tab === 'stored' ? stored : carried
    const cursor = Math.max(
      0,
      Math.min(list.length - 1, Math.floor(Number(runa.inventoryCursor) || 0))
    )
    const equipped = runa.player.equipped || {}
    const worn = {}
    for (const slot of SLOTS) {
      const id = equipped[slot]
      worn[slot] = id
        ? carried.find((item) => item.id === id) || { id, name: id, slot, kind: 'unknown' }
        : null
    }
    const selected = list[cursor] || null
    const totals = runa.duelStats()
    const log = Array.isArray(runa.log) ? runa.log : []
    return {
      home,
      tab,
      carried,
      stored,
      list,
      cursor,
      selected,
      price: selected ? priceOf(runa, selected.id) : 0,
      worn,
      wornIds: SLOTS.map((slot) => (worn[slot] ? worn[slot].id : '')),
      totals: [Number(totals.atk) || 0, Number(totals.defense) || 0, Number(totals.reach) || 0],
      name: String(st.name || ''),
      level: st.level,
      hp: st.hp,
      maxhp: st.maxhp,
      gold: st.gold,
      potions: st.potions,
      said: log.length ? String(log[log.length - 1]) : '',
      saidCount: log.length
    }
  }

  const wearing = (v, item) => !!item && v.wornIds.includes(item.id)

  // --- Dibujo ------------------------------------------------------------------

  function paintHead(v) {
    ui.title.textContent = v.home
      ? L('[ HOME CHEST ]', '[ COFRE DEL HOGAR ]')
      : L('[ INVENTORY ]', '[ INVENTARIO ]')
    root.setAttribute(
      'aria-label',
      v.home ? L('Home chest', 'Cofre del hogar') : L('Inventory', 'Inventario')
    )
    ui.who.innerHTML = `<b>${esc(v.name)}</b> &middot; ${L('Lv', 'Nv')} ${esc(v.level)}`
    ui.close.setAttribute('aria-label', L('Close', 'Cerrar'))
    ui.close.title = L('Close (Esc)', 'Cerrar (Esc)')
  }

  function paintDoll(v) {
    for (const slot of SLOTS) {
      const b = slots[slot]
      const item = v.worn[slot]
      const name = pick(SLOT_NAMES[slot])
      b.classList.toggle('on', !!item)
      b.innerHTML = icon(item ? itemIcon(item) : SLOT_ICONS[slot]) + `<small>${esc(name)}</small>`
      b.title = name + ': ' + (item ? title(tr(item.name)) : L('empty', 'vacio'))
      b.setAttribute('aria-label', b.title)
      // Lo que se acaba de poner salta, como en el heroe 3D.
      const before = wornBefore ? wornBefore[SLOTS.indexOf(slot)] : null
      if (wornBefore && item && before !== item.id) bounce(b)
    }
    wornBefore = v.wornIds.slice()
  }

  function paintSheet(v) {
    const share = v.maxhp > 0 ? Math.max(0, Math.min(1, v.hp / v.maxhp)) : 0
    const total = (name, label, value) =>
      `<div class="inv-total" title="${esc(label)}">${icon(name)}<b>${esc(value)}</b>` +
      `<small>${esc(label)}</small></div>`
    ui.sheet.innerHTML =
      `<div class="inv-bar" title="${esc(L('Health', 'Vida'))}">` +
      `<i style="width:${(share * 100).toFixed(1)}%"></i>` +
      `<span>${icon('heart')}${esc(L('HP', 'Vida'))} ${esc(v.hp)}/${esc(v.maxhp)}</span></div>` +
      '<div class="inv-totals">' +
      total('sword', L('Attack', 'Ataque'), v.totals[0]) +
      total('shield', L('Defense', 'Defensa'), v.totals[1]) +
      total('target', L('Range', 'Alcance'), v.totals[2]) +
      '</div><div class="inv-purse">' +
      `<span class="inv-coin" title="${esc(L('Gold', 'Oro'))}">${icon('coin')}<b>${esc(v.gold)}</b></span>` +
      `<span class="inv-potion" title="${esc(L('Potions', 'Pociones'))}">${icon('potion')}` +
      `<b>${esc(v.potions)}</b></span></div>`
  }

  function paintTabs(v) {
    ui.tabs.hidden = !v.home
    if (!v.home) {
      ui.tabs.replaceChildren()
      return
    }
    const tab = (id, text, count) =>
      `<button type="button" class="inv-tab" role="tab" data-tab="${id}" ` +
      `aria-selected="${v.tab === id}">${esc(text)} <small>${count}</small>` +
      `${v.tab === id ? '' : '<kbd>Tab</kbd>'}</button>`
    ui.tabs.innerHTML =
      tab('carried', L('Backpack', 'Mochila'), v.carried.length) +
      tab('stored', L('Chest', 'Cofre'), v.stored.length)
  }

  function paintList(v) {
    const stored = v.tab === 'stored'
    ui.packHead.innerHTML =
      `<span>${esc(stored ? L('In the chest', 'En el cofre') : L('Backpack', 'Mochila'))} ` +
      `<b>${v.list.length}</b></span><span class="inv-keys">${esc(L('pick', 'elegir'))} ` +
      '<kbd>&uarr;</kbd><kbd>&darr;</kbd></span>'
    if (!v.list.length) {
      const empty = stored
        ? L('The chest is empty.', 'El cofre esta vacio.')
        : L(
            'Your backpack is empty: the smithy and the armory sell gear.',
            'Tu mochila esta vacia: la herreria y la armeria venden equipo.'
          )
      ui.list.innerHTML = `<li class="inv-empty">${esc(empty)}</li>`
      return
    }
    ui.list.innerHTML = v.list
      .map((item, index) => {
        const on = !stored && wearing(v, item)
        const where = pick(SLOT_NAMES[item.slot] || ['', ''])
        const sub = on ? L('Equipped', 'Equipado') + ' &middot; ' + esc(where) : esc(where)
        return (
          `<li class="inv-row${on ? ' worn' : ''}" role="option" data-index="${index}" ` +
          `aria-selected="false">${icon(itemIcon(item))}<span class="inv-row-text">` +
          `<span class="inv-row-name">${esc(title(tr(item.name)))}</span><small>${sub}</small></span>` +
          (on ? `<span class="inv-mark">${icon('check')}</span>` : '<span></span>') +
          '</li>'
        )
      })
      .join('')
  }

  function statRows(item, other) {
    let html = ''
    for (const stat of STATS) {
      const mine = Number(item[stat.id]) || 0
      const theirs = other ? Number(other[stat.id]) || 0 : 0
      if (!mine && !theirs) continue
      html +=
        `<div class="inv-stat"><span>${icon(stat.icon)}${esc(pick(stat.name))}</span>` +
        `<b>${esc(number(mine, stat))}${other ? change(stat, mine, theirs) : ''}</b></div>`
    }
    return html
  }

  // La ficha sin objeto: la mochila o el cofre vacios.
  function emptyCard(v) {
    const hint =
      v.tab === 'stored'
        ? L('Store gear here to travel light.', 'Guarda equipo aca para viajar liviano.')
        : L('What you buy shows up here.', 'Lo que compres aparece aca.')
    return (
      `<div class="inv-detail-top"><div class="inv-art">${icon('unknown')}</div><div>` +
      `<h3 class="inv-name">${esc(L('Nothing here', 'No hay nada'))}</h3>` +
      `<p class="inv-kind">${esc(hint)}</p></div></div>`
    )
  }

  // Arriba de la ficha: el dibujo, el nombre, el tipo y donde se lleva.
  function cardTop(v, item, on) {
    const kind = KINDS[item.kind] ? pick(KINDS[item.kind]) : title(tr(item.kind || ''))
    const where = WORN_ON[item.slot] ? ' &middot; ' + esc(pick(WORN_ON[item.slot])) : ''
    let badge = ''
    if (on) badge = L('Equipped', 'Equipado')
    else if (v.tab === 'stored') badge = L('In the chest', 'En el cofre')
    return (
      `<div class="inv-detail-top"><div class="inv-art${on ? ' worn' : ''}">${icon(itemIcon(item))}` +
      `</div><div><h3 class="inv-name">${esc(title(tr(item.name)))}</h3>` +
      `<p class="inv-kind">${esc(kind)}${where}</p>` +
      (badge ? `<span class="inv-badge">${esc(badge)}</span>` : '') +
      '</div></div>'
    )
  }

  // Los numeros (contra lo que ya lleva en esa ranura), la descripcion del
  // juego y el precio de la tienda.
  function cardBody(v, item, other) {
    const rows = statRows(item, other)
    let html = other
      ? `<p class="inv-versus">${esc(L('Against your', 'Contra tu'))} ` +
        `<b>${esc(title(tr(other.name)))}</b></p>`
      : ''
    html += rows
      ? `<div class="inv-stats">${rows}</div>`
      : `<p class="inv-versus">${esc(L('No bonuses', 'Sin bonificaciones'))}</p>`
    if (item.about) html += `<p class="inv-about">${esc(title(tr(item.about)))}</p>`
    if (v.price) {
      html +=
        `<p class="inv-price">${icon('coin')}${esc(L('Shop price', 'Precio en la tienda'))} ` +
        `<b>${v.price}</b></p>`
    }
    return html
  }

  function paintDetail(v) {
    const item = v.selected
    if (!item) {
      ui.detail.innerHTML = emptyCard(v)
      if (turntable) turntable.attach(null, null)
      return
    }
    const on = v.tab === 'carried' && wearing(v, item)
    const slotWorn = v.worn[item.slot]
    // Contra lo que ya lleva puesto en esa ranura, si es otra cosa.
    const other = !on && slotWorn && slotWorn.id !== item.id ? slotWorn : null
    ui.detail.innerHTML = cardTop(v, item, on) + cardBody(v, item, other)
    ui.detail.scrollTop = 0
    // El modelo de Tripo, si lo tiene, gira en el cuadro del dibujo.
    if (turntable) turntable.attach(item.id, ui.detail.querySelector('.inv-art'))
  }

  // Los botones del objeto elegido, con la tecla que mandan (lib/game.js
  // inventoryKey): fuera del hogar Enter equipa y X quita; en el hogar Enter
  // pasa al cofre o a la mochila y X equipa o quita.
  function actionsFor(v) {
    const item = v.selected
    if (!item) return []
    if (v.tab === 'stored') {
      return [{ key: 'enter', text: L('Take to backpack', 'Pasar a la mochila'), main: true }]
    }
    const list = []
    if (wearing(v, item)) list.push({ key: 'x', text: L('Unequip', 'Quitar'), main: true })
    else list.push({ key: v.home ? 'x' : 'enter', text: L('Equip', 'Equipar'), main: true })
    if (v.home) list.push({ key: 'enter', text: L('Store in chest', 'Guardar en el cofre') })
    return list
  }

  const KEY_LABELS = { enter: 'Enter', x: 'X', tab: 'Tab', escape: 'Esc' }

  function paintActions(v) {
    const list = actionsFor(v)
    ui.actions.innerHTML = list
      .map(
        (act) =>
          `<button type="button" class="inv-act${act.main ? ' main' : ''}" data-key="${act.key}">` +
          `${esc(act.text)}<kbd>${KEY_LABELS[act.key]}</kbd></button>`
      )
      .join('')
    ui.actions.hidden = !list.length
  }

  function paintPick(v) {
    const rows = ui.list.querySelectorAll('.inv-row')
    rows.forEach((row, index) => {
      const on = index === v.cursor
      row.classList.toggle('sel', on)
      row.setAttribute('aria-selected', String(on))
      if (on) reveal(row)
    })
    const id = v.selected && v.tab === 'carried' ? v.selected.id : ''
    SLOTS.forEach((slot, index) => {
      slots[slot].classList.toggle('pick', !!id && v.wornIds[index] === id)
    })
    paintDetail(v)
    paintActions(v)
  }

  // Que la fila elegida se vea, sin mover nada mas de la pagina.
  function reveal(row) {
    const list = ui.list
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    const room = list.clientHeight
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 4)
    else if (bottom > list.scrollTop + room) list.scrollTop = bottom - room + 4
  }

  // La ultima linea del registro del juego desde que se abrio el panel; antes
  // de eso, como se usa.
  function paintStatus(v) {
    if (!saidAt) saidAt = { said: v.said, count: v.saidCount }
    const fresh = v.said !== saidAt.said || v.saidCount !== saidAt.count
    let text
    if (fresh) text = title(tr(v.said))
    else if (touch()) text = L('Tap an item to see it.', 'Toca un objeto para verlo.')
    else {
      text = L(
        'Click an item to pick it, double click to equip. The keys work too.',
        'Clic en un objeto para elegirlo, doble clic para equiparlo. Las teclas tambien.'
      )
    }
    const before = drawn.status
    if (!redraw('status', [lang(), text, v.saidCount])) return
    ui.status.classList.toggle('said', fresh)
    ui.status.textContent = text
    if (fresh && before) glow(ui.status)
  }

  // Dibuja una parte si cambio lo que muestra; true si la dibujo.
  function redraw(name, parts, draw) {
    const key = JSON.stringify(parts)
    if (drawn[name] === key) return false
    drawn[name] = key
    if (draw) draw()
    return true
  }

  function paint(v) {
    const l = lang()
    const items = v.list.map((item) => item.id)
    redraw('head', [l, v.home, v.name, v.level], () => paintHead(v))
    redraw('doll', [l, v.wornIds], () => paintDoll(v))
    redraw('sheet', [l, v.hp, v.maxhp, v.totals, v.gold, v.potions], () => paintSheet(v))
    redraw('tabs', [l, v.home, v.tab, v.carried.length, v.stored.length], () => paintTabs(v))
    const list = [l, v.tab, items, v.wornIds]
    if (redraw('list', list, () => paintList(v))) drawn.pick = ''
    redraw('pick', [list, v.cursor, v.price], () => paintPick(v))
    paintStatus(v)
  }

  function show() {
    if (shown) return
    shown = true
    root.hidden = false
  }

  function hide() {
    want = null
    if (!shown) return
    shown = false
    root.hidden = true
    drawn = {}
    saidAt = null
    wornBefore = null
    view = null
    if (turntable) turntable.attach(null, null)
  }

  // --- Lo que se toca ------------------------------------------------------------

  function runaOpen() {
    const runa = session && session.runa
    return runa && runa.inventoryOpen ? runa : null
  }

  function press(key) {
    if (runaOpen()) session.press(key)
  }

  // Elegir un objeto es mover el cursor del juego, nada mas.
  function choose(index) {
    const runa = runaOpen()
    if (!runa) return false
    const list = runa.inventoryItems(tabOf(runa))
    if (!(index >= 0 && index < list.length)) return false
    runa.inventoryCursor = index
    return true
  }

  // La ranura del muneco elige lo que lleva puesto, o lo primero de la mochila
  // que va ahi.
  function chooseSlot(slot) {
    const runa = runaOpen()
    if (!runa) return
    const carried = runa.inventoryItems('carried')
    const id = (runa.player.equipped || {})[slot]
    const target = id || (carried.find((item) => item.slot === slot) || {}).id
    if (!target) return
    if (tabOf(runa) === 'carried') {
      choose(carried.findIndex((item) => item.id === target))
      return
    }
    want = { tab: 'carried', id: target, until: performance.now() + 1500 }
    press('tab')
  }

  function settle() {
    const runa = runaOpen()
    if (!want || !runa) return
    if (tabOf(runa) === want.tab) {
      const index = runa.inventoryItems(want.tab).findIndex((item) => item.id === want.id)
      if (index >= 0) runa.inventoryCursor = index
      want = null
    } else if (performance.now() > want.until) want = null
  }

  // Doble clic: lo principal del objeto (equipar o quitar; en el cofre, retirar).
  function primary() {
    const main = view ? actionsFor(view).find((act) => act.main) : null
    if (main) press(main.key)
  }

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-key], [data-index], [data-slot], [data-tab]')
    if (!target || !root.contains(target)) return
    if (target.blur) target.blur()
    const data = target.dataset
    if (data.key) press(data.key)
    else if (data.index) choose(Number(data.index))
    else if (data.slot) chooseSlot(data.slot)
    else if (data.tab && view && data.tab !== view.tab) press('tab')
  })
  root.addEventListener('dblclick', (event) => {
    const row = event.target.closest('[data-index]')
    if (row && root.contains(row) && choose(Number(row.dataset.index))) primary()
  })
  root.addEventListener('contextmenu', (event) => event.preventDefault())

  globalThis.runaInventory = () => ({
    open: shown,
    home: view ? view.home : null,
    tab: view ? view.tab : null,
    cursor: view ? view.cursor : null,
    selected: view && view.selected ? view.selected.id : null,
    items: view ? view.list.map((item) => item.id) : [],
    worn: view ? view.wornIds.slice() : [],
    buttons: [...ui.actions.querySelectorAll('button')].map((b) => ({
      key: b.dataset.key,
      text: b.firstChild ? b.firstChild.textContent : ''
    })),
    status: ui.status.textContent,
    // El modelo de Tripo girando en la ficha.
    model: !!root.querySelector('.inv-art.model canvas'),
    error: failure ? String(failure.message || failure) : null
  })

  // La pantalla de texto de la pagina esta a la vista.
  function textShown() {
    const term = document.getElementById('term')
    return !!term && !term.hidden
  }

  function sync(st, next) {
    session = next || null
    const runa = session && session.runa
    if (!st || !runa || st.title || st.naming || st.overlay !== 'inventory') {
      // La ayuda del juego (?) se abre encima del inventario: al cerrarla vuelve
      // el panel, no la pantalla de texto.
      if (!st || st.overlay !== 'controls') visited = false
      hide()
      return false
    }
    // Si en un mapa 3D quien juega pidio la pantalla de texto (Tab) antes de
    // abrir el inventario, queda la de texto: es lo que eligio ver.
    if (!visited && st.world && textShown()) {
      hide()
      return false
    }
    try {
      settle()
      view = read(runa, st)
      failure = null
    } catch (error) {
      // Si el juego cambio de forma, vuelve la pantalla de texto de siempre.
      failure = error
      hide()
      return false
    }
    visited = true
    show()
    paint(view)
    if (turntable) turntable.frame(performance.now())
    return true
  }

  return { sync }
}
