const { test } = require('brittle')
const { style } = require('bare-tui')
const render = require('../lib/render.js')

const NPC = ['(-_-_-)', '[|ooo|]', '(/___\\)']

function frame(heroX, heroY, npcX, npcY) {
  return style.stripAnsi(
    render.mapPane(
      {
        tiles: Array.from({ length: 8 }, () => '..........'),
        actors: [{ x: npcX, y: npcY, sprite: NPC, color: 'green' }],
        hero: { x: heroX, y: heroY, sprite: [' O ', '/|\\', '/ \\'] }
      },
      16,
      10,
      { cellW: 1 }
    )
  )
}

const countOf = (text, ch) => text.split(ch).length - 1

test('talking distance keeps both bodies whole instead of eating pixels (#9)', (t) => {
  const pane = frame(3, 4, 5, 3)

  t.is(countOf(pane, 'O'), 1, 'the hero head survives once')
  t.ok(pane.includes('[|ooo|]'), 'the resident torso is never punched through')
  t.ok(pane.includes('(-_-_-)'), 'the resident head row stays contiguous')
  t.ok(pane.includes('/___\\'), 'the resident feet row stays contiguous')
  t.ok(pane.includes('/|\\'), 'the hero torso stays contiguous')
})

test('far from the hero a resident renders exactly where it stands (#9)', (t) => {
  const pane = frame(0, 7, 5, 3)
  const row = pane.split('\n').find((line) => line.includes('[|ooo|]'))
  // mapW(10) centers inside cols(16): camX = -3, so world col 2 lands on
  // screen col 5.
  t.is(row.indexOf('[|ooo|]'), 5, 'no shift is applied without an overlap to solve')
})