'use strict'

// El juego de la terminal, entero, dentro de la pagina 2.5D. Es lib/ sin tocar:
// el mismo Runa en el mismo Program de bare-tui, con sus reglas, sus guardados y
// su pantalla de texto. scripts/build-juego.js lo empaqueta para el navegador y
// solo cambia la plataforma: bare-fs sobre localStorage, la cadena por fetch y
// la presencia P2P sobre WebRTC.
//
// La pagina le manda teclas como KeyMsg, igual que las decodifica la terminal,
// lee del modelo lo que dibuja en 3D (tripo-estado.js live) y muestra el cuadro
// de texto cuando el juego abre una pantalla que el mapa 3D no tiene.
//
// La red es opcional, como en la terminal: se juega solo hasta entrar a una
// sala del Coliseo en linea (online). Los de la misma sala se ven y se
// desafian con E; el duelo lo decide lib/, igual que entre dos terminales.

const { Program, KeyMsg } = require('bare-tui')
const { Runa, TICK_MS, WALLET } = require('../lib/game.js')
const { SaveStore } = require('../lib/saves.js')
const { MAPS } = require('../lib/map.js')
const { t, withLanguage, mapLabels } = require('../lib/locale.js')
const field = require('../lib/field.js')
const CONTENT = require('../lib/content.js')
const fs = require('bare-fs')
const estado = require('./tripo-estado.js')
const red = require('./navegador/red-webrtc.js')

// La pradera para la vista 3D (tripo-pradera.js): el campo del juego tal cual,
// para armar una sin partida (el recorrido) y para leer el suelo y el arte de
// cada lugar de la que esta en marcha. Solo se lee: las reglas son las de lib/.
const meadow = {
  Field: field.Field,
  groundAt: field.fieldGroundAt,
  camp: field.barbarianSettlementArt,
  art: {
    runa: field.RUNA_GATE_ART,
    nox: field.NOX_GATE_ART,
    crossroads: field.CROSSROADS_ART,
    ranger: field.RANGER_POST_ART,
    crypt: field.DUNGEON_ENTRANCE_ART,
    portal: field.WORLD_BOSS_PORTAL_ART
  },
  foes: CONTENT.foes,
  // Cuantas veces por segundo avanza el campo: lo que tarda un paso de monstruo.
  tps: 1000 / TICK_MS
}

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

  // La sala del Coliseo en linea, si se entro a una: su codigo y su presencia.
  let arena = null
  const joined = () => (arena && arena.presence && runa.presence === arena.presence ? arena : null)

  // Salir de la sala. Con un duelo abierto es rendirse (lib/game.js lo concede
  // y avisa), y el resultado queda guardado enseguida.
  function leaveRoom() {
    arena = null
    if (!runa.presence) return false
    try {
      runa.stopPresence()
      runa.saveCurrent()
    } catch {}
    program.send({ type: 'redraw' })
    return true
  }

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

    // Guardar y salir al menu de la pagina. Primero se deja la sala, para que
    // un rival no espere en el Coliseo a alguien que ya no esta.
    quit() {
      leaveRoom()
      try {
        runa.saveCurrent()
      } catch {}
      program.quit()
      return done
    },

    /**
     * Entrar a la sala `code` del Coliseo en linea (RUNA1 si falta). Los que
     * escriben el mismo codigo se ven en el mapa y se desafian con E. Cambiar
     * de sala en pleno duelo es rendirse en la anterior.
     *
     * @param {object} [opts]
     * @param {boolean} [opts.fresh] recien llegado a una sala publica
     * @returns {boolean} si la sala quedo abierta
     */
    online(code, opts = {}) {
      const room = red.roomCode(code) || red.DEFAULT_ROOM
      if (!running || runa.title || runa.naming) return false
      const current = joined()
      // Recien llegado a una sala publica se vuelve a entrar siempre: la
      // pagina pide fresh cuando empieza a buscar lugar.
      if (current && current.code === room && !opts.fresh) return true
      leaveRoom()
      let presence = null
      try {
        presence = new red.Presence({ name: runa.name, room, fresh: !!opts.fresh })
      } catch {
        return false
      }
      runa.attachPresence(presence)
      runa.startPresence()
      if (!presence.online) {
        const error = presence.error
        leaveRoom()
        arena = { code: room, presence: null, error }
        return false
      }
      arena = { code: room, presence, error: '' }
      program.send({ type: 'redraw' })
      return true
    },

    offline: leaveRoom,

    // Ya es de la sala publica: no se muda aunque despues llegue mas gente.
    settle() {
      const current = joined()
      if (current) current.presence.settle()
    },
    // Rendirse sin salir todavia de la sala: al cerrar la pagina el aviso al
    // rival tiene que salir antes de que se corten los canales de WebRTC.
    concede: () => {
      if (!(runa.duelNetwork && runa.duel && runa.concedeDuel())) return false
      // La derrota se guarda ya: pagehide llega tarde para escribir.
      try {
        runa.saveCurrent()
      } catch {}
      return true
    },

    /**
     * La sala para la pagina: el codigo, quien mas esta y si esta en el mismo
     * mapa (solo a esos se los puede desafiar). Null fuera de una sala.
     */
    room() {
      const current = joined()
      if (!current) return arena && arena.error ? { code: arena.code, error: arena.error } : null
      const presence = current.presence
      let all = []
      try {
        all = presence.others()
      } catch {}
      const here = new Set(runa.field ? [] : runa.others(runa.walker.mapId).map((peer) => peer.id))
      return {
        code: current.code,
        id: presence.id,
        error: presence.error || '',
        links: presence.conns.size,
        fresh: presence.self.fresh === 1,
        // El numero de sala publica, o 0 si es una privada.
        public: red.shardOf(current.code),
        players: all.map((peer) => ({
          id: peer.id,
          name: peer.name,
          level: peer.level,
          wins: peer.wins,
          losses: peer.losses,
          fresh: peer.fresh,
          here: here.has(peer.id)
        }))
      }
    },

    // Desafiar a alguien de la sala que este en el mismo mapa, sin acercarse.
    challenge(id) {
      if (!joined() || runa.field) return false
      const peer = runa.others(runa.walker.mapId).find((candidate) => candidate.id === id)
      if (!peer) return false
      const sent = runa.challengePlayer(peer)
      program.send({ type: 'redraw' })
      return sent
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
  MAPS,
  meadow,
  // Las salas publicas sin servidor: la pagina las recorre con esto.
  lobby: {
    publicCode: red.publicCode,
    shardOf: red.shardOf,
    reservedCode: red.reservedCode,
    shardVerdict: red.shardVerdict,
    roomCode: red.roomCode,
    PUBLIC_CAP: red.PUBLIC_CAP,
    PUBLIC_SHARDS: red.PUBLIC_SHARDS,
    DISCOVER_MS: red.DISCOVER_MS,
    SETTLE_MS: red.SETTLE_MS
  },
  // false en la version sin wallet (Steam).
  wallet: WALLET
}
