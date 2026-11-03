// La musica de fondo de la pagina 2.5D (tripo-heroe.html): una pista por mapa,
// hecha con la Music API de ElevenLabs (scripts/generar-musica.mjs).
//
//  - Que pista va en cada mapa sale de musica-pistas.js (tripo-musica-pistas.mjs).
//  - Se baja solo la pista del mapa donde se esta, cuando se llega: nada antes.
//  - Se repite sin fin y, al cambiar de mapa, una se apaga mientras la otra
//    sube (FADE segundos).
//  - Suena por el mismo contexto de audio de los golpes (sonido.js): arranca
//    recien despues del primer toque o tecla, respeta Opciones > Sonido, va mas
//    baja que las voces y baja todavia mas mientras habla un monstruo.
//  - Con la pestana oculta se pausa: en el celular no gasta bateria.
//  - Sin assets/musica/manifest.json (o sin la pista) no suena nada.

import { trackFor, musicVolume } from './musica-pistas.js'

// Cuanto tarda el cruce entre dos pistas, en segundos.
const FADE = 1.5
// Cada cuanto se mira el mapa, el sonido y si habla alguien, en ms.
const TICK = 250

/**
 * La musica de la pagina. Recibe:
 *  - win: la ventana;
 *  - base: donde estan las pistas (assets/musica/, relativo a la pagina);
 *  - map(): el id del mapa actual ('city', 'field', 'crypt-1', 'boss'...) o
 *    'title' en el menu;
 *  - sound(): si el sonido esta prendido (Opciones);
 *  - audio(): el AudioContext de los golpes, o null si todavia no hay;
 *  - speaking(): si un monstruo esta hablando.
 * Devuelve update(), stop() y state().
 */
export function createMusic({
  win = globalThis.window,
  base = 'assets/musica/',
  map = () => null,
  sound = () => true,
  audio = () => null,
  speaking = () => false
} = {}) {
  const doc = win.document
  const root = new URL(base, doc.baseURI)
  // El manifiesto: que pistas hay. Se pide una vez.
  let files = null
  let status = 'idle'
  // La pista que suena (o la que esta subiendo).
  let current = null
  let wanted = null

  function loadManifest() {
    if (status !== 'idle') return
    status = 'loading'
    win
      .fetch(new URL('manifest.json', root))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        files = {}
        for (const track of (data && data.tracks) || []) files[track.id] = track.file
        status = 'ready'
        update()
      })
      .catch(() => {
        files = {}
        status = 'missing'
      })
  }

  // Una pista nueva: su elemento de audio y su volumen en el contexto.
  function open(id, ctx) {
    const el = new win.Audio()
    el.loop = true
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    el.src = new URL(files[id], root).href
    const gain = ctx.createGain()
    gain.gain.value = 0
    try {
      ctx.createMediaElementSource(el).connect(gain)
    } catch {
      // Sin la fuente de WebAudio el volumen va por el elemento.
      el.volume = 0
    }
    gain.connect(ctx.destination)
    const track = { id, el, gain, ctx }
    const played = el.play()
    if (played && played.catch) played.catch(() => {})
    return track
  }

  function fadeTo(track, level, seconds) {
    const now = track.ctx.currentTime
    const param = track.gain.gain
    param.cancelScheduledValues(now)
    param.setValueAtTime(param.value, now)
    param.linearRampToValueAtTime(level, now + seconds)
    track.el.volume = Math.max(0, Math.min(1, level))
  }

  function close(track) {
    if (!track) return
    fadeTo(track, 0, FADE)
    win.setTimeout(
      () => {
        track.el.pause()
        track.el.removeAttribute('src')
        track.el.load()
        track.gain.disconnect()
      },
      FADE * 1000 + 100
    )
  }

  function update() {
    const ctx = audio()
    if (!ctx || ctx.state !== 'running') return
    if (status === 'idle') return loadManifest()
    if (status !== 'ready') return
    const on = sound() !== false
    const id = trackFor(map())
    wanted = id && files[id] ? id : null
    if (!on) wanted = null
    if ((current && current.id) !== wanted) {
      close(current)
      current = wanted ? open(wanted, ctx) : null
    }
    if (current) {
      const level = musicVolume({ sound: on, speaking: !!speaking() })
      const target = current.level === undefined ? FADE : 0.4
      if (current.level !== level) {
        fadeTo(current, level, target)
        current.level = level
      }
      if (doc.hidden) current.el.pause()
      else if (current.el.paused) {
        const played = current.el.play()
        if (played && played.catch) played.catch(() => {})
      }
    }
  }

  const timer = win.setInterval(update, TICK)
  const onVisible = () => update()
  doc.addEventListener('visibilitychange', onVisible)

  function stop() {
    win.clearInterval(timer)
    doc.removeEventListener('visibilitychange', onVisible)
    close(current)
    current = null
  }

  function state() {
    return {
      manifest: status,
      wanted,
      track: current ? current.id : null,
      src: current ? current.el.src : null,
      paused: current ? current.el.paused : true,
      level: current ? current.level : 0
    }
  }

  return { update, stop, state }
}
