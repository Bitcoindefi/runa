'use strict'

/**
 * High-resolution top-down arena used by player duels.
 *
 * The duel system deliberately does not live here. This module only owns the
 * architecture and the stable coordinates it needs: two mirrored entrances,
 * the referee point and the playable floor. Keeping those details as map data
 * lets multiplayer place both contenders without duplicating magic numbers.
 */

const COLISEUM_WIDTH = 128
const COLISEUM_HEIGHT = 52

const DUEL_SPAWNS = [
  { id: 'west', x: 40, y: 24, facing: 'east' },
  { id: 'east', x: 87, y: 24, facing: 'west' }
]

const REFEREE_SPAWN = { x: 64, y: 18, facing: 'south' }
const ARRIVAL = { x: 64, y: 47 }
const EXIT = { x: 64, y: 50 }

const ARENA_BOUNDS = {
  x1: 27,
  y1: 10,
  x2: 100,
  y2: 37,
  center: { x: 64, y: 24 }
}

function setText(grid, x, y, text) {
  for (let i = 0; i < text.length; i++) {
    if (x + i >= 0 && x + i < COLISEUM_WIDTH) grid[y][x + i] = text[i]
  }
}

function makeColiseumRows() {
  const grid = Array.from({ length: COLISEUM_HEIGHT }, () => Array(COLISEUM_WIDTH).fill(','))
  const cx = (COLISEUM_WIDTH - 1) / 2
  const cy = 23.5
  const rx = 60
  const ry = 22

  for (let y = 0; y < COLISEUM_HEIGHT; y++) {
    for (let x = 0; x < COLISEUM_WIDTH; x++) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance <= 0.62) {
        grid[y][x] = '%'
      } else if (distance <= 0.68) {
        grid[y][x] = '#'
      } else if (distance <= 0.91) {
        const crowd = (x * 3 + y * 5) % 11
        grid[y][x] = crowd < 2 ? 'o' : y % 3 === 0 ? '=' : ':'
      } else if (distance <= 0.98) {
        grid[y][x] = '#'
      }
    }
  }

  // The central ring and its runes are walkable markings, never obstacles.
  for (let x = 46; x <= 81; x++) grid[24][x] = ';'
  for (let y = 17; y <= 31; y++) grid[y][64] = ';'
  for (const [x, y] of [
    [53, 19],
    [75, 19],
    [53, 29],
    [75, 29],
    [60, 16],
    [68, 16],
    [60, 32],
    [68, 32]
  ]) {
    grid[y][x] = '*'
  }

  // South tunnel: a continuous route through the stands and exterior wall.
  // It is intentionally wider than the hero sprite so the entrance reads as
  // architecture rather than a single magic tile.
  for (let y = 36; y <= 50; y++) {
    grid[y][59] = '#'
    grid[y][69] = '#'
    for (let x = 60; x <= 68; x++) grid[y][x] = '.'
  }
  grid[36][59] = '+'
  grid[36][69] = '+'
  grid[49][59] = '+'
  grid[49][69] = '+'
  grid[50][EXIT.x] = 'Q'

  // Mirrored combatant gates. They are visual thresholds inside the arena;
  // the multiplayer layer places contenders on the exposed spawn coordinates.
  for (let x = 23; x <= 31; x++) grid[24][x] = x === 27 ? '+' : '%'
  for (let x = 96; x <= 104; x++) grid[24][x] = x === 100 ? '+' : '%'

  setText(grid, 55, 5, 'coliseo de runa')
  setText(grid, 45, 41, 'puerta sur')

  return grid.map((row) => row.join(''))
}

const COLISEUM_ROWS = makeColiseumRows()

const COLISEUM_META = {
  arrive: ARRIVAL,
  exit: EXIT,
  arenaBounds: ARENA_BOUNDS,
  duelSpawns: DUEL_SPAWNS,
  refereeSpawn: REFEREE_SPAWN
}

module.exports = {
  COLISEUM_WIDTH,
  COLISEUM_HEIGHT,
  COLISEUM_ROWS,
  COLISEUM_META,
  makeColiseumRows
}
