'use strict'

const EN = require('./locales/en.json')
let language = 'es'

function normalizeLanguage(value) {
  return String(value || '').toLowerCase() === 'en' ? 'en' : 'es'
}

// Rendering is synchronous. Restore the previous locale even when a view throws,
// so independent games and tests never inherit another player's language.
function withLanguage(value, draw) {
  const previous = language
  language = normalizeLanguage(value)
  try {
    return draw()
  } finally {
    language = previous
  }
}

const fragments = Object.entries(EN).sort((a, b) => b[0].length - a[0].length)
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const pattern = new RegExp(fragments.map(([key]) => escape(key)).join('|'), 'g')

function translate(value) {
  const source = String(value === null || value === undefined ? '' : value)
  if (language !== 'en') return source
  if (Object.prototype.hasOwnProperty.call(EN, source)) return EN[source]
  // Match authored fragments once, without translating the English result again.
  return source.replace(pattern, (match, offset) => {
    const before = source[offset - 1] || ''
    const after = source[offset + match.length] || ''
    if (/[A-Za-z]/.test(match[0]) && /[A-Za-z]/.test(before)) return match
    if (/[A-Za-z]/.test(match[match.length - 1]) && /[A-Za-z]/.test(after)) return match
    return EN[match]
  })
}

function t(value, ...values) {
  if (!Array.isArray(value)) return translate(value)
  return value.reduce((out, part, index) => out + translate(part) + (values[index] ?? ''), '')
}

// Map signs are visual labels. Keep their exact cell footprint; collisions and
// actor coordinates still refer to the original map, including on narrow views.
function mapLabels(line) {
  if (language !== 'en') return line
  return String(line).replace(/[A-Za-z][A-Za-z ]*[A-Za-z]/g, (sign) =>
    translate(sign).slice(0, sign.length).padEnd(sign.length)
  )
}

module.exports = { t, withLanguage, normalizeLanguage, mapLabels }
