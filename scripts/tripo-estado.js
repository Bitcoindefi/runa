'use strict'

// Lo que la vista 2.5D sabe de una partida: el equipo, la mochila, el lugar y la
// celda del heroe. Sale igual del guardado que escribe la terminal
// (scripts/tripo-viewer.js lo lee) que del juego que corre dentro de la pagina
// (scripts/tripo-juego.js), para que las dos formas de jugar se vean igual.

const { items, foes, zones } = require('../lib/content.js')
const { MAPS, TILES } = require('../lib/map.js')
const { Field, BARBARIAN_SETTLEMENTS, vdist } = require('../lib/field.js')
const { DUNGEON, floorRows } = require('../lib/dungeon.js')
const { campRows } = require('../lib/barbarian-camp.js')
const { BOSS_ZONE, volcanicRows } = require('../lib/boss-zone.js')
const { FRAME_TICKS } = require('../lib/world-boss-event.js')
const { COMBAT_RULES, turnLimit } = require('../lib/combat-rules.js')
const { DUEL_BODY_GAP } = require('../lib/duel.js')

const SLOTS = ['left_hand', 'right_hand', 'chest', 'head', 'boots']
// Los mapas fijos del juego que la pagina arma en 3D.
const WORLD_MAPS = ['city', 'nox', 'castle', 'coliseum']

function item(id) {
  if (typeof id !== 'string' || !id) return null
  const known = items[id]
  return known
    ? { id, name: known.name, kind: known.kind, slot: known.slot || null }
    : { id, name: id, kind: 'unknown', slot: null }
}

// Una escena por zona: el Coloso en sus ruinas, el reino en las ciudades y un
// suelo segun el resto. Durante un duelo el juego guarda la ubicacion previa.
function sceneOf(location) {
  if (location.kind === 'boss') return 'ruinas'
  if (location.kind === 'dungeon') return 'cripta'
  if (location.kind === 'field' || location.kind === 'barbarian-camp') return 'pradera'
  return 'reino'
}

// Donde esta el heroe en un mapa que la pagina sabe armar en 3D.
function worldOf(location) {
  const at = { x: Math.floor(Number(location.x) || 0), y: Math.floor(Number(location.y) || 0) }
  if (location.kind === 'boss') return { map: 'boss', ...at }
  if (location.kind === 'map' && WORLD_MAPS.includes(location.mapId)) {
    return { map: location.mapId, ...at }
  }
  return null
}

function wearing(worn = {}) {
  const equipped = {}
  for (const name of SLOTS) equipped[name] = item(worn[name])
  return equipped
}

// Un guardado (lib/saves.js) tal como lo describe la pagina.
function describe(slot, data) {
  const player = data.player || {}
  const summary = data.summary || {}
  const boss = data.worldBossState
  return {
    slot,
    savedAt: data.savedAt || null,
    name: String(data.name || 'viajero'),
    level: Math.max(1, Math.floor(Number(summary.level) || 1)),
    place: String(summary.place || ''),
    scene: sceneOf(data.location || {}),
    world: worldOf(data.location || {}),
    boss: boss ? { hp: Number(boss.hp) || 0, defeated: !!boss.defeated } : null,
    equipped: wearing(player.equipped),
    bag: (Array.isArray(player.items) ? player.items : []).map(item).filter(Boolean),
    gold: Math.max(0, Math.floor(Number(player.gold) || 0))
  }
}

// La ubicacion de un juego en marcha, como la escribe saveState() pero sin
// serializar el campo: la pagina la pide en cada cuadro.
function locationOf(runa) {
  const field = runa.field
  if (field) {
    const at = { x: field.player.x, y: field.player.y }
    if (field.mode === 'boss') return { kind: 'boss', ...at }
    if (field.mode === 'dungeon') return { kind: 'dungeon', ...at }
    if (field.mode === 'barbarian-camp') return { kind: 'barbarian-camp', ...at }
    return { kind: 'field', ...at }
  }
  const walker = runa.walker
  return { kind: 'map', mapId: walker.mapId, x: walker.x, y: walker.y }
}

// Lo que tapa el mapa con una pantalla del juego: el inventario, una tienda, el
// ranking, la wallet, los controles o un desafio que llega. La pagina la muestra
// entera. El desafio que uno mando no tapa nada: se sigue caminando.
function overlayOf(runa) {
  if (runa.title) return 'title'
  if (runa.controlsOpen) return 'controls'
  if (runa.inventoryOpen) return 'inventory'
  if (runa.walletOpen) return 'wallet'
  if (runa.rankingOpen) return 'ranking'
  if (runa.shop) return 'shop'
  if (runa.duelInvite && runa.duelInvite.direction === 'in') return 'duel'
  return null
}

// Lo que hay al lado para la tecla E, como lo decide enter() en game.js: una
// salida, un NPC, el ranking y, si no, otro jugador para desafiar.
function nearOf(runa) {
  if (runa.title || runa.field || (runa.duel && runa.duel.active)) return null
  const action = runa.walker.action()
  if (action) return { kind: action.kind, to: action.to || null, shop: action.shop || null }
  const npc = runa.nearbyNpc()
  if (npc) return { kind: 'npc', name: npc.name, role: npc.role || '' }
  const landmark = runa.nearbyLandmark()
  if (landmark && landmark.action && landmark.action.kind === 'ranking') {
    return { kind: 'ranking', name: landmark.name }
  }
  const peer = runa.nearbyPlayer()
  if (peer) return { kind: 'player', id: peer.id, name: peer.name }
  return null
}

// El duelo en curso como lo cuenta DuelCombat: los dos combatientes en celdas
// del Coliseo, con su vida, alcance y recarga. En red lo ordena el host, asi
// que la pagina dibuja lo que paso y nunca lo que va a pasar.
function arenaOf(runa) {
  if (!runa.duel || !runa.duel.active || !runa.duelCombat) return null
  const snap = runa.duelCombat.snapshot(runa.duel.self)
  const fighter = (f) => ({
    id: f.id,
    name: runa.duelName(f.id),
    x: f.x,
    y: f.y,
    hp: f.hp,
    maxHp: f.maxHp,
    reach: f.reach,
    cooldown: f.cooldown,
    cooldownLeft: f.cooldownLeft,
    swinging: f.swinging,
    // L7: los ticks que le faltan al golpe que esta preparando (0 si ninguno).
    winding: f.winding || 0
  })
  const network = runa.duelNetwork
  return {
    tick: snap.tick,
    distance: snap.distance,
    // Las celdas entre los dos que no cuentan en la distancia (los cuerpos): la
    // pagina dibuja el alcance desde la celda del heroe.
    gap: DUEL_BODY_GAP,
    // L7: los ticks de carga de cada golpe que acordaron los dos (0 = al toque).
    windup: runa.duelCombat.windup || 0,
    self: fighter(snap.self),
    rival: fighter(snap.rival),
    online: !!network,
    host: !!(network && runa.presence && network.hostId === runa.presence.id)
  }
}

// Los otros jugadores de la sala parados en el mismo mapa: en la ciudad, como
// los dibuja la terminal; afuera, los de la misma region (la pradera, un piso
// de la cripta, un campamento, las ruinas). `map` es el id del mapa 3D (el de
// regionOf) y `pose` la pose opcional para dibujarlos suave (net.cleanPose).
// Solo se desafia en la ciudad (challenge). El rival de un duelo no va aca: va
// en arena, que es la que manda.
function playersOf(runa, arena) {
  if (runa.title) return []
  const rival = arena ? arena.rival.id : null
  const map = regionOf(runa)
  const list = runa.field
    ? runa.others().filter((peer) => regionOfMapId(peer.mapId) === map)
    : runa.others(runa.walker.mapId)
  return list
    .filter((peer) => peer.id && peer.id !== rival)
    .map(({ id, name, x, y, level, pose }) => ({
      id,
      name,
      x,
      y,
      level,
      map,
      challenge: !runa.field,
      pose: pose && typeof pose === 'object' ? { ...pose } : {}
    }))
}

function inviteOf(runa) {
  const invite = runa.duelInvite
  return invite ? { direction: invite.direction, name: invite.name } : null
}

// Los monstruos vivos de un campo (la pradera, la cripta, un campamento) y sus
// guias, para dibujarlos en 3D: donde esta cada uno y que es.
function foesOf(field) {
  if (!field || !Array.isArray(field.foes)) return null
  const list = []
  for (const foe of field.foes) {
    if (foe.dead) continue
    const def = foes[foe.kind] || {}
    list.push({ id: foe.id, kind: foe.kind, name: def.name || foe.kind, x: foe.x, y: foe.y })
  }
  return list
}

// Los ticks que resuelve cada ataque con el turno fijo: el COMBAT_TURN_TICKS de
// lib/game.js (una prueba los compara; game.js no se carga aca porque el visor
// lee este archivo en Node). Con el turno hasta el proximo golpe (L3,
// COMBAT_RULES.turnUntilBlow) un ataque resuelve hasta turnLimit() ticks.
const COMBAT_TURN = 6

// Los ticks por segundo de la pelea del campo (lib/world.js TPS): la pagina
// reproduce cada turno a este ritmo, con la barra de carga llenandose.
const FIGHT_TPS = 30

// Lo que dura un tick del juego en milisegundos: el TICK_MS de lib/game.js (una
// prueba los compara, igual que COMBAT_TURN).
const TICK = 1000 / 15

// Las celdas que de verdad recorre el golpe marcado y las que ya queman. Las
// marcas del Coloso son solo muestras (una cada dos celdas) y el poder pega a
// una celda de distancia, asi que se copia el Coloso sin tocarlo, se suelta el
// golpe en la copia y se avanzan sus poderes hasta que se apagan: "path" es lo
// que recorre el golpe nuevo y "burnt" lo que recorren los poderes que ya
// estaban sueltos.
function strikeZone(boss, action, now, total) {
  const sim = Object.assign(Object.create(Object.getPrototypeOf(boss)), boss, {
    hazards: (boss.hazards || []).map((hazard) => ({ ...hazard }))
  })
  const key = (x, y) => x + ',' + y
  const path = new Set()
  const burnt = new Set()
  const fresh = new Set()
  const record = () => {
    for (const hazard of sim.hazards) {
      const cell = key(Math.round(hazard.x), Math.round(hazard.y))
      if (fresh.has(hazard)) path.add(cell)
      else burnt.add(cell)
    }
  }
  const fire = action.startedAt + total
  record()
  for (let t = Math.min(now, fire); t <= fire + 400; t++) {
    if (t === fire) {
      const before = new Set(sim.hazards)
      sim.release(action.attack, action.target, t)
      for (const hazard of sim.hazards) if (!before.has(hazard)) fresh.add(hazard)
      record()
    }
    sim.moveHazards(t)
    record()
    if (t >= fire && !sim.hazards.length) break
  }
  return { path, burnt }
}

// La ayuda para esquivar al Coloso, solo para la vista (no cambia reglas):
// cuanto lleva cargado el golpe que marco (en ticks y en milisegundos), las
// celdas que recorre el golpe ("path", para pintar el piso entero y no solo las
// marcas) y, si el heroe esta donde lo alcanza un poder (en el recorrido o a una
// celda, como mide touch() en lib/world-boss-event.js), la celda mas cercana
// fuera de ese alcance. Tambien tiene que estar dentro del mapa y fuera del
// cuerpo del Coloso; se camina en ocho direcciones, asi que "cerca" son los
// pasos (y a igual pasos, la recta).
function bossDodge(field) {
  const boss = field && field.mode === 'boss' ? field.boss : null
  const action = boss && boss.action
  if (!action) return null
  // La carga de verdad (L6): la del telegraph del ataque, no solo sus cuadros.
  const total =
    typeof boss.windupOf === 'function'
      ? boss.windupOf(action.attack)
      : Math.max(1, ((action.attack && action.attack.frames) || ['idle']).length) * FRAME_TICKS
  const done = Math.max(0, Math.min(total, field.time - action.startedAt))
  const key = (x, y) => x + ',' + y
  const { path, burnt } = strikeZone(boss, action, field.time, total)
  const reach = new Set()
  for (const cells of [path, burnt]) {
    for (const cell of cells) {
      const [x, y] = cell.split(',').map(Number)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) reach.add(key(x + dx, y + dy))
      }
    }
  }
  const hx = field.player.x
  const hy = field.player.y
  const danger = reach.has(key(hx, hy))
  let safe = null
  if (danger) {
    const free = (x, y) =>
      x >= 0 &&
      y >= 0 &&
      x < field.width &&
      y < field.height &&
      !reach.has(key(x, y)) &&
      !boss.occupies(x, y)
    const far = Math.max(field.width, field.height)
    for (let r = 1; r <= far && !safe; r++) {
      let best = Infinity
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const d = dx * dx + dy * dy
          if (d < best && free(hx + dx, hy + dy)) {
            best = d
            safe = { x: hx + dx, y: hy + dy }
          }
        }
      }
    }
  }
  return {
    // Que golpe es (lib/world-boss.js): la vista elige con eso la animacion.
    attack: (action.attack && action.attack.id) || null,
    done,
    total,
    leftMs: Math.round((total - done) * TICK),
    totalMs: Math.round(total * TICK),
    path: [...path].map((cell) => {
      const [x, y] = cell.split(',').map(Number)
      return { x, y }
    }),
    danger,
    safe
  }
}

// La pelea en curso, para animarla: contra quien, la vida de los dos, el arma en
// la mano (la elige el guion entre golpe y golpe) y las ultimas lineas de la
// pelea con su tick y, con L1, con lo que paso como dato (type, by, amount).
// Cada ataque resuelve varios ticks de una vez: hasta el proximo golpe si
// untilBlow (L3), con turn como tope, o turn ticks fijos. Para leer el turno
// (tripo-combate.mjs readout): la recarga de los dos (ticks que faltan y el
// total), la distancia, el alcance y la velocidad de cada uno, si el heroe esta
// en pleno golpe, las pociones que le quedan, lo que pega el monstruo (foeHit,
// para contar sus golpes cuando una pocion los tapa) y las acciones que acepta
// el juego (potion, guard, retreat).
function fightOf(field) {
  const combat = field && field.combat
  const world = combat && combat.world
  if (!world) return null
  const held = world.held.left
  const mine = world.hero.derive(Object.values(world.held))
  const theirs = world.foe.derive([])
  const count = (value) => Math.max(0, Math.floor(Number(value) || 0))
  const rules = world.rules || COMBAT_RULES
  return {
    turn: rules.turnUntilBlow ? turnLimit(rules) : COMBAT_TURN,
    untilBlow: !!rules.turnUntilBlow,
    tps: FIGHT_TPS,
    actions: {
      potion: !!rules.manualPotion,
      guard: !!rules.guard,
      retreat: !!rules.retreat
    },
    heroCd: count(world.hero.cooldownLeft),
    heroCdMax: mine.cooldown,
    foeCd: count(world.foe.cooldownLeft),
    foeCdMax: theirs.cooldown,
    foeHit: Math.max(1, theirs.atk - mine.defense),
    dist: Math.round(Math.abs(world.foe.x - world.hero.x) * 100) / 100,
    reach: mine.reach,
    foeReach: theirs.reach,
    speed: mine.speed,
    foeSpeed: theirs.speed,
    swinging: count(world.hero.swinging),
    potions: count(world.potions),
    id: combat.foe.id,
    kind: combat.foe.kind,
    tick: world.tick,
    // Las lineas del registro hasta ahora (L1): las de un turno son las de n mayor.
    logged: world.logged || 0,
    over: world.over || null,
    hp: Math.max(0, Math.ceil(Number(world.hero.hp) || 0)),
    maxhp: world.hero.base.hp,
    foeHp: Math.max(0, Math.ceil(Number(world.foe.hp) || 0)),
    foeMaxhp: world.foe.base.hp,
    weapon: held && held.kind === 'weapon' ? held.id : null,
    log: world.log.slice(-8).map((entry) => ({ ...entry }))
  }
}

// --- El atlas: la region, los portones entre regiones y el objetivo ----------
//
// Las regiones son los mapas que la pagina arma en 3D, con el mismo id: los
// mapas fijos (city, nox, castle, coliseum, dungeon = las ruinas bajo el
// castillo), la pradera ('field'), cada piso de la cripta ('crypt-1'..) y cada
// campamento ('camp:<id>'), y las ruinas del Coloso ('boss').

// La region donde esta el heroe.
function regionOf(runa) {
  const field = runa.field
  if (field) {
    if (field.mode === 'dungeon') return 'crypt-' + (Math.floor(Number(field.floor)) || 1)
    if (field.mode === 'barbarian-camp' && field.camp) return 'camp:' + field.camp.id
    if (field.mode === 'boss') return 'boss'
    return 'field'
  }
  return runa.walker ? runa.walker.mapId : null
}

// La region del mapa que anuncia otro jugador (lib/game.js awayMapId):
// 'crypt2' es 'crypt-2' y 'camp-x' es 'camp:x'.
function regionOfMapId(mapId) {
  const id = String(mapId || '')
  const crypt = /^crypt(\d+)$/.exec(id)
  if (crypt) return 'crypt-' + crypt[1]
  if (id.startsWith('camp-') && id.length > 5) return 'camp:' + id.slice(5)
  return id || null
}

// Adonde lleva un porton de un mapa fijo. Volver de las ruinas deja en el
// castillo y salir del castillo, en la ciudad (game.js enter, 'travel').
function travelTo(enter) {
  if (enter.returnTo === 'dungeon') return 'castle'
  if (enter.returnTo === 'castle') return 'city'
  return enter.to
}

// Los portones de cada region: { region: [{ to, x, y }] }, en celdas de esa
// region. Sale del juego: los mapas fijos de lib/map.js, la pradera de un Field
// (su porton de RUNA, el de NOX, la cripta, el portal y los campamentos), las
// escaleras de cada piso, la salida de cada campamento y el portal del Coloso.
let gates = null
function gateGraph() {
  if (gates) return gates
  const graph = {}
  const add = (from, to, at) => {
    if (!at || !to) return
    if (!graph[from]) graph[from] = []
    graph[from].push({ to, x: at.x, y: at.y })
  }
  for (const map of Object.values(MAPS)) {
    // MAPS.field es el campo viejo de la terminal: la pradera es un Field.
    if (map.id === 'field') continue
    map.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const tile = TILES[row[x]]
        const enter = tile && tile.enter
        if (enter && enter.kind === 'travel') add(map.id, travelTo(enter), { x, y })
      }
    })
  }
  const meadow = new Field({ seed: 1 })
  add('field', 'city', meadow.gate)
  add('field', 'nox', meadow.noxGate)
  add('field', 'crypt-1', meadow.dungeonEntrance)
  add('field', 'boss', meadow.worldBossPortal)
  for (const camp of BARBARIAN_SETTLEMENTS) {
    add('field', 'camp:' + camp.id, camp)
    add('camp:' + camp.id, 'field', campRows(camp.id).exit)
  }
  for (let floor = 1; floor <= DUNGEON.floors; floor++) {
    const plan = floorRows(floor)
    add('crypt-' + floor, floor === 1 ? 'field' : 'crypt-' + (floor - 1), plan.up)
    if (plan.down) add('crypt-' + floor, 'crypt-' + (floor + 1), plan.down)
  }
  add('boss', 'field', volcanicRows(BOSS_ZONE.width, BOSS_ZONE.height).portal)
  gates = graph
  return graph
}

// El camino de una region a otra, por anchura sobre los portones: la lista de
// portones a cruzar, [{ region, to, x, y }], el primero en `from`. [] si ya
// esta ahi y null si no hay camino. Si hay dos portones al mismo lado, el
// primero es el mas cercano a `at` (la celda del heroe).
function routeTo(from, to, at = null) {
  if (!from || !to) return null
  if (from === to) return []
  const graph = gateGraph()
  const back = new Map([[from, null]])
  const queue = [from]
  while (queue.length && !back.has(to)) {
    const region = queue.shift()
    for (const gate of graph[region] || []) {
      if (back.has(gate.to)) continue
      back.set(gate.to, region)
      queue.push(gate.to)
    }
  }
  if (!back.has(to)) return null
  const path = [to]
  while (back.get(path[0]) !== null) path.unshift(back.get(path[0]))
  const hops = []
  for (let i = 0; i < path.length - 1; i++) {
    const options = graph[path[i]].filter((gate) => gate.to === path[i + 1])
    let best = options[0]
    if (i === 0 && at) {
      const far = (gate) => Math.abs(gate.x - at.x) + Math.abs(gate.y - at.y)
      for (const gate of options) if (far(gate) < far(best)) best = gate
    }
    hops.push({ region: path[i], to: best.to, x: best.x, y: best.y })
  }
  return hops
}

// Los tres campamentos con su celda en la pradera y si ya quedaron despejados.
function campsOf(runa) {
  const state = runa.barbarianState
  const cleared = new Set((state && Array.isArray(state.cleared) ? state.cleared : []).map(String))
  // El campamento abierto sin nadie en pie ya cuenta, antes de salir por la U.
  const field = runa.field
  if (field && field.mode === 'barbarian-camp' && field.camp && Array.isArray(field.foes)) {
    if (field.foes.every((foe) => foe.dead)) cleared.add(field.camp.id)
  }
  return BARBARIAN_SETTLEMENTS.map((camp) => ({
    id: camp.id,
    name: camp.name,
    x: camp.x,
    y: camp.y,
    cleared: cleared.has(camp.id)
  }))
}

// Adonde manda el capitulo de la historia (st.story): { kind, region, x, y }.
// Con el capitulo por entregar o por cobrar, el rey en el castillo. Despues: el
// anillo de los mosquitos alrededor del porton de RUNA (radius en celdas
// visuales, como zoneAt), el campamento sin despejar mas cercano o el portal
// del Coloso (adentro de las ruinas, el Coloso). null sin nada que hacer.
// `at` es la celda del heroe en `here`; `boss`, donde esta el Coloso.
function storyTarget(story, here, camps = [], at = null, boss = null) {
  if (!story || story.status === 'done') return null
  if (story.status !== 'active') {
    const giver = story.giver || { map: 'castle', x: 56, y: 13 }
    return { kind: 'giver', region: giver.map, x: giver.x, y: giver.y }
  }
  const meadow = gateGraph().field
  const gateTo = (to) => meadow.find((gate) => gate.to === to)
  if (story.id === 'king_trial') {
    const gate = gateTo('city')
    return { kind: 'ring', region: 'field', x: gate.x, y: gate.y, radius: zones[0].until }
  }
  if (story.id === 'barbarian_raid') {
    const open = camps.filter((camp) => !camp.cleared)
    const inside = open.find((camp) => 'camp:' + camp.id === here)
    if (inside) return { kind: 'camp', region: here, id: inside.id, x: null, y: null }
    if (!open.length) return null
    // Desde una capital se mide desde su porton a la pradera: NOX sale por el este.
    const from = here === 'field' && at ? at : gateTo(here === 'nox' ? 'nox' : 'city')
    const far = (camp) => vdist(camp.x, camp.y, from.x, from.y)
    let best = open[0]
    for (const camp of open) if (far(camp) < far(best)) best = camp
    return { kind: 'camp', region: 'field', id: best.id, x: best.x, y: best.y }
  }
  if (story.id === 'colossus_awakening') {
    if (here === 'boss') {
      return { kind: 'boss', region: 'boss', x: boss ? boss.x : null, y: boss ? boss.y : null }
    }
    const portal = gateTo('boss')
    return { kind: 'portal', region: 'field', x: portal.x, y: portal.y }
  }
  return null
}

// Cuantos otros jugadores de la sala hay en cada region (la presencia de
// lib/net.js, ya limpiada por runa.others).
function playersByRegion(runa) {
  const counts = {}
  if (typeof runa.others !== 'function') return counts
  for (const peer of runa.others()) {
    const region = regionOfMapId(peer.mapId)
    if (region) counts[region] = (counts[region] || 0) + 1
  }
  return counts
}

// El atlas de un juego en marcha, para el minimapa y el mapa de la pagina: la
// region, los campamentos, el objetivo de la historia y el camino hasta el.
// discovered queda en null: la niebla de guerra no esta en este paso.
function atlasOf(runa, story = runa.storySummary()) {
  if (runa.title) return null
  const region = regionOf(runa)
  const location = locationOf(runa)
  const at = { x: location.x, y: location.y }
  const field = runa.field
  const boss = field && field.mode === 'boss' && field.boss ? field.boss : null
  const camps = campsOf(runa)
  const target = storyTarget(story, region, camps, at, boss)
  const graph = gateGraph()
  return {
    region,
    camps,
    target,
    route: target ? routeTo(region, target.region, at) : null,
    // Los portones de esta region y todos los del reino (fijos, para la pestana
    // del reino): { from, to, x, y } con la celda en `from`.
    exits: graph[region] || [],
    links: linksOf(graph),
    players: playersByRegion(runa),
    discovered: null
  }
}

let links = null
function linksOf(graph) {
  if (!links) {
    links = []
    for (const [from, list] of Object.entries(graph)) {
      for (const gate of list) links.push({ from, ...gate })
    }
  }
  return links
}

// Un juego en marcha (lib/game.js Runa) tal como lo describe la pagina.
function live(runa) {
  const sheet = runa.player.snapshot()
  const location = locationOf(runa)
  const field = runa.field
  const boss = field && field.mode === 'boss' && field.boss ? field.boss.snapshot() : null
  const fight = field && field.combat && field.combat.world
  const arena = arenaOf(runa)
  // La vida que se juega ahora: la de la pelea, la del duelo (que no toca la
  // de la ficha) o la de la ficha.
  let hp = sheet.hp
  let maxhp = sheet.maxhp
  if (fight) hp = Math.max(0, Math.ceil(Number(fight.hero.hp) || 0))
  else if (arena) {
    hp = arena.self.hp
    maxhp = arena.self.maxHp
  }
  const story = runa.title ? null : runa.storySummary()
  return {
    title: !!runa.title,
    naming: !!runa.naming,
    name: runa.name,
    realm: runa.realm,
    slot: runa.activeSlot,
    level: sheet.level,
    hp,
    maxhp,
    gold: sheet.gold,
    xp: sheet.xpinto,
    xpneed: sheet.xpneed,
    potions: sheet.potions,
    location,
    scene: sceneOf(location),
    world: worldOf(location),
    field: field ? field.mode : null,
    combat: !!fight,
    duel: !!(runa.duel && runa.duel.active),
    overlay: overlayOf(runa),
    near: nearOf(runa),
    boss: boss
      ? {
          hp: boss.hp,
          maxhp: boss.maxhp,
          phase: boss.phase,
          defeated: !!boss.defeated,
          active: !!boss.active,
          x: boss.x,
          y: boss.y,
          // Donde va a pegar y lo que ya quema: la vista 3D lo marca en el piso.
          telegraphs: boss.telegraphs.map(({ x, y }) => ({ x, y })),
          hazards: boss.hazards.map(({ x, y }) => ({ x, y })),
          // La carga del golpe marcado y hacia donde salir (bossDodge).
          dodge: bossDodge(field),
          // La recarga del arma del heroe contra el Coloso (L6), en ticks del
          // reloj del juego.
          strike: typeof field.strikeCharge === 'function' ? field.strikeCharge() : null
        }
      : null,
    equipped: wearing(sheet.equipped),
    bag: sheet.items.map(item).filter(Boolean),
    foes: foesOf(field),
    fight: fightOf(field),
    // El capitulo del modo historia, para un rastreador: titulo, objetivo,
    // progreso y a quien volver. Los textos van en castellano y la pagina los
    // traduce con tr(). Forma completa en docs/story.md.
    story,
    // El minimapa y el mapa de la region (tripo-atlas.mjs).
    atlas: runa.title ? null : atlasOf(runa, story),
    arena,
    players: playersOf(runa, arena),
    invite: inviteOf(runa),
    pvp: { ...sheet.pvp },
    lastDuel: runa.lastDuelResult ? { ...runa.lastDuelResult } : null
  }
}

module.exports = {
  COMBAT_TURN,
  FIGHT_TPS,
  TICK,
  SLOTS,
  WORLD_MAPS,
  item,
  sceneOf,
  worldOf,
  describe,
  locationOf,
  overlayOf,
  nearOf,
  arenaOf,
  playersOf,
  inviteOf,
  foesOf,
  fightOf,
  bossDodge,
  regionOf,
  regionOfMapId,
  gateGraph,
  routeTo,
  campsOf,
  storyTarget,
  playersByRegion,
  atlasOf,
  live
}
