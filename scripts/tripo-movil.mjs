// La red de seguridad para telefonos de la pagina 2.5D (tripo-heroe.html): lo
// que evita salir del juego sin querer, perder lo jugado al cambiar de app y
// quedar con la pantalla negra cuando el sistema le saca la GPU a la pagina.
//
//  - Atras: al jugar o recorrer se apila una entrada de guardia en el
//    historial. El boton atras del telefono (o el gesto) la consume y la pagina
//    decide que hacer (abrir o cerrar la pausa, volver al titulo) en vez de irse.
//  - Ocultar: al pasar a segundo plano se guarda la partida, ademas del
//    pagehide que ya tenia la pagina (el telefono puede matar la pestana sin
//    avisar despues de ocultarla).
//  - Contexto WebGL perdido: se evita que quede asi para siempre, se avisa y
//    al recuperarlo se recarga la pagina (los modelos de la GPU ya no estan).
//  - Teclado: campos a 16 px para que iOS no acerque la pagina, la tecla Enter
//    con su nombre, y el campo enfocado a la vista cuando el teclado achica la
//    pantalla.
//
// Sin three.js ni el juego: .mjs para que las pruebas lo carguen en Bare.

// La marca de la entrada de guardia en history.state.
export const GUARD_KEY = 'runa'

// El estilo que necesita un telefono: sin rebote que recargue la pagina, sin
// letra agrandada por el navegador, los campos a 16 px y sin arrastres que
// desplacen la pagina sobre la ficha y el registro.
export const MOBILE_CSS = `
html, body {
  overscroll-behavior: none;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
#hud, #stats, #log {
  touch-action: none;
}
input, select, .sheet input[type='text'] {
  font-size: 16px;
}
@media (pointer: coarse) {
  textarea, .sheet textarea {
    font-size: 16px;
  }
}
`

/**
 * Lo que hace el boton atras segun donde esta el jugador. Devuelve:
 *  - 'sheet': en la pausa, lo mismo que el Volver de la hoja abierta (una hoja
 *    interna vuelve a la principal y la principal cierra la pausa);
 *  - 'pause': jugando, abre la pausa;
 *  - 'escape': en una pantalla del juego (tienda, inventario), la cierra como Esc;
 *  - 'title': en el recorrido libre, vuelve al titulo;
 *  - 'none': fuera de esas pantallas no hay guardia que atender.
 */
export function backStep({ screen, paused, roaming }) {
  if (screen === 'tour') return 'title'
  if (screen !== 'play') return 'none'
  if (paused) return 'sheet'
  return roaming ? 'pause' : 'escape'
}

// Si la entrada actual del historial es la de guardia.
const guarded = (history) => !!(history.state && history.state[GUARD_KEY])

/**
 * La guardia del boton atras. `wanted()` dice si la pantalla actual la quiere
 * (jugar, recorrer); `onBack()` atiende un atras y devuelve si la guardia se
 * vuelve a poner (en la pausa si, al volver al titulo no).
 */
export function createBackGuard(win, { wanted, onBack }) {
  const history = win.history
  // Atras pedidos por la propia pagina para sacar la guardia: no son del jugador.
  let releasing = 0
  // Al recargar en pleno juego la entrada sigue marcada, pero su guardia era
  // del documento anterior: se desmarca para que arm() ponga una propia.
  if (guarded(history)) {
    try {
      const rest = { ...history.state }
      delete rest[GUARD_KEY]
      history.replaceState(Object.keys(rest).length ? rest : null, '')
    } catch {
      // Sin historial no hay guardia.
    }
  }
  function arm() {
    if (guarded(history)) return
    try {
      history.pushState({ ...(history.state || {}), [GUARD_KEY]: 1 }, '')
    } catch {
      // Sin historial (un iframe con sandbox) no hay guardia: el atras sale.
    }
  }
  function release() {
    if (!guarded(history)) return
    releasing++
    history.back()
  }
  function onPop(event) {
    // Adelante hacia una guardia vieja: no hay nada que atender.
    if (event.state && event.state[GUARD_KEY]) return
    if (releasing) {
      releasing--
      // Se volvio a jugar antes de que llegara el atras de la pagina.
      if (wanted()) arm()
      return
    }
    if (!wanted()) return
    if (onBack()) arm()
  }
  win.addEventListener('popstate', onPop)
  return { arm, release, onPop }
}

/**
 * Prepara un campo para el teclado de un telefono: el nombre de la tecla Enter
 * y las mayusculas. `caps` es 'words' para un nombre o 'characters' para un
 * codigo de sala.
 */
export function typing(input, { hint = 'go', caps = 'none' } = {}) {
  input.setAttribute('enterkeyhint', hint)
  input.setAttribute('autocapitalize', caps)
  input.setAttribute('autocorrect', 'off')
  try {
    input.enterKeyHint = hint
    input.autocapitalize = caps
  } catch {
    // Los atributos alcanzan en los navegadores sin estas propiedades.
  }
  return input
}

/**
 * Engancha todo a la pagina. Recibe:
 *  - canvas: el del renderer, para el contexto perdido;
 *  - save(): guarda la partida si hay una;
 *  - say(text): el aviso de la pagina;
 *  - lostText: el aviso al perder el contexto;
 *  - wanted / onBack: los de createBackGuard.
 */
export function createMobile({
  win = globalThis.window,
  canvas,
  save,
  say,
  lostText,
  wanted,
  onBack
}) {
  const doc = win.document
  const style = doc.createElement('style')
  style.id = 'runa-movil'
  style.textContent = MOBILE_CSS
  doc.head.append(style)

  const guard = createBackGuard(win, { wanted, onBack })

  // Guardar al ocultarse: el telefono puede cerrar la pestana sin otro aviso.
  const keep = () => {
    try {
      save()
    } catch {
      // Se guardo en el ultimo paso igual.
    }
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') keep()
  })
  // Chrome congela las pestanas de fondo: el aviso llega antes.
  doc.addEventListener('freeze', keep)

  // El contexto de WebGL perdido: sin preventDefault no vuelve nunca.
  let lost = false
  let lostTimer = 0
  if (canvas) {
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      lost = true
      keep()
      say(lostText)
      // Si el navegador no lo devuelve con la pagina a la vista, se recarga igual.
      clearTimeout(lostTimer)
      lostTimer = setTimeout(() => {
        if (lost && doc.visibilityState === 'visible') win.location.reload()
      }, 6000)
    })
    canvas.addEventListener('webglcontextrestored', () => {
      clearTimeout(lostTimer)
      keep()
      win.location.reload()
    })
  }

  // Con el teclado abierto la pantalla visible se achica: el campo va al medio.
  const viewport = win.visualViewport
  if (viewport) {
    viewport.addEventListener('resize', () => {
      const field = doc.activeElement
      if (!field || !field.matches || !field.matches('input, textarea')) return
      try {
        field.scrollIntoView({ block: 'center', inline: 'nearest' })
      } catch {
        field.scrollIntoView()
      }
    })
  }

  return {
    arm: guard.arm,
    release: guard.release,
    lost: () => lost,
    typing
  }
}
