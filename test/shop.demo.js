'use strict'

/**
 * Demo of lib/shop.js, end to end, under bare.
 *
 *   cd /root/runa && bare test/shop.demo.js
 *
 * Walks the whole loop: shop, lose a fight, respawn at the church, hunt the
 * field, level up twice, come back and buy the answer, win, save, load, and
 * migrate a save written before there were versions.
 */

const shop = require('../lib/shop.js')
const { Player, shops, browse, ownedOnly, reward, ECONOMY, SAVE_VERSION } = shop
const { World } = require('../lib/world.js')
const { parse, run } = require('../lib/script.js')

const line = (s = '') => console.log(s)
const rule = (t) => line('\n===== ' + t + ' =====')

/**
 * Run one whole fight, the player's script against a foe, and hand back the
 * world so the caller can settle it.
 * @param {Player} player
 * @param {string} foeId
 * @param {string} source
 * @returns {object}
 */
function fight(player, foeId, source) {
  const world = new World(foeId)
  player.outfit(world)

  const { nodes, errors } = parse(source)
  for (const e of errors) line('  script roto linea ' + e.line + ': ' + e.message)

  let denied = ''
  let guard = 0
  while (!world.over && guard++ < 4000) {
    const { actions } = run(nodes, world.snapshot())
    const gated = ownedOnly(player, actions)
    if (gated.problems.length) denied = gated.problems[0]
    world.readIntent(gated.actions)
    world.applyIntent()
    world.step()
  }

  if (denied) line('  el script pidio algo que no tenes: ' + denied)
  return world
}

/** @param {Player} p */
function status(p) {
  const s = p.snapshot()
  line(
    '  oro ' +
      s.gold +
      ' | nivel ' +
      s.level +
      ' | xp ' +
      s.xpinto +
      '/' +
      s.xpneed +
      ' | hp ' +
      s.hp +
      '/' +
      s.maxhp +
      ' | pociones ' +
      s.potions +
      ' | ' +
      (s.items.length ? s.items.join(' ') : 'sin equipo')
  )
}

/** @param {object} w */
function outcome(w) {
  return (
    '  ' +
    w.over +
    ' en el tick ' +
    w.tick +
    ' (vos ' +
    Math.max(0, Math.ceil(w.hero.hp)) +
    ', ' +
    w.foe.name +
    ' ' +
    Math.max(0, Math.ceil(w.foe.hp)) +
    ')'
  )
}

// ---------------------------------------------------------------- las tiendas

rule('LAS TIENDAS')
const hero = new Player()
status(hero)

for (const id of Object.keys(shops)) {
  const w = browse(id, hero)
  line('\n  ' + w.name + ' (' + w.about + ')')
  for (const l of w.lines) {
    line(
      '    ' +
        l.glyph +
        ' ' +
        l.name.padEnd(10) +
        String(l.price).padStart(3) +
        ' oro' +
        (l.ok ? '   comprable' : '   NO: ' + l.reason)
    )
  }
}

// ---------------------------------------------------------------- comprar

rule('COMPRAR: LOS SI Y LOS NO')
for (const id of ['sword', 'sword', 'potion', 'crossbow', 'dragon']) {
  const d = hero.buy(id)
  line(
    '  comprar ' +
      id.padEnd(9) +
      (d.ok ? 'OK por ' + d.price + ' oro en ' + d.shop : 'NO: ' + d.reason)
  )
}
status(hero)

rule('VENDER')
line(
  '  vender shield  ' +
    (() => {
      const r = hero.sell('shield')
      return r.ok ? 'OK' : 'NO: ' + r.reason
    })()
)
const soldPotion = hero.vender('potion')
line(
  '  vender potion  ' +
    (soldPotion.ok
      ? 'te dan ' + soldPotion.paid + ' de ' + soldPotion.price
      : 'NO: ' + soldPotion.reason)
)
status(hero)

// ---------------------------------------------------------------- primera pelea

rule('PRIMERA PELEA: EL SCRIPT INGENUO')
const naive = ['equip sword'].join('\n')
line('  el script es una sola linea, "equip sword", sin regla de pociones')

const first = fight(hero, 'mosquito', naive)
line(outcome(first))

const end = hero.settle(first)
line('  settle: ' + JSON.stringify(end))
if (end.death) {
  line(
    '  despertas en ' +
      end.death.at +
      ' con ' +
      end.death.hp +
      ' de vida, perdiste ' +
      end.death.goldLost +
      ' de oro'
  )
  line(
    '  (el piso de ' +
      ECONOMY.death.goldFloor +
      ' te protegio: tenias ' +
      (end.death.gold + end.death.goldLost) +
      ')'
  )
}
status(hero)

// ---------------------------------------------------------------- el campo

rule('EL CAMPO: SUBIR DOS NIVELES')
const drop = reward('mosquito')
line('  un mosquito paga ' + drop.xp + ' xp y ' + drop.gold + ' de oro')
line('  dejar el nivel 1 cuesta ' + hero.xpNeed + ' xp, el nivel 2 cuesta ' + shop.xpToLeave(2))

for (let i = 1; i <= 5; i++) {
  hero.ganarOro(drop.gold)
  const up = hero.ganarXp(drop.xp)
  line(
    '  mosquito ' +
      i +
      ': +' +
      up.gained +
      ' xp, +' +
      drop.gold +
      ' oro' +
      (up.levels ? '   NIVEL ' + up.level + ', vida maxima ' + up.maxHp : '')
  )
}
status(hero)

// ---------------------------------------------------------------- volver

rule('VOLVER A LA CIUDAD')
for (const id of ['crossbow', 'boots', 'potion', 'potion']) {
  const d = hero.comprar(id)
  line(
    '  comprar ' +
      id.padEnd(9) +
      (d.ok ? 'OK por ' + d.price + ' oro en ' + d.shop : 'NO: ' + d.reason)
  )
}
status(hero)

// ---------------------------------------------------------------- segunda pelea

rule('SEGUNDA PELEA: BALLESTA, BOTAS Y UNA REGLA DE POCIONES')
const kite = ['?hp < 12', ' use potion', 'equip crossbow', 'equipr boots'].join('\n')

const second = fight(hero, 'mosquito', kite)
line(outcome(second))
line('  settle: ' + JSON.stringify(hero.settle(second)))
status(hero)

// ---------------------------------------------------------------- el golem

rule('EL GOLEM: EL QUE LLEGA POR OTA')
line('  volves al script de una linea, el que te habia funcionado')
const third = fight(hero, 'golem', naive)
line(outcome(third))
const g = hero.settle(third)
line('  settle: ' + JSON.stringify(g))
if (g.death) line('  perdiste ' + g.death.goldLost + ' de oro y volves a ' + g.death.at)
status(hero)

// ---------------------------------------------------------------- sin curarte

rule('SALIR SIN PASAR POR LA IGLESIA')
line(
  '  la vida no se recarga sola entre peleas: salis con ' +
    hero.hp +
    '/' +
    hero.maxHp +
    ' y ' +
    hero.gold +
    ' de oro'
)
const fourth = fight(hero, 'mosquito', naive)
line(outcome(fourth))
const d4 = hero.settle(fourth)
line('  settle: ' + JSON.stringify(d4))
if (d4.death) {
  line(
    '  perdiste ' +
      d4.death.goldLost +
      ' de oro (' +
      ECONOMY.death.goldLoss * 100 +
      ' por ciento) y volves a ' +
      d4.death.at +
      ' con ' +
      d4.death.hp +
      '/' +
      hero.maxHp
  )
}
status(hero)

// ---------------------------------------------------------------- guardar

rule('GUARDAR Y CARGAR')
const save = JSON.stringify(hero)
line('  ' + save)

const loaded = Player.fromJSON(save)
line('  cargado:')
status(loaded)

const a = JSON.stringify(hero.snapshot())
const b = JSON.stringify(loaded.snapshot())
line('  identico: ' + (a === b ? 'SI' : 'NO\n    ' + a + '\n    ' + b))
const raw = JSON.parse(save)
line(
  '  nivel y vida maxima fuera del archivo: ' +
    ('level' in raw || 'maxHp' in raw ? 'NO, mal' : 'SI')
)

// ---------------------------------------------------------------- migrar

rule('MIGRAR UN GUARDADO VIEJO')
const old = { gold: 120, level: 3, xp: 30, hp: 25, potions: 2, items: ['sword', 'boots'] }
line('  v0, sin campo version: ' + JSON.stringify(old))

const migrated = Player.fromJSON(old)
line('  migrado a v' + SAVE_VERSION + ': ' + JSON.stringify(migrated))
status(migrated)
line(
  '  seguia en nivel 3 con 30 xp adentro: ' +
    (migrated.level === 3 && migrated.xpInto === 30 ? 'SI' : 'NO')
)

try {
  Player.fromJSON({ version: 99, gold: 1 })
} catch (err) {
  line('  guardado del futuro: ' + err.name + ': ' + err.message)
}

try {
  Player.fromJSON(null)
} catch (err) {
  line('  guardado roto:      ' + err.name + ': ' + err.message)
}

// ---------------------------------------------------------------- la penalidad

rule('LA PENALIDAD ES UN DATO, NO UN NUMERO MAGICO')
line('  por defecto: ' + JSON.stringify(ECONOMY.death))

const brutal = new Player({
  gold: 200,
  econ: { death: { goldLoss: 0.9, goldFloor: 0, at: 'cementerio' } }
})
line('  hard mode:   ' + JSON.stringify(brutal.morir()))

const broke = new Player({ gold: 12 })
line('  pobre:       ' + JSON.stringify(broke.morir()))

const fast = new Player({ xp: 0, econ: { xpBase: 4, hpPerLevel: 20 } })
fast.ganarXp(100)
line(
  '  otra curva:  xpBase 4 y +20 hp por nivel, 100 xp da nivel ' +
    fast.level +
    ' con ' +
    fast.maxHp +
    ' de vida'
)
line('')
