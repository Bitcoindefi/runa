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
  dagger: {
    id: 'dagger',
    name: 'daga',
    hand: 'left',
    slot: 'left_hand',
    kind: 'weapon',
    glyph: ';',
    atk: 2,
    reach: 1,
    cooldown: 9,
    speed: 0.08,
    about: 'barata y rapidisima; exige pelear cuerpo a cuerpo'
  },

  sword: {
    id: 'sword',
    name: 'espada',
    hand: 'left',
    slot: 'left_hand',
    kind: 'weapon',
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
    slot: 'left_hand',
    kind: 'weapon',
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
    slot: 'right_hand',
    kind: 'shield',
    glyph: '0',
    atk: 0,
    reach: 0,
    cooldown: 0,
    speed: -0.08,
    defense: 2,
    about: 'te frena, pero reduce 2 de cada golpe'
  },

  boots: {
    id: 'boots',
    name: 'botas',
    slot: 'boots',
    kind: 'boots',
    glyph: '^',
    atk: 0,
    reach: 0,
    cooldown: 0,
    speed: 0.18,
    about: 'cerras distancia mas rapido'
  },

  spear: {
    id: 'spear',
    name: 'lanza de guerra',
    hand: 'left',
    slot: 'left_hand',
    kind: 'weapon',
    glyph: '|',
    atk: 3,
    reach: 6,
    cooldown: 21,
    speed: 0,
    about: 'alcance medio para mantener al enemigo a raya'
  },

  warhammer: {
    id: 'warhammer',
    name: 'martillo de guerra',
    hand: 'left',
    slot: 'left_hand',
    kind: 'weapon',
    glyph: 'T',
    atk: 7,
    reach: 2,
    cooldown: 34,
    speed: -0.08,
    about: 'el golpe mas pesado, a cambio de mucha lentitud'
  },

  longbow: {
    id: 'longbow',
    name: 'arco largo',
    hand: 'left',
    slot: 'left_hand',
    kind: 'weapon',
    glyph: ')',
    atk: 3,
    reach: 18,
    cooldown: 23,
    speed: -0.03,
    about: 'domina la distancia, pero tarda en preparar cada flecha'
  },

  leather: {
    id: 'leather',
    name: 'cuero liviano',
    slot: 'chest',
    kind: 'armor',
    glyph: '{',
    atk: 0,
    reach: 0,
    cooldown: 0,
    speed: 0.1,
    defense: 1,
    about: 'proteccion inicial que tambien ayuda a moverte'
  },

  chainmail: {
    id: 'chainmail',
    name: 'cota de malla',
    slot: 'chest',
    kind: 'armor',
    glyph: '#',
    atk: 0,
    reach: 0,
    cooldown: 0,
    speed: -0.1,
    defense: 3,
    about: 'buena defensa con una penalizacion moderada de velocidad'
  },

  plate: {
    id: 'plate',
    name: 'armadura de placas',
    slot: 'chest',
    kind: 'armor',
    glyph: 'H',
    atk: 0,
    reach: 0,
    cooldown: 0,
    speed: -0.2,
    defense: 5,
    about: 'la mayor defensa disponible; pesa en cada paso'
  },

  leather_cap: {
    id: 'leather_cap',
    name: 'capucha de cuero',
    slot: 'head',
    kind: 'helmet',
    glyph: '(',
    atk: 0,
    reach: 0,
    cooldown: 0,
    speed: 0.03,
    defense: 1,
    about: 'proteccion ligera para la cabeza sin perder movilidad'
  },

  iron_helmet: {
    id: 'iron_helmet',
    name: 'yelmo de hierro',
    slot: 'head',
    kind: 'helmet',
    glyph: '[',
    atk: 0,
    reach: 0,
    cooldown: 0,
    speed: -0.04,
    defense: 2,
    about: 'un yelmo cerrado que protege a cambio de algo de velocidad'
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
   * Llego por OTA. Existe para probar la tesis del proyecto: el contenido son
   * datos, asi que publicar un bicho nuevo no es un build nuevo para el jugador,
   * es una release que su copia agarra de sus pares mientras esta jugando.
   */
  espectro: {
    id: 'espectro',
    name: 'espectro',
    flying: true,
    glyph: '&',
    stats: { hp: 16, atk: 4, reach: 9, speed: 0.2, cooldown: 24 },
    drop: { gold: [8, 14], xp: 6 },
    zone: 'near',
    about: 'no lo ves venir hasta que ya te esta pegando'
  },

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
    stats: { hp: 30, atk: 6, reach: 13, speed: 0.1, cooldown: 30 },
    zone: 1,
    drop: { gold: [14, 22], xp: 18 },
    about: 'lento y duro, pero su brazo llega lejos'
  },

  slime: {
    id: 'slime',
    name: 'slime',
    flying: false,
    glyph: 'o',
    stats: { hp: 9, atk: 2, reach: 1, speed: 0.16, cooldown: 24 },
    zone: 'dungeon1',
    drop: { gold: [2, 4], xp: 4 },
    about: 'una masa debil que ocupa las primeras galerias'
  },

  skeleton: {
    id: 'skeleton',
    name: 'esqueleto',
    flying: false,
    glyph: 's',
    stats: { hp: 17, atk: 4, reach: 2, speed: 0.18, cooldown: 22 },
    zone: 'dungeon1',
    drop: { gold: [6, 10], xp: 8 },
    about: 'un guardian reanimado de las criptas'
  },

  skeleton_knight: {
    id: 'skeleton_knight',
    name: 'caballero esqueleto',
    flying: false,
    glyph: 'k',
    stats: { hp: 29, atk: 7, reach: 3, speed: 0.12, cooldown: 27 },
    zone: 'dungeon2',
    drop: { gold: [12, 18], xp: 16 },
    about: 'armadura oxidada, escudo y una disciplina que sobrevivio a la muerte'
  },

  skeleton_archer: {
    id: 'skeleton_archer',
    name: 'arquero esqueleto',
    flying: false,
    glyph: 'a',
    stats: { hp: 21, atk: 6, reach: 16, speed: 0.14, cooldown: 25 },
    zone: 'dungeon2',
    drop: { gold: [10, 16], xp: 15 },
    about: 'dispara desde el fondo de las camaras funerarias'
  },

  skeleton_elite: {
    id: 'skeleton_elite',
    name: 'esqueleto de elite',
    flying: false,
    glyph: 'E',
    stats: { hp: 43, atk: 9, reach: 5, speed: 0.17, cooldown: 23 },
    zone: 'dungeon3',
    drop: { gold: [22, 32], xp: 28 },
    about: 'la guardia negra del rey esqueleto'
  },

  skeleton_king: {
    id: 'skeleton_king',
    name: 'rey esqueleto',
    flying: false,
    glyph: 'K',
    stats: { hp: 82, atk: 11, reach: 8, speed: 0.14, cooldown: 24 },
    zone: 'dungeon3',
    drop: { gold: [80, 110], xp: 90 },
    about: 'el soberano no muerto que aguarda en el tercer nivel'
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
