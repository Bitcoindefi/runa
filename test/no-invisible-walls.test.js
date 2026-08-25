const { test } = require('brittle')
const M = require('../lib/map.js')

test('art leftover glyphs live in the tile table, not in NOWHERE (#6)', (t) => {
  t.is(M.TILES[' '].id, 'open')
  t.is(M.TILES[' '].solid, false, 'a carved-out gap is open ground')
  t.is(M.TILES['='].solid, true, 'the lattice stays part of the facade')
  t.is(M.TILES['`'].solid, true)
  t.is(M.TILES["'"].solid, true)
})

test('no in-bounds cell of the city resolves to NOWHERE anymore (#6)', (t) => {
  // The issue counted 15938 of 64000 cells (24.9%) falling into NOWHERE via
  // four undeclared glyphs. Every glyph the art uses must now be declared.
  const city = M.MAPS.city
  let nowhere = 0
  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < city.width; x++) {
      if (M.tileAt(city, x, y).id === 'nowhere') nowhere++
    }
  }
  t.is(nowhere, 0, 'every glyph in the active art is declared in TILES')
})

test('walking into an art gap meets open ground, not an invisible wall (#6)', (t) => {
  const city = M.MAPS.city
  let checked = 0
  for (let y = 0; y < city.height; y++) {
    const row = city.rows[y]
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== ' ') continue
      checked++
      if (M.isSolid(city, x, y)) {
        t.fail(`space at ${x},${y} is still solid`)
        return
      }
    }
  }
  t.ok(checked > 10000, `the scan actually saw the art gaps (saw ${checked})`)
})