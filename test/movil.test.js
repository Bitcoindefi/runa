const { test } = require('brittle')
const movil = require('../scripts/tripo-movil.mjs')

// Un historial de mentira con pushState, replaceState y back como el del
// navegador: back dispara popstate con el estado de la entrada anterior, y cada
// entrada tiene su direccion (pushState sin direccion copia la actual).
function fakeWindow(state = null, href = 'https://runa.test/jugar') {
  const listeners = []
  const entries = [{ state, href }]
  let at = 0
  const win = {
    addEventListener(name, fn) {
      if (name === 'popstate') listeners.push(fn)
    },
    location: {
      get href() {
        return entries[at].href
      }
    },
    history: {
      get state() {
        return entries[at].state
      },
      get length() {
        return entries.length
      },
      pushState(next, title, url) {
        entries.length = at + 1
        entries.push({ state: next, href: url ? String(url) : entries[at].href })
        at++
      },
      replaceState(next, title, url) {
        entries[at] = { state: next, href: url ? String(url) : entries[at].href }
      },
      back() {
        if (at === 0) return
        at--
        for (const fn of listeners) fn({ state: entries[at].state })
      }
    }
  }
  return win
}

// Una pagina de mentira para createMobile: visibilidad, eventos y recarga.
function fakePage() {
  const win = fakeWindow()
  const on = {}
  const canvasOn = {}
  const doc = {
    visibilityState: 'visible',
    head: { append() {} },
    createElement: () => ({}),
    addEventListener(name, fn) {
      on[name] = fn
    }
  }
  win.document = doc
  win.reloads = 0
  const href = win.location
  win.location = {
    get href() {
      return href.href
    },
    reload() {
      win.reloads++
    }
  }
  const canvas = {
    addEventListener(name, fn) {
      canvasOn[name] = fn
    }
  }
  const page = {
    win,
    canvas,
    said: [],
    hide() {
      doc.visibilityState = 'hidden'
      on.visibilitychange()
    },
    show() {
      doc.visibilityState = 'visible'
      on.visibilitychange()
    },
    lose: () => canvasOn.webglcontextlost({ preventDefault() {} }),
    restore: () => canvasOn.webglcontextrestored({})
  }
  return page
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function mobileOn(page, opts = {}) {
  return movil.createMobile({
    win: page.win,
    canvas: page.canvas,
    save() {},
    say: (text) => page.said.push(text),
    lostText: 'perdida',
    busyText: 'al terminar',
    lostWait: 20,
    wanted: () => true,
    onBack: () => true,
    ...opts
  })
}

test('movil: el atras decide segun la pantalla', (t) => {
  t.is(movil.backStep({ screen: 'tour' }), 'title')
  t.is(movil.backStep({ screen: 'menu' }), 'none')
  t.is(movil.backStep({ screen: 'play', paused: true, roaming: true }), 'sheet')
  t.is(movil.backStep({ screen: 'play', paused: false, roaming: true }), 'pause')
  t.is(movil.backStep({ screen: 'play', paused: false, roaming: false }), 'escape')
})

test('movil: la guardia se repone al jugar y el atras no sale', (t) => {
  const win = fakeWindow()
  let screen = 'play'
  let backs = 0
  const guard = movil.createBackGuard(win, {
    wanted: () => screen === 'play',
    onBack: () => {
      backs++
      return true
    }
  })
  guard.arm()
  guard.arm()
  t.is(win.history.length, 2, 'una sola guardia aunque se arme dos veces')
  win.history.back()
  t.is(backs, 1, 'la pagina atendio el atras')
  t.ok(win.history.state && win.history.state.runa, 'y la guardia volvio')
  t.is(win.history.length, 2)
  // Al salir al titulo la pagina saca su guardia: ese atras no es del jugador.
  screen = 'menu'
  guard.release()
  t.is(backs, 1, 'el atras de la pagina no se atiende')
  t.is(win.history.state, null)
})

test('movil: volver a jugar antes de que llegue el atras de la pagina', (t) => {
  const win = fakeWindow()
  let screen = 'play'
  const guard = movil.createBackGuard(win, { wanted: () => screen === 'play', onBack: () => true })
  guard.arm()
  // La pagina pide sacar la guardia y el navegador tarda: se vuelve a jugar.
  const back = win.history.back
  let pending = null
  win.history.back = () => {
    pending = back
  }
  screen = 'menu'
  guard.release()
  screen = 'play'
  guard.arm()
  t.is(win.history.length, 2, 'la guardia vieja todavia esta arriba')
  pending.call(win.history)
  t.ok(win.history.state && win.history.state.runa, 'llego el atras y la guardia se repuso')
})

test('movil: al recargar en pleno juego la marca vieja se borra', (t) => {
  const win = fakeWindow({ runa: 1, otro: 2 })
  movil.createBackGuard(win, { wanted: () => false, onBack: () => true })
  t.alike(win.history.state, { otro: 2 })
  const bare = fakeWindow({ runa: 1 })
  movil.createBackGuard(bare, { wanted: () => false, onBack: () => true })
  t.is(bare.history.state, null)
})

test('movil: en el recorrido el atras va al titulo sin reponer la guardia', (t) => {
  const win = fakeWindow()
  let screen = 'tour'
  const guard = movil.createBackGuard(win, {
    wanted: () => screen === 'tour',
    onBack: () => {
      screen = 'menu'
      return false
    }
  })
  guard.arm()
  win.history.back()
  t.is(screen, 'menu')
  t.is(win.history.state, null, 'el proximo atras ya sale de la pagina')
})

test('movil: los campos piden la tecla Enter y las mayusculas', (t) => {
  const attrs = {}
  const input = { setAttribute: (name, value) => (attrs[name] = value) }
  movil.typing(input, { hint: 'go', caps: 'characters' })
  t.is(attrs.enterkeyhint, 'go')
  t.is(attrs.autocapitalize, 'characters')
  t.is(attrs.autocorrect, 'off')
  t.is(input.enterKeyHint, 'go')
  t.ok(/font-size: 16px/.test(movil.MOBILE_CSS), 'los campos a 16 px: iOS no acerca la pagina')
})

test('movil: el atras no le saca la sala privada a la direccion', (t) => {
  const win = fakeWindow()
  const guard = movil.createBackGuard(win, { wanted: () => true, onBack: () => true })
  guard.arm()
  // linkRoom de la pagina: la sala va sobre la entrada de guardia.
  guard.setUrl('https://runa.test/jugar?room=VPROBE7')
  win.history.back()
  t.ok(win.history.state && win.history.state.runa, 'la guardia volvio')
  t.is(win.location.href, 'https://runa.test/jugar?room=VPROBE7', 'y la sala sigue')
  win.history.back()
  t.is(win.location.href, 'https://runa.test/jugar?room=VPROBE7', 'tambien al segundo atras')
})

test('movil: el atras no trae de vuelta la sala que se dejo', (t) => {
  const win = fakeWindow(null, 'https://runa.test/jugar?room=ABC')
  let screen = 'play'
  const guard = movil.createBackGuard(win, { wanted: () => screen === 'play', onBack: () => true })
  guard.arm()
  // Se paso a una sala publica: la direccion pierde la privada.
  guard.setUrl('https://runa.test/jugar')
  win.history.back()
  t.is(win.location.href, 'https://runa.test/jugar', 'el atras no la repone')
  // Guardar y salir al titulo saca la guardia con un atras de la pagina.
  screen = 'menu'
  guard.release()
  t.is(win.history.state, null)
  t.is(win.location.href, 'https://runa.test/jugar', 'ni al salir al titulo')
})

test('movil: la grafica perdida en segundo plano recarga al volver', async (t) => {
  const page = fakePage()
  const mobile = mobileOn(page)
  page.hide()
  page.lose()
  t.ok(mobile.lost())
  await wait(40)
  t.is(page.win.reloads, 0, 'oculta no recarga')
  page.show()
  t.is(page.said.at(-1), 'perdida', 'al volver se avisa otra vez')
  await wait(40)
  t.is(page.win.reloads, 1, 'y se recarga')
})

test('movil: la grafica devuelta en pleno duelo espera a que termine', async (t) => {
  const page = fakePage()
  let fighting = true
  mobileOn(page, { busy: () => fighting })
  page.lose()
  page.restore()
  t.is(page.win.reloads, 0, 'no recarga: seria rendirse')
  t.is(page.said.at(-1), 'al terminar')
  fighting = false
  await wait(60)
  t.is(page.win.reloads, 1, 'termino la pelea y recarga')
})

test('movil: la grafica devuelta fuera de una pelea recarga enseguida', (t) => {
  const page = fakePage()
  mobileOn(page)
  page.lose()
  page.restore()
  t.is(page.win.reloads, 1)
})
