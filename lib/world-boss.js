'use strict'

/**
 * Diseno declarativo del primer jefe mundial de Runa.
 *
 * Este archivo no controla red, combate ni guardados. Es el contrato comun que
 * esos sistemas pueden consumir sin duplicar estadisticas, fases o arte. El
 * jefe tampoco pertenece a CONTENT.foes: no debe aparecer por azar ni ocupar
 * uno de los cupos de monstruos de la pradera.
 *
 * Todo el dibujo usa ASCII 128 para conservar la silueta en cualquier consola.
 */
const FIELD_WIDTH = 43
const FIELD_HEIGHT = 13

/**
 * Todos los cuadros nacen sobre el mismo lienzo. Aunque un brazo se extienda,
 * la terminal siempre recibe 43x13 caracteres y no desplaza el terreno.
 */
function makeFieldFrame(pose = 'idle') {
  const canvas = Array.from({ length: FIELD_HEIGHT }, () => Array(FIELD_WIDTH).fill(' '))
  const write = (x, y, text) => {
    if (y < 0 || y >= FIELD_HEIGHT) return
    const line = String(text)
    for (let i = 0; i < line.length; i++) {
      if (x + i >= 0 && x + i < FIELD_WIDTH) canvas[y][x + i] = line[i]
    }
  }
  const centre = (y, text) => write(Math.floor((FIELD_WIDTH - text.length) / 2), y, text)

  if (pose === 'idle' || pose === 'idlePulse') {
    write(3, 4, '(O)===')
    write(34, 4, '===(O)')
    write(0, 5, '[###]---\\_')
    write(33, 5, '_/---[###]')
  } else if (pose === 'punchLeft') {
    write(0, 5, '[###]=====')
    write(34, 4, '===(O)')
    write(33, 5, '_/---[###]')
  } else if (pose === 'punchRight') {
    write(3, 4, '(O)===')
    write(0, 5, '[###]---\\_')
    write(33, 5, '=====[###]')
  } else if (pose === 'sweep') {
    write(0, 6, '[###]=====')
    write(33, 6, '=====[###]')
  } else if (pose === 'slam') {
    write(2, 0, '[###]')
    write(3, 1, '||')
    write(4, 2, '\\\\')
    write(5, 3, '\\\\')
    write(6, 4, '\\\\___')
    write(34, 4, '===(O)')
    write(33, 5, '_/---[###]')
  } else if (pose === 'slamImpact') {
    write(5, 6, '\\\\___')
    write(4, 7, '||')
    write(3, 8, '||')
    write(2, 9, '||')
    write(0, 10, '[###]')
    write(0, 11, '^^^^^^^')
    write(34, 4, '===(O)')
    write(33, 5, '_/---[###]')
  }

  const pulsing = pose === 'idlePulse'
  centre(0, pulsing ? '___/^^*^^\\___' : '___/^^R^^\\___')
  centre(1, ".-'../_____\\..'-.")
  centre(2, pulsing ? '/___/|.[*].[*].|\\___\\' : '/___/|.[#].[#].|\\___\\')
  centre(3, '|....|....^....|....|')
  centre(4, pulsing ? '|....|..=V=...|....|' : '|....|..===...|....|')
  centre(5, '\\____|_\\___/_|____/')
  centre(6, pulsing ? '[|.....<.*.>.....|]' : '[|.....<.R.>.....|]')
  centre(7, '|===============|')
  centre(8, '/|===============|\\')
  centre(9, '/.|...../|.|\\.....|.\\')
  centre(10, '__/..|..../_|.|_\\....|..\\__')
  centre(11, '/___/|.._/./...\\.\\_..|\\___\\')
  centre(12, '/____/.|_/_/.....\\_\\_|.\\____\\')

  return canvas.map((row) => row.join(''))
}

const FIELD_FRAMES = {
  idle: makeFieldFrame('idle'),
  idlePulse: makeFieldFrame('idlePulse'),
  punchLeft: makeFieldFrame('punchLeft'),
  punchRight: makeFieldFrame('punchRight'),
  sweep: makeFieldFrame('sweep'),
  slam: makeFieldFrame('slam'),
  slamImpact: makeFieldFrame('slamImpact')
}

const PORTRAIT_ART = FIELD_FRAMES.idle

const WORLD_BOSS = {
  id: 'coloso_runico',
  name: 'Coloso Runico',
  title: 'el guardian sepultado',
  glyph: 'W',
  unique: true,
  stationary: true,
  zone: 'yermo',
  spawn: {
    landmark: 'altar_quebrado',
    announcement: 'El suelo tiembla: el Coloso Runico ha despertado.',
    defeat: 'La runa del Coloso se apaga y el yermo queda en silencio.'
  },
  stats: {
    hp: 360,
    atk: 9,
    reach: 10,
    speed: 0.06,
    cooldown: 28,
    defense: 2
  },
  drop: {
    gold: [80, 120],
    xp: 120,
    oncePerSpawn: true
  },
  about: 'una estatua enterrada que protege la primera runa',

  /**
   * El sprite de campo mide 43x13: es una presencia excepcional frente al
   * heroe de 8x3, pero conserva un lienzo fijo durante todos sus ataques.
   * La coordenada logica vive en el centro de sus pies.
   */
  fieldSprite: {
    width: FIELD_WIDTH,
    height: FIELD_HEIGHT,
    anchor: { x: 21, y: 12 },
    marker: 'W',
    color: 'red',
    lines: FIELD_FRAMES.idle,
    frames: FIELD_FRAMES
  },

  /** Retrato para anuncio, ficha o entrada al combate. */
  portrait: {
    width: FIELD_WIDTH,
    lines: PORTRAIT_ART,
    line: 'la montana abre los ojos'
  },

  /**
   * Umbrales descendentes. Cada fase agrega una lectura nueva sin borrar las
   * anteriores, para que el jugador pueda corregir su estrategia durante el
   * mismo encuentro.
   */
  phases: [
    {
      id: 'despertar',
      at: 1,
      name: 'Piedra dormida',
      color: 'gray',
      attacks: [
        {
          id: 'punio_izquierdo',
          name: 'Punio de piedra',
          damage: 9,
          telegraph: 1,
          reach: 3,
          frames: ['idle', 'punchLeft', 'idle']
        },
        {
          id: 'punio_derecho',
          name: 'Reves de piedra',
          damage: 9,
          telegraph: 1,
          reach: 3,
          frames: ['idle', 'punchRight', 'idle']
        },
        {
          id: 'onda',
          name: 'Onda runica',
          damage: 6,
          telegraph: 2,
          reach: 10,
          frames: ['idle', 'sweep', 'idle']
        }
      ]
    },
    {
      id: 'fractura',
      at: 0.66,
      name: 'Runa fracturada',
      color: 'yellow',
      announcement: 'La coraza se parte y la runa empieza a latir.',
      modifiers: { defense: -1, cooldown: -4 },
      attacks: [
        {
          id: 'barrido',
          name: 'Barrido del guardian',
          damage: 11,
          telegraph: 2,
          reach: 6,
          frames: ['punchLeft', 'sweep', 'punchRight', 'idle']
        }
      ]
    },
    {
      id: 'furia',
      at: 0.3,
      name: 'Nucleo expuesto',
      color: 'red',
      announcement: 'El nucleo queda expuesto. Cada golpe hace temblar el yermo.',
      modifiers: { defense: -1, atk: 3, cooldown: -5 },
      attacks: [
        {
          id: 'colapso',
          name: 'Colapso runico',
          damage: 15,
          telegraph: 3,
          reach: 10,
          frames: ['slam', 'slam', 'slamImpact', 'sweep', 'idle']
        }
      ]
    }
  ]
}

/**
 * Devuelve la fase que corresponde a la vida actual. La funcion no guarda
 * estado: la autoridad de red puede llamarla para reconstruir una pelea.
 */
function phaseFor(hp, maxhp = WORLD_BOSS.stats.hp) {
  const maximum = Math.max(1, Number(maxhp) || WORLD_BOSS.stats.hp)
  const current = Number.isFinite(Number(hp)) ? Number(hp) : maximum
  const ratio = Math.max(0, Math.min(1, current / maximum))
  for (let i = WORLD_BOSS.phases.length - 1; i >= 0; i--) {
    if (ratio <= WORLD_BOSS.phases[i].at) return WORLD_BOSS.phases[i]
  }
  return WORLD_BOSS.phases[0]
}

module.exports = { WORLD_BOSS, phaseFor }
