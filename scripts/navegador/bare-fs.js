'use strict'

// bare-fs en el navegador: la parte sincronica que usan lib/game.js (script.txt)
// y lib/saves.js (las ranuras), sobre localStorage. Si el navegador no deja usar
// localStorage (modo privado, almacenamiento bloqueado) queda en memoria: se
// juega igual y la partida dura lo que la pestana.
//
// Las claves llevan prefijo porque el origen se comparte: en GitHub Pages todos
// los sitios de la organizacion viven en el mismo origen.

const DATA = 'runa:fs:'
const MTIME = 'runa:fs-mtime:'
const memory = new Map()

function storage() {
  try {
    const store = globalThis.localStorage
    if (!store) return null
    store.getItem(DATA)
    return store
  } catch {
    return null
  }
}

function key(file) {
  return String(file).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '')
}

function get(name) {
  const store = storage()
  if (store) return store.getItem(name)
  return memory.has(name) ? memory.get(name) : null
}

function set(name, value) {
  const store = storage()
  if (!store) return memory.set(name, value)
  try {
    store.setItem(name, value)
  } catch (error) {
    // Lleno: se avisa como un disco lleno, que el juego ya sabe contar.
    const full = new Error('ENOSPC: el navegador no tiene lugar para guardar')
    full.code = 'ENOSPC'
    full.cause = error
    throw full
  }
}

function remove(name) {
  const store = storage()
  if (store) store.removeItem(name)
  else memory.delete(name)
}

function missing(syscall, file) {
  const error = new Error(`ENOENT: no such file or directory, ${syscall} '${file}'`)
  error.code = 'ENOENT'
  error.errno = -2
  error.syscall = syscall
  error.path = String(file)
  return error
}

// Siempre creciente: dos escrituras en el mismo milisegundo cambian igual el
// mtime, que es lo que mira el juego para releer script.txt.
let clock = 0
function now() {
  clock = Math.max(clock + 1, Date.now())
  return clock
}

function statSync(file) {
  const name = key(file)
  const data = get(DATA + name)
  if (data === null) throw missing('stat', file)
  const mtimeMs = Number(get(MTIME + name)) || 0
  return {
    size: data.length,
    mtimeMs,
    mtime: new Date(mtimeMs),
    isFile: () => true,
    isDirectory: () => false
  }
}

function readFileSync(file) {
  const data = get(DATA + key(file))
  if (data === null) throw missing('open', file)
  return data
}

function writeFileSync(file, data) {
  const name = key(file)
  set(DATA + name, String(data))
  set(MTIME + name, String(now()))
}

function renameSync(from, to) {
  const source = key(from)
  const data = get(DATA + source)
  if (data === null) throw missing('rename', from)
  writeFileSync(to, data)
  remove(DATA + source)
  remove(MTIME + source)
}

function unlinkSync(file) {
  const name = key(file)
  if (get(DATA + name) === null) throw missing('unlink', file)
  remove(DATA + name)
  remove(MTIME + name)
}

function existsSync(file) {
  return get(DATA + key(file)) !== null
}

// Las carpetas no existen: la clave es la ruta entera.
function mkdirSync() {}

module.exports = {
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  // Para la pagina: si lo guardado sobrevive a la pestana.
  persistent: () => storage() !== null
}
