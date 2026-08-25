const { test } = require('brittle')
const { style } = require('bare-tui')
const fs = require('bare-fs')
const os = require('bare-os')
const path = require('bare-path')
const { Runa, COMBAT_TURN_TICKS } = require('../lib/game.js')
const { MAPS, TILES, NPC_MASTER_SPRITES, NPC_SPRITES } = require('../lib/map.js')
const { Field } = require('../lib/field.js')
const { Player, reward, xpToLeave, SAVE_VERSION } = require('../lib/shop.js')
const { SaveStore } = require('../lib/saves.js')
const { World } = require('../lib/world.js')
const {
  BEGIN_SYNCHRONIZED_UPDATE,
  END_SYNCHRONIZED_UPDATE,
  synchronizeRenderer
} = require('../lib/synchronized-renderer.js')
const render = require('../lib/render.js')

require('./sage.test.js')
require('./open-city-gardens.test.js')

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
  t.ok(screen.includes('hp 20/20'), 'compact stats remain visible in the title bar')
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
  const player = new Player({ gold: 500, xp: xpToLeave(1) })
  player.buy('sword', 'weapons')
  player.buy('shield', 'armor')
  t.alike(player.snapshot().equipped, { left: 'sword', right: 'shield' })

  player.buy('crossbow', 'weapons')
  t.is(player.snapshot().equipped.left, 'crossbow', 'a new weapon replaces the same slot')
  t.ok(player.owns('sword'), 'replaced gear stays in the inventory')

  const loaded = Player.fromJSON(JSON.stringify(player))
  t.is(loaded.toJSON().version, SAVE_VERSION)
  t.alike(loaded.snapshot().equipped, player.snapshot().equipped, 'the loadout survives a save')

  const oldSave = Player.fromJSON({
    version: 1,
    gold: 30,
    xp: 0,
    hp: 20,
    potions: 2,
    items: ['shield']
  })
  t.alike(oldSave.snapshot().equipped, { left: null, right: null }, 'old saves invent no gear')

  const world = new World('mosquito')
  loaded.outfit(world)
  world.foe.x = 1
  const hp = world.hero.hp
  world.step()
  t.is(world.held.right.id, 'shield', 'combat starts with the persistent armour equipped')
  t.is(world.hero.hp, hp - 3, 'the shield reduces a mosquito hit from 5 to 3')

  loaded.unequip('shield')
  t.is(loaded.snapshot().equipped.right, null, 'gear can be removed without selling it')
  t.ok(loaded.owns('shield'))
})

test('the shop lets the player equip and remove owned gear', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  game.width = 100
  game.height = 30
  game.player.gold = 100
  game.shop = 'weapons'

  press(game, 'enter')
  t.is(game.player.snapshot().equipped.left, 'sword', 'buying equipment puts it in its slot')
  t.ok(style.stripAnsi(game.view()).includes('equipado'), 'the shop marks the active item')

  press(game, 'x')
  t.is(game.player.snapshot().equipped.left, null, 'x removes the selected item')
  t.ok(game.player.owns('sword'), 'removing equipment does not sell it')

  press(game, 'enter')
  t.is(game.player.snapshot().equipped.left, 'sword', 'enter equips an item already owned')
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

  const gate = MAPS.city.fieldGate
  game.walker.placeAt('city', gate.x1, gate.y1 - 1)
  press(game, 'down')
  t.ok(game.field, 'touching the broad porton area enters the field before collision')
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
  t.is(city.npcs.length, 9, 'the city has nine static residents')
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

test('the castle dungeon entrance descends and returns to the same district', (t) => {
  const game = new Runa({ presence: false })
  game.title = false
  const locate = (map, glyph) => {
    for (let y = 0; y < map.height; y++) {
      const x = map.rows[y].indexOf(glyph)
      if (x !== -1) return { x, y }
    }
    return null
  }

  const entrance = locate(MAPS.city, 'V')
  t.ok(entrance, 'the castle has a visible dungeon stair')
  game.walker.placeAt('city', entrance.x, entrance.y)
  press(game, 'e')
  t.is(game.walker.mapId, 'dungeon', 'V descends into the ruins')
  t.ok(style.stripAnsi(game.view()).includes('las ruinas bajo el castillo'))

  const exit = locate(MAPS.dungeon, 'U')
  game.walker.placeAt('dungeon', exit.x, exit.y)
  press(game, 'e')
  t.is(game.walker.mapId, 'city', 'U climbs back into the city')
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

  // The script equips at fight time, so mid fight the sheet has to follow the
  // world rather than the persistent record. Both rows used to read `-` here
  // while the arena printed `alcance 14` right beside them.
  //
  // Equipping costs a few ticks: the rules are re-read every tick and a swap
  // only lands between swings, so at the instant the fight opens both hands
  // are still empty. Waiting for the hand to fill is the point of the test,
  // not an accident of timing.
  for (let i = 0; i < 60; i++) {
    const c = game.field.combat
    if (!c || c.world.held.left || c.world.held.right) break
    press(game, 'f')
  }
  t.ok(game.field.combat, 'the fight is still running')
  const held = game.field.combat.world.held
  t.ok(held.left || held.right, 'the script put something in a hand')

  const fight = style.stripAnsi(game.view())
  const wielded = held.left || held.right
  t.ok(fight.indexOf(wielded.name) !== -1, 'the sheet names the weapon actually in hand')
  t.is(game.sheet().left, held.left, 'the left row is the world truth, not a stale copy')
  t.is(game.sheet().right, held.right, 'and so is the right row')
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
  t.ok(style.stripAnsi(game.view()).includes('t volver a la ciudad'))

  press(game, 't')
  t.absent(game.field, 't closes the excursion')
  t.is(game.walker.mapId, 'city')
  t.ok(game.log.includes('volves a la ciudad'))
})
