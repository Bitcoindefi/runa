#!/usr/bin/env node
// Genera la musica de fondo de cada mapa con la Music API de ElevenLabs: una
// pieza de unos 60 segundos por mapa, pensada para repetirse sin corte. Corre en
// la compu de quien la genera, nunca en la pagina: la clave no sale de aca.
//
//   node scripts/generar-musica.mjs                 estima el costo, no gasta
//   node scripts/generar-musica.mjs --yes           genera lo que falta
//   node scripts/generar-musica.mjs --yes --only boss,meadow
//
// La clave se lee de ~/.config/elevenlabs/.env (ELEVENLABS_API_KEY=...) o de
// --env <archivo>. No se imprime nunca.
//
// Escribe assets/musica/<mapa>.mp3 (mono, 48 kbps, con fundido corto al
// principio y al final para esconder la costura del bucle) y
// assets/musica/manifest.json. Un mp3 que ya existe no se vuelve a pedir.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { TRACKS } from './tripo-musica-pistas.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets', 'musica')
const API = 'https://api.elevenlabs.io'
const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at === -1 ? fallback : argv[at + 1]
}
const flag = (name) => argv.includes('--' + name)

const YES = flag('yes')
const ONLY = option('only', null)
const SECONDS = Number(option('seconds', 60))
const FORMAT = option('format', 'mp3_44100_64')
const ENV = option('env', path.join(os.homedir(), '.config', 'elevenlabs', '.env'))
const FFMPEG = option(
  'ffmpeg',
  path.join(
    os.homedir(),
    'AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.1-full_build/bin/ffmpeg.exe'
  )
)
const JOBS = Number(option('jobs', 2))

// Lo que se agrega a cada pedido: que se pueda repetir sin corte.
const LOOP =
  'Instrumental only, no vocals. Seamless loopable background music for a fantasy RPG, ' +
  'no intro and no ending, consistent tempo and key from start to finish, ' +
  'original composition, no references to existing songs or artists.'

function readKey() {
  const text = fs.readFileSync(ENV, 'utf8')
  const match = /ELEVENLABS_API_KEY\s*=\s*"?([^\s"]+)/.exec(text)
  if (!match) throw new Error(`No hay ELEVENLABS_API_KEY en ${ENV}`)
  return match[1]
}

async function credits(key) {
  const res = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': key } })
  if (!res.ok) throw new Error(`subscription: ${res.status} ${await res.text()}`)
  const sub = await res.json()
  return {
    used: sub.character_count,
    limit: sub.character_limit,
    left: sub.character_limit - sub.character_count
  }
}

async function compose(key, track) {
  const url = `${API}/v1/music?output_format=${encodeURIComponent(FORMAT)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: `${track.prompt} ${LOOP}`,
      music_length_ms: SECONDS * 1000,
      model_id: 'music_v1',
      force_instrumental: true
    })
  })
  if (!res.ok) throw new Error(`music ${track.id}: ${res.status} ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

// Mono a 48 kbps con fundido de entrada y salida para la costura del bucle.
function shrink(raw, file, seconds) {
  const tmp = file + '.crudo.mp3'
  fs.writeFileSync(tmp, raw)
  const fadeOut = Math.max(0, seconds - 1.2).toFixed(2)
  const filter = `afade=t=in:d=0.6,afade=t=out:st=${fadeOut}:d=1.2`
  const args = ['-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-b:a', '48k', '-af', filter]
  execFileSync(FFMPEG, [...args, file], { stdio: 'inherit' })
  fs.unlinkSync(tmp)
}

function writeManifest() {
  const tracks = TRACKS.filter((t) => fs.existsSync(path.join(OUT, `${t.id}.mp3`))).map((t) => {
    const bytes = fs.statSync(path.join(OUT, `${t.id}.mp3`)).size
    // 48 kbps son 6000 bytes por segundo.
    return {
      id: t.id,
      file: `${t.id}.mp3`,
      seconds: Math.round(bytes / 6000),
      kb: Math.round(bytes / 1024),
      prompt: t.prompt
    }
  })
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ tracks }, null, 2) + '\n')
  return tracks
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const wanted = ONLY ? ONLY.split(',') : null
  const todo = TRACKS.filter(
    (t) => (!wanted || wanted.includes(t.id)) && !fs.existsSync(path.join(OUT, `${t.id}.mp3`))
  )
  const key = readKey()
  const before = await credits(key)
  console.log(`Creditos: ${before.left} libres de ${before.limit}`)
  console.log(`Faltan ${todo.length} pistas: ${todo.map((t) => t.id).join(', ') || 'ninguna'}`)
  console.log(`Minutos a pedir: ${((todo.length * SECONDS) / 60).toFixed(1)}`)
  if (!YES || !todo.length) {
    if (todo.length) console.log('Sin --yes no se gasta nada.')
    writeManifest()
    return
  }
  const queue = [...todo]
  const worker = async () => {
    while (queue.length) {
      const track = queue.shift()
      const started = Date.now()
      try {
        const raw = await compose(key, track)
        const file = path.join(OUT, `${track.id}.mp3`)
        shrink(raw, file, SECONDS)
        const kb = Math.round(fs.statSync(file).size / 1024)
        console.log(`${track.id}: ${kb} KB en ${Math.round((Date.now() - started) / 1000)} s`)
      } catch (error) {
        console.error(error.message)
      }
    }
  }
  await Promise.all(Array.from({ length: JOBS }, worker))
  writeManifest()
  const after = await credits(key)
  console.log(`Creditos: ${after.left} libres (se usaron ${before.left - after.left})`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
