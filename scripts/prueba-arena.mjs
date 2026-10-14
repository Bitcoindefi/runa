#!/usr/bin/env node
// Prueba de punta a punta del Coliseo en linea: la pagina 2.5D (tripo-heroe.html)
// con el juego entero adentro y la presencia sobre WebRTC.
//
// Levanta el visor local y dos Chrome sin ventana, cada uno con su perfil, y
// los hace jugar como dos personas que comparten un codigo de sala:
//
//   1. Entran a la misma sala con un codigo al azar, A desafia a B con E, B
//      acepta con Enter, pelean en el Coliseo hasta un resultado y los dos
//      vuelven a la ciudad de acuerdo en quien gano.
//   2. En pleno duelo el host cierra su pagina: el otro se queda con la
//      victoria y sale del Coliseo, y el que se fue tiene la derrota guardada.
//   3. En pleno duelo se mata el navegador del host, sin despedida: el otro sale
//      solo del Coliseo, sin ganador (la salida Q sigue bloqueada en el duelo).
//   4. En pleno duelo cada pagina se congela 5 s, como al armar el Coliseo con
//      la red lenta o en un telefono: el duelo sigue y termina bien.
//
//   node scripts/prueba-arena.mjs [--chrome ruta] [--only 1,2,3,4] [--keep] [--verbose]
//   node scripts/prueba-arena.mjs --url https://playruna.vercel.app/jugar
//
// Con --url no levanta el visor: los dos Chrome abren esa pagina publicada.
//
// Necesita internet: Trystero se encuentra con el otro por trackers publicos
// de BitTorrent (despues el duelo va directo, navegador a navegador). Sale con
// codigo distinto de cero si algo falla.

import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at === -1 ? fallback : argv[at + 1]
}
const KEEP = argv.includes('--keep')
const VERBOSE = argv.includes('--verbose')
const ONLY = new Set(String(option('only', '1,2,3,4')).split(','))
const URL_BASE = option('url', null)
const CHROME = option('chrome', process.env.CHROME || findChrome())
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'runa-arena-'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const started = Date.now()
const seconds = (from) => ((Date.now() - from) / 1000).toFixed(1) + ' s'
const log = (text) => console.log(`[${seconds(started).padStart(7)}] ${text}`)

function findChrome() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return candidates.find((file) => fs.existsSync(file)) || candidates[0]
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function roomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'T'
  for (let i = 0; i < 6; i++) code += letters[Math.floor(Math.random() * letters.length)]
  return code
}

function kill(child) {
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else child.kill('SIGKILL')
  } catch {
    // Ya no estaba.
  }
}

// --- El visor ----------------------------------------------------------------

async function startViewer() {
  const port = await freePort()
  const storage = path.join(WORK, 'storage')
  fs.mkdirSync(storage, { recursive: true })
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'tripo-viewer.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), RUNA_STORAGE: storage },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const origin = `http://127.0.0.1:${port}`
  const until = Date.now() + 120000
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('el visor se cerro:\n' + output)
    try {
      const response = await fetch(origin + '/juego.js', { signal: AbortSignal.timeout(20000) })
      if (response.ok) {
        await response.arrayBuffer()
        return { child, origin, output: () => output }
      }
    } catch {
      // Todavia arrancando o empaquetando el juego.
    }
    await sleep(250)
  }
  throw new Error('el visor no sirvio juego.js a tiempo:\n' + output)
}

// --- Chrome por CDP ------------------------------------------------------------

class Page {
  constructor(tag, socketUrl) {
    this.tag = tag
    this.ws = new WebSocket(socketUrl)
    this.seq = 0
    this.pending = new Map()
    this.errors = []
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails
        const text = (details.exception && details.exception.description) || details.text
        this.errors.push(text)
        if (VERBOSE) log(`${this.tag} exception: ${text}`)
      } else if (VERBOSE && message.method === 'Runtime.consoleAPICalled') {
        const args = message.params.args.map((arg) => arg.value ?? arg.description ?? '')
        log(`${this.tag} console.${message.params.type}: ${args.join(' ').slice(0, 240)}`)
      }
    }
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = () => reject(new Error('sin CDP para ' + tag))
    })
    this.closed = new Promise((resolve) => this.ws.addEventListener('close', resolve))
  }

  send(method, params = {}) {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error(`${this.tag}: CDP ${method} sin respuesta`))
      }, 20000)
    })
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails) {
      const details = result.exceptionDetails
      throw new Error(
        `${this.tag}: ${(details.exception && details.exception.description) || details.text}`
      )
    }
    return result.result.value
  }

  async waitFor(expression, ms, what) {
    const until = Date.now() + ms
    let last = null
    while (Date.now() < until) {
      try {
        last = await this.eval(`(() => { try { return ${expression} } catch { return null } })()`)
        if (last) return last
      } catch (error) {
        last = error.message
      }
      await sleep(150)
    }
    const errors = this.errors.length ? '\n  errores de la pagina: ' + this.errors.join(' | ') : ''
    throw new Error(`${this.tag}: no llego "${what}" en ${ms / 1000} s${errors}`)
  }

  // Lo que la pagina sabe del juego, en una sola lectura.
  state() {
    return this.eval(`(() => {
      const page = window.runaPage()
      const s = page.live
      return {
        map: page.map,
        room: page.room,
        figures: page.figures,
        live: s && {
          title: s.title,
          location: s.location,
          world: s.world,
          near: s.near,
          invite: s.invite,
          arena: s.arena,
          pvp: s.pvp,
          lastDuel: s.lastDuel,
          hp: s.hp
        }
      }
    })()`)
  }

  key(name, type) {
    const spec = KEYS[name]
    const base = {
      key: name,
      code: spec.code,
      windowsVirtualKeyCode: spec.keyCode,
      nativeVirtualKeyCode: spec.keyCode
    }
    if (type === 'keyUp') return this.send('Input.dispatchKeyEvent', { type, ...base })
    return this.send('Input.dispatchKeyEvent', {
      type: spec.text ? 'keyDown' : 'rawKeyDown',
      ...base,
      ...(spec.text ? { text: spec.text, unmodifiedText: spec.text } : {})
    })
  }

  async press(name) {
    await this.key(name, 'keyDown')
    await this.key(name, 'keyUp')
  }

  close() {
    try {
      this.ws.close()
    } catch {
      // Ya cerrado.
    }
  }
}

const KEYS = {
  Escape: { code: 'Escape', keyCode: 27 },
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  e: { code: 'KeyE', keyCode: 69, text: 'e' },
  f: { code: 'KeyF', keyCode: 70, text: 'f' },
  r: { code: 'KeyR', keyCode: 82, text: 'r' }
}

// Los juegos nuevos arrancan livianos (sin sombras, efectos bajos) y en ingles.
// Sin la sala publica al empezar: la prueba elige la sala con su codigo.
const SETTINGS = JSON.stringify({ lang: 'en', effects: 'low', shadows: false, net: 'off' })

async function launch(tag, origin) {
  const port = await freePort()
  const dir = path.join(WORK, 'chrome-' + tag)
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--user-data-dir=${dir}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--window-size=1100,700',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )
  let target = null
  for (let i = 0; i < 300 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find((entry) => entry.type === 'page')
    } catch {
      // Chrome todavia arrancando.
    }
    if (!target) await sleep(100)
  }
  if (!target) throw new Error('Chrome no abrio el puerto de depuracion para ' + tag)
  const page = new Page(tag, target.webSocketDebuggerUrl)
  await page.ready
  await page.send('Runtime.enable')
  await page.send('Page.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { if (!localStorage.getItem('runa:web:settings')) localStorage.setItem('runa:web:settings', ${JSON.stringify(SETTINGS)}) } catch {}`
  })
  await page.send('Page.navigate', { url: origin + (URL_BASE ? '/' : '/heroe') })
  return { tag, child, port, page, origin }
}

// --- Lo que hace una persona -----------------------------------------------------

async function newGame(player, name) {
  const { page } = player
  await page.waitFor(
    `window.runaJuego && window.runaPage().screen === 'menu' && [...document.querySelectorAll('#menu-main button')].some((b) => !b.disabled && b.textContent.startsWith('New game'))`,
    90000,
    'el menu de titulo'
  )
  await page.eval(
    `[...document.querySelectorAll('#menu-main button')].find((b) => b.textContent.startsWith('New game')).click()`
  )
  await page.waitFor(`document.querySelector('#menu-page input[type=text]')`, 5000, 'el nombre')
  await page.eval(`(() => {
    document.querySelector('#menu-page input[type=text]').value = ${JSON.stringify(name)}
    document.querySelector('#menu-page form button[type=submit]').click()
  })()`)
  await page.waitFor(
    `window.runaGame && !window.runaGame.state().title && window.runaPage().map === 'city'`,
    90000,
    'la ciudad en 3D'
  )
  await page.eval(`document.activeElement && document.activeElement.blur()`)
}

// Esc, En linea, el codigo y Entrar: como lo hace alguien con el teclado.
async function joinRoom(player, code) {
  const { page } = player
  await page.press('Escape')
  await page.waitFor(`!document.getElementById('pause').hidden`, 5000, 'el menu de pausa')
  await page.eval(
    `[...document.querySelectorAll('#pause .sheet button')].find((b) => b.textContent.startsWith('Online')).click()`
  )
  await page.waitFor(
    `document.querySelector('#pause .sheet form input')`,
    5000,
    'la hoja de la sala'
  )
  await page.eval(`(() => {
    const input = document.querySelector('#pause .sheet form input')
    input.value = ${JSON.stringify(code)}
    input.form.querySelector('button[type=submit]').click()
  })()`)
  await page.waitFor(
    `(() => { const r = window.runaGame.room(); return !!(r && r.id && r.code === ${JSON.stringify(code)}) })()`,
    30000,
    'la sala ' + code
  )
  await page.press('Escape')
  await page.waitFor(`document.getElementById('pause').hidden`, 5000, 'volver al juego')
  await page.eval(`document.activeElement && document.activeElement.blur()`)
}

async function pair(code, names) {
  const at = Date.now()
  const players = []
  for (const name of names) players.push(await launch(name, viewer.origin))
  await Promise.all(players.map((player, i) => newGame(player, names[i])))
  log(`  ${names.join(' y ')} en la ciudad (${seconds(at)})`)
  await Promise.all(players.map((player) => joinRoom(player, code)))
  const met = Date.now()
  await Promise.all(
    players.map((player) =>
      player.page.waitFor(
        `window.runaGame.room().players.length === 1 && window.runaPage().live.players.length === 1`,
        90000,
        'ver al otro jugador en la sala'
      )
    )
  )
  log(`  sala ${code}: se ven en ${seconds(met)}`)
  return players
}

// A desafia a B con E y B acepta con Enter; los dos terminan en el Coliseo con
// el rival dibujado.
async function enterDuel(a, b, wounded = 0) {
  await a.page.waitFor(
    `(() => { const n = window.runaPage().live.near; return n && n.kind === 'player' })()`,
    20000,
    'el otro jugador al lado (E desafia)'
  )
  if (wounded) await b.page.eval(`window.runaGame.runa.player.hp = ${wounded}`)
  const homes = await Promise.all([a, b].map((player) => player.page.state()))
  await a.page.press('e')
  await b.page.waitFor(
    `(() => { const i = window.runaPage().live.invite; return i && i.direction === 'in' })()`,
    20000,
    'el desafio'
  )
  await b.page.press('Enter')
  await Promise.all(
    [a, b].map((player) =>
      player.page.waitFor(
        `(() => { const p = window.runaPage(); return !!(p.live.arena && p.map === 'coliseum' && p.figures.some((f) => f.duel)) })()`,
        30000,
        'el Coliseo con el rival'
      )
    )
  )
  return homes.map((state) => state.live.location)
}

function check(ok, what, failures) {
  if (ok) return true
  failures.push(what)
  log(`  FALLA: ${what}`)
  return false
}

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y)
const home = (location) => location && { mapId: location.mapId, x: location.x, y: location.y }

// --- Las tres corridas ------------------------------------------------------------

async function runFight() {
  const failures = []
  const code = roomCode()
  const [a, b] = await pair(code, ['Ana', 'Beto'])
  try {
    // Beto llega herido (3 de vida): tres golpes de Ana deciden el duelo.
    const homes = await enterDuel(a, b, 3)
    const ids = await Promise.all([a, b].map((p) => p.page.eval(`window.runaGame.room().id`)))
    const first = await a.page.state()
    const rivalFigure = first.figures.find((figure) => figure.duel)
    log(
      `  en el Coliseo; rival dibujado como ${rivalFigure && rivalFigure.rig ? 'el heroe de Tripo' : 'la figura simple'}; host ${ids[0] < ids[1] ? 'Ana' : 'Beto'}`
    )
    check(rivalFigure && rivalFigure.name === 'Beto', 'Ana ve a Beto en el Coliseo', failures)

    const arena = first.live.arena
    // En tercera persona la camara va detras del heroe mirando al rival: arriba
    // camina hacia el y los costados lo rodean. En 2.5D la pantalla no gira.
    const third = await a.page.eval(
      `(() => { try { return (JSON.parse(localStorage.getItem('runa:web:settings')) || {}).camera || 'third' } catch { return 'third' } })() === 'third'`
    )
    const toward = third ? 'ArrowUp' : arena.rival.x > arena.self.x ? 'ArrowRight' : 'ArrowLeft'
    const walk = Date.now()
    await a.page.key(toward, 'keyDown')
    await a.page.waitFor(
      `(() => { const r = window.runaPage().live.arena; return r && r.distance <= r.self.reach })()`,
      30000,
      'Ana llega al alcance de Beto'
    )
    await a.page.key(toward, 'keyUp')
    log(`  Ana camina hasta Beto en ${seconds(walk)}`)

    // La vida de Beto como la ve cada pagina, sin repetidos: tienen que contar lo
    // mismo, porque las dos aplican los mismos pasos ordenados por el host.
    const byAna = []
    const byBeto = []
    const note = (list, value) => {
      if (list[list.length - 1] !== value) list.push(value)
    }
    const fight = Date.now()
    while (Date.now() - fight < 30000) {
      const [sa, sb] = await Promise.all([a.page.state(), b.page.state()])
      if (sa.live.arena) note(byAna, sa.live.arena.rival.hp)
      if (sb.live.arena) note(byBeto, sb.live.arena.self.hp)
      if (!sa.live.arena || !sb.live.arena) break
      await a.page.press('f')
      await sleep(350)
    }
    log(`  F de Ana: vida de Beto en la pagina de Ana ${byAna}, en la de Beto ${byBeto}`)

    await Promise.all(
      [a, b].map((player) =>
        player.page.waitFor(
          `!window.runaPage().live.arena && window.runaPage().map === 'city'`,
          20000,
          'volver a la ciudad'
        )
      )
    )
    const [sa, sb] = await Promise.all([a.page.state(), b.page.state()])
    check(
      sa.live.lastDuel && sb.live.lastDuel && sa.live.lastDuel.winner === sb.live.lastDuel.winner,
      'las dos paginas coinciden en el ganador',
      failures
    )
    check(sa.live.lastDuel && sa.live.lastDuel.winner === ids[0], 'gana Ana', failures)
    check(
      sa.live.lastDuel && sa.live.lastDuel.reason === 'vida',
      'por vida, no por rendicion',
      failures
    )
    check(same(sa.live.pvp, { wins: 1, losses: 0 }), 'Ana suma una victoria', failures)
    check(same(sb.live.pvp, { wins: 0, losses: 1 }), 'Beto suma una derrota', failures)
    check(same(home(sa.live.location), home(homes[0])), 'Ana vuelve a donde estaba', failures)
    check(same(home(sb.live.location), home(homes[1])), 'Beto vuelve a donde estaba', failures)
    check(
      !sa.figures.some((f) => f.duel) && !sb.figures.some((f) => f.duel),
      'el rival desaparece al terminar',
      failures
    )
    check(
      byAna.length >= 3 && same(byAna, byBeto),
      'la vida de Beto baja igual en las dos paginas',
      failures
    )
    return {
      name: 'duelo hasta un resultado',
      failures,
      detail: `gana Ana; vida de Beto ${byAna.join(' > ')} > 0 en las dos paginas`
    }
  } finally {
    for (const player of [a, b]) {
      player.page.close()
      kill(player.child)
    }
  }
}

// El host se va en pleno duelo: cierra la pagina (corre beforeunload) o se le
// mata el navegador (sin despedida).
async function runDeparture(how) {
  const failures = []
  const code = roomCode()
  const names = how === 'close' ? ['Cora', 'Dax'] : ['Eva', 'Fito']
  const players = await pair(code, names)
  try {
    const homes = await enterDuel(players[0], players[1])
    const ids = await Promise.all(players.map((p) => p.page.eval(`window.runaGame.room().id`)))
    const hostAt = ids[0] < ids[1] ? 0 : 1
    const host = players[hostAt]
    const guest = players[1 - hostAt]
    const guestHome = homes[1 - hostAt]
    await sleep(1500)
    const gone = Date.now()
    if (how === 'close') {
      log(`  ${host.tag} (host) cierra su pagina en pleno duelo`)
      await host.page.send('Page.close').catch(() => {})
    } else {
      log(`  se mata el navegador de ${host.tag} (host) en pleno duelo`)
      kill(host.child)
    }
    await guest.page.waitFor(
      `!window.runaPage().live.arena && window.runaPage().map === 'city'`,
      20000,
      'salir del Coliseo'
    )
    log(`  ${guest.tag} sale del Coliseo en ${seconds(gone)}`)
    const state = await guest.page.state()
    check(
      same(home(state.live.location), home(guestHome)),
      `${guest.tag} vuelve a donde estaba`,
      failures
    )
    check(!state.figures.some((f) => f.duel), 'el rival desaparece', failures)
    let detail = ''
    if (how === 'close') {
      // Cerrar la pestana no espera a WebRTC: si la rendicion llega, el que se
      // queda gana; si no llega, es un corte y nadie gana. Nunca dos victorias
      // ni una derrota para el que se quedo.
      const won = !!(state.live.lastDuel && state.live.lastDuel.winner === ids[1 - hostAt])
      const delivered = won && same(state.live.pvp, { wins: 1, losses: 0 })
      const dropped = !state.live.lastDuel && same(state.live.pvp, { wins: 0, losses: 0 })
      check(delivered || dropped, `${guest.tag} gana o queda sin resultado, nunca pierde`, failures)
      // La partida del que se fue, en su navegador: la derrota quedo guardada.
      const saved = await savedGame(host)
      check(
        saved && same(saved.summary.pvp, { wins: 0, losses: 1 }),
        `${host.tag} guardo la derrota`,
        failures
      )
      check(
        saved && saved.location && saved.location.mapId === 'city',
        `${host.tag} guardo la ciudad`,
        failures
      )
      detail = `${guest.tag} ${delivered ? 'gana (llego la rendicion)' : 'sin resultado (la rendicion no llego)'}, ${host.tag} guarda ${saved ? JSON.stringify(saved.summary.pvp) : 'nada'}`
    } else {
      check(!state.live.lastDuel, 'sin ganador', failures)
      check(same(state.live.pvp, { wins: 0, losses: 0 }), 'nadie suma por el silencio', failures)
      detail = `${guest.tag} libre, sin ganador`
    }
    return {
      name: how === 'close' ? 'el host cierra la pagina' : 'el navegador del host muere',
      failures,
      detail: `${detail}, en ${seconds(gone)}`
    }
  } finally {
    for (const player of players) {
      player.page.close()
      kill(player.child)
    }
  }
}

// Cada pagina se congela 5 s en pleno duelo (el hilo principal ocupado, sin
// latidos ni pasos): primero el invitado, despues el host. Con la ventana de
// silencio de la terminal (3 s) cualquiera de las dos cortaba el duelo.
async function runFreeze() {
  const failures = []
  const code = roomCode()
  const [a, b] = await pair(code, ['Gala', 'Hugo'])
  try {
    await enterDuel(a, b)
    const ids = await Promise.all([a, b].map((p) => p.page.eval(`window.runaGame.room().id`)))
    const [host, guest] = ids[0] < ids[1] ? [a, b] : [b, a]
    const names = new Map([
      [a, 'Gala'],
      [b, 'Hugo']
    ])
    const freeze = (player) =>
      player.page.eval(
        `(() => { const end = performance.now() + 5000; while (performance.now() < end) {} return true })()`
      )
    const both = async () => {
      await sleep(2000)
      const [sa, sb] = await Promise.all([a.page.state(), b.page.state()])
      return !!(sa.live.arena && sb.live.arena)
    }
    await freeze(guest)
    log(`  ${names.get(guest)} (invitado) se congela 5 s`)
    check(await both(), 'el duelo sigue despues de congelarse el invitado', failures)
    await freeze(host)
    log(`  ${names.get(host)} (host) se congela 5 s`)
    check(await both(), 'el duelo sigue despues de congelarse el host', failures)

    // Y sigue andando: el invitado se rinde con R y los dos coinciden.
    await guest.page.press('r')
    await Promise.all(
      [a, b].map((player) =>
        player.page.waitFor(
          `!window.runaPage().live.arena && window.runaPage().map === 'city'`,
          20000,
          'volver a la ciudad'
        )
      )
    )
    const [sa, sb] = await Promise.all([a.page.state(), b.page.state()])
    const hostId = ids[0] < ids[1] ? ids[0] : ids[1]
    check(
      sa.live.lastDuel && sb.live.lastDuel && sa.live.lastDuel.winner === sb.live.lastDuel.winner,
      'las dos paginas coinciden en el ganador',
      failures
    )
    check(
      sa.live.lastDuel && sa.live.lastDuel.winner === hostId,
      'gana el host por la rendicion',
      failures
    )
    return {
      name: 'cada pagina se congela 5 s',
      failures,
      detail: `el duelo sigue y ${names.get(host)} gana cuando ${names.get(guest)} se rinde`
    }
  } finally {
    for (const player of [a, b]) {
      player.page.close()
      kill(player.child)
    }
  }
}

// Un archivo cualquiera del mismo origen. Publicado no sirve una ruta que no
// existe: la pagina 404 de Vercel no deja leer localStorage.
const SAME_ORIGIN = URL_BASE ? '/models.json' : '/state.json'

// Abre otra pestana en el navegador del que se fue y lee su ranura 1.
async function savedGame(player) {
  const target = await fetch(
    `http://127.0.0.1:${player.port}/json/new?${encodeURIComponent(player.origin + SAME_ORIGIN)}`,
    { method: 'PUT' }
  ).then((response) => response.json())
  const page = new Page(player.tag + ' (guardado)', target.webSocketDebuggerUrl)
  await page.ready
  try {
    await page.waitFor(`document.readyState === 'complete'`, 10000, 'otra pestana')
    const text = await page.eval(`localStorage.getItem('runa:fs:/runa/saves/slot-1.json')`)
    return text ? JSON.parse(text) : null
  } finally {
    page.close()
  }
}

// --- Correr ----------------------------------------------------------------------

if (!fs.existsSync(CHROME)) {
  console.error(`No encuentro Chrome en ${CHROME}. Pasalo con --chrome <ruta>.`)
  process.exit(2)
}

if (URL_BASE) log(`juego publicado en ${URL_BASE}`)
else log(`visor y juego desde ${ROOT}`)
const viewer = URL_BASE
  ? { origin: URL_BASE.replace(/\/+$/, ''), child: null }
  : await startViewer()
if (!URL_BASE) log(`visor en ${viewer.origin}`)
const results = []
const runs = [
  ['1', runFight],
  ['2', () => runDeparture('close')],
  ['3', () => runDeparture('kill')],
  ['4', runFreeze]
]
try {
  for (const [id, run] of runs) {
    if (!ONLY.has(id)) continue
    const at = Date.now()
    log(`corrida ${id}`)
    try {
      const result = await run()
      results.push({ id, ...result, time: seconds(at) })
    } catch (error) {
      log(`  ERROR: ${error.message}`)
      results.push({ id, name: 'corrida ' + id, failures: [error.message], time: seconds(at) })
    }
  }
} finally {
  kill(viewer.child)
  // Chrome puede tardar en soltar su perfil: se reintenta y, si no, queda en temp.
  if (!KEEP) {
    try {
      fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    } catch {}
  }
}

console.log('\nColiseo en linea, punta a punta:')
for (const result of results) {
  const ok = result.failures.length === 0
  console.log(
    `  ${ok ? 'ok  ' : 'FALLA'} ${result.id}. ${result.name} (${result.time})${result.detail ? ': ' + result.detail : ''}`
  )
  for (const failure of result.failures) console.log(`        - ${failure}`)
}
const failed = results.filter((result) => result.failures.length).length
console.log(
  failed
    ? `\n${failed} de ${results.length} corridas fallaron`
    : `\n${results.length} de ${results.length} corridas bien`
)
if (KEEP) console.log(`perfiles y partidas en ${WORK}`)
process.exit(failed || !results.length ? 1 : 0)
