'use strict'

/**
 * Encounter portraits.
 *
 * A monster used to start existing as one character on a line. That is enough
 * to fight it and not enough to remember it, so when a fight starts the
 * creature gets a card of its own for a beat before the swinging begins.
 *
 * Drawn wide and short on purpose. A terminal cell is about twice as tall as it
 * is wide, so art laid out on a square grid comes out stretched; every portrait
 * here spends roughly two columns for every row it would have taken on paper.
 *
 * They are data, like everything in `content.js`. A creature that arrives over
 * the air brings its face with the rest of it.
 */

/**
 * ASCII 128 only. A glyph that renders as a box on someone else's terminal
 * ruins the whole frame, and the judge's font is not ours to choose.
 */
const PORTRAITS = {
  mosquito: {
    lines: [
      '     \\\\|//      \\\\|//   ',
      '      \\\\|/        \\\\|/    ',
      '  >====(  o    o  )====   ',
      '        /|  ||  |\\       '
    ],
    line: 'algo zumba y se acerca rapido'
  },

  golem: {
    lines: [
      '     [#=========#]     ',
      '     [# (o)  (o) #]    ',
      '   __[#=========#]__   ',
      '  |___|         |___|  '
    ],
    line: 'la piedra se levanta y camina'
  },

  espectro: {
    lines: [
      '       .-~~~~~-.       ',
      '      (  o   o  )      ',
      '       \\   ~   /       ',
      '        ~  ~  ~        '
    ],
    line: 'no lo viste llegar'
  }
}

/**
 * Fallback for a creature that arrived without a face.
 *
 * Content travels over the air, so a release can add a monster whose portrait
 * this build has never seen. Drawing a question mark beats drawing nothing and
 * beats crashing, and it reads as "something new" rather than as a bug.
 */
const UNKNOWN = {
  lines: [
    '     ,---------.      ',
    '    |     ?     |     ',
    '    |    ` `    |     ',
    "     `---------'      "
  ],
  line: 'algo que no reconoces'
}

/**
 * @param {string} kind - a foe id from content.js
 * @returns {{lines: string[], line: string}}
 */
function portraitOf(kind) {
  return PORTRAITS[kind] || UNKNOWN
}

/**
 * Render the encounter card, centred in the width it is given.
 *
 * Returns lines rather than one string: the caller almost always slots this
 * between other rows, so joining is its problem.
 *
 * @param {string} kind
 * @param {string} name - what to call it under the picture
 * @param {number} width
 * @returns {string[]}
 */
function encounterCard(kind, name, width) {
  const p = portraitOf(kind)
  const w = Math.max(20, Math.floor(width) || 40)
  const centre = (t) => {
    const s = String(t)
    const pad = Math.max(0, Math.floor((w - s.length) / 2))
    return ' '.repeat(pad) + s
  }

  return [...p.lines.map(centre), '', centre('- ' + String(name || kind) + ' -'), centre(p.line)]
}

/**
 * How many ticks the card stays up before the arena takes over.
 *
 * The fight is already running underneath, so this is not a pause: it is a
 * look at the creature while your rules start working. Long enough to read it,
 * short enough that it never feels like a loading screen.
 */
const ENCOUNTER_TICKS = 26

module.exports = { PORTRAITS, UNKNOWN, portraitOf, encounterCard, ENCOUNTER_TICKS }
