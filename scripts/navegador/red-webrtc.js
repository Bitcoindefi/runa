'use strict'

// La presencia de lib/net.js sobre WebRTC, para jugar el Coliseo en la pagina.
//
// Es la misma Presence: las lineas de estado, el latido, el barrido por
// silencio y los mensajes de duelo dirigidos, saneados y sin repeticion. Solo
// cambia por donde viajan. En la terminal las lleva Hyperswarm; aca las lleva
// Trystero (vendor/trystero), que encuentra a los otros por los trackers
// publicos de BitTorrent y despues habla directo, navegador a navegador, por un
// RTCDataChannel ordenado. Las reglas del duelo siguen en lib/: este archivo
// no sabe que es un duelo.
//
// Cada sala es un codigo corto. Quien escribe el mismo codigo cae en la misma
// sala y solo ve a los de su sala. Un navegador no ve a la terminal.

const net = require('../../lib/net.js')

/** La version va en el appId: una pagina vieja no se cruza con una nueva. */
const APP_ID = 'runa-arena-v1'

/** La sala RUNA1 es el topic runa:arena:RUNA1. */
const ROOM_TOPIC = 'runa:arena:'

/** Letras y numeros, hasta 8: un codigo que se dicta en voz alta. */
const ROOM_MAX = 8

// --- Las salas publicas -----------------------------------------------------
// No hay servidor que reparta: cada uno entra a RUNA1, espera a los que ya
// estan y, si sobra gente, el recien llegado de id mas alto se muda a RUNA2, y
// asi. Trystero arma una malla completa (cada uno conectado con todos), por eso
// el tope es chico: 8 son 7 conexiones por telefono.

/** Sala publica: RUNA1, RUNA2... (roomCode le quita el guion a RUNA-1). */
const PUBLIC_PREFIX = 'RUNA'
/** Jugadores por sala publica, contando a uno. */
const PUBLIC_CAP = 8
/** Hasta donde se busca antes de quedarse en la ultima. */
const PUBLIC_SHARDS = 50
/** Lo que se espera a los que ya estan antes de decidir. */
const DISCOVER_MS = 5000
/** Mientras dura, el recien llegado puede mudarse; despues ya es de la sala. */
const SETTLE_MS = 15000

const publicCode = (n) => PUBLIC_PREFIX + Math.max(1, Math.floor(Number(n) || 1))

/** El numero de sala publica de un codigo (RUNA3 es 3), o 0 si es privada. */
function shardOf(code) {
  const match = /^RUNA([1-9]\d?)$/.exec(roomCode(code))
  return match ? Number(match[1]) : 0
}

/** Los codigos que no pueden ser privados: escribirlos lleva a la publica. */
function reservedCode(code) {
  const room = roomCode(code)
  return room === 'PUBLIC' || room === PUBLIC_PREFIX || shardOf(room) > 0
}

/**
 * Quedarse o mudarse de una sala publica. Solo se muda un recien llegado
 * (fresh); los asentados nunca. Si la sala pasa el tope, se van los recien
 * llegados de id mas alto, tantos como sobren: todos calculan lo mismo.
 *
 * @param {object} opts
 * @param {string} opts.selfId el id de presencia propio
 * @param {boolean} opts.fresh si uno todavia es recien llegado
 * @param {Array<{id: string, fresh?: number|boolean}>} opts.others los demas de la sala
 * @param {number} [opts.cap]
 * @returns {'stay'|'leave'}
 */
function shardVerdict({ selfId, fresh, others = [], cap = PUBLIC_CAP }) {
  const total = others.length + 1
  if (!fresh || total <= cap) return 'stay'
  const over = total - cap
  const newest = [selfId, ...others.filter((peer) => peer.fresh).map((peer) => peer.id)]
    .sort()
    .reverse()
  return newest.indexOf(selfId) < over ? 'leave' : 'stay'
}

const DEFAULT_ROOM = publicCode(1)

/**
 * El silencio que hace falta para dar por ido a alguien. En la terminal son
 * tres segundos; una pagina puede quedarse congelada mas que eso mientras arma
 * un mapa, o un telefono cambiar de app un momento. Una pestana cerrada no
 * espera esto (sale de la sala y Trystero avisa con onPeerLeave); un navegador
 * muerto o una red cortada si: el que se queda sale a los diez segundos.
 */
const GONE_MS = 10000

/** El nombre de la unica accion de Trystero: cada mensaje es una linea. */
const LINE = 'line'

function roomCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_MAX)
}

// Trystero se carga recien al entrar a una sala: las pruebas le pasan una sala
// falsa y nunca lo tocan. esbuild lo empaqueta igual porque ve el require.
let trystero = null
function joinTrystero(config, roomId, callbacks) {
  if (!trystero) trystero = require('../../vendor/trystero/trystero-torrent.mjs')
  return trystero.joinRoom(config, roomId, callbacks)
}

class WebRtcPresence extends net.Presence {
  /**
   * @param {object} [opts] los de Presence, mas:
   * @param {string} [opts.room] el codigo de la sala (RUNA1 si falta)
   * @param {boolean} [opts.fresh] recien llegado a una sala publica
   * @param {Function} [opts.joinRoom] el joinRoom de Trystero, o uno falso
   */
  constructor(opts = {}) {
    const room = roomCode(opts.room) || DEFAULT_ROOM
    super({ goneMs: GONE_MS, ...opts, topic: ROOM_TOPIC + room })
    this.room = room
    this.joinRoom = opts.joinRoom || joinTrystero
    this.channel = null
    /** @type {Map<string, object>} una conexion por peer de Trystero */
    this.links = new Map()
    /** Lo ultimo que salio mal al entrar o al conectar, para mostrarlo. */
    this.error = ''
  }

  start() {
    if (this.started) return this.online
    this.started = true
    if (this.offline) return false

    try {
      const channel = this.joinRoom({ appId: APP_ID }, this.topicName, {
        // Sin TURN, dos redes con NAT estricto pueden no llegar a hablarse.
        onJoinError: (details) => {
          this.error = String((details && details.error) || details || 'error')
        }
      })
      const line = channel.makeAction(LINE)
      line.onMessage = (data, { peerId } = {}) => {
        const conn = this.links.get(peerId)
        if (conn && !conn.destroyed) conn.emit('data', data)
      }
      // onPeerJoin repite enseguida a los que ya estan: va despues de onPeerLeave.
      channel.onPeerLeave = (peerId) => this.unlink(peerId)
      channel.onPeerJoin = (peerId) => this.link(peerId, line)
      this.channel = channel
    } catch (error) {
      this.error = String((error && error.message) || error)
      this.started = false
      return false
    }

    this.online = true
    this.beatTimer = setInterval(() => this.beat(), net.BEAT_MS)
    this.sweepTimer = setInterval(() => this.reap(), net.SWEEP_MS)
    return true
  }

  stop() {
    const channel = this.channel
    this.channel = null
    this.links.clear()
    // Cierra las conexiones y olvida a todos sin avisar nada: el que se va es
    // este juego, no los otros.
    super.stop()
    if (!channel) return
    try {
      channel.onPeerJoin = null
      channel.onPeerLeave = null
      const done = channel.leave()
      if (done && typeof done.catch === 'function') done.catch(() => {})
    } catch {
      // Salir es lo ultimo que pasa: no queda nada que arreglar.
    }
  }

  /** Un peer de Trystero como la conexion que espera Presence.onConnection. */
  link(peerId, line) {
    this.unlink(peerId, false)
    const handlers = {}
    const conn = {
      destroyed: false,
      // Presence lo completa con el id de presencia de la primera linea.
      peerId: null,
      on(event, listener) {
        ;(handlers[event] ||= []).push(listener)
      },
      emit(event, value) {
        for (const listener of handlers[event] || []) listener(value)
      },
      write(text) {
        if (conn.destroyed) return false
        const sent = line.send(String(text), { target: peerId })
        if (sent && typeof sent.catch === 'function') sent.catch(() => {})
        return true
      },
      destroy() {
        if (conn.destroyed) return
        conn.destroyed = true
        conn.emit('close')
      }
    }
    this.links.set(peerId, conn)
    this.onConnection(conn)
  }

  /**
   * Se fue un peer de Trystero. WebRTC lo sabe antes que el silencio (deja la
   * sala, cierra la pestana): se avisa ya y una sola vez, y reap() no lo vuelve
   * a contar porque deja de estar en peers.
   */
  unlink(peerId, gone = true) {
    const conn = this.links.get(peerId)
    if (!conn) return
    this.links.delete(peerId)
    const id = conn.peerId
    conn.destroy()
    if (!gone || !id || !this.peers.has(id)) return
    for (const other of this.conns) if (other.peerId === id) return
    const peer = this.peers.get(id)
    this.peers.delete(id)
    this.fire('leave', peer.name)
    this.fire('peer-leave', { id: peer.id, name: peer.name })
  }
}

module.exports = {
  ...net,
  Presence: WebRtcPresence,
  WebRtcPresence,
  APP_ID,
  WEB_GONE_MS: GONE_MS,
  ROOM_TOPIC,
  DEFAULT_ROOM,
  ROOM_MAX,
  roomCode,
  PUBLIC_PREFIX,
  PUBLIC_CAP,
  PUBLIC_SHARDS,
  DISCOVER_MS,
  SETTLE_MS,
  publicCode,
  shardOf,
  reservedCode,
  shardVerdict
}
