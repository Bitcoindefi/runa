/** @typedef {import('pear-interface')} */ /* global Pear */
'use strict'

/**
 * A pretend swarm, for developing the presence wiring without a network.
 *
 * This is not net.js and the game never requires it. It exists so the code in
 * game.js that draws other players can be exercised before the real module
 * lands: same shape, same call order, same asynchrony. To watch it move, point
 * lib/net.js at it by hand:
 *
 *   module.exports = require('./net.stub.js')
 *
 * The fake neighbours arrive late and on their own timers on purpose. That is
 * the case worth rehearsing: join and leave fire from outside the game loop,
 * so anything they touch has to survive landing in the middle of a render.
 */

/** Where the fake neighbours walk. The city spawn is at 8,6. */
const HOME = 'city'

/** The people who show up, in the order they show up. */
const CAST = [
  { name: 'tero', glyph: 'o', x: 10, y: 6, dx: 1, at: 200 },
  { name: 'mora', glyph: 'o', x: 8, y: 9, dx: -1, at: 500 },
  { name: 'pino', glyph: 'o', x: 14, y: 7, dx: 1, at: 900 }
]

/** How often the fake neighbours take a step, in ms. */
const STEP_MS = 250

class Presence {
  /**
   * @param {object} [opts]
   * @param {string} [opts.name]
   */
  constructor(opts = {}) {
    this.name = String(opts.name || 'alguien')
    this.started = false

    /** Where we last said we were. The real module puts this on the wire. */
    this.me = { mapId: null, x: 0, y: 0 }

    /** @type {Map<string, object>} everyone else, by name */
    this.peers = new Map()

    this.handlers = { join: [], leave: [] }
    this.timers = []
  }

  /**
   * @param {string} event - 'join' or 'leave'
   * @param {Function} fn
   */
  on(event, fn) {
    if (!this.handlers[event]) this.handlers[event] = []
    this.handlers[event].push(fn)
    return this
  }

  /**
   * @param {string} event
   * @param {string} name
   */
  emit(event, name) {
    for (const fn of this.handlers[event] || []) {
      try {
        fn(name)
      } catch {
        // A listener that throws is the listener's problem, not the swarm's.
      }
    }
  }

  start() {
    if (this.started) return
    this.started = true

    for (const who of CAST) {
      this.timers.push(
        setTimeout(() => {
          this.peers.set(who.name, {
            name: who.name,
            glyph: who.glyph,
            mapId: HOME,
            x: who.x,
            y: who.y,
            dx: who.dx
          })
          this.emit('join', who.name)
        }, who.at)
      )
    }

    // Everyone paces back and forth, so the pane has something that changes.
    this.timers.push(
      setInterval(() => {
        for (const p of this.peers.values()) {
          p.x += p.dx
          if (p.x < 6 || p.x > 20) p.dx = -p.dx
        }
      }, STEP_MS)
    )

    // One of them wanders off, which is the other half of the log.
    this.timers.push(
      setTimeout(() => {
        if (!this.peers.has('mora')) return
        this.peers.delete('mora')
        this.emit('leave', 'mora')
      }, 1600)
    )
  }

  stop() {
    for (const t of this.timers) {
      clearTimeout(t)
      clearInterval(t)
    }
    this.timers = []
    this.peers.clear()
    this.started = false
  }

  /**
   * @param {string} mapId
   * @param {number} x
   * @param {number} y
   */
  update(mapId, x, y) {
    this.me = { mapId, x, y }
  }

  /**
   * @param {string} mapId
   * @returns {Array<{x: number, y: number, glyph: string, name: string}>}
   */
  others(mapId) {
    const out = []
    for (const p of this.peers.values()) {
      if (p.mapId !== mapId) continue
      out.push({ x: p.x, y: p.y, glyph: p.glyph, name: p.name })
    }
    return out
  }
}

module.exports = { Presence }
