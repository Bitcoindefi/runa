const { test } = require('brittle')
const voces = require('../scripts/tripo-voces.mjs')
const efectos = require('../scripts/voces-efectos.mjs')
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

test('voces: solo el mosquito pasa por un efecto y el modulo lo conoce', (t) => {
  t.is(voces.MONSTERS.mosquito.fx, 'mosquito', 'el mosquito zumba')
  t.ok(efectos.FX_NAMES.includes('mosquito'), 'voces-efectos.mjs conoce su efecto')
  t.alike(
    voces.MONSTER_IDS.filter((id) => voces.MONSTERS[id].fx !== undefined),
    ['mosquito'],
    'los demas monstruos siguen sin efecto'
  )
  for (const name of efectos.FX_NAMES) {
    const p = efectos.FX[name]
    t.ok(p.pitch >= 5 && p.pitch <= 8, `${name}: sube de 5 a 8 semitonos`)
    t.ok(p.whine >= 500 && p.whine <= 700, `${name}: zumbido de ala de 500 a 700 Hz`)
    t.ok(p.bed <= -20, `${name}: el zumbido queda bajo la voz`)
    const passes = efectos.fxArgs(name, 'crudo.mp3', 'salida.mp3', {
      voice: 'voz.wav',
      rate: 22050,
      kbps: 32
    })
    const steps = [passes.voice, passes.mix({ gain: 1, ceiling: -3.5 })]
    for (const args of steps) {
      t.ok(
        Array.isArray(args) && args.every((arg) => typeof arg === 'string' && arg.length > 0),
        `${name}: una lista de argumentos, sin shell`
      )
      t.absent(
        args.some((arg) => DASHES.test(arg)),
        `${name}: sin rayas en el texto`
      )
      t.ok(args.includes('-filter_complex_threads'), `${name}: un solo hilo`)
    }
    const [first, second] = steps
    t.is(first[first.indexOf('-i') + 1], 'crudo.mp3', `${name}: lee el crudo`)
    t.is(first[first.length - 1], 'voz.wav', `${name}: la voz a un wav`)
    t.is(second[second.indexOf('-i') + 1], 'voz.wav', `${name}: mezcla esa voz`)
    t.is(second[second.length - 1], 'salida.mp3', `${name}: escribe la salida`)
    const graph = second[second.indexOf('-filter_complex') + 1]
    t.ok(graph.endsWith('[out]') && !/\s/.test(graph), `${name}: un grafo sin espacios`)
    t.absent(/acompressor/.test(first.join(' ') + graph), `${name}: sin compresor`)
    t.is(second[second.indexOf('-ar') + 1], '22050', `${name}: a la tasa del original`)
    t.ok(graph.includes('volume=1dB'), `${name}: con la ganancia del intento`)
    const voice = first.join(' ')
    if (p.keepFormants) {
      const ratio = Number(/rubberband=pitch=([\d.]+):formant=preserved/.exec(voice)[1])
      t.ok(Math.abs(ratio - 2 ** (p.pitch / 12)) < 0.001, `${name}: sube con los formantes quietos`)
      t.absent(/asetrate|atempo/.test(voice), `${name}: sin asetrate`)
    } else {
      const tempo = Number(/atempo=([\d.]+)/.exec(voice)[1])
      t.ok(Math.abs(tempo * 2 ** (p.pitch / 12) - 1) < 0.001, `${name}: la misma duracion`)
    }
  }
  const out = efectos.mixArgs('mosquito', 'voz.wav', 'salida.mp3', { rate: 22050, kbps: 32 })
  t.is(out[out.indexOf('-ar') + 1], '22050', 'mp3 a 22050 Hz')
  t.is(out[out.indexOf('-b:a') + 1], '32k', 'y 32 kbit/s, como Text to Speech')
  t.alike(efectos.mp3Format('mp3_22050_32'), { rate: 22050, kbps: 32 })
  t.exception(() => efectos.mp3Format('pcm_16000'), 'el efecto sale en mp3')
  t.exception(() => efectos.fxArgs('dragon', 'a', 'b', { voice: 'c' }), 'un efecto que no existe')
  t.exception(() => efectos.fxArgs('mosquito', 'a', 'b', {}), 'sin el wav de la primera pasada')
})

test('voces: una frase puede tener su propio efecto, siempre de un monstruo con efecto', (t) => {
  const hurt = 'mosquito/en/monster_hurt-1.mp3'
  t.is(efectos.fxOf({ file: hurt }, 'mosquito'), 'mosquito_claro', '"Ow! My wings!" va clara')
  t.is(efectos.fxOf({ file: 'mosquito/en/contact-1.mp3' }, 'mosquito'), 'mosquito', 'las demas no')
  t.is(efectos.fxOf({ file: hurt }, undefined), null, 'sin efecto del monstruo, nada')
  const files = new Map(voces.allLines().map((line) => [line.file, line]))
  for (const [file, name] of Object.entries(efectos.LINE_FX)) {
    const line = files.get(file)
    t.ok(line && voces.MONSTERS[line.monster].fx, `${file}: una frase de un monstruo con efecto`)
    t.ok(efectos.FX_NAMES.includes(name), `${file}: ${name} existe`)
  }
  t.ok(efectos.FX.mosquito_claro.keepFormants, 'mosquito_claro no mueve los formantes')
  t.alike(
    { ...efectos.FX.mosquito_claro, keepFormants: undefined },
    { ...efectos.FX.mosquito, keepFormants: undefined },
    'y lo demas es el mosquito de siempre'
  )
})

test('voces: --fx sale siempre de un original con el texto de ahora', (t) => {
  const mine = (event) =>
    voces.allLines().filter((l) => l.monster === 'mosquito' && l.lang === 'en' && l.event === event)
  const [a, b, c, d] = mine('contact')
  const [hurt] = mine('monster_hurt')
  const bones = voces
    .allLines()
    .find((l) => l.monster === 'skeleton' && l.lang === 'en' && l.event === 'contact')
  const entry = (line, extra = {}) => ({ file: line.file, text: line.text, ...extra })
  const manifest = {
    version: 1,
    monsters: {
      mosquito: {
        lines: {
          en: {
            contact: [
              entry(a, { fx: 'mosquito' }),
              entry(b),
              entry(c, { text: 'Otra cosa' }),
              entry(d)
            ],
            monster_hurt: [entry(hurt, { fx: 'mosquito' })]
          }
        }
      },
      skeleton: { lines: { en: { contact: [entry(bones)] } } }
    }
  }
  const lines = [a, b, c, d, hurt, bones]
  const fxOf = (line) => efectos.fxOf(line, voces.MONSTERS[line.monster].fx)
  const run = (raws, more = {}) =>
    efectos.fxJobs(lines, manifest, {
      fxOf,
      exists: () => true,
      raw: (file) => (file in raws ? { text: raws[file] } : null),
      ...more
    })
  const jobs = (result) => result.jobs.map((job) => `${job.line.file}:${job.fx}:${job.copy}`)
  const all = Object.fromEntries(lines.map((line) => [line.file, line.text]))

  let result = run(all)
  t.alike(
    jobs(result),
    [`${b.file}:mosquito:false`, `${d.file}:mosquito:false`, `${hurt.file}:mosquito_claro:false`],
    'las que no tienen ese efecto, desde su original; el esqueleto nunca'
  )
  t.alike(result.notes, [], 'sin avisos')
  t.is(result.jobs[0].item, manifest.monsters.mosquito.lines.en.contact[1], 'marca su entrada')

  result = run({ ...all, [b.file]: 'Otra cosa', [d.file]: null })
  t.alike(jobs(result), [`${hurt.file}:mosquito_claro:false`], 'un original de otro texto no sirve')
  t.is(result.notes.length, 2, 'y avisa por las dos')
  t.ok(result.notes[0].includes('dice otro texto') && result.notes[1].includes('texto anotado'))

  result = run({})
  t.alike(jobs(result), [], 'sin originales no toca nada')
  t.ok(result.notes.some((n) => n.startsWith(b.file) && n.includes('--tomar-originales')))
  t.ok(
    result.notes.some((n) => n.startsWith(hurt.file) && n.includes('ya tiene mosquito')),
    'una frase marcada sin original queda como esta'
  )

  result = run({}, { adopt: true })
  t.alike(
    jobs(result),
    [`${b.file}:mosquito:true`, `${d.file}:mosquito:true`],
    'con --tomar-originales copia los mp3 sin marca, nunca uno marcado'
  )
  t.alike(jobs(run(all, { exists: () => false })), [], 'sin mp3 en assets, nada')
})

test('voces: al rearmar el manifiesto la marca del efecto sigue', (t) => {
  const line = voces.allLines().find((l) => l.file === 'mosquito/en/monster_hurt-1.mp3')
  const marked = { file: line.file, text: line.text, fx: 'mosquito_claro' }
  const again = efectos.manifestItem(line, marked, { exists: true })
  t.alike(again, marked, 'sin cambios, la misma entrada y la misma marca')
  t.alike(
    efectos.manifestItem(line, marked, { exists: true, fresh: null }),
    { file: line.file, text: line.text },
    'regenerada sin efecto, sin marca'
  )
  t.is(
    efectos.manifestItem(line, null, { exists: true, fresh: 'mosquito' }).fx,
    'mosquito',
    'regenerada con efecto, con su marca'
  )
  t.is(efectos.manifestItem(line, marked, { exists: false }), null, 'sin mp3, null')

  const old = { file: line.file, text: 'Ouch!', fx: 'mosquito' }
  const stale = efectos.manifestItem(line, old, { exists: true })
  t.alike(stale, old, 'un mp3 de un texto viejo conserva su entrada vieja')
  t.alike(
    efectos.manifestItem(line, stale, { exists: true }),
    old,
    'tambien en la corrida siguiente'
  )
  const manifest = {
    version: 1,
    monsters: { mosquito: { lines: { en: { monster_hurt: [stale] } } } }
  }
  t.alike(voces.validateManifest(manifest), [], 'el manifiesto sigue bien formado')
  t.is(voces.audioFor(manifest, line), null, 'la pagina no lo usa')
  const fxOf = (l) => efectos.fxOf(l, 'mosquito')
  const raw = () => ({ text: line.text })
  t.alike(
    efectos.fxJobs([line], manifest, { fxOf, exists: () => true, raw }).jobs,
    [],
    'y --fx no lo toca'
  )
  manifest.monsters.mosquito.lines.en.monster_hurt = [again]
  t.alike(
    efectos.fxJobs([line], manifest, { fxOf, exists: () => true, raw }).jobs,
    [],
    'una frase marcada que se rearmo no vuelve a pasar por el efecto'
  )
})

test('voces: cada salida del efecto se mide y el nivel se corrige', (t) => {
  const source = { I: -14, seconds: 2 }
  const good = { decoded: true, finite: true, I: -15, TP: -1.5, seconds: 2.03 }
  t.alike(efectos.checkRender(source, good), [], 'una salida que sirve')
  t.ok(efectos.checkRender(source, { decoded: false }).length, 'no decodifica')
  t.ok(efectos.checkRender(source, { ...good, finite: false }).length, 'con NaN')
  t.ok(efectos.checkRender(source, { ...good, I: -29.1 }).length, 'casi muda')
  t.ok(efectos.checkRender(source, { ...good, I: NaN }).length, 'sin nivel')
  t.ok(efectos.checkRender(source, { ...good, TP: -0.9 }).length, 'pico de mas')
  t.ok(efectos.checkRender(source, { ...good, seconds: 2.4 }).length, 'otra duracion')

  const level = { gain: 1, ceiling: -3.5 }
  t.is(efectos.nextLevel(level, -15, { I: -29, TP: -2 }), level, 'una salida rota no corrige')
  const up = efectos.nextLevel(level, -15, { I: -16, TP: -2 })
  t.is(up.gain, 3, 'sin intento anterior, supone que sube la mitad')
  t.is(up.ceiling, -3.5, 'el techo no sube')
  const previous = { level, result: { I: -16, TP: -2 } }
  t.is(efectos.nextLevel(up, -15, { I: -15.5, TP: -2 }, previous).gain, 5, 'aprende cuanto sube')
  t.is(
    efectos.nextLevel(level, -15, { I: -15, TP: -0.6 }).ceiling,
    -4.4,
    'un pico de mas baja el techo'
  )
  const top = { gain: 12, ceiling: -3.5 }
  t.alike(
    efectos.nextLevel(top, -13.3, { I: -14.2, TP: -1.9 }),
    { gain: 12, ceiling: -3.1 },
    'con la ganancia al maximo, el techo sube lo que sobra de pico'
  )
  t.is(efectos.nextLevel(top, -12, { I: -14, TP: -4 }).ceiling, efectos.LIMITS.top, 'hasta un tope')
  t.is(
    efectos.nextLevel(top, -14, { I: -14.2, TP: -3 }).ceiling,
    -3.5,
    'si al nivel le falta poco, no'
  )
  const gain = efectos.FX.mosquito.gain
  t.is(efectos.firstGain('mosquito', -15, -11), +(gain - 4).toFixed(2), 'arranca por lo que falta')
  t.is(efectos.firstGain('mosquito', -15, NaN), gain, 'sin medida, la de siempre')

  const stderr =
    '[Parsed_ebur128_0 @ 0] Summary:\n\n  Integrated loudness:\n    I:         -14.1 LUFS\n' +
    '    Threshold: -24.4 LUFS\n\n  True peak:\n    Peak:        0.5 dBFS\n'
  t.alike(efectos.parseLoudness(stderr), { I: -14.1, TP: 0.5 }, 'lee el resumen de ebur128')
  t.ok(Number.isNaN(efectos.parseLoudness('nada').I), 'sin resumen, NaN')

  const opened =
    "Input #0, mp3, from 'crudo.mp3':\n  Duration: 00:00:02.23, start: 0.050113, bitrate: 33 kb/s\n" +
    '  Stream #0:0: Audio: mp3 (mp3float), 22050 Hz, mono, fltp, 32 kb/s, start 0.050113\n' +
    'Stream mapping:\nOutput #0, null, to pipe:\n' +
    '  Stream #0:0: Audio: pcm_s16le, 44100 Hz, mono, s16, 705 kb/s\n'
  t.alike(efectos.parseStream(opened), { rate: 22050, kbps: 32 }, 'la tasa y los kbit/s del mp3')
  t.is(efectos.parseStream(opened.slice(opened.indexOf('Output'))), null, 'no los de la salida')
  t.is(efectos.parseStream("Input #0, wav, from 'a.wav':\n  Stream #0:0: Audio: pcm_s16le"), null)
})

test('voces: la marca del efecto en el manifiesto no cambia que suena', (t) => {
  const text = voces.linesOf('mosquito', 'monster_hurt', 'en')[0]
  const file = 'mosquito/en/monster_hurt-1.mp3'
  const manifest = {
    version: 1,
    monsters: {
      mosquito: { voice: 'abc', lines: { en: { monster_hurt: [{ file, text, fx: 'mosquito' }] } } }
    }
  }
  t.alike(voces.validateManifest(manifest), [], 'el manifiesto sigue bien formado')
  const line = { monster: 'mosquito', lang: 'en', event: 'monster_hurt', index: 0, text }
  t.is(voces.audioFor(manifest, line), file, 'y da el mismo mp3')
})

test('voces: el sonido baja los golpes y presta su contexto', (t) => {
  const sound = sonido.createSound({
    win: { navigator: { userAgent: '' }, document: null, addEventListener() {} }
  })
  t.is(sound.context(), null, 'sin AudioContext no hay contexto')
  t.is(sound.duck(0.4), false, 'ni nada que bajar')
  t.ok(voces.readTime('Hm. Grava.') >= 2 && voces.readTime('a b c d e f g h') <= 5)
})
