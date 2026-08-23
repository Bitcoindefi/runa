/** @typedef {import('pear-interface')} */ /* global Pear */
'use strict'

/**
 * runa: the game loop.
 *
 * Two layers, and keeping them apart is the whole design. Walking is played
 * with the keyboard: arrows move, `e` enters a door. Fighting is not played at
 * all, it is scripted: the file the player edits decides what the character
 * does, and it is re-read every tick while the fight runs.
 *
 * bare-tui is Elm-shaped, so everything that happens arrives at `update` as a
 * message and `view` only ever renders. Nothing here does IO inside `view`.
 */

const { Program, quit, every, key } = require('bare-tui')
const fs = require('bare-fs')

const { Walker, MAPS } = require('./map.js')
const { Player, shops, browse } = require('./shop.js')
const { Field } = require('./field.js')
const render = require('./render.js')
const { parse } = require('./script.js')

/** Simulation rate. Rendering follows the same clock; at this size it is cheap. */
const TICK_MS = 1000 / 15

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

const tick = every(TICK_MS, () => ({ type: 'tick' }))

class Runa {
  constructor() {
    this.width = 80
    this.height = 24

    this.walker = new Walker('city')
    this.player = new Player()
    this.field = null
    this.shop = null
    this.cursor = 0

    this.log = []
    this.seen = new Set()
    this.pending = null
    this.scriptSource = ''
    this.scriptMtime = 0
    this.scriptErrors = []

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
    } else if (!force) {
      this.say('script recargado')
    }
    if (this.field) this.field.setScript(this.scriptSource)
    return true
  }

  /** @param {string} text */
  say(text) {
    this.log.push(text)
    if (this.log.length > 40) this.log.shift()
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
          this.say('volves a la ciudad')
          break
        case 'busy':
          this.say('estas peleando, tu script decide')
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

  init() {
    this.say('bienvenido. las flechas caminan, e entra, s abre el script.')
    return tick
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

      case 'key':
        return [this, this.onKey(msg)]

      default:
        return [this, null]
    }
  }

  onTick() {
    // The strategy is re-read while a fight is running, which is the point: the
    // player fixes a rule and sees it take effect without restarting anything.
    this.loadScript(false)

    if (this.field) {
      // The field keeps its own bookkeeping for the excursion; the persistent
      // sheet is this.player. outfit() pushes the sheet into a fight as it
      // starts and settle() banks the result when it ends, so gold, xp and
      // death all land on the one object that survives the walk home.
      const wasFighting = !!this.field.combat
      this.drain(this.field.tick())
      this.drainNews()

      const nowFighting = !!this.field.combat
      if (!wasFighting && nowFighting) {
        this.player.outfit(this.field.combat.world)
        this.pending = this.field.combat.world
      } else if (wasFighting && !nowFighting && this.pending) {
        const res = this.player.settle(this.pending)
        this.pending = null
        if (res.settled && res.won) {
          if (res.levels > 0) this.say('subiste a nivel ' + this.player.snapshot().level)
        } else if (res.settled) {
          this.say('caiste. te despertas en la iglesia.')
          this.walker.travel('city')
          this.field = null
        }
      }
    }
  }

  /**
   * @param {object} msg
   * @returns {object|null} a Cmd
   */
  onKey(msg) {
    if (key.matches(msg, 'q', 'ctrl+c')) return quit

    if (this.shop) return this.shopKey(msg)

    if (key.matches(msg, 'r')) {
      this.loadScript(true)
      return null
    }

    if (key.matches(msg, '?')) {
      this.say(`el script vive en ${SCRIPT_PATH}, abrilo con tu editor`)
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
      this.drain(this.field.walk(dx, dy))
      this.drainNews()
      return
    }
    this.walker.move(dx, dy)
  }

  /** Act on whatever the player is standing on. */
  enter() {
    if (this.field) return

    const action = this.walker.action()
    if (!action) {
      this.say('aca no hay nada')
      return
    }

    switch (action.kind) {
      case 'travel':
        if (action.to === 'field') {
          this.field = new Field({ player: this.player })
          this.field.setScript(this.scriptSource)
          this.say('salis de la ciudad')
        } else {
          this.walker.travel(action.to)
        }
        break

      case 'shop': {
        const s = shops[action.shop]
        if (!s) { this.say('esa tienda no abre'); break }
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
      const res = this.player.buy(id, this.shop)
      this.say(res && res.ok === false ? (res.why || 'no podes comprar eso') : `compraste ${id}`)
      return null
    }
    return null
  }

  // -------------------------------------------------------------------------

  view() {
    if (this.width < render.MIN_WIDTH || this.height < render.MIN_HEIGHT) {
      return render.tooSmall(this.width, this.height)
    }

    const base = {
      width: this.width,
      height: this.height,
      stats: this.player.snapshot ? this.player.snapshot() : this.player,
      log: this.log
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
          cursor: this.cursor
        }
      })
    }

    if (this.field) {
      const snap = this.field.snapshot()
      if (snap && snap.combat) {
        return render.combatScreen({ ...base, place: 'combate', combat: snap.combat })
      }
      // The field paints its own grid: terrain speckle, foes and the hero all
      // come back already composited, so it goes straight into the pane rather
      // than through mapPane, which expects a static tile map.
      return render.compose({
        width: this.width,
        height: this.height,
        title: 'runa',
        mainCaption: snap.zone || 'el campo',
        main: (w, h) => this.field.render(Math.floor(w / render.CELL_W), h),
        stats: base.stats,
        log: base.log,
        footer: 'flechas mover | < volver a la ciudad | r recargar script | q salir'
      })
    }

    const city = MAPS[this.walker.mapId]
    return render.mapScreen({
      ...base,
      place: city ? city.name : this.walker.mapId,
      map: {
        tiles: city ? city.rows : [],
        hero: { x: this.walker.x, y: this.walker.y, glyph: '@' }
      }
    })
  }
}

module.exports = { Runa, TICK_MS, SCRIPT_PATH, DEFAULT_SCRIPT }
