const { test } = require('brittle')
const combate = require('../scripts/tripo-combate.mjs')
const estado = require('../scripts/tripo-estado.js')
const { World } = require('../lib/world.js')
const { items } = require('../lib/content.js')
const { COMBAT_TURN_TICKS } = require('../lib/game.js')
const { playTurn, turnLimit } = require('../lib/combat-rules.js')

// Una pelea de lib/world.js como la ve la pagina: un campo con su combate.
function fieldWith(world) {
  return { combat: { foe: { id: 7, kind: world.foeDef.id }, world } }
}

// Un turno de la pagina (lib/game.js advanceCombat): hasta el proximo golpe (L3).
function turnOf(world) {
  playTurn(world)
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
    // Al terminar la pagina ya no tiene la pelea: arma la ultima lectura con
    // las vidas y el registro que dejo el campo (field.lastFight).
    const after = world.over
      ? {
          ...before,
          tick: world.tick,
          foeHp: Math.max(0, Math.ceil(world.foe.hp)),
          hp: Math.ceil(world.hero.hp),
          log: world.log.slice(-8),
          logged: world.logged
        }
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
  const potion = combate.turnEvents({ ...base, hp: 10 }, { ...base, potions: 1, hp: 18 })
  t.alike(potion, [{ who: 'potion', amount: 8 }])
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

test('soltar una fuente de ataque no corta las otras', (t) => {
  const pace = new combate.CombatPace()
  pace.hold(true, 'key: ')
  pace.hold(true, 'stick')
  pace.hold(false, 'stick')
  t.ok(pace.held, 'soltar el stick deja la barra espaciadora')
  t.ok(pace.ready(1), 'y sigue pidiendo turnos')
  t.ok(pace.ready(2))
  pace.hold(true, 'button')
  pace.hold(false, 'key: ')
  t.ok(pace.ready(3), 'soltar la tecla deja el boton')
  pace.hold(false, 'button')
  t.absent(pace.held)
  t.absent(pace.ready(4), 'sin nada apretado, nada')
})

test('la pausa suelta todo y olvida el turno guardado', (t) => {
  const pace = new combate.CombatPace()
  pace.hold(true, 'stick')
  pace.press()
  pace.release()
  t.absent(pace.held)
  t.absent(pace.buffered)
  t.absent(pace.ready(9, 0), 'detras del menu no sale ningun turno')
})

test('una pocion en el turno del golpe no tapa el golpe', (t) => {
  let potionTurns = 0
  let hidden = 0
  let both = 0
  for (const foe of ['golem', 'barbarian_raider', 'mosquito', 'skeleton_archer']) {
    const world = new World(foe)
    world.hero.base.hp = 60
    world.hero.hp = 30
    world.potions = 30
    world.foe.base.hp = 999
    world.foe.hp = 999
    world.foe.x = 3
    for (let turn = 0; turn < 60 && !world.over; turn++) {
      const before = estado.fightOf(fieldWith(world))
      // El guion toma una pocion en un tick del medio del turno, como el
      // registro de la prueba (golem te pega, tomas una pocion, pegas).
      for (let i = 0; i < COMBAT_TURN_TICKS && !world.over; i++) {
        world.wanted.use = i === 2 ? 'potion' : null
        world.applyIntent()
        world.step()
      }
      if (world.over) break
      const after = estado.fightOf(fieldWith(world))
      if (after.potions === before.potions) continue
      potionTurns++
      const events = combate.turnEvents(before, after)
      const theirs = events.filter((e) => e.who === 'foe').reduce((n, e) => n + e.amount, 0)
      const log = said(world, before.tick)
      if (log.theirs > 0) both++
      if (log.theirs > 0 && theirs === 0) hidden++
      if (theirs !== log.theirs) t.fail(`${foe}: ${theirs} contra ${log.theirs}`)
      const heal = events.find((e) => e.who === 'potion').amount
      if (heal !== after.hp - before.hp + theirs) t.fail(`${foe}: la cura ${heal} no cierra`)
      world.hero.hp = Math.min(world.hero.hp, 30)
    }
  }
  t.ok(potionTurns > 20, `${potionTurns} turnos con pocion`)
  t.ok(both > 10, `${both} con golpe y pocion en el mismo turno`)
  t.is(hidden, 0, 'ningun golpe tapado por la pocion')
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
  t.is(fight.turn, turnLimit(), 'L3: el tope del turno hasta el golpe')
  t.ok(fight.untilBlow)
  t.is(fight.tps, 30, 'los ticks por segundo de lib/world.js')
  t.alike(fight.actions, { potion: true, guard: true, retreat: true })
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

test('combate: the duel reach box covers reach plus the bodies', (t) => {
  const arena = { distance: 2, gap: 5, self: { reach: 1 } }
  const box = combate.reachBox(arena, 0.5, 1)
  t.is(box.hx, 3.25, 'half width in meters: (1 + 5 + 0.5) cells of 0.5')
  t.is(box.hz, 6.5, 'half depth: cells of 1')
  t.absent(box.inside, 'two cells away with reach 1: out')
  t.ok(combate.reachBox({ ...arena, distance: 1 }, 0.5, 1).inside, 'at reach: in')
  t.is(combate.reachBox(null, 0.5, 1), null, 'no duel, no box')
})

test('combate: las acciones van en el proximo turno, antes que el ataque', (t) => {
  const pace = new combate.CombatPace()
  pace.hold(true, 'key')
  pace.order('guard')
  t.is(pace.ready(1), 'guard', 'la guardia pedida sale primero')
  t.is(pace.ready(2), 'attack', 'y despues sigue el ataque apretado')
  pace.order('potion')
  pace.order('retreat')
  t.is(pace.ready(3), 'retreat', 'la ultima pedida gana')
  pace.order('volar')
  pace.hold(false, 'key')
  t.absent(pace.ready(4), 'una accion que no existe no se guarda')
  pace.order('potion')
  pace.release()
  t.absent(pace.ready(5), 'la pausa la olvida')
  t.alike(combate.ACTION_KEYS, { attack: 'f', potion: 'p', guard: 'g', retreat: 'b' })
})

test('combate: el turno dura en la pagina lo que duro en el juego', (t) => {
  const before = { tick: 10, untilBlow: true, tps: 30 }
  t.is(combate.turnLead(before, { tick: 34 }), 0.8, '24 ticks a 30 por segundo')
  t.is(combate.turnLead(before, { tick: 400 }), 3, 'con tope')
  t.is(combate.turnLead({ ...before, untilBlow: false }, { tick: 34 }), 0, 'turno fijo: sin espera')
  t.is(combate.turnLead(before, { tick: 10 }), 0)
})

test('combate: las barras se llenan durante el turno y caen con el golpe', (t) => {
  const before = { heroCd: 24, heroCdMax: 24, foeCd: 20, foeCdMax: 39 }
  const after = { heroCd: 24, heroCdMax: 24, foeCd: 0, foeCdMax: 39 }
  const lines = combate.turnCharges(before, after, [{ who: 'hero' }], 5, 5.8)
  t.is(combate.chargeAt(lines.hero, 5), 0, 'al empezar, vacia')
  t.ok(Math.abs(combate.chargeAt(lines.hero, 5.4) - 0.5) < 1e-9, 'a la mitad del turno, a la mitad')
  t.is(combate.chargeAt(lines.hero, 5.8), 0, 'pego: llega llena y cae a lo que quedo')
  t.ok(combate.chargeAt(lines.hero, 5.79) > 0.95)
  const foe = combate.chargeAt(lines.foe, 5.8)
  t.is(foe, 1, 'el monstruo no pego: queda donde termino')
  t.is(combate.chargeAt(null, 1), 1)

  const bar = combate.barLayout(0.25, { width: 1, height: 0.1, pad: 0.02, drop: 1.5 })
  t.is(bar.frame.w, 1.04)
  t.is(bar.fill.w, 0.25)
  t.is(bar.fill.cx * bar.fill.w, 0.5, 'el relleno arranca en el borde izquierdo del marco')
  const middle = (0.5 - bar.frame.cy) * bar.frame.h
  t.ok(Math.abs((0.5 - bar.fill.cy) * bar.fill.h - middle) < 1e-9, 'y a la misma altura')
})

test('combate: la guardia, la pocion y la retirada se leen del registro', (t) => {
  const before = { logged: 4, hp: 20, maxhp: 20, foeHp: 9, foeMaxhp: 9, dist: 1, reach: 1 }
  const after = {
    logged: 7,
    log: [
      { n: 5, type: 'guard', by: 'hero', text: 'te cubris' },
      { n: 6, type: 'hit', by: 'foe', amount: 2, blocked: 2, text: 'x' },
      { n: 7, type: 'retreat', by: 'hero', clean: false, text: 'y' }
    ]
  }
  t.alike(combate.loggedEvents(before, after), [
    { who: 'guard' },
    { who: 'foe', amount: 2, share: 0.1, blocked: 2 },
    { who: 'retreat', clean: false }
  ])
  const cut = { ...after, logged: 20 }
  t.is(combate.loggedEvents(before, cut), null, 'si faltan lineas no adivina')
})
