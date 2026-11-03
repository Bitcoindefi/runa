// Los monstruos hablan en la pagina 2.5D (tripo-heroe.html): un globo sobre el
// que habla, en el idioma elegido, y su voz grabada con ElevenLabs si esta.
//
//  - Que dice cada uno sale de voces.js (tripo-voces.mjs): la pelea del campo
//    (pradera.js Effects) y la del Coloso (fightFrame) llaman a say().
//  - El audio es opcional: assets/voces/manifest.json y los mp3 que arma
//    scripts/generar-voces.mjs. Sin manifiesto (o sin un archivo, o con el
//    texto cambiado) va solo el globo.
//  - Los mp3 de un monstruo se bajan cuando empieza su pelea, no antes.
//  - Suena por el mismo contexto de audio de los golpes (sonido.js), ya
//    destrabado por el primer gesto, respeta Opciones > Sonido y baja un poco
//    los golpes mientras habla.
//  - El globo es HTML: se lee bien en el celular, sigue al monstruo en la
//    pantalla y se apaga solo.
//  - Va como el cuadro de dialogo de un RPG clasico: el retrato a la
//    izquierda, el nombre y la frase. Los retratos (assets/retratos/<id>.webp,
//    hechos con Rosebud) se bajan cuando empieza la pelea de ese monstruo; si
//    falta uno, el globo va sin retrato.

import {
  createPicker,
  audioFor,
  validateManifest,
  readTime,
  linesOf,
  eventsOf,
  MONSTERS
} from './voces.js'

// Cuanto se espera un mp3 que todavia no llego: despues ya no va con el globo.
const LATE = 0.9
const LATE_URGENT = 1.6
// Cuanto bajan los golpes mientras habla (sobre 1).
const DUCK = 0.45
// Cuantos mp3 se bajan a la vez al empezar una pelea.
const PRELOAD = 3
// Lo minimo desde arriba de la ventana, en px: debajo de la barra del monstruo.
const TOP = 64

// El cuadro: panel oscuro con borde dorado doble, el retrato a la izquierda
// (con un brillo del color del monstruo) y a la derecha el nombre y la frase.
const STYLE = `
.voz-globo {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 26;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  box-sizing: border-box;
  max-width: min(88vw, 340px);
  padding: 6px 11px 7px 6px;
  border: 2px solid #d9b25a;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(30, 22, 40, 0.95), rgba(10, 8, 16, 0.95));
  color: #fff6e0;
  font: 600 15px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
  text-align: left;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.9),
    inset 0 0 0 2px rgba(255, 214, 122, 0.3),
    0 4px 16px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  opacity: 0;
  transform: scale(0.85);
  transform-origin: var(--cola, 50%) 100%;
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.voz-globo.on { opacity: 1; transform: scale(1); }
.voz-retrato {
  flex: none;
  display: block;
  width: 52px;
  height: 52px;
  border: 2px solid #d9b25a;
  border-radius: 3px;
  background: #000;
  object-fit: cover;
  box-shadow: 0 0 6px var(--voz, #ffd27a);
}
.voz-retrato[hidden] { display: none; }
.voz-texto { min-width: 0; padding-top: 1px; }
.voz-globo b {
  display: block;
  margin-bottom: 2px;
  color: #ffd27a;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-shadow: 0 1px 0 #000;
}
.voz-globo::after {
  content: '';
  position: absolute;
  left: var(--cola, 50%);
  bottom: -9px;
  margin-left: -8px;
  border: 8px solid transparent;
  border-bottom: 0;
  border-top-color: #d9b25a;
}
@media (max-width: 520px) {
  .voz-globo { font-size: 14px; gap: 8px; }
  .voz-retrato { width: 46px; height: 46px; }
}
`

/**
 * Las voces de la pagina. Recibe:
 *  - win: la ventana;
 *  - base: donde estan los audios (assets/voces/, relativo a la pagina);
 *  - faces: donde estan los retratos (assets/retratos/, relativo a la pagina);
 *  - lang(): 'en' o 'es';
 *  - sound(): si el sonido esta prendido (Opciones);
 *  - audio(): el AudioContext de los golpes, o null si todavia no hay;
 *  - duck(level): baja los golpes (1 los vuelve a como estaban);
 *  - project({ x, y, z }): el punto en la ventana ({ x, y } en px) o null;
 *  - seed: la semilla de quien habla y que dice.
 * Devuelve say(monster, event, info), update(time, active), stop() y state().
 */
export function createVoices({
  win = globalThis.window,
  base = 'assets/voces/',
  faces = 'assets/retratos/',
  lang = () => 'en',
  sound = () => true,
  audio = () => null,
  duck = () => {},
  project = () => null,
  seed = Date.now()
} = {}) {
  const doc = win.document
  const picker = createPicker({ seed })
  const clock = () => win.performance.now() / 1000
  const root = new URL(base, doc.baseURI)
  const facesRoot = new URL(faces, doc.baseURI)

  // El manifiesto: se pide la primera vez que alguien habla.
  let manifest = null
  let status = 'idle'
  let asked = null
  function loadManifest() {
    if (asked) return asked
    status = 'loading'
    asked = win
      .fetch(new URL('manifest.json', root).href, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          status = 'none'
          return null
        }
        const errors = validateManifest(data)
        if (errors.length) {
          status = 'invalid'
          win.console.warn('voces: manifiesto con problemas', errors.slice(0, 5))
          return null
        }
        manifest = data
        status = 'ready'
        return data
      })
      .catch(() => {
        status = 'none'
        return null
      })
    return asked
  }

  // Los mp3 ya pedidos, decodificados (o null si fallaron).
  const buffers = new Map()
  function load(file, ctx) {
    if (buffers.has(file)) return buffers.get(file)
    const promise = win
      .fetch(new URL(file, root).href)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((data) => (data ? decode(ctx, data) : null))
      .catch(() => null)
    buffers.set(file, promise)
    return promise
  }
  function decode(ctx, data) {
    return new Promise((resolve) => {
      try {
        const done = ctx.decodeAudioData(data, resolve, () => resolve(null))
        if (done && done.catch) done.catch(() => resolve(null))
      } catch {
        resolve(null)
      }
    })
  }

  // Al empezar una pelea: los mp3 de ese monstruo en este idioma, de a pocos.
  function preload(monster) {
    const ctx = audio()
    if (!ctx || !sound()) return
    loadManifest().then(() => {
      if (!manifest) return
      const want = []
      const language = lang()
      for (const event of eventsOf(monster)) {
        linesOf(monster, event, language).forEach((text, index) => {
          const file = audioFor(manifest, { monster, event, lang: language, index, text })
          if (file && !buffers.has(file)) want.push(file)
        })
      }
      const next = () => {
        const file = want.shift()
        if (file) load(file, ctx).then(next)
      }
      for (let i = 0; i < PRELOAD; i++) next()
    })
  }

  // El globo: uno solo, el del ultimo que hablo. Adentro: el retrato, el
  // nombre y la frase.
  let bubble = null
  let face = null
  let who = null
  let words = null
  let shown = null
  function element() {
    if (bubble) return bubble
    const style = doc.createElement('style')
    style.textContent = STYLE
    doc.head.appendChild(style)
    bubble = doc.createElement('div')
    bubble.className = 'voz-globo'
    bubble.setAttribute('role', 'status')
    bubble.setAttribute('aria-live', 'polite')
    bubble.hidden = true
    face = doc.createElement('img')
    face.className = 'voz-retrato'
    face.alt = ''
    face.setAttribute('aria-hidden', 'true')
    face.decoding = 'async'
    face.width = 52
    face.height = 52
    face.hidden = true
    const column = doc.createElement('div')
    column.className = 'voz-texto'
    who = doc.createElement('b')
    words = doc.createElement('span')
    column.appendChild(who)
    column.appendChild(words)
    bubble.appendChild(face)
    bubble.appendChild(column)
    doc.body.appendChild(bubble)
    return bubble
  }

  // Los retratos: uno por monstruo, pedido la primera vez que hace falta (al
  // empezar su pelea). state: 'loading', 'ok' o 'none' (no esta o fallo).
  const portraits = new Map()
  function portrait(monster) {
    if (portraits.has(monster)) return portraits.get(monster)
    const entry = { state: 'loading', src: new URL(`${monster}.webp`, facesRoot).href }
    portraits.set(monster, entry)
    const probe = doc.createElement('img')
    probe.decoding = 'async'
    probe.onload = () => {
      entry.state = 'ok'
      if (shown && shown.monster === monster) showFace(monster)
    }
    probe.onerror = () => {
      entry.state = 'none'
      if (shown && shown.monster === monster) showFace(monster)
    }
    probe.src = entry.src
    return entry
  }
  // Muestra el retrato del que habla si ya llego; si no, el globo va sin el.
  function showFace(monster) {
    if (!face) return
    const entry = portraits.get(monster)
    const ok = !!entry && entry.state === 'ok'
    if (ok && face.getAttribute('src') !== entry.src) face.src = entry.src
    face.hidden = !ok
  }

  // Lo que suena ahora.
  let playing = null
  let token = 0
  let heard = 0
  let said = 0
  function quiet() {
    if (!playing) return
    const source = playing
    playing = null
    try {
      source.onended = null
      source.stop()
    } catch {
      // Ya habia terminado.
    }
    duck(1)
  }

  function speak(line, urgent) {
    const mine = ++token
    const begun = clock()
    if (!sound()) return
    loadManifest().then(() => {
      const ctx = audio()
      const file = audioFor(manifest, line)
      if (!file || !ctx || ctx.state !== 'running') return
      load(file, ctx).then((buffer) => {
        const late = clock() - begun > (urgent ? LATE_URGENT : LATE)
        if (!buffer || mine !== token || late || !sound()) return
        quiet()
        try {
          const source = ctx.createBufferSource()
          const gain = ctx.createGain()
          gain.gain.value = 0.95
          source.buffer = buffer
          source.connect(gain)
          gain.connect(ctx.destination)
          source.onended = () => {
            if (playing !== source) return
            playing = null
            duck(1)
          }
          source.start()
          playing = source
          heard++
          duck(DUCK)
          // El globo dura lo que dura la voz, con un respiro.
          if (shown && shown.line === line) {
            shown.until = Math.max(shown.until, clock() + buffer.duration + 0.5)
          }
        } catch {
          playing = null
        }
      })
    })
  }

  /**
   * Un monstruo dice algo de lo que paso (voces.js EVENTS). info.where() da el
   * punto sobre su cabeza ({ x, y, z }) o null. Devuelve la frase o null si le
   * toca callarse.
   */
  function say(monster, event, info = {}) {
    if (!MONSTERS[monster]) return null
    if (event === 'contact') {
      preload(monster)
      portrait(monster)
    }
    const line = picker.pick(monster, event, clock(), lang())
    if (!line) return null
    said++
    const urgent = event === 'contact' || event === 'monster_death' || event === 'defeated'
    const box = element()
    const entry = MONSTERS[monster]
    who.textContent = entry.name[lang() === 'es' ? 1 : 0]
    words.textContent = line.text
    box.style.setProperty('--voz', entry.color)
    box.hidden = false
    // Si hablo sin el aviso de la pelea (contact), el retrato se pide ahora.
    portrait(monster)
    showFace(monster)
    const now = clock()
    shown = {
      monster,
      line,
      where: typeof info.where === 'function' ? info.where : () => null,
      at: null,
      until: now + readTime(line.text),
      fading: false
    }
    // Primero sin la clase, para que la entrada se anime.
    box.classList.remove('on')
    place()
    win.requestAnimationFrame(() => {
      if (shown && shown.line === line) box.classList.add('on')
    })
    speak(line, urgent)
    return line
  }

  // Pone el globo sobre el punto del monstruo, adentro de la ventana.
  function place() {
    if (!shown || !bubble) return
    const at = shown.where() || shown.at
    if (at) shown.at = { x: at.x, y: at.y, z: at.z }
    const spot = shown.at ? project(shown.at) : null
    const vw = win.innerWidth
    const vh = win.innerHeight
    const w = bubble.offsetWidth
    const h = bubble.offsetHeight
    // Sin punto (detras de la camara o sin monstruo): arriba al medio.
    const x = spot ? spot.x : vw / 2
    const y = spot ? spot.y : vh * 0.22
    const left = Math.max(8, Math.min(vw - w - 8, x - w / 2))
    // Arriba queda TOP libre: ahi van el nombre y la barra del monstruo.
    const top = Math.max(TOP, Math.min(vh - h - 12, y - h - 14))
    const tail = Math.max(14, Math.min(w - 14, x - left))
    bubble.style.left = left.toFixed(1) + 'px'
    bubble.style.top = top.toFixed(1) + 'px'
    bubble.style.setProperty('--cola', tail.toFixed(1) + 'px')
  }

  /** Cada cuadro: el globo sigue al monstruo y se apaga a su tiempo. */
  function update(time, active = true) {
    if (playing && !sound()) quiet()
    if (!shown || !bubble) return
    if (!active) {
      stop()
      return
    }
    const now = clock()
    if (now >= shown.until + 0.3) {
      bubble.classList.remove('on')
      bubble.hidden = true
      shown = null
      return
    }
    if (now >= shown.until && !shown.fading) {
      shown.fading = true
      bubble.classList.remove('on')
    }
    place()
  }

  function stop() {
    token++
    quiet()
    shown = null
    if (bubble) {
      bubble.classList.remove('on')
      bubble.hidden = true
    }
  }

  function state() {
    return {
      manifest: status,
      said,
      heard,
      playing: !!playing,
      loaded: buffers.size,
      faces: Object.fromEntries([...portraits].map(([monster, entry]) => [monster, entry.state])),
      visible: !!shown && !!bubble && !bubble.hidden,
      line: shown ? { ...shown.line } : null,
      box:
        shown && bubble
          ? {
              left: bubble.style.left,
              top: bubble.style.top,
              text: bubble.textContent,
              face: !face.hidden
            }
          : null
    }
  }

  return { say, update, stop, state, preload }
}
