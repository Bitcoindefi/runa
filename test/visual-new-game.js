'use strict'

const { style } = require('bare-tui')
const { Runa } = require('../lib/game.js')
const render = require('../lib/render.js')

const press = (game, name) => game.onKey({ type: 'key', is: (...keys) => keys.includes(name) })
const typeText = (game, value) => {
  for (const sequence of value) {
    game.onKey({ type: 'key', sequence, ctrl: false, meta: false, is: () => false })
  }
}

const game = new Runa({ presence: false })
game.width = 80
game.height = 24
press(game, 'enter')
typeText(game, 'Quinn')
console.log('\n=== nombre ===\n' + style.stripAnsi(game.view()))

press(game, 'enter')
console.log('\n=== ciudad sin equipo ===\n' + style.stripAnsi(game.view()))

for (const items of [[], ['sword'], ['sword', 'shield'], ['crossbow'], ['boots']]) {
  console.log(
    '\n=== ' +
      (items.join(' + ') || 'sin equipo') +
      ' ===\n' +
      render.heroSprite({ initial: 'Q', items }).join('\n')
  )
}
