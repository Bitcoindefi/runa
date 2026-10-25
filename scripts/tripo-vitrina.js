// La vitrina del recorrido libre: los modelos de Tripo en exhibicion.
//
// La pagina (tripo-heroe.html) la arma una vez con createShowcase(ctx); llama a
// show(true) al entrar al lugar Vitrina del recorrido y a show(false) al salir, y
// a update(time, dt) en cada cuadro mientras se ve. Devuelve null si no arma
// nada: queda la vitrina de siempre (el stickman y el reino de Tripo).
//
// Recibe `ctx`: scene, camera, controls, renderer, hero (el stickman y el heroe
// de Tripo), models() (los GLB que hay, Map nombre -> version), loadGlb(file),
// loadRig(file) (GLB con esqueleto y clips), label(texto), L(en, es) y say(texto)
// (un aviso en pantalla).
//
// La sala es un salon redondo a oscuras. Cada modelo de Tripo esta sobre su
// pedestal, con su foco, su haz de luz, un halo en la pared y una placa; la ficha
// de abajo dice que es y como se hizo. La camara se desliza de pieza en pieza
// (flechas o A y D, los botones de la ficha o un clic sobre un modelo) y deja
// girar y acercarse a la que se mira. Si nadie toca nada, pasa sola a la
// siguiente, como en un stand.
//
// El ultimo pedestal es el probador: el stickman de la pagina queda donde esta
// (en el origen, mirando hacia +z) y la mochila (I) y el yelmo (H) del recorrido
// lo siguen vistiendo. Por eso el piso de la sala esta 45 cm debajo de sus pies.
//
// show(false) saca la sala, la ficha y los escuchas, y devuelve las luces, el
// fondo, la niebla, la camara y sus limites como estaban. La sala se arma una
// sola vez: volver a mostrarla no duplica nada.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Este modulo corre en el navegador; el lint del repo lo revisa como codigo de Node.
const { document, window, performance } = globalThis

// Medidas de la sala, en metros.
const FLOOR = -0.45
const MIN_RADIUS = 8.6
const GAP = 3.4
const BEHIND = 2.7
const WALL = 8.5
const LAMPS = FLOOR + 7.6
const TAU = Math.PI * 2
const UP = new THREE.Vector3(0, 1, 0)
// La luz de cada pedestal y la del foco que sigue a la pieza que se mira.
const LAMP = 46
const FOLLOW = 70
// Sin nadie que toque nada, a los IDLE segundos pasa a la siguiente pieza y
// despues sigue cada DWELL.
const IDLE = 25
const DWELL = 11
// Lo que repite el heroe animado: clip y segundos.
const CLIPS = [
  ['Idle', 5],
  ['Walk', 6],
  ['Run', 5]
]
const BACKDROP = 0x070708
// En una pantalla asi de ancha y apaisada la ficha va a la izquierda y la pieza
// a la derecha, a todo lo alto.
const SIDE = '(min-width: 900px) and (min-aspect-ratio: 5/4)'

// Los pedestales: radio y alto. El del heroe y el estrado del probador miden lo
// mismo que la diferencia con el piso: los dos heroes quedan a la altura del
// stickman. La vitrina de vidrio (case) lleva un cubo de `glass` de lado.
const STANDS = {
  plinth: { radius: 0.62, height: -FLOOR },
  dais: { radius: 0.8, height: -FLOOR },
  low: { radius: 1.3, height: 0.3 },
  table: { radius: 1.55, height: 0.86 },
  case: { radius: 0.5, height: 1.04, glass: 0.74 }
}

// Las piezas conocidas, en el orden del recorrido. `size` es el alto del modelo
// (o el ancho, con `wide`) en metros y `yaw` lo gira hacia el frente: Tripo los
// entrega mirando hacia +x, y heroe-anim.glb ya mira hacia +z. `view` es la
// altura de la camara, en grados sobre el horizonte.
const PIECES = [
  {
    key: 'hero-animated',
    file: 'heroe-anim.glb',
    rig: true,
    size: 2.1,
    yaw: 0,
    stand: 'plinth',
    view: 8,
    name: ['The hero, animated', 'El heroe, animado'],
    note: [
      'Made with Tripo (H3.1). Higgsfield gave it a 24-bone skeleton and animated it.',
      'Hecho con Tripo (H3.1). Higgsfield le puso un esqueleto de 24 huesos y lo animo.'
    ],
    credit: 'TRIPO + HIGGSFIELD'
  },
  {
    key: 'hero',
    file: 'heroe.glb',
    size: 2.1,
    yaw: -Math.PI / 2,
    stand: 'plinth',
    view: 8,
    name: ['The hero', 'El heroe'],
    note: [
      'Made with Tripo from a text prompt. In the city he is the 12 m statue of the square.',
      'Hecho con Tripo desde un texto. En la ciudad es la estatua de 12 m de la plaza.'
    ]
  },
  {
    // El mismo Coloso con esqueleto que el titulo y el jefe (un solo GLB en la
    // GPU del telefono); sin el, el quieto.
    key: 'colossus',
    file: 'coloso-anim.glb',
    fallback: 'coloso.glb',
    rig: true,
    clips: [
      ['Idle', 6],
      ['Roar', 2],
      ['Attack_Slam', 1.5]
    ],
    size: 3.9,
    yaw: -Math.PI / 2,
    stand: 'low',
    view: 6,
    name: ['The Runic Colossus', 'El Coloso runico'],
    note: [
      'Made with Tripo. The world boss: it waits in the volcanic ruins for every player.',
      'Hecho con Tripo. El jefe del mundo: espera a todos en las ruinas volcanicas.'
    ]
  },
  {
    key: 'kingdom',
    file: 'paisaje.glb',
    size: 2.9,
    wide: true,
    yaw: 0,
    stand: 'table',
    view: 18,
    name: ['The kingdom diorama', 'La maqueta del reino'],
    note: [
      'Made with Tripo: the walled kingdom, the hero and the Colossus in a single model.',
      'Hecho con Tripo: el reino amurallado, el heroe y el Coloso en un solo modelo.'
    ]
  },
  {
    key: 'sword',
    file: 'sword.glb',
    size: 1.0,
    yaw: -Math.PI / 2,
    stand: 'plinth',
    view: 10,
    name: ['The rune sword', 'La espada runica'],
    note: [
      'Made with Tripo. In the game it is the sword: equip it and the hero carries it.',
      'Hecho con Tripo. En el juego es la espada: equipala y el heroe la lleva.'
    ],
    acts: ['bag']
  },
  {
    key: 'shield',
    file: 'shield.glb',
    size: 0.9,
    yaw: -Math.PI / 2,
    stand: 'plinth',
    view: 10,
    name: ['The rune shield', 'El escudo runico'],
    note: [
      'Made with Tripo. In the game it is the shield: equip it and the hero carries it.',
      'Hecho con Tripo. En el juego es el escudo: equipalo y el heroe lo lleva.'
    ],
    acts: ['bag']
  },
  // Las armas de Tripo Studio: llegan inclinadas, como en su visor, y asi giran
  // en el pedestal. `size` es su alto, no su largo.
  {
    key: 'dagger',
    file: 'dagger.glb',
    size: 0.6,
    yaw: -Math.PI / 2,
    stand: 'plinth',
    view: 10,
    name: ['The rune dagger', 'La daga runica'],
    note: [
      'Made with Tripo. The cheapest weapon in the shop: equip it and the hero carries it.',
      'Hecho con Tripo. El arma mas barata de la tienda: equipala y el heroe la lleva.'
    ],
    acts: ['bag']
  },
  {
    key: 'spear',
    file: 'spear.glb',
    size: 1.6,
    yaw: -Math.PI / 2,
    stand: 'plinth',
    view: 10,
    name: ['The war spear', 'La lanza de guerra'],
    note: [
      'Made with Tripo. Reach 6: it hits before the foe gets close.',
      'Hecho con Tripo. Alcance 6: pega antes de que el enemigo llegue.'
    ],
    acts: ['bag']
  },
  {
    key: 'warhammer',
    file: 'warhammer.glb',
    size: 1.1,
    yaw: -Math.PI / 2,
    stand: 'plinth',
    view: 10,
    name: ['The war hammer', 'El martillo de guerra'],
    note: [
      'Made with Tripo. The heaviest blow in the game, and the slowest.',
      'Hecho con Tripo. El golpe mas pesado del juego, y el mas lento.'
    ],
    acts: ['bag']
  },
  {
    key: 'crossbow',
    file: 'crossbow.glb',
    size: 0.62,
    yaw: -Math.PI / 2,
    stand: 'plinth',
    view: 10,
    name: ['The crossbow', 'La ballesta'],
    note: [
      'Made with Tripo. Reach 14: it shoots from far away.',
      'Hecho con Tripo. Alcance 14: dispara de lejos.'
    ],
    acts: ['bag']
  },
  {
    key: 'longbow',
    file: 'longbow.glb',
    size: 1.5,
    yaw: -Math.PI / 2,
    stand: 'plinth',
    view: 10,
    name: ['The longbow', 'El arco largo'],
    note: [
      'Made with Tripo. Reach 18, the longest of any weapon.',
      'Hecho con Tripo. Alcance 18, el mas largo de todas las armas.'
    ],
    acts: ['bag']
  },
  {
    key: 'helmet',
    file: 'yelmo.glb',
    size: 0.46,
    wide: true,
    yaw: -Math.PI / 2,
    stand: 'case',
    view: 12,
    name: ['The iron rune helmet', 'El yelmo runico'],
    note: [
      'Made with Tripo. In the game it gives +2 defense. Try it on the stickman.',
      'Hecho con Tripo. En el juego da +2 de defensa. Probaselo al stickman.'
    ],
    acts: ['helmet']
  }
]
const FITTING = {
  key: 'fitting',
  fitting: true,
  stand: 'dais',
  view: 10,
  name: ['The fitting room', 'El probador'],
  note: [
    'The stickman of the page wears what you pick from the tour bag, Tripo helmet included.',
    'El stickman de la pagina se pone lo que elijas de la mochila, yelmo de Tripo incluido.'
  ],
  credit: 'RUNA',
  acts: ['bag', 'helmet']
}

// Un GLB que la vitrina no conoce: su nombre de archivo, legible.
function titled(file) {
  const base = file
    .replace(/\.glb$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return base.charAt(0).toUpperCase() + base.slice(1)
}

// Un numero al azar repetible, para que la sala salga igual en cada visita.
function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const pop = (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2)
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle))
const lerp = (a, b, k) => a + (b - a) * k

// --- Texturas pintadas -------------------------------------------------------

function canvasOf(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function text(value) {
  const span = document.createElement('span')
  span.textContent = value
  return span
}

function textureOf(canvas) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// El piso: losas de piedra oscura en anillos alrededor del centro de la sala, con
// filetes dorados que marcan el arco de los pedestales y la luz de cada foco ya
// pintada. El piso, la pared y el techo no se iluminan: llenan la pantalla, y con
// ocho luces costaban demasiado en una placa de video modesta. `size` es el radio
// del disco, `ring` el del arco y `pools` las manchas de luz ({ x, z, r } desde el
// centro, en metros).
function floorTexture(size, ring, pools) {
  const canvas = canvasOf(1024, 1024)
  const g = canvas.getContext('2d')
  const c = 512
  const k = 512 / size
  const base = g.createRadialGradient(c, c, 0, c, c, 512)
  base.addColorStop(0, '#1f1c18')
  base.addColorStop(0.6, '#191714')
  base.addColorStop(1, '#0e0d0b')
  g.fillStyle = base
  g.fillRect(0, 0, 1024, 1024)
  const random = seeded(7)
  for (let i = 0; i < 14000; i++) {
    const shade = random() < 0.5 ? '255, 240, 210' : '0, 0, 0'
    g.fillStyle = `rgba(${shade}, ${(random() * 0.05).toFixed(3)})`
    g.fillRect(random() * 1024, random() * 1024, 1 + random() * 2, 1 + random() * 2)
  }
  // Juntas: un anillo cada 1,3 m y losas de 1,6 m de largo, trabadas.
  g.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  g.lineWidth = 2
  for (let r = 1.3, row = 0; r < size; r += 1.3, row++) {
    g.beginPath()
    g.arc(c, c, r * k, 0, TAU)
    g.stroke()
    const count = Math.max(8, Math.round((TAU * r) / 1.6))
    for (let j = 0; j < count; j++) {
      const a = ((j + (row % 2) * 0.5) / count) * TAU
      g.beginPath()
      g.moveTo(c + Math.cos(a) * r * k, c + Math.sin(a) * r * k)
      g.lineTo(c + Math.cos(a) * (r + 1.3) * k, c + Math.sin(a) * (r + 1.3) * k)
      g.stroke()
    }
  }
  // La luz de los focos, sumada.
  g.globalCompositeOperation = 'lighter'
  for (const pool of pools) {
    const x = c + pool.x * k
    const y = c + pool.z * k
    const r = pool.r * k
    const light = g.createRadialGradient(x, y, 0, x, y, r)
    light.addColorStop(0, 'rgba(255, 206, 150, 0.2)')
    light.addColorStop(0.45, 'rgba(255, 200, 140, 0.08)')
    light.addColorStop(1, 'rgba(255, 200, 140, 0)')
    g.fillStyle = light
    g.fillRect(x - r, y - r, 2 * r, 2 * r)
  }
  g.globalCompositeOperation = 'source-over'
  g.strokeStyle = 'rgba(224, 192, 96, 0.6)'
  g.lineWidth = 3
  for (const r of [2.2, ring - 2.05, ring + 1.95]) {
    g.beginPath()
    g.arc(c, c, r * k, 0, TAU)
    g.stroke()
  }
  const texture = textureOf(canvas)
  texture.anisotropy = 8
  return texture
}

// La pared: paneles altos con un marco fino, como los de un museo, que se
// oscurecen hacia el techo.
function wallTexture() {
  const canvas = canvasOf(256, 512)
  const g = canvas.getContext('2d')
  g.fillStyle = '#12110e'
  g.fillRect(0, 0, 256, 512)
  g.fillStyle = '#171511'
  g.fillRect(22, 70, 212, 360)
  g.strokeStyle = 'rgba(255, 235, 200, 0.07)'
  g.lineWidth = 2
  g.strokeRect(22, 70, 212, 360)
  g.strokeStyle = 'rgba(0, 0, 0, 0.45)'
  g.strokeRect(27, 75, 202, 350)
  g.fillStyle = '#0c0b09'
  g.fillRect(0, 0, 8, 512)
  g.fillRect(248, 0, 8, 512)
  const shade = g.createLinearGradient(0, 0, 0, 512)
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.75)')
  shade.addColorStop(0.55, 'rgba(0, 0, 0, 0.1)')
  shade.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.fillStyle = shade
  g.fillRect(0, 0, 256, 512)
  const texture = textureOf(canvas)
  texture.wrapS = THREE.RepeatWrapping
  return texture
}

// Un degrade redondo: el halo de la pared, la sombra al pie de cada pedestal y
// las motas de polvo en la luz.
function glowTexture(color, middle = 0.4) {
  const canvas = canvasOf(128, 128)
  const g = canvas.getContext('2d')
  const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, `rgba(${color}, 1)`)
  gradient.addColorStop(middle, `rgba(${color}, 0.42)`)
  gradient.addColorStop(1, `rgba(${color}, 0)`)
  g.fillStyle = gradient
  g.fillRect(0, 0, 128, 128)
  return textureOf(canvas)
}

// La placa de bronce de cada pedestal: el nombre y quien lo hizo.
function plaqueTexture(title, credit) {
  const canvas = canvasOf(512, 144)
  const g = canvas.getContext('2d')
  const plate = g.createLinearGradient(0, 0, 0, 144)
  plate.addColorStop(0, '#4c3c22')
  plate.addColorStop(0.5, '#34291a')
  plate.addColorStop(1, '#241c12')
  g.fillStyle = plate
  g.fillRect(0, 0, 512, 144)
  g.strokeStyle = '#d8b25a'
  g.lineWidth = 5
  g.strokeRect(7, 7, 498, 130)
  g.strokeStyle = 'rgba(216, 178, 90, 0.45)'
  g.lineWidth = 1.5
  g.strokeRect(17, 17, 478, 110)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const text = title.toUpperCase()
  const font = (px) => `bold ${px}px ui-monospace, Menlo, Consolas, monospace`
  let px = 40
  g.font = font(px)
  while (g.measureText(text).width > 450 && px > 18) g.font = font(--px)
  g.fillStyle = '#f2d98c'
  g.fillText(text, 256, 60)
  g.font = '22px ui-monospace, Menlo, Consolas, monospace'
  g.fillStyle = '#b89a5c'
  g.fillText(credit, 256, 106)
  return textureOf(canvas)
}

// El haz de cada foco: un cono abierto que suma luz, mas fuerte de frente que en
// los bordes, y que se apaga hacia el piso y hacia la lampara.
function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      strength: { value: 0.1 }
    },
    vertexShader: `
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vAlong = uv.y;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-view.xyz);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float strength;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float fade = smoothstep(0.0, 0.6, vAlong) * (1.0 - smoothstep(0.84, 1.0, vAlong));
        gl_FragColor = vec4(color * strength * pow(facing, 2.0) * fade, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
}

function cylinder(top, bottom, height, y) {
  return new THREE.CylinderGeometry(top, bottom, height, 48).translate(0, y, 0)
}

function box(width, height, depth, y) {
  return new THREE.BoxGeometry(width, height, depth).translate(0, y, 0)
}

// Geometrias que comparten todas las piezas.
const PLANE = new THREE.PlaneGeometry(1, 1)
const FLAT = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
const BEAM = new THREE.ConeGeometry(1, 1, 40, 1, true)
const PICK = new THREE.CylinderGeometry(1, 1, 1, 16)
const SEED = new THREE.IcosahedronGeometry(0.26, 1)

// La ficha de la pieza que se mira, abajo y al centro.
const CSS = `
#vitrina-card {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  width: min(660px, calc(100vw - 32px));
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) 46px;
  align-items: center;
  gap: 12px;
  padding: 10px;
  background: rgba(11, 11, 12, 0.93);
  border: 1px solid #3a3a36;
  border-top-color: rgba(224, 192, 96, 0.6);
  color: #d8d8d0;
  font: 14px/1.45 ui-monospace, Menlo, Consolas, monospace;
  z-index: 3;
  animation: vitrina-in 0.5s ease-out;
}
@keyframes vitrina-in {
  from {
    opacity: 0;
    transform: translate(-50%, 12px);
  }
}
#vitrina-card button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: rgba(11, 11, 12, 0.72);
  border: 1px solid #3a3a36;
  user-select: none;
  -webkit-user-select: none;
}
#vitrina-card button:focus-visible {
  border-color: #e0c060;
  color: #e0c060;
  outline: none;
}
/* En una pantalla tactil el ultimo boton tocado queda en :hover. */
@media (hover: hover) {
  #vitrina-card button:hover {
    border-color: #e0c060;
    color: #e0c060;
  }
}
#vitrina-card .nav {
  width: 46px;
  height: 46px;
  padding: 0;
  font-size: 18px;
}
#vitrina-card .head {
  display: flex;
  align-items: center;
  gap: 4px 10px;
  flex-wrap: wrap;
}
#vitrina-card .count {
  color: #7a7a72;
  font-size: 12px;
  letter-spacing: 0.12em;
}
#vitrina-card .name {
  color: #e0c060;
  font-weight: normal;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
#vitrina-card .note {
  margin-top: 2px;
}
#vitrina-card .tip {
  margin-top: 4px;
  color: #7a7a72;
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}
#vitrina-card .tip b {
  color: #d8d8d0;
  font-weight: normal;
}
#vitrina-card .tip button {
  padding: 3px 9px;
  min-height: 30px;
  font-size: 12px;
  color: #e0c060;
}
#vitrina-card .dots {
  display: flex;
  margin-left: auto;
}
#vitrina-card .dots button {
  position: relative;
  width: 26px;
  height: 18px;
  padding: 0;
  border: 0;
  background: none;
}
#vitrina-card .dots button::after {
  content: '';
  position: absolute;
  left: 3px;
  right: 3px;
  top: 8px;
  height: 3px;
  background: #3a3a36;
}
#vitrina-card .dots button[aria-current='true']::after {
  background: #e0c060;
}
body.runa-vitrina #toast {
  bottom: max(32px, var(--vitrina-lift, 0px));
}
#vitrina-shade {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(7, 7, 8, 0.7) 0%,
    rgba(7, 7, 8, 0.25) 22%,
    rgba(7, 7, 8, 0) 36%
  );
  animation: vitrina-fade 0.6s ease-out;
}
@keyframes vitrina-fade {
  from {
    opacity: 0;
  }
}
@media ${SIDE} {
  #vitrina-card {
    left: 16px;
    transform: none;
    width: min(620px, 48vw);
    animation-name: vitrina-side;
  }
  #vitrina-shade {
    background: linear-gradient(
      90deg,
      rgba(7, 7, 8, 0.85) 0%,
      rgba(7, 7, 8, 0.55) 34%,
      rgba(7, 7, 8, 0) 56%
    );
  }
}
@keyframes vitrina-side {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}
@media (pointer: coarse) {
  #vitrina-card {
    gap: 8px;
    padding: 8px;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
  }
  #vitrina-card .nav {
    width: 44px;
    height: 44px;
  }
  #vitrina-card .note {
    font-size: 13px;
  }
  #vitrina-card .tip button {
    min-height: 36px;
  }
  /* La mochila va justo arriba de la ficha, y la ficha se achica mientras
     esta abierta: asi queda lugar para ver al stickman. */
  body.runa-vitrina #bag {
    bottom: var(--vitrina-lift, 200px);
  }
  body.runa-vitrina-bag #vitrina-card .note,
  body.runa-vitrina-bag #vitrina-card .tip > span {
    display: none;
  }
}
@media (max-width: 520px) {
  #vitrina-card .dots {
    display: none;
  }
}
/* Celular acostado: la ficha queda en el nombre y los botones. */
@media (max-height: 500px) {
  #vitrina-card .note,
  #vitrina-card .tip > span {
    display: none;
  }
}
`

// Lo que la vitrina toca de los controles de la camara y devuelve al salir.
const LIMITS = [
  'enabled',
  'autoRotate',
  'autoRotateSpeed',
  'enablePan',
  'minDistance',
  'maxDistance',
  'minPolarAngle',
  'maxPolarAngle',
  'minAzimuthAngle',
  'maxAzimuthAngle'
]

export function createShowcase(ctx) {
  const { scene, camera, controls, renderer, hero } = ctx
  if (!scene || !camera || !controls || !renderer || !hero || !hero.root) return null
  const L = ctx.L || ((en) => en)
  const pick = (pair) => L(pair[0], pair[1])
  const canvas = renderer.domElement
  const coarse = Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  const side = () => Boolean(window.matchMedia && window.matchMedia(SIDE).matches)
  const backdrop = new THREE.Color(BACKDROP)
  const fog = new THREE.Fog(BACKDROP, 16, 44)
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  // La sala, que se arma la primera vez que se muestra.
  const center = new THREE.Vector3()
  let radius = MIN_RADIUS
  let hall = null
  let exhibits = []
  let follow = null
  let dust = null
  let paintedIn = ''

  // Mientras se ve.
  let shown = false
  let saved = null
  let focus = 0
  let glide = null
  let orbiting = false
  let spinRest = 0
  let idle = 0
  let autoplay = false
  let gearSeen = ''
  let pulse = 0
  let layoutSeen = ''
  let layoutClock = 0
  let childrenSeen = 0
  let press = null
  let hoverClock = 0
  let card = null
  let style = null
  let shade = null
  let bagShown = false

  // --- La sala -------------------------------------------------------------

  function build() {
    const list = pieces()
    const angles = arc(list)
    hall = new THREE.Group()
    hall.name = 'vitrina'
    const shared = materials()
    hall.add(room(list, angles))
    hall.add(new THREE.HemisphereLight(0x8d96ab, 0x1d160d, 0.32))
    exhibits = list.map((spec, i) => exhibit(spec, angles[i], i, shared))
    for (const ex of exhibits) hall.add(ex.group, ex.lamp, ex.lamp.target, ex.beam, ex.halo)
    hall.add(...fixtures(shared))
    follow = followSpot()
    hall.add(follow, follow.target)
    dust = motes(shared)
    hall.add(dust)
    for (const ex of exhibits) load(ex)
  }

  // Las piezas que hay: las conocidas en su orden, los GLB que la vitrina no
  // conoce antes del yelmo (asi el yelmo queda al lado del probador) y el
  // probador al final.
  function pieces() {
    const have = (ctx.models && ctx.models()) || new Map()
    // Sin el GLB con esqueleto va el quieto, sin clips.
    const known = PIECES.map((piece) =>
      !have.has(piece.file) && piece.fallback && have.has(piece.fallback)
        ? { ...piece, file: piece.fallback, rig: false }
        : piece
    ).filter((piece) => have.has(piece.file))
    const listed = new Set(PIECES.flatMap((piece) => [piece.file, piece.fallback]))
    const extra = [...have.keys()]
      .filter((file) => /\.glb$/i.test(file) && !listed.has(file))
      .sort()
      .map((file) => ({
        key: file.replace(/\.glb$/i, ''),
        file,
        size: 1.5,
        yaw: -Math.PI / 2,
        stand: 'plinth',
        view: 12,
        name: [titled(file), titled(file)],
        note: ['Made with Tripo.', 'Hecho con Tripo.']
      }))
    const helmet = known.findIndex((piece) => piece.key === 'helmet')
    const at = helmet < 0 ? known.length : helmet
    return [...known.slice(0, at), ...extra, ...known.slice(at), FITTING]
  }

  // Los pedestales van sobre un arco alrededor del centro de la sala, separados
  // segun su ancho. El probador queda ultimo y en el origen, con el centro de la
  // sala frente al stickman: `radius` metros hacia +z.
  function arc(list) {
    const widths = list.map((spec) => STANDS[spec.stand].radius)
    const steps = widths.slice(1).map((width, i) => widths[i] + width + GAP)
    const length = steps.reduce((sum, step) => sum + step, 0)
    radius = Math.max(MIN_RADIUS, length / 4.4)
    center.set(0, 0, radius)
    const angles = [-length / radius]
    for (const step of steps) angles.push(angles[angles.length - 1] + step / radius)
    return angles
  }

  function materials() {
    return {
      stone: new THREE.MeshStandardMaterial({ color: 0x27231e, roughness: 0.6 }),
      // Mate: pulida, la tapa espejaba el foco y se veia blanca.
      top: new THREE.MeshStandardMaterial({ color: 0x302b25, roughness: 0.62 }),
      gold: new THREE.MeshStandardMaterial({
        color: 0xc9a245,
        metalness: 0.85,
        roughness: 0.3,
        emissive: 0x2a1c05
      }),
      velvet: new THREE.MeshStandardMaterial({ color: 0x4a1616, roughness: 1 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x1c1b19, metalness: 0.7, roughness: 0.45 }),
      lens: new THREE.MeshBasicMaterial({ color: 0xfff1d6 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0xcfe0ea,
        roughness: 0.05,
        metalness: 0.1,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        envMapIntensity: 2
      }),
      rune: new THREE.MeshBasicMaterial({ color: 0xe0a83a, transparent: true, opacity: 0.85 }),
      wire: new THREE.MeshBasicMaterial({
        color: 0xe0c060,
        wireframe: true,
        transparent: true,
        opacity: 0.5
      }),
      shadow: new THREE.MeshBasicMaterial({
        map: glowTexture('0, 0, 0', 0.45),
        transparent: true,
        depthWrite: false
      }),
      halo: glowTexture('255, 255, 255'),
      mote: glowTexture('255, 255, 255', 0.25)
    }
  }

  // El piso, la pared con sus paneles, el zocalo, dos filetes dorados y el
  // techo, casi negro. No se iluminan: la luz de los focos va pintada en el piso
  // y los halos de la pared.
  function room(list, angles) {
    const group = new THREE.Group()
    const reach = radius + BEHIND
    const pools = list.map((spec, i) => ({
      x: Math.sin(angles[i]) * (radius - 0.5),
      z: -Math.cos(angles[i]) * (radius - 0.5),
      r: STANDS[spec.stand].radius * 2.2 + 0.9
    }))
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(reach + 0.4, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: floorTexture(reach + 0.4, radius, pools) })
    )
    floor.position.set(center.x, FLOOR, center.z)
    const panels = wallTexture()
    panels.repeat.set(Math.round((TAU * reach) / 2.6), 1)
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(reach, reach, WALL, 96, 1, true),
      new THREE.MeshBasicMaterial({ map: panels, side: THREE.BackSide })
    )
    wall.position.set(center.x, FLOOR + WALL / 2, center.z)
    const skirting = new THREE.Mesh(
      new THREE.CylinderGeometry(reach - 0.02, reach - 0.02, 0.32, 96, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x080706, side: THREE.BackSide })
    )
    skirting.position.set(center.x, FLOOR + 0.16, center.z)
    const lines = [0.33, 3.9].map((y) =>
      new THREE.CylinderGeometry(reach - 0.035, reach - 0.035, 0.03, 96, 1, true).translate(0, y, 0)
    )
    const trim = new THREE.Mesh(
      mergeGeometries(lines),
      new THREE.MeshBasicMaterial({ color: 0x9a7a3a, side: THREE.BackSide })
    )
    for (const line of lines) line.dispose()
    trim.position.set(center.x, FLOOR, center.z)
    const ceiling = new THREE.Mesh(
      new THREE.CircleGeometry(reach + 0.1, 96).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x060505 })
    )
    ceiling.position.set(center.x, FLOOR + WALL, center.z)
    group.add(floor, wall, skirting, trim, ceiling)
    return group
  }

  // Las lamparas de los focos: una lata oscura colgada del techo, apuntando a su
  // pieza, con la boca encendida. Todas van en dos mallas.
  function fixtures(shared) {
    const cans = []
    const lenses = []
    const rod = new THREE.Vector3()
    for (const ex of exhibits) {
      const from = ex.lamp.position
      const down = ex.lamp.target.position.clone().sub(from).normalize()
      const turn = new THREE.Quaternion().setFromUnitVectors(UP.clone().negate(), down)
      const place = (geometry, offset) =>
        geometry
          .applyQuaternion(turn)
          .translate(...from.clone().addScaledVector(down, offset).toArray())
      cans.push(place(new THREE.CylinderGeometry(0.11, 0.15, 0.34, 20), -0.05))
      lenses.push(place(new THREE.CircleGeometry(0.13, 20).rotateX(Math.PI / 2), 0.125))
      const height = FLOOR + WALL - from.y
      rod.copy(from)
      cans.push(
        new THREE.CylinderGeometry(0.014, 0.014, height, 6).translate(
          rod.x,
          from.y + height / 2,
          rod.z
        )
      )
    }
    const body = new THREE.Mesh(mergeGeometries(cans), shared.metal)
    const glow = new THREE.Mesh(mergeGeometries(lenses), shared.lens)
    for (const geometry of [...cans, ...lenses]) geometry.dispose()
    return [body, glow]
  }

  function exhibit(spec, phi, index, shared) {
    const stand = STANDS[spec.stand]
    const at = new THREE.Vector3(
      center.x + Math.sin(phi) * radius,
      FLOOR,
      center.z - Math.cos(phi) * radius
    )
    const inward = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi))
    const group = new THREE.Group()
    group.position.copy(at)
    group.rotation.y = -phi
    const base = pedestal(spec.stand, shared)
    group.add(base.group)
    const spinner = new THREE.Group()
    spinner.position.y = base.top
    group.add(spinner)
    const ex = {
      spec,
      index,
      phi,
      at,
      inward,
      stand,
      group,
      spinner,
      ring: base.ring,
      model: null,
      grow: 1,
      mixer: null,
      clip: '',
      weight: 0,
      loading: false,
      failed: false,
      placeholder: null
    }
    const shadow = new THREE.Mesh(FLAT, shared.shadow)
    shadow.scale.set(stand.radius * 3.4, 1, stand.radius * 3.4)
    shadow.position.y = 0.004
    // La luz del foco en el piso: se enciende mas en la pieza que se mira.
    ex.pool = new THREE.Mesh(
      FLAT,
      new THREE.MeshBasicMaterial({
        map: shared.halo,
        color: 0x7a5c36,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    ex.pool.scale.set(stand.radius * 4 + 1.2, 1, stand.radius * 4 + 1.2)
    ex.pool.position.set(0, 0.006, 0.45)
    group.add(shadow, ex.pool)
    ex.plaque = plaque(spec, stand)
    group.add(ex.plaque)
    ex.proxy = new THREE.Mesh(PICK)
    ex.proxy.visible = false
    ex.proxy.userData.index = index
    group.add(ex.proxy)
    if (!spec.fitting) {
      ex.placeholder = new THREE.Mesh(SEED, shared.wire)
      ex.placeholder.position.y = spec.wide ? spec.size * 0.3 : spec.size * 0.5
      spinner.add(ex.placeholder)
    }
    ex.frame = frameFor(ex, null)
    ex.lamp = new THREE.SpotLight(0xffe7c8, LAMP * 0.5, 24, 0.4, 0.6, 2)
    ex.beam = new THREE.Mesh(BEAM, beamMaterial(0xffe2b0))
    ex.halo = new THREE.Mesh(
      PLANE,
      new THREE.MeshBasicMaterial({
        map: shared.halo,
        color: 0x6a4c26,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    aim(ex)
    return ex
  }

  // Un pedestal: devuelve el grupo, el alto donde se apoya la pieza y el anillo
  // de runas de arriba (si tiene).
  function pedestal(type, shared) {
    const stand = STANDS[type]
    const r = stand.radius
    const h = stand.height
    const group = new THREE.Group()
    const stone = []
    const top = []
    const gold = []
    let ring = null
    let surface = h
    if (type === 'table') {
      stone.push(cylinder(r * 0.5, r * 0.56, 0.08, 0.04))
      stone.push(cylinder(0.26, 0.32, h - 0.18, 0.08 + (h - 0.18) / 2))
      top.push(cylinder(r, r - 0.05, 0.1, h - 0.05))
      gold.push(cylinder(r + 0.006, r + 0.006, 0.026, h - 0.05))
    } else if (type === 'case') {
      const g = stand.glass
      const t = 0.022
      stone.push(box(0.66, 0.08, 0.66, 0.04))
      stone.push(box(0.56, h - 0.14, 0.56, 0.08 + (h - 0.14) / 2))
      top.push(box(0.64, 0.06, 0.64, h - 0.03))
      gold.push(box(0.585, 0.02, 0.585, h - 0.09))
      // La caja de vidrio con su marco de bronce y un almohadon adentro.
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1]
      ]) {
        gold.push(box(t, g, t, h + g / 2).translate((sx * g) / 2, 0, (sz * g) / 2))
      }
      for (const y of [h + t / 2, h + g - t / 2]) {
        gold.push(box(g + t, t, t, y).translate(0, 0, g / 2))
        gold.push(box(g + t, t, t, y).translate(0, 0, -g / 2))
        gold.push(box(t, t, g + t, y).translate(g / 2, 0, 0))
        gold.push(box(t, t, g + t, y).translate(-g / 2, 0, 0))
      }
      const glass = new THREE.Mesh(new THREE.BoxGeometry(g, g, g), shared.glass)
      glass.position.y = h + g / 2
      glass.renderOrder = 2
      const velvet = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.32), shared.velvet)
      velvet.position.y = h + 0.035
      velvet.receiveShadow = true
      group.add(glass, velvet)
      surface = h + 0.07
    } else {
      stone.push(cylinder(r + 0.07, r + 0.09, 0.07, 0.035))
      stone.push(cylinder(r, r, h - 0.13, 0.07 + (h - 0.13) / 2))
      top.push(cylinder(r + 0.05, r + 0.05, 0.06, h - 0.03))
      gold.push(cylinder(r + 0.012, r + 0.012, 0.02, h - 0.085))
      // El estrado del probador tiene su propio anillo: late al cambiar de ropa.
      ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.11, r - 0.08, 72).rotateX(-Math.PI / 2),
        type === 'dais' ? shared.rune.clone() : shared.rune
      )
      ring.position.y = h + 0.003
      group.add(ring)
    }
    for (const [parts, material] of [
      [stone, shared.stone],
      [top, shared.top],
      [gold, shared.gold]
    ]) {
      const mesh = new THREE.Mesh(mergeGeometries(parts), material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
      for (const part of parts) part.dispose()
    }
    return { group, top: surface, ring }
  }

  // La placa va al frente del pedestal: en la columna de la mesa y de la vitrina
  // de vidrio, y en el cuerpo de los demas.
  function plaque(spec, stand) {
    const mesh = new THREE.Mesh(
      PLANE,
      new THREE.MeshStandardMaterial({
        roughness: 0.45,
        metalness: 0.3,
        emissive: 0xffffff,
        emissiveIntensity: 0.16
      })
    )
    if (spec.stand === 'case') {
      mesh.scale.set(0.42, 0.118, 1)
      mesh.position.set(0, stand.height * 0.62, 0.285)
    } else if (spec.stand === 'table') {
      mesh.scale.set(0.34, 0.096, 1)
      mesh.position.set(0, 0.46, 0.33)
    } else if (spec.stand === 'low') {
      mesh.scale.set(0.5, 0.14, 1)
      mesh.position.set(0, 0.155, stand.radius + 0.012)
    } else {
      mesh.scale.set(0.46, 0.13, 1)
      mesh.position.set(0, 0.23, stand.radius + 0.012)
    }
    return mesh
  }

  // Las placas se pintan en el idioma de quien mira.
  function paintPlaques() {
    const lang = L('en', 'es')
    if (paintedIn === lang) return
    paintedIn = lang
    for (const ex of exhibits) {
      const material = ex.plaque.material
      if (material.map) material.map.dispose()
      const map = plaqueTexture(pick(ex.spec.name), ex.spec.credit || 'TRIPO')
      material.map = map
      material.emissiveMap = map
      material.needsUpdate = true
    }
  }

  // Lo que la camara tiene que encuadrar de cada pieza: de y0 a y1 de alto (en
  // el mundo) y r de radio alrededor del eje del pedestal. Sin el modelo todavia
  // se estima con su tamano.
  function frameFor(ex, size) {
    const { spec, stand } = ex
    if (spec.fitting) return { y0: FLOOR, y1: 2.15, r: 0.86 }
    const base = FLOOR + ex.spinner.position.y
    if (spec.stand === 'case') {
      return {
        y0: FLOOR + stand.height - 0.14,
        y1: FLOOR + stand.height + stand.glass + 0.05,
        r: stand.glass * 0.72
      }
    }
    let tall = spec.wide ? spec.size * 0.5 : spec.size
    let wide = spec.wide ? spec.size / 2 : spec.size * 0.3
    // Lo ancho (la maqueta) gira sobre su base redonda; lo alto barre las
    // esquinas de su caja al girar, aunque casi nunca de lleno.
    if (size) {
      tall = size.y
      wide = spec.wide ? Math.max(size.x, size.z) / 2 : Math.hypot(size.x, size.z) * 0.42
    }
    const r = Math.max(stand.radius + 0.06, wide)
    if (spec.stand === 'table') return { y0: base - 0.4, y1: base + tall + 0.08, r }
    return { y0: FLOOR, y1: base + tall + 0.08, r }
  }

  // El foco de la pieza, su haz, el halo de la pared y el cilindro que se toca
  // para elegirla, segun lo que hay que encuadrar.
  function aim(ex) {
    const f = ex.frame
    const mid = (f.y0 + f.y1) / 2
    const lamp = ex.lamp
    lamp.position.copy(ex.at).addScaledVector(ex.inward, 2.6).setY(LAMPS)
    lamp.target.position.set(ex.at.x, mid, ex.at.z)
    lamp.target.updateMatrixWorld()
    const reach = lamp.position.distanceTo(lamp.target.position)
    const spread = Math.max(f.r * 1.2, (f.y1 - f.y0) * 0.6)
    lamp.angle = Math.min(0.7, Math.atan(spread / reach) + 0.04)
    const down = lamp.target.position.clone().sub(lamp.position).normalize()
    const length = (lamp.position.y - FLOOR) / -down.y
    const width = length * Math.tan(lamp.angle) * 0.9
    ex.beam.scale.set(width, length, width)
    ex.beam.position.copy(lamp.position).addScaledVector(down, length / 2)
    ex.beam.quaternion.setFromUnitVectors(UP, down.negate())
    ex.halo.position
      .copy(ex.at)
      .addScaledVector(ex.inward, -(BEHIND - 0.3))
      .setY(mid)
    ex.halo.lookAt(center.x, mid, center.z)
    ex.halo.scale.set(Math.max(2.4, f.r * 4.2), Math.max(2.6, (f.y1 - f.y0) * 1.5), 1)
    ex.proxy.scale.set(f.r + 0.15, f.y1 - f.y0 + 0.2, f.r + 0.15)
    ex.proxy.position.y = mid - FLOOR
  }

  // Un foco mas, con sombra, que va hacia la pieza que se mira.
  function followSpot() {
    const light = new THREE.SpotLight(0xfff0dc, 0, 26, 0.4, 0.5, 2)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.bias = -0.0005
    light.shadow.normalBias = 0.03
    light.shadow.camera.near = 2
    light.shadow.camera.far = 18
    return light
  }

  // Polvo que flota en la luz de la pieza que se mira: una columna detras de la
  // pieza, para que ninguna mota pase pegada a la camara.
  function motes(shared) {
    const count = 220
    const positions = new Float32Array(count * 3)
    const random = seeded(11)
    for (let i = 0; i < count; i++) {
      const a = random() * TAU
      const r = Math.sqrt(random()) * 1.1
      positions[i * 3] = Math.cos(a) * r
      positions[i * 3 + 1] = random() * 5.5
      positions[i * 3 + 2] = Math.sin(a) * r
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        map: shared.mote,
        color: 0xffe2b0,
        size: 0.035,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    points.frustumCulled = false
    points.position.y = FLOOR
    return points
  }

  // --- Los modelos ---------------------------------------------------------

  function load(ex) {
    const { spec } = ex
    if (spec.fitting) return
    ex.loading = true
    const job =
      spec.rig && ctx.loadRig
        ? ctx.loadRig(spec.file)
        : ctx.loadGlb(spec.file).then((object) => ({ object, clips: [] }))
    job
      .then(({ object, clips }) => {
        ex.loading = false
        const { holder, size } = fitModel(object, spec)
        if (ex.placeholder) ex.spinner.remove(ex.placeholder)
        ex.placeholder = null
        ex.spinner.add(holder)
        ex.model = holder
        ex.grow = 0
        holder.scale.setScalar(0.001)
        if (spec.rig) animate(ex, object, clips)
        ex.frame = frameFor(ex, size)
        aim(ex)
        if (shown && ex.index === focus && !orbiting) {
          frameExhibit(focus, glide ? Math.max(0.6, glide.seconds - glide.time) : 0.8)
        }
        if (shown && ex.index === focus) paintCard()
      })
      .catch((error) => {
        ex.loading = false
        ex.failed = true
        console.warn('vitrina: sin el modelo', spec.file, error)
        if (ctx.say) ctx.say(L('Could not load ', 'No pude cargar ') + pick(spec.name))
        if (shown && ex.index === focus) paintCard()
      })
  }

  // Lleva el GLB al tamano de su pieza, parado en y = 0 y centrado en el eje
  // del pedestal. Es una copia del GLB en cache: comparte geometria y
  // materiales, asi que no se tocan ni se liberan.
  function fitModel(object, spec) {
    object.rotation.y = spec.yaw || 0
    object.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(object)
    const dims = box.getSize(new THREE.Vector3())
    const grow = spec.wide ? spec.size / Math.max(dims.x, dims.z) : spec.size / dims.y
    object.scale.multiplyScalar(grow)
    object.updateMatrixWorld(true)
    const placed = new THREE.Box3().setFromObject(object)
    const mid = placed.getCenter(new THREE.Vector3())
    object.position.x -= mid.x
    object.position.z -= mid.z
    object.position.y -= placed.min.y
    object.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      // El cuadro de un SkinnedMesh es el de la pose de reposo: al correr los
      // brazos salen de ahi y el recorte lo haria desaparecer.
      if (child.isSkinnedMesh) child.frustumCulled = false
    })
    const holder = new THREE.Group()
    holder.add(object)
    return { holder, size: placed.getSize(new THREE.Vector3()) }
  }

  // El heroe animado pasa por sus clips con un fundido corto.
  function animate(ex, object, clips) {
    const mixer = new THREE.AnimationMixer(object)
    const cycle = []
    for (const [name, seconds] of ex.spec.clips || CLIPS) {
      const clip = THREE.AnimationClip.findByName(clips, name)
      if (clip) cycle.push({ name, seconds, action: mixer.clipAction(clip) })
    }
    if (!cycle.length) return
    ex.mixer = mixer
    ex.cycle = cycle
    ex.step = 0
    ex.clipTime = 0
    cycle[0].action.play()
    ex.clip = cycle[0].name
  }

  function playClips(ex, dt) {
    if (!ex.mixer) return
    ex.mixer.update(dt)
    ex.clipTime += dt
    const now = ex.cycle[ex.step]
    if (ex.cycle.length < 2 || ex.clipTime < now.seconds) return
    ex.step = (ex.step + 1) % ex.cycle.length
    ex.clipTime = 0
    const next = ex.cycle[ex.step]
    next.action.reset().fadeIn(0.45).play()
    now.action.fadeOut(0.45)
    ex.clip = next.name
    if (shown && ex.index === focus) paintTip()
  }

  // --- La camara -----------------------------------------------------------

  // Las poses van en coordenadas del arco: phi, rho e y dicen donde esta el
  // punto que se mira (angulo y distancia al centro de la sala, y alto), y off
  // es la camara relativa a ese punto en el marco del arco (x a la derecha, y
  // arriba, z hacia el centro de la sala). Asi un deslizamiento sigue la curva
  // de los pedestales y no corta por el medio.
  function basis(phi) {
    return {
      right: new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi)),
      inward: new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi))
    }
  }

  function arcPose(target, position) {
    const rel = target.clone().sub(center)
    const phi = Math.atan2(rel.x, -rel.z)
    const { right, inward } = basis(phi)
    const off = position.clone().sub(target)
    return {
      phi,
      rho: Math.hypot(rel.x, rel.z),
      y: target.y,
      off: new THREE.Vector3(off.dot(right), off.y, off.dot(inward))
    }
  }

  function placeCamera(pose) {
    const { right, inward } = basis(pose.phi)
    controls.target.set(
      center.x + Math.sin(pose.phi) * pose.rho,
      pose.y,
      center.z - Math.cos(pose.phi) * pose.rho
    )
    camera.position
      .copy(controls.target)
      .addScaledVector(right, pose.off.x)
      .addScaledVector(inward, pose.off.z)
    camera.position.y += pose.off.y
  }

  function bagOpen() {
    const bag = document.getElementById('bag')
    return Boolean(bag && !bag.hidden)
  }

  // Lo que queda libre de la pantalla para la pieza. En una pantalla ancha la
  // ficha va abajo a la izquierda, debajo del texto del recorrido, y la pieza
  // ocupa la parte derecha a todo lo alto (menos la columna del equipo y la
  // mochila, si esta abierta). En una angosta, como el celular, la pieza va
  // entre el texto de arriba y la ficha de abajo, o la mochila.
  function safeArea(w, h) {
    const safe = { left: 0, right: w, top: 0, bottom: h }
    const hud = document.getElementById('hud')
    const showing = hud && !hud.hidden
    const bag = bagOpen() ? document.getElementById('bag').getBoundingClientRect() : null
    const placed = card && card.box.isConnected ? card.box.getBoundingClientRect() : null
    if (side()) {
      let left = placed ? placed.right : 0
      if (showing && hud.firstElementChild) {
        left = Math.max(left, hud.firstElementChild.getBoundingClientRect().right)
      }
      Object.assign(safe, { left: left + 24, top: 24, right: w - 96, bottom: h - 24 })
      if (bag && bag.left > w * 0.4) safe.right = Math.min(safe.right, bag.left - 16)
    } else {
      if (showing) safe.top = hud.getBoundingClientRect().bottom + 8
      if (placed) safe.bottom = placed.top - 8
      if (bag && bag.left > w * 0.4) safe.right = bag.left - 8
      else if (bag && bag.top > h * 0.25) safe.bottom = Math.min(safe.bottom, bag.top - 8)
    }
    // Nunca menos de un cuarto de alto ni de un quinto de ancho.
    if (safe.bottom - safe.top < h * 0.25) {
      const mid = (safe.top + safe.bottom) / 2
      safe.top = mid - h * 0.125
      safe.bottom = mid + h * 0.125
    }
    if (safe.right - safe.left < w * 0.2) {
      const mid = (safe.left + safe.right) / 2
      safe.left = mid - w * 0.1
      safe.right = mid + w * 0.1
    }
    return safe
  }

  // Donde se para la camara para ver la pieza entera en el lugar libre: la
  // distancia sale del angulo de la lente y la mira se corre para que la pieza
  // quede en el centro de ese lugar, no en el de la pantalla.
  function framing(ex) {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    const safe = safeArea(w, h)
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const tanH = tanV * camera.aspect
    const f = ex.frame
    const half = (f.y1 - f.y0) / 2
    const elevation = THREE.MathUtils.degToRad(ex.spec.view)
    const tall = half * Math.cos(elevation) + f.r * Math.sin(elevation)
    const fill = 0.84
    const across = (safe.right - safe.left) / w
    const along = (safe.bottom - safe.top) / h
    const distance =
      Math.max(tall / (tanV * along * fill), f.r / (tanH * across * fill), 1.5) + f.r * 0.3
    const middle = new THREE.Vector3(ex.at.x, (f.y0 + f.y1) / 2, ex.at.z)
    const position = middle
      .clone()
      .addScaledVector(ex.inward, distance * Math.cos(elevation))
      .setY(middle.y + distance * Math.sin(elevation))
    position.y = Math.max(position.y, FLOOR + 0.5)
    const view = middle.clone().sub(position).normalize()
    const right = new THREE.Vector3().crossVectors(view, UP).normalize()
    const up = new THREE.Vector3().crossVectors(right, view)
    const cx = (safe.left + safe.right) / w - 1
    const cy = 1 - (safe.top + safe.bottom) / h
    const target = middle
      .clone()
      .addScaledVector(right, -cx * distance * tanH)
      .addScaledVector(up, -cy * distance * tanV)
    return { target, position }
  }

  function frameExhibit(index, seconds, from) {
    const ex = exhibits[index]
    if (!ex) return
    const goal = framing(ex)
    const to = arcPose(goal.target, goal.position)
    const start = from || arcPose(controls.target, camera.position)
    start.phi = to.phi + wrap(start.phi - to.phi)
    glide = { from: start, to, time: 0, seconds: Math.max(0.05, seconds), index }
    loosen()
  }

  function stepGlide(dt) {
    if (!glide) return
    glide.time += dt
    const k = ease(Math.min(1, glide.time / glide.seconds))
    const { from, to } = glide
    placeCamera({
      phi: lerp(from.phi, to.phi, k),
      rho: lerp(from.rho, to.rho, k),
      y: lerp(from.y, to.y, k),
      off: from.off.clone().lerp(to.off, k)
    })
    if (glide.time < glide.seconds) return
    glide = null
    settle()
  }

  // Mientras se desliza, los controles no frenan nada ni se mueven solos.
  function loosen() {
    controls.enabled = false
    controls.minDistance = 0
    controls.maxDistance = Infinity
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI
    controls.minAzimuthAngle = -Infinity
    controls.maxAzimuthAngle = Infinity
    still()
  }

  // OrbitControls guarda el envion del ultimo arrastre: se descarta, asi la
  // camara no sigue girando sola despues de un deslizamiento.
  function still() {
    if (controls._sphericalDelta) controls._sphericalDelta.set(0, 0, 0)
    if (controls._panOffset) controls._panOffset.set(0, 0, 0)
    if ('_scale' in controls) controls._scale = 1
  }

  // Ya frente a la pieza: se puede girar un poco alrededor y acercarse, sin
  // salir de la sala ni meterse bajo el piso.
  function settle() {
    const offset = camera.position.clone().sub(controls.target)
    const distance = offset.length()
    const theta = Math.atan2(offset.x, offset.z)
    const polar = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1))
    controls.minDistance = distance * 0.5
    controls.maxDistance = distance * 1.35
    controls.minAzimuthAngle = theta - 1.1
    controls.maxAzimuthAngle = theta + 1.1
    // Los limites siempre contienen la pose de ahora: si no, la camara saltaria.
    controls.minPolarAngle = Math.min(polar, Math.max(0.25, polar - 0.55))
    controls.maxPolarAngle = Math.max(polar, Math.min(Math.PI / 2 + 0.03, polar + 0.3))
    controls.enabled = true
    // La pieza se muestra de frente un rato antes de empezar a girar.
    spinRest = Math.max(spinRest, 3.5)
  }

  function goTo(index) {
    const count = exhibits.length
    if (!count) return
    const next = ((index % count) + count) % count
    const turn = Math.abs(exhibits[next].phi - exhibits[focus].phi)
    focus = next
    frameExhibit(next, Math.min(2.4, 0.95 + turn * 0.55))
    paintCard()
  }

  const step = (direction) => goTo(focus + direction)

  // --- Cada cuadro ---------------------------------------------------------

  function update(time, dt) {
    if (!shown || !hall) return
    watchScene()
    watchLayout(dt)
    watchGear()
    stepGlide(dt)
    spinRest = Math.max(0, spinRest - dt)
    pulse = Math.max(0, pulse - dt * 0.9)
    for (const ex of exhibits) stepExhibit(ex, time, dt)
    stepFollow(dt)
    stepDust(time, dt)
    stepIdle(dt)
  }

  function stepExhibit(ex, time, dt) {
    const on = ex.index === focus ? 1 : 0
    ex.weight += (on - ex.weight) * Math.min(1, dt * 3)
    const w = ex.weight
    ex.lamp.intensity = LAMP * (0.35 + 0.65 * w)
    ex.beam.material.uniforms.strength.value = 0.1 + 0.18 * w
    ex.halo.material.opacity = 0.28 + 0.72 * w
    ex.pool.material.opacity = 0.75 * w
    if (ex.spec.fitting) {
      // El stickman se balancea para que se vea lo que lleva puesto.
      const sway = on && !orbiting ? Math.sin(time * 0.55) * 0.35 : 0
      hero.root.rotation.y += (sway - hero.root.rotation.y) * Math.min(1, dt * 2)
      if (ex.ring) {
        ex.ring.scale.setScalar(1 + pulse * 0.1)
        ex.ring.material.opacity = 0.75 + 0.25 * Math.max(pulse, Math.sin(time * 2) * 0.5 + 0.5)
      }
      return
    }
    // La pieza que se mira gira despacio; las otras vuelven a mirar al centro.
    const spin = ex.spinner.rotation
    if (on && !orbiting && !glide && spinRest <= 0) spin.y += dt * 0.32
    else if (!on) spin.y += (Math.round(spin.y / TAU) * TAU - spin.y) * Math.min(1, dt * 1.5)
    if (ex.placeholder) {
      ex.placeholder.rotation.y += dt * 0.9
      ex.placeholder.rotation.x = Math.sin(time * 0.7) * 0.4
    }
    if (ex.model && ex.grow < 1) {
      ex.grow = Math.min(1, ex.grow + dt / 0.7)
      ex.model.scale.setScalar(Math.max(0.001, pop(ex.grow)))
    }
    playClips(ex, dt)
  }

  // El foco con sombra va de pieza en pieza detras de la camara.
  function stepFollow(dt) {
    const ex = exhibits[focus]
    if (!ex) return
    const k = Math.min(1, dt * 3)
    follow.position.lerp(ex.lamp.position, k)
    follow.target.position.lerp(ex.lamp.target.position, k)
    follow.target.updateMatrixWorld()
    follow.angle += (ex.lamp.angle * 0.95 - follow.angle) * k
    follow.intensity += (FOLLOW - follow.intensity) * k
    dust.position.x += (ex.at.x - ex.inward.x * 0.8 - dust.position.x) * k
    dust.position.z += (ex.at.z - ex.inward.z * 0.8 - dust.position.z) * k
  }

  function stepDust(time, dt) {
    const p = dust.geometry.attributes.position
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + dt * (0.04 + (i % 5) * 0.012)
      if (y > 5.5) y -= 5.5
      p.setY(i, y)
      p.setX(i, p.getX(i) + Math.sin(time * 0.3 + i) * dt * 0.03)
    }
    p.needsUpdate = true
  }

  // Sin nadie que toque nada, la vitrina pasa sola a la pieza siguiente.
  function stepIdle(dt) {
    idle += dt
    if (orbiting || glide || bagShown) return
    if (idle < (autoplay ? DWELL : IDLE)) return
    autoplay = true
    idle = 0
    step(1)
  }

  function touched() {
    idle = 0
    autoplay = false
  }

  // Lo que se agrega a la escena mientras se ve la sala (un fondo que termino
  // de bajar, por ejemplo) tambien se esconde, y vuelve al salir.
  function watchScene() {
    if (scene.children.length === childrenSeen) return
    childrenSeen = scene.children.length
    hideOthers()
  }

  function hideOthers() {
    for (const child of scene.children) {
      if (child === hall || child === hero.root || !child.visible) continue
      child.visible = false
      saved.hidden.push(child)
    }
  }

  // Si cambia el tamano de la ventana, se abre la mochila o cambia la ficha, la
  // pieza se vuelve a encuadrar.
  function layoutKey() {
    const parts = [canvas.clientWidth, canvas.clientHeight, camera.fov.toFixed(2)]
    for (const id of ['hud', 'bag']) {
      const element = document.getElementById(id)
      if (!element || element.hidden) parts.push('-')
      else {
        const rect = element.getBoundingClientRect()
        parts.push([rect.left, rect.top, rect.right, rect.bottom].map(Math.round).join(','))
      }
    }
    if (card) parts.push(Math.round(card.box.getBoundingClientRect().top))
    return parts.join('|')
  }

  function watchLayout(dt) {
    layoutClock -= dt
    if (layoutClock > 0) return
    layoutClock = 0.25
    watchBag()
    placeCard()
    const key = layoutKey()
    if (key === layoutSeen) return
    layoutSeen = key
    if (orbiting) return
    const index = glide ? glide.index : focus
    frameExhibit(index, glide ? Math.max(0.5, glide.seconds - glide.time) : 0.6)
  }

  // Con la mochila abierta la ficha se achica en el celular (body.runa-vitrina-bag)
  // y su boton dice que la cierra.
  function watchBag() {
    const open = bagOpen()
    if (open === bagShown) return
    bagShown = open
    document.body.classList.toggle('runa-vitrina-bag', open)
    paintTip()
  }

  // Lo que lleva puesto el stickman. Si cambia (H o la mochila), la camara va
  // al probador y su anillo late.
  function gearKey() {
    const sockets = [hero.headSocket, hero.hips]
    if (hero.arms) {
      for (const arm of Object.values(hero.arms)) sockets.push(arm.socket)
    }
    for (const foot of hero.feet || []) sockets.push(foot)
    return sockets.map((socket) => (socket ? socket.children.length : '-')).join(',')
  }

  function watchGear() {
    const key = gearKey()
    if (key === gearSeen) return
    gearSeen = key
    pulse = 1
    touched()
    const fitting = exhibits.length - 1
    if (focus !== fitting) goTo(fitting)
  }

  // --- La ficha ------------------------------------------------------------

  function makeCard() {
    const box = document.createElement('section')
    box.id = 'vitrina-card'
    const nav = (kind, glyph) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'nav ' + kind
      b.textContent = glyph
      b.addEventListener('click', () => {
        b.blur()
        touched()
        step(kind === 'next' ? 1 : -1)
      })
      return b
    }
    const prev = nav('prev', '◀')
    const next = nav('next', '▶')
    const text = document.createElement('div')
    const head = document.createElement('div')
    head.className = 'head'
    const count = document.createElement('span')
    count.className = 'count'
    const name = document.createElement('strong')
    name.className = 'name'
    const dots = document.createElement('div')
    dots.className = 'dots'
    head.append(count, name, dots)
    const note = document.createElement('div')
    note.className = 'note'
    const tip = document.createElement('div')
    tip.className = 'tip'
    text.append(head, note, tip)
    box.append(prev, text, next)
    return { box, prev, next, count, name, note, tip, dots }
  }

  function paintCard() {
    if (!card) return
    const ex = exhibits[focus]
    if (!ex) return
    card.box.setAttribute('aria-label', L('Showcase', 'Vitrina'))
    card.prev.setAttribute('aria-label', L('Previous piece', 'Pieza anterior'))
    card.next.setAttribute('aria-label', L('Next piece', 'Pieza siguiente'))
    card.count.textContent = `${focus + 1} / ${exhibits.length}`
    card.name.textContent = pick(ex.spec.name)
    card.note.textContent = ex.failed
      ? L('This model could not be loaded.', 'No pude cargar este modelo.')
      : pick(ex.spec.note)
    if (card.dots.children.length !== exhibits.length) {
      card.dots.replaceChildren(
        ...exhibits.map((item) => {
          const b = document.createElement('button')
          b.type = 'button'
          b.addEventListener('click', () => {
            b.blur()
            touched()
            goTo(item.index)
          })
          return b
        })
      )
    }
    ;[...card.dots.children].forEach((b, i) => {
      b.setAttribute('aria-label', pick(exhibits[i].spec.name))
      b.setAttribute('aria-current', String(i === focus))
    })
    paintTip()
  }

  function clipName(clip) {
    const doing = {
      Idle: 'quieto',
      Walk: 'camina',
      Run: 'corre',
      Roar: 'ruge',
      Attack_Slam: 'golpea'
    }[clip]
    return L(clip, doing ? `${doing} (${clip})` : clip)
  }

  // La linea de abajo: el clip del heroe animado, como se usa la vitrina y los
  // botones del probador.
  function paintTip() {
    if (!card) return
    const ex = exhibits[focus]
    const parts = []
    if (ex.loading) parts.push(text(L('loading the model...', 'cargando el modelo...')))
    if (ex.clip) {
      // El clip por su nombre en el GLB; en castellano, con lo que hace. Todos
      // ocupan lo mismo: si la ficha cambiara de alto, la pieza se volveria a
      // encuadrar con cada clip.
      const now = document.createElement('span')
      const b = document.createElement('b')
      const names = ex.cycle.map(({ name }) => clipName(name))
      b.textContent = clipName(ex.clip)
      b.style.display = 'inline-block'
      b.style.minWidth = Math.max(...names.map((name) => name.length)) + 'ch'
      now.append(L('Now: ', 'Ahora: '), b)
      parts.push(now)
    }
    for (const act of ex.spec.acts || []) parts.push(action(act))
    parts.push(
      text(
        coarse
          ? L(
              'Drag: turn. Pinch: zoom. Tap: pick.',
              'Arrastra: girar. Pellizca: zoom. Toca: elegir.'
            )
          : L(
              '← → browse. Drag to turn, wheel to zoom, click a model.',
              '← → recorrer. Arrastra para girar, rueda para acercar, clic en un modelo.'
            )
      )
    )
    card.tip.replaceChildren(...parts)
  }

  // Los botones del probador hacen lo mismo que I y H en el recorrido: la
  // mochila y el yelmo son de la pagina.
  function action(act) {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.act = act
    if (act === 'bag' && bagShown) b.textContent = L('Close the bag (I)', 'Cerrar la mochila (I)')
    else if (act === 'bag') b.textContent = L('Open the bag (I)', 'Abrir la mochila (I)')
    else b.textContent = L('Try on the helmet (H)', 'Probar el yelmo (H)')
    b.addEventListener('click', () => {
      b.blur()
      touched()
      const extra = document.querySelectorAll('#places [data-extra]')
      if (act === 'bag' && extra[1]) extra[1].click()
      else pressKey(act === 'bag' ? 'i' : 'h')
    })
    return b
  }

  // Una tecla para la pagina, como si se apretara: la toma su escucha del
  // teclado, igual que I y H en el recorrido.
  function pressKey(key) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key }))
  }

  // La ficha va abajo; si el sitio publicado muestra sus enlaces ahi, arriba de
  // ellos. El aviso de la pagina (y la mochila en el celular) quedan arriba de
  // la ficha.
  function placeCard() {
    if (!card || !card.box.isConnected) return
    let bottom = 16
    const links = document.getElementById('links')
    if (links && !links.hidden) {
      const rect = links.getBoundingClientRect()
      if (rect.height) bottom = Math.max(bottom, Math.round(window.innerHeight - rect.top + 10))
    }
    const value = bottom + 'px'
    if (card.box.style.bottom !== value) card.box.style.bottom = value
    const lift = Math.round(bottom + card.box.offsetHeight + 12) + 'px'
    const root = document.documentElement.style
    if (root.getPropertyValue('--vitrina-lift') !== lift) root.setProperty('--vitrina-lift', lift)
  }

  // La ficha, su estilo y una sombra entre el 3D y el texto del recorrido, para
  // que el texto se lea aunque detras haya una pieza iluminada.
  function mount() {
    if (!style) {
      style = document.createElement('style')
      style.id = 'vitrina-style'
      style.textContent = CSS
      shade = document.createElement('div')
      shade.id = 'vitrina-shade'
    }
    if (!card) card = makeCard()
    document.head.append(style)
    canvas.after(shade)
    document.body.append(card.box)
    document.body.classList.add('runa-vitrina')
  }

  function unmount() {
    if (card) card.box.remove()
    if (style) style.remove()
    if (shade) shade.remove()
    document.body.classList.remove('runa-vitrina', 'runa-vitrina-bag')
    document.documentElement.style.removeProperty('--vitrina-lift')
  }

  // --- Teclado, mouse y dedos ----------------------------------------------

  function onKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    touched()
    if (event.repeat) return
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (key === 'ArrowRight' || key === 'd') step(1)
    else if (key === 'ArrowLeft' || key === 'a') step(-1)
    else if (key === 'Home') goTo(0)
    else if (key === 'End') goTo(exhibits.length - 1)
  }

  function onDown(event) {
    touched()
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() }
  }

  // Un toque corto, sin arrastrar, sobre una pieza la elige.
  function onUp(event) {
    const was = press
    press = null
    if (!was || was.id !== event.pointerId) return
    if (Math.hypot(event.clientX - was.x, event.clientY - was.y) > 8) return
    if (performance.now() - was.at > 500) return
    const hit = pickAt(event.clientX, event.clientY)
    if (hit !== null && hit !== focus) goTo(hit)
  }

  function onHover(event) {
    if (event.pointerType !== 'mouse' || press) return
    const now = performance.now()
    if (now < hoverClock) return
    hoverClock = now + 60
    const hit = pickAt(event.clientX, event.clientY)
    canvas.style.cursor = hit !== null && hit !== focus ? 'pointer' : ''
  }

  function pickAt(x, y) {
    const rect = canvas.getBoundingClientRect()
    pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(
      exhibits.map((ex) => ex.proxy),
      false
    )
    return hits.length ? hits[0].object.userData.index : null
  }

  function onOrbitStart() {
    orbiting = true
    touched()
  }

  function onOrbitEnd() {
    orbiting = false
    spinRest = 2.5
  }

  function listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener'
    window[method]('keydown', onKey)
    canvas[method]('pointerdown', onDown)
    canvas[method]('pointerup', onUp)
    canvas[method]('pointermove', onHover)
    controls[method]('start', onOrbitStart)
    controls[method]('end', onOrbitEnd)
  }

  // --- Entrar y salir ------------------------------------------------------

  function remember() {
    const limits = {}
    for (const name of LIMITS) limits[name] = controls[name]
    return {
      background: scene.background,
      fog: scene.fog,
      environmentIntensity: scene.environmentIntensity,
      position: camera.position.clone(),
      target: controls.target.clone(),
      limits,
      yaw: hero.root.rotation.y,
      cursor: canvas.style.cursor,
      hidden: []
    }
  }

  function restore(state) {
    scene.background = state.background
    scene.fog = state.fog
    scene.environmentIntensity = state.environmentIntensity
    for (const object of state.hidden) object.visible = true
    for (const name of LIMITS) controls[name] = state.limits[name]
    camera.position.copy(state.position)
    controls.target.copy(state.target)
    still()
    hero.root.rotation.y = state.yaw
    canvas.style.cursor = state.cursor
  }

  function enter() {
    if (shown) return
    if (!hall) build()
    paintPlaques()
    shown = true
    saved = remember()
    hideOthers()
    scene.background = backdrop
    scene.fog = fog
    scene.environmentIntensity = 0.22
    controls.autoRotate = false
    controls.enablePan = false
    hero.root.rotation.y = 0
    scene.add(hall)
    childrenSeen = scene.children.length
    mount()
    listen(true)
    gearSeen = gearKey()
    orbiting = false
    spinRest = 0
    bagShown = !bagOpen()
    watchBag()
    touched()
    placeCard()
    paintCard()
    // El foco con sombra y el polvo arrancan en la pieza, no viajan desde lejos.
    const ex = exhibits[focus]
    follow.position.copy(ex.lamp.position)
    follow.target.position.copy(ex.lamp.target.position)
    follow.target.updateMatrixWorld()
    follow.angle = ex.lamp.angle
    follow.intensity = 0
    dust.position.set(ex.at.x - ex.inward.x * 0.8, FLOOR, ex.at.z - ex.inward.z * 0.8)
    // La primera toma: desde atras y mas alto, hacia la pieza.
    const goal = framing(ex)
    const to = arcPose(goal.target, goal.position)
    const from = { ...to, off: to.off.clone().add(new THREE.Vector3(0, 2.4, 5.5)) }
    placeCamera(from)
    frameExhibit(focus, 2.2, from)
    layoutSeen = layoutKey()
    layoutClock = 0.25
  }

  function leave() {
    if (!shown) return
    shown = false
    glide = null
    press = null
    orbiting = false
    listen(false)
    scene.remove(hall)
    unmount()
    restore(saved)
    saved = null
  }

  function show(on) {
    if (on) enter()
    else leave()
  }

  // --- Para probar la vitrina en un navegador real ----------------------------

  function state() {
    const ex = exhibits[focus]
    const animated = exhibits.find((item) => item.mixer)
    return {
      shown,
      ready: exhibits.length > 0 && exhibits.every((item) => !item.loading),
      index: focus,
      count: exhibits.length,
      key: ex ? ex.spec.key : null,
      name: ex ? ex.spec.name[0] : null,
      keys: exhibits.map((item) => item.spec.key),
      gliding: Boolean(glide),
      clip: animated ? animated.clip : null,
      failed: exhibits.filter((item) => item.failed).map((item) => item.spec.file)
    }
  }

  function screenPoint(index) {
    const ex = exhibits[index]
    if (!ex) return null
    const f = ex.frame
    const p = new THREE.Vector3(ex.at.x, (f.y0 + f.y1) / 2, ex.at.z).project(camera)
    if (p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height
    }
  }

  function snapshot() {
    let lights = 0
    scene.traverseVisible((object) => {
      if (object.isLight) lights++
    })
    const background = scene.background
    return {
      shown,
      children: scene.children.length,
      visible: scene.children.filter((child) => child.visible).length,
      halls: scene.children.filter((child) => child === hall).length,
      lights,
      background:
        background && background.isColor
          ? '#' + background.getHexString()
          : background
            ? 'texture'
            : null,
      fog: scene.fog ? ['#' + scene.fog.color.getHexString(), scene.fog.near, scene.fog.far] : null,
      environment: scene.environmentIntensity,
      limits: Object.fromEntries(LIMITS.map((name) => [name, String(controls[name])])),
      cards: document.querySelectorAll('#vitrina-card').length,
      styles: document.querySelectorAll('#vitrina-style').length,
      lift: document.documentElement.style.getPropertyValue('--vitrina-lift'),
      marked: document.body.classList.contains('runa-vitrina'),
      yaw: hero.root.rotation.y,
      programs: renderer.info.programs ? renderer.info.programs.length : null,
      room: { x: center.x, z: center.z, radius, span: exhibits.length ? -exhibits[0].phi : 0 }
    }
  }

  window.runaVitrina = Object.assign(state, { go: goTo, point: screenPoint, snapshot })

  return { show, update }
}
