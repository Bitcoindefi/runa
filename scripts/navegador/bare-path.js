'use strict'

// bare-path en el navegador. El original lee Bare.platform al cargar y su mitad
// posix pide el addon nativo bare-os; lib/saves.js solo necesita join.

function normalize(file) {
  const absolute = file.startsWith('/')
  const parts = []
  for (const part of file.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return (absolute ? '/' : '') + parts.join('/') || (absolute ? '/' : '.')
}

function join(...parts) {
  return normalize(parts.filter((part) => part !== '').join('/'))
}

function basename(file, ext) {
  const base = String(file).replace(/\/+$/, '').split('/').pop() || ''
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base
}

function dirname(file) {
  const parts = String(file).replace(/\/+$/, '').split('/')
  parts.pop()
  return parts.join('/') || (String(file).startsWith('/') ? '/' : '.')
}

function resolve(...parts) {
  return normalize('/' + parts.join('/'))
}

module.exports = { join, basename, dirname, resolve, normalize, sep: '/', delimiter: ':' }
module.exports.posix = module.exports
