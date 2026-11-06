#!/usr/bin/env node
// Genera las voces de los NPC con ElevenLabs: una voz por NPC (Voice Design) y
// un mp3 por frase (Text to Speech), con los datos de scripts/tripo-voces-npc.mjs.
// Corre en la compu de quien lo genera; la clave nunca sale de aca.
//
//   node scripts/generar-voces-npc.mjs            cuenta letras, no gasta
//   node scripts/generar-voces-npc.mjs --yes      genera lo que falta
//
// Escribe assets/voces-npc/voces.json (id de voz por NPC),
// assets/voces-npc/<id>/en/<n>.mp3 y assets/voces-npc/manifest.json (texto
// exacto en ingles -> mp3, y en faces los retratos de assets/retratos-npc).
// Con --yes y nada pendiente solo rehace el manifiesto, sin gastar.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NPC_VOICES, allNpcLines, npcSample } from './tripo-voces-npc.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets', 'voces-npc')
const FACES = path.join(ROOT, 'assets', 'retratos-npc')
const API = 'https://api.elevenlabs.io'
const YES = process.argv.includes('--yes')
const MODEL = 'eleven_multilingual_v2'
const DESIGN_MODEL = 'eleven_multilingual_ttv_v2'
const FORMAT = 'mp3_22050_32'
const ENV = path.join(os.homedir(), '.config', 'elevenlabs', '.env')
const LIMIT = 25000

function readKey() {
  const text = fs.readFileSync(ENV, 'utf8').replace(/^﻿/, '')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('ELEVENLABS_API_KEY') || !line.includes('=')) continue
    const value = line
      .slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (value) return value
  }
  throw new Error('Falta ELEVENLABS_API_KEY en el .env')
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

// Un pedido con reintentos si la API esta ocupada; los errores no muestran la clave.
async function call(key, route, body, binary = false) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + route, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        Accept: binary ? 'audio/mpeg' : 'application/json'
      },
      body: JSON.stringify(body)
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
    throw new Error(`ElevenLabs ${route.split('?')[0]}: ${res.status} ${detail}`)
  }
}

async function voiceFor(key, id, voices) {
  if (voices[id] && voices[id].voice_id) return voices[id].voice_id
  const npc = NPC_VOICES[id]
  console.log(`  disenando la voz de ${id}...`)
  const designed = await call(key, '/v1/text-to-voice/design', {
    voice_description: npc.brief,
    model_id: DESIGN_MODEL,
    text: npcSample(id)
  })
  const preview = designed.previews && designed.previews[0]
  if (!preview || !preview.generated_voice_id) throw new Error(`sin muestras para ${id}`)
  const saved = await call(key, '/v1/text-to-voice', {
    voice_name: `Runa NPC ${npc.name}`,
    voice_description: npc.brief,
    generated_voice_id: preview.generated_voice_id,
    labels: { game: 'runa', npc: id }
  })
  voices[id] = { voice_id: saved.voice_id, name: npc.name, description: npc.brief }
  writeJson(path.join(OUT, 'voces.json'), voices)
  return saved.voice_id
}

function buildManifest() {
  const lines = {}
  for (const line of allNpcLines()) {
    if (fs.existsSync(path.join(OUT, line.file))) lines[line.text] = line.file
  }
  // Los retratos que hay (Rosebud): la caja de dialogo no pide los que faltan.
  const faces = fs.existsSync(FACES)
    ? fs
        .readdirSync(FACES)
        .filter((name) => /^[a-z-]+\.webp$/.test(name))
        .map((name) => name.slice(0, -'.webp'.length))
        .sort()
    : []
  return { version: 1, lang: 'en', model: MODEL, format: FORMAT, lines, faces }
}

async function main() {
  const todo = allNpcLines().filter((line) => !fs.existsSync(path.join(OUT, line.file)))
  const ttsChars = todo.reduce((sum, line) => sum + line.text.length, 0)
  const voices = readJson(path.join(OUT, 'voces.json'), {})
  const designIds = [...new Set(todo.map((line) => line.id))].filter((id) => !voices[id])
  const designChars = designIds.reduce((sum, id) => sum + npcSample(id).length, 0)
  console.log(
    `${todo.length} frases (${ttsChars} letras) y ${designIds.length} voces nuevas (~${designChars} letras de muestra).`
  )
  if (ttsChars + designChars > LIMIT) throw new Error(`Pasa el tope de ${LIMIT} letras`)
  if (!YES) return console.log('Sin --yes no se gasta nada.')
  // Varios NPC a la vez, de a tres, para que no tarde tanto. Sin nada pendiente
  // no hace falta la clave: solo se rehace el manifiesto.
  const ids = [...new Set(todo.map((line) => line.id))]
  const key = ids.length ? readKey() : null
  const work = async (id) => {
    try {
      const voice = await voiceFor(key, id, voices)
      for (const line of todo.filter((item) => item.id === id)) {
        const audio = await call(
          key,
          `/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${FORMAT}`,
          {
            text: line.text,
            model_id: MODEL,
            voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 }
          },
          true
        )
        const file = path.join(OUT, line.file)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, audio)
        console.log(`  ${line.file}`)
      }
    } catch (error) {
      console.error(`  ${id}: ${error.message}`)
    }
  }
  for (let at = 0; at < ids.length; at += 3) await Promise.all(ids.slice(at, at + 3).map(work))
  writeJson(path.join(OUT, 'manifest.json'), buildManifest())
  console.log('Listo: assets/voces-npc/manifest.json')
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
