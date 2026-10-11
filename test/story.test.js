const { test } = require('brittle')
const { style } = require('bare-tui')
const fs = require('bare-fs')
const os = require('bare-os')
const path = require('bare-path')
const { Runa } = require('../lib/game.js')
const { MAPS } = require('../lib/map.js')
const { Field, BARBARIAN_SETTLEMENTS } = require('../lib/field.js')
const { campFoeId, standingBarbarians } = require('../lib/barbarian-camp.js')
const { BossZone } = require('../lib/boss-zone.js')
const { World } = require('../lib/world.js')
const { WORLD_BOSS } = require('../lib/world-boss.js')
const { SaveStore } = require('../lib/saves.js')
const { withLanguage, t: translate } = require('../lib/locale.js')
const {
  QUESTS,
  STORY,
  STORY_START,
  STORY_HINT,
  questState,
  questText
} = require('../lib/quests.js')
const estado = require('../scripts/tripo-estado.js')

const TRIAL = QUESTS.king_trial
const RAID = QUESTS.barbarian_raid
const COLOSSUS = QUESTS.colossus_awakening
const KNIGHT = QUESTS.mosquito_hunt
const KING = MAPS.castle.npcs.find((npc) => npc.id === 'aldren')
const CEDRIC = MAPS.city.npcs.find((npc) => npc.id === 'cedric')

function press(game, name) {
  return game.onKey({ type: 'key', is: (...keys) => keys.includes(name) })
}

function startGame(game, name = 'Ada') {
  press(game, 'enter')
  for (const sequence of name) {
    game.onKey({ type: 'key', sequence, ctrl: false, meta: false, is: () => false })
  }
  press(game, 'enter')
}

function talkTo(game, npc, mapId) {
  game.field = null
  game.walker.placeAt(mapId, npc.x, npc.y + 1)
  press(game, 'e')
}

const talkToKing = (game) => talkTo(game, KING, 'castle')
const talkToKnight = (game) => talkTo(game, CEDRIC, 'city')

// The end of a won fight exactly as syncCombat settles it. The hero stays
// where they stood, so a camp keeps its own state.
function winFight(game, kind) {
  const field = game.field
  const world = new World(kind)
  world.over = 'ganaste'
  game.field = { combat: null }
  game.pending = world
  game.earned = { kind }
  game.syncCombat(true)
  game.field = field
}

function finishChapter(game, kind, count) {
  for (let kill = 0; kill < count; kill++) winFight(game, kind)
  talkToKing(game)
}

// What the browser page shows: it keeps the last four lines of the log.
const pageLog = (game) => game.log.slice(-4)

// The first camp of the frontier, entered on foot through its gate.
function enterCamp(game) {
  game.field = new Field({ player: game.player, seed: game.fieldSeed() })
  const settlement = game.field.settlements[0]
  game.field.player.x = settlement.x - 1
  game.field.player.y = settlement.y
  game.move(1, 0)
}

// A real fight inside the camp: walk into a standing raider and win it.
function slayRaider(game) {
  const raider = game.field.foes.find((foe) => foe.kind === RAID.target && !foe.dead)
  game.field.player.x = raider.x - 1
  game.field.player.y = raider.y
  game.move(1, 0)
  if (!game.field.combat) return false
  game.field.combat.world.over = 'ganaste'
  game.advanceCombat()
  return raider.dead
}

// Out through the U gate, which writes the camp back into the frontier.
function leaveCamp(game) {
  const exit = game.field.layout.exit
  game.field.player.x = exit.x
  game.field.player.y = exit.y - 1
  game.move(0, 1)
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

test('the story is one chain handed out by King Aldren', (t) => {
  t.alike(STORY, ['king_trial', 'barbarian_raid', 'colossus_awakening'])
  t.is(STORY[0], STORY_START)
  t.alike(KING.action, { kind: 'quest', quest: STORY_START }, 'the king starts the chain')
  STORY.forEach((id, index) => {
    t.is(QUESTS[id].giver, 'aldren', `${id} comes from the king`)
    t.is(
      QUESTS[id].after,
      index === 0 ? null : STORY[index - 1],
      `${id} follows the chapter before`
    )
  })
  t.is(COLOSSUS.target, WORLD_BOSS.id, 'the last chapter counts hits on the world boss')
  t.ok(
    standingBarbarians(RAID.target) >= RAID.count,
    'a fresh frontier holds enough raiders for the barbarian chapter'
  )
  t.alike(CEDRIC.action, { kind: 'quest', quest: KNIGHT.id }, 'the knight keeps his own hunt')
})

test('King Aldren hands out each chapter, tracks it and pays it once', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 100, height: 32 })
  startGame(game)
  t.ok(game.log.includes(STORY_HINT), 'a hero born in RUNA is sent to the throne')
  t.is(game.storySummary().status, 'available', 'the story waits for the king')
  t.is(game.sheet().story, null, 'no story row until the king speaks')

  talkToKing(game)
  t.alike(game.quests.king_trial, { status: 'active', progress: 0 }, 'the king hands out a mission')
  t.ok(game.log.includes('Aldren: prueba tu valor en la pradera'))
  t.ok(game.log.includes('mision aceptada: elimina 3 mosquitos (0/3)'))
  t.is(game.quests.mosquito_hunt.status, 'available', 'the knight hunt does not start with it')

  winFight(game, 'golem')
  t.is(game.quests.king_trial.progress, 0, 'only the asked foe counts')
  winFight(game, 'mosquito')
  t.is(game.quests.king_trial.progress, 1, 'a mosquito kill advances the trial')
  t.ok(game.log.includes('mision la prueba del rey: 1/3'))
  t.ok(style.stripAnsi(game.view()).includes('rey: mosquitos'), 'the sheet tracks the chapter')

  const unpaid = game.player.gold
  talkToKing(game)
  t.ok(game.log.includes('Aldren: llevas 1/3 mosquitos'), 'talking again shows the progress')
  t.is(game.player.gold, unpaid, 'an unfinished chapter pays nothing')

  winFight(game, 'mosquito')
  winFight(game, 'mosquito')
  t.ok(game.log.includes('mision lista: vuelve con el rey Aldren (3/3)'))
  t.is(game.storySummary().status, 'ready')
  t.ok(style.stripAnsi(game.view()).includes('rey: vuelve con Aldren'))

  const gold = game.player.gold
  const xp = game.player.xp
  game.log.length = 0
  talkToKing(game)
  t.is(game.quests.king_trial.status, 'completed')
  t.is(game.player.gold, gold + TRIAL.reward.gold, 'the reward goes through the player purse')
  t.is(game.player.xp, xp + TRIAL.reward.xp)
  t.ok(game.log.includes('mision completada: +20 oro, +20 exp'))
  t.alike(game.quests.barbarian_raid, { status: 'active', progress: 0 }, 'the next chapter unlocks')
  t.ok(game.log.includes('Aldren: los barbaros saquean el este'))
  t.ok(game.log.includes('mision aceptada: derrota 2 saqueadores (0/2)'))
  t.ok(
    pageLog(game).includes('mision completada: +20 oro, +20 exp'),
    'the reward is still on the page once the next chapter is handed out'
  )
  t.is(game.storySummary().chapter, 2)

  const paid = game.player.gold
  talkToKing(game)
  t.is(game.player.gold, paid, 'the finished chapter cannot be claimed twice')
  t.is(game.quests.king_trial.status, 'completed')
})

test('raiders killed in a real barbarian camp count for the second chapter', (t) => {
  const game = new Runa({ presence: false })
  startGame(game)
  talkToKing(game)
  const standing = standingBarbarians(RAID.target, game.barbarianState)

  // A raid during the first chapter is not owed to the second one while the
  // frontier still holds the raiders it asks for.
  enterCamp(game)
  t.is(game.field.mode, 'barbarian-camp', 'the camp is entered on foot through its gate')
  t.ok(slayRaider(game), 'walking into a raider starts a real fight')
  t.is(game.quests.barbarian_raid.status, 'available')
  leaveCamp(game)
  t.is(game.field.mode, 'field', 'U leads back to the meadow')
  t.is(
    standingBarbarians(RAID.target, game.barbarianState),
    standing - 1,
    'the camp keeps its dead'
  )
  finishChapter(game, 'mosquito', TRIAL.count)
  t.alike(
    game.quests.barbarian_raid,
    { status: 'active', progress: 0 },
    'a raider killed before the chapter does not count'
  )
  t.ok(game.log.includes('mision aceptada: derrota 2 saqueadores (0/2)'))

  enterCamp(game)
  t.ok(slayRaider(game))
  t.absent(game.field.combat)
  t.is(game.quests.barbarian_raid.progress, 1, 'the camp kill reaches the quest')
  t.ok(game.log.includes('mision la horda barbara: 1/2'))

  winFight(game, 'barbarian_thrower')
  t.is(game.quests.barbarian_raid.progress, 1, 'other barbarians do not count')
  t.is(game.field.mode, 'barbarian-camp', 'the hero is still inside the camp')
  t.ok(slayRaider(game))
  t.ok(game.log.includes('mision lista: vuelve con el rey Aldren (2/2)'))
  leaveCamp(game)
  t.is(
    standingBarbarians(RAID.target, game.barbarianState),
    standing - 3,
    'leaving through U writes every raider killed inside into the frontier'
  )

  const gold = game.player.gold
  talkToKing(game)
  t.is(game.quests.barbarian_raid.status, 'completed')
  t.is(game.player.gold, gold + RAID.reward.gold)
  t.alike(game.quests.colossus_awakening, { status: 'active', progress: 0 })
})

test('a frontier raided before the chapter cannot block the story', (t) => {
  const cleared = new Runa({ presence: false })
  startGame(cleared)
  talkToKing(cleared)
  cleared.barbarianState = { cleared: BARBARIAN_SETTLEMENTS.map((camp) => camp.id), camps: {} }
  for (let kill = 0; kill < TRIAL.count; kill++) winFight(cleared, 'mosquito')
  const gold = cleared.player.gold
  cleared.log.length = 0
  talkToKing(cleared)
  t.is(cleared.quests.barbarian_raid.status, 'completed', 'no raiders left: paid on the spot')
  t.is(cleared.player.gold, gold + TRIAL.reward.gold + RAID.reward.gold)
  t.is(cleared.quests.colossus_awakening.status, 'active', 'and the story moves on')
  t.ok(
    pageLog(cleared).includes('mision completada: +80 oro, +80 exp'),
    'both chapters are paid in one line that stays on the page'
  )
  t.absent(
    cleared.log.includes('Aldren: los barbaros saquean el este'),
    'a chapter the hero already won is not announced'
  )
  t.ok(pageLog(cleared).includes('mision aceptada: asesta 3 golpes al Coloso (0/3)'))

  // Every raider down but one: the chapter only asks for the one left.
  const camps = {}
  let spared = false
  for (const camp of [...BARBARIAN_SETTLEMENTS].reverse()) {
    const defeated = []
    camp.roster.forEach((kind, index) => {
      if (kind !== RAID.target) return
      if (!spared) spared = true
      else defeated.push(campFoeId(camp.id, index))
    })
    camps[camp.id] = { campId: camp.id, defeated, completed: false }
  }
  const raided = new Runa({ presence: false })
  startGame(raided)
  raided.barbarianState = { cleared: [], camps }
  t.is(standingBarbarians(RAID.target, raided.barbarianState), 1)
  talkToKing(raided)
  finishChapter(raided, 'mosquito', TRIAL.count)
  t.alike(raided.quests.barbarian_raid, { status: 'active', progress: 1 })
  t.ok(raided.log.includes('mision aceptada: derrota 2 saqueadores (1/2)'))
})

test('the Colossus chapter counts real hits in the volcanic ruins', (t) => {
  const game = new Runa({ presence: false })
  startGame(game)
  talkToKing(game)
  finishChapter(game, 'mosquito', TRIAL.count)
  finishChapter(game, RAID.target, RAID.count)
  t.is(game.quests.colossus_awakening.status, 'active')
  t.ok(game.log.includes('Aldren: el Coloso despierta tras el portal del yermo'))

  game.field = new BossZone({ player: game.player })
  const boss = game.field.boss
  game.field.player.y = boss.y
  game.field.player.x = boss.x - 40
  press(game, 'f')
  t.ok(game.log.includes('el Coloso esta demasiado lejos'), 'f from afar misses')
  game.field.player.x = boss.x - 20
  press(game, 'f')
  t.ok(
    game.log.some((line) => line.startsWith('el Coloso esta fuera de alcance')),
    'and so does f out of reach'
  )
  t.is(game.quests.colossus_awakening.progress, 0, 'a missed f does not count')

  game.field.player.x = boss.x - 12
  press(game, 'f')
  t.is(game.quests.colossus_awakening.progress, 1, 'f lands a hit and the king counts it')
  t.ok(game.log.includes('mision el despertar del Coloso: 1/3'))
  press(game, 'f')
  press(game, 'f')
  t.is(game.quests.colossus_awakening.progress, 3)
  t.ok(game.log.includes('mision lista: vuelve con el rey Aldren (3/3)'))
  press(game, 'f')
  t.is(game.quests.colossus_awakening.progress, 3, 'progress stops at the goal')

  const gold = game.player.gold
  game.log.length = 0
  talkToKing(game)
  t.is(game.quests.colossus_awakening.status, 'completed')
  t.is(game.player.gold, gold + COLOSSUS.reward.gold)
  t.ok(game.log.includes(`Aldren: ${COLOSSUS.epilogue}`), 'the king closes the story')
  t.is(game.storySummary().status, 'done')
  t.is(game.sheet().story, null, 'a finished story leaves the sheet')

  game.log.length = 0
  talkToKing(game)
  t.alike(game.log.slice(-1), [`Aldren: ${COLOSSUS.epilogue}`], 'later visits repeat the epilogue')
  t.is(game.player.gold, gold + COLOSSUS.reward.gold, 'the epilogue pays nothing more')
})

test('a fallen Colossus completes its chapter instead of blocking it', (t) => {
  const short = new Runa({ presence: false })
  startGame(short)
  talkToKing(short)
  finishChapter(short, 'mosquito', TRIAL.count)
  finishChapter(short, RAID.target, RAID.count)
  short.field = new BossZone({ player: short.player })
  short.field.player.x = short.field.boss.x - 12
  short.field.player.y = short.field.boss.y
  press(short, 'f')
  short.field.boss.hp = 1
  press(short, 'f')
  t.ok(short.field.boss.defeated, 'the second hit fells it')
  t.is(short.quests.colossus_awakening.progress, 3, 'no hits are left, so the goal is met')
  t.ok(short.log.includes('mision lista: vuelve con el rey Aldren (3/3)'))

  const fallen = new Runa({ presence: false })
  startGame(fallen)
  fallen.worldBossState = { hp: 0, defeated: true }
  talkToKing(fallen)
  finishChapter(fallen, 'mosquito', TRIAL.count)
  for (let kill = 0; kill < RAID.count; kill++) winFight(fallen, RAID.target)
  const gold = fallen.player.gold
  fallen.log.length = 0
  talkToKing(fallen)
  t.is(fallen.quests.colossus_awakening.status, 'completed', 'beaten before the chapter: paid')
  t.is(fallen.player.gold, gold + RAID.reward.gold + COLOSSUS.reward.gold)
  t.ok(pageLog(fallen).includes('mision completada: +160 oro, +160 exp'))
  t.ok(pageLog(fallen).includes(`Aldren: ${COLOSSUS.epilogue}`))
})

test('the plaza knight hunt runs beside the story without sharing its state', (t) => {
  const game = new Runa({ presence: false })
  game.update({ type: 'resize', width: 100, height: 32 })
  startGame(game)
  talkToKnight(game)
  t.ok(game.log.includes('mision aceptada: elimina 20 mosquitos (0/20)'), 'his line is unchanged')
  talkToKing(game)
  winFight(game, 'mosquito')
  t.is(game.quests.mosquito_hunt.progress, 1, 'one mosquito counts for the knight')
  t.is(game.quests.king_trial.progress, 1, 'and for the king')
  const sheet = style.stripAnsi(game.view())
  t.ok(sheet.includes('rey: mosquitos'), 'the story row')
  t.ok(sheet.includes('mision mosquitos 1/20'), 'and the knight row, both on the sheet')

  finishChapter(game, 'mosquito', TRIAL.count - 1)
  t.is(game.quests.king_trial.status, 'completed')
  t.alike(game.quests.mosquito_hunt, { status: 'active', progress: 3 }, 'the king does not pay it')

  talkToKnight(game)
  t.ok(game.log.includes('sir Cedric: llevas 3/20 mosquitos'))
  for (let kill = 3; kill < KNIGHT.count; kill++) winFight(game, 'mosquito')
  t.ok(game.log.includes('mision lista: vuelve con el caballero de la plaza (20/20)'))
  t.alike(
    game.quests.barbarian_raid,
    { status: 'active', progress: 0 },
    'mosquitoes are not raiders'
  )
  const gold = game.player.gold
  talkToKnight(game)
  t.is(game.quests.mosquito_hunt.status, 'completed')
  t.is(game.player.gold, gold + KNIGHT.reward.gold)
  t.ok(game.log.includes('mision completada: +100 oro, +100 exp'))
  t.alike(game.quests.barbarian_raid, { status: 'active', progress: 0 }, 'the story is untouched')
  talkToKnight(game)
  t.ok(game.log.includes('sir Cedric: ya cumpliste la mision de los mosquitos'))
})

test('story progress survives a save slot and older saves start it fresh', (t) => {
  const dir = path.join(
    os.tmpdir(),
    `runa-story-save-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  )
  const saves = new SaveStore(dir)
  try {
    const game = new Runa({ presence: false, saves })
    startGame(game, 'Lia')
    talkToKing(game)
    finishChapter(game, 'mosquito', TRIAL.count)
    winFight(game, RAID.target)
    talkToKnight(game)
    t.ok(game.saveCurrent())

    const loaded = new Runa({ presence: false, saves })
    t.ok(loaded.loadSlot(1))
    t.alike(loaded.quests, game.quests, 'every quest comes back as it was')
    t.alike(loaded.storySummary(), game.storySummary(), 'the tracker shows the same chapter')
    t.alike(loaded.quests.barbarian_raid, { status: 'active', progress: 1 })
    t.absent(loaded.log.includes(STORY_HINT), 'a hero already in the story is not sent again')

    // A slot written before the story existed only knew the knight hunt.
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'slot-1.json'), 'utf8'))
    raw.quests = { mosquito_hunt: { status: 'active', progress: 7 } }
    fs.writeFileSync(path.join(dir, 'slot-2.json'), JSON.stringify(raw))
    delete raw.quests
    fs.writeFileSync(path.join(dir, 'slot-3.json'), JSON.stringify(raw))

    const old = new Runa({ presence: false, saves })
    t.ok(old.loadSlot(2), 'a save without story keys loads')
    t.alike(old.quests.mosquito_hunt, { status: 'active', progress: 7 }, 'the hunt is kept')
    for (const id of STORY) {
      t.alike(old.quests[id], { status: 'available', progress: 0 }, `${id} starts fresh`)
    }
    t.is(old.storySummary().chapter, 1)
    t.alike(
      old.log.slice(0, 2),
      ['partida 2 cargada. bienvenido otra vez, Lia.', STORY_HINT],
      'an older save learns that the king awaits, right after the welcome'
    )
    talkToKing(old)
    t.is(old.quests.king_trial.status, 'active', 'and the king can start it')

    const bare = new Runa({ presence: false, saves })
    t.ok(bare.loadSlot(3), 'a save without any quests loads too')
    t.is(bare.storySummary().status, 'available')
    t.ok(bare.log.includes(STORY_HINT))

    // NOX does not send its heroes to RUNA's throne on a load either.
    const nox = new Runa({
      presence: false,
      saves: { list: () => [], load: () => ({ ...raw, realm: 'nox' }) }
    })
    t.ok(nox.loadSlot(1))
    t.is(nox.realm, 'nox')
    t.is(nox.storySummary().status, 'available')
    t.absent(nox.log.includes(STORY_HINT), 'a hero of NOX is not sent to the king')
  } finally {
    removeSaveFixture(dir)
  }
})

test('quest state read from a save trusts nothing in it', (t) => {
  const fresh = questState()
  for (const quest of Object.values(QUESTS)) {
    t.alike(fresh[quest.id], { status: 'available', progress: 0 })
  }
  t.alike(questState(null), fresh)
  t.alike(questState({ king_trial: null, barbarian_raid: 'roto' }), fresh)
  const skipped = questState({
    king_trial: { status: 'active', progress: 99 },
    barbarian_raid: { status: 'completed' },
    colossus_awakening: { status: 'active', progress: 2 }
  })
  t.alike(skipped.king_trial, { status: 'active', progress: TRIAL.count }, 'progress is clamped')
  t.alike(skipped.barbarian_raid, { status: 'available', progress: 0 }, 'no skipping a chapter')
  t.alike(skipped.colossus_awakening, { status: 'available', progress: 0 })
})

test('the browser state exposes the story chapter for a tracker', (t) => {
  const game = new Runa({ presence: false })
  t.is(estado.live(game).story, null, 'nothing to track from the title screen')
  startGame(game)
  const giver = { id: 'aldren', name: KING.name, map: 'castle', x: KING.x, y: KING.y }
  t.alike(estado.live(game).story, {
    id: 'king_trial',
    chapter: 1,
    chapters: 3,
    title: 'la prueba del rey',
    label: 'mosquitos',
    status: 'available',
    progress: 0,
    count: 3,
    returnTo: 'el rey Aldren',
    giver
  })
  talkToKing(game)
  winFight(game, 'mosquito')
  const active = estado.live(game).story
  t.is(active.status, 'active')
  t.is(active.progress, 1)
  winFight(game, 'mosquito')
  winFight(game, 'mosquito')
  t.is(estado.live(game).story.status, 'ready')
  talkToKing(game)
  const second = estado.live(game).story
  t.is(second.id, 'barbarian_raid')
  t.is(second.chapter, 2)
  t.is(second.label, 'saqueadores')
  t.alike(second.giver, giver)
})

test('story lines are ASCII and read whole in English', (t) => {
  const en = (text) => withLanguage('en', () => translate(text))
  const cases = [
    [STORY_HINT, 'King Aldren awaits you in the castle'],
    [`Aldren: ${TRIAL.intro}`, 'Aldren: prove your worth in the meadow'],
    [questText.accepted(TRIAL), 'quest accepted: defeat 3 mosquitos (0/3)'],
    [questText.progress(TRIAL, 1, 'Aldren'), 'Aldren: so far 1/3 mosquitos'],
    [questText.note(TRIAL, 1), "quest the king's trial: 1/3"],
    [questText.ready(TRIAL), 'quest ready: return to King Aldren (3/3)'],
    [questText.reward(TRIAL.reward), 'quest complete: +20 gold, +20 exp'],
    [`Aldren: ${RAID.intro}`, 'Aldren: barbarians are raiding the east'],
    [questText.accepted(RAID, 1), 'quest accepted: defeat 2 raiders (1/2)'],
    [questText.progress(RAID, 1, 'Aldren'), 'Aldren: so far 1/2 raiders'],
    [questText.note(RAID, 1), 'quest the barbarian horde: 1/2'],
    [questText.ready(RAID), 'quest ready: return to King Aldren (2/2)'],
    [questText.reward(RAID.reward), 'quest complete: +60 gold, +60 exp'],
    [`Aldren: ${COLOSSUS.intro}`, 'Aldren: the Colossus stirs beyond the wasteland portal'],
    [questText.accepted(COLOSSUS), 'quest accepted: land 3 Colossus hits (0/3)'],
    [questText.progress(COLOSSUS, 2, 'Aldren'), 'Aldren: so far 2/3 Colossus hits'],
    [questText.note(COLOSSUS, 1), 'quest the Colossus awakens: 1/3'],
    [questText.ready(COLOSSUS), 'quest ready: return to King Aldren (3/3)'],
    [questText.reward(COLOSSUS.reward), 'quest complete: +100 gold, +100 exp'],
    [questText.reward({ gold: 160, xp: 160 }), 'quest complete: +160 gold, +160 exp'],
    [`Aldren: ${COLOSSUS.epilogue}`, 'Aldren: RUNA owes you its peace; your mark is now legend'],
    [TRIAL.title, "the king's trial"],
    [RAID.title, 'the barbarian horde'],
    [COLOSSUS.title, 'the Colossus awakens'],
    [TRIAL.returnTo, 'King Aldren'],
    ['rey: vuelve con Aldren', 'king: return to Aldren'],
    [questText.accepted(KNIGHT), 'quest accepted: defeat 20 mosquitos (0/20)'],
    [questText.ready(KNIGHT), 'quest ready: return to the knight in the square (20/20)']
  ]
  for (const [spanish, english] of cases) {
    t.ok(/^[\x20-\x7e]+$/.test(spanish), `ASCII: ${spanish}`)
    t.is(en(spanish), english)
  }

  // The tracker label and the sheet row of every chapter are whole keys.
  const labels = {
    mosquitos: 'mosquitos',
    saqueadores: 'raiders',
    'golpes al Coloso': 'Colossus hits'
  }
  for (const id of STORY) {
    const label = QUESTS[id].label
    t.ok(/^[\x20-\x7e]+$/.test(label), `ASCII: ${label}`)
    t.is(en(label), labels[label], `${id} has an English label`)
    t.is(en(`rey: ${label}`), `king: ${labels[label]}`, `${id} has an English sheet row`)
  }

  // Story keys carry their context: a line that only shares a word with them
  // keeps that word, instead of coming out as "the Colossus land un golpe".
  for (const line of [
    'el Coloso asesta un golpe',
    'una derrota que elimina dudas',
    'el rey: nadie'
  ]) {
    t.absent(/\b(land|defeat|king)\b/.test(en(line)), `untouched: ${en(line)}`)
  }

  t.alike(
    [
      questText.accepted(KNIGHT),
      questText.progress(KNIGHT, 5, 'sir Cedric'),
      questText.note(KNIGHT, 5),
      questText.ready(KNIGHT),
      questText.reward(KNIGHT.reward)
    ],
    [
      'mision aceptada: elimina 20 mosquitos (0/20)',
      'sir Cedric: llevas 5/20 mosquitos',
      'mision plaga de mosquitos: 5/20',
      'mision lista: vuelve con el caballero de la plaza (20/20)',
      'mision completada: +100 oro, +100 exp'
    ],
    'the knight says exactly what he said before'
  )

  const english = new Runa({ presence: false, language: 'en' })
  startGame(english)
  talkToKing(english)
  for (const [width, height] of [
    [64, 16],
    [80, 24],
    [120, 44]
  ]) {
    english.update({ type: 'resize', width, height })
    const lines = style.stripAnsi(english.view()).split('\n')
    t.is(lines.length, height)
    t.ok(
      lines.every((line) => line.length === width),
      'the story row keeps the frame'
    )
    if (height >= 24) t.ok(lines.join('\n').includes('king: mosquitos'), 'and reads in English')
  }
})
