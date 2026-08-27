'use strict'

const { GUARD_MASTER, makeMovingPersonSprite } = require('./sprites.js')
const { COLISEUM_ROWS, COLISEUM_META } = require('./coliseum.js')

/**
 * The walkable world: the city, the field, and the rules for stepping around
 * them.
 *
 * Three decisions shape this file.
 *
 *  1. Maps are ASCII art, not arrays of tile objects. The art IS the source, so
 *     moving a shop is editing a string, and the map can be read in a diff. It
 *     also means a new map is data, which is the same property `content.js`
 *     buys for items and foes: it can ship over the air without a new build.
 *
 *  2. What a character means lives in one table, `TILES`, never in a chain of
 *     ifs. Adding a building is one row in that table plus one letter in the
 *     art, and nothing in the movement code changes.
 *
 *  3. A terminal cell is about twice as tall as it is wide. Everything here is
 *     drawn wide and short on purpose: a building that looks square in the
 *     source would render as a tall tower on screen. The city is wider than one
 *     terminal so its larger districts can scroll without flattening the art.
 */

/**
 * What each character in the art is.
 *
 * `solid` is the only thing movement reads. `enter` is what standing on the
 * cell offers the game: it is a descriptor, not a callback, so the game layer
 * decides what a shop actually does and this file stays about walking.
 */
const TILES = {
  '#': { id: 'wall', name: 'una pared', solid: true },
  '+': { id: 'wall', name: 'una pared', solid: true },
  '-': { id: 'wall', name: 'una pared', solid: true },
  '|': { id: 'wall', name: 'una pared', solid: true },
  '^': { id: 'roof', name: 'un tejado', solid: true },
  '/': { id: 'roof', name: 'un tejado', solid: true },
  '\\': { id: 'roof', name: 'un tejado', solid: true },
  _: { id: 'masonry', name: 'la mamposteria', solid: true },
  '[': { id: 'window', name: 'una ventana', solid: true },
  ']': { id: 'window', name: 'una ventana', solid: true },
  '(': { id: 'ornament', name: 'un adorno', solid: true },
  ')': { id: 'ornament', name: 'un adorno', solid: true },
  '{': { id: 'ornament', name: 'un adorno', solid: true },
  '}': { id: 'ornament', name: 'un adorno', solid: true },
  '.': { id: 'road', name: 'la calle', solid: false },
  ';': { id: 'cobble', name: 'los adoquines', solid: false },
  ',': { id: 'grass', name: 'el pasto', solid: false },
  '"': { id: 'tall-grass', name: 'el pasto alto', solid: false },
  '%': { id: 'gravel', name: 'la grava', solid: false },
  '*': { id: 'flower', name: 'unas flores', solid: false },
  O: { id: 'fountain', name: 'una fuente', solid: true },
  ':': { id: 'building', name: 'un edificio', solid: true },
  o: { id: 'rock', name: 'una piedra', solid: true },
  t: { id: 'tree', name: 'un arbol', solid: true },
  '~': { id: 'water', name: 'el agua', solid: true },

  C: { id: 'door.home', name: 'tu casa', solid: false, enter: { kind: 'home' } },
  I: { id: 'door.church', name: 'la iglesia', solid: false, enter: { kind: 'church' } },
  P: {
    id: 'door.potions',
    name: 'la tienda de pociones',
    solid: false,
    enter: { kind: 'shop', shop: 'potions' }
  },
  A: {
    id: 'door.weapons',
    name: 'la tienda de armas',
    solid: false,
    enter: { kind: 'shop', shop: 'weapons' }
  },
  D: {
    id: 'door.armor',
    name: 'la tienda de armaduras',
    solid: false,
    enter: { kind: 'shop', shop: 'armor' }
  },
  T: {
    id: 'door.tavern',
    name: 'la taberna',
    solid: false,
    enter: { kind: 'tavern' }
  },

  '>': {
    id: 'gate.field',
    name: 'la salida al campo',
    solid: false,
    enter: { kind: 'travel', to: 'field' }
  },
  '<': {
    id: 'gate.city',
    name: 'la entrada a la ciudad',
    solid: false,
    enter: { kind: 'travel', to: 'city' }
  },
  V: {
    id: 'gate.dungeon',
    name: 'la escalera a las ruinas',
    solid: false,
    enter: { kind: 'travel', to: 'dungeon' }
  },
  U: {
    id: 'gate.dungeon-return',
    name: 'la escalera al castillo',
    solid: false,
    enter: { kind: 'travel', to: 'city', returnTo: 'dungeon' }
  },
  K: {
    id: 'gate.castle',
    name: 'la entrada al castillo',
    solid: false,
    enter: { kind: 'travel', to: 'castle' }
  },
  B: {
    id: 'gate.castle-return',
    name: 'la salida del castillo',
    solid: false,
    enter: { kind: 'travel', to: 'city', returnTo: 'castle' }
  },
  N: {
    id: 'gate.nox',
    name: 'la frontera al reino enemigo',
    solid: false,
    enter: { kind: 'travel', to: 'nox' }
  },
  R: {
    id: 'gate.runa-return',
    name: 'la frontera al reino de runa',
    solid: false,
    enter: { kind: 'travel', to: 'city', arrival: 'noxBorder' }
  },
  Q: {
    id: 'gate.coliseum-return',
    name: 'la salida del coliseo',
    solid: false,
    enter: { kind: 'travel', to: 'city' }
  }
}

/**
 * Building names are painted straight into the art, so every remaining
 * lowercase letter has to be solid. Registering them in bulk beats listing
 * them one by one: renaming a shop must never punch a hole in its own wall.
 */
for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
  if (!TILES[ch]) TILES[ch] = { id: 'sign', name: 'un cartel', solid: true }
}

/** Anything the art does not define, and anything off the edge. Solid, always. */
const NOWHERE = { id: 'nowhere', name: 'la nada', solid: true }

/** Doors, for the on-screen legend. Order is reading order, not table order. */
const LEGEND = [
  { glyph: 'C', text: 'tu casa' },
  { glyph: 'I', text: 'iglesia' },
  { glyph: 'P', text: 'pociones' },
  { glyph: 'A', text: 'armas' },
  { glyph: 'D', text: 'armaduras' },
  { glyph: 'T', text: 'taberna' },
  { glyph: 'V', text: 'dungeon' },
  { glyph: 'N', text: 'reino de nox' },
  { glyph: 'R', text: 'reino de runa' },
  { glyph: '>', text: 'al campo' },
  { glyph: '<', text: 'a la ciudad' }
]

/** The faithful source drawing remains available for future resolution tiers. */
const LEGACY_NPC_MASTER_SPRITES = {
  guard: [
    '         .I.',
    '        / : \\',
    '        |===|',
    '        >._.<',
    '    .=-<     >-=.',
    "   /.'`(`-+-')'`.\\",
    " _/`.__/  :  \\__.'\\_",
    "( `._/\\`. : .'/\\_.' )",
    " >-(_) \\ `:' / (_)-<",
    ' | |  / \\___/ \\  | |',
    " )^( | .' : `. | )^(",
    "|  _\\|`-._:_.-'| \\  |",
    '"-<\\)| :  |  : |  "-"',
    '  (\\\\| : / \\ : |',
    "    \\\\-:-| |-:-')",
    '     \\\\:_/ \\_:_/',
    '     |\\\\_| |_:_|',
    '     (;\\\\/ \\__;)',
    '     |: \\\\  | :|',
    '     \\: /\\\\ \\ :/',
    '     |==| \\\\|==|',
    "    /v-'(  \\\\`-v\\",
    "   // .-'   \\\\. \\\\",
    "   `-'       \\\\`-'    hjw",
    '              \\|'
  ]
}

/**
 * City actors use compact derivatives of their detailed master drawings. Six
 * rows keep them close to the five-row hero while horizontal detail preserves
 * each profession's silhouette.
 */
const LEGACY_NPC_SPRITES = {
  priest: [
    '      .+.',
    '     /___\\',
    '    ( - - )',
    ' .---\\ + /---.',
    '<___/|[+]|\\___>',
    '    /_| |_\\'
  ],
  resident: [
    '     .---.',
    '    /_   _\\',
    '    | o o |',
    ' .---\\  ^ /---.',
    '<___/|[V]|\\___>',
    '    /_| |_\\'
  ],
  tavern: [
    '     .---.',
    '    /_~_~_\\',
    '    ( o o )',
    ' .---\\_-_/---.__',
    '<___/|[U]|\\__|_]',
    '    /_| |_\\'
  ],
  alchemist: [
    '       /^\\',
    '      /___\\',
    '      (o o)',
    '  .---\\ ~ /---.o',
    ' <___/|{&}|\\___>|',
    '     /_| |_\\'
  ],
  smith: [
    '      _===_',
    '     /_____\\',
    '     ( o o )',
    '  .---\\_-_/---.---[==]',
    ' <___/|[T]|\\___>',
    '     /_| |_\\'
  ],
  armorer: [
    '       _A_',
    '      /_|_\\',
    '      |o o|',
    '  .===\\_-_/===.',
    ' <[O]=|[D]|=\\__>',
    '     /_| |_\\'
  ],
  guard: [
    '       .I.',
    '      / : \\',
    '      |===|',
    '  .=-< >._.< >-=.',
    ' <|==[|:+:|]==|>',
    '     /_| |_\\'
  ],
  villager: [
    '     .---.',
    '    /_____\\',
    '    ( o o )',
    ' .---\\  _/---.',
    '<___/|[V]|\\___>',
    '    /_| |_\\'
  ]
}

// Keep the old six-row drafts out of the renderer. They remain here only until
// the visual migration is complete and make it easy to compare silhouettes.
void LEGACY_NPC_MASTER_SPRITES
void LEGACY_NPC_SPRITES

const NPC_MASTER_SPRITES = {
  guard: GUARD_MASTER
}

const NPC_SPRITES = {
  priest: makeMovingPersonSprite('priest'),
  resident: makeMovingPersonSprite('resident'),
  tavern: makeMovingPersonSprite('tavern'),
  alchemist: makeMovingPersonSprite('alchemist'),
  smith: makeMovingPersonSprite('smith'),
  armorer: makeMovingPersonSprite('armorer'),
  guard: makeMovingPersonSprite('guard'),
  king: [' \\/\\/  ', ' [o_o] ', '|/[K]\\|', '|_/ \\_|'],
  villager: makeMovingPersonSprite('villager')
}

/** Static city residents. Their anchor is the ground cell beneath their feet. */
const CITY_NPCS = [
  {
    id: 'alma',
    name: 'hermana Alma',
    role: 'sacerdotisa',
    x: 25,
    y: 130,
    sprite: NPC_SPRITES.priest,
    anchorY: NPC_SPRITES.priest.length - 1,
    color: 'cyan',
    action: { kind: 'church' },
    line: 'la iglesia siempre tiene una cama libre'
  },
  {
    id: 'lina',
    name: 'Lina',
    role: 'vecina',
    x: 90,
    y: 130,
    sprite: NPC_SPRITES.resident,
    anchorY: NPC_SPRITES.resident.length - 1,
    color: 'green',
    line: 'la plaza cambia cuando llegan viajeros'
  },
  {
    id: 'bruno',
    name: 'Bruno',
    role: 'tabernero',
    x: 230,
    y: 130,
    sprite: NPC_SPRITES.tavern,
    anchorY: NPC_SPRITES.tavern.length - 1,
    color: 'yellow',
    action: { kind: 'tavern' },
    line: 'por tres monedas recuperas toda la vida'
  },
  {
    id: 'iris',
    name: 'Iris',
    role: 'alquimista',
    x: 295,
    y: 130,
    sprite: NPC_SPRITES.alchemist,
    anchorY: NPC_SPRITES.alchemist.length - 1,
    color: 'magenta',
    action: { kind: 'shop', shop: 'potions' },
    line: 'tengo pociones recien preparadas'
  },
  {
    id: 'brom',
    name: 'Brom',
    role: 'herrero',
    x: 25,
    y: 180,
    sprite: NPC_SPRITES.smith,
    anchorY: NPC_SPRITES.smith.length - 1,
    color: 'yellow',
    action: { kind: 'shop', shop: 'weapons' },
    line: 'una buena hoja termina las peleas antes'
  },
  {
    id: 'vera',
    name: 'Vera',
    role: 'armera',
    x: 295,
    y: 180,
    sprite: NPC_SPRITES.armorer,
    anchorY: NPC_SPRITES.armorer.length - 1,
    color: 'cyan',
    action: { kind: 'shop', shop: 'armor' },
    line: 'el escudo pesa menos que una derrota'
  },
  {
    id: 'roan',
    name: 'Roan',
    role: 'guardia',
    x: 115,
    y: 180,
    sprite: NPC_SPRITES.guard,
    anchorY: NPC_SPRITES.guard.length - 1,
    color: 'yellow',
    line: 'custodio el castillo; la V baja a las ruinas y el gran porton lleva a la pradera'
  },
  {
    id: 'nora',
    name: 'Nora',
    role: 'viajera',
    x: 85,
    y: 180,
    sprite: NPC_SPRITES.villager,
    anchorY: NPC_SPRITES.villager.length - 1,
    color: 'green',
    line: 'los monstruos pelean donde los alcanzas'
  },
  {
    id: 'teo',
    name: 'Teo',
    role: 'jardinero',
    x: 230,
    y: 180,
    sprite: NPC_SPRITES.villager,
    anchorY: NPC_SPRITES.villager.length - 1,
    color: 'green',
    line: 'cuido los canteros de la plaza y los jardines de la ciudad'
  },
  {
    id: 'cedric',
    name: 'sir Cedric',
    role: 'caballero de la plaza',
    x: 135,
    y: 155,
    sprite: NPC_SPRITES.guard,
    anchorY: NPC_SPRITES.guard.length - 1,
    color: 'yellow',
    action: { kind: 'quest', quest: 'mosquito_hunt' },
    line: 'los mosquitos invaden la pradera; necesito un cazador'
  }
]

/** Assemble the larger city from readable building-sized pieces. */
function makeCityRows() {
  const width = 160
  const height = 80
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ((x * 17 + y * 29) % 23 === 0 ? '"' : ','))
  )

  const fill = (x, y, w, h, ch) => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) grid[row][col] = ch
    }
  }
  const stamp = (x, y, art) => {
    for (let row = 0; row < art.length; row++) {
      const first = art[row].search(/\S/)
      if (first === -1) continue
      let last = art[row].length - 1
      while (last > first && art[row][last] === ' ') last--
      for (let col = first; col <= last; col++) grid[y + row][x + col] = art[row][col]
    }
  }

  fill(0, 0, width, 1, '#')
  fill(0, height - 1, width, 1, '#')
  fill(0, 0, 1, height, '#')
  fill(width - 1, 0, 1, height, '#')

  fill(78, 1, 5, height - 2, '.')
  fill(1, 25, width - 2, 4, '.')
  fill(61, 27, 39, 18, ';')
  fill(1, 47, width - 2, 4, '.')
  fill(1, 67, width - 2, 4, '.')
  fill(54, 2, 53, 20, ';')
  fill(28, 25, 3, 42, '.')
  fill(129, 25, 3, 42, '.')

  for (const [x, y] of [
    [6, 25],
    [36, 27],
    [122, 26],
    [153, 27],
    [5, 49],
    [154, 49],
    [45, 68],
    [115, 68]
  ]) {
    grid[y][x] = 't'
  }
  for (const [x, y] of [
    [10, 26],
    [25, 27],
    [133, 26],
    [150, 27],
    [49, 48],
    [111, 48],
    [46, 66],
    [114, 66]
  ]) {
    grid[y][x] = '*'
  }

  stamp(7, 6, [
    '+------------------------------+',
    '| "" * "" * "" * "" * "" * "" |',
    '|    +------+    +------+      |',
    '| "  |~~~~~~| "  |~~~~~~|  *   |',
    '|    |~~O~~~|    |~~~O~~|      |',
    '| *  +------+  " +------+  "   |',
    '+------------------------------+'
  ])

  stamp(121, 6, [
    '+------------------------------+',
    '| "" * "" * "" * "" * "" * "" |',
    '|      +------+    +------+    |',
    '|  *   |~~~~~~| "  |~~~~~~|  " |',
    '|      |~~O~~~|    |~~~O~~|    |',
    '|   "  +------+  * +------+  " |',
    '+------------------------------+'
  ])

  stamp(52, 55, [
    '+------------------------------------------------------+',
    '| []  toldos del mercado  []   []   []   []   []     |',
    '| /\   /\   /\   /\   /\   /\   /\   /\   /\    |',
    '| ..   ..   ..   ..   ..   ..   ..   ..   ..        |',
    '+------------------------------------------------------+'
  ])

  stamp(72, 30, [
    '+--------------+',
    '|   ~~~~~~~~   |',
    '| ~~   OO   ~~ |',
    '|   ~~~~~~~~   |',
    '+--------------+'
  ])

  stamp(7, 30, [
    '         +         ',
    '        /|\\        ',
    '       /_|_\\       ',
    '      /_____\\      ',
    '     /_[]_[]_\\     ',
    '    /_________\\    ',
    '   /___________\\   ',
    '  |  []     []  |  ',
    '  |   iglesia   |  ',
    '  |     (+)     |  ',
    '  |      +      |  ',
    '  |______I______|  '
  ])

  stamp(40, 30, [
    '      /\\/\\      ',
    '     /^^^^^^\\     ',
    '    /_/\\/\\_\\    ',
    '   /__________\\   ',
    '  /____________\\  ',
    '  | []      [] |  ',
    '  |    hogar   |  ',
    '  |  __    __  |  ',
    '  | |[]|  |  | |  ',
    '  |_|__|__|C_|_|  '
  ])

  stamp(100, 29, [
    '       _T_       ',
    '      /___\\      ',
    '     /_____\\     ',
    '    /_/\\_/\\_\\    ',
    '   /_________\\   ',
    '  /___________\\  ',
    '  | []     [] |  ',
    '  |  taberna   |  ',
    '  | ()  __  () |  ',
    '  |____|T_|____|  '
  ])

  stamp(131, 29, [
    '      __    o      ',
    '   __/  \\__/\\     ',
    '  /_/\\/\\/\\/\\_\\    ',
    ' /______________\\   ',
    '/________________\\  ',
    '| ()   {}    ()  |  ',
    '|   pociones     |  ',
    '| []   /\\   []  |  ',
    '|     /__\\      |  ',
    '|______P_________|  '
  ])

  stamp(14, 52, [
    '       _/\\_          ',
    '      /_||_\\         ',
    '   __/______\\___     ',
    '  /_/\\/\\/\\/\\/\\_\\    ',
    ' /__________________\\   ',
    '|  /\\   herreria    |   ',
    '|  ||  []      []   |   ',
    '| [==]    /\\       |   ',
    '|        /__\\      |   ',
    '|_________A_________|   '
  ])

  stamp(129, 52, [
    '       _/\\_          ',
    '      /####\\         ',
    '   __/######\\___     ',
    '  /_############_\\    ',
    ' /__________________\\   ',
    '| [####]  armadura  |   ',
    '|  [||] []     []  |   ',
    '| []     /\\       |   ',
    '|       /__\\      |   ',
    '|________D_________|   '
  ])

  stamp(58, 2, [
    '    |>                    <|    ',
    '    |^^^|       /\\       |^^^|    ',
    '  __|___|__    /__\\    __|___|__  ',
    ' /#########\\__/^^^^\\__/#########\\ ',
    '| []   []   |/______\\|   []   [] |',
    '|  _   _    | castillo |    _   _  |',
    '| |#| |#|   | []  [] |   |#| |#| |',
    '|           |========|           |',
    '|   |---|___| []  [] |___|---|   |',
    '|   |   |   |________|   |   |   |',
    '|   |   |     /----\\     |   |   |',
    '|   |   |     | /\\ |     |   |   |',
    '|   |   |_____|_V__|_____|   |   |',
    '|___|_____________________|___|___|'
  ])

  stamp(68, 72, [
    ' /####\\              /####\\ ',
    '| [] |    porton    | [] |',
    '|____|              |____|',
    '|    |..............|    |',
    '|____|______....____|____|',
    '            ....          ',
    '            ....          '
  ])

  // The transition lives on the gatehouse threshold itself: stepping through
  // the visible porton is what opens the meadow, not a tiny marker below it.
  grid[76][80] = '>'
  for (let x = 78; x <= 82; x++) grid[height - 1][x] = '.'
  return grid.map((row) => row.join(''))
}

// Archived only as a source comparison while the 320x200 migration settles;
// it is never selected by MAPS or exported.
void makeCityRows

const PLAZA_FOUNTAIN = {
  x: 137,
  y: 141,
  art: [
    '                     .^.',
    '                    /___\\',
    '                _   |o o|   _',
    '               /_\\_/| H |\\_/_\\',
    '                  /_|___|_\\',
    '              .---/  / \\  \\---.',
    '              \\____/___\\____/',
    '                    |||',
    '              .-----|||-----.',
    '             /      |||      \\',
    '             \\______|||______/',
    '                    |||',
    '        .-----------|||-----------.',
    '    ___/                           \\___',
    '   /~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\\',
    '  |~~~~~~~~~~~~~           ~~~~~~~~~~~~~|',
    '  |           heroes runa              |',
    '   \\___________________________________/',
    "    '================================='"
  ].map((row) => row.padEnd(47))
}

function makeHighResolutionCityRows() {
  const width = 320
  const height = 200
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ((x * 17 + y * 29) % 31 === 0 ? '"' : ','))
  )

  const set = (x, y, ch) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    grid[y][x] = ch
  }
  const fill = (x, y, w, h, ch) => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) set(col, row, ch)
    }
  }
  const write = (x, y, text) => {
    for (let i = 0; i < String(text).length; i++) set(x + i, y, String(text)[i])
  }
  const centred = (x, y, w, text) => write(x + Math.floor((w - String(text).length) / 2), y, text)
  const border = (x, y, w, h, horizontal = '-', vertical = '|') => {
    for (let col = x + 1; col < x + w - 1; col++) {
      set(col, y, horizontal)
      set(col, y + h - 1, horizontal)
    }
    for (let row = y + 1; row < y + h - 1; row++) {
      set(x, row, vertical)
      set(x + w - 1, row, vertical)
    }
    set(x, y, '+')
    set(x + w - 1, y, '+')
    set(x, y + h - 1, '+')
    set(x + w - 1, y + h - 1, '+')
  }

  const building = ({ x, y, w, h, name, door, roof = '^' }) => {
    const roofH = Math.min(9, Math.max(5, Math.floor(w / 8)))
    for (let row = 0; row < roofH; row++) {
      const left = x + roofH - row
      const right = x + w - roofH + row - 1
      set(left, y + row, '/')
      set(right, y + row, '\\')
      for (let col = left + 1; col < right; col++) {
        const tile = row === roofH - 1 ? '_' : (col + row) % 7 === 0 ? ':' : roof
        set(col, y + row, tile)
      }
    }

    const wallY = y + roofH
    const bottom = y + h - 1
    fill(x + 1, wallY + 1, w - 2, bottom - wallY - 1, ' ')
    for (let row = wallY; row <= bottom; row++) {
      set(x, row, '|')
      set(x + w - 1, row, '|')
    }
    for (let col = x; col < x + w; col++) {
      set(col, wallY, '_')
      set(col, bottom, '_')
    }
    set(x, wallY, '|')
    set(x + w - 1, wallY, '|')
    set(x, bottom, '|')
    set(x + w - 1, bottom, '|')

    // Corner pillars and broken masonry courses add depth without opening
    // holes in the solid footprint of the building.
    for (let row = wallY + 1; row < bottom; row++) {
      set(x + 2, row, row % 2 ? ':' : '|')
      set(x + w - 3, row, row % 2 ? ':' : '|')
      if ((row - wallY) % 6 === 0) {
        for (let col = x + 3; col < x + w - 3; col += 4) set(col, row, ':')
      }
    }

    centred(x, wallY + 3, w, name)
    const windowRows = [wallY + 7, wallY + 13].filter((row) => row < bottom - 8)
    for (const row of windowRows) {
      write(x + 6, row, '[====]')
      write(x + w - 12, row, '[====]')
      write(x + 6, row + 1, '[||||]')
      write(x + w - 12, row + 1, '[||||]')
    }

    const doorX = x + Math.floor(w / 2) - 4
    const doorTop = Math.max(wallY + 8, bottom - 9)
    write(doorX, doorTop, '/------\\')
    for (let row = doorTop + 1; row < bottom; row++) {
      set(doorX, row, '|')
      set(doorX + 7, row, '|')
    }
    set(doorX + 3, doorTop + 4, 'o')
    write(doorX, bottom - 1, '|______|')
    write(doorX, bottom, `|___${door}__|`)
    return { doorX: doorX + 4, doorY: bottom }
  }

  const clearLot = (x, y, w, h) => fill(x, y, w, h, ',')

  /**
   * A tall nave, bell tower and rose window adapted to the map's wide terminal
   * cells. The silhouette is based on classic church ASCII by Joan G. Stark;
   * it is redrawn at this map's native scale instead of stretching the source.
   */
  const churchBuilding = () => {
    const x = 6
    const y = 68
    const w = 66
    const bottom = 111
    clearLot(x, y, w, bottom - y + 1)

    // Broad nave and steep tiled roof.
    for (let row = 0; row < 7; row++) {
      const left = x + 8 - row
      const right = x + w - 9 + row
      write(left, y + 10 + row, '/' + '^'.repeat(right - left - 1) + '\\')
    }
    fill(x + 2, y + 17, w - 4, bottom - y - 16, ' ')
    border(x + 2, y + 17, w - 4, bottom - y - 16, '_', '|')

    // Central bell tower and spire deliberately break the shop-like roofline.
    write(x + 30, y, '+')
    write(x + 28, y + 1, '/|\\')
    write(x + 27, y + 2, '/_|_\\')
    write(x + 25, y + 3, '/_____\\')
    write(x + 23, y + 4, '/__[]___\\')
    fill(x + 22, y + 5, 22, bottom - y - 4, ' ')
    border(x + 22, y + 5, 22, bottom - y - 4, '=', '|')
    write(x + 29, y + 7, '/\\  /\\')
    write(x + 29, y + 8, '||  ||')
    write(x + 29, y + 9, '\\/  \\/')
    centred(x + 2, y + 20, w - 4, 'iglesia de la luz')
    write(x + 28, y + 23, '.-====-.')
    write(x + 28, y + 24, '| \\+/ |')
    write(x + 28, y + 25, '| /+\\ |')
    write(x + 28, y + 26, "'-====-'")
    for (const wx of [x + 7, x + 51]) {
      write(wx, y + 25, '/\\')
      write(wx, y + 26, '||')
      write(wx, y + 27, '\\/')
    }
    for (const bx of [x + 3, x + w - 4]) {
      write(bx, y + 29, '/|')
      write(bx, y + 30, '||')
      write(bx, y + 31, '||')
    }

    const doorLeft = x + 29
    write(doorLeft, bottom - 10, ' /-----\\ ')
    for (let row = bottom - 9; row < bottom; row++) write(doorLeft, row, ' |     | ')
    write(doorLeft, bottom - 6, ' |  o  | ')
    write(doorLeft, bottom - 1, ' |_____| ')
    write(doorLeft, bottom, '|___I___|')
    return { doorX: x + 33, doorY: bottom }
  }

  /** A low timber cottage with an off-centre chimney and dormer. */
  const homeBuilding = () => {
    const x = 78
    const y = 76
    const w = 43
    const bottom = 111
    clearLot(x, y - 5, w, bottom - y + 6)
    write(x + 29, y - 5, ' ( )')
    write(x + 29, y - 4, '(   )')
    write(x + 30, y - 3, '|##|')
    write(x + 30, y - 2, '|##|')
    for (let row = 0; row < 7; row++) {
      const left = x + 8 - row
      const right = x + w - 6 + row
      write(left, y + row, '/' + '='.repeat(right - left - 1) + '\\')
    }
    fill(x + 3, y + 7, w - 6, bottom - y - 6, ' ')
    border(x + 3, y + 7, w - 6, bottom - y - 6, '_', '|')
    centred(x + 3, y + 9, w - 6, 'hogar')
    write(x + 7, y + 12, '[==]      /\\      [==]')
    write(x + 7, y + 13, '[||]     /__\\     [||]')
    write(x + 4, y + 16, '|\\       /||\\       /|')
    write(x + 4, y + 17, '| \\_____/ || \\_____/ |')
    write(x + 4, y + 20, '| /     \\ || /     \\ |')
    write(x + 4, y + 21, '|/_______\\||/_______\\|')
    const doorLeft = x + 18
    write(doorLeft, bottom - 7, '/-----\\')
    for (let row = bottom - 6; row < bottom; row++) write(doorLeft, row, '|     |')
    write(doorLeft, bottom - 3, '|  o  |')
    write(doorLeft, bottom - 1, '|_____|')
    write(doorLeft, bottom, '|__C__|')
    return { doorX: x + 21, doorY: bottom }
  }

  /** Two-storey half-timbered inn with a hanging sign and street barrels. */
  const tavernBuilding = () => {
    const x = 199
    const y = 76
    const w = 51
    const bottom = 111
    clearLot(x, y, w, bottom - y + 1)
    write(x + 40, y + 4, '----. ')
    write(x + 44, y + 5, '|()| ')
    write(x + 44, y + 6, '|__| ')
    for (let row = 0; row < 6; row++) {
      const left = x + 5 - row
      const right = x + w - 6 + row
      write(left, y + 3 + row, '/' + '='.repeat(right - left - 1) + '\\')
    }
    fill(x + 1, y + 9, w - 2, bottom - y - 8, ' ')
    border(x + 1, y + 9, w - 2, bottom - y - 8, '=', '|')
    centred(x + 1, y + 11, w - 2, 'la jarra dorada')
    write(x + 5, y + 14, '[||||]  /\\  /\\  /\\  /\\  [||||]')
    write(x + 5, y + 15, '[====] /__\\/__\\/__\\/__\\ [====]')
    write(x + 2, y + 18, '|\\  /|                    |\\  /|')
    write(x + 2, y + 19, '| \\/ |____[== jarra ==]___| \\/ |')
    write(x + 2, y + 20, '| /\\ |                    | /\\ |')
    write(x + 4, y + 24, '(__)                      (__)')
    write(x + 4, y + 25, '|  |                      |  |')
    const doorLeft = x + 21
    write(doorLeft, bottom - 8, '/-------\\')
    for (let row = bottom - 7; row < bottom; row++) write(doorLeft, row, '|       |')
    write(doorLeft, bottom - 4, '| o   o |')
    write(doorLeft, bottom - 1, '|_______|')
    write(doorLeft, bottom, '|___T___|')
    return { doorX: x + 25, doorY: bottom }
  }

  /** A crooked apothecary capped by a glassy dome and three bottle windows. */
  const potionBuilding = () => {
    const x = 256
    const y = 68
    const w = 58
    const bottom = 111
    clearLot(x, y, w, bottom - y + 1)
    write(x + 38, y, '    o')
    write(x + 38, y + 1, ' o ( ) o')
    write(x + 39, y + 2, '  /~\\')
    write(x + 12, y + 3, '       .---~~~~---.')
    write(x + 12, y + 4, '    .-~            ~-.')
    write(x + 12, y + 5, '  /~   o   o   o      ~\\')
    write(x + 8, y + 6, '/__[]__/\\__/\\__/\\__[]__\\')
    write(x + 4, y + 7, '/______________________________\\')
    fill(x + 5, y + 8, w - 10, bottom - y - 7, ' ')
    border(x + 5, y + 8, w - 10, bottom - y - 7, '~', '|')
    centred(x + 5, y + 11, w - 10, 'pociones y elixires')
    write(x + 10, y + 15, '  o       o       o       o  ')
    write(x + 10, y + 16, ' /\\     /\\     /\\     /\\ ')
    write(x + 10, y + 17, '/::\\   /~~\\   /..\\   /++\\')
    write(x + 10, y + 18, '\\__/   \\__/   \\__/   \\__/')
    write(x + 7, y + 22, '[::::]      { elixires }      [::::]')
    write(x + 7, y + 23, '[____]                         [____]')
    const doorLeft = x + 25
    write(doorLeft, bottom - 9, ' .-----. ')
    write(doorLeft, bottom - 8, '/       \\')
    for (let row = bottom - 7; row < bottom; row++) write(doorLeft, row, '|       |')
    write(doorLeft, bottom - 4, '|   o   |')
    write(doorLeft, bottom - 1, '|_______|')
    write(doorLeft, bottom, '|___P___|')
    return { doorX: x + 29, doorY: bottom }
  }

  /** Low, smoke-blackened forge with an open work bay and massive chimney. */
  const smithBuilding = () => {
    const x = 5
    const y = 132
    const w = 74
    const bottom = 171
    clearLot(x, y - 8, w, bottom - y + 9)
    write(x + 8, y - 8, ' ( )')
    write(x + 8, y - 7, '(   )')
    write(x + 9, y - 6, '|##|')
    write(x + 9, y - 5, '|##|')
    write(x + 9, y - 4, '|##|')
    write(x + 5, y, ' __/^^^^^\\____/^^^^^\\____/^^^^^\\__')
    write(x + 3, y + 1, '/______________________________________\\')
    fill(x + 3, y + 2, w - 6, bottom - y - 1, ' ')
    border(x + 3, y + 2, w - 6, bottom - y - 1, '_', '|')
    centred(x + 3, y + 4, w - 6, 'herreria del yunque')
    write(x + 7, y + 8, '.--------------------.  [====]  [====]')
    write(x + 7, y + 9, '|     fragua (())     |  [||||]  [||||]')
    write(x + 7, y + 10, '|   [##########]     |')
    write(x + 7, y + 11, '|____/^^^^^^^^\\_____|')
    write(x + 11, y + 16, '       __________')
    write(x + 11, y + 17, '  ____/__________\\____')
    write(x + 11, y + 18, ' /______ yunque ______\\')
    write(x + 11, y + 19, '        /______\\')
    const doorLeft = x + 33
    write(doorLeft, bottom - 9, '/-------\\')
    for (let row = bottom - 8; row < bottom; row++) write(doorLeft, row, '|       |')
    write(doorLeft, bottom - 4, '|   o   |')
    write(doorLeft, bottom - 1, '|_______|')
    write(doorLeft, bottom, '|___A___|')
    return { doorX: x + 37, doorY: bottom }
  }

  /** Fortified armoury with crenellations, corner towers and shield racks. */
  const armoryBuilding = () => {
    const x = 241
    const y = 132
    const w = 74
    const bottom = 171
    clearLot(x, y, w, bottom - y + 1)
    write(x + 3, y, '[]__[]__[]__[]__[]__[]__[]__[]__[]')
    write(x + 1, y + 1, '/####################################\\')
    fill(x + 2, y + 2, w - 4, bottom - y - 1, ' ')
    border(x + 2, y + 2, w - 4, bottom - y - 1, '#', '|')
    fill(x + 3, y - 1, 10, bottom - y, ' ')
    fill(x + w - 13, y - 1, 10, bottom - y, ' ')
    border(x + 2, y - 2, 12, bottom - y + 3, '#', '|')
    border(x + w - 14, y - 2, 12, bottom - y + 3, '#', '|')
    write(x + 3, y - 3, '[]_[]_[]_[]')
    write(x + w - 13, y - 3, '[]_[]_[]_[]')
    centred(x + 2, y + 5, w - 4, 'armaduras del bastion')
    write(x + 17, y + 9, '/\\          /\\          /\\')
    write(x + 17, y + 10, '/##\\        /##\\        /##\\')
    write(x + 17, y + 11, '|[o]|        |[o]|        |[o]|')
    write(x + 17, y + 12, '|##|        |##|        |##|')
    write(x + 17, y + 13, '\\##/        \\##/        \\##/')
    write(x + 17, y + 14, ' \\/          \\/          \\/')
    write(x + 6, y + 18, '[||||]      ==================      [||||]')
    write(x + 6, y + 19, '[====]      || sala de armas ||      [====]')
    const doorLeft = x + 33
    write(doorLeft, bottom - 10, '/-------\\')
    for (let row = bottom - 9; row < bottom; row++) write(doorLeft, row, '| | | | |')
    write(doorLeft, bottom - 4, '| | o | |')
    write(doorLeft, bottom - 1, '|_|_|_|_|')
    write(doorLeft, bottom, '|___D___|')
    return { doorX: x + 37, doorY: bottom }
  }

  const garden = (x, y, w, h) => {
    fill(x, y, w, h, ';')
    border(x, y, w, h)
    const cx = x + Math.floor(w / 2)
    const cy = y + Math.floor(h / 2)

    // Four open approaches keep the garden accessible rather than enclosed.
    fill(x, cy - 1, w, 3, '.')
    fill(cx - 2, y, 5, h, '.')

    for (let row = y + 3; row < y + h - 3; row += 5) {
      for (let col = x + 4; col < x + w - 4; col += 7) set(col, row, (row + col) % 2 ? '*' : '"')
    }
    const pondW = Math.min(22, w - 10)
    const pondX = x + Math.floor((w - pondW) / 2)
    const pondY = y + Math.floor(h / 2) - 2
    fill(pondX, pondY, pondW, 5, '~')
    write(pondX, pondY, '/' + '~'.repeat(pondW - 2) + '\\')
    write(pondX, pondY + 4, '\\' + '~'.repeat(pondW - 2) + '/')
  }

  const fountain = (x, y) => {
    const art = [
      '          .----.          ',
      '       .-~      ~-.       ',
      '      /    /\\    \\      ',
      '     |    /  \\    |     ',
      '     |   ( OO )   |     ',
      '      \\   \\__/   /      ',
      '       `-.____.-`       ',
      '    .----------------.    ',
      '   /~~~~~~~~~~~~~~~~~~\\   ',
      '  /~~~~~~~~~~~~~~~~~~~~\\  ',
      '  \\____________________/  '
    ]
    for (let row = 0; row < art.length; row++) write(x, y + row, art[row])
  }

  const market = (x, y, w) => {
    border(x, y, w, 26, '=')
    centred(x, y + 2, w, 'mercado de la ciudad')
    for (let stall = x + 5; stall < x + w - 18; stall += 24) {
      write(stall, y + 5, '   /\\/\\/\\/\\   ')
      write(stall, y + 6, '  /__________\\  ')
      write(stall, y + 7, ' | []  {}  [] | ')
      write(stall, y + 8, ' |____________| ')
      write(stall, y + 9, '   |  |  |  |   ')
    }
    for (let row = y + 12; row < y + 25; row++) {
      for (let col = x + 2; col < x + w - 2; col++) if (grid[row][col] === ',') grid[row][col] = ';'
    }
  }
  void market

  const civicSquare = (x, y, w, h) => {
    fill(x, y, w, h, ';')
    border(x, y, w, h, '_', ':')
    const cx = x + Math.floor(w / 2)
    const cy = y + Math.floor(h / 2)

    // Four open approaches keep this a plaza rather than another enclosed
    // building. The fountain is solid; the paving around it stays walkable.
    fill(x, cy - 1, w, 3, '.')
    fill(cx - 2, y, 5, h, '.')
    // The title is inset into the north-west rim so the tall central monument
    // can rise above the square without painting over its name.
    write(x + 8, y, '[ plaza de los heroes ]')
    for (const [tx, ty] of [
      [x + 10, y + 5],
      [x + w - 11, y + 5],
      [x + 10, y + h - 6],
      [x + w - 11, y + h - 6]
    ]) {
      set(tx, ty, 't')
      set(tx - 1, ty - 1, '/')
      set(tx + 1, ty - 1, '\\')
      set(tx, ty - 1, '*')
    }
    write(x + 21, y + 5, '[====]')
    write(x + w - 27, y + 5, '[====]')
    write(x + 21, y + h - 6, '[====]')
    write(x + w - 27, y + h - 6, '[====]')
    for (let col = x + 34; col < x + w - 34; col += 9) {
      set(col, y + 4, '*')
      set(col, y + h - 5, '*')
    }
    for (const [lx, ly, facing] of [
      [x + 4, y + 3, '}'],
      [x + w - 6, y + 3, '{'],
      [x + 4, y + h - 6, '}'],
      [x + w - 6, y + h - 6, '{']
    ]) {
      write(lx, ly, `|${facing}`)
      write(lx, ly + 1, '|*')
    }
    for (let row = 0; row < PLAZA_FOUNTAIN.art.length; row++) {
      write(PLAZA_FOUNTAIN.x, PLAZA_FOUNTAIN.y + row, PLAZA_FOUNTAIN.art[row])
    }
  }

  fill(0, 0, width, 1, '#')
  fill(0, height - 1, width, 1, '#')
  fill(0, 0, 1, height, '#')
  fill(width - 1, 0, 1, height, '#')

  // Three broad east-west streets and one continuous north-south avenue.
  fill(157, 1, 6, height - 2, '.')
  fill(1, 58, width - 2, 6, '.')
  fill(1, 118, width - 2, 6, '.')
  fill(1, 178, width - 2, 6, '.')
  fill(113, 64, 94, 54, ';')

  garden(5, 5, 65, 43)
  garden(250, 5, 65, 43)

  const castle = building({
    x: 88,
    y: 3,
    w: 144,
    h: 51,
    name: 'castillo de runa',
    door: 'K',
    roof: '#'
  })
  // Towers and battlements give the castle a silhouette distinct from shops.
  border(88, 8, 28, 46, '#')
  border(204, 8, 28, 46, '#')
  for (let x = 89; x < 115; x += 4) set(x, 7, '^')
  for (let x = 205; x < 231; x += 4) set(x, 7, '^')
  centred(88, 28, 28, '[ torre ]')
  centred(204, 28, 28, '[ torre ]')
  for (const x of [99, 109, 211, 221]) {
    write(x, 22, '/\\')
    write(x, 23, '[]')
    write(x, 24, '\\/')
  }
  write(143, 21, '     /\\     ')
  write(143, 22, '    /##\\    ')
  write(143, 23, '   |[runa]|   ')
  write(143, 24, '   |######|   ')
  for (const x of [126, 150, 174]) {
    write(x, 30, ' /====\\ ')
    write(x, 31, '|[|::|]|')
    write(x, 32, ' \\====/ ')
    write(x, 36, ' .----. ')
    write(x, 37, '/|/\\/\\|\\')
    write(x, 38, '\\|_||_|/')
  }
  write(castle.doorX - 8, 40, '/--------------\\')
  for (let y = 41; y < castle.doorY; y++) {
    set(castle.doorX - 8, y, '|')
    set(castle.doorX + 7, y, '|')
  }
  for (let y = 34; y < 48; y += 3) write(101, y, '[|]')
  for (let y = 34; y < 48; y += 3) write(216, y, '[|]')
  fill(castle.doorX - 1, castle.doorY + 1, 3, 7, '.')

  const church = churchBuilding()
  const home = homeBuilding()
  const tavern = tavernBuilding()
  const potions = potionBuilding()
  for (const door of [church, home, tavern, potions]) {
    fill(door.doorX - 1, door.doorY + 1, 3, 6, '.')
  }

  fountain(146, 79)
  civicSquare(91, 142, 138, 26)

  const smith = smithBuilding()
  const armory = armoryBuilding()
  fill(smith.doorX - 1, smith.doorY + 1, 3, 6, '.')
  fill(armory.doorX - 1, armory.doorY + 1, 3, 6, '.')

  // Gatehouse
  fill(130, 184, 61, 15, ' ')
  border(130, 184, 61, 15, '#')
  border(130, 181, 15, 18, '#')
  border(176, 181, 15, 18, '#')
  centred(130, 186, 61, 'gran porton a la pradera')
  write(145, 189, '|                             |')
  write(145, 190, '|                             |')
  write(145, 191, '|                             |')
  write(145, 192, '|                             |')
  write(145, 193, '|                             |')
  write(145, 194, '|______________>______________|')
  fill(159, 184, 3, 10, '.')
  set(160, 194, '>')
  fill(158, 195, 5, 5, '.')

  // The eastern road now ends at a fortified border instead of a blank wall.
  // N is the only crossing tile; the towers preserve the silhouette while the
  // six-row road remains broad enough for actors and PvP invitations.
  border(308, 105, 12, 12, '#')
  border(308, 125, 12, 12, '#')
  centred(308, 109, 12, 'torre nox')
  centred(308, 129, 12, 'torre nox')
  fill(308, 117, 11, 8, '.')
  write(292, 116, '[frontera nox]')
  write(308, 117, '|=========|')
  write(308, 124, '|=========|')
  set(318, 120, 'N')

  for (const [x, y] of [
    [78, 16],
    [241, 17],
    [18, 57],
    [300, 57],
    [84, 120],
    [236, 120],
    [84, 177],
    [236, 177]
  ]) {
    set(x, y, 't')
    set(x - 1, y - 1, '/')
    set(x + 1, y - 1, '\\')
    set(x, y - 1, '*')
  }

  return grid.map((row) => row.join(''))
}

const LARGE_CITY_ROWS = makeHighResolutionCityRows()

function animationCells(x, y, rows, color = 'cyan') {
  const cells = []
  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      cells.push({ x: x + col, y: y + row, glyph: rows[row][col], color })
    }
  }
  return cells
}

function plazaWaterFrame(top, bottom, drops) {
  return [
    ...animationCells(PLAZA_FOUNTAIN.x + 8, PLAZA_FOUNTAIN.y + 13, [
      top.padEnd(27, '~').slice(0, 27)
    ]),
    ...animationCells(PLAZA_FOUNTAIN.x + 4, PLAZA_FOUNTAIN.y + 14, [
      bottom.padEnd(35, '~').slice(0, 35)
    ]),
    ...drops.map(([x, y, glyph]) => ({
      x: PLAZA_FOUNTAIN.x + x,
      y: PLAZA_FOUNTAIN.y + y,
      glyph,
      color: 'cyan'
    }))
  ]
}

function avenueWaterFrame(top, bottom, drops) {
  return [
    ...animationCells(150, 87, [top], 'blue'),
    ...animationCells(149, 88, [bottom], 'blue'),
    ...drops.map(([x, y, glyph]) => ({ x, y, glyph, color: 'cyan' }))
  ]
}

const CITY_ANIMATIONS = [
  {
    id: 'plaza-fountain-water',
    cadence: 4,
    frames: [
      plazaWaterFrame(
        '~~~^~~~~~~^~~~~~~^~~~~~~^~~~~~~^~~~',
        '~^~~~~~^~~~~~~^~~~~~~^~~~~~~^~~~~~^~',
        [
          [14, 6, '~'],
          [32, 6, '~'],
          [9, 10, '~'],
          [37, 10, '~']
        ]
      ),
      plazaWaterFrame(
        '^~~~~~^~~~~~~^~~~~~~^~~~~~~^~~~~~^~',
        '~~~^~~~~~~^~~~~~~^~~~~~~^~~~~~~^~~~',
        [
          [13, 7, '~'],
          [33, 7, '~'],
          [8, 11, '~'],
          [38, 11, '~']
        ]
      ),
      plazaWaterFrame(
        '~~^~~~~~~^~~~~~~^~~~~~~^~~~~~~^~~~~',
        '^~~~~~~^~~~~~~^~~~~~~^~~~~~~^~~~~~~^',
        [
          [12, 8, '~'],
          [34, 8, '~'],
          [7, 12, '~'],
          [39, 12, '~']
        ]
      ),
      plazaWaterFrame(
        '~~~~^~~~~~~^~~~~~~^~~~~~~^~~~~~~^~~',
        '~~^~~~~~~^~~~~~~^~~~~~~^~~~~~~^~~~~',
        [
          [11, 9, '~'],
          [35, 9, '~'],
          [6, 13, '~'],
          [40, 13, '~']
        ]
      )
    ]
  },
  {
    id: 'avenue-fountain-water',
    cadence: 5,
    frames: [
      avenueWaterFrame('~~^~~~~^~~~~^~~~~~', '~^~~~~^~~~~^~~~~^~~~', [
        [158, 80, '|'],
        [157, 81, '/'],
        [159, 81, '\\']
      ]),
      avenueWaterFrame('^~~~~^~~~~^~~~~^~~', '~~~^~~~~^~~~~^~~~~^~', [
        [158, 79, '.'],
        [156, 80, '/'],
        [160, 80, '\\']
      ]),
      avenueWaterFrame('~~~~^~~~~^~~~~^~~~', '^~~~~^~~~~^~~~~^~~~~', [
        [157, 80, '\\'],
        [159, 80, '/'],
        [158, 81, '|']
      ])
    ]
  }
]

const CASTLE_NPCS = [
  {
    id: 'aldren',
    name: 'Aldren',
    role: 'rey de runa',
    x: 56,
    y: 13,
    sprite: NPC_SPRITES.king,
    anchorY: NPC_SPRITES.king.length - 1,
    color: 'yellow',
    line: 'todo heroe deja una marca en esta ciudad; honra la tuya'
  }
]

function makeCastleInteriorRows() {
  const width = 112
  const height = 40
  const grid = Array.from({ length: height }, () => Array(width).fill(';'))
  const set = (x, y, value) => {
    if (x >= 0 && x < width && y >= 0 && y < height) grid[y][x] = value
  }
  const write = (x, y, text) => {
    for (let i = 0; i < text.length; i++) set(x + i, y, text[i])
  }
  const fill = (x, y, w, h, value) => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) set(col, row, value)
    }
  }

  fill(0, 0, width, 1, '#')
  fill(0, height - 1, width, 1, '#')
  fill(0, 0, 1, height, '#')
  fill(width - 1, 0, 1, height, '#')
  write(43, 1, ' salon del trono ')

  // A long royal carpet makes the entrance-to-throne axis immediately clear.
  fill(51, 12, 11, 26, '.')
  for (let y = 15; y < 37; y += 4) {
    set(52, y, '*')
    set(60, y, '*')
  }

  // Raised dais and a throne large enough to read behind the king sprite.
  write(39, 4, '##################################')
  write(39, 5, '#________________________________#')
  write(39, 6, '#        /\\     /\\              #')
  write(39, 7, '#       /##\\___/##\\             #')
  write(39, 8, '#       |##|^^^|##|             #')
  write(39, 9, '#       |##|___|##|             #')
  write(39, 10, '#       |/_______\\|             #')
  write(39, 11, '#_______/=========\\_____________#')

  // Stone columns, banners, braziers and side benches frame the great hall.
  for (const x of [13, 29, 82, 98]) {
    write(x - 2, 5, '_____')
    for (let y = 6; y < 33; y++) set(x, y, '|')
    write(x - 2, 33, '/###\\')
  }
  for (const x of [5, 34, 73, 102]) {
    write(x, 3, '/\\')
    write(x, 4, '||')
    write(x, 5, '\\/')
  }
  for (const y of [18, 27]) {
    write(3, y, '[==========]')
    write(99, y, '[==========]')
  }
  for (const x of [22, 89]) {
    write(x, 24, '  ( )  ')
    write(x, 25, ' (*** ) ')
    write(x, 26, '  |#|  ')
  }

  // The dungeon is now a deliberate side stair, not the castle's front door.
  write(3, 35, 'ruinas V')
  set(10, 35, 'V')
  fill(9, 34, 3, 4, ';')
  set(10, 35, 'V')

  write(49, 38, '#######B#######')
  fill(54, 36, 5, 2, '.')
  set(56, 38, 'B')

  return grid.map((row) => row.join(''))
}

const CASTLE_ROWS = makeCastleInteriorRows()

const FIELD_ROWS = [
  '########################################<#######################################',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,o,,,,,,,,oo...,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,o,#',
  '#,,,,,o,,,,o,,,o,,,,,,,,,,,,,,t,t,t,t,o...tt,,,,,,,,,,,,,,,,,,t,t,,,t,ttt,tt,,,#',
  '#,,,,,,,,,,,,,,,,~,,,,,,,,,,,,,,t,tttt,...,,,,,,,,,,,,,,,tt,,,,t,ttt,,,tttt,,,,#',
  '#,,,,,,,..,,~~~~~~~~~~~,,,,,,,tt,,,t,tt...tt,,,,,,,,,,,,t,,,,,ttt,,,t,,t,,,,,,,#',
  '#,,,,,,,..~~~~~~~~~~~~~~~,,,,,t,,,,,t,,...,,,,,,,,,,,,,,,,ttt,t,,,t,,,,,,,t,,,,#',
  '#o,,,,,,..~~~~~~~~~~~~~~~~,,,,,,,,,,,,,...,,,,,,,,,,,,,,t,,t,,,,t,t,t,,,,,tt,,,#',
  '#,,,,,,,..~~~~~~~~~~~~~~~,,,,,,,,,,,,,,...,,,,,,,,,,,,,,,t,ttt,t,t,tt,,t,ttt,,,#',
  '#,,,,,,,..,,~~~~~~~~~~~,,,,,,,,,,,,,,,,...,,,,,,,,,,,,,,t,,,t,t,t,,,,,,t,,tt,,,#',
  '#,,,,,,,..,,,,,,,~,,,,,,,,,,,,,,,,,,,,,...,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#,,,,,,,..,,,,,,,,,,,,,,,,,,,,,,,,,,,,,...,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#,,,,,,,..,,,,,,,,,o,,,o,,,,,,,,,,,,,,,...,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#,,,,,...................................................................,,,,,,#',
  '#,,,o,...................................................................,,,,,,#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,...,,,,,o,,#',
  '#,,,,,t,,t,,tt,,,,,t,,,ttt,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,...,,,,,,,,#',
  '#,,,,tt,,t,t,,ttt,,,o,tt,,,,,,,,,,,,,,,,o,,,,,,,o,tto,,,,ttt,,t,t,t,...tt,,t,,,#',
  '#,,,,t,,,t,,t,,t,,t,to,t,,,,,,,,,,,,,,,,,,,,,,,,,,tt,tot,,tt,,,,,,t,...t,t,t,,,#',
  '#o,,tttt,t,,t,tt,,,,t,,,t,,,,,,,,,,,,,,,,,,,,,,,,,t,t,,ttt,,tt,,t,t,...,,,tt,,,#',
  '#,,,t,,t,ttt,,tttt,,tt,,tt,,,,,,,,,,oo,,,,,,,,,,,,tt,,tttttt,,,tt,,t...,,,tt,,,#',
  '#,,,,,,,,,t,,,tott,,tt,t,,,,,,,,,,,,,,,,o,,,,,,,,,,,t,ttt,,t,ttttt,t...,,,t,,,,#',
  '#,,,,t,,,,,t,,,t,ttt,t,t,,,,,,,,,,,,,,,,,,,,,,,,,,t,tt,t,,,t,ttt,tt,ttttt,t,,,,#',
  '#,,,,t,t,t,t,t,,tt,tt,,,tt,,,,,,,,,,,,,,,,,,,,,,,,t,t,t,,t,,,,,tt,t,t,t,t,,,,,,#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,t,,,tt,t,t,t,,,tt,t,t,,t,t,,,#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,o,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,o,,,,,,,,,#',
  '################################################################################'
]

const DUNGEON_ROWS = [
  '############################################################',
  '#..........................................................#',
  '#.U..............####.....................####..............#',
  '#................####.....................####..............#',
  '#.......o.................;.;.;.;.;................o........#',
  '#................####.....;.......;.......####..............#',
  '##########.###########....;..~~~..;.......####......#########',
  '#.........................;..~O~..;.........................#',
  '#....o....................;..~~~..;..............o..........#',
  '#.........................;.......;.........................#',
  '#..............########....;.;.;.;.;....########............#',
  '#..............#..............................#..............#',
  '#....*.........#...........o..................#.........*....#',
  '#..............#..............................#..............#',
  '#..............##########..........############.............#',
  '#............................o...............................#',
  '#..........o......................................o.........#',
  '#..........................................................#',
  '#..........................~~~~~~...........................#',
  '############################################################'
].map((row) => row.padEnd(62, '#'))

function makeNoxKingdomRows() {
  const width = 180
  const height = 100
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ((x * 13 + y * 23) % 37 === 0 ? ',' : '%'))
  )
  const set = (x, y, ch) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    grid[y][x] = ch
  }
  const fill = (x, y, w, h, ch) => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) set(col, row, ch)
    }
  }
  const write = (x, y, text) => {
    for (let index = 0; index < String(text).length; index++) set(x + index, y, String(text)[index])
  }
  const border = (x, y, w, h) => {
    for (let col = x; col < x + w; col++) {
      set(col, y, '#')
      set(col, y + h - 1, '#')
    }
    for (let row = y; row < y + h; row++) {
      set(x, row, '#')
      set(x + w - 1, row, '#')
    }
  }
  const building = (x, y, w, h, label, door, facing = 'south') => {
    fill(x, y, w, h, ' ')
    border(x, y, w, h)
    for (let col = x + 2; col < x + w - 1; col += 4) set(col, y, '^')
    write(x + Math.max(2, Math.floor((w - label.length) / 2)), y + 3, label)
    const doorX = x + Math.floor(w / 2)
    const doorY = facing === 'north' ? y : y + h - 2
    if (facing === 'north') {
      write(doorX - 3, y, `|__${door}__|`)
      write(doorX - 3, y + 1, '|     |')
      write(doorX - 3, y + 2, '\\-----/')
    } else {
      write(doorX - 3, y + h - 4, '/-----\\')
      write(doorX - 3, y + h - 3, '|     |')
      write(doorX - 3, y + h - 2, `|__${door}__|`)
    }
    set(doorX, doorY, door)
    return { x: doorX, y: doorY }
  }

  fill(0, 0, width, 1, '#')
  fill(0, height - 1, width, 1, '#')
  fill(0, 0, 1, height, '#')
  fill(width - 1, 0, 1, height, '#')
  fill(1, 48, width - 2, 5, '.')
  fill(88, 1, 5, height - 2, '.')

  // West-facing frontier gate back to RUNA.
  border(0, 38, 19, 11)
  border(0, 53, 19, 11)
  write(2, 42, 'torre frontera')
  write(2, 57, 'torre frontera')
  fill(1, 48, 22, 5, '.')
  set(1, 50, 'R')
  write(2, 47, '[frontera runa]')

  // The black citadel dominates the north and gives the enemy capital a
  // different skyline from RUNA's broad stone castle.
  fill(45, 3, 90, 31, ' ')
  border(45, 3, 90, 31)
  for (let x = 47; x < 134; x += 5) set(x, 2, '^')
  write(75, 6, 'ciudadela de obsidiana')
  write(80, 10, 'reino de nox')
  for (const x of [55, 67, 112, 124]) {
    write(x, 14, '/\\')
    write(x, 15, '||')
    write(x, 16, '\\/')
  }
  write(79, 20, '/-------------------\\')
  write(79, 21, '|    trono oscuro    |')
  write(79, 22, '|       /^^\\        |')
  write(79, 23, '|_______|##|_________|')

  const potion = building(8, 12, 34, 25, 'alquimia de ceniza', 'P')
  const temple = building(138, 12, 34, 25, 'templo de la noche', 'I')
  const weapons = building(8, 65, 40, 27, 'forja de guerra', 'A', 'north')
  const armor = building(132, 65, 40, 27, 'arsenal de nox', 'D', 'north')
  const home = building(69, 70, 42, 27, 'refugio del clan', 'C', 'north')
  fill(potion.x - 1, potion.y + 1, 3, 48 - potion.y - 1, '.')
  fill(temple.x - 1, temple.y + 1, 3, 48 - temple.y - 1, '.')
  fill(weapons.x - 1, 53, 3, weapons.y - 53, '.')
  fill(armor.x - 1, 53, 3, armor.y - 53, '.')
  fill(home.x - 1, 53, 3, home.y - 53, '.')

  // A cracked obelisk marks the starting plaza without blocking either road.
  write(73, 56, '.-------- plaza de nox --------.')
  write(82, 58, '     /\\     ')
  write(82, 59, '    /##\\    ')
  write(82, 60, '    |<>|    ')
  write(82, 61, ' ___|##|___ ')
  write(82, 62, '/==========\\')

  return grid.map((row) => row.join(''))
}

const NOX_ROWS = makeNoxKingdomRows()

/**
 * Turn art plus metadata into a map, checking the art is rectangular.
 *
 * The check is here because a ragged row is invisible in the source and would
 * surface much later as a player walking through a wall on one line only.
 *
 * @param {{ id: string, name: string, rows: string[], spawn: {x: number, y: number},
 *           arrive: {x: number, y: number} }} def
 * @returns {object} the map, with `width` and `height` filled in
 */
function defineMap(def) {
  const width = def.rows[0].length
  for (let y = 0; y < def.rows.length; y++) {
    if (def.rows[y].length !== width) {
      throw new Error(`mapa ${def.id}: la fila ${y} mide ${def.rows[y].length}, no ${width}`)
    }
  }
  return { ...def, width, height: def.rows.length }
}

/**
 * `spawn` is where a new game starts. `arrive` is where you land coming in from
 * the other map, and it is deliberately one cell past the gate: landing on the
 * gate itself would offer to send you straight back the way you came.
 */
const MAPS = {
  city: defineMap({
    id: 'city',
    name: 'la ciudad',
    rows: LARGE_CITY_ROWS,
    spawn: { x: 160, y: 130 },
    arrive: { x: 160, y: 180 },
    npcs: CITY_NPCS,
    animations: CITY_ANIMATIONS,
    arrivals: { noxBorder: { x: 316, y: 120 } },
    landmarks: [
      {
        id: 'hero-statue',
        name: 'estatua de los heroes',
        bounds: { x1: 137, y1: 141, x2: 183, y2: 159 },
        action: { kind: 'ranking' }
      }
    ]
  }),
  nox: defineMap({
    id: 'nox',
    name: 'el reino enemigo de nox',
    rows: NOX_ROWS,
    spawn: { x: 90, y: 66 },
    arrive: { x: 3, y: 50 },
    npcs: []
  }),
  castle: defineMap({
    id: 'castle',
    name: 'el salon del trono',
    rows: CASTLE_ROWS,
    spawn: { x: 56, y: 36 },
    arrive: { x: 56, y: 36 },
    npcs: CASTLE_NPCS
  }),
  field: defineMap({
    id: 'field',
    name: 'el campo',
    rows: FIELD_ROWS,
    spawn: { x: 40, y: 1 },
    arrive: { x: 40, y: 1 }
  }),
  dungeon: defineMap({
    id: 'dungeon',
    name: 'las ruinas bajo el castillo',
    rows: DUNGEON_ROWS,
    spawn: { x: 3, y: 2 },
    arrive: { x: 3, y: 2 }
  }),
  coliseum: defineMap({
    id: 'coliseum',
    name: 'el coliseo de runa',
    rows: COLISEUM_ROWS,
    spawn: { ...COLISEUM_META.arrive },
    arrive: { ...COLISEUM_META.arrive },
    exit: { ...COLISEUM_META.exit },
    arenaBounds: { ...COLISEUM_META.arenaBounds },
    duelSpawns: COLISEUM_META.duelSpawns.map((spawn) => ({ ...spawn })),
    refereeSpawn: { ...COLISEUM_META.refereeSpawn },
    duelReady: true
  })
}

/**
 * Is this cell on the map at all.
 * @param {object} map
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function inside(map, x, y) {
  return x >= 0 && y >= 0 && x < map.width && y < map.height
}

/**
 * The tile at a cell. Off the map, or a character the table does not know,
 * reads as solid: an unrecognised map is unwalkable, never leaky.
 * @param {object} map
 * @param {number} x
 * @param {number} y
 * @returns {{ id: string, name: string, solid: boolean, enter?: object }}
 */
function tileAt(map, x, y) {
  if (!inside(map, x, y)) return NOWHERE
  return TILES[map.rows[y][x]] || NOWHERE
}

/**
 * @param {object} map
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isSolid(map, x, y) {
  return tileAt(map, x, y).solid
}

/** Where the player is and how they get around. */
class Walker {
  /**
   * @param {string} [mapId] - key into MAPS
   */
  constructor(mapId = 'city') {
    this.mapId = MAPS[mapId] ? mapId : 'city'
    const spawn = MAPS[this.mapId].spawn
    this.x = spawn.x
    this.y = spawn.y
  }

  /** @returns {object} the map currently being walked */
  get map() {
    return MAPS[this.mapId]
  }

  /**
   * The tile under the player's feet.
   * @returns {object}
   */
  here() {
    return tileAt(this.map, this.x, this.y)
  }

  /**
   * The tile one step away, without moving.
   * @param {number} dx
   * @param {number} dy
   * @returns {object}
   */
  peek(dx, dy) {
    return tileAt(this.map, this.x + dx, this.y + dy)
  }

  /**
   * What standing here offers: a shop, a door, a way out. Null on plain ground.
   *
   * The game activates this after a successful step, so doors and exits work
   * on contact. Keeping the descriptor here still leaves UI and travel policy
   * in the game layer.
   *
   * @returns {object|null}
   */
  action() {
    return this.here().enter || null
  }

  /**
   * Step one cell, if the cell allows it.
   *
   * `tile` is always where you ended up, moved or not, so the caller can print
   * it either way. `blocked` is what stopped you, and is null on a good step.
   *
   * @param {number} dx
   * @param {number} dy
   * @returns {{ moved: boolean, tile: object, blocked: object|null }}
   */
  move(dx, dy) {
    const tile = this.peek(dx, dy)
    if (tile.solid) return { moved: false, tile: this.here(), blocked: tile }
    this.x += dx
    this.y += dy
    return { moved: true, tile, blocked: null }
  }

  /**
   * Cross to another map, landing at its arrival point.
   * @param {string} mapId
   * @returns {boolean} false if there is no such map
   */
  travel(mapId) {
    const map = MAPS[mapId]
    if (!map) return false
    this.mapId = mapId
    this.x = map.arrive.x
    this.y = map.arrive.y
    return true
  }

  /**
   * Drop the player somewhere specific. Used by save games and by tests.
   * @param {string} mapId
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  placeAt(mapId, x, y) {
    if (!MAPS[mapId]) return false
    this.mapId = mapId
    this.x = x
    this.y = y
    return true
  }
}

/**
 * The rectangle of map to draw, centred on a point and clamped to the edges.
 *
 * Clamping rather than letting the window run off the map is what stops the
 * player walking into a band of blank screen at the borders. It does mean the
 * player is off-centre near an edge, which is the trade every scrolling map
 * makes and the one players do not notice.
 *
 * @param {object} map
 * @param {{x: number, y: number}} focus
 * @param {number} width - columns available on screen
 * @param {number} height - rows available on screen
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function viewport(map, focus, width, height) {
  const w = Math.max(1, Math.min(Math.floor(width) || map.width, map.width))
  const h = Math.max(1, Math.min(Math.floor(height) || map.height, map.height))
  const x = clamp(Math.round(focus.x - (w - 1) / 2), 0, map.width - w)
  const y = clamp(Math.round(focus.y - (h - 1) / 2), 0, map.height - h)
  return { x, y, width: w, height: h }
}

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n
}

/**
 * The map as lines, with the player painted on top.
 *
 * Pass `width`/`height` to get a window around `at`, or leave them out for the
 * whole map. Lines come back as an array because a TUI view usually has other
 * rows to interleave, and joining is the caller's business.
 *
 * @param {object} map
 * @param {{ at?: {x: number, y: number}, glyph?: string, width?: number,
 *           height?: number, view?: object }} [opts]
 * @returns {string[]}
 */
function renderLines(map, opts = {}) {
  const at = opts.at || null
  const glyph = opts.glyph || '@'
  const view =
    opts.view ||
    (opts.width || opts.height
      ? viewport(map, at || { x: 0, y: 0 }, opts.width, opts.height)
      : { x: 0, y: 0, width: map.width, height: map.height })

  const lines = []
  for (let row = 0; row < view.height; row++) {
    const y = view.y + row
    let line = map.rows[y].slice(view.x, view.x + view.width)
    const col = at && at.y === y ? at.x - view.x : -1
    if (col >= 0 && col < view.width) {
      line = line.slice(0, col) + glyph[0] + line.slice(col + 1)
    }
    lines.push(line)
  }
  return lines
}

/**
 * Same as `renderLines`, joined.
 *
 * The separator defaults to '\n' because bare-tui's renderer splits the view on
 * '\n' and writes the carriage returns itself. Only code writing straight to a
 * raw-mode tty needs `eol: '\r\n'`, and without it the map stair-steps.
 *
 * @param {object} map
 * @param {object} [opts] - as `renderLines`, plus `eol`
 * @returns {string}
 */
function render(map, opts = {}) {
  return renderLines(map, opts).join(opts.eol || '\n')
}

module.exports = {
  TILES,
  LEGEND,
  CITY_NPCS,
  NPC_MASTER_SPRITES,
  NPC_SPRITES,
  MAPS,
  NOWHERE,
  defineMap,
  inside,
  tileAt,
  isSolid,
  viewport,
  renderLines,
  render,
  Walker
}
