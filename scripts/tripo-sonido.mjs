// El sonido y la vibracion de la pagina 2.5D (tripo-heroe.html): lo que se oye
// y se siente al pegar, al recibir, al errar, al voltear a un enemigo y cuando el
// Coloso marca donde va a caer su golpe.
//
//  - Sonidos sintetizados con WebAudio: osciladores y ruido filtrado, sin
//    archivos que bajar. Cada uno es una receta (RECIPES) de capas cortas.
//  - El audio se destraba con el primer toque o tecla: los navegadores (Safari
//    sobre todo) no dejan sonar una pagina antes de un gesto de quien juega.
//  - La vibracion solo en Android: iOS no tiene navigator.vibrate y en la PC no
//    vibra nada.
//  - Los dos se apagan en Opciones (settings.sound, settings.vibrate).
//
// Sin three.js ni el juego: .mjs para que las pruebas lo carguen en Bare.

// Lo que suena. strength (0 a 1) es la parte de la vida que se llevo el golpe:
// un golpe grande suena mas grave y mas fuerte.
export const KINDS = ['hit', 'hurt', 'whiff', 'kill', 'telegraph']

// Cada capa: 'tone' (un oscilador que va de f0 a f1) o 'noise' (ruido blanco por
// un filtro que barre de f0 a f1). dur y delay en segundos, gain de 0 a 1.
export const RECIPES = {
  // El golpe que entra: un chasquido de ruido y un golpe grave.
  hit: [
    { type: 'noise', filter: 'bandpass', f0: 2400, f1: 900, q: 1.2, dur: 0.07, gain: 0.5 },
    { type: 'tone', wave: 'sine', f0: 170, f1: 55, dur: 0.14, gain: 0.8 }
  ],
  // El golpe que recibe el heroe: mas oscuro, con un zumbido aspero.
  hurt: [
    { type: 'tone', wave: 'sawtooth', f0: 210, f1: 90, dur: 0.2, gain: 0.32, lowpass: 900 },
    { type: 'noise', filter: 'lowpass', f0: 1400, f1: 300, q: 0.7, dur: 0.16, gain: 0.45 },
    { type: 'tone', wave: 'sine', f0: 110, f1: 45, dur: 0.22, gain: 0.6 }
  ],
  // El tajo al aire: ruido que sube, sin golpe.
  whiff: [{ type: 'noise', filter: 'bandpass', f0: 500, f1: 2600, q: 2.2, dur: 0.15, gain: 0.32 }],
  // El enemigo que cae: dos notas que suben, como una campana.
  kill: [
    { type: 'tone', wave: 'triangle', f0: 523, f1: 523, dur: 0.16, gain: 0.35 },
    { type: 'tone', wave: 'triangle', f0: 784, f1: 784, dur: 0.32, gain: 0.35, delay: 0.1 },
    { type: 'tone', wave: 'sine', f0: 1568, f1: 1568, dur: 0.26, gain: 0.12, delay: 0.1 }
  ],
  // El aviso del Coloso: un rumor grave que crece.
  telegraph: [
    { type: 'tone', wave: 'sawtooth', f0: 62, f1: 98, dur: 0.6, gain: 0.3, lowpass: 420 },
    { type: 'tone', wave: 'sine', f0: 124, f1: 196, dur: 0.6, gain: 0.18, attack: 0.25 }
  ]
}

// Lo que vibra cada uno, en milisegundos (vibrar, pausa, vibrar...). El tajo al
// aire no vibra.
export const PATTERNS = {
  hit: [14],
  hurt: [45],
  whiff: null,
  kill: [30, 50, 70],
  telegraph: [20, 80, 20]
}

// Lo minimo entre dos sonidos iguales, en segundos: una rafaga de golpes en el
// mismo cuadro suena una vez.
export const MIN_GAP = 0.05

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0))

/**
 * Las capas de un sonido para un golpe de esa fuerza: mas fuerte, un poco mas
 * fuerte y mas grave. Sin receta, una lista vacia.
 */
export function layers(kind, strength = 0) {
  const recipe = RECIPES[kind]
  if (!recipe) return []
  const s = clamp01(strength)
  // Un golpe que se lleva un cuarto de la vida o mas ya suena entero.
  const k = Math.min(1, s * 4)
  const loud = kind === 'hit' || kind === 'hurt' ? 0.7 + 0.3 * k : 1
  const pitch = kind === 'hit' || kind === 'hurt' ? 1.1 - 0.25 * k : 1
  return recipe.map((layer) => ({
    ...layer,
    delay: layer.delay || 0,
    attack: layer.attack || 0.005,
    gain: layer.gain * loud,
    f0: layer.f0 * pitch,
    f1: layer.f1 * pitch
  }))
}

// Lo que dura un sonido entero, en segundos.
export function length(kind) {
  return layers(kind).reduce((most, layer) => Math.max(most, layer.delay + layer.dur), 0)
}

/** Si este navegador vibra: navigator.vibrate y Android (iOS no la tiene). */
export function canVibrate(nav) {
  return !!(nav && typeof nav.vibrate === 'function' && /Android/i.test(nav.userAgent || ''))
}

/**
 * El sonido de la pagina. Recibe:
 *  - win: la ventana (AudioContext, navigator, document);
 *  - sound(): si el sonido esta prendido (Opciones);
 *  - vibrate(): si la vibracion esta prendida (Opciones).
 * Devuelve cue(kind, strength) (suena y vibra), play, buzz, unlock() y state().
 */
export function createSound({ win = globalThis.window, sound = () => true, vibrate = () => true }) {
  const Context = win.AudioContext || win.webkitAudioContext || null
  const nav = win.navigator
  const doc = win.document
  const vibrates = canVibrate(nav)
  let ctx = null
  let master = null
  let noise = null
  const last = new Map()
  const counts = {}
  let unlocked = false

  // El primer gesto crea el contexto (o lo reanuda) y toca un silencio: asi
  // Safari deja sonar lo que venga despues, fuera de un gesto.
  function unlock() {
    if (!Context) return false
    try {
      if (!ctx) {
        ctx = new Context()
        master = ctx.createGain()
        master.gain.value = 0.55
        // Sin recortes cuando suenan varios a la vez.
        const squeeze = ctx.createDynamicsCompressor ? ctx.createDynamicsCompressor() : null
        if (squeeze) {
          master.connect(squeeze)
          squeeze.connect(ctx.destination)
        } else master.connect(ctx.destination)
      }
      if (ctx.state !== 'running' && ctx.resume) {
        const resumed = ctx.resume()
        if (resumed && resumed.catch) resumed.catch(() => {})
      }
      const quiet = ctx.createBufferSource()
      quiet.buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100)
      quiet.connect(ctx.destination)
      quiet.start(0)
      unlocked = true
    } catch {
      // Sin audio la pagina sigue igual, en silencio.
      return false
    }
    return true
  }

  // Los gestos que destraban: se quedan hasta que el contexto suena (iOS a veces
  // lo deja suspendido despues del primero).
  const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click']
  function onGesture() {
    unlock()
    if (ctx && ctx.state === 'running') {
      for (const name of GESTURES) win.removeEventListener(name, onGesture, true)
    }
  }
  function listen() {
    for (const name of GESTURES) win.addEventListener(name, onGesture, true)
  }
  if (Context) listen()

  // En segundo plano se suspende (no gasta bateria); al volver, se reanuda o
  // espera otro gesto.
  if (doc && doc.addEventListener) {
    doc.addEventListener('visibilitychange', () => {
      if (!ctx) return
      try {
        if (doc.visibilityState === 'hidden') ctx.suspend && ctx.suspend()
        else if (ctx.resume) {
          const resumed = ctx.resume()
          if (resumed && resumed.catch) resumed.catch(() => {})
          listen()
        }
      } catch {
        // Igual vuelve con el proximo gesto.
      }
    })
  }

  function noiseBuffer() {
    if (noise) return noise
    const rate = ctx.sampleRate || 44100
    noise = ctx.createBuffer(1, Math.floor(rate * 0.5), rate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return noise
  }

  // Una capa: la fuente, su filtro si tiene, y un volumen que sube y se apaga.
  function voice(layer, now) {
    const start = now + layer.delay
    const end = start + layer.dur
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.linearRampToValueAtTime(layer.gain, start + layer.attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    gain.connect(master)
    let source
    let head = gain
    if (layer.type === 'noise') {
      source = ctx.createBufferSource()
      source.buffer = noiseBuffer()
      const filter = ctx.createBiquadFilter()
      filter.type = layer.filter || 'bandpass'
      filter.Q.value = layer.q || 1
      filter.frequency.setValueAtTime(layer.f0, start)
      filter.frequency.exponentialRampToValueAtTime(Math.max(1, layer.f1), end)
      filter.connect(gain)
      head = filter
    } else {
      source = ctx.createOscillator()
      source.type = layer.wave || 'sine'
      source.frequency.setValueAtTime(layer.f0, start)
      source.frequency.exponentialRampToValueAtTime(Math.max(1, layer.f1), end)
      if (layer.lowpass) {
        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = layer.lowpass
        filter.connect(gain)
        head = filter
      }
    }
    source.connect(head)
    source.start(start)
    source.stop(end + 0.02)
  }

  function play(kind, strength = 0) {
    if (!sound() || !ctx || ctx.state !== 'running') return false
    const now = ctx.currentTime
    if (now - (last.get(kind) ?? -Infinity) < MIN_GAP) return false
    const list = layers(kind, strength)
    if (!list.length) return false
    last.set(kind, now)
    try {
      for (const layer of list) voice(layer, now)
    } catch {
      return false
    }
    counts[kind] = (counts[kind] || 0) + 1
    return true
  }

  function buzz(kind) {
    const pattern = PATTERNS[kind]
    if (!pattern || !vibrates || !vibrate()) return false
    try {
      return nav.vibrate(pattern) !== false
    } catch {
      return false
    }
  }

  function cue(kind, strength = 0) {
    const heard = play(kind, strength)
    buzz(kind)
    return heard
  }

  function state() {
    return {
      supported: !!Context,
      unlocked,
      context: ctx ? ctx.state : 'none',
      vibrates,
      counts: { ...counts }
    }
  }

  return { cue, play, buzz, unlock, state, vibrates }
}
