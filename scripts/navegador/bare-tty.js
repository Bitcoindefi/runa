'use strict'

// bare-tui pregunta si hay terminal (program.js) y solo arma los streams si la
// hay. En la pagina no la hay: las teclas llegan como KeyMsg y el cuadro se lee
// del renderer, asi que nada de esto se construye.

class NoTTY {
  constructor() {
    throw new Error('no hay terminal en el navegador')
  }
}

module.exports = { isTTY: () => false, ReadStream: NoTTY, WriteStream: NoTTY }
