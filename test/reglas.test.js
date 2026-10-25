const { test } = require('brittle')
const { Runa, COMBAT_KEYS } = require('../lib/game.js')
const { Field } = require('../lib/field.js')
const { BossZone } = require('../lib/boss-zone.js')
const { World } = require('../lib/world.js')
const { WorldBossEvent, FRAME_TICKS, ATTACK_GAP } = require('../lib/world-boss-event.js')
const { WORLD_BOSS } = require('../lib/world-boss.js')
const { Duel, DuelCombat } = require('../lib/duel.js')
const { MAPS } = require('../lib/map.js')
const { normalizeDuelMessage } = require('../lib/net.js')
const { items, foes } = require('../lib/content.js')
const {
  COMBAT_RULES,
  RETREAT,
  playTurn,
  turnLimit,
  guarded,
  gameTicks,
  foeCooldown,
  bossWindup,
  bossGap,
  agreedWindup
} = require('../lib/combat-rules.js')
const estado = require('../scripts/tripo-estado.js')
const combate = require('../scripts/tripo-combate.mjs')

// Las reglas de combate L1 a L7 (docs/combate.md, lib/combat-rules.js).

function press(game, name) {
  return game.onKey({ type: 'key', is: (...keys) => keys.includes(name) })
}

function startGame(game, name = 'Tomas') {
  press(game, 'enter')
  for (const sequence of name) {
    game.onKey({ type: 'key', sequence, ctrl: false, meta: false, is: () => false })
  }
  press(game, 'enter')
}

// Una partida en la pradera pegada a un monstruo del tipo pedido: caminar hacia
// el empieza la pelea de verdad (Field.startFight y syncCombat), con la daga de
// inicio en la mano.
function fightWith(kind) {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 100, height: 30 })
  startGame(game)
  game.field = new Field({ player: game.player, seed: 3 })
  game.seen = new Set()
  const foe = game.field.foes.find((candidate) => !candidate.dead && candidate.x > 4)
  foe.kind = kind
  game.field.player.x = foe.x - 1
  game.field.player.y = foe.y
  game.move(1, 0)
  return { game, world: game.field.combat.world, foe }
}

const fieldOf = (world) => ({ combat: { foe: { id: 1, kind: world.foeDef.id }, world } })

test('las teclas de las acciones son las de la pagina', (t) => {
  t.alike(COMBAT_KEYS, {
    potion: combate.ACTION_KEYS.potion,
    guard: combate.ACTION_KEYS.guard,
    retreat: combate.ACTION_KEYS.retreat
  })
  t.is(combate.ACTION_KEYS.attack, 'f')
})

test('L1: el registro de la pelea trae cada golpe como dato', (t) => {
  const world = new World('skeleton')
  world.held.left = items.dagger
  world.foe.x = 1
  const before = estado.fightOf(fieldOf(world))
  playTurn(world)
  const after = estado.fightOf(fieldOf(world))
  const mine = world.log.find((line) => line.type === 'hit' && line.by === 'hero')
  const theirs = world.log.find((line) => line.type === 'hit' && line.by === 'foe')
  t.alike(
    { amount: mine.amount, weapon: mine.weapon, text: mine.text },
    { amount: 3, weapon: 'dagger', text: 'pegas 3 con daga' },
    'el golpe del heroe: cuanto, con que y el texto de siempre'
  )
  t.is(theirs.amount, foes.skeleton.stats.atk, 'y el del monstruo')
  t.alike(
    world.log.map((line) => line.n),
    world.log.map((_, i) => i + 1),
    'cada linea lleva su numero'
  )
  t.is(after.logged, world.logged, 'la pagina sabe cuantas lineas hay')
  t.alike(
    combate.loggedEvents(before, after).map((event) => [event.who, event.amount]),
    [
      ['hero', 3],
      ['foe', 4]
    ],
    'y lee el turno del registro, en el orden del juego'
  )

  world.hero.hp = 5
  const mark = estado.fightOf(fieldOf(world))
  world.drink()
  const drunk = combate.loggedEvents(mark, estado.fightOf(fieldOf(world)))
  t.alike(drunk, [{ who: 'potion', amount: 8 }], 'la pocion, aunque el tick no avance')

  const plain = new World('skeleton', { ...COMBAT_RULES, logEvents: false })
  plain.foe.x = 1
  const from = estado.fightOf(fieldOf(plain))
  playTurn(plain, undefined, plain.rules)
  t.absent(
    plain.log.some((line) => line.type),
    'apagado (logEvents: false), el registro es solo texto'
  )
  t.is(
    combate.turnEvents(from, estado.fightOf(fieldOf(plain))).find((e) => e.who === 'foe').amount,
    4,
    'y la pagina vuelve a contar por las vidas'
  )
})

test('L3: un turno corre hasta el proximo golpe, con tope', (t) => {
  const { game, world } = fightWith('skeleton')
  let presses = 0
  while (game.field && game.field.combat && presses < 40) {
    const blows = world.blows
    const tick = world.tick
    press(game, 'f')
    presses++
    t.ok(world.blows > blows || world.over, `el turno ${presses} termino en un golpe`)
    t.ok(world.tick - tick <= turnLimit(), 'y nunca paso del tope')
  }
  t.is(world.over, 'ganaste', 'la daga le gana al esqueleto apretando F')
  t.ok(presses <= 12, `${presses} turnos: uno por golpe, no cinco por golpe`)

  const far = new World('golem')
  far.foe.x = 40
  const ticks = playTurn(far)
  t.is(ticks, COMBAT_RULES.turnCap, 'sin nadie al alcance el turno corta en el tope')
  t.is(far.blows, 0)

  const fixed = new World('golem', { ...COMBAT_RULES, turnUntilBlow: false })
  fixed.foe.x = 1
  t.is(playTurn(fixed, undefined, fixed.rules), COMBAT_RULES.turnTicks, 'apagado, seis ticks')
})

test('L2: la pocion a mano usa el turno del heroe', (t) => {
  const { game, world } = fightWith('skeleton')
  world.hero.hp = 10
  const foeHp = world.foe.hp
  press(game, COMBAT_KEYS.potion)
  t.is(world.potions, 1, 'se toma una')
  t.is(world.foe.hp, foeHp, 'y el heroe no pega ese turno')
  const last = world.log[world.log.length - 1]
  t.alike([last.type, last.by], ['hit', 'foe'], 'el turno termina en el golpe del monstruo')
  t.is(world.hero.hp, 10 + COMBAT_RULES.potionHeal - foes.skeleton.stats.atk)
  t.ok(
    world.log.some((line) => line.type === 'potion' && line.amount === 8),
    'la cura queda anotada'
  )

  const tick = world.tick
  world.hero.hp = world.hero.base.hp
  press(game, COMBAT_KEYS.potion)
  t.is(world.tick, tick, 'con la vida llena no pasa el turno')
  t.ok(game.log.includes('ya tenes la vida llena'))
  world.hero.hp = 12
  world.potions = 0
  press(game, COMBAT_KEYS.potion)
  t.is(world.tick, tick, 'sin pociones tampoco')
  t.ok(game.log.includes('no te quedan pociones'))
  t.is(world.stance, 'attack', 'el turno siguiente vuelve a atacar')
})

test('L4: la guardia achica el proximo golpe y no recarga el arma', (t) => {
  const { game, world } = fightWith('barbarian_raider')
  press(game, 'f')
  const loaded = world.hero.cooldownLeft
  t.ok(loaded > 0, 'el primer cruce: los dos pegaron y el arma se recarga')
  const hp = world.hero.hp
  const foeHp = world.foe.hp
  press(game, COMBAT_KEYS.guard)
  const blow = world.log[world.log.length - 1]
  const full = foes.barbarian_raider.stats.atk
  t.is(blow.amount, guarded(full), 'el golpe entra a la mitad, redondeado para arriba')
  t.is(blow.blocked, full - guarded(full), 'y dice cuanto paro')
  t.is(hp - world.hero.hp, guarded(full))
  t.is(world.foe.hp, foeHp, 'cubierto no pega')
  t.is(world.hero.cooldownLeft, loaded, 'ni recarga el arma')
  t.ok(
    world.log.some((line) => line.type === 'guard'),
    'la guardia queda anotada'
  )

  const tick = world.tick
  press(game, 'f')
  t.ok(world.foe.hp < foeHp, 'despues se ataca como siempre')
  t.is(world.tick - tick, loaded, 'cuando termina la recarga que quedo')
  t.is(guarded(1), 1, 'nunca menos de uno')
})

test('L5: la retirada sale limpia si el monstruo no esta por pegar', (t) => {
  const { game, world, foe } = fightWith('skeleton')
  press(game, 'f')
  t.ok(world.foe.cooldownLeft > COMBAT_RULES.retreatSafeTicks, 'el esqueleto acaba de pegar')
  const hp = Math.ceil(world.hero.hp)
  const from = { x: game.field.player.x, y: game.field.player.y }
  press(game, COMBAT_KEYS.retreat)
  t.is(world.over, RETREAT)
  t.absent(game.field.combat, 'la pelea termino')
  t.is(game.field.mode, 'field', 'sigue en la pradera, no en la iglesia')
  t.is(game.player.hp, hp, 'la vida de la pelea se guarda')
  t.is(Math.ceil(world.hero.hp), hp, 'sin golpe de despedida')
  t.absent(foe.dead, 'el monstruo sigue vivo')
  const moved = Math.max(
    Math.abs(game.field.player.x - from.x),
    Math.abs(game.field.player.y - from.y)
  )
  t.is(moved, COMBAT_RULES.retreatStep, 'y el heroe da dos pasos atras')
  t.ok(game.field.graceUntil >= game.field.time + COMBAT_RULES.retreatGrace - 1, 'con respiro')
  t.ok(game.log.includes('te retiras a tiempo'))
  t.absent(game.log.some((line) => String(line).includes('caiste')))
})

test('L5: con el monstruo por pegar, se lleva un golpe al irse', (t) => {
  const { game, world } = fightWith('skeleton')
  t.is(world.foe.cooldownLeft, 0, 'recien empieza: el esqueleto esta listo')
  press(game, COMBAT_KEYS.retreat)
  t.is(world.over, RETREAT, 'sale igual')
  t.is(world.hero.base.hp - world.hero.hp, foes.skeleton.stats.atk, 'con un golpe entero')
  t.ok(
    world.log.some((line) => line.parting),
    'anotado como golpe de despedida'
  )

  const doomed = fightWith('barbarian_raider')
  doomed.world.hero.hp = 3
  press(doomed.game, COMBAT_KEYS.retreat)
  t.is(doomed.world.over, 'moriste', 'si ese golpe lo tumba, cae')
  t.absent(doomed.game.field, 'y despierta en la iglesia')
})

test('las acciones apagadas no hacen nada', (t) => {
  const { game, world } = fightWith('skeleton')
  const saved = { ...COMBAT_RULES }
  try {
    COMBAT_RULES.manualPotion = false
    COMBAT_RULES.guard = false
    COMBAT_RULES.retreat = false
    world.hero.hp = 10
    const tick = world.tick
    for (const key of [COMBAT_KEYS.potion, COMBAT_KEYS.guard, COMBAT_KEYS.retreat]) press(game, key)
    t.is(world.tick, tick, 'ni un tick')
    t.is(world.potions, 2)
    t.ok(game.field.combat, 'y la pelea sigue')
  } finally {
    Object.assign(COMBAT_RULES, saved)
  }
})

test('los monstruos van al reloj de las armas (foePace)', (t) => {
  const world = new World('mosquito')
  t.is(world.foe.base.cooldown, foeCooldown(foes.mosquito.stats.cooldown))
  t.is(world.foe.base.cooldown, foes.mosquito.stats.cooldown * COMBAT_RULES.foePace)
  t.is(foes.mosquito.stats.cooldown, 13, 'content.js no cambia')
  t.is(new World('mosquito', { ...COMBAT_RULES, foePace: 1 }).foe.base.cooldown, 13)
})

test('L6: el golpe al Coloso respeta la recarga del arma', (t) => {
  const game = new Runa({ presence: false })
  startGame(game)
  game.field = new BossZone({ player: game.player })
  const boss = game.field.boss
  game.field.player.y = boss.y
  game.field.player.x = boss.x - 12
  const hp = boss.hp
  press(game, 'f')
  const dagger = items.dagger
  const blow =
    Math.round((1 + dagger.atk) * COMBAT_RULES.bossStrikeScale) - WORLD_BOSS.stats.defense
  t.is(hp - boss.hp, blow, 'la daga pega (1 + 2) por 2, menos la defensa')
  t.alike(
    game.field.strikeCharge(),
    { left: gameTicks(dagger.cooldown), max: gameTicks(dagger.cooldown) },
    'y se recarga en los mismos segundos, en el reloj del juego'
  )
  press(game, 'f')
  t.is(hp - boss.hp, blow, 'apretar mientras recarga no pega')
  game.field.time += gameTicks(dagger.cooldown)
  press(game, 'f')
  t.is(hp - boss.hp, blow * 2, 'recargada, pega otra vez')
  const live = estado.live(game)
  t.alike(live.boss.strike, game.field.strikeCharge(), 'la pagina ve la recarga')
})

test('L6: el Coloso marca cada ataque segun su aviso y mantiene el ritmo', (t) => {
  for (const phase of WORLD_BOSS.phases) {
    for (const attack of phase.attacks) {
      const frames = attack.frames.length * FRAME_TICKS
      const windup = bossWindup(attack, FRAME_TICKS)
      t.is(windup, Math.max(frames, attack.telegraph * COMBAT_RULES.bossTelegraphTicks))
      const gap = bossGap(attack, FRAME_TICKS, ATTACK_GAP)
      t.is(windup + gap, frames + ATTACK_GAP, `${attack.id}: carga ${windup}, el mismo ritmo`)
    }
  }
  const off = { ...COMBAT_RULES, bossTelegraphTicks: 0 }
  const onda = WORLD_BOSS.phases[0].attacks.find((attack) => attack.id === 'onda')
  t.is(bossWindup(onda, FRAME_TICKS, off), onda.frames.length * FRAME_TICKS, 'apagado, sus cuadros')

  // Un Coloso de verdad: del aviso al lanzamiento pasa la carga entera.
  const boss = new WorldBossEvent({ width: 120, height: 36 })
  const player = { x: boss.x - 30, y: boss.y, hp: 999 }
  boss.activate(0)
  boss.nextAttackAt = 0
  let marked = null
  for (let time = 1; time < 400; time++) {
    for (const event of boss.tick(player, time)) {
      if (event.type === 'boss-telegraph') marked = { time, attack: event.attack }
      if (event.type === 'boss-cast' && marked) {
        const attack = boss.windupOf(
          WORLD_BOSS.phases.flatMap((p) => p.attacks).find((a) => a.id === event.attack)
        )
        t.is(time - marked.time, attack, `${event.attack}: suelta a los ${attack} ticks`)
        marked = null
      }
    }
  }
})

test('L7: la carga del golpe del duelo vale solo si los dos la anuncian igual', (t) => {
  t.is(agreedWindup(5, 5), 5)
  t.is(agreedWindup(5, undefined), 0, 'un par viejo no la manda: golpe instantaneo')
  t.is(agreedWindup(undefined, 5), 0)
  t.is(agreedWindup(5, 4), 0, 'distintas: ninguna')
  t.is(agreedWindup(99, 99), 30, 'con tope')

  const raw = {
    type: 'duel',
    kind: 'challenge',
    messageId: 'm1',
    from: 'a',
    to: 'b',
    duelId: 'd',
    stats: { atk: 3, windup: 5 }
  }
  t.is(normalizeDuelMessage(raw).stats.windup, 5, 'la red la deja pasar')
  const old = normalizeDuelMessage({ ...raw, stats: { atk: 3 } })
  t.absent('windup' in old.stats, 'y no la inventa si no vino')

  const game = new Runa({ presence: false })
  startGame(game)
  const stats = game.duelStats()
  t.is(stats.windup, COMBAT_RULES.duelWindup)
  t.is(stats.cooldown, gameTicks(items.dagger.cooldown), 'la daga, en el reloj del juego')
})

function duelFrom(self, rival, { windup = 5, theirs = windup } = {}) {
  const session = new Duel({ arena: MAPS.coliseum, self, rival })
  session.begin({ mapId: 'city', x: 10, y: 10 })
  const stats = { hp: 9, maxHp: 9, atk: 3, reach: 1, cooldown: 10 }
  return new DuelCombat({
    session,
    selfStats: windup === null ? stats : { ...stats, windup },
    rivalStats: theirs === null ? { ...stats } : { ...stats, windup: theirs }
  })
}

test('L7: el golpe del duelo se prepara y cae en el tick ordenado', (t) => {
  const fight = duelFrom('ana', 'beto')
  t.is(fight.windup, 5)
  const beto = fight.fighter('beto')
  fight.place('ana', beto.x - 6, beto.y)
  const start = fight.attack('ana')
  t.alike(start, { type: 'duel-windup', by: 'ana', ticks: 5 }, 'apretar empieza la carga')
  t.is(fight.fighter('beto').hp, 9, 'todavia sin dano')
  t.is(fight.attack('ana').type, 'duel-cooldown', 'y la recarga ya corre')
  let landed = null
  for (let i = 1; i <= 5 && !landed; i++) {
    const snap = fight.tick()
    if (snap.events.length) landed = { tick: i, event: snap.events[0] }
  }
  t.is(landed.tick, 5, 'cae a los cinco ticks')
  t.is(landed.event.type, 'duel-hit')
  t.is(fight.fighter('beto').hp, 6)

  // La distancia se mide al caer: el rival que se aleja durante la carga se salva.
  const dodge = duelFrom('ana', 'beto')
  const rival = dodge.fighter('beto')
  dodge.place('ana', rival.x - 6, rival.y)
  dodge.attack('ana')
  dodge.place('beto', rival.x + 3, rival.y)
  dodge.tick(5)
  t.is(dodge.fighter('beto').hp, 9, 'esquivado')
  t.is(dodge.log[dodge.log.length - 1].type, 'duel-miss')

  const instant = duelFrom('ana', 'beto', { theirs: null })
  t.is(instant.windup, 0, 'el rival no la anuncio')
  const near = instant.fighter('beto')
  instant.place('ana', near.x - 6, near.y)
  t.is(instant.attack('ana').type, 'duel-hit', 'sin carga acordada, al toque')
})

test('L7: los dos lados reproducen los mismos pasos y llegan al mismo duelo', (t) => {
  const host = duelFrom('ana', 'beto')
  const guest = duelFrom('beto', 'ana')
  const steps = [
    ['ana', { dx: 1 }],
    ['beto', { dx: -1 }],
    ['ana', { attack: true }],
    ['beto', { attack: true }]
  ]
  const apply = (fight, [actor, input]) => {
    const f = fight.fighter(actor)
    if (input.dx) fight.place(actor, f.x + input.dx, f.y)
    if (input.attack) fight.attack(actor)
    fight.tick()
  }
  const west = host.fighter('ana')
  host.place('beto', west.x + 6, west.y)
  guest.place('beto', west.x + 6, west.y)
  for (let round = 0; round < 12; round++) {
    for (const step of steps) {
      apply(host, step)
      apply(guest, step)
    }
  }
  t.alike(host.snapshot('ana'), guest.snapshot('ana'), 'el mismo estado visto por los dos')
  t.ok(host.result, 'y el mismo final')
  t.alike(host.result, guest.result)
})

test('la terminal muestra la barra de carga en la pelea y en el duelo', (t) => {
  const { style } = require('bare-tui')
  const { game, world } = fightWith('skeleton')
  let screen = style.stripAnsi(game.view())
  t.ok(screen.includes('vos 20/20 [######] listo'), 'antes del primer golpe, cargada')
  t.ok(screen.includes('p pocion | g guardia | b retirada'), 'y las teclas abajo')
  press(game, 'f')
  screen = style.stripAnsi(game.view())
  t.ok(screen.includes('[......] recarga'), 'recien pego: vacia')
  t.ok(world.hero.cooldownLeft > 0)

  const duel = new Runa({ presence: false })
  duel.update({ type: 'resize', width: 140, height: 30 })
  startGame(duel)
  duel.startDuel({ id: 'rival', name: 'Rival' }, { selfId: 'yo', rivalId: 'rival' })
  t.ok(style.stripAnsi(duel.view()).includes('[######] listo'), 'en el Coliseo tambien')
  const rival = duel.duelCombat.fighter('rival')
  duel.duelCombat.place('yo', rival.x - 6, rival.y)
  press(duel, 'f')
  t.ok(style.stripAnsi(duel.view()).includes('preparando el golpe'), 'L7: se ve la carga')
})
