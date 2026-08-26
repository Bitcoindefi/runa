'use strict'

const { WORLD_BOSS, phaseFor } = require('./world-boss.js')

const ACTIVATION_RANGE = 34
const DISENGAGE_RANGE = 48
const BODY_HALF_WIDTH = 11
const BODY_TOP = 8
const BODY_BOTTOM = 0
const FRAME_TICKS = 3
const ATTACK_GAP = 36
const HIT_GRACE = 8

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value
}

function distance(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by))
}

function uniqueCells(cells) {
  const seen = new Set()
  return cells.filter((cell) => {
    const key = `${cell.x},${cell.y}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Keep the player and the whole boss in one viewport whenever both fit. */
function bossCamera(player, boss, worldW, worldH, viewW, viewH) {
  const px = Math.round(Number(player && player.x) || 0)
  const py = Math.round(Number(player && player.y) || 0)
  let ox = clamp(px - (viewW >> 1), 0, Math.max(0, worldW - viewW))
  let oy = clamp(py - (viewH >> 1), 0, Math.max(0, worldH - viewH))
  if (!boss || !boss.active || boss.defeated) return { ox, oy }

  const bossLeft = Math.round(boss.x) - WORLD_BOSS.fieldSprite.anchor.x
  const bossRight = bossLeft + WORLD_BOSS.fieldSprite.width - 1
  const bossTop = Math.round(boss.y) - WORLD_BOSS.fieldSprite.anchor.y
  const bossBottom = bossTop + WORLD_BOSS.fieldSprite.height - 1
  const focusLeft = Math.min(px, bossLeft)
  const focusRight = Math.max(px, bossRight)
  const focusTop = Math.min(py, bossTop)
  const focusBottom = Math.max(py, bossBottom)
  ox = clamp(Math.floor((focusLeft + focusRight - viewW + 1) / 2), 0, Math.max(0, worldW - viewW))
  oy = clamp(Math.floor((focusTop + focusBottom - viewH + 1) / 2), 0, Math.max(0, worldH - viewH))
  return { ox, oy }
}

/**
 * Estado local y determinista del Coloso. La futura autoridad de red puede
 * replicar snapshot() sin tener que reproducir los cuadros intermedios.
 */
class WorldBossEvent {
  constructor(opts = {}) {
    const width = Math.max(WORLD_BOSS.fieldSprite.width + 2, Number(opts.width) || 120)
    const height = Math.max(WORLD_BOSS.fieldSprite.height + 2, Number(opts.height) || 36)

    this.x = clamp(Number(opts.x) || width - 22, 21, width - 22)
    this.y = clamp(Number(opts.y) || Math.floor(height / 2), 12, height - 2)
    this.hp = WORLD_BOSS.stats.hp
    this.maxhp = WORLD_BOSS.stats.hp
    this.active = false
    this.defeated = false
    this.frame = 'idle'
    this.action = null
    this.hazards = []
    this.nextAttackAt = 0
    this.attackCursor = 0
    this.hazardId = 0
    this.lastPlayerHitAt = -Infinity
    this.width = width
    this.height = height
  }

  /** Distance from a cell to the solid lower body, not to its centre. */
  distanceToBody(x, y) {
    const dx = Math.max(0, Math.abs(Number(x) - this.x) - BODY_HALF_WIDTH)
    const top = this.y - BODY_TOP
    const bottom = this.y - BODY_BOTTOM
    const py = Number(y)
    const dy = py < top ? top - py : py > bottom ? py - bottom : 0
    return Math.max(dx, dy)
  }

  occupies(x, y) {
    return !this.defeated && this.distanceToBody(x, y) === 0
  }

  activate(time) {
    if (this.active || this.defeated) return []
    this.active = true
    this.nextAttackAt = time + 18
    return [{ type: 'boss-awake', text: WORLD_BOSS.spawn.announcement }]
  }

  /**
   * A player attack is deliberate input. Range is measured to the visible
   * body edge, so a sword never has to reach the centre of a 43-column sprite.
   */
  strike(player, attack = {}, time = 0) {
    if (this.defeated) return [{ type: 'boss-gone', text: 'el altar esta en silencio' }]

    const reach = Math.max(1, Number(attack.reach) || 1)
    const dist = this.distanceToBody(player.x, player.y)
    if (!this.active && distance(player.x, player.y, this.x, this.y) > ACTIVATION_RANGE) {
      return [{ type: 'boss-miss', text: 'el Coloso esta demasiado lejos' }]
    }

    const events = this.activate(time)
    if (dist > reach) {
      events.push({
        type: 'boss-miss',
        text: `el Coloso esta fuera de alcance (${dist}/${reach})`
      })
      return events
    }

    const previousPhase = phaseFor(this.hp, this.maxhp)
    const raw = Math.max(1, Number(attack.damage) || 1)
    const damage = Math.max(1, raw - WORLD_BOSS.stats.defense)
    this.hp = Math.max(0, this.hp - damage)
    events.push({ type: 'boss-damaged', damage, hp: this.hp, maxhp: this.maxhp })

    const nextPhase = phaseFor(this.hp, this.maxhp)
    if (nextPhase.id !== previousPhase.id && nextPhase.announcement) {
      events.push({
        type: 'boss-phase',
        phase: nextPhase.id,
        text: nextPhase.announcement
      })
    }

    if (this.hp === 0) {
      this.defeated = true
      this.active = false
      this.action = null
      this.hazards = []
      this.frame = 'idle'
      events.push({
        type: 'boss-win',
        gold: WORLD_BOSS.drop.gold[1],
        xp: WORLD_BOSS.drop.xp,
        text: WORLD_BOSS.spawn.defeat
      })
    }
    return events
  }

  /** Advance animation, launch powers and move their real field hitboxes. */
  tick(player, time) {
    const events = []
    if (this.defeated) return events

    const near = distance(player.x, player.y, this.x, this.y) <= ACTIVATION_RANGE
    if (near) events.push(...this.activate(time))
    if (this.active && distance(player.x, player.y, this.x, this.y) > DISENGAGE_RANGE) {
      this.active = false
      this.action = null
      this.hazards = []
      this.frame = 'idle'
      events.push({ type: 'boss-rest', text: 'el Coloso vuelve a vigilar el altar' })
      return events
    }
    if (!this.active) {
      this.frame = 'idle'
      return events
    }

    if (!this.action && time >= this.nextAttackAt) this.startAttack(player, time, events)
    if (this.action) this.advanceAction(player, time, events)
    else this.frame = Math.floor(time / 10) % 2 ? 'idlePulse' : 'idle'

    this.moveHazards(time)
    events.push(...this.touch(player, time))
    return events
  }

  startAttack(player, time, events) {
    const phase = phaseFor(this.hp, this.maxhp)
    const phaseIndex = WORLD_BOSS.phases.findIndex((candidate) => candidate.id === phase.id)
    const attacks = WORLD_BOSS.phases
      .slice(0, phaseIndex + 1)
      .flatMap((candidate) => candidate.attacks)
    const attack = attacks[this.attackCursor++ % attacks.length]
    const target = { x: Math.round(player.x), y: Math.round(player.y) }
    this.action = {
      attack,
      target,
      telegraphs: this.telegraph(attack, target),
      startedAt: time,
      frameIndex: 0
    }
    this.frame = attack.frames[0] || 'idle'
    events.push({
      type: 'boss-telegraph',
      attack: attack.id,
      text: `${WORLD_BOSS.name} prepara ${attack.name}`
    })
  }

  advanceAction(player, time, events) {
    const action = this.action
    const frames = action.attack.frames || ['idle']
    const index = Math.min(frames.length - 1, Math.floor((time - action.startedAt) / FRAME_TICKS))
    action.frameIndex = index
    this.frame = frames[index]

    if (time - action.startedAt < frames.length * FRAME_TICKS) return
    this.release(action.attack, action.target, time)
    events.push({
      type: 'boss-cast',
      attack: action.attack.id,
      text: `${WORLD_BOSS.name} lanza ${action.attack.name}`
    })
    this.action = null
    this.frame = 'idlePulse'
    this.nextAttackAt = time + ATTACK_GAP
  }

  release(attack, player, time) {
    const sx = Math.sign(player.x - this.x) || -1
    const sy = Math.sign(player.y - this.y)
    if (attack.id === 'onda') {
      for (const [dx, dy] of [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1]
      ]) {
        this.spawnHazard('wave', dx, dy, 6, '~', time, 34)
      }
      return
    }

    if (attack.id === 'barrido') {
      for (const offset of [-2, -1, 0, 1, 2]) {
        this.spawnHazard('sweep', sx, 0, 11, '=', time, 42, offset)
      }
      return
    }

    if (attack.id === 'colapso') {
      for (const [dx, dy] of [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1]
      ]) {
        this.spawnHazard('rune', dx, dy, 15, '*', time, 44)
      }
      return
    }

    // Los punos viajan como una descarga corta hacia el lado del jugador.
    const aimedRow = clamp(player.y - (this.y - 3), -8, 8)
    this.spawnHazard('fist', sx, 0, attack.damage, '#', time, 15, aimedRow)
  }

  /** Non-damaging cells that reveal the locked trajectory before release. */
  telegraph(attack, target) {
    const cells = []
    const mark = (x, y, glyph = '!') => {
      x = Math.round(x)
      y = Math.round(y)
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
      cells.push({ x, y, glyph })
    }
    const radial = (reach) => {
      for (const [dx, dy] of [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1]
      ]) {
        const sx = this.x + dx * (BODY_HALF_WIDTH + 1)
        const sy = this.y - 3 + dy * 2
        for (let step = 0; step <= reach; step += 2) mark(sx + dx * step, sy + dy * step)
      }
    }

    if (attack.id === 'onda' || attack.id === 'colapso') {
      radial(Math.max(4, Number(attack.reach) || 4))
    } else if (attack.id === 'barrido') {
      const dx = Math.sign(target.x - this.x) || -1
      const sx = this.x + dx * (BODY_HALF_WIDTH + 1)
      for (const offset of [-2, -1, 0, 1, 2]) {
        for (let step = 0; step <= Math.max(8, attack.reach * 2); step += 2) {
          mark(sx + dx * step, this.y - 3 + offset, '=')
        }
      }
    } else {
      const dx = Math.sign(target.x - this.x) || -1
      const sx = this.x + dx * (BODY_HALF_WIDTH + 1)
      const length = Math.max(6, Math.min(15, Math.abs(target.x - sx)))
      for (let step = 0; step <= length; step += 2) mark(sx + dx * step, target.y)
    }
    return uniqueCells(cells)
  }

  spawnHazard(kind, dx, dy, damage, glyph, time, ttl, yOffset = 0) {
    const startX = this.x + dx * (BODY_HALF_WIDTH + 1)
    const startY = clamp(this.y - 3 + yOffset + dy * 2, 1, this.height - 2)
    this.hazards.push({
      id: this.hazardId++,
      kind,
      x: startX,
      y: startY,
      dx,
      dy,
      damage,
      glyph,
      bornAt: time,
      nextStep: time + 1,
      ttl
    })
  }

  moveHazards(time) {
    for (const hazard of this.hazards) {
      if (time < hazard.nextStep) continue
      hazard.x += hazard.dx
      hazard.y += hazard.dy
      hazard.nextStep = time + 2
      hazard.ttl--
    }
    this.hazards = this.hazards.filter(
      (hazard) =>
        hazard.ttl > 0 &&
        hazard.x >= 0 &&
        hazard.y >= 0 &&
        hazard.x < this.width &&
        hazard.y < this.height
    )
  }

  /** Damage is applied once per contact and the touching power is consumed. */
  touch(player, time) {
    const touching = this.hazards.filter(
      (hazard) => distance(hazard.x, hazard.y, player.x, player.y) <= 1
    )
    if (!touching.length) return []

    const ids = new Set(touching.map((hazard) => hazard.id))
    this.hazards = this.hazards.filter((hazard) => !ids.has(hazard.id))
    if (time - this.lastPlayerHitAt < HIT_GRACE) return []

    const damage = Math.max(...touching.map((hazard) => hazard.damage))
    this.lastPlayerHitAt = time
    player.hp = Math.max(0, player.hp - damage)
    const events = [
      {
        type: 'boss-hit',
        damage,
        hp: player.hp,
        text: `el poder runico te alcanza: -${damage} vida`
      }
    ]
    if (player.hp === 0) events.push({ type: 'boss-death', text: 'el Coloso te derriba' })
    return events
  }

  snapshot() {
    return {
      id: WORLD_BOSS.id,
      name: WORLD_BOSS.name,
      x: this.x,
      y: this.y,
      hp: this.hp,
      maxhp: this.maxhp,
      active: this.active,
      defeated: this.defeated,
      frame: this.frame,
      phase: phaseFor(this.hp, this.maxhp).id,
      action: this.action ? this.action.attack.id : null,
      target: this.action ? { ...this.action.target } : null,
      telegraphs: this.action ? this.action.telegraphs.map((cell) => ({ ...cell })) : [],
      hazards: this.hazards.map((hazard) => ({ ...hazard }))
    }
  }
}

module.exports = {
  WorldBossEvent,
  ACTIVATION_RANGE,
  DISENGAGE_RANGE,
  BODY_HALF_WIDTH,
  FRAME_TICKS,
  ATTACK_GAP,
  HIT_GRACE,
  bossCamera
}
