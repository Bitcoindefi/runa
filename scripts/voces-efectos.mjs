// Efectos de audio para las voces de los monstruos. Un monstruo con `fx` en
// scripts/tripo-voces.mjs pasa cada frase por ffmpeg justo despues de Text to
// Speech (scripts/generar-voces.mjs, que es el que corre ffmpeg). Aca solo hay
// datos y funciones puras: las pruebas lo cargan en Bare. Tambien estan aca
// que frases pasan por el efecto con --fx (fxJobs) y como queda la marca del
// efecto al rearmar el manifiesto (manifestItem).
//
// mosquito: un insecto chiquito que zumba y al que se le entiende lo que dice.
//  - La voz sube unos semitonos (asetrate y atempo: la misma duracion).
//  - Se afina y se vuelve nasal: corte de graves y realce cerca de 1,3 y 3 kHz.
//  - Un vibrato leve y un aleteo rapido en la amplitud (tremolo).
//  - Debajo, un zumbido de ala agudo (aevalsrc cerca de 600 Hz, con un vaiven
//    lento) que baja cuando habla (sidechaincompress) para no tapar palabras.
//  - Al final, una ganancia y un limitador sobremuestreado: cerca del nivel de
//    la frase original y el pico verdadero por debajo de -1 dBTP.
//
// Va en dos pasadas: la voz a un wav float y despues el zumbido, la mezcla y el
// limitador. En una sola pasada, ffmpeg 8 sacaba una de cada ocho veces una
// mezcla rota (casi muda, con continua); en dos pasadas pasa menos. Igual se
// mide cada salida (checkRender) y se repite si hace falta.

// Cada efecto: semitonos, paso alto, ecualizador [f, ancho q, dB], vibrato
// [Hz, profundidad], aleteo [Hz, profundidad], zumbido (Hz y dB), como baja
// el zumbido cuando habla [umbral, razon], paso bajo y gain: los dB que pierde
// la segunda pasada (aleteo y limitador), para el primer intento (ver
// firstGain). asetrate sube el tono y tambien los formantes (una garganta
// chiquita); con keepFormants el tono sube con rubberband y los formantes
// quedan donde estaban. Con 8 semitonos Speech to Text entendia bastante menos.
const MOSQUITO = {
  pitch: 6,
  highpass: 350,
  eq: [
    [1300, 2, 2],
    [3000, 1, 4]
  ],
  vibrato: [8, 0.12],
  tremolo: [45, 0.3],
  whine: 600,
  bed: -28,
  duck: [0.03, 4],
  lowpass: 7600,
  gain: 3.1
}

export const FX = {
  mosquito_suave: {
    pitch: 5,
    highpass: 250,
    eq: [[3000, 1, 3]],
    vibrato: [7, 0.08],
    tremolo: [38, 0.2],
    whine: 600,
    bed: -30,
    duck: [0.03, 4],
    lowpass: 7600,
    gain: 2.6
  },
  mosquito: MOSQUITO,
  // El mismo mosquito (tono, aleteo y zumbido) con las vocales de la voz
  // original, para las frases de LINE_FX. rubberband deja afuera unos 0,1 s
  // del final: la frase tiene que terminar antes, en el zumbido.
  mosquito_claro: { ...MOSQUITO, keepFormants: true },
  mosquito_fuerte: {
    pitch: 8,
    highpass: 450,
    eq: [
      [1300, 2, 3],
      [3200, 1, 5]
    ],
    vibrato: [9, 0.18],
    tremolo: [55, 0.5],
    whine: 640,
    bed: -21,
    duck: [0.03, 6],
    lowpass: 7600,
    gain: 4.2
  }
}

export const FX_NAMES = Object.keys(FX)

// Frases con un efecto propio, por archivo (relativo a assets/voces/). Con el
// tono de asetrate, aunque sea un semitono y medio, Speech to Text oye "Ow! My
// wings!" como "Ciao, my wings" o "Chow my wings"; con los formantes quietos
// oye "Ow, my wings!".
export const LINE_FX = {
  'mosquito/en/monster_hurt-1.mp3': 'mosquito_claro'
}

/**
 * El efecto de una frase ({ file }): el suyo en LINE_FX o el de su monstruo
 * (`monsterFx`). Si el monstruo no tiene efecto, ninguna de sus frases lo tiene.
 */
export function fxOf(line, monsterFx) {
  if (!monsterFx) return null
  return LINE_FX[line.file] || monsterFx
}

// Lo que se le pide a cada salida. loudness: LU de diferencia con el original;
// offset: a donde apunta el nivel, en LU desde el original (un poco abajo: los
// originales de Text to Speech recortan y llegar justo exige mucho limitador);
// aim: cuanto se acepta sin corregir la ganancia; peak: dBTP; duration:
// fraccion; tries: intentos (el primero y siete mas); ceiling: techo inicial
// del limitador (dBFS, sobremuestreado: el mp3 suma entre 1 y 3,5 dB); top: lo
// mas alto que sube el techo cuando la ganancia ya esta al maximo.
export const LIMITS = {
  loudness: 2,
  offset: -1,
  aim: 0.5,
  peak: -1,
  duration: 0.15,
  tries: 8,
  ceiling: -3.5,
  top: -2.5
}

// Tasa interna de las dos pasadas.
const RATE = 44100
// La ganancia mas alta (y la mas baja, en negativo) que se le da a la voz.
const MAX_GAIN = 12

const num = (x, digits = 4) => String(+Number(x).toFixed(digits))

function preset(name) {
  const p = FX[name]
  if (!p) throw new Error(`efecto desconocido: ${name}`)
  return p
}

/**
 * El zumbido de ala para aevalsrc: armonicos que caen de a 0,6 (forma cerrada,
 * sin comas: el grafo las usaria de separador), la frecuencia con un vaiven de
 * 2,5 % a 2,7 Hz y 1,2 % a 6,3 Hz, y el volumen que respira despacio.
 */
export function whineExpr(freq) {
  const a = 0.6
  const phase =
    `(2*PI*${freq}*t-${num((freq * 0.025) / 2.7, 3)}*cos(2*PI*2.7*t)` +
    `-${num((freq * 0.012) / 6.3, 3)}*cos(2*PI*6.3*t))`
  return (
    `(1+0.25*sin(2*PI*1.3*t)+0.1*sin(2*PI*4.7*t))*${a}*sin(${phase})` +
    `/(${num(1 + a * a)}-${num(2 * a)}*cos(${phase}))`
  )
}

/**
 * La primera pasada (-af): la voz mas aguda, fina, nasal y con vibrato. El paso
 * bajo va aca y no al final: asi el nivel de esta pasada ya cuenta lo que se
 * pierde de las eses y zetas, que suben de tono y quedan arriba del corte.
 */
export function voiceFilter(name) {
  const p = preset(name)
  const ratio = 2 ** (p.pitch / 12)
  const pitch = p.keepFormants
    ? [`rubberband=pitch=${num(ratio, 5)}:formant=preserved:pitchq=quality`]
    : [`asetrate=${Math.round(RATE * ratio)}`, `aresample=${RATE}`, `atempo=${num(1 / ratio, 5)}`]
  return [
    'aformat=channel_layouts=mono',
    `aresample=${RATE}`,
    ...pitch,
    `highpass=f=${p.highpass}:p=2`,
    ...p.eq.map(([f, width, g]) => `equalizer=f=${f}:t=q:w=${width}:g=${g}`),
    `vibrato=f=${p.vibrato[0]}:d=${p.vibrato[1]}`,
    `lowpass=f=${p.lowpass}:p=2`,
    `lowpass=f=${p.lowpass}:p=2`
  ].join(',')
}

/**
 * La segunda pasada (-filter_complex, salida en [out]): el zumbido que baja
 * cuando habla, la mezcla con aleteo, la ganancia, el limitador y un final
 * suave.
 */
export function mixGraph(name, { gain, ceiling = LIMITS.ceiling, rate = 22050 } = {}) {
  const p = preset(name)
  const level = gain === undefined ? p.gain : gain
  const wing = [
    `aevalsrc=exprs=${whineExpr(p.whine)}:s=${RATE}:c=mono`,
    'afade=t=in:d=0.08',
    `volume=${p.bed}dB[ala]`
  ]
  const duck =
    `[ala][llave]sidechaincompress=threshold=${p.duck[0]}:ratio=${p.duck[1]}` +
    ':attack=10:release=180[aladuck]'
  // La voz llega 25 ms despues: el zumbido ya bajo cuando empieza a hablar.
  const delay = '[voz]adelay=delays=25:all=1[vozd]'
  const mix = [
    '[vozd][aladuck]amix=inputs=2:duration=first:normalize=0',
    `tremolo=f=${p.tremolo[0]}:d=${p.tremolo[1]}`,
    `aresample=${RATE * 2}`,
    `alimiter=limit=${num(10 ** (ceiling / 20))}:attack=3:release=50:level=0:latency=1`,
    'areverse',
    'afade=t=in:d=0.08',
    'areverse',
    `aresample=${rate}[out]`
  ]
  // La ganancia va solo a la voz: el zumbido queda bajo en las pausas.
  const voice = `[0:a]volume=${num(level, 2)}dB,asplit=2[voz][llave]`
  return [voice, wing.join(','), duck, delay, mix.join(',')].join(';')
}

const BASE = [
  '-hide_banner',
  '-nostdin',
  '-v',
  'error',
  '-y',
  '-filter_threads',
  '1',
  '-filter_complex_threads',
  '1',
  '-threads',
  '1'
]

/** Los argumentos de ffmpeg de la primera pasada: `input` a la voz `voice` (wav float). */
export function voiceArgs(name, input, voice) {
  return [...BASE, '-i', input, '-af', voiceFilter(name), '-c:a', 'pcm_f32le', voice]
}

/**
 * Los argumentos de ffmpeg de la segunda pasada: la voz `voice` al mp3
 * `output`, mono a `rate` Hz y `kbps` kbit/s.
 */
export function mixArgs(name, voice, output, { gain, ceiling, rate = 22050, kbps = 32 } = {}) {
  return [
    ...BASE,
    '-i',
    voice,
    '-filter_complex',
    mixGraph(name, { gain, ceiling, rate }),
    '-map',
    '[out]',
    '-map_metadata',
    '-1',
    '-ac',
    '1',
    '-ar',
    String(rate),
    '-c:a',
    'libmp3lame',
    '-b:a',
    `${kbps}k`,
    output
  ]
}

/**
 * Las dos pasadas del efecto para llevar `input` a `output`, como listas de
 * argumentos de ffmpeg (sin shell). voice: la primera, al wav temporal `voice`;
 * mix(level): la segunda, de ese wav al mp3 mono de `rate` Hz y `kbps` kbit/s,
 * con la ganancia y el techo de cada intento ({ gain, ceiling }).
 */
export function fxArgs(name, input, output, { voice, rate, kbps } = {}) {
  if (!voice) throw new Error('fxArgs necesita voice: el wav de la primera pasada')
  return {
    voice: voiceArgs(name, input, voice),
    mix: (level = {}) => mixArgs(name, voice, output, { ...level, rate, kbps })
  }
}

/**
 * La ganancia del primer intento: lo que le falta a la voz de la primera
 * pasada (voiceI, LUFS) para llegar al nivel buscado (aimI), mas lo que suele
 * perder la segunda.
 */
export function firstGain(name, aimI, voiceI) {
  const p = preset(name)
  if (!Number.isFinite(aimI) || !Number.isFinite(voiceI)) return p.gain
  return +Math.max(-MAX_GAIN, Math.min(MAX_GAIN, aimI - voiceI + p.gain)).toFixed(2)
}

/**
 * La tasa y los kbit/s de un formato de ElevenLabs (mp3_22050_32): la salida
 * del efecto queda igual que lo que dio Text to Speech.
 */
export function mp3Format(format) {
  const match = /^mp3_(\d+)_(\d+)$/.exec(String(format))
  if (!match) {
    throw new Error(`el efecto de voz necesita un formato mp3_<tasa>_<kbps>, no ${format}`)
  }
  return { rate: Number(match[1]), kbps: Number(match[2]) }
}

/** Los argumentos de ffmpeg que miden un archivo con ebur128 (ver parseLoudness). */
export function loudnessArgs(file) {
  return [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-threads',
    '1',
    '-i',
    file,
    '-filter_complex',
    'ebur128=peak=true',
    '-f',
    'null',
    '-'
  ]
}

/** Los argumentos de ffmpeg que decodifican un archivo a PCM float mono. */
export function decodeArgs(file, rate = 22050) {
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-threads',
    '1',
    '-i',
    file,
    '-ac',
    '1',
    '-ar',
    String(rate),
    '-f',
    'f32le',
    '-'
  ]
}

/**
 * La loudness integrada (I, LUFS) y el pico verdadero (TP, dBTP) del resumen
 * que ebur128 deja en stderr. NaN si no estan (o si dicen -inf).
 */
export function parseLoudness(stderr) {
  const text = String(stderr)
  const tail = text.slice(Math.max(0, text.lastIndexOf('Summary:')))
  const I = Number((tail.match(/I:\s+(-?[\d.]+|-inf) LUFS/) || [])[1])
  const TP = Number((tail.match(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/) || [])[1])
  return { I, TP }
}

/**
 * La tasa (Hz) y los kbit/s del mp3 que ffmpeg leyo, de lo que deja en stderr
 * al abrirlo (por ejemplo, con loudnessArgs). null si no es un mp3 o no los
 * dice. La salida del efecto queda igual que su original.
 */
export function parseStream(stderr) {
  const text = String(stderr)
  const end = text.indexOf('Output #')
  const input = end === -1 ? text : text.slice(0, end)
  const match = /Stream #0:\d+\S*: Audio: mp3\b[^\n]*?, (\d+) Hz,[^\n]*?, (\d+) kb\/s/.exec(input)
  return match ? { rate: Number(match[1]), kbps: Number(match[2]) } : null
}

/**
 * Lo que esta mal en una salida, comparada con su original (vacio si sirve).
 * source: { I, seconds }; result: { decoded, finite, I, TP, seconds }.
 */
export function checkRender(source, result, limits = LIMITS) {
  if (!result || !result.decoded) return ['no se pudo decodificar']
  const problems = []
  if (!result.finite) problems.push('muestras NaN o infinitas')
  if (!(Math.abs(result.I - source.I) <= limits.loudness)) {
    problems.push(`loudness ${result.I} LUFS, el original ${source.I}`)
  }
  if (!(result.TP <= limits.peak)) problems.push(`pico verdadero ${result.TP} dBTP`)
  if (!(Math.abs(result.seconds / source.seconds - 1) <= limits.duration)) {
    problems.push(`duracion ${result.seconds} s, el original ${source.seconds}`)
  }
  return problems
}

/** Si una salida sirve para corregir el nivel: tiene nivel y no esta a mas de 6 LU. */
export function usable(target, result) {
  return !!result && Number.isFinite(result.I) && Math.abs(result.I - target) <= 6
}

/**
 * La ganancia y el techo del intento siguiente. La ganancia corrige la
 * diferencia de nivel medida, dividida por cuanto subio el nivel por dB en el
 * intento anterior (`previous`, { level, result }): el limitador se come parte
 * y sin anterior se supone la mitad. Si el pico verdadero se paso, el techo
 * baja hasta dejarlo medio dB por debajo del limite (el mp3 se pasa del techo
 * entre 1 y 3,5 dB). Con la ganancia ya al maximo y el nivel corto, lo que
 * frena es el limitador: el techo sube lo que sobra de pico, hasta limits.top.
 * Una salida rota no corrige nada: se repite igual.
 */
export function nextLevel(level, target, result, previous, limits = LIMITS) {
  if (!usable(target, result)) return level
  const clamp = (x, low, high) => +Math.max(low, Math.min(high, x)).toFixed(2)
  let slope = 0.5
  if (previous && usable(target, previous.result)) {
    const moved = level.gain - previous.level.gain
    if (Math.abs(moved) >= 0.3) slope = clamp((result.I - previous.result.I) / moved, 0.2, 1)
  }
  const TP = result.TP
  const over = Number.isFinite(TP) ? TP - limits.peak + 0.5 : 0
  const short = target - result.I
  let ceiling = level.ceiling
  if (over > 0) ceiling -= over
  else if (level.gain >= MAX_GAIN && short > limits.aim) ceiling += Math.min(-over, short)
  return {
    gain: clamp(level.gain + clamp(short / slope, -6, 6), -MAX_GAIN, MAX_GAIN),
    ceiling: clamp(ceiling, -9, Math.max(level.ceiling, limits.top))
  }
}

/** La entrada de una frase en el manifiesto ({ file, text, fx? }) o null. */
export function entryOf(manifest, line) {
  const entry = manifest && manifest.monsters && manifest.monsters[line.monster]
  const list = entry && entry.lines && entry.lines[line.lang] && entry.lines[line.lang][line.event]
  const item = Array.isArray(list) ? list[line.index] : null
  return item && typeof item.text === 'string' ? item : null
}

/**
 * Las frases que --fx pasa por su efecto. Cada una sale de su original en
 * --crudas, que tiene que decir el texto de ahora, y nunca de un mp3 que quiza
 * ya tiene un efecto. lines: las frases elegidas (de allLines); manifest: el de
 * assets/voces. Lo demas se pregunta con funciones, para probarlo sin disco:
 *   fxOf(line): el efecto de la frase, o null
 *   exists(file): si su mp3 esta en assets/voces
 *   raw(file): su original en --crudas, null si no esta; { text } con el texto
 *     anotado al lado, o text null si no tiene
 *   adopt: --tomar-originales, los mp3 sin marca ni original son originales
 * Devuelve { jobs: [{ line, item, fx, copy }], notes }: copy pide copiar el mp3
 * de assets a --crudas antes del efecto; notes, por que se salteo alguna.
 */
export function fxJobs(lines, manifest, { fxOf, exists, raw, adopt = false }) {
  const jobs = []
  const notes = []
  for (const line of lines) {
    const fx = fxOf(line)
    if (!fx) continue
    const item = entryOf(manifest, line)
    const current = item && item.text === line.text && item.file === line.file
    if (!current || !exists(line.file) || item.fx === fx) continue
    const original = raw(line.file)
    if (original && original.text === line.text) {
      jobs.push({ line, item, fx, copy: false })
    } else if (original) {
      const why = original.text === null ? 'no tiene su texto anotado' : 'dice otro texto'
      notes.push(`${line.file}: su original en --crudas ${why}; queda asi.`)
    } else if (item.fx) {
      notes.push(`${line.file}: ya tiene ${item.fx} y su original no esta en --crudas; queda asi.`)
    } else if (adopt) {
      jobs.push({ line, item, fx, copy: true })
    } else {
      notes.push(
        `${line.file}: su original no esta en --crudas; queda asi (si el mp3 no tiene efecto, --tomar-originales).`
      )
    }
  }
  return { jobs, notes }
}

/**
 * La entrada de una frase al rearmar el manifiesto. before: la anterior (o
 * null); exists: si esta su mp3; fresh: el efecto con que salio en esta
 * corrida (null, sin efecto), o undefined si no salio. La marca del efecto
 * sigue mientras el texto sea el mismo. El mp3 de un texto que cambio conserva
 * su entrada vieja: la pagina no lo usa (audioFor compara el texto) y la
 * proxima corrida lo regenera.
 */
export function manifestItem(line, before, { exists, fresh }) {
  if (!exists) return null
  if (fresh === undefined && before && before.text !== line.text) return before
  const item = { file: line.file, text: line.text }
  const same = before && before.text === line.text ? before.fx : null
  const fx = fresh === undefined ? same : fresh
  if (typeof fx === 'string') item.fx = fx
  return item
}
