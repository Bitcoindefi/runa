'use strict'

/**
 * All content, as data.
 *
 * Nothing here is code, which is the point: a new foe or item is a few lines in
 * this object, so shipping one is an over-the-air data update rather than a new
 * build of the engine. The running game already knows how to read anything that
 * appears here.
 *
 * Balance note, and it is the most important thing in this file: the profiles
 * are deliberately far apart. If the sword and the crossbow were within twenty
 * percent of each other, picking the wrong one would cost the player a slightly
 * longer fight and they would never notice their script was wrong. The gap has
 * to be wide enough that a bad rule loses the fight on screen, because the
 * whole game is watching a rule fail and fixing it.
 */

const items = {
  sword: {
    id: 'sword',
    name: 'espada',
    hand: 'left',
    glyph: '/',
    atk: 4,
    reach: 2,
    cooldown: 20,
    speed: 0,
    about: 'pega fuerte, pero tenes que estar encima'
  },

  crossbow: {
    id: 'crossbow',
    name: 'ballesta',
    hand: 'left',
    glyph: '}',
    atk: 2,
    reach: 14,
    cooldown: 17,
    speed: 0,
    about: 'llega lejos, pega poco'
  },

  shield: {
    id: 'shield',
    name: 'escudo',
    hand: 'right',
    glyph: '0',
    atk: 0,
    reach: 0,
    cooldown: 0,
    speed: -0.08,
    about: 'te frena, pero aguanta'
  },

  boots: {
    id: 'boots',
    name: 'botas',
    hand: 'right',
    glyph: '^',
    atk: 0,
    reach: 0,
    cooldown: 0,
    speed: 0.18,
    about: 'cerras distancia mas rapido'
  }
}

/**
 * Foes.
 *
 * `stats` is what the fight reads and is balanced by hand: leave it alone.
 * Everything beside it is what the field reads.
 *
 *  - `zone` is the ring the foe lives in, counted out from the town gate. It is
 *    the only place difficulty-by-distance is written down: the field asks the
 *    foe where it belongs, never the other way round, so a new enemy reaches
 *    its ring by data alone.
 *  - `drop` is what killing it is worth. Gold is a range so two mosquitoes are
 *    not the same mosquito; experience is flat, because a player counting up to
 *    the next level should be able to count.
 *  - `aggro` is optional and overrides the ring's notice distance for a foe
 *    that should find you rather than be found.
 */
const foes = {
  /**
   * The teaching enemy. It exists to punish exactly one mistake: fighting at
   * short reach. It closes fast and out-trades anything standing next to it,
   * so a script that only ever equips the sword loses, visibly, every time.
   */
  mosquito: {
    id: 'mosquito',
    name: 'mosquito',
    flying: true,
    glyph: '~',
    stats: { hp: 13, atk: 5, reach: 2, speed: 0.34, cooldown: 13 },
    zone: 0,
    aggro: 8,
    drop: { gold: [2, 5], xp: 3 },
    about: 'rapido y molesto, te come de cerca'
  },

  /**
   * The foe that arrives by OTA during the demo. It inverts the lesson: slow,
   * heavily armoured, and it reflects nothing, but its reach is long enough
   * that the crossbow no longer wins for free. The player who "solved" the
   * game with one rule has to write a second one.
   */
  golem: {
    id: 'golem',
    name: 'golem',
    flying: false,
    glyph: '#',
    stats: { hp: 30, atk: 6, reach: 13, speed: 0.10, cooldown: 30 },
    zone: 1,
    drop: { gold: [14, 22], xp: 18 },
    about: 'lento y duro, pero su brazo llega lejos'
  }
}

/**
 * Difficulty as geography: rings around the town gate, near to far.
 *
 * Distances are in visual cells, not grid steps, because a terminal cell is
 * about twice as tall as it is wide and a ring measured in raw steps draws as
 * an ellipse. See Y_SCALE in field.js.
 *
 * `until` is the outer edge of the ring. Anything past the last ring is still
 * in the last ring, so the map can be made bigger without touching this table.
 * `foes` is how many live bodies the ring holds at once, `aggro` how close you
 * can get before one starts a fight, `leash` how far one drifts from where the
 * seed put it, and `respawn` how many ticks a corpse stays gone. Thirty ticks
 * is a second: a pradera kill is back in fifteen, which is what makes farming
 * the near ring a real option instead of a wait.
 */
const zones = [
  {
    id: 'pradera',
    name: 'pradera',
    until: 34,
    foes: 6,
    aggro: 6,
    leash: 7,
    respawn: 450,
    ground: '.'
  },

  {
    id: 'yermo',
    name: 'yermo',
    until: 80,
    foes: 8,
    aggro: 9,
    leash: 9,
    respawn: 900,
    ground: ','
  }
]

module.exports = { items, foes, zones }
