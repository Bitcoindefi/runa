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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MONSTERS,
  LANGS,
  allLines,
  voiceDescription,
  sampleText,
  validateManifest
} from './tripo-voces.mjs'

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

// Las frases que hacen falta: las que no tienen mp3, o cuyo texto cambio desde
// el manifiesto anterior.
function pending(manifest) {
  const only = ONLY ? new Set(ONLY.split(',')) : null
  for (const id of only || []) if (!MONSTERS[id]) fail(`--only: no conozco ${id}`)
  if (LANG && !LANGS.includes(LANG)) fail(`--lang: en o es`)
  return allLines().filter((line) => {
    if (only && !only.has(line.monster)) return false
    if (LANG && line.lang !== LANG) return false
    const file = path.join(OUT, line.file)
    if (!fs.existsSync(file)) return true
    const before = oldText(manifest, line)
    return before !== null && before !== line.text
  })
}

function oldText(manifest, line) {
  const entry = manifest && manifest.monsters && manifest.monsters[line.monster]
  const list = entry && entry.lines && entry.lines[line.lang] && entry.lines[line.lang][line.event]
  const item = Array.isArray(list) ? list[line.index] : null
  return item && typeof item.text === 'string' ? item.text : null
}

// El manifiesto de lo que hay en disco: cada frase con su mp3 (null si falta).
function buildManifest(previous, voices, fresh) {
  const manifest = {
    version: 1,
    model: MODEL,
    format: FORMAT,
    generated: new Date().toISOString(),
    monsters: {}
  }
  for (const line of allLines()) {
    const exists = fs.existsSync(path.join(OUT, line.file))
    // Un mp3 de un texto viejo no cuenta: la pagina solo mostraria el globo.
    const before = oldText(previous, line)
    const stale = exists && !fresh.has(line.file) && before !== null && before !== line.text
    const entry = (manifest.monsters[line.monster] ||= {
      voice: (voices.monsters[line.monster] || {}).voice_id || null,
      lines: {}
    })
    const lang = (entry.lines[line.lang] ||= {})
    const list = (lang[line.event] ||= [])
    list[line.index] = exists && !stale ? { file: line.file, text: line.text } : null
  }
  if (previous && previous.sfx) manifest.sfx = previous.sfx
  return manifest
}

async function main() {
  const manifestFile = path.join(OUT, 'manifest.json')
  const previous = readJson(manifestFile, null)
  const voices = readJson(path.join(OUT, 'voces.json'), { version: 1, monsters: {} })
  voices.monsters ||= {}
  const todo = pending(previous)
  // Los mp3 de esta corrida: ya dicen el texto de ahora.
  const fresh = new Set()
  const monsters = [...new Set(todo.map((line) => line.monster))]
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

  let done = 0
  for (const monster of monsters) {
    const voice = await voiceFor(key, monster, voices)
    const settings = MONSTERS[monster].voice
    const mine = todo.filter((line) => line.monster === monster)
    console.log(`${monster}: ${mine.length} frases`)
    // De a dos: la API limita los pedidos simultaneos segun el plan.
    const queue = [...mine]
    const worker = async () => {
      for (let line = queue.shift(); line; line = queue.shift()) {
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
        const file = path.join(OUT, line.file)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, audio)
        fresh.add(line.file)
        done++
      }
    }
    await Promise.all([worker(), worker()])
    // Despues de cada monstruo: si algo se corta, lo hecho queda anotado.
    writeJson(manifestFile, buildManifest(previous, voices, fresh))
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
