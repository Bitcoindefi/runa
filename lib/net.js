'use strict'

/**
 * runa: presencia.
 *
 * Ver a los demas caminar el mismo pueblo, y nada mas que eso. No hay estado
 * compartido, no hay autoridad, no hay historia: cada peer grita donde esta y
 * dibuja donde estan los otros. Como no se acuerda nada, no hay nada que pueda
 * entrar en conflicto, y por eso todo el archivo se sostiene en tres ideas.
 *
 *  1. La red es opcional. El juego arranca igual sin ella y `others()` devuelve
 *     un array vacio, que es exactamente el modo un jugador. La mayoria lo va a
 *     jugar solo, asi que ese es el camino que no puede romperse nunca.
 *
 *  2. La ausencia se detecta por silencio. El que se desconecta no llega a
 *     mandar el adios, asi que esperar uno seria disenar para el unico caso que
 *     no pasa. Se late cada BEAT_MS y se borra al que callo por GONE_MS.
 *
 *  3. La API es sincronica. El juego la llama desde update() y desde view(),
 *     que no pueden bloquear ni esperar nada. Todo lo que tarda vive en los
 *     timers y en los sockets; lo que el juego toca son lecturas de memoria.
 */

const EventEmitter = require('bare-events')

// hyperswarm arrastra bindings nativos (udx, sodium). Si en algun build no
// estan, el require tira y el juego no deberia morir por eso. Van aca arriba
// para que el bundler estatico los siga viendo, pero envueltos, y start() se
// limita a devolver false si quedaron en null.
let Hyperswarm = null
let crypto = null
try {
  Hyperswarm = require('hyperswarm')
  crypto = require('bare-crypto')
} catch {
  Hyperswarm = null
  crypto = null
}

/** El nombre del punto de encuentro. Quien hashea esto cae en el mismo pueblo. */
const TOPIC_NAME = 'runa:presence:v1'

/** Cada cuanto cada peer dice donde esta. */
const BEAT_MS = 200

/** Callado mas que esto, el peer se fue. */
const GONE_MS = 3000

/** Cada cuanto se busca a los que se quedaron callados. */
const SWEEP_MS = 500

/** Cada cuanto se pregunta quien mas hay, en el primer rato. */
const LOOK_MS = 2000

/** Y cada cuanto el resto de la partida. */
const LOOK_SLOW_MS = 30000

/** Cuanto dura ese primer rato de preguntar seguido. */
const LOOK_EAGER_MS = 60000

/** Una linea de estado es chica. Algo mas largo que esto no es nuestro. */
const MAX_LINE = 512

/** Techo de basura sin terminar que le aguantamos a un peer. */
const MAX_BUFFER = MAX_LINE * 8

/** Techo de peers, para que una multitud no haga crecer el Map sin limite. */
const MAX_PEERS = 64

/**
 * Deja solo ASCII imprimible.
 *
 * Todo lo que sale de aca se termina dibujando en la terminal, y el nombre lo
 * escribio otra maquina, asi que no es nuestro para confiar.
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function ascii(value, max) {
  const s = typeof value === 'string' ? value : ''
  let out = ''
  for (let i = 0; i < s.length && out.length < max; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0x20 && c <= 0x7e) out += s[i]
  }
  return out
}

/**
 * Una coordenada usable: entera, finita y acotada.
 *
 * mapPane la usa como indice, asi que un NaN o un infinito mandado por un peer
 * roto ensuciaria el render en vez de quedarse en la red.
 *
 * @param {unknown} value
 * @returns {number}
 */
function coord(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 0
  if (n < -9999) return -9999
  if (n > 9999) return 9999
  return n
}

/**
 * Un id nuevo por sesion, que muere con el proceso.
 *
 * Math.random alcanza: el id no es un secreto ni una identidad, solo tiene que
 * ser distinto al de los pocos que estan en el pueblo, y a diferencia de un
 * randomBytes no depende de que haya cargado ningun modulo nativo.
 *
 * @returns {string}
 */
function sessionId() {
  let out = ''
  for (let i = 0; i < 4; i++) {
    out += Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0')
  }
  return out
}

/**
 * La marca de un peer en el mapa: la primera letra de su nombre, para saber
 * quien es sin tener que dibujarle un cartel al lado.
 *
 * @param {string} name
 * @returns {string}
 */
function glyphFor(name) {
  const m = /[A-Za-z]/.exec(name || '')
  return m ? m[0].toUpperCase() : '&'
}

class Presence extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.name] lo que se lee en el log cuando alguien llega o se va
   * @param {string} [opts.glyph] un solo caracter ASCII, el que se dibuja en el mapa
   * @param {string} [opts.topic] otro punto de encuentro, para probar en un pueblo aparte
   * @param {boolean} [opts.offline] quedarse de a uno a proposito, sin tocar la red
   */
  constructor(opts = {}) {
    super()

    this.id = sessionId()
    this.name = ascii(opts.name, 12) || 'anon'
    this.glyph = ascii(opts.glyph, 1) || glyphFor(this.name)
    this.topicName = ascii(opts.topic, 64) || TOPIC_NAME
    this.offline = opts.offline === true

    this.started = false
    this.online = false

    // Lo que se manda tal cual, sin volver a armarlo en cada latido.
    this.self = {
      id: this.id,
      name: this.name,
      mapId: 'city',
      x: 0,
      y: 0,
      glyph: this.glyph
    }

    /**
     * @type {Map<string, {id: string, name: string, mapId: string, x: number,
     *   y: number, glyph: string, seen: number}>}
     */
    this.peers = new Map()

    /** @type {Set<object>} */
    this.conns = new Set()

    this.swarm = null
    this.discovery = null
    this.beatTimer = null
    this.sweepTimer = null
    this.lookTimer = null
    this.lookSince = 0
  }

  /**
   * Los 32 bytes del encuentro: sha256 de un nombre fijo, asi cada copia del
   * juego llega al mismo lugar sin que nadie publique una direccion.
   *
   * @returns {Buffer|null} null si no hay de donde sacar el hash
   */
  topic() {
    if (!crypto) return null
    return crypto.createHash('sha256').update(this.topicName).digest()
  }

  /**
   * Entra al pueblo. Vuelve enseguida y no tira nunca.
   *
   * @returns {boolean} si el swarm llego a levantar
   */
  start() {
    if (this.started) return this.online
    this.started = true

    // Que no haya swarm no es un error, es un pueblo vacio. Este es el camino
    // que mas se recorre, asi que es el que no puede fallar nunca.
    const topic = this.topic()
    if (this.offline || !Hyperswarm || !topic) return false

    try {
      this.swarm = new Hyperswarm()
      this.swarm.on('error', () => {})
      this.swarm.on('connection', (conn) => this.onConnection(conn))
      // client y server las dos: todos los jugadores son pares simetricos y
      // nadie hostea el pueblo, asi que cada uno anuncia y busca a la vez.
      this.discovery = this.swarm.join(topic, { client: true, server: true })
    } catch {
      this.swarm = null
      this.discovery = null
      return false
    }

    this.online = true
    this.beatTimer = setInterval(() => this.beat(), BEAT_MS)
    this.sweepTimer = setInterval(() => this.reap(), SWEEP_MS)
    this.lookSince = Date.now()
    this.lookLater()
    return true
  }

  /**
   * Se va. Se puede llamar dos veces, y se puede llamar aunque start() nunca
   * haya levantado nada. Despues de esto no queda nada nuestro sosteniendo
   * vivo al proceso.
   */
  stop() {
    if (this.beatTimer) clearInterval(this.beatTimer)
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    if (this.lookTimer) clearTimeout(this.lookTimer)
    this.beatTimer = null
    this.sweepTimer = null
    this.lookTimer = null
    this.discovery = null

    for (const conn of this.conns) {
      try {
        conn.destroy()
      } catch {
        // ya estaba cerrado
      }
    }
    this.conns.clear()
    this.peers.clear()

    const swarm = this.swarm
    this.swarm = null
    this.online = false
    this.started = false
    if (!swarm) return

    try {
      // destroy() es async y el juego no tiene donde esperarlo. Comerse el
      // rechazo es a proposito: un teardown que falla no deja nada sobre lo que
      // actuar, y un unhandled rejection se llevaria el proceso puesto.
      const done = swarm.destroy()
      if (done && typeof done.catch === 'function') done.catch(() => {})
    } catch {
      // idem: bajando la persiana, nada que reportar
    }
  }

  /**
   * Donde esta el jugador ahora. Lo llama el juego en cada paso, asi que no
   * hace mas que asignar: la linea sale sola en el proximo latido.
   *
   * @param {string} mapId
   * @param {number} x
   * @param {number} y
   */
  update(mapId, x, y) {
    this.self.mapId = ascii(mapId, 16) || this.self.mapId
    this.self.x = coord(x)
    this.self.y = coord(y)
  }

  /**
   * Todos los demas parados en ese mapa, con la forma que espera render.mapPane
   * en map.actors. Sin red devuelve [], que es el juego de a uno.
   *
   * @param {string} [mapId] si se omite, vienen todos sin filtrar
   * @returns {Array<{x: number, y: number, glyph: string, name: string}>}
   */
  others(mapId) {
    // Orden fijo por id: view() tiene que ser pura, y la misma multitud tiene
    // que dibujarse igual dos veces seguidas aunque el Map cambie de forma.
    const ids = [...this.peers.keys()].sort()
    const out = []
    for (const id of ids) {
      const p = this.peers.get(id)
      if (mapId !== undefined && p.mapId !== mapId) continue
      out.push({ x: p.x, y: p.y, glyph: p.glyph, name: p.name })
    }
    return out
  }

  // -------------------------------------------------------------------------

  /**
   * Aparecio un peer. Se le manda nuestro estado ya mismo, sin esperar el
   * latido, para que no tarde hasta BEAT_MS en vernos aparecer.
   *
   * @param {object} conn
   */
  onConnection(conn) {
    this.conns.add(conn)

    let buf = ''

    // Todos los listeners son defensivos. Un peer que se cae en medio de un
    // write llega como un evento error del stream, y uno sin escuchar se
    // llevaria el juego puesto.
    conn.on('error', () => {})
    conn.on('close', () => this.conns.delete(conn))
    conn.on('data', (chunk) => {
      // Decodificar por chunk puede partir un caracter multibyte al medio, pero
      // lo unico valido aca es JSON ASCII: lo que salga roto no parsea y se
      // descarta, que es el mismo destino que cualquier otra basura.
      buf += String(chunk)

      let nl = buf.indexOf('\n')
      while (nl !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line.length <= MAX_LINE) this.receive(line)
        nl = buf.indexOf('\n')
      }

      // Lo que queda es una linea a medio llegar. Las nuestras son minusculas,
      // asi que algo de este tamano no va a terminar de serlo nunca, y
      // guardarlo seria una fuga lenta.
      if (buf.length > MAX_BUFFER) buf = ''
    })

    this.send(conn)
  }

  /**
   * Una linea de estado de otro. Lo malformado se descarta en silencio: sobre
   * un topic publico la proxima linea siempre sale mas barata que una queja.
   *
   * @param {string} line
   */
  receive(line) {
    let msg = null
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    const id = ascii(msg.id, 32)
    if (!id || id === this.id) return

    const known = this.peers.get(id)
    if (!known && this.peers.size >= MAX_PEERS) return

    const peer = {
      id,
      name: ascii(msg.name, 12) || 'alguien',
      mapId: ascii(msg.mapId, 16) || 'city',
      x: coord(msg.x),
      y: coord(msg.y),
      glyph: ascii(msg.glyph, 1) || '&',
      seen: Date.now()
    }
    this.peers.set(id, peer)

    if (!known) this.fire('join', peer.name)
  }

  /**
   * Volver a preguntarle a la DHT quien mas esta parado en el topic.
   *
   * hyperswarm busca UNA vez al unirse y despues se duerme diez minutos
   * (REFRESH_INTERVAL, en lib/peer-discovery.js). Dos personas que abren el
   * juego con segundos de diferencia caen justo adentro de esa ventana: la
   * busqueda de cada una termina antes de que la otra haya terminado de
   * anunciarse, las dos ven un pueblo vacio y siguen sin verse durante diez
   * minutos. Medido: dos procesos, treinta segundos, cero conexiones entre
   * ellos, mientras los dos si encontraban a un tercero que llevaba rato
   * anunciado. Justo el caso que mas importa, que es sentarse a jugar juntos.
   *
   * Asi que preguntamos de nuevo por nuestra cuenta. El ritmo lo pone hace
   * cuanto arrancamos y nada mas: el primer minuto se pregunta sin parar,
   * porque es justo cuando la persona con la que uno quedo en jugar tambien
   * esta abriendo el juego, y despues se afloja a LOOK_SLOW_MS, que sigue
   * siendo veinte veces mas seguido que los diez minutos de hyperswarm y le
   * alcanza para el que llega tarde.
   *
   * Ojo con la version obvia de esto, que es preguntar seguido solo mientras
   * no se vea a nadie: sobre el topic publico uno se engancha a un desconocido
   * en segundos, eso cuenta como compania, y el que estaba esperando a un
   * amigo se queda esperandolo media hora igual. Medido: dos partidas de
   * verdad, diecisiete segundos, cada una viendo a tres desconocidos y a la
   * otra no. Tener a alguien al lado no es tener a quien uno esperaba.
   */
  lookLater() {
    const early = Date.now() - this.lookSince < LOOK_EAGER_MS

    this.lookTimer = setTimeout(
      () => {
        this.lookTimer = null
        this.look()
      },
      early ? LOOK_MS : LOOK_SLOW_MS
    )
  }

  /**
   * Una vuelta de busqueda, y la siguiente agendada pase lo que pase.
   *
   * refresh() se junta sola con la busqueda que ya este corriendo en vez de
   * arrancar otra, asi que pedirla de mas no cuesta nada: mientras esperamos
   * a alguien, el ritmo real lo termina poniendo lo que tarda la DHT en
   * contestar, que es lo mas rapido que se puede ir.
   */
  look() {
    const discovery = this.discovery
    if (!discovery) return
    try {
      const done = discovery.refresh()
      if (done && typeof done.catch === 'function') done.catch(() => {})
    } catch {
      // una busqueda que no sale no deja nada que arreglar, y la proxima ya
      // esta agendada dos lineas mas abajo
    }
    this.lookLater()
  }

  /** Decir donde estamos, a todos, contra el reloj. */
  beat() {
    for (const conn of this.conns) this.send(conn)
  }

  /**
   * Una linea de JSON terminada en \n. El delimitador es todo el framing: los
   * mensajes son chicos y de forma fija, asi que un frame con prefijo de largo
   * seria una dependencia comprada al pedo.
   *
   * @param {object} conn
   */
  send(conn) {
    if (!conn || conn.destroyed) return
    try {
      conn.write(JSON.stringify(this.self) + '\n')
    } catch {
      // Un stream cerrandose no es un error que valga contar: el barrido lo
      // saca cuando deje de contestar.
    }
  }

  /**
   * Sacar al que se callo.
   *
   * El que cierra la tapa o pierde el wifi nunca llega a mandar el adios, asi
   * que ese es justo el caso que hay que cubrir y el unico que un mensaje de
   * despedida no cubre. Por eso se mide silencio y no se escucha una palabra.
   */
  reap() {
    const now = Date.now()
    for (const [id, peer] of this.peers) {
      if (now - peer.seen <= GONE_MS) continue
      this.peers.delete(id)
      this.fire('leave', peer.name)
    }
  }

  /**
   * Emitir sin dejar que el error de un listener vuelva al socket que lo
   * disparo. Que falle la linea del log es problema del juego; que el swarm
   * siga en pie es problema nuestro.
   *
   * @param {string} event
   * @param {string} name
   */
  fire(event, name) {
    try {
      this.emit(event, name)
    } catch {
      // el log del juego no es asunto de la red
    }
  }
}

module.exports = { Presence, TOPIC_NAME, BEAT_MS, GONE_MS, MAX_PEERS, LOOK_MS }
