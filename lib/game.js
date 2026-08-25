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
const { Player, shops, browse } = require('./shop.js')
const { SLOT_COUNT } = require('./saves.js')
const { Field, Y_SCALE } = require('./field.js')
const render = require('./render.js')
const { parse } = require('./script.js')
const portraits = require('./portraits.js')
const { ARENA } = require('./world.js')
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

/** Simulation rate. Rendering follows the same clock; at this size it is cheap. */
const TICK_MS = 1000 / 15

/** World ticks resolved by one deliberate combat input. */
const COMBAT_TURN_TICKS = 6

/** Where the player's strategy lives. */
const SCRIPT_PATH = 'script.txt'

const DEFAULT_SCRIPT = [
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
    this.player = new Player()
    this.field = null
    this.shop = null
    this.cursor = 0
    this.title = true
    this.naming = false
    this.nameError = ''
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

    if (this.online) {
      try {
        this.presence = new Presence({ name: this.name })
        this.presence.on('join', (who) => this.noteLater('llego ' + cleanName(who)))
        this.presence.on('leave', (who) => this.noteLater('se fue ' + cleanName(who)))
      } catch {
        this.dropPresence()
      }
    }

    this.refreshSlots()
    this.loadScript(true)
  }

  // -------------------------------------------------------------------------

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
      this.presence.update(mapId, this.walker.x, this.walker.y)
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
      out.push({ x, y, glyph: cleanGlyph(o.glyph), name: cleanName(o.name) })
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
    return true
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
          this.walker.travel('city')
          this.announce()
          this.say('volves a la ciudad')
          break
        case 'busy':
          this.say('estas en contacto: pulsa f, espacio o avanza contra el monstruo')
          break
        case 'win':
          // Hold the roll the field made so settle() can bank that exact
          // number. The event arrives on the same tick the fight ends, just
          // before the settling below, so it is always the right kill.
          this.earned = { gold: e.gold, xp: e.xp, kind: e.kind }
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
      location = {
        kind: 'field',
        x: field.player.x,
        y: field.player.y
      }
      place = field.zone || 'pradera'
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
      player,
      location,
      dungeonReturn: this.dungeonReturn ? { ...this.dungeonReturn } : null,
      summary: {
        level: this.player.snapshot().level,
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
      this.player = Player.fromJSON(saved.player)
      this.walker = new Walker('city')
      this.dungeonReturn = saved.dungeonReturn || null
      this.field = null
      this.shop = null
      this.cursor = 0
      this.log = []
      this.seen = new Set()
      this.encounter = null
      this.earned = null
      this.pending = null

      if (location.kind === 'field') {
        this.field = new Field({ script: this.scriptSource })
        this.field.player.x = clampNumber(location.x, 0, this.field.width - 1)
        this.field.player.y = clampNumber(location.y, 0, this.field.height - 1)
      } else {
        const mapId = MAPS[location.mapId] ? location.mapId : 'city'
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
          this.presence = new Presence({ name: this.name })
          this.presence.on('join', (who) => this.noteLater('llego ' + cleanName(who)))
          this.presence.on('leave', (who) => this.noteLater('se fue ' + cleanName(who)))
        } catch {
          this.dropPresence()
        }
      }

      this.say(`partida ${number} cargada. bienvenido otra vez, ${this.name}.`)
      this.startPresence()
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
    this.activeSlot = this.pendingSlot || this.slotCursor + 1
    this.player = new Player()
    this.walker = new Walker('city')
    this.dungeonReturn = null
    this.field = null
    this.shop = null
    this.cursor = 0
    this.log = []
    this.seen = new Set()
    this.encounter = null
    this.earned = null
    this.pending = null
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
        this.presence = new Presence({ name: this.name })
        this.presence.on('join', (who) => this.noteLater('llego ' + cleanName(who)))
        this.presence.on('leave', (who) => this.noteLater('se fue ' + cleanName(who)))
      } catch {
        this.dropPresence()
      }
    }

    this.say(`bienvenido, ${this.name}. usa wasd o flechas; las puertas se abren al pisarlas.`)
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
    // Whatever the swarm said since the last tick becomes log now, on the
    // update side of the loop, where writing to the log is allowed.
    this.drainArrivals()

    // The strategy is re-read while a fight is running, which is the point: the
    // player fixes a rule and sees it take effect without restarting anything.
    this.loadScript(false)

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
        this.say(
          'cae el ' + (def.name || 'enemigo') + ': +' + res.gold + ' oro, +' + res.xp + ' exp'
        )
        if (res.levels > 0) this.say('subiste a nivel ' + this.player.snapshot().level)
      } else if (res.settled) {
        this.say('caiste. te despertas en la iglesia.')
        this.wakeInChurch()
        this.field = null
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

  /** Return from the field with one explicit key when no fight is active. */
  returnToCity() {
    if (!this.field) return false
    if (this.field.combat) {
      this.say('no podes volver a la ciudad durante un combate')
      return false
    }
    this.drain([{ type: 'town' }])
    return true
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
          this.menuCursor = (this.menuCursor + 3) % 4
          this.menuMessage = ''
          return null
        }
        if (key.matches(msg, 'down', 's', 'j')) {
          this.menuCursor = (this.menuCursor + 1) % 4
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

    if (key.matches(msg, 'q')) {
      this.stopPresence()
      return quit
    }

    if (this.shop) return this.shopKey(msg)

    if (key.matches(msg, 'r')) {
      this.loadScript(true)
      return null
    }

    if (key.matches(msg, '?')) {
      this.say(`el script vive en ${SCRIPT_PATH}, abrilo con tu editor`)
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
      this.say('aca no hay nada')
      return
    }

    switch (action.kind) {
      case 'travel':
        if (action.to === 'field') {
          this.field = new Field({ player: this.player })
          this.field.setScript(this.scriptSource)
          this.say('salis de la ciudad. pulsa t para volver cuando no estes peleando')
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
        } else {
          this.walker.travel(action.to)
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
        this.say('tu casa. todavia no hay nada que hacer aca.')
        break

      case 'tavern':
        this.restAtTavern()
        break

      default:
        this.say('no se que es esto')
    }
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
    const city = MAPS.city
    for (let y = 0; y < city.rows.length; y++) {
      for (let x = 0; x < city.rows[y].length; x++) {
        const tile = TILES[city.rows[y][x]]
        if (tile && tile.enter && tile.enter.kind === 'church') {
          this.walker.placeAt('city', x, y)
          return
        }
      }
    }
    this.walker.travel('city')
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
    const held = combat && combat.world ? combat.world.held : null
    const stats = combat
      ? {
          ...persistent,
          hp: Math.max(0, Math.ceil(combat.world.hero.hp)),
          maxhp: combat.world.hero.base.hp,
          potions: combat.world.potions
        }
      : persistent

    let left = null
    let right = null

    if (held) {
      left = held.left
      right = held.right
    } else {
      left = CONTENT.items[stats.equipped && stats.equipped.left] || null
      right = CONTENT.items[stats.equipped && stats.equipped.right] || null
    }

    return {
      ...stats,
      name: this.name,
      xp: stats.xpinto === undefined ? stats.xp : stats.xpinto,
      xpNext: stats.xpneed || 1,
      left,
      right
    }
  }

  arena() {
    const c = this.field && this.field.combat
    if (!c || !c.world) return null
    const w = c.world
    const held = [w.held.left, w.held.right]
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

  view() {
    if (this.naming) {
      return render.newGameScreen(
        this.width,
        this.height,
        this.nameInput.view(),
        nameInitial(this.nameInput.value),
        this.nameError,
        {
          slot: this.pendingSlot || this.slotCursor + 1,
          replacing: this.replacing
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
          cursor: this.cursor
        },
        footer: autosave + 'arriba/abajo elegir | enter comprar/equipar | x quitar | esc salir'
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
        : nearest
          ? `${snap.zone} | ${nearest.name} a ${nearest.distance} pasos`
          : snap.zone || 'el campo'
      const equipment = this.player.snapshot().equipped
      const combatItems = snap.combat ? [snap.combat.left, snap.combat.right].filter(Boolean) : []
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
              foes: snap.foes
            },
            w,
            h
          ),
        stats: base.stats,
        log: base.log,
        footer: snap.combat
          ? autosave + 'f / espacio atacar | wasd contra monstruo atacar'
          : autosave + 'wasd mover | toca monstruo | f atacar | t volver a la ciudad'
      })
    }

    const city = MAPS[this.walker.mapId]
    const nearby = this.nearbyNpc(2)
    return render.mapScreen({
      ...base,
      place: nearby
        ? `${city.name} | ${nearby.name}, ${nearby.role} | e hablar`
        : city
          ? city.name
          : this.walker.mapId,
      // Un tile por columna: el arte detallado esta dibujado asumiendo
      // ancho 1, y a ancho 2 se le mete un espacio entre cada caracter.
      cellW: 1,
      footer: autosave + 'wasd o flechas | puertas automaticas | e hablar / interactuar | q salir',
      map: {
        tiles: city ? city.rows : [],
        hero: {
          x: this.walker.x,
          y: this.walker.y,
          sprite: render.heroSprite({
            frame: this.walker.x + this.walker.y,
            items: Object.values(this.player.snapshot().equipped || {}).filter(Boolean),
            initial: nameInitial(this.name)
          })
        },
        // Residents and network players share the actor layer. The hero is
        // still painted last, so a remote update cannot hide local movement.
        actors: [...((city && city.npcs) || []), ...this.others(this.walker.mapId)]
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
  DEFAULT_NAME,
  nameInitial
}
