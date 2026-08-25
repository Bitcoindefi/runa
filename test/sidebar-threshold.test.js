const { test } = require('brittle')
const { style } = require('bare-tui')
const render = require('../lib/render.js')

function cityFrame(width) {
  return style.stripAnsi(
    render.mapScreen({
      width,
      height: 20,
      place: 'plaza',
      stats: { hp: 9, maxhp: 12, gold: 7 },
      log: ['primer mensaje'],
      cellW: 1,
      map: {
        tiles: ['........', '........', '........'],
        actors: [],
        hero: { x: 4, y: 1 }
      }
    })
  )
}

test('the city keeps ficha and log from MIN_WIDTH up to the old cutoff (#7)', (t) => {
  for (const width of [64, 70, 80, 90]) {
    const frame = cityFrame(width)
    t.ok(frame.includes('ficha'), `${width} columns show the sheet`)
    t.ok(frame.includes('log'), `${width} columns show the log panel`)
    t.ok(frame.includes('primer mensaje'), `${width} columns surface new model state`)
  }
})

test('below MIN_WIDTH nothing pretends to fit, and an explicit opt-out still works (#7)', (t) => {
  t.ok(!cityFrame(63).includes('ficha'), '63 columns stay on the too-small screen')

  const wide = render.mapScreen({
    width: 100,
    height: 20,
    place: 'plaza',
    stats: {},
    log: [],
    sidebar: false,
    cellW: 1,
    map: { tiles: ['....'], actors: [], hero: { x: 0, y: 0 } }
  })
  t.ok(!style.stripAnsi(wide).includes('ficha'), 'sidebar:false keeps its escape-hatch meaning')
})