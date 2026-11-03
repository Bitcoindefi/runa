// La caja de dialogo de los NPC, como en un RPG clasico: retrato a la
// izquierda, nombre en dorado, el texto que aparece letra por letra al ritmo de
// la voz, una flecha que titila al terminar. Tocar, clic o Enter adelanta: si
// todavia escribe, completa el texto y corta la voz; si ya termino, cierra.
//
// Todo es perezoso: el manifiesto de voces, el mp3 y el retrato se piden solo
// cuando se habla con ese NPC. Sin mp3 o con el sonido apagado, el texto se
// escribe solo. Sin retrato, un marco dorado con la inicial.
//
//   const dialogue = createDialogue({ sound: () => settings.sound !== false })
//   dialogue.show({ id: 'cedric', name: 'sir Cedric, square knight', text })
//   dialogue.open()   // true mientras la caja esta a la vista
//   dialogue.hide()

const CSS = `
#dialogo {
  position: fixed;
  left: 50%;
  bottom: 72px;
  transform: translateX(-50%);
  width: min(620px, calc(100vw - 32px));
  box-sizing: border-box;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px 14px 18px;
  background: linear-gradient(180deg, rgba(22, 18, 12, 0.94), rgba(10, 8, 6, 0.94));
  border: 2px solid #c9a24a;
  border-radius: 8px;
  box-shadow: 0 0 0 1px #3a2c10, 0 8px 24px rgba(0, 0, 0, 0.6);
  color: #f3ead6;
  font: 16px/1.4 Georgia, 'Times New Roman', serif;
  z-index: 40;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
#dialogo[hidden] { display: none; }
#dialogo .cara {
  flex: 0 0 auto;
  width: 84px;
  height: 84px;
  border: 2px solid #c9a24a;
  border-radius: 6px;
  background: radial-gradient(circle, #3b2e16, #120d06);
  overflow: hidden;
  display: grid;
  place-items: center;
  color: #e7c56a;
  font: bold 40px Georgia, serif;
}
#dialogo .cara img { width: 100%; height: 100%; object-fit: cover; display: block; }
#dialogo .cuerpo { flex: 1; min-width: 0; }
#dialogo .nombre { color: #e7c56a; font-weight: bold; letter-spacing: 0.02em; }
#dialogo .texto { margin: 4px 0 0; min-height: 2.8em; }
#dialogo .nota { display: block; margin-top: 4px; color: #a99a7a; font-size: 13px; }
#dialogo .nota:empty { display: none; }
#dialogo .flecha {
  position: absolute;
  right: 12px;
  bottom: 4px;
  color: #e7c56a;
  font-size: 14px;
  animation: dialogo-titila 0.8s steps(2, start) infinite;
}
#dialogo .flecha[hidden] { display: none; }
@keyframes dialogo-titila { to { visibility: hidden; } }
@media (max-width: 700px), (pointer: coarse) {
  #dialogo {
    bottom: auto;
    top: calc(env(safe-area-inset-top, 0px) + 64px);
    width: calc(100vw - 32px);
    font-size: 15px;
    padding: 10px 10px 16px;
    gap: 10px;
  }
  #dialogo .cara { width: 64px; height: 64px; font-size: 30px; }
}
`

export function createDialogue({
  sound = () => true,
  voices = 'assets/voces-npc/',
  faces = 'assets/retratos-npc/',
  win = globalThis.window,
  doc = win.document
} = {}) {
  const voicesRoot = new URL(voices, doc.baseURI)
  const facesRoot = new URL(faces, doc.baseURI)
  const style = doc.createElement('style')
  style.textContent = CSS
  doc.head.append(style)

  const box = doc.createElement('div')
  box.id = 'dialogo'
  box.hidden = true
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-live', 'polite')
  const face = doc.createElement('div')
  face.className = 'cara'
  const body = doc.createElement('div')
  body.className = 'cuerpo'
  const name = doc.createElement('div')
  name.className = 'nombre'
  const words = doc.createElement('p')
  words.className = 'texto'
  const small = doc.createElement('small')
  small.className = 'nota'
  const arrow = doc.createElement('span')
  arrow.className = 'flecha'
  arrow.textContent = '▼'
  body.append(name, words, small)
  box.append(face, body, arrow)
  doc.body.append(box)

  let manifest = null
  let audio = null
  let full = ''
  let shown = 0
  let speed = 32
  let started = 0
  let frame = 0
  let onClose = null

  // El manifiesto se pide una sola vez, la primera vez que alguien habla.
  function loadManifest() {
    if (!manifest) {
      manifest = fetch(new URL('manifest.json', voicesRoot))
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
    }
    return manifest
  }

  function stopVoice() {
    if (!audio) return
    audio.pause()
    audio.src = ''
    audio = null
  }

  function setFace(id, label) {
    const initial = (
      label.replace(/^(sir|sister|hermana|king|rey)\s+/i, '')[0] || '?'
    ).toUpperCase()
    face.replaceChildren()
    face.textContent = initial
    if (!id) return
    const img = doc.createElement('img')
    img.alt = ''
    img.decoding = 'async'
    img.onload = () => face.replaceChildren(img)
    img.src = new URL(id + '.webp', facesRoot).href
  }

  function tick(now) {
    if (box.hidden) return
    const count = Math.min(full.length, Math.floor(((now - started) / 1000) * speed))
    if (count !== shown) {
      shown = count
      words.textContent = full.slice(0, shown)
    }
    if (shown < full.length) frame = win.requestAnimationFrame(tick)
    else arrow.hidden = false
  }

  function finish() {
    win.cancelAnimationFrame(frame)
    shown = full.length
    words.textContent = full
    arrow.hidden = false
  }

  // La voz del NPC: si existe, el ritmo de las letras sigue su duracion.
  async function speak(text) {
    const data = await loadManifest()
    const file = data && data.lines && data.lines[text]
    if (!file || !sound() || box.hidden || full !== text) return
    stopVoice()
    const voice = new win.Audio(new URL(file, voicesRoot).href)
    audio = voice
    voice.addEventListener('loadedmetadata', () => {
      if (audio !== voice || !isFinite(voice.duration) || voice.duration <= 0) return
      // Un poco mas rapido que la voz, para que el texto no quede atras.
      speed = Math.max(12, (full.length / voice.duration) * 1.05)
      started = performance.now() - (shown / speed) * 1000
    })
    voice.play().catch(() => {})
  }

  function show({ id, name: label, text, note, close } = {}) {
    stopVoice()
    win.cancelAnimationFrame(frame)
    full = String(text || '...')
    shown = 0
    speed = 32
    onClose = close || null
    name.textContent = label || ''
    small.textContent = note || ''
    words.textContent = ''
    arrow.hidden = true
    setFace(id, label || '')
    box.hidden = false
    started = performance.now()
    frame = win.requestAnimationFrame(tick)
    speak(full)
  }

  function hide() {
    if (box.hidden) return
    stopVoice()
    win.cancelAnimationFrame(frame)
    box.hidden = true
    const done = onClose
    onClose = null
    if (done) done()
  }

  // Adelantar: completa el texto y corta la voz; si ya estaba completo, cierra.
  function advance() {
    if (box.hidden) return false
    if (shown < full.length) {
      stopVoice()
      finish()
    } else hide()
    return true
  }

  box.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    advance()
  })

  return { show, hide, advance, open: () => !box.hidden, element: box }
}
