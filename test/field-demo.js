'use strict'

/**
 * Walks the field end to end under Bare: spawn, approach, fight by script, take
 * the drop, wait for the respawn, then lose a fight on purpose to check the
 * church. Prints what actually happened, nothing is asserted quietly.
 *
 *   bare test/field-demo.js
 */

const { Field } = require('../lib/field.js')
const CONTENT = require('../lib/content.js')

const SCRIPT = [
  '?hp < 8',
  ' use potion',
  ':?foe.dist > 4',
  ' equip crossbow',
  ':',
  ' equip sword',
  'equip boots',
  '> hp @hp@ vs @foe.name@ @foe.hp@ a @foe.dist@'
].join('\n')

function line(title) {
  console.log('\n=== ' + title + ' ' + '='.repeat(Math.max(0, 56 - title.length)))
}

const field = new Field({ seed: 7, script: SCRIPT })

line('campo sembrado con semilla 7')
console.log('tamano', field.width + 'x' + field.height, 'porton en', field.gate.x + ',' + field.gate.y)
console.log('errores de script:', field.scriptErrors.length)
for (let z = 0; z < CONTENT.zones.length; z++) {
  const zone = CONTENT.zones[z]
  const here = field.foes.filter((f) => f.zone === z)
  console.log(
    'zona ' + z + ' ' + zone.name.padEnd(8),
    'hasta ' + String(zone.until).padStart(3),
    'respawn ' + zone.respawn + 't',
    '|',
    here.map((f) => f.kind + '@' + f.x + ',' + f.y).join(' ')
  )
}

line('vista inicial (el jugador es @, el porton <)')
for (const row of field.render(72, 15)) console.log(row)

// Closest mosquito in the near ring: the one a new player would meet first.
let target = null
for (const f of field.foes) {
  if (f.kind !== 'mosquito') continue
  const d = Math.abs(f.x - field.player.x) + Math.abs(f.y - field.player.y)
  if (!target || d < target.d) target = { f, d }
}
console.log('\ncamino hacia el ' + target.f.kind + ' en ' + target.f.x + ',' + target.f.y)

line('caminata')
let steps = 0
let events = []
while (!field.combat && steps < 600) {
  field.walk(Math.sign(target.f.x - field.player.x), Math.sign(target.f.y - field.player.y))
  events = field.tick()
  steps++
  for (const e of events) {
    if (e.type === 'aggro') {
      console.log('paso ' + steps + ': ' + e.kind + ' te vio a ' + e.dist + ' celdas (zona ' + e.zone + ')')
    }
  }
}
console.log('pasos caminados:', steps, '| jugador en', field.player.x + ',' + field.player.y)
console.log('arranca la pelea a', field.combat.world.foe.x, 'de arena (el maximo es 40)')

line('pelea (la maneja el script, no el jugador)')
let fightTicks = 0
let done = null
while (!done && fightTicks < 4000) {
  for (const e of field.tick()) if (e.type === 'win' || e.type === 'death' || e.type === 'flee') done = e
  fightTicks++
}
console.log('ticks de pelea:', fightTicks, '(' + (fightTicks / 30).toFixed(1) + ' segundos de juego)')
console.log('resultado:', JSON.stringify(done))

line('log de combate (lo que hizo el script)')
for (const l of field.lastFight.log) console.log(' t' + String(l.tick).padStart(3) + ' ' + l.text)

line('estado del jugador despues del drop')
console.log(JSON.stringify(field.snapshot().player))
console.log('novedades:', field.news.slice(-3).map((n) => n.text).join(' / '))

line('respawn del monstruo')
const dead = field.foes.find((f) => f.dead)
console.log('cadaver id', dead.id, 'vuelve en', dead.respawnAt - field.time, 'ticks')
let back = null
for (let i = 0; i < 1000 && !back; i++) {
  for (const e of field.tick()) if (e.type === 'respawn') back = e
}
console.log('reaparecio:', JSON.stringify(back), 'en tick', field.time)

line('farmeo: cinco peleas seguidas con el mismo script')
const before = { gold: field.player.gold, xp: field.player.xp, kills: field.player.kills }
for (let i = 0; i < 20000 && field.player.kills < before.kills + 5; i++) {
  const t = field.foes.find((f) => !f.dead && f.kind === 'mosquito')
  if (t && !field.combat) {
    field.walk(Math.sign(t.x - field.player.x), Math.sign(t.y - field.player.y))
  }
  field.tick()
}
console.log(
  'kills',
  before.kills + ' -> ' + field.player.kills,
  '| oro',
  before.gold + ' -> ' + field.player.gold,
  '| exp',
  before.xp + ' -> ' + field.player.xp,
  '| hp',
  field.player.hp + '/' + field.player.maxhp
)

line('muerte: mismo campo, script vacio (peleas a manos limpias)')
const naked = new Field({ seed: 7, script: '' })
let target2 = null
for (const f of naked.foes) {
  if (f.kind !== 'mosquito') continue
  const d = Math.abs(f.x - naked.player.x) + Math.abs(f.y - naked.player.y)
  if (!target2 || d < target2.d) target2 = { f, d }
}
let end = null
for (let i = 0; i < 20000 && !end; i++) {
  if (!naked.combat) naked.walk(Math.sign(target2.f.x - naked.player.x), Math.sign(target2.f.y - naked.player.y))
  for (const e of naked.tick()) if (e.type === 'win' || e.type === 'death') end = e
}
console.log('resultado:', JSON.stringify(end))
console.log('jugador:', JSON.stringify(naked.snapshot().player))
console.log('revive en el porton:', naked.player.x === naked.gate.x + 1 && naked.player.y === naked.gate.y)
console.log('novedad:', naked.news[naked.news.length - 1].text)

line('mismo seed, mismo campo')
const a = new Field({ seed: 7 })
const b = new Field({ seed: 7 })
const c = new Field({ seed: 8 })
const fp = (f) => f.foes.map((x) => x.kind + x.x + ',' + x.y).join(' ')
console.log('seed 7 == seed 7 :', fp(a) === fp(b))
console.log('seed 7 == seed 8 :', fp(a) === fp(c))

line('zona lejana: el yermo pega distinto')
const far = new Field({ seed: 7, script: SCRIPT })
const golem = far.foes.find((f) => f.kind === 'golem')
let end3 = null
for (let i = 0; i < 40000 && !end3; i++) {
  if (!far.combat) far.walk(Math.sign(golem.x - far.player.x), Math.sign(golem.y - far.player.y))
  for (const e of far.tick()) if (e.type === 'win' || e.type === 'death' || e.type === 'flee') end3 = e
}
console.log('contra el golem:', JSON.stringify(end3))
console.log('jugador:', JSON.stringify(far.snapshot().player))
