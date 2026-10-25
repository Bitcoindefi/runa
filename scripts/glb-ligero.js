#!/usr/bin/env node
'use strict'

// Copias livianas de los GLB de Tripo para el sitio (scripts/build-web.js). Cada
// GLB de assets/tripo pesa de 1,6 a 4,9 MB y trae tres texturas de 2048 px:
// unos 67 MB de memoria de GPU por modelo. En un telefono eso hace lenta la
// primera carga, y una tienda con varias armas en los estantes lo tiraria.
//
// Cada GLB sale en dos juegos, segun el lado mas largo de sus texturas: 1024
// (computadoras) y 512 (telefonos). La receta, con gltf-transform:
//
//   dedup, prune, weld       sin datos repetidos ni sueltos
//   resample                 saca de las animaciones los cuadros que la
//                            interpolacion ya da (tolerancia 1e-4)
//   texturas                 achicadas; el color y el metal/rugosidad en WebP
//                            (EXT_texture_webp, que GLTFLoader de three.js lee
//                            solo); el mapa de normales en JPEG sin submuestreo
//                            de color (4:4:4), ver NORMALS
//   quantize                 vertices en enteros (KHR_mesh_quantization, que
//                            three.js tambien lee solo)
//
// No usa meshopt ni draco: la pagina no tiene sus decodificadores. Los
// originales no se tocan: siguen para el visor local, la galeria y como
// respaldo si una copia liviana no carga. Al terminar revisa que cada copia
// conserve sus esqueletos, sus huesos y sus animaciones con los mismos nombres.
//
// gltf-transform y sharp viven fuera del repo, en ../tools/gltf (al lado de la
// carpeta del repo) o donde diga RUNA_GLTF_TOOLS. Se instalan una vez:
//
//   mkdir ..\tools\gltf; cd ..\tools\gltf; npm init -y
//   npm install --save-exact @gltf-transform/cli@4.5.1 @gltf-transform/core@4.5.1
//     @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 sharp@0.35.5
//
//   node scripts/glb-ligero.js [carpeta]   por defecto out/tripo-ligero
//
// La salida queda en <carpeta>/1024/<nombre>.glb y <carpeta>/512/<nombre>.glb,
// con manifest.json: lo que ya esta hecho y no cambio no se rehace.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const root = path.resolve(__dirname, '..')
const MODELS = path.join(root, 'assets', 'tripo')
const OUT = path.join(root, 'out', 'tripo-ligero')
const TOOLS = path.resolve(process.env.RUNA_GLTF_TOOLS || path.join(root, '..', 'tools', 'gltf'))
// El mismo filtro de nombres que el visor (tripo-viewer.js GLB).
const GLB = /^[\w-]+\.glb$/
// El lado mas largo de las texturas en cada juego.
const SETS = [1024, 512]
// WebP con perdida guarda el color a media resolucion (4:2:0), y en un mapa de
// normales eso tuerce la luz. Medido en la daga y el Coloso contra la textura
// achicada sin comprimir: WebP calidad 90 deja el 1% peor de los texeles a mas
// de 17 a 24 grados; JPEG 4:4:4 calidad 85, a 8 a 11 grados, por unos 25 KB
// mas en el juego de 512. WebP sin perdida pesa el doble que ese JPEG.
const NORMALS = { targetFormat: 'jpeg', quality: 85, chromaSubsampling: '4:4:4' }
const COLORS = { targetFormat: 'webp', quality: 82 }
// Cambia cuando cambia la receta: obliga a rehacer las copias guardadas.
const RECIPE = 'v1 dedup prune weld resample webp82 normales-jpeg444-85 quantize'
const TOOL_VERSIONS = {
  '@gltf-transform/core': '4.5.1',
  '@gltf-transform/extensions': '4.5.1',
  '@gltf-transform/functions': '4.5.1',
  sharp: '0.35.5'
}

function loadTools() {
  const load = createRequire(path.join(TOOLS, 'package.json'))
  const tools = {}
  for (const name of Object.keys(TOOL_VERSIONS)) {
    try {
      tools[name] = load(name)
    } catch (error) {
      const install = Object.entries(TOOL_VERSIONS)
        .map(([pkg, version]) => `${pkg}@${version}`)
        .join(' ')
      throw new Error(
        `No encuentro ${name} en ${TOOLS} (${String(error.message).split('\n')[0]}).\n` +
          'gltf-transform y sharp se instalan una vez, fuera del repo:\n' +
          `  mkdir "${TOOLS}"\n  cd "${TOOLS}"\n  npm init -y\n` +
          `  npm install --save-exact ${install}\n` +
          'o se indica otra carpeta con la variable RUNA_GLTF_TOOLS.'
      )
    }
  }
  return {
    core: tools['@gltf-transform/core'],
    extensions: tools['@gltf-transform/extensions'],
    functions: tools['@gltf-transform/functions'],
    sharp: tools.sharp,
    versions: versionsIn(load)
  }
}

// Las versiones instaladas, para el registro (sharp no exporta su package.json).
function versionsIn(load) {
  const found = {}
  for (const name of Object.keys(TOOL_VERSIONS)) {
    try {
      const main = load.resolve(name)
      let dir = path.dirname(main)
      while (dir !== path.dirname(dir) && path.basename(dir) !== name.split('/').pop()) {
        dir = path.dirname(dir)
      }
      found[name] = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version
    } catch {
      found[name] = '?'
    }
  }
  return found
}

// Los avisos que no dicen nada: Tripo marca sus GLB con FB_ngon_encoding, una
// extension opcional que nadie lee y que la copia no lleva.
function quietLogger() {
  return {
    debug() {},
    info() {},
    warn(text) {
      if (!/FB_ngon_encoding/.test(text)) console.warn('gltf-transform: ' + text)
    },
    error(text) {
      console.error('gltf-transform: ' + text)
    }
  }
}

function recipe(tools, size) {
  const f = tools.functions
  const resize = [size, size]
  return [
    f.dedup(),
    // Los nodos hoja se quedan: la pagina busca huesos por nombre (Head, LeftHand).
    f.prune({ keepLeaves: true }),
    f.weld(),
    f.resample(),
    f.textureCompress({
      encoder: tools.sharp,
      resize,
      slots: /^normalTexture$/,
      ...NORMALS
    }),
    f.textureCompress({
      encoder: tools.sharp,
      resize,
      slots: /^(?!normalTexture$)/,
      ...COLORS
    }),
    f.quantize()
  ]
}

// Lo que la pagina necesita de un GLB y no puede perder en la copia: los
// esqueletos con sus huesos, las animaciones con sus canales y los nombres.
function shape(doc) {
  const root = doc.getRoot()
  return {
    skins: root
      .listSkins()
      .map((skin) => skin.listJoints().map((joint) => joint.getName()))
      .sort(),
    skinned: root
      .listNodes()
      .filter((node) => node.getSkin())
      .map((node) => node.getName())
      .sort(),
    animations: root
      .listAnimations()
      .map((clip) => `${clip.getName()}:${clip.listChannels().length}`)
      .sort(),
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length
  }
}

// Memoria de GPU estimada: cada textura en RGBA con sus mipmaps, y los
// vertices e indices tal como suben.
function gpuBytes(tools, doc) {
  const { ImageUtils } = tools.core
  let textures = 0
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage()
    if (image) textures += ImageUtils.getVRAMByteLength(image, texture.getMimeType()) || 0
  }
  let geometry = 0
  for (const accessor of doc.getRoot().listAccessors()) {
    const parents = accessor.listParents().map((parent) => parent.propertyType)
    if (parents.includes('Primitive')) geometry += accessor.getByteLength()
  }
  return { textures, geometry }
}

function textureSizes(tools, doc) {
  const { ImageUtils } = tools.core
  return doc
    .getRoot()
    .listTextures()
    .map((texture) => {
      const [w, h] = ImageUtils.getSize(texture.getImage(), texture.getMimeType()) || [0, 0]
      return `${texture.getMimeType().replace('image/', '')} ${w}x${h}`
    })
}

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12)
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function lighten(options = {}) {
  const out = path.resolve(options.out || OUT)
  const log = options.log || console.log
  const tools = loadTools()
  const logger = quietLogger()
  const io = new tools.core.NodeIO()
    .setLogger(logger)
    .registerExtensions(tools.extensions.ALL_EXTENSIONS)
  const manifestFile = path.join(out, 'manifest.json')
  let before = {}
  try {
    before = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  } catch {
    // Sin copias anteriores: se hacen todas.
  }
  const kept = before.recipe === RECIPE ? before.models || {} : {}
  const names = fs
    .readdirSync(MODELS)
    .filter((name) => GLB.test(name))
    .sort()
  const models = {}
  let made = 0
  for (const name of names) {
    const file = path.join(MODELS, name)
    const stat = fs.statSync(file)
    const source = { bytes: stat.size, mtime: stat.mtimeMs }
    const old = kept[name]
    if (
      old &&
      old.source.bytes === source.bytes &&
      old.source.mtime === source.mtime &&
      SETS.every((size) => old.sets[size] && fs.existsSync(path.join(out, String(size), name)))
    ) {
      models[name] = old
      continue
    }
    const original = await io.read(file)
    original.setLogger(logger)
    const want = shape(original)
    const entry = { source: { ...source, gpu: gpuBytes(tools, original) }, sets: {} }
    for (const size of SETS) {
      const doc = await io.read(file)
      doc.setLogger(logger)
      await doc.transform(...recipe(tools, size))
      const got = shape(doc)
      if (!same(want, got)) {
        throw new Error(
          `${name} (${size}) perdio algo en el camino:\n  antes ${JSON.stringify(want)}\n  despues ${JSON.stringify(got)}`
        )
      }
      const bytes = await io.writeBinary(doc)
      const dest = path.join(out, String(size), name)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, bytes)
      entry.sets[size] = {
        bytes: bytes.byteLength,
        hash: sha(bytes),
        gpu: gpuBytes(tools, doc),
        textures: textureSizes(tools, doc)
      }
    }
    models[name] = entry
    made++
    const sizes = SETS.map((size) => `${size}: ${kb(entry.sets[size].bytes)}`).join(', ')
    log(`${name}: ${kb(source.bytes)} -> ${sizes}`)
  }
  // Lo que ya no esta en assets/tripo sale tambien de la salida.
  for (const size of SETS) {
    const dir = path.join(out, String(size))
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (!models[name]) fs.rmSync(path.join(dir, name), { force: true })
    }
  }
  const manifest = { recipe: RECIPE, tools: tools.versions, sets: SETS, models }
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
  if (!made) log(`${names.length} GLB livianos al dia en ${out}`)
  return { out, made, ...manifest }
}

function kb(bytes) {
  return `${Math.round(bytes / 1024)} KB`
}

module.exports = { lighten, SETS, OUT, TOOLS, RECIPE }

if (require.main === module) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : OUT
  lighten({ out })
    .then((result) => {
      const total = (pick) => Object.values(result.models).reduce((sum, m) => sum + pick(m), 0)
      const line = [`originales ${kb(total((m) => m.source.bytes))}`]
      for (const size of result.sets) line.push(`${size}: ${kb(total((m) => m.sets[size].bytes))}`)
      console.log(`${Object.keys(result.models).length} GLB en ${result.out}: ${line.join(', ')}`)
    })
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
