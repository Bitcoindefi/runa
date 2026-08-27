'use strict'

/**
 * NOX uses the same urban grammar as RUNA: a scrolling exterior capital with
 * medium street-facing buildings, several avenues, civic squares and open
 * gardens. Its art and landmarks remain dark-elven rather than mirroring the
 * kingdom cell for cell.
 */
const NOX_BUILDINGS = Object.freeze([
  { id: 'palace', name: 'palacio del eclipse', x: 112, y: 12, w: 96, h: 42 },
  {
    id: 'church',
    name: 'santuario de la luna',
    x: 18,
    y: 88,
    w: 43,
    h: 24,
    door: 'I',
    doorX: 39
  },
  {
    id: 'home',
    name: 'casa del linaje',
    x: 84,
    y: 91,
    w: 31,
    h: 21,
    door: 'C',
    doorX: 99
  },
  {
    id: 'tavern',
    name: 'posada del velo',
    x: 204,
    y: 90,
    w: 41,
    h: 22,
    door: 'T',
    doorX: 224
  },
  {
    id: 'potions',
    name: 'alquimia micelial',
    x: 267,
    y: 89,
    w: 37,
    h: 23,
    door: 'P',
    doorX: 285
  },
  {
    id: 'weapons',
    name: 'forja umbria',
    x: 20,
    y: 150,
    w: 45,
    h: 22,
    door: 'A',
    doorX: 42
  },
  {
    id: 'armor',
    name: 'armeria de obsidiana',
    x: 256,
    y: 150,
    w: 45,
    h: 22,
    door: 'D',
    doorX: 278
  }
])

function makeNoxCapitalRows() {
  const width = 320
  const height = 200
  const textureNoise = (x, y) => {
    let value = Math.imul(x + 23, 374761393) + Math.imul(y + 31, 668265263)
    value = Math.imul(value ^ (value >>> 13), 1274126177)
    return (value ^ (value >>> 16)) >>> 0
  }
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const noise = textureNoise(x, y)
      if (noise % 53 === 0) return '*'
      return noise % 17 === 0 ? ';' : '`'
    })
  )

  const set = (x, y, glyph) => {
    if (x >= 0 && y >= 0 && x < width && y < height) grid[y][x] = glyph
  }
  const fill = (x, y, w, h, glyph) => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) set(col, row, glyph)
    }
  }
  const quietGround = (x, y, w, h, glyph = ';', spacing = 19) => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        set(col, row, textureNoise(col, row) % spacing === 0 ? glyph : '`')
      }
    }
  }
  const write = (x, y, text) => {
    const line = String(text)
    for (let index = 0; index < line.length; index++) set(x + index, y, line[index])
  }
  const centred = (x, y, w, text) =>
    write(x + Math.max(0, Math.floor((w - String(text).length) / 2)), y, text)
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
  const stamp = (x, y, rows) => {
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < rows[row].length; col++) {
        if (rows[row][col] !== ' ') set(x + col, y + row, rows[row][col])
      }
    }
  }

  const garden = (x, y, w, h, name) => {
    quietGround(x, y, w, h, ',', 11)
    border(x, y, w, h)
    write(x + 3, y, '[ ' + name + ' ]')
    const centreX = x + Math.floor(w / 2)
    const centreY = y + Math.floor(h / 2)
    fill(x, centreY - 1, w, 3, '.')
    fill(centreX - 2, y, 5, h, '.')
    for (let row = y + 5; row < y + h - 4; row += 7) {
      for (let col = x + 7; col < x + w - 5; col += 11) {
        stamp(col - 2, row - 1, [' *** ', '(***)', '  |  '])
      }
    }
    const pondX = centreX - 9
    fill(pondX, centreY - 3, 18, 7, '~')
    write(pondX, centreY - 3, '/~~~~~~~~~~~~~~~~\\')
    write(pondX, centreY + 3, '\\~~~~~~~~~~~~~~~~/')
    fill(centreX - 1, centreY - 3, 3, 7, '.')
  }

  const drawBuilding = (building) => {
    const { id, name, x, y, w, h, door, doorX } = building
    const bottom = y + h - 1
    const roofH = id === 'church' ? 7 : 5
    fill(x - 2, y - 2, w + 4, h + 4, '`')

    for (let row = 0; row < roofH; row++) {
      const inset = roofH - row - 1
      const left = x + inset
      const right = x + w - inset - 1
      set(left, y + row, '/')
      set(right, y + row, '\\')
      for (let col = left + 1; col < right; col++) {
        set(col, y + row, (col + row) % 9 === 0 ? ':' : '#')
      }
    }

    const wallY = y + roofH
    fill(x + 1, wallY + 1, w - 2, bottom - wallY - 1, ' ')
    border(x, wallY, w, bottom - wallY + 1, '_', '|')
    centred(x, wallY + 2, w, name)

    write(x + 4, wallY + 5, '/\\')
    write(x + 3, wallY + 6, '/[]\\')
    write(x + w - 7, wallY + 5, '/\\')
    write(x + w - 8, wallY + 6, '/[]\\')

    if (id === 'church') {
      centred(x, y - 4, w, '   /^\\   ')
      centred(x, y - 3, w, '  /#()\\  ')
      centred(x, wallY + 6, w, '.---(  )---.')
      centred(x, wallY + 8, w, '  /##\\/##\\  ')
      centred(x, wallY + 9, w, '  |[]||[]|  ')
    } else if (id === 'home') {
      centred(x, wallY + 6, w, '/\\  sello  /\\')
      centred(x, wallY + 8, w, '[()]  ||  [()]')
    } else if (id === 'tavern') {
      centred(x, wallY + 6, w, '/\\  copa del velo  /\\')
      centred(x, wallY + 8, w, '(__)  [==]  (__)')
    } else if (id === 'potions') {
      centred(x, wallY + 6, w, 'o  /\\  o  /\\  o')
      centred(x, wallY + 8, w, '/::\\  /~~\\  /::\\')
      centred(x, wallY + 9, w, '\\__/  \\__/  \\__/')
    } else if (id === 'weapons') {
      centred(x, wallY + 6, w, '<====  /\\  ====>')
      centred(x, wallY + 8, w, 'fragua (()) yunque')
      centred(x, wallY + 9, w, '______/##\\______')
    } else if (id === 'armor') {
      centred(x, y - 1, w, '^__^__^__^__^')
      centred(x, wallY + 6, w, '/##\\   /##\\   /##\\')
      centred(x, wallY + 8, w, '|()|   |[]|   |()|')
      centred(x, wallY + 9, w, '|__|   |__|   |__|')
    }

    const doorLeft = doorX - 3
    write(doorLeft, bottom - 5, '/-----\\')
    for (let row = bottom - 4; row < bottom; row++) write(doorLeft, row, '|     |')
    write(doorLeft, bottom - 2, '| /\\  |')
    write(doorLeft, bottom - 1, '|_||__|')
    write(doorLeft, bottom, '|__' + door + '__|')
    set(doorX, bottom, door)
    return { x: doorX, y: bottom }
  }

  const drawPalace = () => {
    const palace = NOX_BUILDINGS[0]
    const { x, y, w, h, name } = palace
    const bottom = y + h - 1
    const roofH = 7
    fill(x - 3, y - 3, w + 6, h + 6, '`')
    for (let row = 0; row < roofH; row++) {
      const inset = roofH - row - 1
      write(x + inset, y + row, '/' + '#'.repeat(w - inset * 2 - 2) + '\\')
    }
    border(x, y + roofH, w, h - roofH, '#', '|')
    centred(x, y + roofH + 2, w, name)
    centred(x, y + roofH + 4, w, 'corona de nox')

    for (const towerX of [x + 4, x + 22, x + w - 31, x + w - 13]) {
      stamp(towerX, y + roofH + 6, [
        '   ^   ',
        '  /#\\  ',
        ' /###\\ ',
        '|#()#|',
        '|#[]#|',
        '|####|',
        '|_||_|'
      ])
    }
    centred(x, y + roofH + 8, w, '        /\\        ')
    centred(x, y + roofH + 9, w, '   ____/##\\____   ')
    centred(x, y + roofH + 10, w, '  /###/()\\###\\  ')
    centred(x, y + roofH + 11, w, ' /___/####\\___\\ ')
    centred(x, y + roofH + 13, w, '|  galeria lunar  |')
    centred(x, y + roofH + 15, w, '| [()]  ||  [()] |')
    centred(x, bottom - 5, w, '/-----------\\')
    centred(x, bottom - 4, w, '|   /\\      |')
    centred(x, bottom - 3, w, '|  /##\\     |')
    centred(x, bottom - 2, w, '|  |  |     |')
    centred(x, bottom - 1, w, '|__|..|_____|')
    fill(159, bottom - 1, 3, 7, '.')
  }

  const drawCivicHouse = (x, y, w, h, name, crest) => {
    const roofH = 4
    const bottom = y + h - 1
    for (let row = 0; row < roofH; row++) {
      const left = x + roofH - row - 1
      const right = x + w - roofH + row
      write(left, y + row, '/' + '#'.repeat(Math.max(0, right - left - 1)) + '\\')
    }
    fill(x + 1, y + roofH + 1, w - 2, h - roofH - 2, ' ')
    border(x, y + roofH, w, h - roofH, '_', '|')
    centred(x, y + roofH + 2, w, name)
    centred(x, y + roofH + 4, w, '[ ' + crest + ' ]')
    write(x + 4, y + roofH + 6, '[()]')
    write(x + w - 8, y + roofH + 6, '[()]')
    centred(x, bottom - 3, w, '/-----\\')
    centred(x, bottom - 2, w, '|  .  |')
    centred(x, bottom - 1, w, '|  .  |')
    centred(x, bottom, w, '|__...|')
  }

  const eclipseSquare = () => {
    const x = 91
    const y = 142
    const w = 138
    const h = 26
    quietGround(x, y, w, h, ';', 19)
    border(x, y, w, h, '_', ':')
    const centreX = x + Math.floor(w / 2)
    const centreY = y + Math.floor(h / 2)
    fill(x, centreY - 1, w, 3, '.')
    fill(centreX - 2, y, 5, h, '.')
    write(x + 8, y, '[ plaza del eclipse ]')
    for (const benchX of [x + 20, x + w - 30]) {
      write(benchX, y + 5, '[======]')
      write(benchX, y + h - 6, '[======]')
    }
    for (const [treeX, treeY] of [
      [x + 12, y + 6],
      [x + w - 13, y + 6],
      [x + 12, y + h - 7],
      [x + w - 13, y + h - 7]
    ]) {
      stamp(treeX - 2, treeY - 1, [' *** ', '(***)', '  |  '])
    }
    stamp(centreX - 8, centreY - 7, [
      '       ^       ',
      '      /#\\      ',
      '     /#()\\     ',
      '    /######\\    ',
      '   | obelisco |   ',
      '   |    ||    |   ',
      '  /=====..=====\\  '
    ])
  }

  fill(0, 0, width, 1, '#')
  fill(0, height - 1, width, 1, '#')
  fill(0, 0, 1, height, '#')
  fill(width - 1, 0, 1, height, '#')

  // Same readable street hierarchy as RUNA, authored as a distinct city.
  fill(157, 1, 6, height - 2, '.')
  fill(1, 58, width - 2, 6, '.')
  fill(1, 118, width - 2, 6, '.')
  fill(1, 178, width - 2, 6, '.')
  fill(73, 64, 4, 54, '.')
  fill(247, 64, 4, 54, '.')
  fill(73, 124, 4, 54, '.')
  fill(247, 124, 4, 54, '.')

  garden(5, 5, 65, 43, 'jardin de esporas')
  garden(250, 5, 65, 43, 'jardin de amatista')
  drawPalace()

  quietGround(116, 68, 88, 50, ';', 19)
  border(116, 68, 88, 50, '_', ':')
  fill(157, 64, 6, 60, '.')
  centred(116, 70, 88, '[ paseo de la luna ]')
  stamp(146, 76, [
    '          .----.',
    '       .-~ (  ) ~-.',
    '      /    /##\\    \\',
    '     |    |()|     |',
    '      \\    \\/     /',
    "       '-.____.-'",
    '    .----------------.',
    '   /~~~~~~~~~~~~~~~~~~\\',
    '   \\__________________/'
  ])

  const doors = NOX_BUILDINGS.slice(1).map(drawBuilding)
  for (const door of doors) {
    const nextStreet = door.y < 118 ? 118 : 178
    fill(door.x - 1, door.y + 1, 3, Math.max(1, nextStreet - door.y), '.')
  }

  drawCivicHouse(122, 94, 31, 18, 'consejo del velo', 'media luna')
  drawCivicHouse(168, 94, 31, 18, 'archivo de sombras', 'runa')
  centred(121, 128, 78, '[ mercado nocturno ]')
  stamp(98, 130, ['/\\/\\/\\/\\', '| hongos y sal |', '|_()_{}__()_|'])
  stamp(194, 130, ['/\\/\\/\\/\\', '| seda y cristal |', '|_[]_{}__[]_|'])
  eclipseSquare()

  // A western gate mirrors RUNA's border placement without copying its art.
  border(0, 105, 14, 12, '#')
  border(0, 125, 14, 12, '#')
  centred(0, 108, 14, 'torre oeste')
  centred(0, 128, 14, 'torre oeste')
  fill(1, 117, 20, 8, '.')
  write(1, 117, '|===========|')
  write(1, 124, '|===========|')
  write(15, 116, '[frontera runa]')
  set(1, 120, 'R')

  // Southern gatehouse closes the main avenue as a real city landmark.
  fill(130, 184, 61, 15, ' ')
  border(130, 184, 61, 15, '#')
  border(130, 181, 15, 18, '#')
  border(176, 181, 15, 18, '#')
  centred(130, 186, 61, 'puerta de la noche profunda')
  for (let row = 189; row <= 194; row++) write(145, row, '|                             |')
  write(145, 195, '|____________cerrada__________|')

  return grid.map((row) => row.join(''))
}

module.exports = {
  NOX_BUILDINGS,
  makeNoxCapitalRows
}
