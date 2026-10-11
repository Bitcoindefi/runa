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
  questText,
  goalText
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

// The end of a won fight exactly as syncCombat settles it.
function winFight(game, kind) {
  const world = new World(kind)
  world.over = 'ganaste'
  game.field = { combat: null }
  game.pending = world
  game.earned = { kind }
  game.syncCombat(true)
  game.field = null
}

function finishChapter(game, kind, count) {
  for (let kill = 0; kill < count; kill++) winFight(game, kind)
  talkToKing(game)
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
  finishChapter(game, 'mosquito', TRIAL.count)
  t.is(game.quests.barbarian_raid.status, 'active')

  game.field = new Field({ player: game.player, seed: game.fieldSeed() })
  const settlement = game.field.settlements[0]
  game.field.player.x = settlement.x - 1
  game.field.player.y = settlement.y
  game.move(1, 0)
  t.is(game.field.mode, 'barbarian-camp', 'the camp is entered on foot through its gate')

  const raider = game.field.foes.find((foe) => foe.kind === RAID.target && !foe.dead)
  game.field.player.x = raider.x - 1
  game.field.player.y = raider.y
  game.move(1, 0)
  t.ok(game.field.combat, 'walking into a raider starts the fight')
  game.field.combat.world.over = 'ganaste'
  game.advanceCombat()
  t.absent(game.field.combat)
  t.is(game.quests.barbarian_raid.progress, 1, 'the camp kill reaches the quest')
  t.ok(game.log.includes('mision la horda barbara: 1/2'))

  winFight(game, 'barbarian_thrower')
  t.is(game.quests.barbarian_raid.progress, 1, 'other barbarians do not count')
  winFight(game, RAID.target)
  t.ok(game.log.includes('mision lista: vuelve con el rey Aldren (2/2)'))

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
  talkToKing(cleared)
  t.is(cleared.quests.barbarian_raid.status, 'completed', 'no raiders left: paid on the spot')
  t.is(cleared.player.gold, gold + TRIAL.reward.gold + RAID.reward.gold)
  t.is(cleared.quests.colossus_awakening.status, 'active', 'and the story moves on')

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
  game.field.player.x = game.field.boss.x - 12
  game.field.player.y = game.field.boss.y
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
  talkToKing(fallen)
  t.is(fallen.quests.colossus_awakening.status, 'completed', 'beaten before the chapter: paid')
  t.is(fallen.player.gold, gold + RAID.reward.gold + COLOSSUS.reward.gold)
  t.ok(fallen.log.includes(`Aldren: ${COLOSSUS.epilogue}`))
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
    talkToKing(old)
    t.is(old.quests.king_trial.status, 'active', 'and the king can start it')

    const bare = new Runa({ presence: false, saves })
    t.ok(bare.loadSlot(3), 'a save without any quests loads too')
    t.is(bare.storySummary().status, 'available')
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
    goal: 'elimina 3 mosquitos',
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
  t.is(second.goal, 'derrota 2 saqueadores')
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
    [questText.reward(TRIAL), 'quest complete: +20 gold, +20 exp'],
    [`Aldren: ${RAID.intro}`, 'Aldren: barbarians are raiding the east'],
    [questText.accepted(RAID, 1), 'quest accepted: defeat 2 raiders (1/2)'],
    [questText.progress(RAID, 1, 'Aldren'), 'Aldren: so far 1/2 raiders'],
    [questText.note(RAID, 1), 'quest the barbarian horde: 1/2'],
    [questText.ready(RAID), 'quest ready: return to King Aldren (2/2)'],
    [questText.reward(RAID), 'quest complete: +60 gold, +60 exp'],
    [`Aldren: ${COLOSSUS.intro}`, 'Aldren: the Colossus stirs beyond the wasteland portal'],
    [questText.accepted(COLOSSUS), 'quest accepted: land 3 hits on Colossus (0/3)'],
    [questText.progress(COLOSSUS, 2, 'Aldren'), 'Aldren: so far 2/3 hits on Colossus'],
    [questText.note(COLOSSUS, 1), 'quest the Colossus awakens: 1/3'],
    [questText.ready(COLOSSUS), 'quest ready: return to King Aldren (3/3)'],
    [questText.reward(COLOSSUS), 'quest complete: +100 gold, +100 exp'],
    [`Aldren: ${COLOSSUS.epilogue}`, 'Aldren: RUNA owes you its peace; your mark is now legend'],
    [TRIAL.title, "the king's trial"],
    [RAID.title, 'the barbarian horde'],
    [COLOSSUS.title, 'the Colossus awakens'],
    [goalText(TRIAL), 'defeat 3 mosquitos'],
    [goalText(RAID), 'defeat 2 raiders'],
    [goalText(COLOSSUS), 'land 3 hits on Colossus'],
    [TRIAL.returnTo, 'King Aldren'],
    [questText.accepted(KNIGHT), 'quest accepted: defeat 20 mosquitos (0/20)'],
    [questText.ready(KNIGHT), 'quest ready: return to the knight in the square (20/20)']
  ]
  for (const [spanish, english] of cases) {
    t.ok(/^[\x20-\x7e]+$/.test(spanish), `ASCII: ${spanish}`)
    t.is(en(spanish), english)
  }
  t.alike(
    [
      questText.accepted(KNIGHT),
      questText.progress(KNIGHT, 5, 'sir Cedric'),
      questText.note(KNIGHT, 5),
      questText.ready(KNIGHT),
      questText.reward(KNIGHT)
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
