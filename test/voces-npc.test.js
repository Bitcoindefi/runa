const { test } = require('brittle')
const { NPC_VOICES } = require('../scripts/tripo-voces-npc.mjs')
const { MAPS } = require('../lib/map.js')
const EN = require('../lib/locales/en.json')
const manifest = require('../assets/voces-npc/manifest.json')

// La caja de dialogo busca el mp3 por el texto exacto que muestra la pagina:
// la frase del NPC traducida con lib/locales/en.json. Una mayuscula de mas deja
// al NPC mudo.
const shown = new Set()
for (const map of Object.values(MAPS)) {
  for (const npc of map.npcs || []) if (npc.line) shown.add(EN[npc.line] || npc.line)
}

test('voces de NPC: cada frase con voz es la que muestra el juego en ingles', (t) => {
  for (const [id, voice] of Object.entries(NPC_VOICES)) {
    for (const line of voice.lines) t.ok(shown.has(line), id + ': ' + line)
  }
  for (const line of Object.keys(manifest.lines)) t.ok(shown.has(line), 'manifest: ' + line)
})

test('voces de NPC: el rey Aldren tiene voz', (t) => {
  const king = Object.values(MAPS)
    .flatMap((map) => map.npcs || [])
    .find((npc) => npc.id === 'aldren')
  t.ok(king)
  t.is(manifest.lines[EN[king.line]], 'aldren/en/1.mp3')
})
