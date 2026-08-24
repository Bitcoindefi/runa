'use strict'

const { style } = require('bare-tui')
const { Runa } = require('../lib/game.js')
const render = require('../lib/render.js')

const key = (name) => ({ type: 'key', is: (...names) => names.includes(name) })
const game = new Runa({ presence: false })
game.update({ type: 'resize', width: 120, height: 34 })
game.onKey(key('enter'))

console.log('POSE 0\n' + render.heroSprite({ frame: 0, items: [] }).join('\n'))
console.log('\nPOSE 1\n' + render.heroSprite({ frame: 1, items: [] }).join('\n'))
console.log('\nCIUDAD 120x34\n' + style.stripAnsi(game.view()))

game.walker.placeAt('city', 160, 183)
console.log('\nPORTON 120x34\n' + style.stripAnsi(game.view()))
game.move(0, 1)
console.log('\nPRADERA 120x34\n' + style.stripAnsi(game.view()))
