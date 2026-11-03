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

const STYLE = `
.voz-globo {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 26;
  max-width: min(78vw, 300px);
  padding: 7px 12px 8px;
  border: 2px solid var(--voz, #ffd27a);
  border-radius: 12px;
  background: rgba(18, 12, 8, 0.92);
  color: #fff6e0;
  font: 600 16px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  opacity: 0;
  transform: scale(0.85);
  transform-origin: var(--cola, 50%) 100%;
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.voz-globo.on { opacity: 1; transform: scale(1); }
.voz-globo b {
  display: block;
  margin-bottom: 1px;
  color: var(--voz, #ffd27a);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.voz-globo::after {
  content: '';
  position: absolute;
  left: var(--cola, 50%);
  bottom: -9px;
  margin-left: -8px;
  border: 8px solid transparent;
  border-bottom: 0;
  border-top-color: var(--voz, #ffd27a);
}
@media (max-width: 520px) {
  .voz-globo { font-size: 15px; max-width: 80vw; }
}
`

/**
 * Las voces de la pagina. Recibe:
 *  - win: la ventana;
 *  - base: donde estan los audios (assets/voces/, relativo a la pagina);
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

  // El globo: uno solo, el del ultimo que hablo.
  let bubble = null
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
    doc.body.appendChild(bubble)
    return bubble
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
    if (event === 'contact') preload(monster)
    const line = picker.pick(monster, event, clock(), lang())
    if (!line) return null
    said++
    const urgent = event === 'contact' || event === 'monster_death' || event === 'defeated'
    const box = element()
    const entry = MONSTERS[monster]
    const name = entry.name[lang() === 'es' ? 1 : 0]
    box.innerHTML = ''
    const who = doc.createElement('b')
    who.textContent = name
    box.appendChild(who)
    box.appendChild(doc.createTextNode(line.text))
    box.style.setProperty('--voz', entry.color)
    box.hidden = false
    const now = clock()
    shown = {
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
      visible: !!shown && !!bubble && !bubble.hidden,
      line: shown ? { ...shown.line } : null,
      box:
        shown && bubble
          ? { left: bubble.style.left, top: bubble.style.top, text: bubble.textContent }
          : null
    }
  }

  return { say, update, stop, state, preload }
}
