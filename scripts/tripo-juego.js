'use strict'

// El juego de la terminal, entero, dentro de la pagina 2.5D. Es lib/ sin tocar:
// el mismo Runa en el mismo Program de bare-tui, con sus reglas, sus guardados y
// su pantalla de texto. scripts/build-juego.js lo empaqueta para el navegador y
// solo cambia la plataforma: bare-fs sobre localStorage, la cadena por fetch y
// sin presencia P2P.
//
// La pagina le manda teclas como KeyMsg, igual que las decodifica la terminal,
// lee del modelo lo que dibuja en 3D (tripo-estado.js live) y muestra el cuadro
// de texto cuando el juego abre una pantalla que el mapa 3D no tiene.

const { Program, KeyMsg } = require('bare-tui')
const { Runa } = require('../lib/game.js')
const { SaveStore } = require('../lib/saves.js')
const { MAPS } = require('../lib/map.js')
const { t, withLanguage, mapLabels } = require('../lib/locale.js')
const fs = require('bare-fs')
const estado = require('./tripo-estado.js')

// Donde quedan las ranuras dentro de localStorage (bare-fs del navegador).
const SAVES = '/runa/saves'

// Las teclas con nombre, con los bytes que mandaria una terminal.
const NAMED = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  enter: '\r',
  escape: '\x1b',
  space: ' ',
  tab: '\t',
  backspace: '\x7f',
  delete: '\x1b[3~',
  home: '\x1b[H',
  end: '\x1b[F'
}

// Como la arma bare-ansi-escapes/key-decoder: Enter se llama 'return', una letra
// lleva su minuscula como nombre y el resto de lo imprimible se llama como es.
function keyMsg(name) {
  if (Object.hasOwn(NAMED, name)) {
    return new KeyMsg({
      name: name === 'enter' ? 'return' : name,
      sequence: NAMED[name],
      ctrl: false,
      meta: false,
      shift: false
    })
  }
  const letter = /^[0-9A-Za-z]$/.test(name)
  return new KeyMsg({
    name: letter ? name.toLowerCase() : name,
    sequence: name,
    ctrl: false,
    meta: false,
    shift: /^[A-Z]$/.test(name)
  })
}

function printable(name) {
  return typeof name === 'string' && name.length === 1 && name >= ' ' && name <= '~'
}

/**
 * Arranca una partida en la pagina.
 *
 * @param {object} [opts]
 * @param {string} [opts.language] - 'en' o 'es'
 * @param {number} [opts.cols] - columnas de la pantalla de texto
 * @param {number} [opts.rows] - filas de la pantalla de texto
 * @param {(view: string) => void} [opts.onFrame] - cada cuadro que dibuja el juego
 * @param {(line: string) => void} [opts.onSay] - cada linea nueva del registro
 * @param {(error?: Error) => void} [opts.onExit] - el juego termino
 */
function start(opts = {}) {
  const onFrame = opts.onFrame || (() => {})
  const onSay = opts.onSay || (() => {})
  const onExit = opts.onExit || (() => {})
  const runa = new Runa({
    presence: false,
    language: opts.language || 'en',
    saves: new SaveStore(SAVES)
  })
  // Cada linea del registro tambien sale para la pagina: el registro del juego
  // guarda las ultimas 40 y corre, asi que contarlas no alcanza.
  const say = runa.say.bind(runa)
  runa.say = (text) => {
    say(text)
    onSay(String(text))
  }

  const output = { isTTY: false, columns: opts.cols || 100, rows: opts.rows || 32 }
  output.write = () => true
  const program = new Program(runa, { output, altScreen: false })
  let frame = ''
  program.renderer = {
    start() {},
    stop() {},
    clear() {},
    render(view) {
      frame = view
      onFrame(view)
    }
  }
  let running = true
  const done = program.run().then(
    () => {
      running = false
      onExit()
    },
    (error) => {
      running = false
      onExit(error)
    }
  )

  const tr = (text) => withLanguage(runa.language, () => t(String(text)))

  return {
    runa,
    program,
    done,
    running: () => running,
    frame: () => frame,
    state: () => estado.live(runa),
    tr,
    // Un cartel del mapa traducido sin cambiar su largo, como en la terminal.
    sign: (line) => withLanguage(runa.language, () => mapLabels(line)),

    /**
     * Una tecla para el juego: 'up', 'enter', 'escape', una letra...
     * Q y Ctrl+C cierran el juego en la terminal; aca solo se escriben cuando el
     * juego espera texto (un nombre). Salir es cosa del menu de la pagina.
     */
    press(name) {
      if (!running) return false
      const typing = runa.naming || runa.walletEditing
      if (!typing && (name === 'q' || name === 'Q')) return false
      if (!Object.hasOwn(NAMED, name) && !printable(name)) return false
      program.send(keyMsg(name))
      return true
    },

    resize(cols, rows) {
      output.columns = cols
      output.rows = rows
      program.send({ type: 'resize', width: cols, height: rows })
    },

    language(code) {
      runa.language = code === 'es' ? 'es' : 'en'
      program.send({ type: 'redraw' })
    },

    // Las ranuras de esta pagina, para el menu.
    slots() {
      return runa.refreshSlots().map((slot) => ({ ...slot }))
    },

    // Seguir una partida guardada; el resultado lo cuenta el registro del juego.
    load(slot) {
      const ok = runa.loadSlot(slot)
      program.send({ type: 'redraw' })
      return ok
    },

    /**
     * Partida nueva por el mismo camino que el menu de la terminal: la ranura,
     * el nombre en el cuadro de texto, el reino y Enter.
     */
    begin({ name, realm = 'runa', slot = null } = {}) {
      const target = slot || (runa.firstEmptySlot() || {}).slot
      if (!target) return false
      runa.title = true
      runa.requestedName = String(name || '').slice(0, 16)
      runa.startNaming(target)
      runa.realmCursor = realm === 'nox' ? 1 : 0
      program.send(keyMsg('enter'))
      return true
    },

    // Guardar y salir al menu de la pagina.
    quit() {
      try {
        runa.saveCurrent()
      } catch {}
      program.quit()
      return done
    },

    // La estrategia de combate (script.txt): el juego la relee sola al cambiar.
    script: {
      read: () => {
        try {
          return fs.readFileSync('script.txt', 'utf8')
        } catch {
          return runa.scriptSource || ''
        }
      },
      write: (text) => fs.writeFileSync('script.txt', String(text)),
      errors: () => runa.scriptErrors.map((error) => ({ ...error }))
    }
  }
}

// Lo que pide la pagina sin abrir una partida: el menu muestra las ranuras antes
// de jugar, y el mapa 3D traduce nombres de NPC y carteles.
function slots() {
  return new SaveStore(SAVES).list()
}

// Copia una partida (la de la terminal, por ejemplo) a una ranura de la pagina.
// La valida lib/saves.js al cargarla, como a cualquier otra.
function importSave(slot, text) {
  const number = Math.floor(Number(slot))
  if (!(number >= 1 && number <= 3)) throw new Error('esa ranura no existe')
  const data = JSON.parse(String(text))
  if (!data || typeof data !== 'object' || !data.player) {
    throw new Error('no es una partida de Runa')
  }
  fs.writeFileSync(`${SAVES}/slot-${number}.json`, JSON.stringify(data, null, 2) + '\n')
  return slots()[number - 1]
}

function translate(language, text) {
  return withLanguage(language, () => t(String(text)))
}

function signs(language, line) {
  return withLanguage(language, () => mapLabels(line))
}

module.exports = {
  start,
  slots,
  importSave,
  translate,
  signs,
  persistent: () => (typeof fs.persistent === 'function' ? fs.persistent() : false),
  SAVES,
  MAPS
}
