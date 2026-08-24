'use strict'

const { MAPS } = require('../lib/map.js')

function crop(title, x, y, width, height) {
  console.log(`\n${title} (${x},${y}) ${width}x${height}`)
  for (let row = y; row < Math.min(MAPS.city.height, y + height); row++) {
    console.log(MAPS.city.rows[row].slice(x, x + width))
  }
}

crop('CASTILLO', 82, 0, 156, 58)
crop('IGLESIA Y HOGAR', 0, 62, 128, 56)
crop('TABERNA Y ALQUIMISTA', 193, 62, 127, 56)
crop('HERRERIA', 0, 124, 86, 52)
crop('PLAZA CIVICA', 84, 136, 152, 38)
crop('ARMERIA', 235, 124, 85, 52)
