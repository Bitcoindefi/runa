'use strict'

/**
 * runa: la cadena.
 *
 * net.js dice de si mismo que no hay autoridad: cada peer grita donde esta y
 * nadie arbitra nada. Eso alcanza para verse caminar, y no alcanza para apostar.
 * Este archivo es la mitad que falta, y se limita a esa mitad.
 *
 * Tres decisiones que explican todo lo demas:
 *
 *  1. La cadena es opcional, igual que la red. Si no hay internet, si el RPC
 *     esta caido, o si el bundle no cargo, el juego arranca igual y el Coliseo
 *     avisa que no hay linea. La enorme mayoria va a jugar sola y sin cuenta:
 *     ese es el camino que no puede romperse nunca.
 *
 *  2. Nada de esto bloquea un frame. El juego dibuja a 30 cuadros por segundo y
 *     una llamada al RPC tarda cientos de milisegundos. Todo lo que tarda
 *     devuelve promesas y escribe en un cache; lo que el dibujo lee es memoria.
 *
 *  3. No usamos @stellar/stellar-sdk. No carga en Bare: pide TextDecoder y
 *     despues Event, porque trae su propio cliente HTTP pensado para navegador
 *     o Node. Usamos stellar-base empaquetado (que sabe de XDR y firmas y nada
 *     de red) y hablamos el RPC nosotros con bare-https, que es JSON-RPC comun.
 */

const https = require('bare-https')

// Bare no trae estos tres globals. Van antes del require del bundle porque el
// bundle los toca al evaluarse, no al usarse.
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis
if (typeof globalThis.TextDecoder === 'undefined') {
  try {
    const p = require('text-encoding-polyfill')
    globalThis.TextDecoder = p.TextDecoder
    globalThis.TextEncoder = p.TextEncoder
  } catch {}
}
if (typeof globalThis.crypto === 'undefined') {
  try {
    const bc = require('bare-crypto')
    globalThis.crypto = {
      getRandomValues(arr) {
        const b = bc.randomBytes(arr.byteLength)
        new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(b)
        return arr
      }
    }
  } catch {}
}

// El bundle arrastra criptografia y XDR. Si en algun build no quedo, el juego no
// deberia morir por eso: se envuelve y todo lo demas comprueba `base` contra null.
let base = null
try {
  base = require('../vendor/stellar-base.bundle.js')
} catch {}

const TESTNET = {
  rpc: 'soroban-testnet.stellar.org',
  friendbot: 'friendbot.stellar.org',
  horizon: 'horizon-testnet.stellar.org',
  passphrase: 'Test SDF Network ; September 2015'
}

/** Cuanto esperamos al RPC antes de darlo por perdido. */
const TIMEOUT_MS = 12000

/**
 * Cuantos ledgers entran en un dia. Stellar cierra uno cada cinco segundos, asi
 * que 86400 / 5 = 17280. No es un numero exacto (un cierre puede demorarse) pero
 * no hace falta que lo sea: lo unico que importa es que todos partan el mismo
 * contador de la misma manera, y el contador es publico.
 */
const LEDGERS_PER_DAY = 17280

/** Validate a Stellar public account without ever accepting a secret seed. */
function isPublicAddress(value) {
  if (!base || typeof value !== 'string') return false
  try {
    return base.StrKey.isValidEd25519PublicKey(value.trim())
  } catch {
    return false
  }
}

/**
 * POST de JSON contra un host, con corte por tiempo.
 *
 * bare-https no trae AbortController, asi que el corte es un setTimeout que
 * destruye el socket. Sin eso, un RPC que no contesta deja el juego esperando
 * una promesa que no se resuelve nunca.
 */
function post(hostname, path, payload) {
  return new Promise((resolve, reject) => {
    const body = payload === null ? '' : JSON.stringify(payload)
    const headers = { accept: 'application/json' }
    if (body) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = Buffer.byteLength(body)
    }

    const req = https.request(
      { hostname, port: 443, path, method: body ? 'POST' : 'GET', headers },
      (res) => {
        let data = ''
        res.on('data', (c) => {
          data += c
        })
        res.on('end', () => {
          clearTimeout(timer)
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) })
          } catch {
            resolve({ status: res.statusCode, body: data })
          }
        })
      }
    )

    const timer = setTimeout(() => {
      req.destroy(new Error('el RPC no contesto en ' + TIMEOUT_MS + 'ms'))
    }, TIMEOUT_MS)

    req.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    if (body) req.write(body)
    req.end()
  })
}

class Chain {
  /**
   * @param {object} opts
   * @param {string} [opts.secret] Clave secreta ya guardada. Si no viene, no hay
   *   cuenta todavia y `create()` la fabrica.
   */
  constructor(opts = {}) {
    this.net = TESTNET
    this.keypair = null
    this.error = null

    // Lo que el dibujo lee. Nunca se consulta la red desde view().
    this.balance = null
    this.funded = false
    this.checkedAt = 0

    // La semilla del dia. Null hasta que la primera consulta vuelva; el juego
    // dibuja con la semilla local mientras tanto y nunca espera por esto.
    this.seed = null
    this.day = null

    if (!base) {
      this.error = 'la criptografia no cargo en este build'
      return
    }
    if (opts.secret) {
      try {
        this.keypair = base.Keypair.fromSecret(opts.secret)
      } catch {
        this.error = 'la clave guardada no es valida'
      }
    }
  }

  /** ¿Se puede usar la cadena en este build? */
  get available() {
    return base !== null
  }

  /** La direccion publica, o null si todavia no hay cuenta. */
  get address() {
    return this.keypair ? this.keypair.publicKey() : null
  }

  /** Direccion cortada para la ficha, que tiene 56 caracteres y no entran. */
  get short() {
    const a = this.address
    return a ? a.slice(0, 4) + '…' + a.slice(-4) : null
  }

  /**
   * Fabrica una cuenta nueva. Devuelve el secreto para que lo guarde quien
   * llama: este archivo no escribe en disco, para que el guardado siga viviendo
   * en un solo lugar (saves.js) y no en dos.
   */
  create() {
    if (!base) return null
    this.keypair = base.Keypair.random()
    return this.keypair.secret()
  }

  /**
   * Pide monedas de prueba al friendbot. Solo existe en testnet, y una cuenta
   * sin fondos no existe para la red, asi que este es el paso cero.
   */
  async fund() {
    if (!this.keypair) return false
    try {
      const r = await post(this.net.friendbot, '/?addr=' + this.address, null)
      this.funded = r.status === 200
      return this.funded
    } catch (e) {
      this.error = e.message
      return false
    }
  }

  /** Una llamada JSON-RPC cruda al RPC de Soroban. */
  async rpc(method, params) {
    const payload = { jsonrpc: '2.0', id: 1, method }
    if (params) payload.params = params
    const r = await post(this.net.rpc, '/', payload)
    if (r.body && r.body.error) throw new Error(r.body.error.message || 'error del RPC')
    return r.body ? r.body.result : null
  }

  /** Version de la red, que sirve para saber si hay linea antes de nada. */
  async health() {
    try {
      const n = await this.rpc('getNetwork')
      return { ok: true, protocol: n.protocolVersion, passphrase: n.passphrase }
    } catch (e) {
      this.error = e.message
      return { ok: false, why: e.message }
    }
  }

  /**
   * La semilla del dia: el numero que hace que todos jueguen el mismo campo.
   *
   * El campo de runa se dibuja a partir de una semilla, asi que quien controla
   * la semilla controla el mundo. Hoy sale de las estadisticas del jugador, o
   * sea que cada uno camina un campo que es solo suyo. Si en cambio sale de la
   * cadena, todos los que jueguen hoy caminan el mismo, y manana otro.
   *
   * Por que no alcanza un servidor: la semilla tiene que ser igual para todos,
   * cambiar sola, y sobre todo que **no la haya elegido nadie**. Las dos
   * primeras las da cualquier servidor. La tercera exige que vos puedas
   * comprobarlo por tu cuenta, y por eso sirve un contador publico que ningun
   * jugador ni ningun dueno puede mover.
   *
   * Se usa el numero de ledger y no su hash a proposito. El hash del ledger que
   * abrio el dia seria impredecible, que suena mejor, pero para leerlo hay que
   * pedirle al RPC un ledger de hace 24 horas y eso cae justo en el borde de lo
   * que el RPC conserva. Un jugador lo conseguiria y otro no, y entonces no
   * caminarian el mismo campo, que era todo el punto. Entre impredecible y que
   * todos coincidan, coincidir gana: el mapa del dia se comparte igual apenas
   * el primero lo publique.
   *
   * @returns {Promise<{seed:number, day:number, sequence:number}|null>}
   */
  async dailySeed() {
    try {
      const l = await this.rpc('getLatestLedger')
      const day = Math.floor(l.sequence / LEDGERS_PER_DAY)

      // Dispersion. El indice del dia crece de a uno, y campos de dias vecinos
      // saldrian casi calcados si se lo pasaramos crudo al generador.
      let s = day >>> 0
      s = Math.imul(s ^ (s >>> 16), 2246822507) >>> 0
      s = Math.imul(s ^ (s >>> 13), 3266489909) >>> 0
      s = (s ^ (s >>> 16)) >>> 0

      this.day = day
      this.seed = s
      return { seed: s, day, sequence: l.sequence }
    } catch (e) {
      this.error = e.message
      return null
    }
  }

  /**
   * Saldo en XLM. Va por Horizon y no por el RPC de Soroban porque el saldo
   * nativo es una cuenta clasica, no estado de un contrato.
   */
  async refresh() {
    if (!this.keypair) return null
    try {
      const r = await post(this.net.horizon, '/accounts/' + this.address, null)
      if (r.status === 404) {
        this.balance = 0
        this.funded = false
        return 0
      }
      const nativo = (r.body.balances || []).find((b) => b.asset_type === 'native')
      this.balance = nativo ? Number(nativo.balance) : 0
      this.funded = true
      this.checkedAt = Date.now()
      return this.balance
    } catch (e) {
      this.error = e.message
      return null
    }
  }
}

module.exports = { Chain, TESTNET, isPublicAddress }
