const { test } = require('brittle')
const { style } = require('bare-tui')
const render = require('../lib/render.js')

test('the hero never paints through a wall (#16)', (t) => {
  // Dungeon-style arrival: the three-row hero stands with its feet two rows
  // below a full wall, like arriving at (3,2) in the issue. The head row of
  // the sprite lands on the wall and must be clipped away.
  const tiles = ['######', '#....#', '#....#', '######']
  const pane = style.stripAnsi(
    render.mapPane({ tiles, actors: [], hero: { x: 3, y: 2, sprite: [' O ', '/|\\', '/ \\'] } }, 24, 12, {
      cellW: 1
    })
  )

  t.ok(pane.includes('######'), 'the top wall stays a continuous wall')
  t.ok(!pane.includes('O'), 'the head is clipped instead of punching a hole in the wall')
  t.ok(pane.includes('|'), 'the torso still shows on the free row below')
})

test('a hero arriving at the top edge loses only the off-map rows (#16)', (t) => {
  // Field arrival at (40,1): the upper body reaches past row 0. Off-map cells
  // read as solid, so they get skipped, while the feet stay put.
  const tiles = ['........', '........', '########']
  const pane = style.stripAnsi(
    render.mapPane({ tiles, actors: [], hero: { x: 4, y: 0, sprite: ['O', '|', '^'] } }, 20, 8, {
      cellW: 1
    })
  )

  t.ok(!pane.includes('O'), 'nothing is painted above the map')
  t.ok(pane.includes('^'), 'the feet remain exactly where the walker stands')
  t.ok(style.stripAnsi(render.mapPane({ tiles, actors: [], hero: { x: 4, y: 0 } }, 20, 8)).includes('@'), 'glyph heroes keep rendering')
})

test('a hero without map data keeps rendering (fallback path unchanged)', (t) => {
  const pane = style.stripAnsi(
    render.mapPane({ tiles: [], actors: [], hero: { x: 5, y: 5, sprite: ['O', '|', '^'] } }, 20, 8, {
      cellW: 1
    })
  )

  t.ok(pane.includes('O'), 'with no tiles there is nothing solid to clip against')
})