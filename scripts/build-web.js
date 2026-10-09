#!/usr/bin/env node
'use strict'

// Arma el sitio estatico de la vista 2.5D, para GitHub Pages: la pagina del
// heroe en modo demo (camina en el navegador, sin el juego), la galeria, los
// mapas del juego en JSON, three.js y los GLB de Tripo. Todo sale de las mismas
// piezas que sirve el visor, asi el sitio no se separa de lo que se prueba local.
//
//   node scripts/tripo-viewer.js --fetch-lib   una vez, con wifi
//   node scripts/build-web.js [carpeta]        por defecto out/web

const fs = require('fs')
const path = require('path')
const viewer = require('./tripo-viewer.js')

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'web'))

function write(name, data) {
  const file = path.join(out, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}

// En el sitio las dos paginas van en ingles y en modo demo.
function page(file) {
  const html = fs.readFileSync(file, 'utf8')
  const demo = html.replace('<html lang="es">', '<html lang="en" data-demo="1">')
  if (demo === html) throw new Error(`${path.basename(file)} ya no empieza con <html lang="es">`)
  return demo
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

write('index.html', page(viewer.PAGES['/heroe']))
write('models.html', page(viewer.PAGES['/']))
write('mundo.js', fs.readFileSync(viewer.WORLD_JS))
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
// Sin Jekyll, GitHub Pages sirve cada archivo tal cual.
write('.nojekyll', '')
console.log(`${out}: ${models.length} modelos de Tripo y ${ids.length} mapas`)
