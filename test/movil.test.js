const { test } = require('brittle')
const movil = require('../scripts/tripo-movil.mjs')

// Un historial de mentira con pushState, replaceState y back como el del
// navegador: back dispara popstate con el estado de la entrada anterior.
function fakeWindow(state = null) {
  const listeners = []
  const entries = [state]
  let at = 0
  const win = {
    addEventListener(name, fn) {
      if (name === 'popstate') listeners.push(fn)
    },
    history: {
      get state() {
        return entries[at]
      },
      get length() {
        return entries.length
      },
      pushState(next) {
        entries.length = at + 1
        entries.push(next)
        at++
      },
      replaceState(next) {
        entries[at] = next
      },
      back() {
        if (at === 0) return
        at--
        for (const fn of listeners) fn({ state: entries[at] })
      }
    }
  }
  return win
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
