// Las pistas de musica de fondo y que mapa usa cada una. Sin three.js ni el
// juego: .mjs para que las pruebas lo carguen en Bare y para que
// scripts/generar-musica.mjs lea los pedidos.

// En orden de prioridad: si se corta la generacion, las primeras ya estan.
export const TRACKS = [
  {
    id: 'boss',
    prompt:
      'Epic boss battle against a colossal stone giant on a lava field: pounding war drums, low brass stabs, deep strings ostinato, 140 bpm, menacing and heroic.'
  },
  {
    id: 'meadow',
    prompt:
      'Pastoral adventure on a sunny open meadow: wooden flutes, light plucked strings, soft hand percussion, 100 bpm, hopeful and calm.'
  },
  {
    id: 'city',
    prompt:
      'Warm medieval market town: lute and mandolin melody, recorder, frame drum, 96 bpm, cozy and lively.'
  },
  {
    id: 'crypt',
    prompt:
      'Dark ambient crypt: water drips, low drones, distant wordless choir pads, slow pulse at 60 bpm, eerie and tense.'
  },
  {
    id: 'camp',
    prompt:
      'Barbarian war camp: heavy war drums, war horns, low drones, 110 bpm, savage and driving.'
  },
  {
    id: 'nox',
    prompt:
      'Mysterious elven city at night: harp arpeggios, ethereal pads, soft bells, 80 bpm, dreamy and mysterious.'
  },
  {
    id: 'title',
    prompt:
      'Main theme of a fantasy adventure: noble horn melody over strings and harp, gentle timpani, 90 bpm, wonder and courage.'
  },
  {
    id: 'coliseum',
    prompt:
      'Arena duel in a stone coliseum: fast tribal percussion, brass fanfare hits, tense strings, 130 bpm, competitive.'
  },
  {
    id: 'castle',
    prompt:
      'Regal royal castle hall: slow stately strings, harpsichord, soft brass chorale, 70 bpm, dignified and calm.'
  }
]

const IDS = new Set(TRACKS.map((t) => t.id))

/**
 * La pista de un mapa. mapId es el id del mapa de la pagina ('city', 'nox',
 * 'castle', 'field', 'crypt-2', 'camp:norte', 'boss', 'coliseum') o 'title' en
 * el menu. Sin pista conocida, null.
 */
export function trackFor(mapId) {
  const id = String(mapId || '').toLowerCase()
  if (!id) return null
  if (id === 'field' || id === 'meadow' || id === 'pradera') return 'meadow'
  if (id.startsWith('crypt')) return 'crypt'
  if (id.startsWith('camp')) return 'camp'
  if (id === 'menu' || id === 'title') return 'title'
  return IDS.has(id) ? id : null
}

/**
 * El volumen de la musica: sin sonido, 0; con una voz de monstruo hablando,
 * bajo para que se oiga la voz; si no, el normal. Siempre debajo de las voces.
 */
export function musicVolume({ sound = true, speaking = false } = {}) {
  if (!sound) return 0
  return speaking ? 0.08 : 0.28
}
