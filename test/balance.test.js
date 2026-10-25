const { test } = require('brittle')
const { World, TPS } = require('../lib/world.js')
const CONTENT = require('../lib/content.js')
const { Player, xpToLeave } = require('../lib/shop.js')
const { COMBAT_RULES, playTurn } = require('../lib/combat-rules.js')

// El balance de las armas por tamano (docs/combate.md): peleas de verdad de
// lib/world.js, como las arma el campo (contacto a una celda, el equipo de la
// ficha puesto con Player.outfit), con cada arma contra cada monstruo en los
// niveles 1, 3 y 5. Sin pociones ni armadura: mide el arma sola. El heroe ataca
// en cada turno (L3: hasta el proximo golpe).

const WEAPONS = ['dagger', 'sword', 'spear', 'crossbow', 'warhammer', 'longbow']
const LEVELS = [1, 3, 5]
const FOES = Object.keys(CONTENT.foes)
// Los jefes de la cripta y de los campamentos: peleas mas largas a proposito.
const BOSSES = new Set(['skeleton_king', 'barbarian_chief', 'skeleton_elite'])
// Lo primero que encuentra una partida nueva con la daga de inicio.
const STARTERS = ['mosquito', 'slime', 'skeleton', 'espectro', 'barbarian_raider']

function xpFor(level) {
  let xp = 0
  for (let at = 1; at < level; at++) xp += xpToLeave(at)
  return xp
}

function fight(foe, weapon, level, rules = COMBAT_RULES) {
  const player = new Player({
    xp: xpFor(level),
    potions: 0,
    items: weapon ? [weapon] : [],
    equipped: weapon ? { left_hand: weapon } : {}
  })
  const world = player.outfit(new World(foe, rules))
  world.foe.x = 1
  let turns = 0
  while (!world.over && world.tick < TPS * 120) {
    playTurn(world, undefined, rules)
    turns++
  }
  const hits = world.log.filter((line) => line.type === 'hit' && line.by === 'hero').length
  return {
    won: world.over === 'ganaste',
    over: world.over,
    seconds: world.tick / TPS,
    hp: Math.max(0, Math.ceil(world.hero.hp)),
    maxhp: player.maxHp,
    hits,
    turns,
    tick: world.tick,
    foeHp: Math.ceil(world.foe.hp)
  }
}

const RESULTS = {}
for (const level of LEVELS) {
  for (const foe of FOES) {
    for (const weapon of [null, ...WEAPONS]) {
      RESULTS[[level, foe, weapon || 'mano'].join(':')] = fight(foe, weapon, level)
    }
  }
}
const result = (level, foe, weapon) => RESULTS[[level, foe, weapon || 'mano'].join(':')]

test('balance: la tabla de peleas por nivel, monstruo y arma', (t) => {
  const pad = (text, n) => String(text).padStart(n)
  for (const level of LEVELS) {
    const maxhp = result(level, FOES[0], null).maxhp
    t.comment(`nivel ${level} (vida ${maxhp}): G gana, p pierde; segundos y vida que queda`)
    t.comment('monstruo'.padEnd(18) + ['mano', ...WEAPONS].map((w) => pad(w, 11)).join(''))
    for (const foe of FOES) {
      const cells = [null, ...WEAPONS].map((weapon) => {
        const r = result(level, foe, weapon)
        return pad(`${r.won ? 'G' : 'p'} ${r.seconds.toFixed(1)}s ${r.hp}`, 11)
      })
      t.comment(foe.padEnd(18) + cells.join(''))
    }
  }
  t.pass('tabla impresa')
})

test('balance: las armas pegan segun su tamano y el dano por segundo queda en su banda', (t) => {
  const stats = {}
  for (const id of WEAPONS) {
    const item = CONTENT.items[id]
    const damage = 1 + item.atk
    const seconds = item.cooldown / TPS
    stats[id] = { damage, seconds, dps: damage / seconds, reach: item.reach }
    t.comment(
      `${id}: ${damage} cada ${seconds.toFixed(2)} s = ${(damage / seconds).toFixed(2)} por segundo, alcance ${item.reach}`
    )
  }
  // Mas grande, mas dano por golpe y mas segundos entre golpes.
  const order = (ids) => {
    for (let i = 1; i < ids.length; i++) {
      const a = stats[ids[i - 1]]
      const b = stats[ids[i]]
      t.ok(b.damage > a.damage, `${ids[i]} pega mas que ${ids[i - 1]}`)
      t.ok(b.seconds > a.seconds, `${ids[i]} tarda mas que ${ids[i - 1]}`)
    }
  }
  order(['dagger', 'sword', 'spear', 'warhammer'])
  order(['crossbow', 'longbow'])
  t.ok(
    stats.dagger.seconds >= 0.7 && stats.dagger.seconds <= 1,
    'la daga pega mas o menos una vez por segundo'
  )
  for (const id of ['dagger', 'sword', 'warhammer', 'spear']) {
    t.ok(stats[id].dps >= 3.5 && stats[id].dps <= 4.6, `${id}: cuerpo a cuerpo, de 3,5 a 4,6`)
  }
  for (const id of ['crossbow', 'longbow']) {
    t.ok(stats[id].dps >= 2.5 && stats[id].dps <= 3.5, `${id}: a distancia, de 2,5 a 3,5`)
    t.ok(stats[id].dps < stats.dagger.dps, `${id} pega menos por segundo: pega gratis de lejos`)
  }
})

test('balance: con la daga de inicio el nivel 1 le gana a lo primero que encuentra', (t) => {
  for (const foe of STARTERS) {
    const r = result(1, foe, 'dagger')
    t.ok(
      r.won,
      `nivel 1 con la daga le gana al ${foe} en ${r.seconds.toFixed(1)} s, le queda ${r.hp}`
    )
  }
  // A mano limpia (la regla de content.js) solo el slime.
  for (const foe of FOES) {
    const r = result(1, foe, null)
    if (foe === 'slime') t.ok(r.won, 'a mano limpia se le gana al slime')
    else t.absent(r.won, `a mano limpia el ${foe} gana`)
  }
})

test('balance: nada cae de un golpe', (t) => {
  let fights = 0
  const biggest = Math.max(...WEAPONS.map((id) => 1 + CONTENT.items[id].atk))
  const smallest = Math.min(...FOES.map((id) => CONTENT.foes[id].stats.hp))
  t.ok(
    biggest < smallest,
    `el golpe mas grande (${biggest}) no llega a la vida mas chica (${smallest})`
  )
  for (const level of LEVELS) {
    for (const foe of FOES) {
      for (const weapon of WEAPONS) {
        const r = result(level, foe, weapon)
        if (!r.won) continue
        fights++
        if (r.hits < 2) t.fail(`${foe} cae de un golpe con ${weapon} en el nivel ${level}`)
      }
    }
  }
  const hardest = Math.max(...FOES.map((id) => CONTENT.foes[id].stats.atk))
  t.ok(hardest < 20, `ningun monstruo (el que mas pega, ${hardest}) tumba al nivel 1 de un golpe`)
  t.ok(fights > 150, `${fights} peleas ganadas, todas de mas de un golpe`)
})

test('balance: las peleas duran unos segundos, no decenas', (t) => {
  const won = []
  for (const level of LEVELS) {
    for (const foe of FOES) {
      for (const weapon of WEAPONS) {
        const r = result(level, foe, weapon)
        const what = `nivel ${level}, ${weapon} contra ${foe}: ${r.seconds.toFixed(1)} s`
        if (r.seconds > 40) t.fail(`${what}: no termina`)
        if (!r.won) continue
        won.push(r.seconds)
        const limit = BOSSES.has(foe) ? 30 : 12
        if (r.seconds > limit) t.fail(`${what}, mas de ${limit} s`)
      }
    }
  }
  won.sort((a, b) => a - b)
  const median = won[Math.floor(won.length / 2)]
  t.comment(
    `mediana de las peleas ganadas: ${median.toFixed(1)} s, la mas larga ${won.at(-1).toFixed(1)} s`
  )
  t.ok(median >= 2 && median <= 6, `la pelea tipica dura ${median.toFixed(1)} s`)
})

test('balance: el turno hasta el golpe (L3) no cambia la pelea, solo donde se corta', (t) => {
  const fixed = { ...COMBAT_RULES, turnUntilBlow: false }
  let same = 0
  for (const foe of FOES) {
    for (const weapon of WEAPONS) {
      const a = result(1, foe, weapon)
      const b = fight(foe, weapon, 1, fixed)
      if (a.over !== b.over || a.tick !== b.tick || a.hp !== b.hp || a.foeHp !== b.foeHp) {
        t.fail(`${weapon} contra ${foe}: ${JSON.stringify(a)} y ${JSON.stringify(b)}`)
      } else same++
    }
  }
  t.is(same, FOES.length * WEAPONS.length, 'atacando siempre, el mismo final con los dos turnos')
})
