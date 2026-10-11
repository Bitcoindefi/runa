'use strict'

/**
 * Quests as data: who hands them out, what they ask for, what they pay and
 * every line they put in the log.
 *
 * `after` chains quests. A link is only offered once the quest it names is
 * completed, and completing a link hands out the next one on the spot, so an
 * NPC only has to know where its chain starts. King Aldren's chain is the
 * story; the plaza knight's hunt is a chain of one.
 *
 * The lines are built here and nowhere else. They are Spanish and ASCII like
 * the rest of the terminal, and every fixed fragment has an entry in
 * lib/locales/en.json, which translates around the numbers and the names.
 */

const { WORLD_BOSS } = require('./world-boss.js')

/** The first chapter King Aldren hands out. The story is the chain it starts. */
const STORY_START = 'king_trial'

/** Said to heroes born in RUNA, so the story can be found without a guide. */
const STORY_HINT = 'el rey Aldren te espera en el castillo'

const EPILOGUE = 'RUNA te debe su paz; tu marca ya es leyenda'

/**
 * `kind` is what counts as progress: 'kill' a foe of `target`, or 'hit' the
 * world boss whose id is `target`. `every` spaces the progress notes. `intro`
 * is said when the giver hands the quest out, `done` when they are visited
 * after it, and `epilogue` right after the reward, as the chain closes.
 */
const QUESTS = Object.freeze({
  mosquito_hunt: Object.freeze({
    id: 'mosquito_hunt',
    giver: 'cedric',
    after: null,
    title: 'plaga de mosquitos',
    kind: 'kill',
    target: 'mosquito',
    count: 20,
    verb: 'elimina',
    label: 'mosquitos',
    returnTo: 'el caballero de la plaza',
    every: 5,
    done: 'ya cumpliste la mision de los mosquitos',
    reward: Object.freeze({ gold: 100, xp: 100 })
  }),
  king_trial: Object.freeze({
    id: 'king_trial',
    giver: 'aldren',
    after: null,
    title: 'la prueba del rey',
    intro: 'prueba tu valor en la pradera',
    kind: 'kill',
    target: 'mosquito',
    count: 3,
    verb: 'elimina',
    label: 'mosquitos',
    returnTo: 'el rey Aldren',
    every: 1,
    reward: Object.freeze({ gold: 20, xp: 20 })
  }),
  // Raiders live only inside the barbarian camps and never respawn. The game
  // credits the ones a save already killed, so this link cannot get stuck.
  barbarian_raid: Object.freeze({
    id: 'barbarian_raid',
    giver: 'aldren',
    after: 'king_trial',
    title: 'la horda barbara',
    intro: 'los barbaros saquean el este',
    kind: 'kill',
    target: 'barbarian_raider',
    count: 2,
    verb: 'derrota',
    label: 'saqueadores',
    returnTo: 'el rey Aldren',
    every: 1,
    reward: Object.freeze({ gold: 60, xp: 60 })
  }),
  colossus_awakening: Object.freeze({
    id: 'colossus_awakening',
    giver: 'aldren',
    after: 'barbarian_raid',
    title: 'el despertar del Coloso',
    intro: 'el Coloso despierta tras el portal del yermo',
    kind: 'hit',
    target: WORLD_BOSS.id,
    count: 3,
    verb: 'asesta',
    label: 'golpes al Coloso',
    returnTo: 'el rey Aldren',
    every: 1,
    done: EPILOGUE,
    epilogue: EPILOGUE,
    reward: Object.freeze({ gold: 100, xp: 100 })
  })
})

const STATUSES = ['available', 'active', 'completed']

function clampCount(value, count) {
  const number = Math.floor(Number(value))
  if (!Number.isFinite(number)) return 0
  return number < 0 ? 0 : number > count ? count : number
}

function goalText(quest) {
  return `${quest.verb} ${quest.count} ${quest.label}`
}

/**
 * Every line a quest writes to the log. `reward` takes `{ gold, xp }`: one talk
 * can pay several links of a chain and says the total once.
 */
const questText = Object.freeze({
  accepted: (quest, progress = 0) =>
    `mision aceptada: ${goalText(quest)} (${progress}/${quest.count})`,
  progress: (quest, progress, giver) =>
    `${giver}: llevas ${progress}/${quest.count} ${quest.label}`,
  note: (quest, progress) => `mision ${quest.title}: ${progress}/${quest.count}`,
  ready: (quest) => `mision lista: vuelve con ${quest.returnTo} (${quest.count}/${quest.count})`,
  reward: (reward) => `mision completada: +${reward.gold} oro, +${reward.xp} exp`
})

/**
 * Quest progress rebuilt from a save, trusting nothing in it. Unknown ids are
 * dropped and missing ones start as available, so a save written before a
 * quest existed simply has not started it yet.
 */
function questState(raw = {}) {
  const out = {}
  for (const quest of Object.values(QUESTS)) {
    const entry = raw && raw[quest.id]
    const saved = entry && typeof entry === 'object' ? entry : {}
    const status = STATUSES.includes(saved.status) ? saved.status : 'available'
    out[quest.id] = {
      status,
      progress: status === 'completed' ? quest.count : clampCount(saved.progress, quest.count)
    }
  }
  // Nothing in a chain starts before the link it follows is done. A save that
  // says otherwise was edited or half written, and those links start over.
  for (const head of Object.values(QUESTS)) {
    if (head.after) continue
    let open = false
    for (const quest of questChain(head.id)) {
      if (open) out[quest.id] = { status: 'available', progress: 0 }
      else open = out[quest.id].status !== 'completed'
    }
  }
  return out
}

/** The quest that follows `id` in its chain, or null where the chain ends. */
function nextQuest(id) {
  return Object.values(QUESTS).find((quest) => quest.after === id) || null
}

/** A chain from `id` to its end, in order. */
function questChain(id) {
  const chain = []
  let quest = QUESTS[id] || null
  while (quest && !chain.includes(quest)) {
    chain.push(quest)
    quest = nextQuest(quest.id)
  }
  return chain
}

/** The link in play: the first one not completed, or the last once all are. */
function currentQuest(id, state = {}) {
  const chain = questChain(id)
  const open = chain.find((quest) => !state[quest.id] || state[quest.id].status !== 'completed')
  return open || chain[chain.length - 1] || null
}

function questUnlocked(quest, state = {}) {
  return !quest.after || !!(state[quest.after] && state[quest.after].status === 'completed')
}

/** Story chapter ids, in the order the king hands them out. */
const STORY = Object.freeze(questChain(STORY_START).map((quest) => quest.id))

/**
 * Where the story stands, shaped for a tracker. `status` is 'available' until
 * the king hands the chapter out, 'active' while it runs, 'ready' once its
 * goal is met and 'done' after the last chapter.
 *
 * Every text is a whole key in lib/locales/en.json. There is no sentence with
 * the count inside: its verb would need a one-word key, and those translate
 * fragments of unrelated lines too. A tracker shows `label` with
 * `progress/count`.
 */
function storyStatus(state = {}) {
  const quest = currentQuest(STORY_START, state)
  if (!quest) return null
  const entry = state[quest.id] || {}
  const progress = clampCount(entry.progress, quest.count)
  let status = 'available'
  if (entry.status === 'completed') status = 'done'
  else if (entry.status === 'active') status = progress >= quest.count ? 'ready' : 'active'
  return {
    id: quest.id,
    chapter: STORY.indexOf(quest.id) + 1,
    chapters: STORY.length,
    title: quest.title,
    label: quest.label,
    status,
    progress,
    count: quest.count,
    returnTo: quest.returnTo
  }
}

module.exports = {
  QUESTS,
  STORY,
  STORY_START,
  STORY_HINT,
  questState,
  questText,
  nextQuest,
  questChain,
  currentQuest,
  questUnlocked,
  storyStatus
}
