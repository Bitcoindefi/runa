'use strict'

// Lo que la vista 2.5D sabe de una partida: el equipo, la mochila, el lugar y la
// celda del heroe. Sale igual del guardado que escribe la terminal
// (scripts/tripo-viewer.js lo lee) que del juego que corre dentro de la pagina
// (scripts/tripo-juego.js), para que las dos formas de jugar se vean igual.

const { items, foes } = require('../lib/content.js')

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
// ranking, la wallet, los controles o un desafio. La pagina la muestra entera.
function overlayOf(runa) {
  if (runa.title) return 'title'
  if (runa.controlsOpen) return 'controls'
  if (runa.inventoryOpen) return 'inventory'
  if (runa.walletOpen) return 'wallet'
  if (runa.rankingOpen) return 'ranking'
  if (runa.shop) return 'shop'
  if (runa.duelInvite) return 'duel'
  return null
}

// Lo que hay al lado para la tecla E, como lo decide enter() en game.js.
function nearOf(runa) {
  if (runa.title || runa.field) return null
  const action = runa.walker.action()
  if (action) return { kind: action.kind, to: action.to || null, shop: action.shop || null }
  const npc = runa.nearbyNpc()
  if (npc) return { kind: 'npc', name: npc.name, role: npc.role || '' }
  const landmark = runa.nearbyLandmark()
  if (landmark && landmark.action && landmark.action.kind === 'ranking') {
    return { kind: 'ranking', name: landmark.name }
  }
  return null
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

// La pelea en curso, para animarla: contra quien, la vida de los dos, el arma en
// la mano (la elige el guion entre golpe y golpe) y las ultimas lineas de la
// pelea con su tick. Cada ataque resuelve varios ticks de una vez.
function fightOf(field) {
  const combat = field && field.combat
  const world = combat && combat.world
  if (!world) return null
  const held = world.held.left
  return {
    id: combat.foe.id,
    kind: combat.foe.kind,
    tick: world.tick,
    over: world.over || null,
    hp: Math.max(0, Math.ceil(Number(world.hero.hp) || 0)),
    maxhp: world.hero.base.hp,
    foeHp: Math.max(0, Math.ceil(Number(world.foe.hp) || 0)),
    foeMaxhp: world.foe.base.hp,
    weapon: held && held.kind === 'weapon' ? held.id : null,
    log: world.log.slice(-8).map(({ tick, text }) => ({ tick, text }))
  }
}

// Un juego en marcha (lib/game.js Runa) tal como lo describe la pagina.
function live(runa) {
  const sheet = runa.player.snapshot()
  const location = locationOf(runa)
  const field = runa.field
  const boss = field && field.mode === 'boss' && field.boss ? field.boss.snapshot() : null
  const fight = field && field.combat && field.combat.world
  return {
    title: !!runa.title,
    naming: !!runa.naming,
    name: runa.name,
    realm: runa.realm,
    slot: runa.activeSlot,
    level: sheet.level,
    hp: fight ? Math.max(0, Math.ceil(Number(fight.hero.hp) || 0)) : sheet.hp,
    maxhp: sheet.maxhp,
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
          hazards: boss.hazards.map(({ x, y }) => ({ x, y }))
        }
      : null,
    equipped: wearing(sheet.equipped),
    bag: sheet.items.map(item).filter(Boolean),
    foes: foesOf(field),
    fight: fightOf(field)
  }
}

module.exports = {
  SLOTS,
  WORLD_MAPS,
  item,
  sceneOf,
  worldOf,
  describe,
  locationOf,
  overlayOf,
  nearOf,
  foesOf,
  fightOf,
  live
}
