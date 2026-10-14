const { test } = require('brittle')
const red = require('../scripts/navegador/red-webrtc.js')
const { Runa, TICK_MS } = require('../lib/game.js')

/**
 * Trystero in memory: rooms by appId and roomId, one action per name, and
 * synchronous delivery. A message for a peer whose action is not set up yet is
 * lost, as on a channel that just opened; the presence beat repeats it.
 */
function fakeTrystero() {
  const rooms = new Map()
  let next = 0
  const joinRoom = (config, roomId) => {
    const key = config.appId + '/' + roomId
    const members = rooms.get(key) || new Set()
    rooms.set(key, members)
    const selfId = 'peer-' + ++next
    let onPeerJoin = null
    const room = {
      selfId,
      peers: new Map(),
      actions: {},
      left: false,
      onPeerLeave: null,
      makeAction(name) {
        const action = {
          onMessage: null,
          send(data, { target } = {}) {
            const other = room.peers.get(target)
            const handler = other && !other.left && other.actions[name]
            if (handler && handler.onMessage) handler.onMessage(data, { peerId: selfId })
            return Promise.resolve()
          }
        }
        room.actions[name] = action
        return action
      },
      leave() {
        room.left = true
        members.delete(room)
        for (const other of members) {
          other.peers.delete(selfId)
          if (other.onPeerLeave) other.onPeerLeave(selfId)
        }
        return Promise.resolve()
      }
    }
    // Como Trystero: asignar onPeerJoin avisa enseguida a los que ya estan.
    Object.defineProperty(room, 'onPeerJoin', {
      get: () => onPeerJoin,
      set(listener) {
        onPeerJoin = listener
        if (listener) for (const id of room.peers.keys()) listener(id)
      }
    })
    for (const other of members) {
      room.peers.set(other.selfId, other)
      other.peers.set(selfId, room)
      if (other.onPeerJoin) other.onPeerJoin(selfId)
    }
    members.add(room)
    return room
  }
  return { joinRoom, rooms }
}

function presence(net, name, room = 'TEST') {
  return new red.Presence({ name, room, joinRoom: net.joinRoom })
}

test('dos paginas en la misma sala se ven y se mandan duelos dirigidos', (t) => {
  const net = fakeTrystero()
  const ana = presence(net, 'Ana')
  const beto = presence(net, 'Beto')
  t.teardown(() => {
    ana.stop()
    beto.stop()
  })
  t.ok(ana.start())
  t.ok(beto.start())
  ana.beat()
  beto.beat()
  t.alike(
    ana.others().map((peer) => peer.name),
    ['Beto']
  )
  t.alike(
    beto.others().map((peer) => peer.name),
    ['Ana']
  )
  t.is(ana.topicName, 'runa:arena:TEST', 'la sala es el topic de la presencia')

  const received = []
  beto.on('duel', (message) => received.push(message))
  t.ok(ana.sendDuel('challenge', beto.id, { duelId: 'd1', stats: { hp: 999 } }))
  t.is(received.length, 1)
  t.is(received[0].from, ana.id, 'llega con el id de presencia, no el de Trystero')
  t.is(received[0].stats.hp, 20, 'saneado por net.js como en la terminal')
})

test('un codigo distinto es otra sala', (t) => {
  const net = fakeTrystero()
  const ana = presence(net, 'Ana', 'uno')
  const beto = presence(net, 'Beto', 'dos!')
  t.teardown(() => {
    ana.stop()
    beto.stop()
  })
  ana.start()
  beto.start()
  ana.beat()
  beto.beat()
  t.is(ana.others().length, 0)
  t.is(ana.room, 'UNO')
  t.is(beto.room, 'DOS', 'el codigo queda en mayusculas, letras y numeros')
  t.is(presence(net, 'Cele', '').room, 'RUNA1', 'sin codigo, la primera sala publica')
})

test('quien deja la sala se avisa enseguida y una sola vez', (t) => {
  const net = fakeTrystero()
  const ana = presence(net, 'Ana')
  const beto = presence(net, 'Beto')
  t.teardown(() => ana.stop())
  ana.start()
  beto.start()
  ana.beat()
  beto.beat()
  const gone = []
  ana.on('peer-leave', (peer) => gone.push(peer.name))
  beto.stop()
  t.alike(gone, ['Beto'], 'sin esperar el silencio')
  t.is(ana.others().length, 0)
  t.is(ana.conns.size, 0)
  ana.reap()
  t.alike(gone, ['Beto'], 'el barrido no lo cuenta otra vez')
})

/** Ana desafia a Beto en la misma sala y los dos entran al Coliseo. */
function duelOverWebRtc(t) {
  const net = fakeTrystero()
  const ana = new Runa({ presence: false, name: 'Ana' })
  const beto = new Runa({ presence: false, name: 'Beto' })
  ana.title = false
  beto.title = false
  const pa = presence(net, 'Ana')
  const pb = presence(net, 'Beto')
  ana.attachPresence(pa)
  beto.attachPresence(pb)
  t.teardown(() => {
    ana.stopPresence()
    beto.stopPresence()
  })
  ana.startPresence()
  beto.startPresence()
  pa.beat()
  pb.beat()
  const home = { mapId: beto.walker.mapId, x: beto.walker.x, y: beto.walker.y }

  t.ok(ana.challengePlayer(ana.nearbyPlayer()), 'Ana desafia a Beto con E')
  beto.onTick()
  t.is(beto.duelInvite && beto.duelInvite.direction, 'in')
  t.ok(beto.answerDuel(true))
  ana.onTick()
  t.ok(ana.duel && ana.duel.active && beto.duel && beto.duel.active, 'los dos en el Coliseo')
  t.is(ana.walker.mapId, 'coliseum')
  return { ana, beto, home }
}

test('un duelo por WebRTC: el que cierra la pagina lo pierde y el otro vuelve ganador', (t) => {
  const { ana, beto, home } = duelOverWebRtc(t)

  // Ana cierra la pagina en pleno duelo.
  ana.stopPresence()
  beto.onTick()
  t.absent(beto.duel, 'Beto sale del Coliseo')
  t.alike({ mapId: beto.walker.mapId, x: beto.walker.x, y: beto.walker.y }, home)
  t.alike(beto.player.snapshot().pvp, { wins: 1, losses: 0 }, 'el que se queda gana')
  t.alike(ana.player.snapshot().pvp, { wins: 0, losses: 1 }, 'el que se va pierde')
})

test('una pagina congelada unos segundos sigue en la sala', (t) => {
  const net = fakeTrystero()
  const ana = presence(net, 'Ana')
  const beto = presence(net, 'Beto')
  t.teardown(() => {
    ana.stop()
    beto.stop()
  })
  ana.start()
  beto.start()
  ana.beat()
  beto.beat()
  t.is(ana.goneMs, red.WEB_GONE_MS)
  const gone = []
  ana.on('peer-leave', (peer) => gone.push(peer.name))
  const peer = ana.peers.get(beto.id)
  peer.seen -= 5000
  ana.reap()
  t.alike(gone, [], 'cinco segundos sin latir no alcanzan, como al armar el Coliseo')
  peer.seen -= red.WEB_GONE_MS
  ana.reap()
  t.alike(gone, ['Beto'], 'el silencio largo si')
})

test('en un duelo por WebRTC el invitado espera al host tanto como la sala', (t) => {
  const { ana, beto } = duelOverWebRtc(t)
  const guest = ana.duelNetwork.hostId === ana.presence.id ? beto : ana
  const ticks = Math.round(red.WEB_GONE_MS / TICK_MS)
  t.is(guest.duelSilenceTicks(), ticks)
  // El host deja de ordenar pasos: su pagina quedo congelada. Si el invitado es
  // Ana, ya conto un tick de silencio al entrar.
  for (let i = guest.duelNetwork.quiet; i < ticks; i++) guest.onTick()
  t.ok(guest.duel && guest.duel.active, 'diez segundos de margen')
  guest.onTick()
  t.absent(guest.duel, 'despues sale del Coliseo')
  t.alike(guest.player.snapshot().pvp, { wins: 0, losses: 0 }, 'sin ganador')
})

test('las salas publicas se numeran y se reconocen', (t) => {
  t.is(red.publicCode(1), 'RUNA1')
  t.is(red.publicCode(12), 'RUNA12')
  t.is(red.shardOf(red.publicCode(7)), 7, 'ida y vuelta')
  t.is(red.shardOf('runa-3'), 3, 'el guion no cuenta')
  t.is(red.shardOf('RUNA'), 0, 'RUNA sola no es una sala publica numerada')
  t.is(red.shardOf('RUNA0'), 0)
  t.is(red.shardOf('ABCD'), 0, 'un codigo privado')
  t.ok(red.reservedCode('public'))
  t.ok(red.reservedCode('RUNA'))
  t.ok(red.reservedCode('runa-2'))
  t.absent(red.reservedCode('AMIGOS'))
  t.is(red.DEFAULT_ROOM, 'RUNA1')
})

test('el veredicto de sala publica: solo se mudan los recien llegados que sobran', (t) => {
  const peers = (n, fresh = []) =>
    Array.from({ length: n }, (_, i) => ({ id: 'p' + i, fresh: fresh.includes(i) ? 1 : 0 }))
  t.is(red.shardVerdict({ selfId: 'z', fresh: true, others: peers(7) }), 'stay', '8 caben')
  t.is(
    red.shardVerdict({ selfId: 'z', fresh: false, others: peers(12) }),
    'stay',
    'un asentado no se va'
  )
  // 9 en total, 2 recien llegados: se va solo el de id mas alto.
  const nine = peers(7).concat({ id: 'q', fresh: 1 })
  t.is(red.shardVerdict({ selfId: 'r', fresh: true, others: nine }), 'leave')
  const nineLow = peers(7).concat({ id: 'r', fresh: 1 })
  t.is(red.shardVerdict({ selfId: 'q', fresh: true, others: nineLow }), 'stay')
  // 10 en total, 3 recien llegados: se van los dos mas altos.
  const base = peers(7)
  const verdict = (self, rest) =>
    red.shardVerdict({
      selfId: self,
      fresh: true,
      others: base.concat(rest.map((id) => ({ id, fresh: 1 })))
    })
  t.is(verdict('x', ['y', 'z']), 'stay')
  t.is(verdict('y', ['x', 'z']), 'leave')
  t.is(verdict('z', ['x', 'y']), 'leave')
})

test('fresh viaja en la linea y falta en las paginas viejas', (t) => {
  const net = fakeTrystero()
  const ana = new red.Presence({ name: 'Ana', room: 'X', fresh: true, joinRoom: net.joinRoom })
  const beto = presence(net, 'Beto', 'X')
  t.teardown(() => {
    ana.stop()
    beto.stop()
  })
  ana.start()
  beto.start()
  ana.beat()
  beto.beat()
  t.is(beto.others()[0].fresh, 1, 'Ana llega recien llegada')
  t.is(ana.others()[0].fresh, 0, 'Beto no lo pidio')
  ana.settle()
  ana.beat()
  t.is(beto.others()[0].fresh, 0, 'al asentarse deja de serlo')
  beto.receive(JSON.stringify({ id: 'viejo', name: 'Viejo' }))
  t.is(beto.others().find((peer) => peer.id === 'viejo').fresh, 0, 'sin el campo, asentado')
})

test('nueve recien llegados en RUNA1 terminan en 8 y 1', (t) => {
  const net = fakeTrystero()
  const all = []
  t.teardown(() => {
    for (const p of all) p.stop()
  })
  const join = (name, n) => {
    const p = new red.Presence({
      name,
      room: red.publicCode(n),
      fresh: true,
      joinRoom: net.joinRoom
    })
    p.start()
    return p
  }
  let current = []
  for (let i = 0; i < 9; i++) current.push(join('J' + i, 1))
  all.push(...current)
  for (const p of current) p.beat()
  const leavers = current.filter(
    (p) => red.shardVerdict({ selfId: p.id, fresh: true, others: p.others() }) === 'leave'
  )
  t.is(leavers.length, 1, 'se va uno solo')
  for (const p of leavers) p.stop()
  const moved = leavers.map((p) => join(p.name, 2))
  all.push(...moved)
  current = current.filter((p) => !leavers.includes(p))
  for (const p of current.concat(moved)) p.beat()
  t.is(current[0].others().length + 1, 8, 'RUNA1 queda con 8')
  t.is(moved[0].others().length + 1, 1, 'RUNA2 con 1')
  t.is(moved[0].room, 'RUNA2')
})
