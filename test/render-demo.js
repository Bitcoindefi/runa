'use strict'

/**
 * Print every view with sample data, so a change to render.js can be eyeballed
 * without launching the game.
 *
 *   bare test/render-demo.js
 *
 * Prints the frames with the ANSI stripped, which is the only honest way to
 * check that the borders line up: colour codes are invisible cells and hide a
 * width bug rather than showing it.
 */

const { style } = require('bare-tui')
const render = require('../lib/render.js')
const { items, foes } = require('../lib/content.js')
const { ARENA } = require('../lib/world.js')

const W = 80
const H = 24

const stats = {
  name: 'runa',
  level: 3,
  hp: 14,
  maxhp: 20,
  xp: 120,
  xpNext: 250,
  gold: 42,
  potions: 2,
  left: items.sword,
  right: items.boots
}

const log = [
  'salis de casa',
  'el herrero te mira raro',
  'pegas 4',
  'mosquito te pega 5',
  'tomas una pocion',
  'compraste botas por 18 de oro y te quedaste sin nada'
]

const city = [
  '########################################',
  '#....................##................#',
  '#..+--+....+--+......##.....+----+.....#',
  '#..|C.|....|A.|......##.....|.II.|.....#',
  '#..+.-+....+.-+......##.....+-..-+.....#',
  '#....................##................#',
  '#..............................=.......#',
  '#...===========================........#',
  '#..............................=.......#',
  '#..+--+....+---+.......+--+............#',
  '#..|P.|....|R..|.......|..|............#',
  '#..+.-+....+..-+.......+--+............#',
  '#......................................#',
  '#..........................~~~~~~......#',
  '#..........................~~~~~~......#',
  '########################################'
]

const field = [
  '::::::::::::::::::::::::::::::::::::::::',
  ':...."""......:::.........."""".........',
  ':.."""""".....:::........."""""".......:',
  ':...""""......:::..........""""........:',
  ':.............:::......................:',
  ':....%%%......................%%%......:',
  ':...%%%%%....................%%%%%.....:',
  ':....%%%......................%%%......:',
  ':......................................:',
  ':.......~~~~~~~~~~~~...................:',
  ':.......~~~~~~~~~~~~...................:',
  ':......................................:',
  '::::::::::::::::::::::::::::::::::::::::'
]

function bannerFor(text) {
  return '\n' + '='.repeat(W) + '\n== ' + text + '\n' + '='.repeat(W) + '\n'
}

function show(text, frame, w = W, h = H) {
  console.log(bannerFor(text))
  console.log(style.stripAnsi(frame))
  const got = `${style.width(frame)}x${style.height(frame)}`
  const want = `${w}x${h}`
  console.log(`[ mide ${got}, esperado ${want} -> ${got === want ? 'ok' : 'MAL'} ]`)
}

// --- 1. the city ------------------------------------------------------------

show(
  '1. mapScreen - la ciudad',
  render.mapScreen({
    width: W,
    height: H,
    subtitle: 'dia 3',
    place: 'pueblo de runa',
    map: {
      tiles: city,
      hero: { x: 19, y: 8, glyph: '@' },
      actors: [
        { x: 5, y: 10, glyph: 'p' },
        { x: 12, y: 10, glyph: 'a' },
        { x: 29, y: 4, glyph: 'i' },
        { x: 24, y: 6, glyph: 'g' }
      ]
    },
    stats,
    log
  })
)

// --- 2. the field -----------------------------------------------------------

show(
  '2. mapScreen - el campo (camara pegada al borde del mapa)',
  render.mapScreen({
    width: W,
    height: H,
    subtitle: 'dia 3',
    place: 'campo del este',
    map: {
      tiles: field,
      hero: { x: 2, y: 11, glyph: '@' },
      actors: [
        { x: 8, y: 4, glyph: foes.mosquito.glyph },
        { x: 22, y: 6, glyph: foes.golem.glyph },
        { x: 31, y: 10, glyph: foes.mosquito.glyph }
      ]
    },
    stats,
    log
  })
)

// --- 3. combat, far apart ---------------------------------------------------

show(
  '3. combatScreen - espada (alcance 2) contra un mosquito lejos',
  render.combatScreen({
    width: W,
    height: H,
    subtitle: 'tick 91',
    combat: {
      span: ARENA,
      hero: {
        glyph: '@',
        name: 'vos',
        x: 11.4,
        hp: 14,
        maxhp: 20,
        reach: 2,
        cooldown: 14,
        cooldownMax: 20
      },
      foe: { glyph: foes.mosquito.glyph, name: foes.mosquito.name, x: 29.2, hp: 9, maxhp: 13 }
    },
    stats,
    log: ['equipas espada', 'te acercas', 'mosquito te pega 5', 'pegas 4']
  })
)

// --- 4. combat, crossbow in reach, hit ready --------------------------------

show(
  '4. combatScreen - ballesta (alcance 14) con el golpe listo',
  render.combatScreen({
    width: W,
    height: H,
    subtitle: 'tick 132',
    combat: {
      span: ARENA,
      hero: {
        glyph: '@',
        name: 'vos',
        x: 8,
        hp: 19,
        maxhp: 20,
        reach: 14,
        cooldown: 0,
        cooldownMax: 17
      },
      foe: { glyph: foes.golem.glyph, name: foes.golem.name, x: 21, hp: 4, maxhp: 30 }
    },
    stats: { ...stats, left: items.crossbow, right: items.shield, hp: 19 },
    log: ['equipas ballesta', 'pegas 2', 'pegas 2', 'golem te pega 6']
  })
)

// --- 5. combat over ---------------------------------------------------------

show(
  '5. combatScreen - se termino',
  render.combatScreen({
    width: W,
    height: H,
    subtitle: 'tick 210',
    combat: {
      span: ARENA,
      hero: {
        glyph: '@',
        name: 'vos',
        x: 19,
        hp: 3,
        maxhp: 20,
        reach: 2,
        cooldown: 20,
        cooldownMax: 20
      },
      foe: { glyph: foes.mosquito.glyph, name: foes.mosquito.name, x: 19.5, hp: 0, maxhp: 13 },
      over: 'ganaste'
    },
    stats: { ...stats, hp: 3 },
    log: ['pegas 4', 'el mosquito cae', 'ganaste 12 de oro', 'ganaste 30 de experiencia']
  })
)

// --- 6. the shop ------------------------------------------------------------

show(
  '6. shopScreen - armeria',
  render.shopScreen({
    width: W,
    height: H,
    subtitle: 'dia 3',
    shop: {
      title: 'armeria',
      gold: 42,
      cursor: 1,
      items: [
        { ...items.sword, price: 12, owned: true },
        { ...items.crossbow, price: 30 },
        { ...items.shield, price: 55 },
        { ...items.boots, price: 18 }
      ]
    },
    stats,
    log
  })
)

// --- 7. the potion shop, broke ----------------------------------------------

show(
  '7. shopScreen - sin plata',
  render.shopScreen({
    width: W,
    height: H,
    shop: {
      title: 'boticario',
      gold: 3,
      cursor: 0,
      items: [
        { name: 'pocion', glyph: '!', price: 10, about: 'te devuelve 8 de vida en el acto' },
        { name: 'pocion grande', glyph: '!', price: 26, about: 'te devuelve toda la vida' }
      ]
    },
    stats: { ...stats, gold: 3 },
    log: ['no te alcanza']
  })
)

// --- 8. the minimum size ----------------------------------------------------

show(
  `8. mapScreen al minimo (${render.MIN_WIDTH}x${render.MIN_HEIGHT})`,
  render.mapScreen({
    width: render.MIN_WIDTH,
    height: render.MIN_HEIGHT,
    place: 'pueblo',
    map: { tiles: city, hero: { x: 19, y: 8, glyph: '@' }, actors: [] },
    stats,
    log
  }),
  render.MIN_WIDTH,
  render.MIN_HEIGHT
)

// --- 9. too small -----------------------------------------------------------

console.log(bannerFor('9. terminal mas chica que el minimo (48x11)'))
const small = render.mapScreen({
  width: 48,
  height: 11,
  map: { tiles: city, hero: { x: 19, y: 8 } },
  stats,
  log
})
console.log('+' + '-'.repeat(48) + '+')
for (const line of style.stripAnsi(small).split('\n')) console.log('|' + line + '|')
console.log('+' + '-'.repeat(48) + '+')
console.log(`[ ${style.width(small)} x ${style.height(small)} cells, esperado 48 x 11 ]`)

// --- 10. panes on their own -------------------------------------------------

console.log(bannerFor('10. piezas sueltas'))
console.log('bar(14, 20, 20)   ' + render.bar(14, 20, 20))
console.log('bar(1, 20, 20)    ' + render.bar(1, 20, 20))
console.log('bar(19, 20, 20)   ' + render.bar(19, 20, 20))
console.log('bar(0, 20, 20)    ' + render.bar(0, 20, 20))
console.log('bar(20, 20, 20)   ' + render.bar(20, 20, 20))
console.log('')
console.log(style.stripAnsi(render.box(render.statsPanel(stats, 26), 26, undefined, 'ficha')))
console.log('')
console.log(style.stripAnsi(render.box(render.logPanel(log, 26, 5), 26, 5, 'log')))
console.log('')
console.log('mapPane con cellW 1 (el mismo mapa, estirado a lo alto):')
console.log(
  style.stripAnsi(
    render.box(
      render.mapPane({ tiles: city, hero: { x: 19, y: 8, glyph: '@' } }, 40, 12, { cellW: 1 }),
      40,
      12
    )
  )
)

// --- 11. size sweep ---------------------------------------------------------

console.log(bannerFor('11. barrido de tamanos, cada frame tiene que medir exacto'))
let bad = 0
for (let w = 60; w <= 140; w += 7) {
  for (let h = 14; h <= 50; h += 3) {
    const frame = render.mapScreen({
      width: w,
      height: h,
      map: {
        tiles: city,
        hero: { x: 19, y: 8, glyph: '@' },
        actors: [{ x: 5, y: 10, glyph: 'p' }]
      },
      stats,
      log
    })
    const gw = style.width(frame)
    const gh = style.height(frame)
    if (gw !== w || gh !== h) {
      bad++
      console.log(`  MAL ${w}x${h} -> ${gw}x${gh}`)
    }
    const combat = render.combatScreen({
      width: w,
      height: h,
      combat: {
        span: ARENA,
        hero: {
          glyph: '@',
          name: 'vos',
          x: 11,
          hp: 14,
          maxhp: 20,
          reach: 2,
          cooldown: 5,
          cooldownMax: 20
        },
        foe: { glyph: '~', name: 'mosquito', x: 29, hp: 9, maxhp: 13 }
      },
      stats,
      log
    })
    if (style.width(combat) !== w || style.height(combat) !== h) {
      bad++
      console.log(`  MAL combate ${w}x${h} -> ${style.width(combat)}x${style.height(combat)}`)
    }
    const shop = render.shopScreen({
      width: w,
      height: h,
      shop: {
        title: 'armeria',
        gold: 42,
        cursor: 1,
        items: [
          { ...items.sword, price: 12 },
          { ...items.crossbow, price: 30 }
        ]
      },
      stats,
      log
    })
    if (style.width(shop) !== w || style.height(shop) !== h) {
      bad++
      console.log(`  MAL tienda ${w}x${h} -> ${style.width(shop)}x${style.height(shop)}`)
    }
  }
}
console.log(bad === 0 ? '  todos los tamanos miden exacto' : `  ${bad} frames mal medidos`)

// --- 12. ascii audit --------------------------------------------------------

console.log(bannerFor('12. auditoria de charset: nada arriba de ASCII 127'))
const audit = [
  render.mapScreen({
    width: 100,
    height: 30,
    map: { tiles: city, hero: { x: 19, y: 8 } },
    stats,
    log
  }),
  render.combatScreen({
    width: 100,
    height: 30,
    combat: {
      span: ARENA,
      hero: {
        glyph: '@',
        name: 'vos',
        x: 11,
        hp: 14,
        maxhp: 20,
        reach: 2,
        cooldown: 5,
        cooldownMax: 20
      },
      foe: { glyph: '#', name: 'golem', x: 29, hp: 9, maxhp: 30 }
    },
    stats,
    log
  }),
  render.shopScreen({
    width: 100,
    height: 30,
    shop: { title: 'armeria', gold: 42, items: [{ ...items.sword, price: 12 }] },
    stats,
    log
  }),
  render.mapScreen({ width: 20, height: 8, map: { tiles: city, hero: { x: 1, y: 1 } }, stats, log })
]
const offenders = new Set()
for (const frame of audit) {
  for (const ch of style.stripAnsi(frame)) {
    const cp = ch.codePointAt(0)
    if (cp > 126 || (cp < 32 && cp !== 10)) offenders.add(cp)
  }
}
console.log(
  offenders.size === 0
    ? '  limpio: todo cae en ASCII 32..126'
    : '  fuera de rango: ' + [...offenders].join(', ')
)

// --- 13. non ascii input gets neutralised -----------------------------------

console.log(bannerFor('13. contenido no-ASCII entra y sale como ?'))
const ch = (n) => String.fromCharCode(n)
const dirty = [
  'poci' + ch(0xf3) + 'n de curaci' + ch(0xf3) + 'n',
  'el herrero ' + ch(0x2500) + ' te mira',
  'caja ' + ch(0x2588) + ch(0x2588) + ' rota'
]
console.log('entra: ' + JSON.stringify(dirty))
console.log(style.stripAnsi(render.box(render.logPanel(dirty, 26, 4), 26, 4, 'log')))
