const { test } = require('brittle')
const combate = require('../scripts/tripo-combate.mjs')
const estado = require('../scripts/tripo-estado.js')
const { World } = require('../lib/world.js')
const { items } = require('../lib/content.js')
const { COMBAT_TURN_TICKS } = require('../lib/game.js')

// Una pelea de lib/world.js como la ve la pagina: un campo con su combate.
function fieldWith(world) {
  return { combat: { foe: { id: 7, kind: world.foeDef.id }, world } }
}

// Un turno de la pagina (lib/game.js advanceCombat): varios ticks seguidos.
function turnOf(world) {
  for (let i = 0; i < COMBAT_TURN_TICKS && !world.over; i++) world.step()
}

// Lo que dicen las lineas nuevas del registro: lo que la pagina leia antes con
// expresiones en castellano. Ahora solo lo usa esta prueba, para comparar.
function said(world, fromTick) {
  let mine = 0
  let theirs = 0
  for (const { tick, text } of world.log) {
    if (tick <= fromTick) continue
    const a = /^pegas (\d+)/.exec(text)
    const b = / te pega (\d+)/.exec(text)
    if (a) mine += Number(a[1])
    if (b) theirs += Number(b[1])
  }
  return { mine, theirs }
}

const FIGHTS = []
for (const foe of ['mosquito', 'golem', 'barbarian_raider', 'skeleton_archer', 'slime']) {
  for (const weapon of [null, 'dagger', 'sword', 'spear', 'warhammer', 'longbow']) {
    FIGHTS.push({ foe, weapon })
  }
}

function fight({ foe, weapon }, each) {
  const world = new World(foe)
  world.hero.base.hp = 400
  world.hero.hp = 400
  if (weapon) world.held.left = items[weapon]
  world.foe.x = 6
  for (let turn = 0; turn < 80 && !world.over; turn++) {
    const before = estado.fightOf(fieldWith(world))
    turnOf(world)
    const after = world.over
      ? { ...before, foeHp: Math.max(0, Math.ceil(world.foe.hp)), hp: Math.ceil(world.hero.hp) }
      : estado.fightOf(fieldWith(world))
    each(before, after, world)
  }
  return world
}

test('el turno contado por las vidas da los mismos golpes que el registro', (t) => {
  let turns = 0
  let blows = 0
  for (const setup of FIGHTS) {
    fight(setup, (before, after, world) => {
      const events = combate.turnEvents(before, after)
      const mine = events.filter((e) => e.who === 'hero').reduce((n, e) => n + e.amount, 0)
      const theirs = events.filter((e) => e.who === 'foe').reduce((n, e) => n + e.amount, 0)
      const log = said(world, before.tick)
      // El golpe que mata se cuenta hasta la vida que le quedaba: el numero
      // muestra lo que perdio el monstruo, no lo que pegaba el arma.
      log.mine = Math.min(log.mine, before.foeHp)
      log.theirs = Math.min(log.theirs, before.hp)
      turns++
      blows += log.mine ? 1 : 0
      if (mine !== log.mine || theirs !== log.theirs) {
        t.fail(`${setup.foe} ${setup.weapon}: ${mine}/${theirs} contra ${log.mine}/${log.theirs}`)
      }
      if (!events.length) t.fail('un turno sin nada que mostrar')
    })
  }
  t.ok(turns > 100, `${turns} turnos revisados`)
  t.ok(blows > 30, `${blows} turnos con golpe del heroe`)
})

test('la lectura del boton anticipa el golpe del proximo turno', (t) => {
  let checked = 0
  let wrong = 0
  for (const setup of FIGHTS) {
    fight(setup, (before, after) => {
      const next = combate.readout(before)
      const hit = after.foeHp < before.foeHp
      checked++
      if ((next.state === 'attack') !== hit) wrong++
    })
  }
  // La distancia se estima con las velocidades: se admite un error chico.
  t.ok(checked > 100, `${checked} turnos`)
  t.ok(wrong / checked < 0.05, `${wrong} de ${checked} lecturas fallan`)
})

test('la recarga sin golpe se ve como recarga, lejos como espera', (t) => {
  const base = { hp: 20, maxhp: 20, foeHp: 9, foeMaxhp: 9, potions: 2, reach: 2 }
  t.alike(combate.turnEvents({ ...base, dist: 1 }, { ...base, dist: 1 }), [{ who: 'recharge' }])
  t.alike(combate.turnEvents({ ...base, dist: 5 }, { ...base, dist: 4 }), [{ who: 'advance' }])
  const hit = combate.turnEvents(base, { ...base, foeHp: 6, hp: 18 })
  t.alike(
    hit.map((e) => [e.who, e.amount]),
    [
      ['hero', 3],
      ['foe', 2]
    ],
    'el heroe pega primero'
  )
  t.is(hit[0].share, 3 / 9)
  const potion = combate.turnEvents(base, { ...base, potions: 1, hp: 26 })
  t.is(potion[0].who, 'potion')
  t.is(potion.length, 1)
  t.alike(combate.readout(null), null)
  t.alike(combate.readout({ ...base, dist: 1, heroCd: 13, turn: 6 }), { state: 'recharge', n: 3 })
  t.alike(combate.readout({ ...base, dist: 1, heroCd: 6, turn: 6 }), { state: 'attack', n: 1 })
  t.is(combate.readout({ ...base, dist: 9, heroCd: 0, speed: 0.25, turn: 6 }).state, 'wait')
})

test('mantener el ataque da a lo sumo unos tres turnos por segundo, sin pisarse', (t) => {
  const pace = new combate.CombatPace()
  pace.hold(true)
  let busyUntil = -1
  const fired = []
  // Dos segundos a 60 cuadros con animaciones de 0,2 a 0,6 s.
  for (let frame = 0; frame <= 120; frame++) {
    const now = frame / 60
    if (pace.ready(now, busyUntil)) {
      t.ok(now >= busyUntil, 'nunca antes de que termine la animacion')
      fired.push(now)
      busyUntil = now + [0.2, 0.6, 0.28][fired.length % 3]
    }
  }
  t.ok(fired.length >= 4 && fired.length <= 7, `${fired.length} turnos en 2 s`)
  for (let i = 1; i < fired.length; i++) {
    t.ok(fired[i] - fired[i - 1] >= combate.MIN_TURN - 1e-9, 'separados por el turno minimo')
  }
  pace.hold(false)
  t.absent(pace.ready(5, -1), 'soltar corta los turnos')
})

test('los toques se guardan de a uno y el contacto espera un momento', (t) => {
  const pace = new combate.CombatPace()
  pace.contact(0)
  pace.press()
  t.absent(pace.ready(0.1), 'el primer turno espera la pausa del contacto')
  t.ok(pace.ready(combate.CONTACT_PAUSE))
  for (let i = 0; i < 5; i++) pace.press()
  t.absent(pace.ready(1, 1.5), 'espera la animacion')
  t.ok(pace.ready(1.6, 1.5), 'cinco toques durante la animacion son un turno')
  t.absent(pace.ready(3, 0), 'y nada mas')
  pace.press()
  pace.clear()
  t.absent(pace.ready(9, 0), 'al terminar la pelea se olvida el pedido')
})

test('el stick hacia otro lado no ataca', (t) => {
  const hero = { x: 10, y: 10 }
  const east = { x: 11, y: 10 }
  t.ok(combate.towardFoe(1, 0, hero, east))
  t.ok(combate.towardFoe(1, -1, hero, east), 'la diagonal hacia el vale')
  t.absent(combate.towardFoe(-1, 0, hero, east), 'para atras no')
  t.absent(combate.towardFoe(0, 1, hero, east), 'de costado no')
  t.absent(combate.towardFoe(0, 0, hero, east))
  t.ok(combate.towardFoe(0, 1, hero, null), 'sin posicion, como el juego')
})

test('la pausa, el temblor y el numero crecen con el golpe', (t) => {
  t.is(combate.hitStopMs(0.05), 60)
  t.is(combate.hitStopMs(0.15), 90)
  t.is(combate.hitStopMs(0.5), 140)
  t.ok(combate.shakeOf(0.5) > combate.shakeOf(0.05))
  t.ok(combate.numberScale(0.5) > combate.numberScale(0.05))
  t.ok(combate.numberScale(5) <= 1.8)
  const stop = new combate.HitStop()
  stop.kick(90, 10)
  t.ok(stop.scale(10.05) < 0.1)
  t.is(stop.scale(10.1), 1)
  t.is(combate.charge(0, 20), 1)
  t.is(combate.charge(20, 20), 0)
  t.alike(
    combate.nearFoes(
      [
        { id: 1, x: 14, y: 10 },
        { id: 2, x: 11, y: 11 },
        { id: 3, x: 30, y: 10 }
      ],
      { x: 10, y: 10 }
    ),
    [
      { id: 2, d: 1 },
      { id: 1, d: 4 }
    ].filter((f) => f.d <= 3)
  )
})

test('fightOf manda el turno del juego y la recarga de los dos', (t) => {
  t.is(estado.COMBAT_TURN, COMBAT_TURN_TICKS, 'el mismo turno que lib/game.js')
  const world = new World('golem')
  world.held.left = items.sword
  const fight = estado.fightOf(fieldWith(world))
  t.is(fight.turn, COMBAT_TURN_TICKS)
  t.is(fight.heroCdMax, items.sword.cooldown)
  t.is(fight.reach, items.sword.reach)
  t.is(fight.heroCd, 0)
  t.is(fight.potions, world.potions)
  world.foe.x = 1
  world.step()
  const after = estado.fightOf(fieldWith(world))
  t.is(after.heroCd, items.sword.cooldown, 'recien pego')
  t.ok(after.swinging > 0)
})
