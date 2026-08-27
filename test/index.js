const { test } = require('brittle')
const { style } = require('bare-tui')
const fs = require('bare-fs')
const os = require('bare-os')
const path = require('bare-path')
const {
  Runa,
  COMBAT_TURN_TICKS,
  QUESTS,
  REALMS,
  normalizeRealm,
  DEFAULT_SCRIPT,
  LEGACY_DEFAULT_SCRIPT,
  isLegacyDefaultScript
} = require('../lib/game.js')
const { MAPS, TILES, NPC_MASTER_SPRITES, NPC_SPRITES, tileAt } = require('../lib/map.js')
const {
  Field,
  RUNA_GATE_ART,
  NOX_GATE_ART,
  KINGDOM_GATE_CLEARANCE,
  DUNGEON_ENTRANCE_ART,
  DUNGEON_CLEARANCE,
  WORLD_BOSS_PORTAL_ART,
  WORLD_BOSS_PORTAL_CLEARANCE,
  WORLD_BOSS_PORTAL_CADENCE
} = require('../lib/field.js')
const { Dungeon, DUNGEON, FLOOR_ROSTERS, floorRows } = require('../lib/dungeon.js')
const { BossZone, BOSS_ZONE } = require('../lib/boss-zone.js')
const CONTENT = require('../lib/content.js')
const { Player, reward, xpToLeave, SAVE_VERSION, EQUIPMENT_SLOTS } = require('../lib/shop.js')
const { SaveStore } = require('../lib/saves.js')
const { World } = require('../lib/world.js')
const { WORLD_BOSS } = require('../lib/world-boss.js')
const { WorldBossEvent } = require('../lib/world-boss-event.js')
const {
  BEGIN_SYNCHRONIZED_UPDATE,
  END_SYNCHRONIZED_UPDATE,
  synchronizeRenderer
} = require('../lib/synchronized-renderer.js')
const render = require('../lib/render.js')

require('./sage.test.js')
require('./stellar.test.js')
require('./wallet.test.js')
require('./duel-chain.test.js')
require('./duel.test.js')
require('./net.test.js')

function press(game, name) {
  return game.onKey({ type: 'key', is: (...keys) => keys.includes(name) })
}

function typeText(game, value) {
  for (const sequence of String(value)) {
    game.onKey({ type: 'key', sequence, ctrl: false, meta: false, is: () => false })
  }
}

function startGame(game, name = 'Tomas') {
  press(game, 'enter')
  typeText(game, name)
  press(game, 'enter')
}

function locateGlyph(map, glyph) {
  for (let y = 0; y < map.height; y++) {
    const x = map.rows[y].indexOf(glyph)
    if (x !== -1) return { x, y }
  }
  return null
}

function keyMessage(name) {
  return { type: 'key', is: (...keys) => keys.includes(name) }
}

function removeSaveFixture(dir) {
  for (let slot = 1; slot <= 3; slot++) {
    for (const suffix of ['', '.tmp']) {
      try {
        fs.unlinkSync(path.join(dir, `slot-${slot}.json${suffix}`))
      } catch {}
    }
  }
  try {
    fs.rmdirSync(dir)
  } catch {}
}

test('REMOVE ME', (t) => {
  t.pass()
})

test('terminal frames are published as one synchronized update', (t) => {
  const writes = []
  const output = { write: (chunk) => writes.push(String(chunk)) }
  const inner = {
    out: output,
    start() {},
    clear() {},
    stop() {},
    render(view) {
      this.out.write('row 1: ' + view)
      this.out.write('row 2: done')
    }
  }
  const renderer = synchronizeRenderer(inner)

  renderer.render('walking')

  t.is(writes.length, 1, 'the real terminal receives one write per frame')
  t.is(
    writes[0],
    BEGIN_SYNCHRONIZED_UPDATE + 'row 1: walkingrow 2: done' + END_SYNCHRONIZED_UPDATE,
    'the complete frame stays between BSU and ESU'
  )
  t.is(inner.out, output, 'the real output stream is restored after rendering')
})

test('terrain colour is encoded once per run instead of once per cell', (t) => {
  const plain = '.'.repeat(120)
  const painted = render.paintRuns(plain, Array(120).fill('green'))

  t.is(style.stripAnsi(painted), plain, 'colour compaction preserves every visible cell')
  t.ok(painted.length < 150, 'one terrain row stays close to its visible byte length')
})

test('title screen renders the Runa logo and start prompt', (t) => {
  const screen = style.stripAnsi(render.titleScreen(80, 30))
  t.ok(screen.includes('RUNA'))
  t.ok(screen.includes('UN RPG HECHO EN BARE'))
  t.ok(screen.includes('ENTER / ESPACIO  nueva partida'))
  t.ok(screen.includes('Q  salir'))
  const lines = screen.split('\n')
  t.is(lines.length, 30)
  t.ok(lines.every((line) => line.length === 80))
})

test('title screen falls back cleanly in a small terminal', (t) => {
  const screen = style.stripAnsi(render.titleScreen(40, 10))
  const lines = screen.split('\n')
  t.ok(screen.includes('RUNA'))
  t.is(lines.length, 10)
  t.ok(lines.every((line) => line.length === 40))
})

test('the controls button opens a complete overlay and returns to the previous state', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 80, height: 24 })

  const menu = style.stripAnsi(game.view())
  t.ok(menu.includes('CONTROLES'), 'the main menu exposes a controls button')
  game.menuCursor = 3
  press(game, 'enter')
  t.is(game.controlsOpen, true, 'the selected button opens the overlay')

  let screen = style.stripAnsi(game.view())
  t.ok(screen.includes('lista de controles'))
  t.ok(screen.includes('EXPLORACION'))
  t.ok(screen.includes('COMBATE'))
  t.ok(screen.includes('WASD / flechas  mover'))
  t.ok(screen.includes('ESC  cerrar / volver'))
  t.ok(screen.split('\n').every((line) => line.length === 80))

  press(game, 'escape')
  t.is(game.controlsOpen, false)
  t.is(game.title, true, 'closing controls returns to the title menu')

  game.menuCursor = 1
  startGame(game, 'Ayla')
  const position = { mapId: game.walker.mapId, x: game.walker.x, y: game.walker.y }
  screen = style.stripAnsi(game.view())
  t.ok(screen.includes('[? CONTROLES]'), 'gameplay keeps a visible controls button')
  t.ok(screen.includes('[I INVENTARIO]'), 'gameplay keeps a visible inventory button')

  press(game, '?')
  t.is(game.controlsOpen, true, 'question mark opens controls from gameplay')
  press(game, 'down')
  t.is(game.controlsOpen, true, 'movement input cannot leak through the overlay')
  press(game, 'enter')
  t.is(game.controlsOpen, false)
  t.alike(
    { mapId: game.walker.mapId, x: game.walker.x, y: game.walker.y },
    position,
    'closing the list restores gameplay without moving the hero'
  )

  game.update({ type: 'resize', width: 64, height: 16 })
  press(game, '?')
  screen = style.stripAnsi(game.view())
  t.is(screen.split('\n').length, 16)
  t.ok(screen.split('\n').every((line) => line.length === 64))
  t.ok(screen.includes('CTRL+C'), 'the full list survives at the minimum supported size')
})

test('the HUD coordinates follow the hero across city and field movement', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 100, height: 30 })
  startGame(game, 'Cartografa')
  game.walker.placeAt('city', 160, 130)

  let screen = style.stripAnsi(game.view())
  t.ok(screen.includes('X:160 Y:130'), 'the city position is visible in the HUD')
  t.ok(game.sheet().coordinates.area === 'RUNA', 'the coordinates name their map')

  const directions = [
    { key: 'right', dx: 1, dy: 0 },
    { key: 'left', dx: -1, dy: 0 },
    { key: 'down', dx: 0, dy: 1 },
    { key: 'up', dx: 0, dy: -1 }
  ]
  const step = directions.find(({ dx, dy }) => {
    const x = game.walker.x + dx
    const y = game.walker.y + dy
    return !tileAt(MAPS.city, x, y).solid && !game.npcAt(x, y)
  })
  t.ok(step, 'the fixture has a free neighbouring tile')
  press(game, step.key)
  screen = style.stripAnsi(game.view())
  t.ok(
    screen.includes(`X:${game.walker.x} Y:${game.walker.y}`),
    'the displayed city coordinates change with movement'
  )

  game.field = new Field({ player: game.player, seed: 27 })
  let coords = game.sheet().coordinates
  t.alike(coords, { x: game.field.player.x, y: game.field.player.y, area: 'pradera' })
  press(game, 'right')
  coords = game.sheet().coordinates
  t.alike(
    coords,
    { x: game.field.player.x, y: game.field.player.y, area: 'pradera' },
    'field coordinates update and preserve the broad zone name'
  )
  t.ok(
    style.stripAnsi(game.view()).includes(`X:${coords.x} Y:${coords.y}`),
    'field coordinates remain visible in the rendered HUD'
  )
})

test('new game asks for a name and puts its initial on the hero', (t) => {
  const game = new Runa({ presence: false })
  game.onKey({ type: 'key', is: (...keys) => keys.includes('x') })
  t.is(game.title, true, 'an unrelated or residual key leaves the menu visible')
  t.ok(style.stripAnsi(game.view()).toLowerCase().includes('nueva partida'))

  game.onKey({ type: 'key', is: (...keys) => keys.includes('enter') })
  t.is(game.naming, true, 'the menu opens name entry before the city')
  t.ok(style.stripAnsi(game.view()).includes('NOMBRE'))
  game.onKey({ type: 'key', is: (...keys) => keys.includes('enter') })
  t.ok(style.stripAnsi(game.view()).includes('escribi un nombre'))
  typeText(game, 'Quinn')
  game.onKey({ type: 'key', is: (...keys) => keys.includes('enter') })

  const screen = style.stripAnsi(game.view())
  t.is(game.title, false)
  t.is(game.name, 'Quinn', 'q is accepted as part of a name instead of quitting')
  t.ok(screen.includes('la ciudad'))
  t.ok(screen.includes('wasd o flechas'))
  t.ok(screen.includes('/Q\\'), 'the first letter of the name is painted on the chest')
})

test('character creation chooses, saves and restores the birth realm', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 88, height: 30 })
  press(game, 'enter')
  typeText(game, 'Nyra')

  const creation = style.stripAnsi(game.view())
  t.ok(creation.includes('REINO DE ORIGEN'))
  t.ok(creation.includes('RUNA - reino del alba'))
  t.ok(creation.includes('NOX - reino enemigo'))
  t.is(game.realmCursor, 0, 'RUNA remains the compatible default')

  press(game, 'right')
  t.is(game.realmCursor, 1, 'the realm selector moves independently from name typing')
  press(game, 'enter')

  t.is(game.realm, 'nox')
  t.is(game.walker.mapId, 'nox', 'a NOX character is born in NOX')
  t.is(game.walker.x, MAPS.nox.spawn.x)
  t.is(game.walker.y, MAPS.nox.spawn.y)
  t.ok(game.log.some((line) => line.includes('frontera hacia RUNA queda al oeste')))

  const saved = game.saveState()
  t.is(saved.realm, 'nox')
  t.is(saved.summary.realm, 'nox')
  const loaded = new Runa({
    presence: false,
    saves: {
      list: () => [],
      load: () => JSON.parse(JSON.stringify(saved))
    }
  })
  t.ok(loaded.loadSlot(1))
  t.is(loaded.realm, 'nox')
  t.is(loaded.walker.mapId, 'nox')

  loaded.wakeInChurch()
  t.is(loaded.walker.mapId, 'nox', 'death returns a NOX hero to their own temple')
  t.is(loaded.walker.here().enter.kind, 'church')
  t.is(normalizeRealm(undefined), 'runa', 'older saves without a realm still load as RUNA')
  t.is(REALMS.length, 2)
})

test('the two enemy kingdoms are joined by visible two-way frontier gates', (t) => {
  const runaGate = locateGlyph(MAPS.city, 'N')
  const noxGate = locateGlyph(MAPS.nox, 'R')
  t.ok(runaGate, 'RUNA has a physical eastern gate to NOX')
  t.ok(noxGate, 'NOX has a physical western gate back to RUNA')
  t.ok(MAPS.city.rows.some((row) => row.includes('[frontera nox]')))
  t.ok(MAPS.nox.rows.some((row) => row.includes('[frontera runa]')))

  const game = new Runa({ presence: false })
  startGame(game, 'Aster')
  game.walker.placeAt('city', runaGate.x, runaGate.y)
  press(game, 'e')
  t.is(game.walker.mapId, 'nox')
  t.is(game.walker.x, MAPS.nox.arrive.x)
  t.is(game.walker.y, MAPS.nox.arrive.y)

  game.walker.placeAt('nox', noxGate.x, noxGate.y)
  press(game, 'e')
  t.is(game.walker.mapId, 'city')
  t.alike(
    { x: game.walker.x, y: game.walker.y },
    MAPS.city.arrivals.noxBorder,
    'returning lands beside the eastern frontier instead of the southern meadow gate'
  )
})

test('NOX is a connected dark-elf capital with distinct living districts', (t) => {
  const nox = MAPS.nox
  const art = nox.rows.join('\n')
  for (const label of [
    'palacio del eclipse',
    'corte de sombras',
    'jardin luminiscente',
    'mercado velado',
    'santuario lunar',
    'casa del linaje'
  ]) {
    t.ok(art.includes(label), `${label} gives NOX a readable district`)
  }
  t.ok((art.match(/\^/g) || []).length >= 20, 'pointed spires establish a vertical skyline')
  t.ok((art.match(/~/g) || []).length >= 20, 'luminous pools break up the volcanic stone')
  t.ok(nox.npcs.length >= 6, 'the kingdom is inhabited instead of being an empty service map')
  t.ok(
    nox.npcs.some((npc) => npc.role.includes('micologo')),
    'a fungal gardener explains the luminous ecosystem'
  )
  t.ok(
    nox.npcs.some((npc) => npc.role.includes('eclipse')),
    'the palace has its own dark-elf sentinel'
  )
  t.is(nox.animations.length, 1, 'the garden publishes a dedicated glow animation')
  t.is(nox.animations[0].frames.length, 3, 'the fungal light pulses through three phases')

  const queue = [[nox.spawn.x, nox.spawn.y]]
  const reached = new Set()
  while (queue.length) {
    const [x, y] = queue.shift()
    const key_ = `${x},${y}`
    if (reached.has(key_) || tileAt(nox, x, y).solid) continue
    reached.add(key_)
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }
  for (const glyph of ['C', 'I', 'P', 'A', 'D', 'R']) {
    const point = locateGlyph(nox, glyph)
    t.ok(point && reached.has(`${point.x},${point.y}`), `${glyph} is reachable from the plaza`)
  }
  for (const point of [
    { x: 90, y: 31, name: 'palace court' },
    { x: 32, y: 44, name: 'luminous garden bridge' },
    { x: 130, y: 50, name: 'veiled market' }
  ]) {
    t.ok(reached.has(`${point.x},${point.y}`), `${point.name} belongs to the public route`)
  }
})

test('three save slots create, autosave and load persistent progress', (t) => {
  const dir = path.join(
    os.tmpdir(),
    `runa-save-slots-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  )
  const saves = new SaveStore(dir)

  try {
    const game = new Runa({ presence: false, saves })
    const menu = style.stripAnsi(game.view())
    t.ok(menu.includes('MENU PRINCIPAL'))
    t.ok(menu.includes('CONTINUAR  (sin partidas)'))
    t.ok(menu.includes('NUEVA PARTIDA'))
    t.ok(menu.includes('CARGAR PARTIDA  (sin partidas)'))

    game.update(keyMessage('enter'))
    typeText(game, 'Ayla')
    game.update(keyMessage('enter'))

    t.is(game.activeSlot, 1)
    t.is(saves.load(1).name, 'Ayla', 'creating a character writes slot one immediately')

    game.player.gold = 73
    game.player.xp = 29
    game.update(keyMessage('?'))
    const onDisk = saves.load(1)
    t.is(onDisk.player.gold, 73, 'a regular key update autosaves gold')
    t.is(onDisk.player.xp, 29, 'a regular key update autosaves experience')

    const loaded = new Runa({ presence: false, saves })
    loaded.update(keyMessage('enter'))
    t.is(loaded.title, false)
    t.is(loaded.activeSlot, 1)
    t.is(loaded.name, 'Ayla')
    t.is(loaded.player.gold, 73)
    t.is(loaded.player.xp, 29)
    t.ok(loaded.log.some((line) => line.includes('partida 1 cargada')))

    const second = new Runa({ presence: false, saves })
    second.update(keyMessage('down'))
    second.update(keyMessage('enter'))
    typeText(second, 'Borin')
    second.update(keyMessage('enter'))
    t.is(second.activeSlot, 2)
    t.is(saves.load(2).name, 'Borin')
    t.is(saves.load(1).name, 'Ayla', 'a second slot never overwrites the first')

    const browser = new Runa({ presence: false, saves })
    browser.update(keyMessage('down'))
    browser.update(keyMessage('down'))
    browser.update(keyMessage('enter'))
    t.is(browser.menuPage, 'slots', 'loading opens a separate slot screen')
    t.ok(style.stripAnsi(browser.view()).includes('PARTIDAS GUARDADAS'))
    browser.update(keyMessage('escape'))
    t.is(browser.menuPage, 'main', 'escape returns to the main menu')
  } finally {
    removeSaveFixture(dir)
  }
})

test('a field position survives closing and loading its slot', (t) => {
  const records = new Map()
  const saves = {
    list() {
      return Array.from({ length: 3 }, (_, index) => {
        const data = records.get(index + 1)
        return data
          ? {
              slot: index + 1,
              empty: false,
              corrupt: false,
              name: data.name,
              level: data.summary.level,
              place: data.summary.place
            }
          : { slot: index + 1, empty: true, corrupt: false }
      })
    },
    save(slot, state) {
      records.set(slot, JSON.parse(JSON.stringify(state)))
      return this.list()[slot - 1]
    },
    load(slot) {
      return JSON.parse(JSON.stringify(records.get(slot)))
    }
  }

  const game = new Runa({ presence: false, saves })
  startGame(game, 'Nara')
  game.field = new Field({ script: game.scriptSource })
  game.field.player.x = 41
  game.field.player.y = 17
  game.saveCurrent()

  const loaded = new Runa({ presence: false, saves })
  press(loaded, 'enter')
  t.ok(loaded.field)
  t.is(loaded.field.player.x, 41)
  t.is(loaded.field.player.y, 17)
  t.ok(style.stripAnsi(loaded.view()).includes('autoguardado R1'))
})

test('the larger city scrolls inside an 80-column console', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 80, height: 24 })
  startGame(game)

  const screen = style.stripAnsi(game.view())
  const lines = screen.split('\n')
  t.is(lines.length, 24, 'uses exactly the terminal height')
  t.ok(
    lines.every((line) => line.length === 80),
    'uses exactly the terminal width'
  )
  t.ok(MAPS.city.width > 80, 'the city is wider than one terminal viewport')
  t.ok(MAPS.city.height > 24, 'the city is taller than one terminal viewport')
  t.ok(
    MAPS.city.rows.some((row) => row.includes('~~~~~~~~~~~~~~~~~~')),
    'the city keeps its detailed fountain'
  )
  t.ok(screen.includes('ficha'), 'sidebar remains visible instead of dropping to compact stats')
  t.ok(!screen.includes('[#]'), 'a new hero does not display an unequipped shield')
  t.ok(!screen.includes('@'), 'the city no longer represents the hero with an at sign')

  t.ok(
    NPC_SPRITES.resident.some((line) => line.includes('[C]')),
    'city residents keep recognizable native map sprites'
  )
  t.ok(
    MAPS.city.rows.some((row) => row.includes('iglesia de la luz')),
    'the west district exists at high resolution'
  )
  t.ok(
    MAPS.city.rows.some((row) => row.includes('pociones y elixires')),
    'the east district exists at high resolution'
  )
})

test('the named hero animates and draws only equipped gear', (t) => {
  const standing = render.heroSprite({ frame: 0, items: [], initial: 'A' })
  const walking = render.heroSprite({ frame: 1, items: [], initial: 'A' })
  const equipped = render.heroSprite({
    frame: 0,
    items: ['sword', 'shield'],
    initial: 'A'
  })
  const expectedStanding = ['  O', ' /A\\', ' / \\'].join('\n')
  const expectedWalking = ['  O', ' \\A-', '  /|'].join('\n')

  t.is(standing.join('\n'), expectedStanding, 'the approved resting pose is reproduced exactly')
  t.is(walking.join('\n'), expectedWalking, 'movement advances the arms and legs')
  t.ok(equipped.join('\n').includes('[#]'), 'the shield appears once it is equipped')
  t.ok(equipped.join('\n').includes('/|A\\'), 'the sword appears in the left hand')
  t.is(standing[0], walking[0], 'the head remains fixed while walking')
  t.ok(
    standing.length === 3 && Math.max(...standing.map((line) => line.length)) <= 8,
    'the moving hero never exceeds its approved 8x3 footprint'
  )
  t.ok(
    walking.length === 3 && Math.max(...walking.map((line) => line.length)) <= 8,
    'the animated pose keeps the approved 8x3 footprint'
  )
  t.is(
    standing.join('').replace(/ /g, '').length,
    walking.join('').replace(/ /g, '').length,
    'both poses draw the same number of visible cells'
  )
})

test('weapons and armour occupy real slots, survive saves and affect combat', (t) => {
  const player = new Player({ gold: 2000, xp: 500 })
  player.buy('sword', 'weapons')
  player.buy('shield', 'armor')
  player.buy('leather', 'armor')
  player.buy('leather_cap', 'armor')
  player.buy('boots', 'armor')
  t.alike(player.snapshot().equipped, {
    left_hand: 'sword',
    right_hand: 'shield',
    chest: 'leather',
    head: 'leather_cap',
    boots: 'boots'
  })

  player.buy('crossbow', 'weapons')
  t.is(player.snapshot().equipped.left_hand, 'crossbow', 'a new weapon replaces the same slot')
  t.ok(player.owns('sword'), 'replaced gear stays in the inventory')

  const loaded = Player.fromJSON(JSON.stringify(player))
  t.is(loaded.toJSON().version, SAVE_VERSION)
  t.alike(loaded.snapshot().equipped, player.snapshot().equipped, 'the loadout survives a save')

  const oldSave = Player.fromJSON({
    version: 3,
    gold: 30,
    xp: 0,
    hp: 20,
    potions: 2,
    items: ['sword', 'leather'],
    equipped: { left: 'sword', right: 'leather' },
    pvp: { wins: 0, losses: 0 }
  })
  t.is(oldSave.snapshot().equipped.left_hand, 'sword', 'old weapon slots migrate')
  t.is(oldSave.snapshot().equipped.chest, 'leather', 'old armour moves out of the hand')
  t.alike(oldSave.snapshot().storage, [], 'old saves start with an empty home chest')

  const world = new World('mosquito')
  loaded.outfit(world)
  world.foe.x = 1
  const hp = world.hero.hp
  world.step()
  t.is(world.held.right.id, 'shield', 'combat starts with the persistent shield equipped')
  t.is(world.held.chest.id, 'leather', 'chest armour enters combat without occupying a hand')
  t.is(world.held.head.id, 'leather_cap', 'the helmet contributes at the same time')
  t.is(world.held.boots.id, 'boots', 'boots contribute at the same time')
  t.is(world.hero.hp, hp - 1, 'shield, chest and helmet stack their defence')

  loaded.unequip('shield')
  t.is(loaded.snapshot().equipped.right_hand, null, 'gear can be removed without selling it')
  t.ok(loaded.owns('shield'))
})

test('weapon, shield, chest, helmet and boots stay equipped together', (t) => {
  const player = new Player({
    items: ['dagger', 'shield', 'leather', 'leather_cap', 'boots']
  })
  for (const id of player.items) t.ok(player.equip(id).ok, `${id} equips`)
  t.alike(player.snapshot().equipped, {
    left_hand: 'dagger',
    right_hand: 'shield',
    chest: 'leather',
    head: 'leather_cap',
    boots: 'boots'
  })
})

test('every item declares the slot it occupies, and says it the same way twice', (t) => {
  const HANDS = { left_hand: 'left', right_hand: 'right' }
  const KINDS = {
    left_hand: 'weapon',
    right_hand: 'shield',
    chest: 'armor',
    head: 'helmet',
    boots: 'boots'
  }
  const ids = Object.keys(CONTENT.items)
  t.ok(ids.length > 0, 'there are items to check')

  for (const id of ids) {
    const item = CONTENT.items[id]
    t.ok(EQUIPMENT_SLOTS.includes(item.slot), `${id} has a known body slot`)
    t.is(item.kind, KINDS[item.slot], `${id}: its kind matches its slot`)
    if (HANDS[item.slot]) t.is(item.hand, HANDS[item.slot], `${id}: its hand matches its slot`)
    else t.absent(item.hand, `${id}: body gear does not pretend to occupy a hand`)
  }
})

test('equipping a second weapon replaces the first one and leaves the armour alone', (t) => {
  const player = new Player()
  player.items.add('dagger')
  player.items.add('sword')
  player.items.add('leather')

  player.equip('dagger')
  player.equip('leather')
  t.is(player.snapshot().equipped.left_hand, 'dagger')
  t.is(player.snapshot().equipped.chest, 'leather')

  const res = player.equip('sword')
  t.ok(res.ok, 'the second weapon equips')
  t.is(player.snapshot().equipped.left_hand, 'sword', 'the weapon slot is replaced')
  t.is(player.snapshot().equipped.chest, 'leather', 'chest armour survives the swap')
  t.ok(player.owns('dagger'), 'the displaced weapon stays in the inventory')
})

test('the expanded equipment catalogue has distinct combat roles', (t) => {
  const weapons = Object.values(CONTENT.items).filter((item) => item.kind === 'weapon')
  const armour = Object.values(CONTENT.items).filter((item) => item.kind === 'armor')
  const helmets = Object.values(CONTENT.items).filter((item) => item.kind === 'helmet')
  t.is(weapons.length, 6)
  t.is(armour.length, 3)
  t.is(helmets.length, 2)
  t.ok(new Set(weapons.map((item) => `${item.atk}/${item.reach}/${item.cooldown}`)).size >= 5)
  t.ok(new Set(armour.map((item) => `${item.defense || 0}/${item.speed}`)).size === 3)

  const sprite = render
    .heroSprite({ initial: 'A', items: ['warhammer', 'plate', 'iron_helmet', 'boots'] })
    .join('\n')
  t.ok(sprite.includes('T[O]'), 'the warhammer and helmet share the head row')
  t.ok(sprite.includes('HA'), 'plate armour is visible on the body')
  t.ok(sprite.includes('[O]'), 'the helmet is visible on the head')
  t.ok(sprite.includes('/_\\'), 'the boots are visible on the feet')
})

test('the shop lets the player equip and remove owned gear', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  game.width = 100
  game.height = 30
  game.player.gold = 100
  game.shop = 'weapons'

  press(game, 'enter')
  t.is(game.player.snapshot().equipped.left_hand, 'dagger', 'buying equipment puts it in its slot')
  t.ok(style.stripAnsi(game.view()).includes('equipado'), 'the shop marks the active item')

  press(game, 'x')
  t.is(game.player.snapshot().equipped.left_hand, null, 'x removes the selected item')
  t.ok(game.player.owns('dagger'), 'removing equipment does not sell it')

  press(game, 'enter')
  t.is(game.player.snapshot().equipped.left_hand, 'dagger', 'enter equips an item already owned')

  game.shop = 'armor'
  game.cursor = 0
  press(game, 'enter')
  t.is(game.player.snapshot().equipped.left_hand, 'dagger')
  t.is(game.player.snapshot().equipped.chest, 'leather')
  const screen = style.stripAnsi(game.view())
  t.ok(screen.includes('izq ; daga'))
  t.ok(screen.includes('pecho { cuero liviano'))
})

test('inventory equips five slots and the home chest deposits persistent items', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  game.width = 100
  game.height = 30
  for (const id of ['sword', 'shield', 'leather', 'leather_cap', 'boots']) {
    game.player.items.add(id)
    game.player.equip(id)
  }

  let screen = style.stripAnsi(game.view())
  t.ok(screen.includes('[I INVENTARIO]'), 'the city footer announces the inventory key')
  press(game, 'i')
  screen = style.stripAnsi(game.view())
  t.ok(screen.includes('INVENTARIO'))
  t.ok(screen.includes('[I / ESC CERRAR]'), 'the inventory shows how to close it')
  t.ok(screen.includes('ENTER equipar'), 'the inventory shows how to equip selected gear')
  t.ok(screen.includes('X quitar'), 'the inventory shows how to remove equipped gear')
  t.ok(screen.includes('izq / espada'))
  t.ok(screen.includes('der 0 escudo'))
  t.ok(screen.includes('pecho { cuero liviano'))
  t.ok(screen.includes('casco ( capucha de cuero'))
  t.ok(screen.includes('botas ^ botas'))
  for (const [width, height] of [
    [64, 16],
    [80, 24]
  ]) {
    game.update({ type: 'resize', width, height })
    const lines = style.stripAnsi(game.view()).split('\n')
    t.is(lines.length, height, `inventory keeps ${height} terminal rows`)
    t.ok(lines.join('\n').includes('[I / ESC CERRAR]'), `inventory key stays visible at ${width}`)
    t.ok(
      lines.every((line) => line.length === width),
      `inventory keeps ${width} columns`
    )
  }
  game.update({ type: 'resize', width: 100, height: 30 })
  press(game, 'escape')

  const home = locateGlyph(MAPS.city, 'C')
  game.walker.placeAt('city', home.x, home.y)
  press(game, 'e')
  t.ok(game.inventoryOpen && game.inventoryHome, 'interacting with home opens its chest')
  t.ok(style.stripAnsi(game.view()).includes('DEPOSITO DEL HOGAR'))

  press(game, 'enter')
  t.ok(game.player.stored('sword'), 'enter deposits the selected carried item')
  t.not(game.player.owns('sword'))
  t.is(game.player.equipped.left_hand, null, 'depositing equipped gear removes it safely')

  press(game, 'tab')
  screen = style.stripAnsi(game.view())
  t.ok(screen.includes('[ DEPOSITO ]'))
  t.ok(screen.includes('/ espada'))
  press(game, 'enter')
  t.ok(game.player.owns('sword'), 'enter withdraws the selected stored item')
  t.not(game.player.stored('sword'))

  game.player.deposit('shield')
  const loaded = Player.fromJSON(JSON.stringify(game.player))
  t.ok(loaded.stored('shield'), 'the home chest survives saving and loading')
  t.not(loaded.owns('shield'), 'stored gear is not also duplicated in the backpack')
})

test('spaces inside actor sprites are transparent over city and field terrain', (t) => {
  const sprite = render.heroSprite({ frame: 0 })
  const city = style
    .stripAnsi(
      render.mapPane(
        {
          tiles: Array(5).fill(','.repeat(12)),
          hero: { x: 5, y: 3, sprite },
          actors: []
        },
        12,
        5,
        { cellW: 1 }
      )
    )
    .split('\n')

  t.is(city[1][3], ',', 'terrain remains visible left of the head')
  t.is(city[2][7], ',', 'terrain remains visible between the arm and shield')
  t.is(city[3][5], ',', 'terrain remains visible between the legs')

  const field = style
    .stripAnsi(
      render.fieldPane(
        {
          rows: Array(5).fill('.'.repeat(12)),
          width: 12,
          height: 5,
          player: { x: 5, y: 3, sprite },
          foes: []
        },
        12,
        5
      )
    )
    .split('\n')

  t.is(field[1][3], '.', 'field terrain remains visible left of the head')
  t.is(field[2][7], '.', 'field terrain remains visible between the arm and shield')
  t.is(field[3][5], '.', 'field terrain remains visible between the legs')
})

test('the field can provide clean terrain beneath detailed actors', (t) => {
  const field = new Field({ seed: 17 })
  const composited = field.render(40, 10)
  const terrain = field.render(40, 10, false)

  t.ok(
    composited.some((row) => row.includes('@')),
    'the standalone field render keeps its player marker'
  )
  t.ok(
    terrain.every((row) => !row.includes('@')),
    'the detailed renderer receives terrain without actor glyphs'
  )
})

test('a successful map step changes position and advances the walking pose', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  game.walker.placeAt('city', 160, 130)
  const before = render.heroSprite({ frame: game.walker.x + game.walker.y, items: [] })

  press(game, 'right')
  const after = render.heroSprite({ frame: game.walker.x + game.walker.y, items: [] })

  t.is(game.walker.x, 161, 'the player advances one world tile')
  t.not(before.join('\n'), after.join('\n'), 'the limbs advance to the second pose')
  t.is(before.length, after.length, 'walking keeps the same height')
  t.is(
    Math.max(...before.map((line) => line.length)),
    Math.max(...after.map((line) => line.length)),
    'walking keeps the same width'
  )
})

test('doors and the field gate activate when the player steps on them', (t) => {
  const game = new Runa({ presence: false })
  game.title = false

  const find = (glyph) => {
    for (let y = 0; y < MAPS.city.rows.length; y++) {
      const x = MAPS.city.rows[y].indexOf(glyph)
      if (x !== -1) return { x, y }
    }
    return null
  }

  const potions = find('P')
  game.walker.placeAt('city', potions.x, potions.y + 1)
  press(game, 'up')
  t.is(game.shop, 'potions', 'stepping on P opens the potion shop')
  press(game, 'escape')

  const church = find('I')
  game.player.hp = 1
  game.walker.placeAt('city', church.x, church.y + 1)
  press(game, 'up')
  t.is(game.player.hp, game.player.maxHp, 'stepping on I enters the church and heals')

  const tavern = find('T')
  game.player.hp = 1
  game.walker.placeAt('city', tavern.x, tavern.y + 1)
  press(game, 'up')
  t.is(game.player.hp, game.player.maxHp, 'stepping on T rests at the tavern')
  t.is(game.player.gold, 27, 'the tavern charges its visible three-coin price')

  const gate = find('>')
  game.walker.placeAt('city', gate.x, gate.y - 1)
  press(game, 'down')
  t.ok(game.field, 'stepping on > enters the field')

  // Reset to city and verify walking against the gatehouse wall is blocked and does not teleport
  game.field = null
  game.walker.placeAt('city', 129, 184)
  press(game, 'right')
  t.absent(game.field, 'walking against the gatehouse wall does not enter the field')
  t.is(game.walker.x, 129, 'the gatehouse wall blocks movement')
})

test('city art remains rectangular and walkable', (t) => {
  const city = MAPS.city
  const cityText = city.rows.join('\n').toLowerCase()
  t.is(city.width, 320)
  t.is(city.height, 200)
  t.ok(city.rows.every((row) => row.length === city.width))
  t.ok(city.rows.some((row) => row.includes('^')))
  t.ok(city.rows.some((row) => row.includes('O')))
  t.ok(city.rows.some((row) => row.includes('*')))
  t.ok(city.rows.some((row) => row.includes('/')))
  t.ok(city.rows.some((row) => row.includes('[====]')))
  t.ok(cityText.includes('iglesia'))
  t.ok(cityText.includes('jarra dorada'))
  t.ok(cityText.includes('herreria'))
  t.ok(cityText.includes('armaduras'))
  t.ok(cityText.includes('castillo'), 'the northern district has a castle')
  t.ok(cityText.includes('porton'), 'the meadow exit has a visible gatehouse')
  t.ok(!cityText.includes('mercado'), 'the market has been completely removed from the city')
  t.ok(cityText.includes('yunque'), 'the smithy has its own detailed facade')
  t.ok(cityText.includes('elixires'), 'the alchemist facade keeps unique bottlework')
  t.ok(
    cityText.includes('.-====-.'),
    'the church has a rose window instead of a generic shop facade'
  )
  t.ok(cityText.includes('[== jarra ==]'), 'the tavern has its own half-timbered sign')
  t.ok(cityText.includes('fragua (())'), 'the smithy exposes a working forge bay')
  t.ok(cityText.includes('[]__[]__[]'), 'the armoury has a crenellated silhouette')
  t.is(city.npcs.length, 10, 'the city has ten static residents')
  t.ok(NPC_MASTER_SPRITES.guard.length >= 20, 'the faithful high-resolution knight is preserved')
  t.ok(
    NPC_MASTER_SPRITES.guard.some((line) => line.includes('hjw')),
    'the original knight credit is preserved'
  )
  t.ok(NPC_SPRITES.guard !== NPC_MASTER_SPRITES.guard, 'the map uses a compact guard drawing')
  t.ok(
    Object.values(NPC_SPRITES).every(
      (sprite) => sprite.length === 4 && sprite.every((line) => line.length === 7)
    ),
    'every city resident stays inside a stable 7x4 footprint'
  )
  t.ok(
    NPC_SPRITES.smith.some((line) => line.includes('T')),
    'the smith carries a compact hammer'
  )
  t.is(TILES[';'].solid, false)
  t.is(TILES.O.solid, true)
  t.is(TILES.T.enter.kind, 'tavern')
})

test('the hero statue opens level and PvP rankings', (t) => {
  const city = MAPS.city
  const statue = city.landmarks.find((landmark) => landmark.id === 'hero-statue')
  t.ok(statue)
  t.ok(city.rows.join('\n').includes('heroes runa'), 'the monument is visible in the plaza')

  const game = new Runa({ presence: false, name: 'Ayla' })
  game.title = false
  game.name = 'Ayla'
  game.player.gainXp(xpToLeave(1) + xpToLeave(2))
  game.player.recordDuel(true)
  game.slots = [
    { slot: 1, name: 'Borin', level: 2, pvp: { wins: 4, losses: 1 } },
    { slot: 2, empty: true },
    { slot: 3, empty: true }
  ]
  game.walker.placeAt('city', 160, 160)
  t.is(game.nearbyLandmark().id, 'hero-statue')
  press(game, 'e')
  t.ok(game.rankingOpen)

  let screen = style.stripAnsi(game.view())
  t.ok(screen.includes('clasificacion por nivel'))
  t.ok(screen.indexOf('Ayla') < screen.indexOf('Borin'), 'level ranking puts level 3 first')
  press(game, 'right')
  screen = style.stripAnsi(game.view())
  t.ok(screen.includes('clasificacion pvp'))
  t.ok(screen.indexOf('Borin') < screen.indexOf('Ayla'), 'PvP ranking puts four wins first')
  press(game, 'escape')
  t.absent(game.rankingOpen)
})

test('the improved hero plaza animates its fountain without mutating collision art', (t) => {
  const city = MAPS.city
  const fountain = city.animations.find((animation) => animation.id === 'plaza-fountain-water')
  t.ok(city.rows.join('\n').includes('plaza de los heroes'))
  t.ok(fountain, 'the central fountain publishes water animation frames')
  t.is(fountain.frames.length, 4, 'water descends through four distinct phases')
  t.ok(city.rows.join('\n').includes('|o o|'), 'the monument has a recognizable hero face')
  t.ok(
    city.rows.join('\n').includes('.-----------|||-----------.'),
    'a wide lower tier gives the fountain a ceremonial silhouette'
  )
  t.ok(
    fountain.frames.every((frame) => frame.length === fountain.frames[0].length),
    'every water phase has a stable terminal footprint'
  )

  const game = new Runa({ presence: false })
  game.title = false
  game.update({ type: 'resize', width: 120, height: 34 })
  game.walker.placeAt('city', 160, 165)
  const collisionRow = city.rows[155]
  game.animationTick = 0
  const first = style.stripAnsi(game.view())
  for (let tick = 0; tick < fountain.cadence; tick++) game.onTick()
  const second = style.stripAnsi(game.view())

  t.not(first, second, 'water crests and drops change between visible phases')
  t.is(city.rows[155], collisionRow, 'animation never rewrites the collision map')
  t.ok(first.split('\n').every((line) => line.length === game.width))
  t.ok(second.split('\n').every((line) => line.length === game.width))
})

test('the coliseum is a high-resolution duel map with mirrored safe spawns', (t) => {
  const arena = MAPS.coliseum
  const [west, east] = arena.duelSpawns
  const art = arena.rows.join('\n').toLowerCase()

  t.is(arena.width, 128)
  t.is(arena.height, 52)
  t.ok(
    arena.rows.every((row) => row.length === arena.width),
    'the arena art is rectangular'
  )
  t.ok(art.includes('coliseo de runa'), 'the grandstand identifies the venue')
  t.ok(art.includes('puerta sur'), 'the public entrance is visible without blocking its tunnel')
  t.is(arena.duelReady, true, 'the map advertises its multiplayer integration contract')
  t.is(arena.duelSpawns.length, 2)
  t.is(west.y, east.y, 'both contenders start on one combat line')
  t.is(west.x + east.x, arena.width - 1, 'the two starts are mirrored around center')
  t.is(west.facing, 'east')
  t.is(east.facing, 'west')
  t.is(tileAt(arena, west.x, west.y).solid, false, 'the west player starts on open ground')
  t.is(tileAt(arena, east.x, east.y).solid, false, 'the east player starts on open ground')
  t.is(
    tileAt(arena, arena.refereeSpawn.x, arena.refereeSpawn.y).solid,
    false,
    'the reserved referee point is open'
  )
  t.is(tileAt(arena, arena.arrive.x, arena.arrive.y).solid, false, 'arrival is in the tunnel')
  t.is(arena.rows[41][arena.arrive.x], '.', 'the entrance label cannot close the tunnel')
  t.ok(art.split('%').length > 1000, 'the duel floor leaves ample space to move and dodge')

  const pending = [{ ...arena.arrive }]
  const reached = new Set([`${arena.arrive.x},${arena.arrive.y}`])
  while (pending.length) {
    const point = pending.shift()
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1]
    ]) {
      const x = point.x + dx
      const y = point.y + dy
      const key = `${x},${y}`
      if (reached.has(key) || tileAt(arena, x, y).solid) continue
      reached.add(key)
      pending.push({ x, y })
    }
  }
  t.ok(reached.has(`${west.x},${west.y}`), 'the west spawn is reachable from the tunnel')
  t.ok(reached.has(`${east.x},${east.y}`), 'the east spawn is reachable from the tunnel')
})

test('the coliseum exit returns safely to the city', (t) => {
  const game = new Runa({ presence: false })
  const arena = MAPS.coliseum
  game.title = false
  game.walker.placeAt('coliseum', arena.exit.x, arena.exit.y)

  t.is(game.walker.action().to, 'city')
  press(game, 'e')
  t.is(game.walker.mapId, 'city')
  t.is(game.walker.x, MAPS.city.arrive.x)
  t.is(game.walker.y, MAPS.city.arrive.y)
})

test('an accepted PvP duel uses the Coliseum, equipment and exact return point', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  game.name = 'Ayla'
  game.walker.placeAt('city', 160, 130)
  game.player.gold = 100
  game.player.buy('sword', 'weapons')
  game.player.buy('shield', 'armor')

  const started = game.startDuel('Borin', {
    selfId: 'peer-a',
    rivalId: 'peer-b',
    rivalStats: { hp: 8, maxHp: 8, atk: 3, defense: 1, reach: 2, cooldown: 8 }
  })
  t.ok(started)
  t.is(game.walker.mapId, 'coliseum')
  t.ok(game.duel.inside(game.walker.x, game.walker.y))
  t.is(started.self.atk, 5, 'the equipped sword contributes to PvP attack')
  t.is(started.self.defense, 2, 'the equipped shield contributes to PvP defence')
  t.is(started.self.reach, 2)

  const rival = game.duelCombat.fighter('peer-b')
  game.walker.placeAt('coliseum', rival.x - 7, rival.y)
  game.duelCombat.place('peer-a', rival.x - 7, rival.y)
  const screen = style.stripAnsi(game.view())
  t.ok(screen.includes('COLISEO'))
  t.ok(screen.includes('Borin 8/8 hp'))
  t.ok(screen.includes('/|A\\'), 'the local initial remains on the equipped hero')
  t.ok(screen.includes('/B\\'), 'the opponent has a full transparent stickman sprite')
  t.ok(screen.includes('r rendirse'))
  t.ok(screen.split('\n').every((line) => line.length === game.width))

  const saved = game.saveState()
  t.alike(
    saved.location,
    { kind: 'map', mapId: 'city', x: 160, y: 130 },
    'autosave records the pre-duel position instead of an orphaned arena'
  )

  press(game, 'r')
  t.absent(game.duel)
  t.is(game.walker.mapId, 'city')
  t.is(game.walker.x, 160)
  t.is(game.walker.y, 130)
  t.is(game.lastDuelResult.winner, 'peer-b')
  t.alike(game.player.snapshot().pvp, { wins: 0, losses: 1 })
})

test('PvP movement stays in bounds and ordered attacks finish deterministically', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  game.name = 'Ana'
  game.walker.placeAt('city', 160, 130)
  game.startDuel('Beto', {
    selfId: 'ana',
    rivalId: 'beto',
    rivalStats: { hp: 1, maxHp: 1, atk: 1, defense: 0, reach: 1, cooldown: 30 }
  })
  t.absent(game.duelInput('intruso', { attack: true }), 'unknown network input is ignored')

  const b = MAPS.coliseum.arenaBounds
  game.walker.placeAt('coliseum', b.x1, b.y1)
  game.duelCombat.place('ana', b.x1, b.y1)
  press(game, 'left')
  press(game, 'up')
  t.is(game.walker.x, b.x1)
  t.is(game.walker.y, b.y1)

  const rival = game.duelCombat.fighter('beto')
  game.walker.placeAt('coliseum', rival.x - 1, rival.y)
  game.duelCombat.place('ana', rival.x - 1, rival.y)
  press(game, 'right')
  t.is(game.walker.x, rival.x - 1, 'fighters cannot occupy the same anchor cell')
  press(game, 'f')
  t.absent(game.duel, 'lethal damage closes the ephemeral session')
  t.is(game.walker.mapId, 'city')
  t.is(game.lastDuelResult.winner, 'ana')
  t.is(game.player.hp, game.player.maxHp, 'PvP damage never leaks into persistent PvE life')
})

test('the Coliseum safety exit is blocked only by a live duel', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  game.startDuel('Beto', { selfId: 'ana', rivalId: 'beto' })
  game.walker.placeAt('coliseum', MAPS.coliseum.exit.x, MAPS.coliseum.exit.y)
  press(game, 'e')
  t.is(game.walker.mapId, 'coliseum')
  t.ok(game.duel.active)
  t.ok(game.log.some((line) => String(line).includes('porton queda cerrado')))
})

test('city NPCs block movement and provide their services', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  const brom = MAPS.city.npcs.find((npc) => npc.id === 'brom')

  game.walker.placeAt('city', brom.x, brom.y + 1)
  press(game, 'up')
  t.is(game.walker.y, brom.y + 1, 'the player cannot walk through an NPC anchor')
  t.ok(game.log.some((line) => String(line).includes('pulsa e para hablar')))

  press(game, 'e')
  t.is(game.shop, 'weapons', 'talking to the blacksmith opens the weapon shop')
})

test('the plaza knight gives and rewards the mosquito mission once', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  const knight = MAPS.city.npcs.find((npc) => npc.id === 'cedric')
  const quest = QUESTS.mosquito_hunt

  t.ok(knight, 'sir Cedric waits in the plaza')
  t.is(TILES[MAPS.city.rows[knight.y][knight.x]].solid, false, 'his plaza anchor is walkable')
  game.walker.placeAt('city', knight.x, knight.y + 1)
  press(game, 'e')
  t.is(game.quests[quest.id].status, 'active', 'talking to him accepts the mission')
  t.is(game.quests[quest.id].progress, 0)

  game.recordQuestKill('golem')
  for (let kill = 0; kill < quest.count - 1; kill++) game.recordQuestKill('mosquito')
  t.is(game.quests[quest.id].progress, 19, 'only mosquito kills advance the objective')
  t.ok(style.stripAnsi(game.view()).includes('mision mosquitos 19/20'))

  const goldBefore = game.player.gold
  press(game, 'e')
  t.is(game.player.gold, goldBefore, 'an unfinished mission pays nothing')

  const world = new World('mosquito')
  world.over = 'ganaste'
  game.field = { combat: null }
  game.pending = world
  game.earned = { kind: 'mosquito' }
  game.syncCombat(true)
  game.field = null
  t.ok(style.stripAnsi(game.view()).includes('mision lista: volver'))
  const readyGold = game.player.gold
  const readyXp = game.player.xp
  press(game, 'e')
  t.is(game.quests[quest.id].status, 'completed')
  t.is(game.player.gold, readyGold + quest.reward.gold)
  t.is(game.player.xp, readyXp + quest.reward.xp)

  press(game, 'e')
  t.is(game.player.gold, readyGold + quest.reward.gold, 'the reward cannot be claimed twice')
  const saved = game.saveState()
  t.alike(saved.quests[quest.id], {
    status: 'completed',
    progress: quest.count
  })
  const loaded = new Runa({
    presence: false,
    saves: { list: () => [], load: () => JSON.parse(JSON.stringify(saved)) }
  })
  t.ok(loaded.loadSlot(1))
  t.alike(loaded.quests[quest.id], saved.quests[quest.id], 'mission progress survives loading')
})

test('the throne room connects the city, king and castle ruins', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  const locate = (map, glyph) => {
    for (let y = 0; y < map.height; y++) {
      const x = map.rows[y].indexOf(glyph)
      if (x !== -1) return { x, y }
    }
    return null
  }

  const entrance = locate(MAPS.city, 'K')
  t.ok(entrance, 'the city castle has a visible entrance')
  game.walker.placeAt('city', entrance.x, entrance.y)
  press(game, 'e')
  t.is(game.walker.mapId, 'castle', 'the castle entrance opens the great hall')
  t.ok(style.stripAnsi(game.view()).includes('salon del trono'))
  t.is(MAPS.castle.npcs[0].name, 'Aldren', 'the king waits beside his throne')
  t.is(MAPS.castle.npcs[0].sprite, NPC_SPRITES.king, 'Aldren uses the seated king sprite')
  t.ok(NPC_SPRITES.king[0].includes('\\/\\/'), 'the seated king wears a crown')
  t.ok(NPC_SPRITES.king[3].includes('|_/ \\_|'), 'the king rests inside the throne')
  game.walker.placeAt('castle', 56, 14)
  press(game, 'e')
  t.ok(
    game.log.some((line) => String(line).includes('Aldren')),
    'the king can be consulted'
  )

  const dungeonEntrance = locate(MAPS.castle, 'V')
  t.ok(dungeonEntrance, 'the ruins have a dedicated side stair')
  game.walker.placeAt('castle', dungeonEntrance.x, dungeonEntrance.y)
  press(game, 'e')
  t.is(game.walker.mapId, 'dungeon', 'the side stair descends into the ruins')
  t.ok(style.stripAnsi(game.view()).includes('las ruinas bajo el castillo'))

  const exit = locate(MAPS.dungeon, 'U')
  game.walker.placeAt('dungeon', exit.x, exit.y)
  press(game, 'e')
  t.is(game.walker.mapId, 'castle', 'U climbs back into the throne room')
  t.is(game.walker.x, dungeonEntrance.x, 'the player returns beside the ruins stair')
  t.is(game.walker.y, dungeonEntrance.y + 1)

  const castleExit = locate(MAPS.castle, 'B')
  t.ok(castleExit, 'the great hall has a visible city exit')
  game.walker.placeAt('castle', castleExit.x, castleExit.y)
  press(game, 'e')
  t.is(game.walker.mapId, 'city', 'the south door returns to the city')
  t.is(game.walker.x, entrance.x, 'the player returns beside the castle entrance')
  t.is(game.walker.y, entrance.y + 1)
})

test('the field pane paints the whole field, not one stringified line', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 88, height: 26 })
  startGame(game)

  // Find the gate the map itself declares. Hardcoding its coordinates would let
  // somebody move the gate and quietly turn this test into a no-op.
  let gate = null
  const rows = MAPS.city.rows
  for (let y = 0; y < rows.length && gate === null; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const tile = TILES[rows[y][x]]
      if (tile && tile.enter && tile.enter.kind === 'travel' && tile.enter.to === 'field') {
        gate = { x, y }
        break
      }
    }
  }
  t.ok(gate !== null, 'the city has a gate out to the field')

  game.walker.placeAt('city', gate.x, gate.y)
  game.onKey({ type: 'key', is: (...keys) => keys.includes('e') })
  t.ok(game.field !== null, 'stepping through the gate opens the field')

  const lines = style.stripAnsi(game.view()).split('\n')
  const pane = lines.map((line) => line.slice(1, 58))
  const painted = pane.filter((line) => /[.,~#@<]/.test(line))

  // The bug this guards against, in full, because it cost a demo:
  //
  // field.render() hands back one string per row and compose() wants a single
  // string. Passing the array through meant box() stringified it, all 22 rows
  // were joined by commas into one line, and the pane showed a single stripe of
  // terrain with the hero nowhere on it. Nothing threw and every other test
  // stayed green, so only an assertion about the painted frame can see it.
  t.ok(painted.length > 10, 'terrain covers the pane rather than a single row')
  t.ok(
    lines.some((line) => line.includes('/T\\') || line.includes('\\T-')),
    'the small moving hero is somewhere on screen'
  )

  // And the field is drawn at full width. Dividing the pane by CELL_W as well
  // as letting the field paint one column per cell squeezed the world into the
  // left half of the box, which reads as a rendering glitch rather than a bug.
  t.ok(
    painted.some((line) => /[.,~#]/.test(line.slice(40))),
    'the field reaches the right hand side of the pane'
  )
})

test('field monsters are recognizable moving sprites', (t) => {
  const rows = Array(16).fill(' '.repeat(72))
  const pane = style.stripAnsi(
    render.fieldPane(
      {
        rows,
        width: 72,
        height: 16,
        player: { x: 40, y: 8 },
        foes: [
          { kind: 'mosquito', glyph: '~', x: 8, y: 8 },
          { kind: 'espectro', glyph: '&', x: 25, y: 8 },
          { kind: 'golem', glyph: '#', x: 63, y: 8 }
        ]
      },
      72,
      16
    )
  )

  t.ok(pane.includes('(o)>'), 'the compact mosquito has a readable body and proboscis')
  t.ok(pane.includes('(S)'), 'the compact spectre has a floating silhouette')
  t.ok(pane.includes('[G]'), 'the compact golem has a stone silhouette')
  t.ok(pane.includes('/T\\'), 'the unequipped player remains visible over every sprite')
  t.ok(
    pane.split('\n').every((line) => line.length === 72),
    'sprites do not change pane width'
  )
})

test('field monsters keep patrolling without bloating redraw rows', (t) => {
  const field = new Field({ seed: 17 })
  const before = field.foes.map((foe) => foe.x + ',' + foe.y).join('|')

  for (let i = 0; i < 200; i++) field.tick()
  const after = field.foes.map((foe) => foe.x + ',' + foe.y).join('|')
  t.ok(after !== before, 'the rendering fix does not freeze monster patrols')

  const pane = render.fieldPane(
    {
      rows: Array(12).fill('.'.repeat(120)),
      width: 120,
      height: 12,
      player: { x: 60, y: 6 },
      foes: field.snapshot().foes
    },
    120,
    12
  )
  t.ok(
    pane.split('\n').every((line) => line.length < 220),
    'even rows containing moving sprites stay compact on the wire'
  )
})

test('touching hitboxes keep both compact sprites visible', (t) => {
  const pane = style.stripAnsi(
    render.fieldPane(
      {
        rows: Array(12).fill(' '.repeat(40)),
        width: 40,
        height: 12,
        player: { x: 20, y: 6 },
        foes: [{ kind: 'mosquito', glyph: '~', x: 21, y: 6, active: true }]
      },
      40,
      12
    )
  )

  t.ok(pane.includes('(o)>'), 'the contacted monster is not hidden by the hero')
  t.ok(pane.includes('/T\\'), 'the hero remains visible beside the contacted monster')
  t.ok(
    pane.split('\n').every((line) => line.length === 40),
    'presentation separation preserves pane width'
  )
})

test('moving actors restore every terrain cell they leave behind', (t) => {
  const cityRows = Array(10).fill('-'.repeat(40))
  const movedHero = style.stripAnsi(
    render.mapPane(
      {
        tiles: cityRows,
        hero: { x: 25, y: 5, sprite: render.heroSprite({ frame: 1, items: [] }) },
        actors: []
      },
      40,
      10,
      { cellW: 1 }
    )
  )
  for (const row of movedHero.split('\n').slice(3, 7)) {
    t.is(row.slice(5, 12), '-------', 'the old hero footprint is restored')
  }
  t.is(movedHero.split('\n')[6], '-'.repeat(40), 'the hero never paints below its collision cell')

  const fieldRows = Array(10).fill('.'.repeat(40))
  const movedFoe = style.stripAnsi(
    render.fieldPane(
      {
        rows: fieldRows,
        width: 40,
        height: 10,
        player: { x: 20, y: 5 },
        foes: [{ kind: 'mosquito', x: 31, y: 5 }]
      },
      40,
      10
    )
  )
  for (const row of movedFoe.split('\n').slice(4, 7)) {
    t.is(row.slice(6, 10), '....', 'the old monster footprint is restored')
  }
})

test('field combat starts only when actor hitboxes touch', (t) => {
  const field = new Field({ seed: 17 })
  const foe = field.foes[0]
  foe.nextStep = Infinity
  field.player.x = foe.x > 3 ? foe.x - 3 : foe.x + 3
  field.player.y = foe.y

  for (let i = 0; i < 180; i++) field.tick()
  t.is(field.combat, null, 'distance alone never rolls an encounter')

  const toward = Math.sign(foe.x - field.player.x)
  field.walk(toward, 0)
  t.is(field.combat, null, 'two tiles apart is outside the hitbox')
  const events = field.walk(toward, 0)
  t.ok(
    events.some((event) => event.type === 'contact'),
    'touching the one-tile hitbox emits contact'
  )
  t.ok(field.combat, 'contact arms direct combat on the field')
  t.is(field.combat.world.foe.x, 1, 'visible contact is also contact in combat geometry')
})

/**
 * Walk out of town and touch the first monster's hitbox.
 *
 * @param {object} game
 * @returns {boolean} whether a fight is running
 */
function pickAFight(game) {
  let gate = null
  const rows = MAPS.city.rows
  for (let y = 0; y < rows.length && gate === null; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const tile = TILES[rows[y][x]]
      if (tile && tile.enter && tile.enter.kind === 'travel' && tile.enter.to === 'field') {
        gate = { x, y }
        break
      }
    }
  }
  if (gate === null) return false

  game.walker.placeAt('city', gate.x, gate.y)
  game.onKey({ type: 'key', is: (...keys) => keys.includes('e') })
  if (!game.field) return false

  const foe = game.field.foes.find((candidate) => !candidate.dead)
  if (!foe) return false
  game.field.player.x = foe.x > 1 ? foe.x - 2 : foe.x + 2
  game.field.player.y = foe.y
  press(game, foe.x > game.field.player.x ? 'right' : 'left')
  return game.field.snapshot().fighting
}

test('the experience bar shows progress into the level, not lifetime over one', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 100, height: 30 })
  startGame(game)

  game.player.xp = 18
  const sheet = game.sheet()

  // statsPanel reads `xpNext`, the snapshot only ever had `xpneed`, and a
  // missing field is undefined rather than an error. The bar divided by one,
  // so after a single kill it read `18/1` and stayed full from then on. That
  // is the first number a new player watches change, so it had to be the first
  // thing checked.
  t.ok(sheet.xpNext > 1, 'the bar has a real denominator')
  t.is(sheet.xp, sheet.xpinto, 'the bar draws progress into the current level')
  t.ok(sheet.xp < sheet.xpNext, 'progress fits inside the level it belongs to')

  const screen = style.stripAnsi(game.view())
  const bar = screen.split('\n').find((line) => line.indexOf('xp [') !== -1) || ''
  t.ok(bar.indexOf('/1 ') === -1 && !/\/1$/.test(bar.trim()), 'never renders over one')
  t.ok(bar.indexOf('/' + sheet.xpNext) !== -1, 'prints the real denominator')
})

test('the equipment rows follow what is actually in hand', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 100, height: 30 })
  startGame(game)

  game.player.gold = 500
  game.player.buy('sword', 'weapons')
  const town = style.stripAnsi(game.view())
  t.ok(town.indexOf('izq / espada') !== -1, 'what you bought shows up on the sheet')

  t.ok(pickAFight(game), 'a fight starts out in the field')

  // The inventory loadout enters combat immediately. The sheet keeps reading
  // the live world because an explicit, owned `equip` rule may still switch it.
  t.ok(game.field.combat, 'the fight is still running')
  const held = game.field.combat.world.held
  t.is(held.left && held.left.id, 'sword', 'the equipped weapon entered the fight')

  const fight = style.stripAnsi(game.view())
  const wielded = held.left || held.right
  t.ok(fight.indexOf(wielded.name) !== -1, 'the sheet names the weapon actually in hand')
  t.is(game.sheet().left, held.left, 'the left row is the world truth, not a stale copy')
  t.is(game.sheet().right, held.right, 'and so is the right row')
})

test('combat keeps the equipped weapon instead of silently changing to a sword', (t) => {
  t.ok(isLegacyDefaultScript(LEGACY_DEFAULT_SCRIPT), 'the shipped legacy strategy is detected')
  t.absent(isLegacyDefaultScript(DEFAULT_SCRIPT), 'the new strategy no longer auto-equips weapons')

  for (const id of ['spear', 'longbow']) {
    const game = new Runa({ presence: false })
    game.update({ type: 'resize', width: 100, height: 30 })
    startGame(game, id)
    game.player.items.add(id)
    t.ok(game.player.equip(id).ok, `${id} can be equipped from inventory`)
    t.ok(pickAFight(game), `${id} reaches a field fight`)

    const world = game.field.combat.world
    const before = world.foe.hp
    t.is(world.held.left && world.held.left.id, id, `${id} starts in the left hand`)
    press(game, 'f')
    t.is(world.held.left && world.held.left.id, id, `${id} remains after attacking`)
    t.is(before - world.foe.hp, 1 + CONTENT.items[id].atk, `${id} supplies its own damage`)
    t.ok(
      world.log.some((line) => line.text.includes(`con ${CONTENT.items[id].name}`)),
      `the combat log names ${id}`
    )
  }
})

test('combat scripts cannot replace equipment with an unowned weapon', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 100, height: 30 })
  startGame(game)
  game.player.items.add('spear')
  game.player.equip('spear')
  t.ok(pickAFight(game), 'the equipped spear enters combat')

  game.field.setScript('equip sword')
  press(game, 'f')

  t.is(game.field.combat.world.held.left.id, 'spear', 'the unowned sword is rejected')
  t.ok(
    game.field.combat.world.log.some((line) => line.text.includes('no tenes espada')),
    'the rejection explains why the weapon did not change'
  )
})

test('the payout stays on the numbers the game was actually tuned against', (t) => {
  const mosquito = reward('mosquito')
  const golem = reward('golem')

  t.ok(mosquito.xp < golem.xp, 'the easy thing is worth less experience')
  t.ok(mosquito.gold < golem.gold, 'and less gold')

  // This is a balance lock, not a description of how reward() is written.
  //
  // content.js carries a `drop` table that reward() has never read, because it
  // tested `def.drops` and the table has always been `drop`. Making the names
  // match looks like an obvious one word fix and it is not: the table pays a
  // mosquito 3 xp where the formula pays 18, so levelling goes from one kill to
  // four and the crossbow from five kills to fifteen. Every price and every xp
  // threshold in this game was tuned against the formula. Whoever wants to move
  // the economy should move it deliberately and change this test on purpose.
  t.is(mosquito.xp, 18, 'a mosquito is still worth 18 experience')
  t.is(mosquito.gold, 12, 'and 12 gold')
  t.ok(reward('mosquito').xp >= xpToLeave(1), 'one kill still clears the first level')
})

test('the gold the log announces is the gold the purse receives', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 88, height: 26 })
  startGame(game)
  game.player.items.add('dagger')
  game.player.equip('dagger')

  t.ok(pickAFight(game), 'a fight starts out in the field')

  // Run the fight out and watch the tick it resolves on.
  let before = { gold: game.player.gold, xp: game.player.xp }
  let line = null
  let credited = null
  for (let i = 0; i < 4000 && game.field; i++) {
    const fighting = !!game.field.combat
    before = { gold: game.player.gold, xp: game.player.xp }
    game.log.length = 0
    press(game, 'f')
    if (fighting && game.field && !game.field.combat) {
      line = game.log.find((l) => String(l).indexOf('cae el') !== -1) || null
      credited = { gold: game.player.gold - before.gold, xp: game.player.xp - before.xp }
      break
    }
  }

  t.ok(line, 'the kill is announced')
  t.ok(credited && credited.gold > 0, 'and it paid something')

  // The field rolled these numbers on its own throwaway sheet and said them
  // out loud, while settle() credited a different figure entirely: the log read
  // `+5 oro` and the purse went up by 12, on every single kill. Now one roll
  // travels in the event and is announced by whoever banks it, so the two
  // cannot drift apart again.
  const said = /\+(\d+) oro, \+(\d+) exp/.exec(String(line))
  t.ok(said, 'the line carries both numbers')
  t.is(Number(said[1]), credited.gold, 'the gold announced is the gold received')
  t.is(Number(said[2]), credited.xp, 'and the same for experience')
})

test('dying puts you at the church it says it puts you at', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 88, height: 26 })
  startGame(game)

  t.ok(pickAFight(game), 'a fight starts out in the field')

  // Lose on purpose rather than waiting for a rule to lose for us.
  game.field.combat.world.potions = 0
  game.field.combat.world.hero.hp = 0
  game.log.length = 0
  for (let i = 0; i < 40 && game.field; i++) press(game, 'f')

  t.absent(game.field, 'the excursion is over')

  // Both layers used to narrate this, so the log printed two near identical
  // lines one under the other.
  const church = game.log.filter((l) => String(l).indexOf('iglesia') !== -1)
  t.is(church.length, 1, 'waking up in the church is said once, not twice')

  // And it used to leave you on the cobble next to the gate out to the field,
  // eleven rows from the church, on the doorstep of the thing that killed you.
  let door = null
  const rows = MAPS.city.rows
  for (let y = 0; y < rows.length && door === null; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const tile = TILES[rows[y][x]]
      if (tile && tile.enter && tile.enter.kind === 'church') {
        door = { x, y }
        break
      }
    }
  }
  t.ok(door !== null, 'the town has a church')
  t.is(game.walker.x, door.x, 'you wake up at its door, not near the gate')
  t.is(game.walker.y, door.y)
})

test('the title screen says what the swarm is actually doing', (t) => {
  const fake = (peers, conns) => ({
    others: () => new Array(peers).fill({ name: 'x' }),
    conns: new Set(new Array(conns).fill(0).map((_, i) => i))
  })

  const wired = (peers, conns, started) => {
    const game = new Runa({ presence: false })
    game.update({ type: 'resize', width: 88, height: 26 })
    game.online = true
    game.presence = fake(peers, conns)
    game.presenceStarted = started
    return game
  }

  const solo = new Runa({ presence: false })
  solo.update({ type: 'resize', width: 88, height: 26 })
  t.is(solo.presenceLine(), 'modo un jugador', 'playing alone says so')

  t.is(wired(0, 0, false).presenceLine(), 'la red se conecta al comenzar')

  // Searching and offline are different claims about the world, and the whole
  // point of putting this on screen is to stop the game being silent about
  // which one is true.
  t.is(wired(0, 0, true).presenceLine(), 'buscando jugadores...')
  t.is(wired(0, 1, true).presenceLine(), 'conectando...')
  t.is(wired(1, 1, true).presenceLine(), '1 jugador mas en linea')
  t.is(wired(3, 1, true).presenceLine(), '3 jugadores mas en linea')

  const screen = style.stripAnsi(wired(3, 1, true).view())
  t.ok(screen.indexOf('3 jugadores mas en linea') !== -1, 'and it reaches the screen')
})

test('the swarm line never pushes the title off its own screen', (t) => {
  const game = new Runa({ presence: false })
  game.online = true
  game.presence = { others: () => [{ name: 'ana' }], conns: new Set([0]) }
  game.presenceStarted = true

  // 64 by 16 is the smallest terminal the game agrees to draw in at all, so it
  // is the size where an extra line is most likely to cost something. The logo
  // and the prompt are what this screen exists for: the status is the first
  // thing that gets dropped, not the last.
  for (const [w, h] of [
    [64, 16],
    [80, 20],
    [88, 26],
    [200, 50]
  ]) {
    game.update({ type: 'resize', width: w, height: h })
    const screen = style.stripAnsi(game.view())
    const lines = screen.split('\n')

    t.is(lines.length, h, 'exactly ' + h + ' rows at ' + w + 'x' + h)
    t.ok(
      lines.every((line) => line.length === w),
      'every row is exactly ' + w + ' wide'
    )
    t.ok(screen.indexOf('RUNA') !== -1, 'the logo survives at ' + w + 'x' + h)
    t.ok(screen.indexOf('ENTER / ESPACIO') !== -1, 'and so does the prompt')
  }
})

test('the wallet screen is visible, stable and saves only the public address', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 80, height: 24 })
  startGame(game, 'Luna')

  const secret = game.chain.create()
  const address = game.chain.address
  t.ok(game.wallet.link(address))
  game.walletOpen = true

  const screen = style.stripAnsi(game.view())
  const lines = screen.split('\n')
  t.ok(screen.includes('WALLET Y PVP'))
  t.ok(screen.includes('firma externa: no configurada'))
  t.ok(screen.includes('v / esc volver'))
  t.is(lines.length, 24, 'wallet UI keeps the terminal height')
  t.ok(
    lines.every((line) => line.length === 80),
    'wallet UI keeps every terminal row stable'
  )

  const saved = JSON.stringify(game.saveState())
  t.ok(saved.includes(address), 'the public identity persists with the slot')
  t.absent(saved.includes(secret), 'a secret seed never reaches save data')
})

test('hitbox combat stays on the field and advances on attack input', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 100, height: 30 })
  startGame(game)
  t.ok(pickAFight(game), 'a fight starts in the field')

  const world = game.field.combat.world
  const before = world.tick
  for (let i = 0; i < 60; i++) game.update({ type: 'tick' })
  t.is(world.tick, before, 'clock ticks do not advance combat')

  const paused = style.stripAnsi(game.view())
  t.ok(paused.includes('hitbox activa'))
  t.ok(paused.includes('f / espacio atacar'))
  t.ok(!paused.includes('[#]'), 'combat does not invent an unequipped shield')
  t.ok(paused.includes('(S)') || paused.includes('(o)>') || paused.includes('[G]'))
  t.ok(!paused.includes('un encuentro'), 'there is no encounter card')
  t.ok(!paused.includes('combate por turnos'), 'there is no separate arena')

  press(game, 'space')
  t.is(world.tick, before + COMBAT_TURN_TICKS, 'one input resolves one visible turn')
  t.is(game.sheet().hp, Math.ceil(world.hero.hp), 'the side sheet follows direct combat damage')
  t.ok(
    game.log.some((line) => String(line).includes('pegas')),
    'the direct exchange reaches the field log'
  )
})

test('el heroe y los NPCs no colapsan visualmente de cerca', (t) => {
  const game = new Runa({ presence: false })
  startGame(game, 'tester')
  const alma = MAPS.city.npcs.find((n) => n.id === 'alma')
  for (let dx of [1, 2, 3, -1, -2, -3]) {
    game.walker.placeAt('city', alma.x + dx, alma.y)
    const screen = style.stripAnsi(game.view())
    t.ok(screen.includes('/T\\') || screen.includes('\\T-'), 'heroe presente (dx ' + dx + ')')
    t.ok(screen.includes('.+.'), 'alma top presente (dx ' + dx + ')')
    t.ok(screen.match(/\(o[\\., ]o\)/), 'alma cara presente (dx ' + dx + ')')
    t.ok(screen.includes('/[+]\\'), 'alma torso presente (dx ' + dx + ')')
  }
  t.end()
})

test('t returns from the field to the city outside combat', (t) => {
  const game = new Runa({ presence: false })
  startGame(game)

  let gate = null
  for (let y = 0; y < MAPS.city.rows.length && gate === null; y++) {
    for (let x = 0; x < MAPS.city.rows[y].length; x++) {
      const tile = TILES[MAPS.city.rows[y][x]]
      if (tile && tile.enter && tile.enter.to === 'field') {
        gate = { x, y }
        break
      }
    }
  }

  game.walker.placeAt('city', gate.x, gate.y)
  press(game, 'e')
  t.ok(game.field, 'the player is in the field')
  const fieldScreen = style.stripAnsi(game.view())
  t.ok(fieldScreen.includes('t volver a la ciudad'))
  t.ok(fieldScreen.includes('[I INVENTARIO]'), 'the meadow also exposes the inventory button')

  press(game, 't')
  t.absent(game.field, 't closes the excursion')
  t.is(game.walker.mapId, 'city')
  t.ok(game.log.includes('volves a la ciudad'))
})

test('mapScreen renders sidebar (ficha and log) between 64 and 90 columns', (t) => {
  for (const width of [64, 72, 80, 90, 91, 100]) {
    const screen = style.stripAnsi(
      render.mapScreen({
        width,
        height: 20,
        map: { tiles: MAPS.city.rows, hero: { x: 26, y: 130 } },
        stats: { name: 'Tomas', level: 1, hp: 10, maxhp: 10, gold: 5 },
        log: ['hermana Alma te cura']
      })
    )
    t.ok(
      screen.includes('ficha') && screen.includes('log'),
      `sidebar panels (ficha and log) render at width ${width}`
    )
    t.ok(screen.includes('hermana Alma te cura'), `log message is visible at width ${width}`)
  }

  const explicitNoSidebar = style.stripAnsi(
    render.mapScreen({
      width: 80,
      height: 20,
      sidebar: false,
      map: { tiles: MAPS.city.rows, hero: { x: 26, y: 130 } },
      stats: { name: 'Tomas', level: 1, hp: 10, maxhp: 10, gold: 5 },
      log: ['hermana Alma te cura']
    })
  )
  t.ok(
    !explicitNoSidebar.includes('ficha') && !explicitNoSidebar.includes('log'),
    'explicit sidebar: false drops the sidebar'
  )
  t.ok(
    explicitNoSidebar.includes('hp 10/10'),
    'explicit sidebar: false shows compact stats in subtitle'
  )
})

test('the world boss animates powers with real field damage', (t) => {
  const distant = new WorldBossEvent({ width: 120, height: 36 })
  const tooFar = distant.strike({ x: 2, y: 18 }, { damage: 4, reach: 2 }, 0)
  t.is(tooFar[0].type, 'boss-miss')
  t.is(distant.active, false, 'pressing f at the gate cannot wake a distant boss')

  const boss = new WorldBossEvent({ width: 120, height: 36 })
  const player = { x: boss.x - 20, y: boss.y, hp: 20 }

  const awake = boss.activate(0)
  t.is(awake[0].type, 'boss-awake', 'approaching wakes one persistent boss')

  const onda = WORLD_BOSS.phases[0].attacks.find((attack) => attack.id === 'onda')
  boss.release(onda, player, 1)
  t.is(boss.hazards.length, 8, 'the runic wave leaves in eight visible directions')
  t.ok(boss.hazards.every((hazard) => hazard.glyph === '~'))

  const hazard = boss.hazards[0]
  player.x = hazard.x
  player.y = hazard.y
  const hit = boss.touch(player, 2)
  t.is(hit[0].type, 'boss-hit')
  t.is(hit[0].damage, 6)
  t.is(player.hp, 14, 'touching the visible wave removes real life')
  t.ok(!boss.hazards.some((candidate) => candidate.id === hazard.id), 'the hit is consumed once')

  const frames = WORLD_BOSS.fieldSprite.frames
  t.ok(Object.keys(frames).includes('slamImpact'), 'the ground strike has an impact pose')
  t.ok(Object.keys(frames).includes('idlePulse'), 'the face and rune pulse while awake')
  t.ok(
    Object.values(frames).every(
      (frame) =>
        frame.length === WORLD_BOSS.fieldSprite.height &&
        frame.every((line) => line.length === WORLD_BOSS.fieldSprite.width)
    ),
    'every moving pose keeps one stable terminal footprint'
  )

  const phaseFrames = WORLD_BOSS.fieldSprite.phaseFrames
  t.ok(
    Object.values(phaseFrames).every((family) =>
      Object.values(family).every(
        (frame) =>
          frame.length === WORLD_BOSS.fieldSprite.height &&
          frame.every((line) => line.length === WORLD_BOSS.fieldSprite.width)
      )
    ),
    'damage skins keep the same footprint in every pose and phase'
  )
  t.not(
    phaseFrames.despertar.idle.join('\n'),
    phaseFrames.fractura.idle.join('\n'),
    'the fractured phase visibly cracks the body'
  )
  t.ok(phaseFrames.furia.idle.join('\n').includes('***'), 'the final phase exposes a visible core')

  const aimed = new WorldBossEvent({ width: 120, height: 36 })
  const dodger = { x: aimed.x - 20, y: aimed.y + 3, hp: 20 }
  aimed.activate(0)
  aimed.nextAttackAt = 0
  const warning = aimed.tick(dodger, 1)
  const locked = { ...aimed.action.target }
  t.is(warning[0].type, 'boss-telegraph')
  t.ok(aimed.snapshot().telegraphs.length > 0, 'the locked trajectory is visible before release')
  t.is(dodger.hp, 20, 'warning cells never deal damage')

  dodger.y -= 8
  for (let time = 2; time < 30 && aimed.action; time++) aimed.tick(dodger, time)
  t.ok(aimed.hazards.length > 0, 'the warning eventually becomes a real power')
  t.is(aimed.hazards[0].y, locked.y, 'moving after the warning does not retarget the cast')
  t.is(aimed.snapshot().telegraphs.length, 0, 'the warning clears when the power launches')

  const warningPane = style.stripAnsi(
    render.fieldPane(
      {
        rows: Array(36).fill(' '.repeat(120)),
        width: 120,
        height: 36,
        player: { ...dodger, sprite: render.heroSprite() },
        foes: [],
        boss: {
          ...aimed.snapshot(),
          hp: 100,
          phase: 'furia',
          frame: 'idle',
          telegraphs: aimed.telegraph({ id: 'colapso', reach: 10 }, locked)
        }
      },
      90,
      25
    )
  )
  t.ok(warningPane.includes('/___/|.[*].[*].|\\___\\'), 'warnings never overwrite the face')
  t.ok(warningPane.includes('<***>'), 'warnings never overwrite the exposed core')

  const phased = new WorldBossEvent({ width: 120, height: 36 })
  const close = { x: phased.x - 12, y: phased.y, hp: 20 }
  phased.hp = 110
  const changed = phased.strike(close, { damage: 10, reach: 3 }, 0)
  t.ok(changed.some((event) => event.type === 'boss-phase' && event.phase === 'furia'))

  const repertoire = new WorldBossEvent({ width: 120, height: 36 })
  repertoire.hp = 100
  const attacks = new Set()
  for (let turn = 0; turn < 5; turn++) {
    repertoire.startAttack(close, turn, [])
    attacks.add(repertoire.action.attack.id)
    repertoire.action = null
  }
  t.ok(attacks.has('punio_izquierdo'), 'the final phase preserves learned attacks')
  t.ok(attacks.has('colapso'), 'the final phase also adds its new attack')

  const field = new BossZone({ seed: 17 })
  field.player.x = field.boss.x - 23
  field.player.y = field.boss.y
  field.boss.activate(0)
  const snap = field.snapshot()
  const pane = style.stripAnsi(
    render.fieldPane(
      {
        rows: field.render(64, 25, false),
        mode: snap.mode,
        width: snap.width,
        height: snap.height,
        player: { ...snap.player, sprite: render.heroSprite() },
        foes: [],
        boss: snap.boss
      },
      64,
      25
    )
  )
  t.ok(pane.includes('[###]---\\_'), 'the camera keeps the complete left arm')
  t.ok(pane.includes('_/---[###]'), 'the camera keeps the complete right arm')
  t.ok(pane.includes('/T\\'), 'the hero remains visible while dodging')
  t.ok(
    pane.split('\n').every((line) => line.length === 64),
    'boss animation cannot widen a terminal row'
  )

  const game = new Runa({ presence: false })
  startGame(game)
  game.field = new BossZone({ player: game.player })
  game.field.player.x = game.field.boss.x - 12
  game.field.player.y = game.field.boss.y
  const bossHp = game.field.boss.hp
  press(game, 'f')
  t.ok(game.field.boss.hp < bossHp, 'f damages the boss without freezing movement')
  t.absent(game.field.combat, 'world boss attacks do not open the rigid duel combat state')

  const life = game.player.hp
  game.field.boss.spawnHazard('wave', -1, 0, 6, '~', game.field.time, 10, 3)
  const incoming = game.field.boss.hazards[game.field.boss.hazards.length - 1]
  game.field.player.x = incoming.x
  game.field.player.y = incoming.y
  game.drain(game.field.boss.touch(game.field.player, game.field.time + 20))
  t.is(game.player.hp, life - 6, 'field contact updates the persistent character sheet')
})
test('city gardens are open and accessible from spawn', (t) => {
  const city = MAPS.city
  const seen = new Set()
  const q = [[city.spawn.x, city.spawn.y]]
  while (q.length) {
    const [x, y] = q.pop()
    const k = x + ',' + y
    if (seen.has(k)) continue
    if ((TILES[city.rows[y][x]] || { solid: true }).solid) continue
    seen.add(k)
    if (x + 1 < city.width) q.push([x + 1, y])
    if (x - 1 >= 0) q.push([x - 1, y])
    if (y + 1 < city.height) q.push([x, y + 1])
    if (y - 1 >= 0) q.push([x, y - 1])
  }

  // Check interior points in garden 1 (x: 5, y: 5, w: 65, h: 43)
  t.ok(seen.has('6,6'), 'garden 1 top-left interior is reachable')
  t.ok(seen.has('68,46'), 'garden 1 bottom-right interior is reachable')

  // Check interior points in garden 2 (x: 250, y: 5, w: 65, h: 43)
  t.ok(seen.has('251,6'), 'garden 2 top-left interior is reachable')
  t.ok(seen.has('313,46'), 'garden 2 bottom-right interior is reachable')
})

test('the expanded meadow exposes a visible entrance to the crypt', (t) => {
  const field = new Field({ seed: 27 })
  t.ok(field.width >= 160, 'the meadow is substantially wider than before')
  t.ok(field.height >= 48, 'the meadow gained room in both axes')
  t.ok(
    field.noxGate.x - field.dungeonEntrance.x > KINGDOM_GATE_CLEARANCE.x + 10,
    'the crypt is in the southern interior, not beside NOX'
  )
  field.player.x = field.dungeonEntrance.x - 3
  field.player.y = field.dungeonEntrance.y
  const rows = field.render(48, 18, false)
  t.ok(
    rows.some((row) => row.includes('CRIPTA')),
    'the landmark names itself as a crypt'
  )
  t.ok(
    rows.some((row) => row.includes('(o o)')),
    'a skull guards the facade'
  )
  t.ok(
    rows.some((row) => row.includes('/X\\')),
    'the deep doorway remains readable'
  )
  t.ok(DUNGEON_ENTRANCE_ART.length >= 10, 'the entrance is a full building, not a tiny marker')
  t.ok(
    field.foes.every(
      (foe) =>
        Math.max(
          Math.abs(foe.x - field.dungeonEntrance.x),
          Math.abs(foe.y - field.dungeonEntrance.y)
        ) >= DUNGEON_CLEARANCE
    ),
    'the facade begins with a monster-free clearing'
  )

  field.player.x = field.dungeonEntrance.x - 1
  const events = field.walk(1, 0)
  t.ok(
    events.some((event) => event.type === 'dungeon-enter'),
    'walking into X enters it'
  )
})

test('the meadow has monumental kingdom gates on opposite map edges', (t) => {
  const meadow = new Field({ seed: 27 })
  t.is(meadow.gate.x, 0, 'the RUNA gate touches the western edge')
  t.is(meadow.noxGate.x, meadow.width - 1, 'the NOX gate touches the eastern edge')
  t.ok(meadow.noxGate.x - meadow.gate.x >= 150, 'the kingdoms occupy opposite ends')

  meadow.player.x = meadow.gate.x
  meadow.player.y = meadow.gate.y
  const runaRows = meadow.render(44, 18, false)
  t.ok(
    runaRows.some((row) => row.includes('REINO DE RUNA')),
    'the common realm names itself'
  )
  t.ok(
    runaRows.some((row) => row.includes('<==|#===')),
    'RUNA has a built gate, not one glyph'
  )

  meadow.player.x = meadow.noxGate.x
  meadow.player.y = meadow.noxGate.y
  const noxRows = meadow.render(44, 18, false)
  t.ok(
    noxRows.some((row) => row.includes('REINO DE NOX')),
    'the dark realm names itself'
  )
  t.ok(
    noxRows.some((row) => row.includes('#|==N')),
    'NOX has a built gate on the edge'
  )
  t.is(RUNA_GATE_ART.length, 13)
  t.is(NOX_GATE_ART.length, 13)

  const outsideGate = (foe, gate) =>
    Math.abs(foe.x - gate.x) >= KINGDOM_GATE_CLEARANCE.x ||
    Math.abs(foe.y - gate.y) >= KINGDOM_GATE_CLEARANCE.y
  t.ok(
    meadow.foes.every((foe) => outsideGate(foe, meadow.gate) && outsideGate(foe, meadow.noxGate)),
    'both monumental approaches remain free of monster spawns'
  )

  meadow.player.x = meadow.gate.x + 1
  meadow.player.y = meadow.gate.y
  const events = meadow.walk(-1, 0)
  t.ok(
    events.some((event) => event.type === 'town'),
    'walking through < returns to RUNA'
  )

  const game = new Runa({ presence: false })
  startGame(game, 'Ayla')
  game.field = new Field({ player: game.player, seed: 27 })
  game.field.player.x = game.field.noxGate.x - 1
  game.field.player.y = game.field.noxGate.y
  press(game, 'right')
  t.absent(game.field, 'walking through N closes the meadow excursion')
  t.is(game.walker.mapId, 'nox', 'the eastern gate enters the dark realm')
  t.ok(game.log.some((line) => line.includes('porton oriental')))
})

test('the yermo portal owns a separate volcanic world-boss map', (t) => {
  const meadow = new Field({ seed: 27 })
  t.absent(meadow.boss, 'the Colossus was removed from the open meadow')
  t.ok(
    meadow.noxGate.x - meadow.worldBossPortal.x > KINGDOM_GATE_CLEARANCE.x + 10,
    'the portal is separated from the NOX border'
  )
  t.ok(
    Math.abs(meadow.worldBossPortal.x - meadow.dungeonEntrance.x) >= 20,
    'portal and crypt occupy distinct sectors'
  )
  meadow.player.x = meadow.worldBossPortal.x - 5
  meadow.player.y = meadow.worldBossPortal.y
  const portalRows = meadow.render(48, 18, false)
  t.ok(
    portalRows.some((row) => row.includes('~~O~~')),
    'the northern yermo portal has a visible energy core'
  )
  t.ok(
    portalRows.some((row) => row.includes('portal-del-coloso')),
    'the landmark names itself'
  )
  t.ok(
    portalRows.some((row) => row.includes('/#####')),
    'two ruined pylons give the entrance a monumental silhouette'
  )
  t.is(WORLD_BOSS_PORTAL_ART.length, 13, 'the portal is a full facade instead of a tiny marker')
  const restingPortal = portalRows.join('\n')
  meadow.time = WORLD_BOSS_PORTAL_CADENCE
  t.not(meadow.render(48, 18, false).join('\n'), restingPortal, 'the portal energy visibly pulses')
  t.ok(
    meadow.foes.every(
      (foe) =>
        Math.max(
          Math.abs(foe.x - meadow.worldBossPortal.x),
          Math.abs(foe.y - meadow.worldBossPortal.y)
        ) >= WORLD_BOSS_PORTAL_CLEARANCE
    ),
    'the monument begins inside a monster-free clearing'
  )
  meadow.player.x = meadow.worldBossPortal.x - 1
  let events = meadow.walk(1, 0)
  t.ok(
    events.some((event) => event.type === 'boss-enter'),
    'walking into O opens the boss zone'
  )

  const zone = new BossZone({ seed: 27 })
  t.is(zone.mode, 'boss')
  t.is(zone.width, BOSS_ZONE.width)
  t.ok(
    zone.layout.rows.some((row) => row.includes('~~~~')),
    'lava rivers cross the arena'
  )
  t.ok(
    zone.layout.rows.some((row) => row.includes('+---')),
    'broken buildings remain standing'
  )
  t.ok(zone.boss && !zone.boss.defeated, 'the world boss exists only inside this map')

  const target = { x: zone.boss.x - 12, y: zone.boss.y }
  const queue = [[zone.portal.x + 3, zone.portal.y]]
  const seen = new Set()
  while (queue.length) {
    const [x, y] = queue.shift()
    const key_ = `${x},${y}`
    if (seen.has(key_) || !zone.isWalkable(x, y) || zone.boss.occupies(x, y)) continue
    seen.add(key_)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      queue.push([x + dx, y + dy])
    }
  }
  t.ok(seen.has(`${target.x},${target.y}`), 'stone bridges provide a route to the Colossus')

  zone.player.x = zone.portal.x + 1
  zone.player.y = zone.portal.y
  events = zone.walk(-1, 0)
  t.ok(
    events.some((event) => event.type === 'boss-exit'),
    'O also returns to the yermo'
  )
})

test('Runa travels through the world-boss portal and preserves its state', (t) => {
  const game = new Runa({ presence: false })
  startGame(game)
  game.field = new Field({ player: game.player, seed: game.fieldSeed() })
  game.field.player.x = game.field.worldBossPortal.x - 1
  game.field.player.y = game.field.worldBossPortal.y
  press(game, 'right')
  t.is(game.field.mode, 'boss')
  t.is(game.saveState().location.kind, 'boss')

  game.field.boss.hp -= 17
  const damagedHp = game.field.boss.hp
  t.is(game.saveState().location.state.hp, damagedHp, 'boss life enters autosave state')
  press(game, 't')
  t.is(game.field.mode, 'boss', 'T cannot bypass the return portal')
  game.field.player.x = game.field.portal.x + 1
  game.field.player.y = game.field.portal.y
  press(game, 'left')
  t.is(game.field.mode, 'field')
  t.ok(
    game.field.player.x < game.field.worldBossPortal.x,
    'the hero returns outside the yermo portal'
  )
  t.ok(
    Math.max(
      Math.abs(game.field.player.x - game.field.worldBossPortal.x),
      Math.abs(game.field.player.y - game.field.worldBossPortal.y)
    ) < WORLD_BOSS_PORTAL_CLEARANCE,
    'the return point remains inside the monster-free portal clearing'
  )
  game.field.player.x = game.field.worldBossPortal.x - 1
  game.field.player.y = game.field.worldBossPortal.y
  press(game, 'right')
  t.is(game.field.boss.hp, damagedHp, 'leaving and re-entering cannot reset the boss fight')
})

test('the crypt progresses through three cleared monster floors', (t) => {
  const state = {}
  const first = new Dungeon({ floor: 1, seed: 9, state })
  t.is(first.mode, 'dungeon')
  t.is(first.floor, 1)
  t.is(first.foes.length, FLOOR_ROSTERS[1].length)
  t.ok(
    first.foes.some((foe) => foe.kind === 'slime'),
    'slimes occupy the opening floor'
  )
  t.ok(
    first.foes.some((foe) => foe.kind === 'skeleton'),
    'skeletons follow the slimes'
  )
  t.ok(
    first.render(56, 20, false).some((row) => row.includes('^')),
    'the up stair is visible'
  )

  first.player.x = first.layout.down.x - 1
  first.player.y = first.layout.down.y
  let events = first.walk(1, 0)
  t.ok(
    events.some((event) => event.type === 'dungeon-locked'),
    'living monsters seal the descent'
  )
  for (const foe of first.foes) foe.dead = true
  first.player.x = first.layout.down.x - 1
  events = first.walk(1, 0)
  t.ok(
    events.some((event) => event.type === 'dungeon-floor' && event.floor === 2),
    'clearing level 1 opens level 2'
  )

  const second = new Dungeon({ floor: 2, seed: 9, state: first.state })
  t.ok(
    second.foes.some((foe) => foe.kind === 'skeleton_knight'),
    'level 2 adds skeleton knights'
  )
  t.ok(
    second.foes.some((foe) => foe.kind === 'skeleton_archer'),
    'level 2 adds skeleton archers'
  )

  const third = new Dungeon({ floor: DUNGEON.floors, seed: 9, state: second.state })
  t.ok(
    third.foes.some((foe) => foe.kind === 'skeleton_elite'),
    'level 3 adds elite skeletons'
  )
  t.is(
    third.foes.filter((foe) => foe.kind === 'skeleton_king').length,
    1,
    'one skeleton king waits in the final throne room'
  )
  t.absent(third.layout.down, 'there is no invented fourth floor')
})

test('every dungeon floor has a sourced identity and a traversable authored route', (t) => {
  const layouts = [1, 2, 3].map((floor) => floorRows(floor))
  const blocked = new Set(['#', '|', '-', '=', '[', ']', '~', '%', 'o', '+'])
  const stairWindow = (layout, point) =>
    layout.rows
      .slice(Math.max(0, point.y - 5), Math.min(layout.rows.length, point.y + 6))
      .map((row) => row.slice(Math.max(0, point.x - 10), point.x + 11))
      .join('\n')
  const reachable = (layout) => {
    const queue = [layout.up]
    const visited = new Set([`${layout.up.x},${layout.up.y}`])
    while (queue.length) {
      const point = queue.shift()
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const x = point.x + dx
        const y = point.y + dy
        const key = `${x},${y}`
        const ch = layout.rows[y] && layout.rows[y][x]
        if (!ch || blocked.has(ch) || visited.has(key)) continue
        visited.add(key)
        queue.push({ x, y })
      }
    }
    return visited
  }

  t.alike(
    layouts.map((layout) => layout.name),
    ['cisternas del limo', 'galerias del osario', 'necropolis de la corona'],
    'each descent has its own architectural identity'
  )
  t.unlike(layouts[0].rows, layouts[1].rows, 'the cistern and ossuary are distinct plans')
  t.unlike(layouts[1].rows, layouts[2].rows, 'the ossuary and necropolis are distinct plans')
  t.ok(
    layouts[0].rows.some((row) => row.includes('~')),
    'the cistern has flooded reservoirs'
  )
  t.ok(
    layouts[0].rows.some((row) => row.includes(':')),
    'the cistern has stone bridges'
  )
  t.ok(
    layouts[1].rows.some((row) => row.includes('%o')),
    'the ossuary has bone courses'
  )
  t.ok(
    layouts[1].rows.some((row) => row.includes('*')),
    'the ossuary has a sepulchral lamp'
  )
  t.ok(
    layouts[2].rows.some((row) => row.includes('[=T=]')),
    'the royal floor has a throne'
  )
  t.ok(layouts[2].throne, 'the necropolis records its ceremonial destination')

  for (const layout of layouts) {
    const visited = reachable(layout)
    const destination = layout.down || layout.spawnPoints[layout.spawnPoints.length - 1]
    const upArt = stairWindow(layout, layout.up)
    t.ok(upArt.includes('/___^___/'), `${layout.name} draws a complete ascent in ASCII`)
    t.ok(
      (upArt.match(/_{3,}/g) || []).length >= 4,
      `${layout.name} gives the ascent several visible steps`
    )
    if (layout.down) {
      const downArt = stairWindow(layout, layout.down)
      t.ok(downArt.includes('___v___'), `${layout.name} draws a complete descent in ASCII`)
      t.ok(
        (downArt.match(/_{3,}/g) || []).length >= 4,
        `${layout.name} gives the descent several visible steps`
      )
    }
    t.ok(
      visited.has(`${destination.x},${destination.y}`),
      `${layout.name} connects its entrance to its destination`
    )
    t.ok(
      layout.spawnPoints.every((point) => visited.has(`${point.x},${point.y}`)),
      `${layout.name} keeps every encounter on the playable route`
    )
  }
})

test('Runa enters, saves and exits the meadow dungeon as one run', (t) => {
  const game = new Runa({ presence: false })
  startGame(game)
  game.field = new Field({ player: game.player, seed: game.fieldSeed() })
  game.field.player.x = game.field.dungeonEntrance.x - 1
  game.field.player.y = game.field.dungeonEntrance.y
  press(game, 'right')
  t.is(game.field.mode, 'dungeon')
  t.is(game.field.floor, 1)
  t.is(game.saveState().location.kind, 'dungeon', 'autosave records the active dungeon floor')

  press(game, 't')
  t.is(game.field.mode, 'dungeon', 'T cannot bypass dungeon progression')
  game.field.player.x = game.field.layout.up.x + 1
  game.field.player.y = game.field.layout.up.y
  press(game, 'left')
  t.is(game.field.mode, 'field', 'the up stair on level 1 returns to the meadow')
  t.ok(
    game.field.player.x < game.field.dungeonEntrance.x,
    'the hero reappears safely outside instead of re-entering immediately'
  )
})

test('dungeon victories persist, including the skeleton king', (t) => {
  const first = new Dungeon({ floor: 1, seed: 31 })
  const slime = first.foes.find((foe) => foe.kind === 'slime')
  const events = []
  first.startFight(slime, 1, events)
  first.combat.world.over = 'ganaste'
  first.endFight(events)
  t.ok(first.state.defeated[1].includes(String(slime.id)), 'a defeated slime enters run state')
  t.ok(events.some((event) => event.type === 'win' && event.kind === 'slime'))

  const reopened = new Dungeon({ floor: 1, seed: 31, state: first.toJSON() })
  t.ok(
    reopened.foes.find((foe) => foe.id === slime.id).dead,
    'returning to a floor does not resurrect its defeated monsters'
  )

  const final = new Dungeon({ floor: 3, seed: 31, state: reopened.toJSON() })
  const king = final.foes.find((foe) => foe.kind === 'skeleton_king')
  const finale = []
  final.startFight(king, 1, finale)
  final.combat.world.over = 'ganaste'
  final.endFight(finale)
  t.ok(final.state.kingDefeated, 'the final victory is recorded')
  t.ok(finale.some((event) => event.type === 'dungeon-complete'))
})

test('a save slot restores the current dungeon floor and defeated monsters', (t) => {
  const dir = path.join(
    os.tmpdir(),
    `runa-dungeon-save-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  )
  const saves = new SaveStore(dir)
  try {
    const game = new Runa({ presence: false, saves })
    startGame(game, 'Cripta')
    game.meadowReturn = { x: 149, y: 43 }
    game.openDungeonFloor(2)
    game.field.foes[0].dead = true
    game.field.state.defeated[2].push(String(game.field.foes[0].id))
    game.field.player.x = 44
    game.field.player.y = 18
    game.saveCurrent()

    const loaded = new Runa({ presence: false, saves })
    t.ok(loaded.loadSlot(1))
    t.is(loaded.field.mode, 'dungeon')
    t.is(loaded.field.floor, 2)
    t.is(loaded.field.player.x, 44)
    t.is(loaded.field.player.y, 18)
    t.ok(loaded.field.foes[0].dead, 'the cleared enemy stays dead after loading')
  } finally {
    removeSaveFixture(dir)
  }
})
