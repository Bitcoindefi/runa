#!/usr/bin/env node
// Genera las voces de los monstruos con ElevenLabs: una voz por monstruo
// (Voice Design) y un mp3 por frase (Text to Speech), con las frases de
// scripts/tripo-voces.mjs. Corre en la compu de quien lo genera, nunca en la
// pagina: la clave no sale de aca.
//
//   node scripts/generar-voces.mjs                  cuenta y estima, no gasta
//   node scripts/generar-voces.mjs --yes            genera lo que falta
//   node scripts/generar-voces.mjs --yes --only mosquito,skeleton --lang es
//   node scripts/generar-voces.mjs --yes --sfx      ademas, unos efectos
//   node scripts/generar-voces.mjs --yes --crudas <carpeta>       hace falta con fx
//   node scripts/generar-voces.mjs --fx --crudas <carpeta>        cuenta, no toca
//   node scripts/generar-voces.mjs --yes --fx --crudas <carpeta>  efecto a lo que hay
//
// La clave se lee de ~/.config/elevenlabs/.env (ELEVENLABS_API_KEY=...) o de
// --env <archivo>. No se imprime nunca.
//
// Escribe:
//   assets/voces/voces.json                  el id de voz de cada monstruo
//   assets/voces/<monstruo>/<idioma>/<evento>-<n>.mp3
//   assets/voces/manifest.json               que mp3 hay y que texto dice
//   assets/voces/sfx/<nombre>.mp3            con --sfx
// Un mp3 que ya existe con el mismo texto no se vuelve a pedir. Detalles en
// docs/voces.md.
//
// Un monstruo con fx (el mosquito) pasa cada frase nueva por ffmpeg justo
// despues de Text to Speech (scripts/voces-efectos.mjs) y el manifiesto anota
// el efecto en la frase. El original queda en --crudas (fuera del repositorio,
// con las mismas rutas) y su texto al lado, en <archivo>.mp3.txt. --fx aplica
// el efecto a los mp3 que ya estaban, siempre desde su original en --crudas y
// solo si ese original dice el texto de ahora: nunca sobre un mp3 que quiza ya
// lo tiene. --tomar-originales copia a --crudas los mp3 sin marca que no tienen
// original, como originales del texto de ahora: solo si de verdad no tienen
// ningun efecto (la primera vez).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  MONSTERS,
  LANGS,
  allLines,
  voiceDescription,
  sampleText,
  validateManifest
} from './tripo-voces.mjs'
import {
  LIMITS,
  fxOf,
  fxArgs,
  fxJobs,
  firstGain,
  loudnessArgs,
  decodeArgs,
  parseLoudness,
  parseStream,
  checkRender,
  nextLevel,
  usable,
  mp3Format,
  entryOf,
  manifestItem
} from './voces-efectos.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets', 'voces')
const API = 'https://api.elevenlabs.io'
const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at === -1 ? fallback : argv[at + 1]
}
const flag = (name) => argv.includes('--' + name)

const YES = flag('yes')
const SFX = flag('sfx')
const MODEL = option('model', 'eleven_multilingual_v2')
const DESIGN_MODEL = option('design-model', 'eleven_multilingual_ttv_v2')
const FORMAT = option('format', 'mp3_44100_64')
const ENV = option('env', path.join(os.homedir(), '.config', 'elevenlabs', '.env'))
const ONLY = option('only', null)
const LANG = option('lang', null)
const FX_MODE = flag('fx')
const CRUDAS = option('crudas', null)
const ADOPT = flag('tomar-originales')

// Los efectos de --sfx: nombre, pedido y duracion en segundos.
const EFFECTS = [
  ['colossus_roar', 'Colossal stone giant roaring, deep rumbling earthquake growl', 2.5],
  ['colossus_slam', 'Huge stone fist slamming the ground, heavy impact with debris', 1.5],
  ['skeleton_rattle', 'Dry bones rattling, skeleton clattering', 1.2],
  ['mosquito_buzz', 'Tiny mosquito buzzing close to the ear', 1.5],
  ['slime_squish', 'Wet gooey slime squish and splat', 1],
  ['sword_clash', 'Steel sword hitting a shield, short metallic clang', 0.8]
]

function fail(message) {
  console.error(message)
  process.exit(1)
}

// La clave del .env, sin mostrarla. Solo ELEVENLABS_API_KEY.
function readKey() {
  if (!fs.existsSync(ENV)) {
    fail(
      `No encontre ${ENV}.\n` +
        'Crealo con una linea ELEVENLABS_API_KEY=... (la clave de elevenlabs.io > Developers > API keys).'
    )
  }
  const text = fs.readFileSync(ENV, 'utf8').replace(/^﻿/, '')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('ELEVENLABS_API_KEY')) continue
    const value = line
      .slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (line.includes('=') && value) return value
  }
  fail(`${ENV} no tiene ELEVENLABS_API_KEY=... (o esta vacia).`)
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Un pedido a la API con reintentos si esta ocupada (429 o 5xx). Los errores
// dicen el codigo y el detalle del servidor, nunca la clave.
async function call(key, method, route, body, binary = false) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + route, {
      method,
      headers: {
        'xi-api-key': key,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Accept: binary ? 'audio/mpeg' : 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })
    if (res.ok) return binary ? Buffer.from(await res.arrayBuffer()) : res.json()
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1500 * (attempt + 1))
      continue
    }
    let detail = ''
    try {
      detail = JSON.stringify((await res.json()).detail || '').slice(0, 300)
    } catch {
      // Sin cuerpo legible.
    }
    if (res.status === 401) throw new Error('ElevenLabs rechazo la clave (401). Revisa el .env.')
    throw new Error(`ElevenLabs ${method} ${route.split('?')[0]}: ${res.status} ${detail}`)
  }
}

// La voz de un monstruo: la de voces.json o una nueva con Voice Design (se
// toma la primera muestra y se guarda en la cuenta).
async function voiceFor(key, monster, voices) {
  const known = voices.monsters[monster]
  if (known && known.voice_id) return known.voice_id
  const description = voiceDescription(monster)
  console.log(`  disenando la voz de ${monster}...`)
  const designed = await call(key, 'POST', '/v1/text-to-voice/design', {
    voice_description: description,
    model_id: DESIGN_MODEL,
    text: sampleText(monster)
  })
  const preview = designed.previews && designed.previews[0]
  if (!preview || !preview.generated_voice_id) throw new Error(`sin muestras para ${monster}`)
  const saved = await call(key, 'POST', '/v1/text-to-voice', {
    voice_name: `Runa ${MONSTERS[monster].name[0]}`,
    voice_description: description,
    generated_voice_id: preview.generated_voice_id,
    labels: { game: 'runa', monster }
  })
  voices.monsters[monster] = {
    voice_id: saved.voice_id,
    name: `Runa ${MONSTERS[monster].name[0]}`,
    description,
    source: 'design',
    model: DESIGN_MODEL
  }
  writeJson(path.join(OUT, 'voces.json'), voices)
  return saved.voice_id
}

// Los monstruos y el idioma de --only y --lang (null: todos).
function selection() {
  const only = ONLY ? new Set(ONLY.split(',')) : null
  for (const id of only || []) if (!MONSTERS[id]) fail(`--only: no conozco ${id}`)
  if (LANG && !LANGS.includes(LANG)) fail(`--lang: en o es`)
  return (line) => (!only || only.has(line.monster)) && (!LANG || line.lang === LANG)
}

// Las frases que hacen falta: las que no tienen mp3, o cuyo texto cambio desde
// el manifiesto anterior.
function pending(manifest) {
  const chosen = selection()
  return allLines().filter((line) => {
    if (!chosen(line)) return false
    const file = path.join(OUT, line.file)
    if (!fs.existsSync(file)) return true
    const before = oldText(manifest, line)
    return before !== null && before !== line.text
  })
}

function oldText(manifest, line) {
  const item = entryOf(manifest, line)
  return item ? item.text : null
}

// El efecto de una frase: el suyo (LINE_FX) o el de su monstruo, o null.
const fxFor = (line) => fxOf(line, MONSTERS[line.monster].fx)

// ffmpeg con una lista de argumentos, sin shell. Sin ffmpeg, un error claro.
function ffmpeg(args, binary = false) {
  const run = spawnSync('ffmpeg', args, {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 1 << 28,
    windowsHide: true
  })
  if (run.error && run.error.code === 'ENOENT') {
    throw new Error(
      'No encontre ffmpeg en el PATH y hace falta para el efecto de voz (fx). ' +
        'Instalalo (https://ffmpeg.org) y volve a correr.'
    )
  }
  if (run.error) throw run.error
  return run
}

// Lo que se mide de un mp3: si decodifica, si hay NaN, la duracion, la
// loudness integrada, el pico verdadero y, si es mp3, su tasa y sus kbit/s.
function measure(file) {
  const rate = 22050
  const pcm = ffmpeg(decodeArgs(file, rate), true)
  if (pcm.status !== 0 || !pcm.stdout.length) return { decoded: false }
  const bytes = new Uint8Array(pcm.stdout)
  const samples = new Float32Array(bytes.buffer, 0, bytes.length >> 2)
  const { stderr } = ffmpeg(loudnessArgs(file))
  return {
    decoded: true,
    finite: samples.every(Number.isFinite),
    seconds: samples.length / rate,
    ...parseLoudness(stderr),
    ...parseStream(stderr)
  }
}

// Un paso de ffmpeg: los problemas (vacio si salio bien).
function step(args) {
  const run = ffmpeg(args)
  return run.status === 0 ? [] : [`ffmpeg: ${String(run.stderr).trim().split('\n').pop()}`]
}

// Una carpeta temporal fuera del repositorio para los archivos de ffmpeg.
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'runa-fx-'))

// Pasa `input` (el mp3 crudo) por el efecto `name` y deja el resultado en
// `output`, con la misma tasa y los mismos kbit/s que `input`. Cada intento
// hace las dos pasadas en una carpeta temporal y mide la salida (checkRender);
// si el nivel quedo lejos, corrige la ganancia y el techo y prueba de nuevo,
// hasta LIMITS.tries veces, y se queda con la mejor salida que cumple. Si
// ninguna cumple, error y `output` queda como estaba.
function applyFx(name, input, output) {
  const source = measure(input)
  if (!source.decoded || !Number.isFinite(source.I)) {
    throw new Error(`${path.basename(input)}: no pude medir el original para el efecto ${name}`)
  }
  if (!source.rate || !source.kbps) {
    throw new Error(`${path.basename(input)}: el original no dice su tasa y sus kbit/s de mp3`)
  }
  const aim = source.I + LIMITS.offset
  const dir = tempDir()
  const voice = path.join(dir, 'voz.wav')
  const tmp = path.join(dir, 'salida.mp3')
  const keep = path.join(dir, 'mejor.mp3')
  let level = null
  let last = null
  let best = null
  let problems = []
  try {
    const passes = fxArgs(name, input, tmp, { voice, rate: source.rate, kbps: source.kbps })
    for (let attempt = 0; attempt < LIMITS.tries; attempt++) {
      problems = step(passes.voice)
      if (!problems.length && !level) {
        const voiceI = parseLoudness(ffmpeg(loudnessArgs(voice)).stderr).I
        level = { gain: firstGain(name, aim, voiceI), ceiling: LIMITS.ceiling }
      }
      if (!problems.length) problems = step(passes.mix(level))
      const result = problems.length ? { decoded: false } : measure(tmp)
      if (!problems.length) problems = checkRender(source, result)
      if (!problems.length) {
        const off = Math.abs(result.I - aim)
        if (best === null || off < best) {
          fs.renameSync(tmp, keep)
          best = off
        }
        if (off <= LIMITS.aim) break
      }
      if (!level) continue
      const next = nextLevel(level, aim, result, last)
      if (usable(aim, result)) last = { level, result }
      level = next
    }
    if (best === null) {
      throw new Error(
        `${path.basename(output)}: el efecto ${name} no salio bien en ${LIMITS.tries} intentos (${problems.join('; ')})`
      )
    }
    fs.copyFileSync(keep, output)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Antes de gastar: cada efecto existe y este ffmpeg corre sus dos pasadas
// (con 0,2 s de silencio, en una carpeta temporal).
function checkFx(names, format) {
  const dir = tempDir()
  try {
    const input = path.join(dir, 'silencio.mp3')
    const made = step([
      ...['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi'],
      ...['-i', `anullsrc=r=${format.rate}:cl=mono`, '-t', '0.2', '-b:a', `${format.kbps}k`, input]
    ])
    if (made.length) throw new Error(`ffmpeg no pudo armar la prueba del efecto: ${made[0]}`)
    for (const name of names) {
      const output = path.join(dir, 'prueba.mp3')
      const passes = fxArgs(name, input, output, { voice: path.join(dir, 'voz.wav'), ...format })
      let problems = step(passes.voice)
      if (!problems.length) problems = step(passes.mix({ ceiling: LIMITS.ceiling }))
      if (problems.length) {
        throw new Error(`el efecto ${name} no corre en este ffmpeg: ${problems[0]}`)
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// La carpeta de los originales tiene que quedar fuera del repositorio.
function crudasDir() {
  if (!CRUDAS) return null
  const dir = path.resolve(CRUDAS)
  const rel = path.relative(ROOT, dir)
  const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)
  if (!rel || !outside) fail('--crudas tiene que ser una carpeta fuera del repositorio.')
  return dir
}

// El original de una frase en --crudas: null si no esta; { text } con el texto
// anotado en <archivo>.mp3.txt, o text null si no lo tiene.
function readRaw(raw) {
  if (!fs.existsSync(raw)) return null
  const note = raw + '.txt'
  if (!fs.existsSync(note)) return { text: null }
  const text = fs.readFileSync(note, 'utf8')
  return { text: text.replace(/^\uFEFF/, '').replace(/\r?\n$/, '') }
}

// Guarda un original y su texto al lado. El texto viejo se borra antes: un
// corte nunca deja un original con el texto de otro.
function saveRaw(raw, audio, text) {
  fs.mkdirSync(path.dirname(raw), { recursive: true })
  fs.rmSync(raw + '.txt', { force: true })
  fs.writeFileSync(raw, audio)
  fs.writeFileSync(raw + '.txt', text)
}

// --fx: el efecto de cada frase con fx (fxFor) sobre su mp3, si el manifiesto
// no lo marca con ese efecto. Sale siempre de su original en --crudas y solo si
// ese original dice el texto de ahora (fxJobs): correrlo otra vez, o despues
// de un corte, no lo aplica dos veces.
function applyToExisting(manifestFile, manifest) {
  if (!manifest) fail('No hay manifiesto: primero hay que generar las voces.')
  const crudas = crudasDir()
  if (!crudas) fail('--fx necesita --crudas <carpeta>: la de los originales.')
  const { jobs, notes } = fxJobs(allLines().filter(selection()), manifest, {
    fxOf: fxFor,
    exists: (file) => fs.existsSync(path.join(OUT, file)),
    raw: (file) => readRaw(path.join(crudas, file)),
    adopt: ADOPT
  })
  for (const note of notes) console.log(`  ${note}`)
  console.log(`Frases para pasar por su efecto: ${jobs.length}.`)
  if (!jobs.length) return
  if (!YES) {
    console.log('No se toco nada. Para aplicarlo, corre de nuevo con --yes.')
    return
  }
  ffmpeg(['-hide_banner', '-version'])
  for (const job of jobs) {
    const file = path.join(OUT, job.line.file)
    const raw = path.join(crudas, job.line.file)
    if (job.copy) saveRaw(raw, fs.readFileSync(file), job.line.text)
    applyFx(job.fx, raw, file)
    job.item.fx = job.fx
    // Despues de cada frase: si algo se corta, lo hecho queda anotado.
    writeJson(manifestFile, manifest)
    console.log(`  ${job.line.file}: ${job.fx}`)
  }
  console.log(
    `Listo: ${jobs.length} frases con efecto. ${path.relative(ROOT, manifestFile)} al dia.`
  )
}

// El manifiesto de lo que hay en disco: cada frase con su mp3 (null si falta)
// y, si lo tiene, su efecto (manifestItem). fresh: los mp3 de esta corrida y su
// efecto. El formato es el de esta corrida si genero algo; si no, el de antes.
function buildManifest(previous, voices, fresh) {
  const manifest = {
    version: 1,
    model: MODEL,
    format: fresh.size || !previous || !previous.format ? FORMAT : previous.format,
    generated: new Date().toISOString(),
    monsters: {}
  }
  for (const line of allLines()) {
    const exists = fs.existsSync(path.join(OUT, line.file))
    const entry = (manifest.monsters[line.monster] ||= {
      voice: (voices.monsters[line.monster] || {}).voice_id || null,
      lines: {}
    })
    const lang = (entry.lines[line.lang] ||= {})
    const list = (lang[line.event] ||= [])
    list[line.index] = manifestItem(line, entryOf(previous, line), {
      exists,
      fresh: fresh.has(line.file) ? fresh.get(line.file) : undefined
    })
  }
  if (previous && previous.sfx) manifest.sfx = previous.sfx
  return manifest
}

// Guarda el mp3 de Text to Speech de una frase. Con efecto, el original queda
// en --crudas con su texto y lo que va a assets es la salida del efecto; si el
// efecto falla, el original igual queda.
function saveLine(line, audio, crudas) {
  const file = path.join(OUT, line.file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const fx = fxFor(line)
  if (!fx) {
    fs.writeFileSync(file, audio)
    return null
  }
  const raw = path.join(crudas, line.file)
  saveRaw(raw, audio, line.text)
  try {
    applyFx(fx, raw, file)
  } catch (error) {
    error.message += ` (el original quedo en ${raw})`
    throw error
  }
  return fx
}

async function main() {
  const manifestFile = path.join(OUT, 'manifest.json')
  const previous = readJson(manifestFile, null)
  crudasDir()
  if (FX_MODE) return applyToExisting(manifestFile, previous)
  const voices = readJson(path.join(OUT, 'voces.json'), { version: 1, monsters: {} })
  voices.monsters ||= {}
  const todo = pending(previous)
  // Los mp3 de esta corrida (ya dicen el texto de ahora) y su efecto.
  const fresh = new Map()
  const monsters = [...new Set(todo.map((line) => line.monster))]
  const effects = [...new Set(todo.map(fxFor).filter(Boolean))]
  const crudas = crudasDir()
  const design = monsters.filter((id) => !(voices.monsters[id] && voices.monsters[id].voice_id))
  const chars = todo.reduce((sum, line) => sum + line.text.length, 0)
  const designChars = design.reduce((sum, id) => sum + sampleText(id).length, 0)
  const sfx = SFX
    ? EFFECTS.filter(([name]) => !fs.existsSync(path.join(OUT, 'sfx', name + '.mp3')))
    : []

  console.log(`Modelo ${MODEL}, formato ${FORMAT}.`)
  console.log(
    `Frases por generar: ${todo.length} (${chars} caracteres) de ${monsters.length} monstruos.`
  )
  console.log(
    `Voces por disenar: ${design.length} (${design.join(', ') || 'ninguna'}), muestras de ${designChars} caracteres.`
  )
  if (SFX) console.log(`Efectos por generar: ${sfx.length}.`)
  if (effects.length) {
    console.log(`Con efecto de voz (ffmpeg): ${effects.join(', ')}. Los originales van a --crudas.`)
    if (!crudas) console.log('Sin --crudas <carpeta> no se genera nada con efecto.')
  }
  console.log(
    `Estimado: unos ${chars + designChars} creditos de texto (1 por caracter en ${MODEL})` +
      (sfx.length ? ` mas los efectos (se cobran por segundo).` : '.')
  )
  if (!todo.length && !sfx.length) {
    writeJson(manifestFile, buildManifest(previous, voices, fresh))
    console.log('No falta nada. Manifiesto al dia.')
    return
  }

  if (!YES && !fs.existsSync(ENV)) {
    console.log(`Todavia no hay clave en ${ENV}. No se gasto nada.`)
    return
  }
  const key = readKey()
  try {
    const sub = await call(key, 'GET', '/v1/user/subscription')
    const left = Number(sub.character_limit) - Number(sub.character_count)
    if (Number.isFinite(left)) console.log(`Te quedan ${left} creditos este mes (${sub.tier}).`)
  } catch (error) {
    console.log(`No pude leer los creditos: ${error.message}`)
  }
  if (!YES) {
    console.log('No se gasto nada. Para generar, corre de nuevo con --yes.')
    return
  }
  // Antes de gastar: el efecto necesita --crudas (ahi queda cada original con
  // su texto), un formato mp3 y un ffmpeg que corra sus dos pasadas.
  if (effects.length) {
    if (!crudas) fail('Las frases con efecto necesitan --crudas <carpeta>. No se gasto nada.')
    checkFx(effects, mp3Format(FORMAT))
  }

  let done = 0
  for (const monster of monsters) {
    const voice = await voiceFor(key, monster, voices)
    const settings = MONSTERS[monster].voice
    const mine = todo.filter((line) => line.monster === monster)
    console.log(`${monster}: ${mine.length} frases`)
    // De a dos: la API limita los pedidos simultaneos segun el plan. Si algo
    // falla, no se piden mas, pero lo que ya venia se guarda.
    const queue = [...mine]
    let failure = null
    const worker = async () => {
      while (queue.length && !failure) {
        const line = queue.shift()
        try {
          const audio = await call(
            key,
            'POST',
            `/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${FORMAT}`,
            {
              text: line.text,
              model_id: MODEL,
              voice_settings: {
                stability: settings.stability,
                similarity_boost: 0.75,
                style: 0.35,
                use_speaker_boost: true,
                speed: settings.speed
              }
            },
            true
          )
          const fx = saveLine(line, audio, crudas)
          fresh.set(line.file, fx)
          // Con efecto, enseguida: un mp3 procesado nunca queda sin su marca.
          if (fx) writeJson(manifestFile, buildManifest(previous, voices, fresh))
          done++
        } catch (error) {
          failure ||= error
        }
      }
    }
    await Promise.all([worker(), worker()])
    // Despues de cada monstruo: si algo se corta, lo hecho queda anotado.
    writeJson(manifestFile, buildManifest(previous, voices, fresh))
    if (failure) throw failure
  }

  for (const [name, text, seconds] of sfx) {
    const audio = await call(
      key,
      'POST',
      `/v1/sound-generation?output_format=${FORMAT}`,
      { text, duration_seconds: seconds, prompt_influence: 0.5 },
      true
    )
    const file = path.join(OUT, 'sfx', name + '.mp3')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, audio)
    console.log(`  efecto ${name}`)
  }

  const manifest = buildManifest(previous, voices, fresh)
  if (SFX || (previous && previous.sfx)) {
    manifest.sfx = {}
    for (const [name] of EFFECTS) {
      const there = fs.existsSync(path.join(OUT, 'sfx', name + '.mp3'))
      if (there) manifest.sfx[name] = `sfx/${name}.mp3`
    }
  }
  const errors = validateManifest(manifest)
  if (errors.length) fail(`El manifiesto salio con problemas: ${errors.slice(0, 5).join('; ')}`)
  writeJson(manifestFile, manifest)
  console.log(`Listo: ${done} frases nuevas. ${path.relative(ROOT, manifestFile)} al dia.`)
}

main().catch((error) => fail(error.message))
