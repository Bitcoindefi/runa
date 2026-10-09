#!/usr/bin/env node
'use strict'

// Visor local de los GLB de Tripo, al lado de la terminal del juego.
// Sirve dos paginas: / con los GLB girando, y /heroe con el stickman 3D que lleva
// el equipo de la ultima partida guardada. No toca la API ni ve la key.
//
//   node scripts/tripo-viewer.js --fetch-lib   baja model-viewer y three.js una vez, con wifi
//   node scripts/tripo-viewer.js               http://127.0.0.1:4173/ y /heroe

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { items } = require('../lib/content.js')

const root = path.resolve(__dirname, '..')
const MODELS = path.join(root, 'assets/tripo')
const VENDOR = path.join(root, 'vendor')
const PAGES = {
  '/': path.join(__dirname, 'tripo-viewer.html'),
  '/models.html': path.join(__dirname, 'tripo-viewer.html'),
  '/heroe': path.join(__dirname, 'tripo-heroe.html'),
  '/mundo': path.join(__dirname, 'tripo-heroe.html')
}
const WORLD_JS = path.join(__dirname, 'tripo-mundo.js')
// Cada archivo de terceros con su origen y su sha256: si el CDN devuelve otra
// cosa, no se guarda. three.module.min.js importa ./three.core.js, por eso el
// core minificado se guarda con ese nombre.
const THREE = 'https://cdn.jsdelivr.net/npm/three@0.186.1/'
const LIBS = {
  'model-viewer.min.js': [
    'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js',
    '283b0672384614b4847636c306fc93fe4b1fcadc76d668b4e47f0ca76bcf033b'
  ],
  'three/three.module.min.js': [
    THREE + 'build/three.module.min.js',
    '3bc833fceb6577bd1a380388f832ae61cd6e2f78ad02b0bf0d5adf5a4a9334fe'
  ],
  'three/three.core.js': [
    THREE + 'build/three.core.min.js',
    '3b346151f65ffdfca3e4c002bd58966b78c423087fb48a873f83200de1bffc48'
  ],
  'three/addons/loaders/GLTFLoader.js': [
    THREE + 'examples/jsm/loaders/GLTFLoader.js',
    '131c0f78c01d19368ae495caa65b3adaa10487810a36a05bb5901b769a35ac16'
  ],
  'three/addons/utils/BufferGeometryUtils.js': [
    THREE + 'examples/jsm/utils/BufferGeometryUtils.js',
    '9fb63427ce6641fa14fd0baff9cc4d1b5f9c3d85fd084bf2e90e803c44ec1797'
  ],
  'three/addons/utils/SkeletonUtils.js': [
    THREE + 'examples/jsm/utils/SkeletonUtils.js',
    'b1632a703206c3d830de9fcbe515696770d04b71a15ee6b50afa6d2c3298c86f'
  ],
  'three/addons/controls/OrbitControls.js': [
    THREE + 'examples/jsm/controls/OrbitControls.js',
    '3d79d07ecb686b4e5d93232eedab255331c1beef711e13164eaa1f68655a5f2b'
  ],
  'three/addons/environments/RoomEnvironment.js': [
    THREE + 'examples/jsm/environments/RoomEnvironment.js',
    '55f466192cc84298755a424c5e040345006b2ee1455589b3b54126c2ea4123f4'
  ]
}
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173
const PREFIX = '/assets/tripo/'
// El nombre tambien protege las rutas: solo se sirve lo que cumple esto.
const GLB = /^[\w-]+\.glb$/
// Los NPC pintados de la vista 2.5D: un PNG por tipo, con el mismo cuidado.
const NPC_PREFIX = '/assets/npcs/'
const NPC_PNG = /^[a-z]+\.png$/
const skipped = new Set()

const SLOTS = ['left_hand', 'right_hand', 'chest', 'head', 'boots']
// El juego reescribe la ranura en cada tecla (game.js saveCurrent), unas 15 veces
// por segundo al caminar. Se lee cuando cambio y tras esta pausa, que junta las
// rafagas. Medido en Windows: un escritor bare-fs (.tmp + renameSync cada 66 ms)
// contra lecturas de Node cada 1 ms no fallo ningun rename en 127 guardados.
const QUIET_MS = 40
// Los mapas fijos del juego que el visor arma en 3D.
const WORLD_MAPS = ['city', 'nox', 'castle', 'coliseum']

async function fetchLibs() {
  for (const [name, [url, sha256]] of Object.entries(LIBS)) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${name}: ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const sha = crypto.createHash('sha256').update(bytes).digest('hex')
    if (sha !== sha256) throw new Error(`${name} no coincide: sha256 ${sha}`)
    const dest = path.join(VENDOR, name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, bytes)
    console.log(dest)
  }
}

// Con mtime, para que el visor recargue un GLB regenerado con el mismo nombre.
function listModels() {
  let names
  try {
    names = fs.readdirSync(MODELS)
  } catch {
    return []
  }
  const models = []
  for (const name of names) {
    if (!GLB.test(name)) {
      if (/\.glb$/i.test(name) && !skipped.has(name)) {
        skipped.add(name)
        console.warn(`No muestro "${name}": renombralo con letras, numeros, _ o - y .glb`)
      }
      continue
    }
    try {
      models.push({ name, mtime: fs.statSync(path.join(MODELS, name)).mtimeMs })
    } catch {
      // Se borro entre readdir y stat.
    }
  }
  return models.sort((a, b) => a.mtime - b.mtime)
}

// Donde guarda el juego: persistent() de bare-storage, "runa" y "saves"
// (bin.mjs). RUNA_STORAGE equivale a --storage del juego. La ruta de macOS
// sale de la documentacion de Apple, no de una prueba.
function storageDir() {
  if (process.env.RUNA_STORAGE) return process.env.RUNA_STORAGE
  const home = os.homedir()
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(home, 'Documents')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  return path.join(base, 'runa')
}

function savesDir() {
  return path.join(storageDir(), 'saves')
}

// Teclas para el juego, si se arranco con --teclas (bin.mjs crea la carpeta).
const KEY_BYTES = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  enter: '\r',
  escape: '\x1b',
  backspace: '\x7f',
  tab: '\t',
  space: ' '
}
let keySerial = 0

function keyBytes(key) {
  if (typeof key !== 'string') return null
  if (Object.hasOwn(KEY_BYTES, key)) return KEY_BYTES[key]
  // Q cierra el juego, en el menu y en la partida (game.js onKey): desde el
  // navegador nunca se manda; para salir esta la terminal.
  if (key === 'q' || key === 'Q') return null
  return key.length === 1 && key >= ' ' && key <= '~' ? key : null
}

// Si las teclas se juntan sin que nadie las lea, el juego no esta corriendo con
// --teclas (o se cerro): mejor decirlo que tragarlas en silencio.
function keysStalled(inbox) {
  let names
  try {
    names = fs.readdirSync(inbox).filter((name) => name.endsWith('.key'))
  } catch {
    return false
  }
  if (names.length < 12) return false
  const oldest = Number(names.sort()[0].split('-')[0])
  return Date.now() - oldest > 1500
}

// El juego con --teclas reescribe keys/alive cada segundo: si el latido tiene
// menos de 3 s, la terminal esta abierta y escuchando.
function listening() {
  try {
    return Date.now() - fs.statSync(path.join(storageDir(), 'keys', 'alive')).mtimeMs < 3000
  } catch {
    return false
  }
}

// Solo la pagina del visor manda teclas: el header propio obliga a cualquier otra
// web a un preflight CORS que este server no contesta, y el Origin tiene que ser
// el del visor. Ctrl+C nunca llega: no es una tecla de la tabla.
function sendKey(req, res, origins) {
  if (req.headers['x-runa'] !== '1' || (req.headers.origin && !origins.has(req.headers.origin))) {
    res.writeHead(403).end()
    return
  }
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 200) req.destroy()
  })
  req.on('end', () => {
    let bytes = null
    try {
      bytes = keyBytes(JSON.parse(body).key)
    } catch {
      // Cuerpo invalido: cae en el 400.
    }
    if (bytes === null) return res.writeHead(400).end()
    const inbox = path.join(storageDir(), 'keys')
    if (!fs.existsSync(inbox) || keysStalled(inbox)) {
      res.writeHead(409, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'el juego no esta leyendo teclas' }))
      return
    }
    const name = `${Date.now()}-${String(keySerial++ % 1e6).padStart(6, '0')}.key`
    const file = path.join(inbox, name)
    try {
      fs.writeFileSync(file + '.tmp', bytes)
      fs.renameSync(file + '.tmp', file)
    } catch {
      return res.writeHead(500).end()
    }
    res.writeHead(204).end()
  })
}

function item(id) {
  if (typeof id !== 'string' || !id) return null
  const known = items[id]
  return known
    ? { id, name: known.name, kind: known.kind, slot: known.slot || null }
    : { id, name: id, kind: 'unknown', slot: null }
}

// Una escena por zona: el Coloso en sus ruinas, el reino en las ciudades y un
// suelo segun el resto. Durante un duelo el juego guarda la ubicacion previa.
function sceneOf(location) {
  if (location.kind === 'boss') return 'ruinas'
  if (location.kind === 'dungeon') return 'cripta'
  if (location.kind === 'field' || location.kind === 'barbarian-camp') return 'pradera'
  return 'reino'
}

// Donde esta el heroe en un mapa que el visor sabe armar en 3D.
function worldOf(location) {
  const at = { x: Math.floor(Number(location.x) || 0), y: Math.floor(Number(location.y) || 0) }
  if (location.kind === 'boss') return { map: 'boss', ...at }
  if (location.kind === 'map' && WORLD_MAPS.includes(location.mapId)) {
    return { map: location.mapId, ...at }
  }
  return null
}

function describe(slot, data) {
  const player = data.player || {}
  const worn = player.equipped || {}
  const equipped = {}
  for (const name of SLOTS) equipped[name] = item(worn[name])
  const summary = data.summary || {}
  const boss = data.worldBossState
  return {
    slot,
    savedAt: data.savedAt || null,
    name: String(data.name || 'viajero'),
    level: Math.max(1, Math.floor(Number(summary.level) || 1)),
    place: String(summary.place || ''),
    scene: sceneOf(data.location || {}),
    world: worldOf(data.location || {}),
    boss: boss ? { hp: Number(boss.hp) || 0, defeated: !!boss.defeated } : null,
    equipped,
    // La mochila y el oro, para el inventario del modo navegador.
    bag: (Array.isArray(player.items) ? player.items : []).map(item).filter(Boolean),
    gold: Math.max(0, Math.floor(Number(player.gold) || 0))
  }
}

// El mapa tal como lo dibuja la terminal, con la tabla TILES del juego. Se carga
// al pedirlo: si un cambio en lib/ lo rompe, el resto del visor sigue andando.
const worlds = new Map()
function worldMap(id) {
  if (worlds.has(id)) return worlds.get(id)
  let data = null
  try {
    const { MAPS, TILES, NPC_SPRITES } = require('../lib/map.js')
    const tiles = {}
    for (const [ch, tile] of Object.entries(TILES)) {
      tiles[ch] = { id: tile.id, name: tile.name, solid: !!tile.solid }
      // Adonde lleva una puerta o un porton: el modo navegador cruza los portones.
      if (tile.enter) tiles[ch].enter = { ...tile.enter }
    }
    // El dibujo de cada NPC es uno de NPC_SPRITES: de ahi sale su tipo.
    const kindOf = (sprite) =>
      Object.keys(NPC_SPRITES).find((kind) => NPC_SPRITES[kind] === sprite) || 'villager'
    if (id === 'boss') {
      const { BOSS_ZONE, volcanicRows } = require('../lib/boss-zone.js')
      data = {
        id,
        kind: 'boss',
        name: 'ruinas volcanicas',
        width: BOSS_ZONE.width,
        height: BOSS_ZONE.height,
        rows: volcanicRows().rows,
        tiles,
        // Donde BossZone pone al Coloso al entrar.
        boss: { x: BOSS_ZONE.width - 24, y: Math.floor(BOSS_ZONE.height / 2) }
      }
    } else if (WORLD_MAPS.includes(id) && MAPS[id]) {
      const map = MAPS[id]
      data = {
        id,
        kind: 'map',
        name: map.name,
        width: map.width,
        height: map.height,
        rows: map.rows,
        tiles,
        npcs: (map.npcs || []).map((npc) => ({
          id: npc.id,
          name: npc.name,
          role: npc.role || '',
          line: npc.line || '',
          kind: kindOf(npc.sprite),
          action: npc.action ? npc.action.kind : null,
          x: npc.x,
          y: npc.y,
          color: npc.color
        })),
        landmarks: (map.landmarks || []).map((mark) => ({
          id: mark.id,
          name: mark.name,
          bounds: mark.bounds
        }))
      }
    }
  } catch (error) {
    console.warn(`No pude armar el mapa ${id}: ${error.message}`)
  }
  if (data) worlds.set(id, data)
  return data
}

function heroWatcher() {
  const dir = savesDir()
  let key = ''
  let state = { empty: true, dir }
  let timer = null

  function newest() {
    let found = null
    for (let slot = 1; slot <= 3; slot++) {
      const file = path.join(dir, `slot-${slot}.json`)
      try {
        const mtime = fs.statSync(file).mtimeMs
        if (!found || mtime > found.mtime) found = { slot, file, mtime }
      } catch {
        // Ranura vacia.
      }
    }
    return found
  }

  function refresh() {
    timer = null
    const found = newest()
    if (!found) {
      key = ''
      state = { empty: true, dir }
      return
    }
    const next = `${found.file}:${found.mtime}`
    if (next === key) return
    const age = Date.now() - found.mtime
    if (age < QUIET_MS) {
      later(QUIET_MS - age)
      return
    }
    try {
      state = describe(found.slot, JSON.parse(fs.readFileSync(found.file, 'utf8')))
      key = next
    } catch {
      // Se estaba escribiendo o esta danada: se reintenta en el proximo aviso.
      later(QUIET_MS)
    }
  }

  function later(ms) {
    if (!timer) timer = setTimeout(refresh, ms)
  }

  try {
    fs.watch(dir, () => later(QUIET_MS)).on('error', () => {})
  } catch {
    // La carpeta todavia no existe: alcanza con la revision periodica.
  }
  setInterval(refresh, 1500).unref()
  refresh()
  return { dir, state: () => state }
}

function send(res, file, type) {
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': 'no-store'
    })
    res.end(data)
  })
}

function json(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function serve() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    console.error(`PORT invalido: "${process.env.PORT}". Usa un entero de 1 a 65535.`)
    process.exit(1)
  }
  for (const name of Object.keys(LIBS)) {
    if (!fs.existsSync(path.join(VENDOR, name))) {
      console.error(`Falta vendor/${name}: corre una vez con --fetch-lib`)
      break
    }
  }
  const hero = heroWatcher()
  // Solo estos Host: una pagina ajena con DNS rebinding no puede leer los GLB.
  const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
  const origins = new Set([...hosts].map((host) => `http://${host}`))
  http
    .createServer((req, res) => {
      if (!hosts.has(req.headers.host)) {
        res.writeHead(421).end()
        return
      }
      let urlPath
      try {
        urlPath = decodeURIComponent(req.url.split('?')[0])
      } catch {
        res.writeHead(400).end()
        return
      }
      if (Object.hasOwn(PAGES, urlPath)) {
        return send(res, PAGES[urlPath], 'text/html; charset=utf-8')
      }
      if (urlPath === '/models.json') return json(res, listModels())
      // listening: el juego de la terminal esta leyendo teclas. Si no, la pagina
      // pasa al modo navegador y se juega sola.
      if (urlPath === '/state.json') return json(res, { ...hero.state(), listening: listening() })
      if (urlPath === '/key' && req.method === 'POST') return sendKey(req, res, origins)
      if (urlPath === '/mundo.js') return send(res, WORLD_JS, 'text/javascript; charset=utf-8')
      const world = /^\/world\/([a-z]+)\.json$/.exec(urlPath)
      if (world) {
        const data = worldMap(world[1])
        if (data) return json(res, data)
      }
      // La pagina de modelos pide model-viewer en la raiz; el resto va bajo /vendor/.
      const lib = urlPath === '/model-viewer.min.js' ? 'model-viewer.min.js' : urlPath.slice(8)
      const vendored = urlPath === '/model-viewer.min.js' || urlPath.startsWith('/vendor/')
      if (vendored && Object.hasOwn(LIBS, lib)) {
        return send(res, path.join(VENDOR, lib), 'text/javascript; charset=utf-8')
      }
      const name = urlPath.startsWith(PREFIX) ? urlPath.slice(PREFIX.length) : ''
      if (GLB.test(name)) return send(res, path.join(MODELS, name), 'model/gltf-binary')
      const art = urlPath.startsWith(NPC_PREFIX) ? urlPath.slice(NPC_PREFIX.length) : ''
      if (NPC_PNG.test(art)) return send(res, path.join(root, 'assets/npcs', art), 'image/png')
      res.writeHead(404).end()
    })
    .on('error', (error) => {
      console.error(
        error.code === 'EADDRINUSE' || error.code === 'EACCES'
          ? `El puerto ${PORT} esta ocupado o reservado. Usa otro con la variable PORT.`
          : error.message
      )
      process.exit(1)
    })
    .listen(PORT, '127.0.0.1', () => {
      console.log(`modelos: http://127.0.0.1:${PORT}/`)
      console.log(`heroe:   http://127.0.0.1:${PORT}/heroe  (partidas en ${hero.dir})`)
    })
}

// scripts/build-web.js arma el sitio estatico con estas mismas piezas.
module.exports = { LIBS, VENDOR, MODELS, PAGES, WORLD_JS, WORLD_MAPS, listModels, worldMap }

if (require.main === module) {
  if (process.argv.includes('--fetch-lib')) {
    fetchLibs().catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
  } else {
    serve()
  }
}
