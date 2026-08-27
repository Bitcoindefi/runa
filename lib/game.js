/** @typedef {import('pear-interface')} */ /* global Pear, Bare */
'use strict'

/**
 * runa: the game loop.
 *
 * Two layers, and keeping them apart is the whole design. Walking is played
 * with the keyboard and doors activate on contact. Combat advances on explicit
 * input, while the strategy file decides what the character does each turn.
 *
 * bare-tui is Elm-shaped, so everything that happens arrives at `update` as a
 * message and `view` only ever renders. Nothing here does IO inside `view`.
 *
 * A third layer sits on top of walking and is optional in the strongest sense:
 * presence. Other people show up on the same map, they are drawn, and that is
 * all. Nothing about them is saved and nothing about them is agreed on, so
 * there is no state to reconcile and no failure worth recovering from. If the
 * network is missing or breaks, presence turns itself off and the game is the
 * single player game it already was.
 */

const { quit, every, key, textinput } = require('bare-tui')
const fs = require('bare-fs')

const { Walker, MAPS, TILES } = require('./map.js')
const { Player, shops, browse, EQUIPMENT_SLOTS } = require('./shop.js')
const { SLOT_COUNT } = require('./saves.js')
const { Field, Y_SCALE, WORLD_BOSS_PORTAL_CLEARANCE } = require('./field.js')
const { Dungeon } = require('./dungeon.js')
const { BossZone } = require('./boss-zone.js')
const render = require('./render.js')
const { parse } = require('./script.js')
const portraits = require('./portraits.js')
const { ARENA } = require('./world.js')
const { Duel, DuelCombat } = require('./duel.js')
const { WalletSession } = require('./wallet.js')
const CONTENT = require('./content.js')

/**
 * The swarm, if there is one.
 *
 * Required behind a guard because playing alone is the common case, not the
 * degraded one: net.js may not be installed, and it may fail to load when a
 * dependency is missing. Either way this require is the only place that has to
 * know, and everything below is written to work with `Presence` being null.
 */
let Presence = null
try {
  Presence = require('./net.js').Presence || null
} catch {
  Presence = null
}

/**
 * La cadena, si es que hay.
 *
 * Detras del mismo guardia que la presencia y por el mismo motivo: arrastra
 * criptografia empaquetada que en algun build podria no estar. Jugar sin cadena
 * es el caso comun, no el degradado, y todo lo de abajo esta escrito para que
 * `Chain` sea null sin que nada se entere.
 */
let Chain = null
try {
  Chain = require('./stellar.js').Chain || null
} catch {
  Chain = null
}

/** Simulation rate. Rendering follows the same clock; at this size it is cheap. */
const TICK_MS = 1000 / 15

/** World ticks resolved by one deliberate combat input. */
const COMBAT_TURN_TICKS = 6

/** Where the player's strategy lives. */
const SCRIPT_PATH = 'script.txt'

const LEGACY_DEFAULT_SCRIPT = [
  '// tu estrategia. se relee sola mientras peleas.',
  '// probá cambiarla en medio de una pelea y mirá qué pasa.',
  '',
  '?hp < 8',
  ' use potion',
  ':?foe.dist >= 5',
  ' equip crossbow',
  ':',
  ' equip sword',
  ''
].join('\n')

const DEFAULT_SCRIPT = [
  '// tu estrategia. se relee sola mientras peleas.',
  '// el combate usa el arma que equipaste con I.',
  '// agrega "equip ..." solo si queres cambiar a otro objeto que poseas.',
  '',
  '?hp < 8',
  ' use potion',
  ''
].join('\n')

/** Recognise and migrate the strategy shipped before equipped gear won. */
function isLegacyDefaultScript(source) {
  const commands = String(source || '')
    .split(/\r?\n/)
    .map((line) => line.split('//')[0].trim())
    .filter(Boolean)
  const legacyCommands = LEGACY_DEFAULT_SCRIPT.split(/\r?\n/)
    .map((line) => line.split('//')[0].trim())
    .filter(Boolean)
  return JSON.stringify(commands) === JSON.stringify(legacyCommands)
}

/** Shown to other players when nobody picked a name. */
const DEFAULT_NAME = 'viajero'

/**
 * The map announced while the player is off in the field.
 *
 * Presence only ever talks about a map and a position, so leaving town has to
 * be said in that language: announce a map nobody draws and you are off every
 * other player's screen without inventing a message for it.
 */
const AWAY_MAP = 'field'

/** How many arrivals may pile up between two ticks before the oldest drop. */
const QUEUE_MAX = 20

/** Drawn for another player when they do not offer a glyph of their own. */
const OTHER_GLYPH = 'o'

/** Persistent terminal button used to open the controls overlay. */
const CONTROLS_BUTTON = '[? CONTROLES]'
const INVENTORY_BUTTON = '[I INVENTARIO]'
const INVENTORY_CLOSE_BUTTON = '[I / ESC CERRAR]'

function controlsFooter(text) {
  return `${CONTROLS_BUTTON} | ${text}`
}

function gameplayFooter(text) {
  return `${INVENTORY_BUTTON} ${CONTROLS_BUTTON} | ${text}`
}

function inventoryFooter(text) {
  return `${INVENTORY_CLOSE_BUTTON} ${CONTROLS_BUTTON} | ${text}`
}

const REALMS = Object.freeze([
  Object.freeze({ id: 'runa', name: 'RUNA', about: 'reino del alba', mapId: 'city' }),
  Object.freeze({ id: 'nox', name: 'NOX', about: 'reino enemigo', mapId: 'nox' })
])

function normalizeRealm(value) {
  const id = String(value || '').toLowerCase()
  return REALMS.some((realm) => realm.id === id) ? id : 'runa'
}

function realmDefinition(value) {
  const id = normalizeRealm(value)
  return REALMS.find((realm) => realm.id === id) || REALMS[0]
}

/** Repeatable content can join this table without adding another NPC handler. */
const QUESTS = Object.freeze({
  mosquito_hunt: Object.freeze({
    id: 'mosquito_hunt',
    title: 'plaga de mosquitos',
    target: 'mosquito',
    count: 20,
    reward: Object.freeze({ gold: 100, xp: 100 })
  })
})

/**
 * Cut a name down to something a pane can draw.
 *
 * Names come off the wire, which makes them the one string in this file that
 * is not ours. The screen is ASCII only, so anything outside it is dropped
 * rather than replaced: a name of question marks is worse than a short name.
 *
 * @param {string} raw
 * @returns {string}
 */
function cleanName(raw) {
  let out = ''
  for (const ch of String(raw === null || raw === undefined ? '' : raw)) {
    const cp = ch.codePointAt(0)
    if (cp >= 32 && cp <= 126) out += ch
    if (out.length >= 16) break
  }
  out = out.trim()
  return out || DEFAULT_NAME
}

function nameInitial(raw) {
  const match = cleanName(raw).match(/[A-Za-z0-9]/)
  return match ? match[0].toUpperCase() : 'V'
}

function clampNumber(value, lo, hi) {
  const number = Math.floor(Number(value))
  if (!Number.isFinite(number)) return lo
  return number < lo ? lo : number > hi ? hi : number
}

function questState(raw = {}) {
  const out = {}
  for (const quest of Object.values(QUESTS)) {
    const saved = raw && typeof raw[quest.id] === 'object' ? raw[quest.id] : {}
    const status = ['available', 'active', 'completed'].includes(saved.status)
      ? saved.status
      : 'available'
    out[quest.id] = {
      status,
      progress: status === 'completed' ? quest.count : clampNumber(saved.progress, 0, quest.count)
    }
  }
  return out
}

function emptySlots() {
  return Array.from({ length: SLOT_COUNT }, (_, index) => ({
    slot: index + 1,
    empty: true,
    corrupt: false
  }))
}

/**
 * One printable character for another player.
 *
 * Space is excluded on purpose: an actor drawn as a space is an actor that is
 * not drawn at all, and a peer should not be able to make itself invisible.
 *
 * @param {string} [raw]
 * @returns {string}
 */
function cleanGlyph(raw) {
  const ch = String(raw === null || raw === undefined ? '' : raw)[0]
  if (!ch) return OTHER_GLYPH
  const cp = ch.codePointAt(0)
  return cp >= 33 && cp <= 126 ? ch : OTHER_GLYPH
}

/**
 * Read the command line, which under Bare hangs off the Bare global because
 * there is no process to ask.
 *
 * @returns {{ name: string|null, solo: boolean }}
 */
function argFlags() {
  let argv = []
  try {
    argv = (typeof Bare !== 'undefined' && Bare.argv) || []
  } catch {
    argv = []
  }

  let name = null
  let solo = false
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i])
    if (a === '--solo' || a === '--no-presence') solo = true
    else if (a === '--name' && i + 1 < argv.length) name = String(argv[++i])
    else if (a.slice(0, 7) === '--name=') name = a.slice(7)
  }
  return { name, solo }
}

/**
 * A default nobody has to type, with enough tail on it that two people who
 * never picked a name are still two people in the log.
 *
 * @returns {string}
 */
function anonName() {
  const tail = Math.floor(Math.random() * 46656).toString(36)
  return DEFAULT_NAME + '-' + ('000' + tail).slice(-3)
}

const tick = every(TICK_MS, () => ({ type: 'tick' }))

class Runa {
  /**
   * @param {object} [opts]
   * @param {string} [opts.name] - what other players see
   * @param {boolean} [opts.presence] - false plays alone no matter what
   * @param {object} [opts.saves] - persistent slot store
   */
  constructor(opts = {}) {
    this.width = 80
    this.height = 24

    this.walker = new Walker('city')
    this.dungeonReturn = null
    this.castleReturn = null
    this.player = new Player()
    this.field = null
    this.meadowField = null
    this.meadowReturn = null
    this.dungeonState = null
    this.worldBossState = null
    this.duel = null
    this.duelCombat = null
    this.lastDuelResult = null
    this.duelInvite = null
    this.duelNetwork = null
    this.duelMessages = []
    this.shop = null
    this.cursor = 0
    this.inventoryOpen = false
    this.inventoryHome = false
    this.inventoryTab = 'carried'
    this.inventoryCursor = 0
    this.rankingOpen = false
    this.rankingTab = 'level'
    this.controlsOpen = false
    this.animationTick = 0
    this.quests = questState()
    this.title = true
    this.naming = false
    this.nameError = ''
    this.realm = 'runa'
    this.realmCursor = 0
    this.saves = opts.saves || null
    this.slots = emptySlots()
    this.menuPage = 'main'
    this.menuCursor = 0
    this.slotCursor = 0
    this.activeSlot = null
    this.pendingSlot = null
    this.namingReturnPage = 'main'
    this.replacing = ''
    this.menuMessage = ''
    this.saveFailure = ''
    this.wallet = new WalletSession({ signer: opts.walletSigner })
    this.walletOpen = false
    this.walletEditing = false
    this.walletError = ''
    this.walletInput = textinput.create({ value: '', placeholder: 'G...', charLimit: 56 })

    this.log = []
    this.seen = new Set()
    this.encounter = null
    /** What the field rolled for the kill being settled this tick. */
    this.earned = null
    this.pending = null
    this.scriptSource = ''
    this.scriptMtime = 0
    this.scriptErrors = []

    // Presence is built here and started in init(). A constructor that opens a
    // socket is a class that cannot be built in a test, and every test in this
    // repo builds a Runa.
    const args = argFlags()
    const requestedName = opts.name || args.name || ''
    this.requestedName = requestedName
    this.name = cleanName(requestedName || anonName())
    this.nameInput = textinput
      .create({ value: requestedName, placeholder: 'tu nombre', charLimit: 16 })
      .focus()
    this.online = opts.presence !== false && args.solo === false && Presence !== null
    this.presence = null
    this.presenceStarted = false
    this.arrivals = []

    // La semilla del dia. Se pide una sola vez al entrar y no se espera nunca:
    // hasta que llegue, el campo se siembra con lo local.
    this.chain = Chain ? new Chain() : null
    this.daySeed = null
    this.dayNumber = null

    if (this.online) {
      try {
        this.attachPresence(new Presence({ name: this.name }))
      } catch {
        this.dropPresence()
      }
    }

    this.refreshSlots()
    this.loadScript(true)
  }

  // -------------------------------------------------------------------------

  /** Wire all network events through queues owned by the update loop. */
  attachPresence(presence) {
    this.presence = presence
    if (!presence || typeof presence.on !== 'function') return presence
    presence.on('join', (who) => this.noteLater('llego ' + cleanName(who)))
    presence.on('leave', (who) => this.noteLater('se fue ' + cleanName(who)))
    presence.on('duel', (message) => {
      this.duelMessages.push(message)
      if (this.duelMessages.length > QUEUE_MAX) this.duelMessages.shift()
    })
    presence.on('peer-leave', (peer) => {
      this.duelMessages.push({ kind: 'peer-leave', ...peer })
      if (this.duelMessages.length > QUEUE_MAX) this.duelMessages.shift()
    })
    return presence
  }

  /**
   * Read the strategy file if it changed.
   *
   * Polling a stat is deliberate: file watching under Bare is one more thing
   * that can behave differently per platform, and at 15 ticks a second a stat
   * costs nothing. Re-reading on every tick would be the wasteful version.
   *
   * @param {boolean} [force]
   * @returns {boolean} whether it reloaded
   */
  loadScript(force = false) {
    let stat = null
    try {
      stat = fs.statSync(SCRIPT_PATH)
    } catch {
      if (force) {
        try {
          fs.writeFileSync(SCRIPT_PATH, DEFAULT_SCRIPT)
          stat = fs.statSync(SCRIPT_PATH)
        } catch {
          return false
        }
      } else {
        return false
      }
    }

    const mtime = stat.mtimeMs || (stat.mtime && stat.mtime.getTime()) || 0
    if (!force && mtime === this.scriptMtime) return false
    this.scriptMtime = mtime

    try {
      this.scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8')
      if (isLegacyDefaultScript(this.scriptSource)) {
        this.scriptSource = DEFAULT_SCRIPT
        fs.writeFileSync(SCRIPT_PATH, this.scriptSource)
        stat = fs.statSync(SCRIPT_PATH)
        this.scriptMtime = stat.mtimeMs || (stat.mtime && stat.mtime.getTime()) || 0
      }
    } catch {
      return false
    }

    const { errors } = parse(this.scriptSource)
    this.scriptErrors = errors
    if (errors.length) {
      this.say(`script: ${errors[0].message} (linea ${errors[0].line})`)
    } else {
      // Both paths say it now. The guard used to silence exactly the wrong one:
      // the automatic reload nobody asked for announced itself, and pressing
      // `r` on purpose did its work in complete silence, which is
      // indistinguishable from a key that does nothing.
      this.say('script recargado')
    }
    if (this.field) this.field.setScript(this.scriptSource)
    return true
  }

  /**
   * News from the updater, shown as something that happened in the world.
   *
   * An update landing is not maintenance chatter here, it is the premise: the
   * content is data, so a new release can change what lives in the field while
   * someone is already playing.
   *
   * @param {string} text
   */
  world(text) {
    this.say(text)
  }

  /** @param {string} text */
  say(text) {
    this.log.push(text)
    if (this.log.length > 40) this.log.shift()
  }

  // -------------------------------------------------------------------------

  /**
   * Park a line from the swarm until the next tick.
   *
   * Join and leave fire whenever the network feels like it, which includes the
   * middle of a render. `view` has to stay pure, so nothing arriving from
   * outside is allowed to touch the log on the spot: it waits in a queue that
   * the tick drains, where every other mutation in this class already happens.
   *
   * @param {string} text
   */
  noteLater(text) {
    this.arrivals.push(text)
    // Ten people joining at once must not grow a queue without bound.
    if (this.arrivals.length > QUEUE_MAX) this.arrivals.shift()
  }

  /** Move whatever the swarm parked into the log. Called from the tick only. */
  drainArrivals() {
    if (this.arrivals.length === 0) return
    const queued = this.arrivals
    this.arrivals = []
    for (const text of queued) this.say(text)
  }

  /**
   * Join the swarm. Called from init(), never from the constructor.
   *
   * @returns {boolean} whether presence came up
   */
  /**
   * Con que numero se dibuja el campo.
   *
   * Con la semilla del dia si llego, y si no con algo derivado del jugador. Lo
   * segundo no es un capricho: sin eso el campo sale siempre identico, que es
   * justo lo que reporta la issue #3.
   */
  fieldSeed() {
    if (this.daySeed !== null) return this.daySeed
    const xp = this.player ? this.player.xp || 0 : 0
    const gold = this.player ? this.player.gold || 0 : 0
    return (Math.imul(xp + 1, 2654435761) ^ Math.imul(gold + 1, 40503)) >>> 0
  }

  /**
   * Pedirle a la cadena la semilla del dia.
   *
   * No devuelve nada y nadie la espera. El campo de hoy es el mismo para todos
   * los que jueguen hoy, y eso es lo unico que la cadena aporta aca: un numero
   * publico que ningun jugador y ningun dueno puede mover. Si no hay linea, el
   * campo se siembra con lo local y el juego no cambia en nada mas.
   */
  startChain() {
    if (!this.chain || !this.chain.available) return
    this.chain
      .dailySeed()
      .then((d) => {
        if (!d) return
        this.daySeed = d.seed
        this.dayNumber = d.day
        this.noteLater('el campo de hoy es el dia ' + d.day + ', igual para todos')
      })
      .catch(() => {})
  }

  startPresence() {
    if (!this.presence || this.presenceStarted) return this.presenceStarted
    try {
      this.presence.start()
      this.presenceStarted = true
      // Greet first, announce second. If the very first announcement is the
      // thing that fails, its line has to read after the greeting, not before.
      this.say('sos ' + this.name + ', mirando quien mas anda por el pueblo')
      this.announce()
      return true
    } catch {
      this.dropPresence()
      this.say('sin red, caminas solo')
      return false
    }
  }

  /** Leave the swarm. Safe to call on a game that never had one. */
  stopPresence() {
    const p = this.presence
    this.dropPresence()
    if (!p) return
    try {
      p.stop()
    } catch {
      // Leaving is best effort. The process is on its way out either way.
    }
  }

  /**
   * Forget the network and go back to being a single player game.
   *
   * There is nothing to salvage when presence breaks, because presence never
   * held anything: no score, no inventory, no position anyone else needs. So
   * it is dropped whole rather than retried.
   */
  dropPresence() {
    if (this.duelNetwork && this.duel && this.duelCombat) {
      this.duelCombat.surrender(this.duelNetwork.rivalId)
      this.finishDuel('desconexion', { broadcast: false })
    }
    this.presence = null
    this.presenceStarted = false
    this.online = false
    this.arrivals = []
  }

  /**
   * Say where we are, if anyone is listening.
   *
   * Sent after something moves the walker rather than on every tick: the
   * position only changes on a key, and repeating it fifteen times a second is
   * traffic that carries no news.
   */
  announce() {
    if (!this.presence || !this.presenceStarted) return
    // Walking out of town has to take the player off everyone else's map, and
    // the only thing presence knows about is the map you are standing on.
    const mapId = this.field ? AWAY_MAP : this.walker.mapId
    try {
      const stats = this.player.snapshot()
      this.presence.update(mapId, this.walker.x, this.walker.y, {
        level: stats.level,
        wins: (stats.pvp && stats.pvp.wins) || 0,
        losses: (stats.pvp && stats.pvp.losses) || 0
      })
    } catch {
      this.dropPresence()
      this.say('se corto la red, seguis solo')
    }
  }

  /**
   * The other players standing on the map about to be drawn.
   *
   * Called from `view`, so it reads and does nothing else: it does not start,
   * stop or repair anything, and a bad read is an empty town for one frame,
   * which is what a single player sees anyway. Everything is checked again
   * here because these coordinates came off the wire and land in a pane.
   *
   * @param {string} mapId
   * @returns {Array<{x: number, y: number, glyph: string, name: string}>}
   */
  others(mapId) {
    if (!this.presence) return []

    let list = null
    try {
      list = this.presence.others(mapId)
    } catch {
      return []
    }

    const out = []
    for (const o of list || []) {
      if (!o) continue
      const x = Math.round(Number(o.x))
      const y = Math.round(Number(o.y))
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      out.push({
        id: String(o.id || ''),
        x,
        y,
        glyph: cleanGlyph(o.glyph),
        name: cleanName(o.name),
        level: clampNumber(o.level, 1, 999),
        wins: clampNumber(o.wins, 0, 0x7fffffff),
        losses: clampNumber(o.losses, 0, 0x7fffffff)
      })
    }
    return out
  }

  /** Static resident occupying one logical city tile. */
  npcAt(x, y) {
    if (this.field) return null
    const map = MAPS[this.walker.mapId]
    for (const npc of (map && map.npcs) || []) {
      if (npc.x === x && npc.y === y) return npc
    }
    return null
  }

  /** Nearest resident available for an `e` interaction. */
  nearbyNpc(range = 1) {
    if (this.field) return null
    const map = MAPS[this.walker.mapId]
    let nearest = null
    let best = Infinity
    for (const npc of (map && map.npcs) || []) {
      const distance = Math.max(Math.abs(npc.x - this.walker.x), Math.abs(npc.y - this.walker.y))
      if (distance > range || distance >= best) continue
      nearest = npc
      best = distance
    }
    return nearest
  }

  nearbyLandmark(range = 1) {
    if (this.field) return null
    const map = MAPS[this.walker.mapId]
    for (const landmark of (map && map.landmarks) || []) {
      const b = landmark.bounds
      const dx = Math.max(b.x1 - this.walker.x, 0, this.walker.x - b.x2)
      const dy = Math.max(b.y1 - this.walker.y, 0, this.walker.y - b.y2)
      if (Math.max(dx, dy) <= range) return landmark
    }
    return null
  }

  openRanking() {
    this.rankingOpen = true
    this.rankingTab = 'level'
    return true
  }

  rankingEntries() {
    const entries = new Map()
    for (const slot of this.slots || []) {
      if (!slot || slot.empty || slot.corrupt) continue
      entries.set('slot:' + slot.slot, {
        id: 'slot:' + slot.slot,
        name: cleanName(slot.name),
        level: clampNumber(slot.level, 1, 999),
        wins: clampNumber(slot.pvp && slot.pvp.wins, 0, 0x7fffffff),
        losses: clampNumber(slot.pvp && slot.pvp.losses, 0, 0x7fffffff),
        source: 'local'
      })
    }
    const current = this.player.snapshot()
    entries.set('slot:' + (this.activeSlot || 'current'), {
      id: 'slot:' + (this.activeSlot || 'current'),
      name: this.name,
      level: current.level,
      wins: current.pvp.wins,
      losses: current.pvp.losses,
      source: 'vos'
    })
    for (const peer of this.others()) {
      entries.set('peer:' + peer.id, { ...peer, source: 'online' })
    }
    return [...entries.values()]
  }

  /** Talk to a resident, then perform the service their role provides. */
  interactNpc(npc) {
    if (!npc) return false
    this.say(`${npc.name}, ${npc.role}: ${npc.line}`)
    const action = npc.action
    if (!action) return true

    if (action.kind === 'shop') {
      const s = shops[action.shop]
      if (!s) return true
      this.shop = action.shop
      this.cursor = 0
      return true
    }
    if (action.kind === 'church') {
      this.player.hp = this.player.maxHp
      this.say('hermana Alma cura todas tus heridas')
      return true
    }
    if (action.kind === 'tavern') {
      this.restAtTavern()
      return true
    }
    if (action.kind === 'quest') return this.handleQuest(action.quest, npc.name)
    return true
  }

  handleQuest(id, giver = 'el caballero') {
    const quest = QUESTS[id]
    const state = this.quests[id]
    if (!quest || !state) return false

    if (state.status === 'available') {
      state.status = 'active'
      state.progress = 0
      this.say(`mision aceptada: elimina ${quest.count} mosquitos (0/${quest.count})`)
      return true
    }
    if (state.status === 'completed') {
      this.say(`${giver}: ya cumpliste la mision de los mosquitos`)
      return true
    }
    if (state.progress < quest.count) {
      this.say(`${giver}: llevas ${state.progress}/${quest.count} mosquitos`)
      return true
    }

    this.player.gainGold(quest.reward.gold)
    const up = this.player.gainXp(quest.reward.xp)
    state.status = 'completed'
    this.say(`mision completada: +${quest.reward.gold} oro, +${quest.reward.xp} exp`)
    if (up.levels > 0) this.say('subiste a nivel ' + this.player.snapshot().level)
    return true
  }

  recordQuestKill(kind) {
    for (const quest of Object.values(QUESTS)) {
      const state = this.quests[quest.id]
      if (!state || state.status !== 'active' || kind !== quest.target) continue
      if (state.progress >= quest.count) continue
      state.progress++
      if (state.progress === quest.count) {
        this.say(
          `mision lista: vuelve con el caballero de la plaza (${quest.count}/${quest.count})`
        )
      } else if (state.progress === 1 || state.progress % 5 === 0) {
        this.say(`mision ${quest.title}: ${state.progress}/${quest.count}`)
      }
    }
  }

  /** The tavern is a small, explicit gold sink and a full heal. */
  restAtTavern() {
    const price = 3
    if (this.player.hp >= this.player.maxHp) {
      this.say('Bruno: ya estas descansado')
      return false
    }
    if (this.player.gold < price) {
      this.say(`Bruno: necesitas ${price} monedas para una cama`)
      return false
    }
    this.player.gold -= price
    this.player.hp = this.player.maxHp
    this.say(`descansas en la taberna por ${price} monedas`)
    return true
  }

  /**
   * Handle the field's structured events. These are control signals, not text:
   * the prose lives in the field's own news feed and is pulled separately, so
   * one loud fight does not drown the log in duplicated lines.
   * @param {object[]} events
   */
  drain(events) {
    for (const e of events || []) {
      if (!e || !e.type) continue
      switch (e.type) {
        case 'town':
          this.field = null
          this.meadowField = null
          this.meadowReturn = null
          this.dungeonState = null
          this.walker.travel('city')
          this.announce()
          this.say('volves a la ciudad')
          break
        case 'nox':
          if (!this.field || this.field.mode !== 'field') break
          this.field = null
          this.meadowField = null
          this.meadowReturn = null
          this.dungeonState = null
          this.walker.travel('nox')
          this.announce()
          this.say('atravesas el porton oriental y entras al reino oscuro de NOX')
          break
        case 'dungeon-enter':
          if (!this.field || this.field.mode === 'dungeon') break
          this.meadowField = this.field
          this.meadowReturn = {
            x: Math.max(1, this.field.dungeonEntrance.x - 3),
            y: this.field.dungeonEntrance.y
          }
          this.dungeonState = null
          this.openDungeonFloor(1, 'down')
          this.say('cruzas la entrada de piedra y bajas al nivel 1 de la mazmorra')
          break
        case 'dungeon-floor':
          this.openDungeonFloor(e.floor, e.direction)
          this.say(
            e.direction === 'up'
              ? `subis a la mazmorra nivel ${e.floor}`
              : `bajas a la mazmorra nivel ${e.floor}`
          )
          break
        case 'dungeon-exit': {
          const back = this.meadowReturn
          const restored =
            this.meadowField ||
            new Field({ player: this.player, seed: this.fieldSeed(), script: this.scriptSource })
          restored.player.hp = this.player.hp
          restored.player.maxhp = this.player.maxHp
          restored.player.potions = this.player.potions
          restored.player.x = back ? back.x : Math.max(1, restored.dungeonEntrance.x - 3)
          restored.player.y = back ? back.y : restored.dungeonEntrance.y
          this.field = restored
          this.meadowField = null
          this.meadowReturn = null
          this.dungeonState = null
          this.seen = new Set()
          this.say('salis de la cripta y volves a la pradera')
          break
        }
        case 'boss-enter':
          if (!this.field || this.field.mode !== 'field') break
          this.meadowField = this.field
          this.meadowReturn = {
            x: Math.max(1, this.field.worldBossPortal.x - WORLD_BOSS_PORTAL_CLEARANCE + 1),
            y: this.field.worldBossPortal.y
          }
          this.field = new BossZone({
            player: this.player,
            script: this.scriptSource,
            seed: this.fieldSeed(),
            state: this.worldBossState
          })
          this.seen = new Set()
          this.say('el portal te lleva a las ruinas volcanicas del Coloso')
          break
        case 'boss-exit': {
          this.worldBossState = this.field && this.field.toJSON ? this.field.toJSON() : null
          const back = this.meadowReturn
          const restored =
            this.meadowField ||
            new Field({ player: this.player, seed: this.fieldSeed(), script: this.scriptSource })
          restored.player.hp = this.player.hp
          restored.player.maxhp = this.player.maxHp
          restored.player.potions = this.player.potions
          restored.player.x = back
            ? back.x
            : Math.max(1, restored.worldBossPortal.x - WORLD_BOSS_PORTAL_CLEARANCE + 1)
          restored.player.y = back ? back.y : restored.worldBossPortal.y
          this.field = restored
          this.meadowField = null
          this.meadowReturn = null
          this.seen = new Set()
          this.say('atravesas el portal y reapareces en el yermo')
          break
        }
        case 'busy':
          this.say('estas en contacto: pulsa f, espacio o avanza contra el monstruo')
          break
        case 'win':
          // Hold the roll the field made so settle() can bank that exact
          // number. The event arrives on the same tick the fight ends, just
          // before the settling below, so it is always the right kill.
          this.earned = { gold: e.gold, xp: e.xp, kind: e.kind }
          break
        case 'boss-hit':
          this.player.hp = e.hp
          if (e.text) this.say(e.text)
          break
        case 'boss-damaged':
          this.say(`golpeas al Coloso: -${e.damage} (${e.hp}/${e.maxhp})`)
          break
        case 'boss-win': {
          this.player.gainGold(e.gold)
          const up = this.player.gainXp(e.xp)
          if (this.field) {
            this.field.player.hp = this.player.hp
            this.field.player.maxhp = this.player.maxHp
          }
          this.say(e.text || 'el Coloso cae')
          this.say(`recompensa mundial: +${e.gold} oro, +${e.xp} exp`)
          if (up.levels > 0) this.say('subiste a nivel ' + this.player.snapshot().level)
          break
        }
        case 'boss-death':
          this.worldBossState = this.field && this.field.toJSON ? this.field.toJSON() : null
          this.player.hp = 0
          this.player.die()
          this.say(e.text || 'el Coloso te derriba')
          this.say('te despertas en la iglesia')
          this.wakeInChurch()
          this.field = null
          this.meadowField = null
          this.meadowReturn = null
          this.dungeonState = null
          this.announce()
          break
        default:
          if (e.text) this.say(e.text)
      }
    }
  }

  /**
   * Copy anything new out of the field's news feed.
   *
   * Tracked by index rather than by clearing the feed, because the field owns
   * it and other views read it too. Re-reading from a mark is the only way to
   * take each line exactly once without mutating something that is not ours.
   */
  drainNews() {
    if (!this.field) return
    const news = this.field.snapshot().news || []
    for (const n of news) {
      const stamp = (n.time || 0) + ':' + (n.text || '')
      if (this.seen.has(stamp)) continue
      this.seen.add(stamp)
      this.say(n.text)
    }
    if (this.seen.size > 300) this.seen = new Set([...this.seen].slice(-150))
  }

  // -------------------------------------------------------------------------

  refreshSlots() {
    if (!this.saves || typeof this.saves.list !== 'function') {
      this.slots = emptySlots()
      if (this.title && this.menuPage === 'main') this.menuCursor = 1
      return this.slots
    }

    try {
      const found = this.saves.list()
      this.slots = emptySlots().map((fallback, index) => {
        const slot = Array.isArray(found) ? found[index] : null
        return slot && slot.slot === index + 1 ? slot : fallback
      })
      this.menuMessage = ''
    } catch (err) {
      this.slots = emptySlots()
      this.menuMessage = `no se pudieron leer las partidas: ${err.message}`
    }
    if (this.title && this.menuPage === 'main') {
      this.menuCursor = this.playableSlots().length > 0 ? 0 : 1
    }
    return this.slots
  }

  playableSlots() {
    return this.slots.filter((slot) => slot && !slot.empty && !slot.corrupt)
  }

  latestSlot() {
    const playable = this.playableSlots()
    if (playable.length === 0) return null
    return playable
      .slice()
      .sort((a, b) => String(b.savedAt || '').localeCompare(a.savedAt || ''))[0]
  }

  firstEmptySlot() {
    return this.slots.find((slot) => slot && slot.empty) || null
  }

  selectedSlot() {
    return this.slots[this.slotCursor] || this.slots[0]
  }

  beginNewFromMenu() {
    const empty = this.firstEmptySlot()
    if (empty) {
      this.slotCursor = empty.slot - 1
      this.startNaming(empty.slot)
      return true
    }

    this.menuPage = 'slots'
    this.slotCursor = 0
    this.menuMessage = 'las tres ranuras estan ocupadas: elegi cual reemplazar con N'
    return false
  }

  activateMainMenu() {
    switch (this.menuCursor) {
      case 0: {
        const latest = this.latestSlot()
        if (latest) return this.loadSlot(latest.slot)
        this.menuMessage = 'todavia no hay una partida para continuar'
        return false
      }
      case 1:
        return this.beginNewFromMenu()
      case 2:
        if (this.playableSlots().length === 0) {
          this.menuMessage = 'todavia no hay partidas guardadas'
          return false
        }
        this.menuPage = 'slots'
        this.slotCursor = Math.max(0, (this.latestSlot() || { slot: 1 }).slot - 1)
        this.menuMessage = ''
        return true
      case 3:
        this.controlsOpen = true
        return true
      default:
        this.stopPresence()
        return quit
    }
  }

  startNaming(slot = this.slotCursor + 1) {
    this.namingReturnPage = this.menuPage
    this.pendingSlot = clampNumber(slot, 1, SLOT_COUNT)
    const selected = this.slots[this.pendingSlot - 1]
    this.replacing = selected && !selected.empty ? selected.name || `ranura ${slot}` : ''
    const suggested = this.requestedName || ''
    this.requestedName = ''
    this.nameInput = textinput
      .create({ value: suggested, placeholder: 'tu nombre', charLimit: 16 })
      .focus()
    this.naming = true
    this.nameError = ''
    this.realmCursor = 0
    this.menuMessage = ''
  }

  saveState() {
    const player = this.player.toJSON()
    const combat = this.field && this.field.combat && this.field.combat.world
    if (combat) {
      player.hp = Math.max(0, Math.ceil(Number(combat.hero.hp) || 0))
      player.potions = Math.max(0, Math.floor(Number(combat.potions) || 0))
    }

    let location = null
    let place = 'ciudad'
    if (this.field) {
      const field = this.field.snapshot()
      location =
        field.mode === 'boss'
          ? {
              kind: 'boss',
              x: field.player.x,
              y: field.player.y,
              state: this.field.toJSON(),
              meadowReturn: this.meadowReturn ? { ...this.meadowReturn } : null
            }
          : field.mode === 'dungeon'
            ? {
                kind: 'dungeon',
                floor: field.floor,
                x: field.player.x,
                y: field.player.y,
                state: this.field.toJSON(),
                meadowReturn: this.meadowReturn ? { ...this.meadowReturn } : null
              }
            : {
                kind: 'field',
                x: field.player.x,
                y: field.player.y
              }
      place = field.zone || 'pradera'
    } else if (this.duel && this.duel.active && this.duel.from) {
      // An autosave during PvP must never reload into an orphaned session.
      // The duel itself is ephemeral; the safe persistent location is the one
      // captured before entering the Coliseum.
      const from = this.duel.from
      const map = MAPS[from.mapId] || MAPS.city
      location = {
        kind: 'map',
        mapId: map.id,
        x: from.x,
        y: from.y
      }
      place = map.name || map.id
    } else {
      const map = MAPS[this.walker.mapId] || MAPS.city
      location = {
        kind: 'map',
        mapId: map.id,
        x: this.walker.x,
        y: this.walker.y
      }
      place = map.name || map.id
    }

    return {
      name: this.name,
      realm: this.realm,
      wallet: this.wallet.toJSON(),
      player,
      location,
      dungeonReturn: this.dungeonReturn ? { ...this.dungeonReturn } : null,
      castleReturn: this.castleReturn ? { ...this.castleReturn } : null,
      worldBossState:
        this.field && this.field.mode === 'boss' ? this.field.toJSON() : this.worldBossState,
      quests: questState(this.quests),
      summary: {
        level: this.player.snapshot().level,
        pvp: { ...this.player.snapshot().pvp },
        realm: this.realm,
        place
      }
    }
  }

  saveCurrent() {
    if (!this.saves || !this.activeSlot || this.title) return false
    try {
      const saved = this.saves.save(this.activeSlot, this.saveState())
      this.slots[this.activeSlot - 1] = saved
      this.saveFailure = ''
      return true
    } catch (err) {
      const message = `no se pudo guardar la ranura ${this.activeSlot}: ${err.message}`
      if (message !== this.saveFailure) this.say(message)
      this.saveFailure = message
      return false
    }
  }

  loadSlot(slot = this.slotCursor + 1) {
    if (!this.saves || typeof this.saves.load !== 'function') return false
    const number = clampNumber(slot, 1, SLOT_COUNT)

    try {
      const saved = this.saves.load(number)
      const location = saved.location || {}
      this.name = cleanName(saved.name)
      this.realm = normalizeRealm(saved.realm || (saved.summary && saved.summary.realm))
      this.realmCursor = Math.max(
        0,
        REALMS.findIndex((realm) => realm.id === this.realm)
      )
      this.player = Player.fromJSON(saved.player)
      this.walker = new Walker(realmDefinition(this.realm).mapId)
      this.dungeonReturn = saved.dungeonReturn || null
      this.castleReturn = saved.castleReturn || null
      this.field = null
      this.meadowField = null
      this.meadowReturn = null
      this.dungeonState = null
      this.worldBossState = saved.worldBossState || null
      this.duel = null
      this.duelCombat = null
      this.lastDuelResult = null
      this.duelInvite = null
      this.duelNetwork = null
      this.duelMessages = []
      this.shop = null
      this.cursor = 0
      this.inventoryOpen = false
      this.inventoryHome = false
      this.inventoryTab = 'carried'
      this.inventoryCursor = 0
      this.rankingOpen = false
      this.rankingTab = 'level'
      this.quests = questState(saved.quests)
      this.log = []
      this.seen = new Set()
      this.encounter = null
      this.earned = null
      this.pending = null
      this.wallet = new WalletSession({
        address: saved.wallet && saved.wallet.address,
        signer: this.wallet.signer
      })
      this.walletOpen = false
      this.walletEditing = false
      this.walletError = ''

      if (location.kind === 'boss') {
        this.field = new BossZone({
          script: this.scriptSource,
          player: this.player,
          seed: this.fieldSeed(),
          state: location.state,
          x: location.x,
          y: location.y
        })
        this.worldBossState = this.field.toJSON()
        this.meadowReturn = location.meadowReturn || null
      } else if (location.kind === 'dungeon') {
        this.field = new Dungeon({
          floor: location.floor,
          script: this.scriptSource,
          player: this.player,
          seed: this.fieldSeed(),
          state: location.state,
          x: location.x,
          y: location.y
        })
        this.dungeonState = this.field.state
        this.meadowReturn = location.meadowReturn || null
      } else if (location.kind === 'field') {
        this.field = new Field({
          script: this.scriptSource,
          player: this.player,
          seed: this.fieldSeed()
        })
        this.field.player.x = clampNumber(location.x, 0, this.field.width - 1)
        this.field.player.y = clampNumber(location.y, 0, this.field.height - 1)
      } else {
        const fallbackMap = realmDefinition(this.realm).mapId
        const mapId = MAPS[location.mapId] ? location.mapId : fallbackMap
        this.walker = new Walker(mapId)
        const map = MAPS[mapId]
        const x = clampNumber(location.x, 0, map.width - 1)
        const y = clampNumber(location.y, 0, map.height - 1)
        const tile = TILES[map.rows[y][x]]
        if (!tile || !tile.solid) this.walker.placeAt(mapId, x, y)
      }

      this.activeSlot = number
      this.pendingSlot = null
      this.replacing = ''
      this.title = false
      this.naming = false
      this.nameError = ''
      this.menuMessage = ''

      if (this.online && Presence) {
        try {
          this.attachPresence(new Presence({ name: this.name }))
        } catch {
          this.dropPresence()
        }
      }

      this.say(`partida ${number} cargada. bienvenido otra vez, ${this.name}.`)
      this.startPresence()
      this.startChain()
      this.announce()
      return true
    } catch (err) {
      const message = `no se pudo cargar la ranura ${number}: ${err.message}`
      this.refreshSlots()
      this.menuMessage = message
      return false
    }
  }

  init() {
    // `s` walks down. It was in this line for a while promising to open the
    // script, which is the one key the sentence had no business naming: the
    // player pressed it, walked a step, and learned the game lies about itself
    // before touching anything else.
    return tick
  }

  beginNewGame() {
    const typed = String(this.nameInput.value || '').trim()
    if (!typed) {
      this.nameError = 'escribi un nombre para comenzar'
      return false
    }

    this.name = cleanName(typed)
    this.realmCursor = clampNumber(this.realmCursor, 0, REALMS.length - 1)
    this.realm = REALMS[this.realmCursor].id
    this.activeSlot = this.pendingSlot || this.slotCursor + 1
    this.player = new Player()
    this.walker = new Walker(REALMS[this.realmCursor].mapId)
    this.dungeonReturn = null
    this.castleReturn = null
    this.quests = questState()
    this.field = null
    this.meadowField = null
    this.meadowReturn = null
    this.dungeonState = null
    this.worldBossState = null
    this.shop = null
    this.cursor = 0
    this.inventoryOpen = false
    this.inventoryHome = false
    this.inventoryTab = 'carried'
    this.inventoryCursor = 0
    this.log = []
    this.seen = new Set()
    this.encounter = null
    this.earned = null
    this.pending = null
    this.duel = null
    this.duelCombat = null
    this.duelInvite = null
    this.duelNetwork = null
    this.duelMessages = []
    this.wallet = new WalletSession({ signer: this.wallet.signer })
    this.walletOpen = false
    this.walletEditing = false
    this.walletError = ''
    this.title = false
    this.naming = false
    this.nameError = ''
    this.pendingSlot = null
    this.replacing = ''
    this.menuMessage = ''

    // Presence has not started while the menu is open, so it is safe to build
    // it again with the name the player actually chose.
    if (this.online && Presence) {
      try {
        this.attachPresence(new Presence({ name: this.name }))
      } catch {
        this.dropPresence()
      }
    }

    const frontierHint =
      this.realm === 'nox'
        ? 'la frontera hacia RUNA queda al oeste.'
        : 'la frontera hacia el reino enemigo de NOX queda al este.'
    this.say(
      `bienvenido, ${this.name} de ${REALMS[this.realmCursor].name}. usa wasd o flechas; ${frontierHint}`
    )
    this.startPresence()
    this.saveCurrent()
    return true
  }

  update(msg) {
    switch (msg.type) {
      case 'resize':
        this.width = msg.width
        this.height = msg.height
        return [this, null]

      case 'tick':
        this.onTick()
        return [this, tick]

      case 'key': {
        const command = this.onKey(msg)
        if (!this.title) this.saveCurrent()
        return [this, command]
      }

      default:
        return [this, null]
    }
  }

  onTick() {
    this.animationTick = (this.animationTick + 1) % 0x7fffffff
    // Whatever the swarm said since the last tick becomes log now, on the
    // update side of the loop, where writing to the log is allowed.
    this.drainArrivals()
    this.processDuelMessages()

    // The strategy is re-read while a fight is running, which is the point: the
    // player fixes a rule and sees it take effect without restarting anything.
    this.loadScript(false)

    // PvP cooldowns share the visible game clock, but attacks never happen by
    // themselves: every damaging action still comes from an ordered input.
    if (this.duel && this.duel.active && this.duelCombat) {
      if (!this.duelNetwork) this.duelCombat.tick()
      else if (this.presence && this.duelNetwork.hostId === this.presence.id) {
        this.authorizeDuelStep(this.duel.self, { tick: true })
      }
    }

    // Exploration keeps moving on the clock. Combat does not: once a fight
    // exists it remains frozen until the player asks to resolve another turn.
    if (this.field && !this.field.combat) this.stepField()
  }

  /**
   * Advance the field once and settle either edge of a fight.
   *
   * Exploration calls this from the clock. Manual combat calls it from a key,
   * which keeps one settlement path for rewards, death and encounter setup.
   */
  stepField() {
    if (!this.field) return

    // The field keeps its own bookkeeping for the excursion; the persistent
    // sheet is this.player. outfit() pushes the sheet into a fight as it
    // starts and settle() banks the result when it ends, so gold, xp and death
    // all land on the one object that survives the walk home.
    const wasFighting = !!this.field.combat
    this.drain(this.field.tick())
    this.drainNews()
    this.syncCombat(wasFighting)
  }

  /** Prepare or settle a combat transition, regardless of what triggered it. */
  syncCombat(wasFighting) {
    const nowFighting = !!(this.field && this.field.combat)
    if (!wasFighting && nowFighting) {
      // There is no encounter card or arena transition. Outfit the simulation
      // behind the same field frame, then wait for a deliberate attack input.
      this.player.outfit(this.field.combat.world)
      this.pending = this.field.combat.world
    } else if (wasFighting && !nowFighting && this.pending) {
      // `earned` no longer decides the payout, only which foe the line names.
      const earned = this.earned
      const res = this.player.settle(this.pending)
      this.pending = null
      this.earned = null
      this.encounter = null
      if (res.settled && res.won) {
        const def = (earned && CONTENT.foes[earned.kind]) || {}
        if (earned) this.recordQuestKill(earned.kind)
        this.say(
          'cae el ' + (def.name || 'enemigo') + ': +' + res.gold + ' oro, +' + res.xp + ' exp'
        )
        if (res.levels > 0) this.say('subiste a nivel ' + this.player.snapshot().level)
      } else if (res.settled) {
        this.say('caiste. te despertas en la iglesia.')
        this.wakeInChurch()
        this.field = null
        this.meadowField = null
        this.meadowReturn = null
        this.dungeonState = null
        this.announce()
      }
    }
  }

  /** Resolve one visible attack exchange on the field. */
  advanceCombat() {
    if (!this.field || !this.field.combat) return false

    this.loadScript(false)
    for (let i = 0; i < COMBAT_TURN_TICKS && this.field && this.field.combat; i++) {
      this.stepField()
    }
    return true
  }

  /** Equipment-derived stats shared by the field and Coliseum rules. */
  duelStats(snapshot = this.player.snapshot()) {
    const equipped = snapshot.equipped || {}
    const items = Object.values(equipped)
      .map((id) => CONTENT.items[id])
      .filter(Boolean)
    let atk = 1
    let defense = 0
    let reach = 1
    let cooldown = 30
    for (const item of items) {
      atk += item.atk || 0
      defense += item.defense || 0
      reach = Math.max(reach, item.reach || 0)
      if (item.cooldown) cooldown = item.cooldown
    }
    return {
      hp: snapshot.hp,
      maxHp: snapshot.maxhp,
      atk,
      defense,
      reach,
      cooldown,
      items: items.map((item) => item.id)
    }
  }

  nearbyPlayer(range = 2) {
    if (this.field || !this.presence) return null
    let nearest = null
    let best = Infinity
    for (const peer of this.others(this.walker.mapId)) {
      if (!peer.id) continue
      const distance = Math.max(Math.abs(peer.x - this.walker.x), Math.abs(peer.y - this.walker.y))
      if (distance > range || distance >= best) continue
      nearest = peer
      best = distance
    }
    return nearest
  }

  challengePlayer(peer = this.nearbyPlayer()) {
    if (!peer || !peer.id || !this.presence || typeof this.presence.sendDuel !== 'function') {
      this.say('acercate a otro jugador para desafiarlo')
      return false
    }
    if (this.duelInvite || (this.duel && this.duel.active)) return false
    const duelId = [this.presence.id, peer.id, Date.now().toString(36)].join(':')
    if (!this.presence.sendDuel('challenge', peer.id, { duelId, stats: this.duelStats() })) {
      this.say('el desafio no pudo salir por la red')
      return false
    }
    this.duelInvite = { direction: 'out', duelId, peerId: peer.id, name: peer.name }
    this.say(`desafiaste a ${peer.name}; esperando respuesta`)
    return true
  }

  answerDuel(accept) {
    const invite = this.duelInvite
    if (!invite || invite.direction !== 'in' || !this.presence) return false
    if (!accept) {
      this.presence.sendDuel('decline', invite.peerId, {
        duelId: invite.duelId,
        reason: 'rechazado'
      })
      this.say(`rechazaste el duelo de ${invite.name}`)
      this.duelInvite = null
      return true
    }
    this.presence.sendDuel('accept', invite.peerId, {
      duelId: invite.duelId,
      stats: this.duelStats()
    })
    const started = this.startNetworkDuel(invite, invite.stats)
    this.duelInvite = null
    return !!started
  }

  startNetworkDuel(invite, rivalStats) {
    const selfId = this.presence && this.presence.id
    if (!selfId || !invite || !invite.peerId) return false
    const started = this.startDuel(
      { id: invite.peerId, name: invite.name },
      { selfId, rivalId: invite.peerId, rivalStats }
    )
    if (!started) return false
    this.duelNetwork = {
      duelId: invite.duelId,
      rivalId: invite.peerId,
      rivalName: invite.name,
      hostId: [selfId, invite.peerId].sort()[0],
      localSeq: 0,
      remoteSeq: 0,
      nextOrder: 0,
      expectedOrder: 1
    }
    return started
  }

  processDuelMessages() {
    if (!this.duelMessages.length) return
    const messages = this.duelMessages
    this.duelMessages = []
    for (const message of messages) this.handleDuelMessage(message)
  }

  handleDuelMessage(message) {
    if (!message || !message.kind) return false
    if (message.kind === 'peer-leave') {
      if (this.duelInvite && this.duelInvite.peerId === message.id) {
        this.say(`${cleanName(message.name)} se desconecto antes del duelo`)
        this.duelInvite = null
      }
      if (this.duelNetwork && this.duelNetwork.rivalId === message.id && this.duelCombat) {
        this.duelCombat.surrender(message.id)
        this.finishDuel('desconexion', { broadcast: false })
      }
      return true
    }

    if (message.kind === 'challenge') {
      if (this.field || this.shop || this.duel || this.duelInvite) {
        this.presence.sendDuel('decline', message.from, {
          duelId: message.duelId,
          reason: 'ocupado'
        })
        return false
      }
      const peer = this.others(this.walker.mapId).find((candidate) => candidate.id === message.from)
      if (!peer) return false
      this.duelInvite = {
        direction: 'in',
        duelId: message.duelId,
        peerId: message.from,
        name: message.fromName,
        stats: message.stats
      }
      this.say(`${message.fromName} te desafia: enter acepta, n rechaza`)
      return true
    }

    const invite = this.duelInvite
    if (message.kind === 'accept') {
      if (
        !invite ||
        invite.direction !== 'out' ||
        invite.duelId !== message.duelId ||
        invite.peerId !== message.from
      ) {
        return false
      }
      const started = this.startNetworkDuel(invite, message.stats)
      this.duelInvite = null
      return !!started
    }
    if (message.kind === 'decline') {
      if (!invite || invite.duelId !== message.duelId || invite.peerId !== message.from) {
        return false
      }
      this.say(`${invite.name} no acepto el duelo`)
      this.duelInvite = null
      return true
    }

    const network = this.duelNetwork
    if (!network || network.duelId !== message.duelId || network.rivalId !== message.from) {
      return false
    }
    if (message.kind === 'intent') {
      if (network.hostId !== this.presence.id || message.seq <= network.remoteSeq) return false
      network.remoteSeq = message.seq
      return this.authorizeDuelStep(message.from, message.input)
    }
    if (message.kind === 'step') {
      if (message.from !== network.hostId || network.hostId === this.presence.id) return false
      if (message.order !== network.expectedOrder) return false
      network.expectedOrder++
      this.duelInput(message.actor, message.input)
      return true
    }
    return false
  }

  authorizeDuelStep(actor, input) {
    const network = this.duelNetwork
    if (!network || !this.presence || network.hostId !== this.presence.id) return false
    const order = ++network.nextOrder
    const duelId = network.duelId
    const rivalId = network.rivalId
    this.duelInput(actor, input)
    this.presence.sendDuel('step', rivalId, { duelId, order, actor, input })
    return true
  }

  sendDuelInput(input) {
    const network = this.duelNetwork
    if (!network || !this.presence) return this.duelInput(this.duel.self, input)
    if (network.hostId === this.presence.id) return this.authorizeDuelStep(this.duel.self, input)
    return this.presence.sendDuel('intent', network.rivalId, {
      duelId: network.duelId,
      seq: ++network.localSeq,
      input
    })
  }

  /**
   * Enter a duel accepted by the multiplayer/contract layer.
   *
   * This deliberately takes plain ids and stat snapshots. Network negotiation
   * and Soroban settlement can call it without becoming part of rendering or
   * persistent save data.
   */
  startDuel(rival, options = {}) {
    if (this.title || this.field || this.shop || (this.duel && this.duel.active)) return false
    const rivalName = cleanName(rival && rival.name ? rival.name : rival)
    const selfId = String(options.selfId || (this.presence && this.presence.id) || this.name)
    let rivalId = String(options.rivalId || (rival && rival.id) || rivalName)
    if (rivalId === selfId) rivalId += ':rival'

    const session = new Duel({ arena: MAPS.coliseum, self: selfId, rival: rivalId })
    const from = { mapId: this.walker.mapId, x: this.walker.x, y: this.walker.y }
    const spawn = session.begin(from)
    const selfStats = this.duelStats()
    const combat = new DuelCombat({
      session,
      selfStats,
      rivalStats: options.rivalStats || selfStats
    })

    this.duel = session
    this.duelCombat = combat
    this.duelNames = { [selfId]: this.name, [rivalId]: rivalName }
    this.lastDuelResult = null
    this.walker.placeAt(spawn.mapId, spawn.x, spawn.y)
    this.say(`duelo contra ${rivalName}: acercate, mira tu alcance y ataca con f`)
    this.announce()
    return combat.snapshot(selfId)
  }

  duelName(identity) {
    return (this.duelNames && this.duelNames[identity]) || cleanName(identity)
  }

  /** Apply an ordered local or remote input to the deterministic duel state. */
  duelInput(identity, input = {}) {
    if (!this.duel || !this.duel.active || !this.duelCombat) return null
    let fighter = null
    try {
      fighter = this.duelCombat.fighter(identity)
    } catch {
      // The transport boundary is public input. An unknown peer is ignored;
      // malformed traffic must not end a real duel or crash the game loop.
      return null
    }
    if (input.dx || input.dy) {
      const dx = Math.sign(Number(input.dx) || 0)
      const dy = Math.sign(Number(input.dy) || 0)
      this.duelCombat.place(identity, fighter.x + dx, fighter.y + dy)
      if (String(identity) === this.duel.self) {
        const self = this.duelCombat.fighter(identity)
        this.walker.placeAt('coliseum', self.x, self.y)
        this.announce()
      }
    }
    if (input.tick) {
      this.duelCombat.tick()
      return this.duelCombat.snapshot(this.duel.self)
    }
    if (input.surrender) {
      const result = this.duelCombat.surrender(identity)
      this.finishDuel(result.reason)
      return { type: 'duel-over', result }
    }
    if (!input.attack) return this.duelCombat.snapshot(this.duel.self)

    const event = this.duelCombat.attack(identity)
    if (event.type === 'duel-hit') {
      this.say(
        `${this.duelName(event.by)} golpea a ${this.duelName(event.target)} por ${event.damage}`
      )
    } else if (event.type === 'duel-miss') {
      this.say(`fuera de alcance: ${event.distance}, tu arma llega ${event.reach}`)
    } else if (event.type === 'duel-cooldown') {
      this.say(`arma recargando: ${event.readyIn} ticks`)
    }
    if (event.result) this.finishDuel(event.result.reason)
    return event
  }

  finishDuel(reason = 'termino', options = {}) {
    if (!this.duel) return false
    const result = this.duelCombat && this.duelCombat.result
    const network = this.duelNetwork
    if (
      options.broadcast !== false &&
      result &&
      network &&
      this.presence &&
      typeof this.presence.sendDuel === 'function'
    ) {
      this.presence.sendDuel('result', network.rivalId, {
        duelId: network.duelId,
        winner: result.winner,
        loser: result.loser,
        reason: result.reason
      })
    }
    const back = this.duel.end(reason)
    this.lastDuelResult = result ? { ...result } : null
    if (result) {
      this.player.recordDuel(result.winner === this.duel.self)
      this.say(`duelo terminado: gana ${this.duelName(result.winner)}`)
      this.wallet.pending = {
        kind: 'duel-result',
        duelId: network ? network.duelId : null,
        winner: result.winner,
        loser: result.loser,
        reason: result.reason
      }
    } else this.say('duelo terminado')
    this.duelCombat = null
    this.duelNames = null
    this.duel = null
    this.duelNetwork = null
    if (back && MAPS[back.mapId]) this.walker.placeAt(back.mapId, back.x, back.y)
    else this.walker.travel('city')
    this.announce()
    return true
  }

  surrenderDuel() {
    if (!this.duel || !this.duel.active || !this.duelCombat) return false
    const result = this.duelCombat.surrender(this.duel.self)
    return this.finishDuel(result.reason)
  }

  /** Attack the world boss while preserving free movement for dodging powers. */
  attackWorldBoss() {
    if (!this.field || this.field.combat || this.field.mode !== 'boss') return false
    const equipped = this.player.snapshot().equipped || {}
    const weapon = CONTENT.items[equipped.left_hand] || null
    const attack = {
      damage: weapon ? weapon.atk : 1,
      reach: weapon ? weapon.reach : 1
    }
    this.drain(this.field.attackBoss(attack))
    this.drainNews()
    return true
  }

  /** Swap dungeon floors while carrying the same run, player sheet and corpses. */
  openDungeonFloor(floor, direction = 'down') {
    if (this.field && this.field.mode === 'dungeon') this.dungeonState = this.field.state
    const next = new Dungeon({
      floor,
      player: this.player,
      script: this.scriptSource,
      seed: this.fieldSeed(),
      state: this.dungeonState
    })
    this.dungeonState = next.state
    if (direction === 'up' && next.layout.down) {
      next.player.x = next.layout.down.x - 2
      next.player.y = next.layout.down.y
    }
    this.field = next
    this.seen = new Set()
    return next
  }

  /** Return from the field with one explicit key when no fight is active. */
  returnToCity() {
    if (!this.field) return false
    if (this.field.combat) {
      this.say('no podes volver a la ciudad durante un combate')
      return false
    }
    if (this.field.mode === 'dungeon') {
      this.say('en la mazmorra debes volver por las escaleras marcadas con ^')
      return false
    }
    if (this.field.mode === 'boss') {
      this.say('debes volver al yermo atravesando el portal marcado con O')
      return false
    }
    this.drain([{ type: 'town' }])
    return true
  }

  walletKey(msg) {
    if (this.walletEditing) {
      if (key.matches(msg, 'escape')) {
        this.walletEditing = false
        this.walletError = ''
      } else if (key.matches(msg, 'enter')) {
        if (this.wallet.link(this.walletInput.value)) {
          this.walletEditing = false
          this.walletError = ''
          this.say(`wallet vinculada: ${this.wallet.short}`)
        } else {
          this.walletError = this.wallet.error
        }
      } else {
        const updated = this.walletInput.update(msg)
        this.walletInput = updated[0]
      }
      return null
    }
    if (key.matches(msg, 'escape', 'v')) {
      this.walletOpen = false
      return null
    }
    if (key.matches(msg, 'enter', 'a')) {
      this.walletInput = textinput
        .create({ value: this.wallet.address || '', placeholder: 'G...', charLimit: 56 })
        .focus()
      this.walletEditing = true
      this.walletError = ''
      return null
    }
    if (key.matches(msg, 'x') && this.wallet.linked) {
      this.wallet.disconnect()
      this.say('wallet desvinculada')
    }
    return null
  }

  rankingKey(msg) {
    if (key.matches(msg, 'escape', 'e')) this.rankingOpen = false
    else if (key.matches(msg, 'left', 'a', 'h', 'right', 'd', 'l', 'tab')) {
      this.rankingTab = this.rankingTab === 'level' ? 'pvp' : 'level'
    }
    return null
  }

  /**
   * @param {object} msg
   * @returns {object|null} a Cmd
   */
  onKey(msg) {
    if (key.matches(msg, 'ctrl+c')) {
      this.stopPresence()
      return quit
    }
    if (this.controlsOpen) {
      if (key.matches(msg, 'escape', '?', 'enter', 'space')) this.controlsOpen = false
      return null
    }
    if (!this.naming && !this.walletEditing && key.matches(msg, '?')) {
      this.controlsOpen = true
      return null
    }
    if (this.title) {
      if (this.naming) {
        if (key.matches(msg, 'escape')) {
          this.naming = false
          this.nameError = ''
          this.pendingSlot = null
          this.replacing = ''
          this.menuPage = this.namingReturnPage || 'main'
        } else if (key.matches(msg, 'enter')) {
          this.beginNewGame()
        } else if (key.matches(msg, 'left')) {
          this.realmCursor = (this.realmCursor + REALMS.length - 1) % REALMS.length
          this.nameError = ''
        } else if (key.matches(msg, 'right', 'tab')) {
          this.realmCursor = (this.realmCursor + 1) % REALMS.length
          this.nameError = ''
        } else {
          this.nameError = ''
          const updated = this.nameInput.update(msg)
          this.nameInput = updated[0]
        }
        return null
      }
      if (key.matches(msg, 'q')) {
        this.stopPresence()
        return quit
      }

      if (this.menuPage === 'main') {
        if (key.matches(msg, 'up', 'w', 'k')) {
          this.menuCursor = (this.menuCursor + 4) % 5
          this.menuMessage = ''
          return null
        }
        if (key.matches(msg, 'down', 's', 'j')) {
          this.menuCursor = (this.menuCursor + 1) % 5
          this.menuMessage = ''
          return null
        }
        if (key.matches(msg, 'n')) {
          this.beginNewFromMenu()
          return null
        }
        if (key.matches(msg, 'enter', 'space')) {
          const result = this.activateMainMenu()
          return result && result !== true ? result : null
        }
        return null
      }

      if (key.matches(msg, 'escape')) {
        this.menuPage = 'main'
        this.menuCursor = this.playableSlots().length > 0 ? 0 : 1
        this.menuMessage = ''
        return null
      }
      if (key.matches(msg, 'up', 'w', 'k')) {
        this.slotCursor = (this.slotCursor + SLOT_COUNT - 1) % SLOT_COUNT
        this.menuMessage = ''
        return null
      }
      if (key.matches(msg, 'down', 's', 'j')) {
        this.slotCursor = (this.slotCursor + 1) % SLOT_COUNT
        this.menuMessage = ''
        return null
      }
      if (key.matches(msg, 'n')) {
        this.startNaming()
        return null
      }
      if (key.matches(msg, 'enter', 'space')) {
        const selected = this.selectedSlot()
        if (selected && !selected.empty && !selected.corrupt) {
          this.loadSlot(selected.slot)
        } else {
          this.menuMessage = 'esa ranura esta vacia: pulsa N para crear una partida ahi'
        }
      }
      return null
    }

    if (this.inventoryOpen) return this.inventoryKey(msg)
    if (this.walletOpen) return this.walletKey(msg)
    if (this.rankingOpen) return this.rankingKey(msg)

    if (key.matches(msg, 'v') && !this.duel && !this.field && !this.shop) {
      this.walletOpen = true
      this.walletError = ''
      return null
    }

    if (key.matches(msg, 'q')) {
      this.stopPresence()
      return quit
    }

    if (this.shop) return this.shopKey(msg)

    if (key.matches(msg, 'i') && !this.duel && !(this.field && this.field.combat)) {
      this.openInventory(false)
      return null
    }

    if (this.duelInvite && this.duelInvite.direction === 'in') {
      if (key.matches(msg, 'enter', 'space', 'y')) this.answerDuel(true)
      else if (key.matches(msg, 'n', 'escape')) this.answerDuel(false)
      return null
    }
    if (this.duelInvite && this.duelInvite.direction === 'out' && key.matches(msg, 'n', 'escape')) {
      const invite = this.duelInvite
      this.presence.sendDuel('decline', invite.peerId, {
        duelId: invite.duelId,
        reason: 'cancelado'
      })
      this.duelInvite = null
      this.say('cancelaste el desafio')
      return null
    }

    if (this.duel && this.duel.active) {
      if (key.matches(msg, 'r', 'escape')) {
        this.sendDuelInput({ surrender: true })
        return null
      }
      if (key.matches(msg, 'space', 'enter', 'f')) {
        this.sendDuelInput({ attack: true })
        return null
      }
    }

    if (key.matches(msg, 'r')) {
      this.loadScript(true)
      return null
    }

    if (this.field && this.field.combat) {
      if (key.matches(msg, 'space', 'enter', 'f')) this.advanceCombat()
      else if (key.matches(msg, 't')) this.returnToCity()
      else if (
        key.matches(msg, 'up', 'w', 'k', 'down', 's', 'j', 'left', 'a', 'h', 'right', 'd', 'l')
      ) {
        // Pressing toward the occupied hitbox is also an attack. It keeps the
        // direct contact readable for players who never reach for a second key.
        this.advanceCombat()
      }
      return null
    }

    if (key.matches(msg, 't')) {
      this.returnToCity()
      return null
    }

    if (key.matches(msg, 'f') && this.field) {
      if (this.field.mode === 'dungeon') this.say('acercate a un monstruo para entrar en combate')
      else if (this.field.mode === 'boss') this.attackWorldBoss()
      else this.say('el Coloso esta al otro lado del portal O, al norte del yermo')
      return null
    }

    // Arrows and WASD both walk. Binding only the arrows costs nothing to
    // implement and quietly excludes everyone who reaches for WASD first.
    const step = [
      [['up', 'w', 'k'], 0, -1],
      [['down', 's', 'j'], 0, 1],
      [['left', 'a', 'h'], -1, 0],
      [['right', 'd', 'l'], 1, 0]
    ]
    for (const [names, dx, dy] of step) {
      if (key.matches(msg, ...names)) {
        this.move(dx, dy)
        return null
      }
    }

    if (key.matches(msg, 'e', 'enter', 'space')) {
      this.enter()
      return null
    }

    return null
  }

  move(dx, dy) {
    if (this.field) {
      const wasFighting = !!this.field.combat
      this.drain(this.field.walk(dx, dy))
      this.drainNews()
      this.syncCombat(wasFighting)
      return
    }
    if (this.duel && this.duel.active && this.duelCombat) {
      if (this.duelNetwork) {
        this.sendDuelInput({ dx, dy })
        return
      }
      const next = this.duel.clamp(this.walker.x + dx, this.walker.y + dy)
      if (next.x === this.walker.x && next.y === this.walker.y) return
      const stepX = next.x - this.walker.x
      const stepY = next.y - this.walker.y
      if (this.walker.peek(stepX, stepY).solid) return
      const moved = this.duelCombat.place(this.duel.self, next.x, next.y)
      if (moved.moved) {
        this.walker.placeAt('coliseum', moved.x, moved.y)
        this.announce()
      }
      return
    }
    const npc = this.npcAt(this.walker.x + dx, this.walker.y + dy)
    if (npc) {
      this.say(`${npc.name}, ${npc.role}. pulsa e para hablar`)
      return
    }
    // Doors and map exits activate on contact. Announcing the landed cell
    // first keeps presence honest even when that step immediately opens a UI.
    if (this.walker.move(dx, dy).moved) {
      this.announce()
      if (this.walker.action()) this.enter()
    }
  }

  /** Act on whatever the player is standing on. */
  enter() {
    if (this.field) return

    const action = this.walker.action()
    if (!action) {
      const npc = this.nearbyNpc()
      if (npc) {
        this.interactNpc(npc)
        return
      }
      const landmark = this.nearbyLandmark()
      if (landmark && landmark.action && landmark.action.kind === 'ranking') {
        this.openRanking()
        return
      }
      const peer = this.nearbyPlayer()
      if (peer) {
        this.challengePlayer(peer)
        return
      }
      this.say('aca no hay nada')
      return
    }

    switch (action.kind) {
      case 'travel':
        if (this.duel && this.duel.blocksExit()) {
          this.say('el porton queda cerrado durante el duelo; pulsa r para rendirte')
          break
        }
        if (action.to === 'field') {
          this.field = new Field({ player: this.player, seed: this.fieldSeed() })
          this.field.setScript(this.scriptSource)
          this.say('entras a la pradera: RUNA queda en el borde oeste y NOX en el extremo este')
        } else if (action.to === 'castle') {
          this.castleReturn = {
            mapId: this.walker.mapId,
            x: this.walker.x,
            y: Math.min(this.walker.map.height - 2, this.walker.y + 1)
          }
          this.walker.travel('castle')
          this.say('entras al gran salon del castillo')
        } else if (action.to === 'dungeon') {
          this.dungeonReturn = {
            mapId: this.walker.mapId,
            x: this.walker.x,
            y: Math.min(this.walker.map.height - 2, this.walker.y + 1)
          }
          this.walker.travel('dungeon')
          this.say('bajas a las ruinas bajo el castillo')
        } else if (action.returnTo === 'dungeon' && this.dungeonReturn) {
          const back = this.dungeonReturn
          this.walker.placeAt(back.mapId, back.x, back.y)
          this.dungeonReturn = null
          this.say('subis de las ruinas y volves al castillo')
        } else if (action.returnTo === 'castle' && this.castleReturn) {
          const back = this.castleReturn
          this.walker.placeAt(back.mapId, back.x, back.y)
          this.castleReturn = null
          this.say('salis del castillo y volves a la ciudad')
        } else if (action.arrival && MAPS[action.to] && MAPS[action.to].arrivals) {
          const arrival = MAPS[action.to].arrivals[action.arrival]
          if (arrival) this.walker.placeAt(action.to, arrival.x, arrival.y)
          else this.walker.travel(action.to)
          this.say(`cruzas la frontera hacia ${MAPS[action.to].name}`)
        } else {
          this.walker.travel(action.to)
          if (action.to === 'nox') this.say('cruzas la frontera hacia el reino enemigo de nox')
        }
        this.announce()
        break

      case 'shop': {
        const s = shops[action.shop]
        if (!s) {
          this.say('esa tienda no abre')
          break
        }
        this.shop = action.shop
        this.cursor = 0
        this.say(`entras a ${s.name || action.shop}`)
        break
      }

      case 'church':
        this.player.hp = this.player.maxHp
        this.say('descansas en la iglesia, vida al maximo')
        break

      case 'home':
        this.openInventory(true)
        this.say('abris el cofre de tu hogar')
        break

      case 'tavern':
        this.restAtTavern()
        break

      default:
        this.say('no se que es esto')
    }
  }

  /** @param {object} msg */
  inventoryKey(msg) {
    if (key.matches(msg, 'escape', 'e', 'i')) {
      this.inventoryOpen = false
      this.inventoryHome = false
      return null
    }

    if (this.inventoryHome && key.matches(msg, 'left', 'right', 'tab', 'a', 'd', 'h', 'l')) {
      this.inventoryTab = this.inventoryTab === 'carried' ? 'stored' : 'carried'
      this.inventoryCursor = 0
      return null
    }

    const list = this.inventoryItems(this.inventoryTab)
    if (key.matches(msg, 'up', 'w', 'k')) {
      this.inventoryCursor = Math.max(0, this.inventoryCursor - 1)
      return null
    }
    if (key.matches(msg, 'down', 's', 'j')) {
      this.inventoryCursor = Math.min(Math.max(0, list.length - 1), this.inventoryCursor + 1)
      return null
    }

    const item = list[this.inventoryCursor]
    if (!item) return null

    if (this.inventoryHome && key.matches(msg, 'enter', 'space')) {
      const result =
        this.inventoryTab === 'stored'
          ? this.player.withdraw(item.id)
          : this.player.deposit(item.id)
      this.say(
        result.ok
          ? this.inventoryTab === 'stored'
            ? `retiraste ${item.name} del deposito`
            : `depositaste ${item.name} en tu hogar`
          : result.reason
      )
      const remaining = this.inventoryItems(this.inventoryTab)
      this.inventoryCursor = Math.min(this.inventoryCursor, Math.max(0, remaining.length - 1))
      return null
    }

    if (this.inventoryTab === 'carried' && key.matches(msg, 'enter', 'space')) {
      const result = this.player.equip(item.id)
      this.say(result.ok ? `equipaste ${item.name}` : result.reason)
      return null
    }

    if (this.inventoryTab === 'carried' && key.matches(msg, 'x')) {
      const equipped = this.player.isEquipped(item.id)
      const result = equipped ? this.player.unequip(item.id) : this.player.equip(item.id)
      this.say(result.ok ? `${equipped ? 'quitaste' : 'equipaste'} ${item.name}` : result.reason)
      return null
    }
    return null
  }

  openInventory(home = false) {
    this.inventoryOpen = true
    this.inventoryHome = !!home
    this.inventoryTab = 'carried'
    this.inventoryCursor = 0
    return true
  }

  inventoryItems(tab = this.inventoryTab) {
    const source = tab === 'stored' ? this.player.storage : this.player.items
    const order = new Map(EQUIPMENT_SLOTS.map((slot, index) => [slot, index]))
    return [...source]
      .map((id) => CONTENT.items[id])
      .filter(Boolean)
      .sort(
        (a, b) =>
          (order.get(a.slot) ?? 99) - (order.get(b.slot) ?? 99) || a.name.localeCompare(b.name)
      )
  }

  /** @param {object} msg */
  shopKey(msg) {
    const list = (browse(this.shop, this.player) || {}).lines || []

    if (key.matches(msg, 'escape', 'e')) {
      this.shop = null
      return null
    }
    if (key.matches(msg, 'up')) {
      this.cursor = Math.max(0, this.cursor - 1)
      return null
    }
    if (key.matches(msg, 'down')) {
      this.cursor = Math.min(Math.max(0, list.length - 1), this.cursor + 1)
      return null
    }
    if (key.matches(msg, 'enter', 'space')) {
      const pick = list[this.cursor]
      if (!pick) return null
      const id = pick.id || pick.goodId || pick
      if (this.player.owns(id)) {
        const res = this.player.equip(id)
        this.say(res.ok ? `equipaste ${res.item.name}` : res.reason)
      } else {
        const res = this.player.buy(id, this.shop)
        this.say(res.ok ? `compraste y equipaste ${res.good.name}` : res.reason)
      }
      return null
    }
    if (key.matches(msg, 'x')) {
      const pick = list[this.cursor]
      if (!pick) return null
      const res = this.player.unequip(pick.id)
      this.say(res.ok ? `quitaste ${res.item.name}` : res.reason)
      return null
    }
    return null
  }

  // -------------------------------------------------------------------------

  /**
   * Shape the running fight the way the arena wants to draw it.
   *
   * World tracks positions and held objects; arenaPane wants glyphs and
   * coordinates. Neither is wrong, so the translation lives here rather than
   * bending one module to the other.
   *
   * @returns {object|null}
   */
  /**
   * One line for the title screen about who else is out there.
   *
   * The swarm is the part of this game a player cannot see working. Two copies
   * find each other with no server in the middle, and the whole thing happens
   * in complete silence: nothing on screen ever admitted the network existed
   * until somebody happened to walk past you in town. If nobody ever walks
   * past, and on most nights nobody will, the feature may as well not be there.
   *
   * The title is the cheapest honest place to say it, because it is the one
   * screen every player looks at and it costs the game nothing to draw. And it
   * stays honest when the answer is nobody: "buscando jugadores" is a true
   * sentence about a swarm that has found no peers, which is not the same
   * claim as being offline, and the difference is worth showing.
   *
   * @returns {string}
   */
  presenceLine() {
    if (!this.online || !this.presence) return 'modo un jugador'
    if (!this.presenceStarted) return this.title ? 'la red se conecta al comenzar' : 'jugando solo'

    const peers = this.presence.others().length
    if (peers === 1) return '1 jugador mas en linea'
    if (peers > 1) return peers + ' jugadores mas en linea'

    // Connected to somebody who has not said where they are yet. A real state,
    // and a short one, but collapsing it into "buscando" would be a small lie
    // on exactly the screen that is meant to stop the lying.
    const conns = this.presence.conns ? this.presence.conns.size : 0
    if (conns > 0) return 'conectando...'

    return 'buscando jugadores...'
  }

  /**
   * Put the player at the church door after dying.
   *
   * The log said "you wake up in the church" and `walker.travel('city')` left
   * you on `MAPS.city.arrive`, which is the cobble one cell above the gate out
   * to the field. Eleven rows from the church, standing on the doorstep of the
   * thing that just killed you. The healing was real, only the place was wrong,
   * which is the kind of detail that makes a world feel like scenery.
   *
   * The door is found by scanning for its tile rather than by remembering a
   * coordinate, so whoever redraws the town moves the church and this follows
   * it. If the art ever ships without a church, this falls back to the normal
   * arrival instead of dropping the player into a wall.
   */
  wakeInChurch() {
    const homeRealm = realmDefinition(this.realm)
    const city = MAPS[homeRealm.mapId] || MAPS.city
    for (let y = 0; y < city.rows.length; y++) {
      for (let x = 0; x < city.rows[y].length; x++) {
        const tile = TILES[city.rows[y][x]]
        if (tile && tile.enter && tile.enter.kind === 'church') {
          this.walker.placeAt(city.id, x, y)
          return
        }
      }
    }
    this.walker.travel(city.id)
  }

  /**
   * Stable map coordinates for reporting places outside the game.
   * Labels stay deliberately short so X and Y are never clipped by the HUD.
   */
  coordinates() {
    if (this.field) {
      const snap = this.field.snapshot()
      const area =
        snap.mode === 'dungeon'
          ? `dungeon N${snap.floor}`
          : snap.mode === 'boss'
            ? 'world boss'
            : snap.zone || 'pradera'
      return {
        x: Math.round(Number(snap.player.x) || 0),
        y: Math.round(Number(snap.player.y) || 0),
        area
      }
    }

    const labels = {
      city: 'RUNA',
      nox: 'NOX',
      castle: 'castillo',
      dungeon: 'ruinas',
      coliseum: 'coliseo'
    }
    return {
      x: Math.round(Number(this.walker.x) || 0),
      y: Math.round(Number(this.walker.y) || 0),
      area: labels[this.walker.mapId] || this.walker.mapId
    }
  }

  /**
   * Adapt the player snapshot to the names the character sheet actually reads.
   *
   * Three fields were being read under names the snapshot never carried, and
   * because a missing field is `undefined` rather than an error, all three
   * failed quietly and in different ways.
   *
   * `xpNext` never existed, so the experience bar divided by 1. After a single
   * kill it read `18/1` and sat permanently full, and that is the first number
   * a new player ever watches change. The snapshot calls the same quantity
   * `xpneed`, and it also carries `xpinto`, the progress into the current
   * level, which is what a bar drawn between two levels is supposed to show.
   *
   * `left` and `right` never existed either, so both equipment rows read `-`
   * forever. Not only in town: mid fight, with a crossbow in hand and
   * `alcance 14` printed on the arena directly beside them. Two panels on one
   * screen contradicting each other about your gear reads worse than having no
   * panel, because it looks like the game lost track of what you bought.
   *
   * During a fight the truth is the world's `held`. The script picks what to
   * wield and may swap between swings, so the sheet has to follow the fight
   * rather than the persistent record. Out of a fight nothing is in hand at
   * all, so the rows fall back to what the player owns, grouped by the hand
   * each item declares in content.js. Both weapons declare the left hand, so
   * that side can hold two names at once; `row()` truncates, so a long list
   * cannot break the frame.
   *
   * @returns {object} the snapshot, plus the fields statsPanel expects
   */
  sheet() {
    const persistent = this.player.snapshot ? this.player.snapshot() : this.player
    const combat = this.field && this.field.combat
    const duel =
      this.duel && this.duel.active && this.duelCombat
        ? this.duelCombat.snapshot(this.duel.self)
        : null
    const held = combat && combat.world ? combat.world.held : null
    const stats = combat
      ? {
          ...persistent,
          hp: Math.max(0, Math.ceil(combat.world.hero.hp)),
          maxhp: combat.world.hero.base.hp,
          potions: combat.world.potions
        }
      : duel
        ? {
            ...persistent,
            hp: duel.self.hp,
            maxhp: duel.self.maxHp
          }
        : persistent

    let left = null
    let right = null
    let chest = null
    let head = null
    let boots = null

    if (held) {
      left = held.left
      right = held.right
      chest = held.chest
      head = held.head
      boots = held.boots
    } else {
      left = CONTENT.items[stats.equipped && stats.equipped.left_hand] || null
      right = CONTENT.items[stats.equipped && stats.equipped.right_hand] || null
      chest = CONTENT.items[stats.equipped && stats.equipped.chest] || null
      head = CONTENT.items[stats.equipped && stats.equipped.head] || null
      boots = CONTENT.items[stats.equipped && stats.equipped.boots] || null
    }

    return {
      ...stats,
      name: this.name,
      coordinates: this.coordinates(),
      xp: stats.xpinto === undefined ? stats.xp : stats.xpinto,
      xpNext: stats.xpneed || 1,
      left,
      right,
      chest,
      head,
      boots,
      quest: this.questSummary()
    }
  }

  questSummary() {
    for (const quest of Object.values(QUESTS)) {
      const state = this.quests[quest.id]
      if (!state || state.status !== 'active') continue
      return {
        label: 'mosquitos',
        progress: state.progress,
        count: quest.count,
        ready: state.progress >= quest.count
      }
    }
    return null
  }

  arena() {
    const c = this.field && this.field.combat
    if (!c || !c.world) return null
    const w = c.world
    const held = Object.values(w.held)
    const d = w.hero.derive(held)
    const def = CONTENT.foes[w.foeDef.id] || {}
    const heldItems = held.filter(Boolean).map((item) => item.id)
    const visibleItems = heldItems
    const turn = Math.floor(w.tick / COMBAT_TURN_TICKS) + 1

    return {
      span: ARENA,
      over: w.over,
      turn,
      turnTicks: COMBAT_TURN_TICKS,
      hero: {
        glyph: 'o',
        sprite: render.heroSprite({
          frame: turn,
          items: visibleItems,
          initial: nameInitial(this.name)
        }),
        name: 'vos',
        x: Math.round(w.hero.x),
        hp: Math.ceil(w.hero.hp),
        maxhp: w.hero.base.hp,
        reach: d.reach,
        cooldown: w.hero.cooldownLeft,
        cooldownMax: d.cooldown
      },
      foe: {
        glyph: def.glyph || '?',
        portrait: portraits.portraitOf(w.foeDef.id).lines,
        name: w.foe.name,
        x: Math.round(w.foe.x),
        hp: Math.ceil(w.foe.hp),
        maxhp: w.foe.base.hp
      }
    }
  }

  walletPane(width) {
    const lines = ['', '  WALLET Y PVP', '  red: Stellar TESTNET', '']
    const addWrapped = (text) => {
      for (const line of render.wrap(text, Math.max(1, width - 4))) lines.push('  ' + line)
    }
    if (this.walletEditing) {
      lines.push('  pega tu direccion publica (empieza con G):')
      lines.push('')
      lines.push('  ' + this.walletInput.view())
      lines.push('')
      if (this.walletError) lines.push('  ERROR: ' + this.walletError)
      lines.push('  nunca pegues una clave secreta que empieza con S')
      return lines.join('\n')
    }
    if (this.wallet.linked) {
      lines.push('  direccion vinculada: ' + this.wallet.short)
      addWrapped(this.wallet.address)
      lines.push('')
      lines.push(
        this.wallet.canSign
          ? '  firma externa: conectada'
          : '  firma externa: no configurada (solo identidad)'
      )
      lines.push('')
      if (this.wallet.pending) {
        lines.push('  resultado de duelo pendiente de publicar')
        lines.push('  contrato: no configurado')
        lines.push('')
      }
      lines.push('  X  desvincular direccion')
    } else {
      lines.push('  estado: sin wallet')
      lines.push('')
      lines.push('  ENTER / A  vincular direccion publica')
      lines.push('')
      lines.push('  La clave secreta nunca se guarda ni se escribe aca.')
    }
    lines.push('')
    lines.push('  Los duelos sin apuesta funcionan por P2P.')
    addWrapped('Apostar/publicar requiere un firmante externo y el contrato desplegado.')
    return lines.join('\n')
  }

  view() {
    if (this.controlsOpen) {
      return render.controlsScreen({
        width: this.width,
        height: this.height,
        footer: 'ESC / ? / ENTER volver'
      })
    }
    if (this.naming) {
      return render.newGameScreen(
        this.width,
        this.height,
        this.nameInput.view(),
        nameInitial(this.nameInput.value),
        this.nameError,
        {
          slot: this.pendingSlot || this.slotCursor + 1,
          replacing: this.replacing,
          realms: REALMS,
          realmCursor: this.realmCursor
        }
      )
    }
    if (this.title) {
      return render.titleScreen(this.width, this.height, this.presenceLine(), {
        page: this.menuPage,
        slots: this.slots,
        cursor: this.menuPage === 'slots' ? this.slotCursor : this.menuCursor,
        message: this.menuMessage
      })
    }

    if (this.width < render.MIN_WIDTH || this.height < render.MIN_HEIGHT) {
      return render.tooSmall(this.width, this.height)
    }

    const base = {
      width: this.width,
      height: this.height,
      stats: this.sheet(),
      log: this.log
    }
    const autosave = this.activeSlot ? `autoguardado R${this.activeSlot} | ` : ''

    if (this.walletOpen) {
      return render.compose({
        ...base,
        title: 'runa',
        subtitle: this.wallet.linked ? this.wallet.short : 'sin wallet',
        mainCaption: 'wallet y pvp',
        main: (w) => this.walletPane(w),
        footer: this.walletEditing
          ? controlsFooter('enter vincular | esc cancelar | solo direccion publica G...')
          : controlsFooter('enter / a vincular | x desvincular | v / esc volver')
      })
    }

    if (this.rankingOpen) {
      return render.rankingScreen({
        ...base,
        tab: this.rankingTab,
        entries: this.rankingEntries(),
        footer: controlsFooter('izquierda/derecha o tab cambiar ranking | e / esc volver')
      })
    }

    if (this.inventoryOpen) {
      const equipment = {}
      for (const slot of EQUIPMENT_SLOTS) {
        equipment[slot] = CONTENT.items[this.player.equipped[slot]] || null
      }
      const items = this.inventoryItems(this.inventoryTab).map((item) => ({
        ...item,
        equipped: this.player.isEquipped(item.id)
      }))
      return render.inventoryScreen({
        ...base,
        home: this.inventoryHome,
        tab: this.inventoryTab,
        cursor: this.inventoryCursor,
        equipment,
        items,
        footer: this.inventoryHome
          ? inventoryFooter(
              autosave + 'izq/der mochila/deposito | ENTER transferir | X equipar/quitar'
            )
          : inventoryFooter(
              autosave + 'arriba/abajo elegir | ENTER equipar arma/armadura | X quitar'
            )
      })
    }

    if (this.shop) {
      const cat = browse(this.shop, this.player) || { name: this.shop, lines: [] }
      return render.shopScreen({
        ...base,
        place: cat.name,
        shop: {
          title: cat.name,
          about: cat.about,
          gold: this.player.gold,
          items: cat.lines || [],
          cursor: this.cursor,
          loadout: {
            left: CONTENT.items[this.player.equipped.left_hand] || null,
            right: CONTENT.items[this.player.equipped.right_hand] || null,
            chest: CONTENT.items[this.player.equipped.chest] || null,
            head: CONTENT.items[this.player.equipped.head] || null,
            boots: CONTENT.items[this.player.equipped.boots] || null
          }
        },
        footer:
          autosave +
          controlsFooter('arriba/abajo elegir | enter comprar/equipar | x quitar | esc salir')
      })
    }

    if (this.field) {
      const snap = this.field.snapshot()
      // The field paints its own grid: terrain speckle, foes and the hero all
      // come back already composited, so it goes straight into the pane rather
      // than through mapPane, which expects a static tile map.
      let nearest = null
      for (const foe of snap.foes || []) {
        const dx = foe.x - snap.player.x
        const dy = (foe.y - snap.player.y) * Y_SCALE
        const distance = Math.round(Math.hypot(dx, dy))
        if (!nearest || distance < nearest.distance) nearest = { ...foe, distance }
      }
      const fieldCaption = snap.combat
        ? `hitbox activa | ${snap.combat.foe.name} ${snap.combat.foe.hp}/${snap.combat.foe.maxhp} hp | vos ${snap.combat.hp}/${snap.combat.maxhp} hp`
        : snap.mode === 'dungeon'
          ? snap.completed
            ? `MAZMORRA NIVEL ${snap.floor} | rey esqueleto derrotado`
            : `MAZMORRA NIVEL ${snap.floor} | quedan ${snap.remaining} monstruos | ^ subir${snap.stairs.down ? ' | v bajar' : ''}`
          : snap.mode === 'boss' && snap.boss && snap.boss.defeated
            ? 'RUINAS VOLCANICAS | el Coloso ha sido derrotado | O volver'
            : snap.gate &&
                Math.hypot(snap.gate.x - snap.player.x, (snap.gate.y - snap.player.y) * Y_SCALE) <=
                  18
              ? 'PUERTA DE RUNA | cruza el porton < del borde oeste'
              : snap.noxGate &&
                  Math.hypot(
                    snap.noxGate.x - snap.player.x,
                    (snap.noxGate.y - snap.player.y) * Y_SCALE
                  ) <= 18
                ? 'FRONTERA DE NOX | cruza el porton N del borde este'
                : snap.dungeonEntrance &&
                    Math.hypot(
                      snap.dungeonEntrance.x - snap.player.x,
                      (snap.dungeonEntrance.y - snap.player.y) * Y_SCALE
                    ) <= 14
                  ? 'CRIPTA DE LA PRADERA | entra por la puerta X'
                  : snap.worldBossPortal &&
                      Math.hypot(
                        snap.worldBossPortal.x - snap.player.x,
                        (snap.worldBossPortal.y - snap.player.y) * Y_SCALE
                      ) <= 14
                    ? 'PORTAL DEL COLOSO | entra por el nucleo O'
                    : snap.boss && snap.boss.active && !snap.boss.defeated
                      ? `JEFE MUNDIAL | ${snap.boss.name} ${snap.boss.hp}/${snap.boss.maxhp} hp | ${snap.boss.phase}`
                      : nearest
                        ? `${snap.zone} | ${nearest.name} a ${nearest.distance} pasos`
                        : snap.zone || 'el campo'
      const equipment = this.player.snapshot().equipped
      const combatItems = snap.combat
        ? [
            snap.combat.left,
            snap.combat.right,
            snap.combat.chest,
            snap.combat.head,
            snap.combat.boots
          ].filter(Boolean)
        : []
      const playerItems = Object.values(equipment || {}).filter(Boolean)

      return render.compose({
        width: this.width,
        height: this.height,
        title: 'runa',
        mainCaption: fieldCaption,
        // Two things this line has to get right, both of which it used to get
        // wrong and neither of which crashed.
        //
        // render() hands back one string per row and compose() wants a single
        // string. Passing the array straight through meant box() stringified
        // it, the rows were joined by commas into one line, and the pane showed
        // a single stripe of terrain with the hero nowhere on it. Nothing
        // threw. The field was simply invisible, which is exactly the kind of
        // bug that survives all the way into a demo.
        //
        // And the width is the whole pane, not the pane divided by CELL_W.
        // mapPane does that division itself and then paints each tile that many
        // columns wide; the field paints one column per cell, because Y_SCALE
        // already pays for the 1:2 aspect of a terminal cell in the distance
        // maths. Dividing here too drew the world at half scale into half a box.
        main: (w, h) =>
          render.fieldPane(
            {
              // fieldPane paints the detailed actors itself, so it needs the
              // untouched terrain beneath their transparent sprite cells.
              rows: this.field.render(w, h, false),
              mode: snap.mode,
              width: snap.width,
              height: snap.height,
              player: {
                ...snap.player,
                sprite: render.heroSprite({
                  frame: snap.player.x + snap.player.y,
                  items: snap.combat ? combatItems : playerItems,
                  initial: nameInitial(this.name)
                })
              },
              foes: snap.foes,
              boss: snap.boss
            },
            w,
            h
          ),
        stats: base.stats,
        log: base.log,
        footer: snap.combat
          ? autosave + controlsFooter('f / espacio atacar | wasd contra monstruo atacar')
          : snap.mode === 'dungeon'
            ? gameplayFooter(
                autosave + 'wasd mover | toca monstruo | ^ subir | v bajar al limpiar el nivel'
              )
            : snap.mode === 'boss'
              ? gameplayFooter(
                  autosave + 'wasd mover/esquivar | f atacar Coloso | O volver al yermo'
                )
              : snap.boss && snap.boss.active && !snap.boss.defeated
                ? gameplayFooter(
                    autosave + 'wasd esquivar poderes | f atacar jefe | O volver al yermo'
                  )
                : gameplayFooter(
                    autosave +
                      't volver a la ciudad | < RUNA oeste | N NOX este | X cripta | O portal'
                  )
      })
    }

    const city = MAPS[this.walker.mapId]
    const duel =
      this.duel && this.duel.active && this.duelCombat
        ? this.duelCombat.snapshot(this.duel.self)
        : null
    const nearby = duel ? null : this.nearbyNpc(2)
    const landmark = duel || nearby ? null : this.nearbyLandmark(2)
    const nearbyOnline = duel || nearby || landmark ? null : this.nearbyPlayer(2)
    const rivalName = duel ? this.duelName(duel.rival.id) : ''
    const rivalDirection = duel ? (duel.rival.x < duel.self.x ? 'oeste' : 'este') : ''
    const duelReady = duel
      ? duel.self.cooldownLeft > 0
        ? `recarga ${duel.self.cooldownLeft}`
        : 'listo'
      : ''
    const peers = this.others(this.walker.mapId).filter((peer) => !duel || peer.name !== rivalName)
    if (duel) {
      peers.push({
        x: duel.rival.x,
        y: duel.rival.y,
        anchorY: 2,
        color: 'red',
        name: rivalName,
        sprite: render.heroSprite({
          frame: duel.tick + duel.rival.swinging,
          items: duel.rival.items,
          initial: nameInitial(rivalName)
        })
      })
    }
    return render.mapScreen({
      ...base,
      place: duel
        ? `COLISEO | ${rivalName} ${duel.rival.hp}/${duel.rival.maxHp} hp al ${rivalDirection} | vos ${duel.self.hp}/${duel.self.maxHp} hp | alcance ${duel.distance}/${duel.self.reach} | ${duelReady}`
        : nearby
          ? `${city.name} | ${nearby.name}, ${nearby.role} | e hablar`
          : landmark
            ? `${city.name} | ${landmark.name} | e consultar ranking`
            : this.duelInvite && this.duelInvite.direction === 'in'
              ? `${city.name} | ${this.duelInvite.name} te desafia | enter aceptar / n rechazar`
              : this.duelInvite
                ? `${city.name} | esperando respuesta de ${this.duelInvite.name}`
                : nearbyOnline
                  ? `${city.name} | ${nearbyOnline.name}, jugador | e desafiar`
                  : city
                    ? city.name
                    : this.walker.mapId,
      // Un tile por columna: el arte detallado esta dibujado asumiendo
      // ancho 1, y a ancho 2 se le mete un espacio entre cada caracter.
      cellW: 1,
      footer: duel
        ? autosave +
          controlsFooter('wasd mover | f / espacio atacar | r rendirse | q salir del juego')
        : this.duelInvite && this.duelInvite.direction === 'in'
          ? autosave + controlsFooter('enter aceptar duelo | n rechazar | q salir')
          : gameplayFooter(autosave + 'wasd o flechas | e hablar | v wallet | q salir'),
      map: {
        tiles: city ? city.rows : [],
        animations: (city && city.animations) || [],
        frame: this.animationTick,
        hero: {
          x: this.walker.x,
          y: this.walker.y,
          sprite: render.heroSprite({
            frame: this.walker.x + this.walker.y + (duel ? duel.self.swinging : 0),
            items: duel
              ? duel.self.items
              : Object.values(this.player.snapshot().equipped || {}).filter(Boolean),
            initial: nameInitial(this.name)
          })
        },
        // Residents and network players share the actor layer. The hero is
        // still painted last, so a remote update cannot hide local movement.
        actors: [...(duel ? [] : (city && city.npcs) || []), ...peers]
      }
    })
  }
}

module.exports = {
  Runa,
  TICK_MS,
  COMBAT_TURN_TICKS,
  SCRIPT_PATH,
  DEFAULT_SCRIPT,
  LEGACY_DEFAULT_SCRIPT,
  isLegacyDefaultScript,
  DEFAULT_NAME,
  QUESTS,
  REALMS,
  normalizeRealm,
  nameInitial
}
