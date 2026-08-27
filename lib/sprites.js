'use strict'

const PERSON_WIDTH = 25
const PERSON_HEIGHT = 25
const MAP_PERSON_WIDTH = 9
const MAP_PERSON_HEIGHT = 7
const MOVER_WIDTH = 7
const MOVER_HEIGHT = 4

const HEADS = {
  hero: [
    '    .-^-.',
    '   /_____\\',
    '  /|_   _|\\',
    '  || o o ||',
    '  ||  ^  ||',
    "   \\ '_' /",
    "    `---'"
  ],
  priest: [
    '      .+.',
    '     /___\\',
    '    /_____\\',
    '   /| - - |\\',
    '   ||  +  ||',
    '    \\___/',
    '     `-`'
  ],
  resident: [
    '    .---.',
    '   /_____\\',
    '  /|_   _|\\',
    '  || o o ||',
    '  ||  ^  ||',
    '   \\ _ /',
    '    `-`'
  ],
  tavern: [
    '   .-===-.',
    '  /_~_~_~_\\',
    '  |_______|',
    '  || o o ||',
    '  ||  ^  ||',
    '   \\_-_/',
    '    `-`'
  ],
  alchemist: [
    '      /^\\',
    '     /___\\',
    '    /_____\\',
    '   /| o o |\\',
    '   ||  ~  ||',
    '    \\_^_/',
    '     `-`'
  ],
  smith: [
    '    _===_',
    '   /_____\\',
    '  /|_____|\\',
    '  || o o ||',
    '  ||  ^  ||',
    '   \\_-_/',
    '    `-`'
  ],
  armorer: [
    '     _A_',
    '    /_|_\\',
    '   /____=\\',
    '  /| o o |\\',
    '  ||  ^  ||',
    '   \\_-_/',
    '    `-`'
  ],
  villager: [
    '    .---.',
    '   /_____\\',
    '  /|     |\\',
    '  || o o ||',
    '  ||  _  ||',
    '   \\___/',
    '    `-`'
  ]
}

const EMBLEM = {
  hero: 'H',
  priest: '+',
  resident: 'C',
  tavern: 'U',
  alchemist: '&',
  smith: 'T',
  armorer: 'D',
  villager: 'V'
}

function blankCanvas() {
  return Array.from({ length: PERSON_HEIGHT }, () => Array(PERSON_WIDTH).fill(' '))
}

function write(canvas, x, y, text) {
  if (y < 0 || y >= PERSON_HEIGHT) return
  const line = String(text)
  for (let i = 0; i < line.length; i++) {
    const px = x + i
    if (px >= 0 && px < PERSON_WIDTH) canvas[y][px] = line[i]
  }
}

function centre(canvas, y, text) {
  const content = String(text).trim()
  write(canvas, Math.floor((PERSON_WIDTH - content.length) / 2), y, content)
}

/**
 * Draw directly onto a native 25x25 character canvas. `weapon`, `shield` and
 * `boots` are details on the same drawing, never alternate lower-resolution
 * sprites.
 */
function makePersonSprite(role = 'villager', options = {}) {
  const kind = HEADS[role] ? role : 'villager'
  const canvas = blankCanvas()
  const head = HEADS[kind]
  for (let y = 0; y < head.length; y++) centre(canvas, y, head[y])

  const emblem = EMBLEM[kind] || 'V'
  const body = [
    '.====\\_____/====.',
    '/   /|  :  |\\   \\',
    `<__/ | [${emblem}] | \\__>`,
    ')^(  |  :  |  )^(',
    '| |  |  :  |  | |',
    '"-<\\)|  :  |(/>-"',
    '   \\|_____|/',
    '    |  :  |',
    '    |  :  |',
    '   /|_____|\\',
    '  / |     | \\',
    ' /__|_____|__\\',
    '    | | | |',
    '    | | | |',
    '    |_| |_|',
    '   /__| |__\\',
    '  /___| |___\\',
    "  `---' `---'"
  ]
  for (let y = 0; y < body.length; y++) centre(canvas, y + 7, body[y])

  if (kind === 'priest') {
    write(canvas, 1, 4, '+')
    write(canvas, 0, 5, '-|-')
    for (let y = 6; y <= 20; y++) write(canvas, 1, y, '|')
  }

  if (kind === 'tavern') {
    write(canvas, 20, 10, '.__.')
    write(canvas, 20, 11, '|  |]')
    write(canvas, 20, 12, '|__|')
  }

  if (kind === 'alchemist') {
    write(canvas, 21, 9, 'o')
    write(canvas, 20, 10, '/\\')
    write(canvas, 19, 11, '/::\\')
    write(canvas, 19, 12, '\\__/')
  }

  if (kind === 'smith') {
    write(canvas, 20, 5, '[==]')
    for (let y = 6; y <= 13; y++) write(canvas, 21, y, '||')
  }

  if (kind === 'armorer' || options.shield) {
    write(canvas, 0, 9, '  ___')
    write(canvas, 0, 10, ' /###\\')
    write(canvas, 0, 11, '|#[O]#|')
    write(canvas, 0, 12, '|#####|')
    write(canvas, 0, 13, ' \\###/')
    write(canvas, 0, 14, '  \\_/')
  }

  if (kind === 'villager') {
    write(canvas, 20, 10, '.___')
    write(canvas, 20, 11, '|:::|')
    write(canvas, 20, 12, '|___|')
  }

  if (kind === 'hero') {
    if (options.weapon === 'sword') {
      write(canvas, 21, 5, '/\\')
      write(canvas, 20, 6, '||')
      write(canvas, 19, 7, '||')
      write(canvas, 18, 8, '==')
    }
    if (options.weapon === 'crossbow') {
      write(canvas, 18, 8, '}=>--')
      write(canvas, 20, 9, '/|\\')
    }
    if (options.shield) write(canvas, 11, 9, '[#]')
    if (options.boots) {
      write(canvas, 5, 23, '[____]')
      write(canvas, 14, 23, '[____]')
      write(canvas, 4, 24, '[______]')
      write(canvas, 13, 24, '[______]')
    }
    if (Math.abs(Math.floor(Number(options.frame) || 0)) % 2) {
      write(canvas, 7, 20, ' /|')
      write(canvas, 14, 20, '|\\ ')
    }
  }

  return canvas.map((row) => row.join(''))
}

const MAP_HEADS = {
  hero: '.-^-.',
  priest: '.+.',
  resident: '.---.',
  tavern: '.~.',
  alchemist: '/^\\',
  smith: '_===_',
  armorer: '_A_',
  guard: '.I.',
  villager: '.---.'
}

const MAP_EMBLEMS = {
  hero: 'H',
  priest: '+',
  resident: 'C',
  tavern: 'U',
  alchemist: '&',
  smith: 'T',
  armorer: 'D',
  guard: 'G',
  villager: 'V'
}

/**
 * A native map-scale person. This is a separate drawing, not a shrunken copy
 * of the 25x25 master: nine columns preserve the terrain and two leg poses
 * make every successful step readable.
 */
function makeMapPersonSprite(role = 'villager', options = {}) {
  const kind = MAP_HEADS[role] ? role : 'villager'
  const canvas = Array.from({ length: MAP_PERSON_HEIGHT }, () => Array(MAP_PERSON_WIDTH).fill(' '))
  const put = (x, y, text) => {
    if (y < 0 || y >= MAP_PERSON_HEIGHT) return
    const line = String(text)
    for (let i = 0; i < line.length; i++) {
      if (x + i >= 0 && x + i < MAP_PERSON_WIDTH) canvas[y][x + i] = line[i]
    }
  }
  const centered = (y, text) => {
    const line = String(text)
    put(Math.floor((MAP_PERSON_WIDTH - line.length) / 2), y, line)
  }

  centered(0, MAP_HEADS[kind])
  centered(1, kind === 'guard' ? '[o_o]' : '(o o)')
  centered(2, kind === 'priest' ? '\\_+_/' : kind === 'alchemist' ? '\\_~_/' : '\\_^_/')
  centered(3, `/|[${MAP_EMBLEMS[kind]}]|\\`)
  centered(4, '| : |')

  const walking = Math.abs(Math.floor(Number(options.frame) || 0)) % 2 === 1
  centered(5, walking ? '| | |' : '/ | \\')
  centered(6, walking ? '_/ \\_' : '_| |_')

  if (kind === 'priest') {
    put(0, 1, '+')
    put(0, 2, '|')
    put(0, 3, '|')
    put(0, 4, '|')
    put(0, 5, '|')
  } else if (kind === 'tavern') {
    put(7, 3, 'u')
    put(7, 4, 'U]')
  } else if (kind === 'alchemist') {
    put(7, 3, 'o')
    put(7, 4, '\\/')
  } else if (kind === 'smith') {
    put(7, 1, 'T')
    put(7, 2, '|')
    put(7, 3, '|')
  } else if (kind === 'armorer' || options.shield) {
    put(0, 3, '(')
    put(0, 4, 'O')
    put(0, 5, 'v')
  } else if (kind === 'guard') {
    put(0, 3, '<')
    put(8, 3, '>')
  }

  if (kind === 'hero') {
    if (options.weapon === 'sword') {
      put(8, 1, '/')
      put(8, 2, '|')
      put(8, 3, '|')
    } else if (options.weapon === 'crossbow') {
      put(6, 2, '=>-')
    }
    if (options.boots) {
      put(1, 6, '[_]')
      put(5, 6, '[_]')
    }
  }

  return canvas.map((row) => row.join(''))
}

/**
 * A deliberately small hero for every scrolling view. Moving a large
 * multi-line sprite over one-cell architecture makes walls look torn even
 * when the renderer restores them correctly on the next frame.
 */
function makeMovingPersonSprite(role = 'hero', options = {}) {
  const heads = {
    hero: '.^.',
    priest: '.+.',
    resident: '.-.',
    tavern: '.~.',
    alchemist: '/^\\',
    smith: '===',
    armorer: '.A.',
    guard: '.I.',
    villager: '.-.'
  }
  const emblems = {
    hero: 'H',
    priest: '+',
    resident: 'C',
    tavern: 'U',
    alchemist: '&',
    smith: 'T',
    armorer: 'D',
    guard: 'G',
    villager: 'V'
  }
  const kind = heads[role] ? role : 'villager'
  const canvas = Array.from({ length: MOVER_HEIGHT }, () => Array(MOVER_WIDTH).fill(' '))
  const put = (x, y, text) => {
    if (y < 0 || y >= MOVER_HEIGHT) return
    const line = String(text)
    for (let i = 0; i < line.length; i++) {
      if (x + i >= 0 && x + i < MOVER_WIDTH) canvas[y][x + i] = line[i]
    }
  }

  put(2, 0, heads[kind])
  put(1, 1, kind === 'guard' ? '[o_o]' : '(o o)')
  put(1, 2, '/[' + emblems[kind] + ']\\')
  const walking = Math.abs(Math.floor(Number(options.frame) || 0)) % 2 === 1
  put(0, 3, walking ? ' _/ \\_ ' : ' _| |_ ')

  if (kind === 'priest') {
    for (let y = 0; y < MOVER_HEIGHT; y++) put(0, y, y === 0 ? '+' : '|')
  } else if (kind === 'tavern') {
    put(6, 2, 'u')
  } else if (kind === 'alchemist') {
    put(6, 2, 'o')
  } else if (kind === 'smith') {
    put(6, 0, 'T')
    put(6, 1, '|')
    put(6, 2, '|')
  } else if (kind === 'armorer') {
    put(0, 2, 'O')
  } else if (kind === 'guard') {
    put(0, 2, '<')
    put(6, 2, '>')
  }

  if (kind === 'hero' && options.weapon === 'sword') {
    put(6, 0, '/')
    put(6, 1, '|')
    put(6, 2, '|')
  } else if (kind === 'hero' && options.weapon === 'crossbow') {
    put(0, 2, '<[H]=>')
  }
  if (kind === 'hero' && options.shield) put(0, 2, 'O')
  if (kind === 'hero' && options.boots) put(0, 3, '[_] [_]')

  return canvas.map((row) => row.join(''))
}

/**
 * The approved small hero in two walking poses. Inventory is deliberately not
 * enough to draw gear: callers pass only the ids currently equipped.
 */
function makeMovingHeroSprite(options = {}) {
  const frame = Math.abs(Math.floor(Number(options.frame) || 0))
  const ids = new Set(Array.isArray(options.items) ? options.items : [])
  const initial =
    String(options.initial || 'T')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 1)
      .toUpperCase() || 'T'
  let weapon = null
  for (const id of ['longbow', 'crossbow', 'warhammer', 'spear', 'sword', 'dagger']) {
    if (ids.has(id)) {
      weapon = id
      break
    }
  }
  const shield = ids.has('shield')
  const boots = ids.has('boots')
  const helmet = ids.has('iron_helmet')
    ? 'iron_helmet'
    : ids.has('leather_cap')
      ? 'leather_cap'
      : null
  const bodyArmor = ids.has('plate')
    ? 'plate'
    : ids.has('chainmail')
      ? 'chainmail'
      : ids.has('leather')
        ? 'leather'
        : null
  const walking = frame % 2 === 1

  const blade = weapon === 'sword' || weapon === 'dagger'
  const ranged = weapon === 'crossbow' || weapon === 'longbow'
  const face = helmet === 'iron_helmet' ? '[O]' : helmet === 'leather_cap' ? '(O)' : 'O'
  const armedFace = helmet ? face : ` ${face}`
  let head = helmet ? ` ${face}` : '  O'
  if (blade) head = walking ? `|${armedFace}` : `/${armedFace}`
  else if (weapon === 'spear') head = `|${armedFace}`
  else if (weapon === 'warhammer') head = `T${armedFace}`
  let torso = walking ? ` \\${initial}-` : ` /${initial}\\`
  if (blade || weapon === 'warhammer') torso = walking ? `/|${initial}-` : `/|${initial}\\`
  else if (weapon === 'spear') torso = walking ? ` |${initial}-` : ` |${initial}\\`
  else if (ranged) {
    const bow = weapon === 'longbow' ? ')' : '-'
    torso = walking ? `>${bow}${initial}-` : `>${bow}${initial}\\`
  }
  if (bodyArmor) {
    const mark = bodyArmor === 'plate' ? 'H' : bodyArmor === 'chainmail' ? '#' : '{'
    torso = torso.replace(initial, mark + initial)
  }
  if (shield) torso += ' [#]'

  const legs = boots ? (walking ? ' _/|' : ' /_\\') : walking ? '  /|' : ' / \\'
  return [head, torso, legs]
}

/** Faithful 25x25 master by Hayley Jane Wakenshaw (hjw). */
const GUARD_MASTER = [
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
].map((line) => line.padEnd(PERSON_WIDTH))

module.exports = {
  PERSON_WIDTH,
  PERSON_HEIGHT,
  MAP_PERSON_WIDTH,
  MAP_PERSON_HEIGHT,
  MOVER_WIDTH,
  MOVER_HEIGHT,
  GUARD_MASTER,
  makePersonSprite,
  makeMapPersonSprite,
  makeMovingPersonSprite,
  makeMovingHeroSprite
}
