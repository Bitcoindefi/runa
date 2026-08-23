/** @typedef {import('pear-interface')} */ /* global Pear */
'use strict'

const { Program } = require('bare-tui')
const { Runa } = require('./lib/game.js')

new Program(new Runa()).run()
