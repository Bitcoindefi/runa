#!/usr/bin/env node
'use strict'

// Visor local de los GLB de Tripo, al lado de la terminal del juego.
// Solo sirve cuatro cosas: el HTML, model-viewer, la lista de GLB y los GLB.
// No toca la API ni ve la key.
//
//   node scripts/tripo-viewer.js --fetch-lib   baja model-viewer una vez, con wifi
//   node scripts/tripo-viewer.js               http://127.0.0.1:4173/

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')

const root = path.resolve(__dirname, '..')
const MODELS = path.join(root, 'assets/tripo')
const HTML = path.join(__dirname, 'tripo-viewer.html')
const LIB = path.join(root, 'vendor/model-viewer.min.js')
const LIB_URL = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js'
// sha256 de ese archivo: si el CDN devuelve otra cosa, no se guarda.
const LIB_SHA256 = '283b0672384614b4847636c306fc93fe4b1fcadc76d668b4e47f0ca76bcf033b'
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173
const PREFIX = '/assets/tripo/'
// El nombre tambien protege las rutas: solo se sirve lo que cumple esto.
const GLB = /^[\w-]+\.glb$/
const skipped = new Set()

async function fetchLib() {
  const response = await fetch(LIB_URL)
  if (!response.ok) throw new Error(`model-viewer ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const sha = crypto.createHash('sha256').update(bytes).digest('hex')
  if (sha !== LIB_SHA256) throw new Error(`model-viewer no coincide: sha256 ${sha}`)
  fs.mkdirSync(path.dirname(LIB), { recursive: true })
  fs.writeFileSync(LIB, bytes)
  console.log(LIB)
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

function serve() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    console.error(`PORT invalido: "${process.env.PORT}". Usa un entero de 1 a 65535.`)
    process.exit(1)
  }
  if (!fs.existsSync(LIB)) {
    console.error('Falta vendor/model-viewer.min.js: corre una vez con --fetch-lib')
  }
  // Solo estos Host: una pagina ajena con DNS rebinding no puede leer los GLB.
  const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
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
      if (urlPath === '/') return send(res, HTML, 'text/html; charset=utf-8')
      if (urlPath === '/model-viewer.min.js') {
        return send(res, LIB, 'text/javascript; charset=utf-8')
      }
      if (urlPath === '/models.json') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(listModels()))
        return
      }
      const name = urlPath.startsWith(PREFIX) ? urlPath.slice(PREFIX.length) : ''
      if (GLB.test(name)) return send(res, path.join(MODELS, name), 'model/gltf-binary')
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
      console.log(`http://127.0.0.1:${PORT}/`)
    })
}

if (process.argv.includes('--fetch-lib')) {
  fetchLib().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
} else {
  serve()
}
