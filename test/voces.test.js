const { test } = require('brittle')
const voces = require('../scripts/tripo-voces.mjs')
const sonido = require('../scripts/tripo-sonido.mjs')
const { foes } = require('../lib/content.js')

const DASHES = new RegExp('[\u2013\u2014]')

test('voces: cada monstruo del juego y el Coloso tienen personalidad y voz', (t) => {
  const ids = [...Object.keys(foes), voces.BOSS]
  t.alike(
    ids.slice().sort(),
    voces.MONSTER_IDS.slice().sort(),
    'los mismos monstruos que content.js'
  )
  for (const id of voces.MONSTER_IDS) {
    const entry = voces.MONSTERS[id]
    t.ok(entry.personality && entry.personality.length < 120, `${id}: personalidad de una linea`)
    t.is(entry.name.length, 2, `${id}: nombre en los dos idiomas`)
    for (const field of ['gender', 'age', 'timbre', 'accent', 'pace']) {
      t.ok(entry.voice[field], `${id}: voz con ${field}`)
    }
    t.ok(entry.voice.speed >= 0.7 && entry.voice.speed <= 1.2, `${id}: speed que acepta la API`)
    const description = voces.voiceDescription(id)
    t.ok(description.length >= 20 && description.length <= 1000, `${id}: pedido de voz medido`)
    const sample = voces.sampleText(id)
    t.ok(sample.length >= 100 && sample.length <= 1000, `${id}: muestra de 100 a 1000`)
  }
})

test('voces: frases para cada evento, en los dos idiomas, cortas', (t) => {
  let count = 0
  for (const id of voces.MONSTER_IDS) {
    const events = voces.eventsOf(id)
    t.alike(Object.keys(voces.LINES[id]).sort(), events.slice().sort(), `${id}: justo sus eventos`)
    for (const event of events) {
      const en = voces.linesOf(id, event, 'en')
      const es = voces.linesOf(id, event, 'es')
      t.ok(en.length >= 3 && en.length <= 5, `${id}/${event}: de 3 a 5 frases`)
      t.is(es.length, en.length, `${id}/${event}: las mismas en castellano`)
      for (const text of [...en, ...es]) {
        count++
        if (
          !text.trim() ||
          voces.wordCount(text) > voces.MAX_WORDS ||
          text.length > voces.MAX_CHARS ||
          DASHES.test(text)
        ) {
          t.fail(`${id}/${event}: frase fuera de medida: ${text}`)
        }
      }
      t.is(new Set(en).size, en.length, `${id}/${event}: sin frases repetidas`)
    }
  }
  t.is(voces.allLines().length, count, 'allLines cuenta todas')
  t.ok(voces.BOSS_EVENTS.includes('windup_slam') && voces.BOSS_EVENTS.includes('defeated'))
  t.is(voces.eventsOf('mosquito'), voces.EVENTS)
})

test('voces: el que elige espera entre frases y no repite', (t) => {
  const picker = voces.createPicker({ seed: 7, chance: {} })
  const first = picker.pick('mosquito', 'monster_hits', 10, 'en')
  t.ok(first, 'habla')
  t.is(picker.pick('mosquito', 'monster_hurt', 11, 'en'), null, 'antes de 3 s se calla')
  t.ok(picker.pick('skeleton', 'monster_hurt', 11, 'en'), 'otro monstruo no espera al primero')
  t.ok(picker.pick('mosquito', 'monster_death', 11.5, 'en'), 'la muerte pasa por encima')
  t.ok(picker.pick('mosquito', 'contact', 11.6, 'en'), 'el contacto tambien')
  t.is(picker.pick('mosquito', 'monster_hits', 13, 'en'), null, 'la espera cuenta desde la ultima')
  t.ok(picker.pick('mosquito', 'monster_hits', 14.7, 'en'), 'pasados 3 s vuelve a hablar')

  let last = -1
  let time = 100
  for (let i = 0; i < 200; i++) {
    const line = picker.pick('golem', 'player_guard', (time += 3), i % 2 ? 'es' : 'en')
    const same = voces.linesOf('golem', 'player_guard', line.lang)[line.index]
    if (line.index === last || line.text !== same) {
      t.fail('repitio la frase anterior o el texto no es el suyo')
      break
    }
    last = line.index
  }
  t.pass('200 frases sin repetir la anterior')
  t.is(picker.pick('golem', 'windup_slam', 9999), null, 'el Coloso tiene eventos propios')
  t.is(picker.pick('nadie', 'contact', 9999), null, 'un monstruo desconocido no habla')
})

test('voces: con la misma semilla, las mismas frases', (t) => {
  const run = (seed) => {
    const picker = voces.createPicker({ seed })
    const out = []
    for (let i = 0; i < 40; i++) {
      const line = picker.pick(voces.BOSS, voces.BOSS_EVENTS[i % 13], i * 3.1, 'es')
      out.push(line ? line.index : null)
    }
    return out.join(',')
  }
  t.is(run(42), run(42), 'misma semilla, mismo resultado')
  t.ok(run(1) !== run(2) || run(1) !== run(3), 'otra semilla cambia algo')
  // CHANCE: los golpes no siempre llevan frase.
  const picker = voces.createPicker({ seed: 3 })
  let spoken = 0
  for (let i = 0; i < 100; i++) if (picker.pick('slime', 'monster_hurt', i * 4)) spoken++
  t.ok(spoken > 30 && spoken < 90, `monster_hurt habla a veces (${spoken} de 100)`)
})

test('voces: el manifiesto se valida y da el mp3 de cada frase', (t) => {
  const text = voces.linesOf('mosquito', 'contact', 'en')[1]
  const manifest = {
    version: 1,
    model: 'eleven_multilingual_v2',
    format: 'mp3_44100_64',
    monsters: {
      mosquito: {
        voice: 'abc',
        lines: {
          en: {
            contact: [null, { file: 'mosquito/en/contact-2.mp3', text }]
          }
        }
      }
    }
  }
  t.alike(voces.validateManifest(manifest), [], 'un manifiesto bien formado')
  const line = { monster: 'mosquito', lang: 'en', event: 'contact', index: 1, text }
  t.is(voces.audioFor(manifest, line), 'mosquito/en/contact-2.mp3')
  t.is(voces.audioFor(manifest, { ...line, index: 0 }), null, 'sin mp3, solo el globo')
  t.is(voces.audioFor(manifest, { ...line, text: 'otra cosa' }), null, 'texto cambiado, sin mp3')
  t.is(voces.audioFor(null, line), null, 'sin manifiesto, sin mp3')
  t.is(voces.fileOf('golem', 'es', 'monster_hits', 0), 'golem/es/monster_hits-1.mp3')

  const bad = (change) => voces.validateManifest(change(structuredClone(manifest))).length > 0
  t.ok(
    bad((m) => ({ ...m, version: 2 })),
    'otra version'
  )
  t.ok(
    bad((m) => {
      m.monsters.dragon = { lines: {} }
      return m
    }),
    'un monstruo que no existe'
  )
  t.ok(
    bad((m) => {
      m.monsters.mosquito.lines.en.windup_slam = []
      return m
    }),
    'un evento que el mosquito no tiene'
  )
  t.ok(
    bad((m) => {
      m.monsters.mosquito.lines.en.contact[1].file = '../../secreto.mp3'
      return m
    }),
    'un archivo fuera de su lugar'
  )
  t.ok(
    bad((m) => {
      m.monsters.mosquito.lines.fr = {}
      return m
    }),
    'un idioma que no esta'
  )
  t.ok(voces.validateManifest(null).length > 0, 'nada no es un manifiesto')
})

test('voces: el sonido baja los golpes y presta su contexto', (t) => {
  const sound = sonido.createSound({
    win: { navigator: { userAgent: '' }, document: null, addEventListener() {} }
  })
  t.is(sound.context(), null, 'sin AudioContext no hay contexto')
  t.is(sound.duck(0.4), false, 'ni nada que bajar')
  t.ok(voces.readTime('Hm. Grava.') >= 2 && voces.readTime('a b c d e f g h') <= 5)
})
