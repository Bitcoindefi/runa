// Las voces de los NPC de la ciudad, del castillo y de NOX: datos puros, sin
// red ni three.js. Cada NPC tiene un nombre, un pedido para Voice Design de
// ElevenLabs (solo voces adultas) y las frases en ingles tal como las muestra la
// pagina (translate de lib/locales/en.json). La pagina busca el mp3 por el texto
// exacto en assets/voces-npc/manifest.json.

export const NPC_VOICES = {
  aldren: {
    name: 'King Aldren',
    brief:
      'An older man in his sixties, a wise medieval king. Deep, regal, warm and calm voice with a gentle British accent, slow and dignified.',
    lines: ['every hero leaves a mark on this town; honor yours']
  },
  cedric: {
    name: 'Sir Cedric',
    brief:
      'A middle aged knight, strong and confident baritone, slightly gruff, British accent, speaks with urgency and courage.',
    lines: ['mosquitos are invading the meadow; I need a hunter']
  },
  elian: {
    name: 'Elian',
    brief:
      'An adult man, royal herald, clear projecting tenor voice, cheerful and formal, British accent.',
    lines: ["the dawn market opens between the avenue and the heroes' square"]
  },
  brom: {
    name: 'Brom',
    brief:
      'A burly adult blacksmith, deep rough bass voice, friendly and blunt, northern English accent.',
    lines: ['you can hear the anvil in the craft district without crossing half the town']
  },
  vera: {
    name: 'Vera',
    brief:
      'An adult woman armorer in her forties, firm and practical alto voice, confident, Scottish accent.',
    lines: ['shield and armor work together; each piece has its own slot']
  },
  iris: {
    name: 'Iris',
    brief:
      'An adult woman alchemist, soft curious mezzo voice, thoughtful and a little mysterious, British accent.',
    lines: ['I distill herbs from the dawn gardens and mushrooms brought from NOX']
  },
  bruno: {
    name: 'Bruno',
    brief:
      'A jolly adult innkeeper, warm hearty baritone with a laugh in it, welcoming, English accent.',
    lines: ['three coins restore your health; the golden mug welcomes all royal road travelers']
  },
  alma: {
    name: 'Sister Alma',
    brief:
      'An older woman priestess, serene gentle and kind voice, slow and soothing, British accent.',
    lines: ['the tower of light guides travelers and protects the dawn district']
  },
  roan: {
    name: 'Roan',
    brief: 'An adult male town guard, stern steady voice, disciplined and direct, English accent.',
    lines: ['crown avenue connects castle, square and main gate directly']
  },
  'nox-smith': {
    name: 'Theryn',
    brief:
      'An adult male dark elf weaponsmith, low cold smooth voice, quiet intensity, elegant accent.',
    lines: ['obsidian gives shape; dark metal keeps it from breaking']
  },
  'nox-armorer': {
    name: 'Zynrae',
    brief:
      'An adult female dark elf armor master, sharp proud alto voice, precise and cool, elegant accent.',
    lines: ['NOX armor deflects a blow like a rib of the mountain']
  },
  'nox-alchemist': {
    name: 'Mirael',
    brief:
      'An adult female elf alchemist, airy whispering mezzo voice, calm and otherworldly, elegant accent.',
    lines: ['I distill cold spores into elixirs that close wounds without fire']
  },
  'nox-merchant': {
    name: 'Nym',
    brief:
      'An adult male elf merchant, sly silky voice, hushed and conspiratorial, elegant accent.',
    lines: ['in NOX even rumors are traded indoors']
  },
  'nox-priestess': {
    name: 'Ilyra',
    brief:
      'An adult female elf moon priestess, soft ethereal and serene voice, slow and melodic, elegant accent.',
    lines: ['the night can heal too, if you know how to listen']
  },
  'nox-mycologist': {
    name: 'Sael',
    brief: 'An adult male elf gardener, gentle warm low voice, patient and kind, elegant accent.',
    lines: ['cold mushrooms glow without fire and feed the whole town']
  },
  'nox-sentinel': {
    name: 'Veyra',
    brief:
      'An adult female dark elf sentinel, firm watchful low voice, solemn and proud, elegant accent.',
    lines: ['the palace was carved upward in search of a moon we never see']
  }
}

// Todas las frases: { id, index, text, file } con file relativo a assets/voces-npc.
export function allNpcLines() {
  const out = []
  for (const [id, npc] of Object.entries(NPC_VOICES)) {
    npc.lines.forEach((text, index) => {
      out.push({ id, index, text, file: `${id}/en/${index + 1}.mp3` })
    })
  }
  return out
}

// El texto de muestra para disenar la voz (Voice Design pide al menos 100 letras).
export function npcSample(id) {
  const npc = NPC_VOICES[id]
  const text = `I am ${npc.name}. ${npc.lines.join('. ')}. Welcome to Runa, traveler, and may the road be kind to you.`
  return text.length >= 100 ? text : text + ' Stay a while and listen to what I have to say.'
}
