const { test } = require('brittle')
const M = require('../lib/map.js')

function walkableComponentFromSpawn(city) {
  const seen = new Set()
  const queue = [[city.spawn.x, city.spawn.y]]
  while (queue.length) {
    const [x, y] = queue.pop()
    const key = x + ',' + y
    if (seen.has(key)) continue
    if (x < 0 || y < 0 || x >= city.width || y >= city.height) continue
    if (M.isSolid(city, x, y)) continue
    seen.add(key)
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }
  return seen
}

test('both city gardens open into the main walkable component (#5)', (t) => {
  const city = M.MAPS.city
  const reached = walkableComponentFromSpawn(city)

  // The exact compounds the issue measured as sealed: interiors of
  // garden(5, 5, 65, 43) and garden(250, 5, 65, 43).
  const gardens = [
    { x: 5, y: 5, w: 65, h: 43 },
    { x: 250, y: 5, w: 65, h: 43 }
  ]

  for (const g of gardens) {
    let reachedInside = 0
    for (let y = g.y + 1; y < g.y + g.h - 1; y++) {
      for (let x = g.x + 1; x < g.x + g.w - 1; x++) {
        if (!M.isSolid(city, x, y) && reached.has(x + ',' + y)) reachedInside++
      }
    }
    t.ok(
      reachedInside > 1000,
      `interior of garden at ${g.x},${g.y} joins the city (${reachedInside} cells reached)`
    )
  }
})

test('every garden side has a carved gate in the hedge (#5)', (t) => {
  const city = M.MAPS.city
  for (const gx of [5, 250]) {
    const cxg = gx + 32
    const cyg = 5 + 21
    t.is(M.isSolid(city, cxg, 5), false, 'north gate open')
    t.is(M.isSolid(city, cxg - 1, 5), false)
    t.is(M.isSolid(city, cxg, 47), false, 'south gate open')
    t.is(M.isSolid(city, gx, cyg), false, 'west gate open')
    t.is(M.isSolid(city, gx + 64, cyg), false, 'east gate open')
  }
})