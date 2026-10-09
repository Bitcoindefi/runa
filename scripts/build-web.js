#!/usr/bin/env node
'use strict'

// Arma el sitio estatico de Runa en 2.5D, para GitHub Pages: la pagina con el
// juego entero (scripts/build-juego.js lo empaqueta) y el recorrido 3D, la
// galeria, los mapas del juego en JSON, three.js y los GLB de Tripo. Todo sale
// de las mismas piezas que sirve el visor, asi el sitio no se separa de lo que
// se prueba local.
//
//   node scripts/tripo-viewer.js --fetch-lib   una vez, con wifi
//   node scripts/build-web.js [carpeta]        por defecto out/web

const fs = require('fs')
const path = require('path')
const viewer = require('./tripo-viewer.js')
const { buildGame } = require('./build-juego.js')

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'web'))

function write(name, data) {
  const file = path.join(out, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}

// En el sitio las dos paginas van en ingles y marcadas como publicadas (sin
// visor: no hay terminal que seguir). La del juego ya esta en ingles; la galeria
// se traduce aca, asi el primer cuadro y la vista previa de un link salen en
// ingles antes de que cargue three.js.
const ABOUT =
  'Play Runa in your browser: the ASCII RPG with a 3D world. The hero, the helmet, ' +
  'the Colossus and the kingdom are 3D models generated with Tripo.'
const META = [
  `<meta name="description" content="${ABOUT}" />`,
  '<meta property="og:type" content="website" />',
  '<meta property="og:title" content="Runa x Tripo" />',
  `<meta property="og:description" content="${ABOUT}" />`
].join('\n    ')
const ENGLISH = {
  'tripo-heroe.html': [
    ['<html lang="en">', '<html lang="en" data-demo="1">'],
    ['<title>Runa</title>', `<title>Runa x Tripo</title>\n    ${META}`]
  ],
  'tripo-viewer.html': [
    ['<html lang="es">', '<html lang="en" data-demo="1">'],
    ['<title>Runa / Tripo</title>', `<title>Runa x Tripo / models</title>\n    ${META}`],
    ['Runa sigue en la terminal. Aca solo los GLB.</span>', "Runa's 3D models.</span>"]
  ]
}
function page(file) {
  let html = fs.readFileSync(file, 'utf8')
  for (const [from, to] of ENGLISH[path.basename(file)]) {
    if (!html.includes(from)) throw new Error(`${path.basename(file)} ya no tiene: ${from}`)
    html = html.replace(from, to)
  }
  return html
}

const missing = Object.keys(viewer.LIBS).filter(
  (name) => !fs.existsSync(path.join(viewer.VENDOR, name))
)
if (missing.length) {
  console.error(`Faltan ${missing.join(', ')}: corre node scripts/tripo-viewer.js --fetch-lib`)
  process.exit(1)
}
const models = viewer.listModels()
if (!models.length) {
  console.error('No hay GLB en assets/tripo: el sitio quedaria sin los modelos de Tripo.')
  process.exit(1)
}

async function main() {
  write('index.html', page(viewer.PAGES['/heroe']))
  write('models.html', page(viewer.PAGES['/']))
  write('mundo.js', fs.readFileSync(viewer.WORLD_JS))
  // El juego: lib/ empaquetado para el navegador, igual que lo sirve el visor.
  const game = await buildGame(path.join(out, 'juego.js'))
  write('models.json', JSON.stringify(models))
  const ids = [...viewer.WORLD_MAPS, 'boss']
  for (const id of ids) {
    const data = viewer.worldMap(id)
    if (!data) throw new Error(`no pude armar el mapa ${id}`)
    write(`world/${id}.json`, JSON.stringify(data))
  }
  // La galeria pide model-viewer en la raiz; three.js va bajo vendor/.
  for (const name of Object.keys(viewer.LIBS)) {
    const dest = name === 'model-viewer.min.js' ? name : `vendor/${name}`
    write(dest, fs.readFileSync(path.join(viewer.VENDOR, name)))
  }
  for (const model of models) {
    write(`assets/tripo/${model.name}`, fs.readFileSync(path.join(viewer.MODELS, model.name)))
  }
  // Los NPC pintados de la vista 2.5D, un PNG por tipo.
  const npcArt = path.join(__dirname, '..', 'assets', 'npcs')
  for (const name of fs.readdirSync(npcArt).filter((file) => /^[a-z]+\.png$/.test(file))) {
    write(`assets/npcs/${name}`, fs.readFileSync(path.join(npcArt, name)))
  }
  // Sin Jekyll, GitHub Pages sirve cada archivo tal cual.
  write('.nojekyll', '')
  const kb = Math.round(game.bytes / 1024)
  console.log(
    `${out}: el juego (${kb} KB), ${models.length} modelos de Tripo y ${ids.length} mapas`
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
