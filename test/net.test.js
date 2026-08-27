const { test } = require('brittle')
const { Presence, normalizeDuelMessage } = require('../lib/net.js')
const { Runa } = require('../lib/game.js')

function fakeConn() {
  const handlers = {}
  return {
    destroyed: false,
    peer: null,
    on(event, listener) {
      ;(handlers[event] ||= []).push(listener)
    },
    emit(event, value) {
      for (const listener of handlers[event] || []) listener(value)
    },
    write(value) {
      if (this.peer && !this.peer.destroyed) this.peer.emit('data', value)
    },
    destroy() {
      this.destroyed = true
      this.emit('close')
    }
  }
}

function connect(a, b) {
  const ca = fakeConn()
  const cb = fakeConn()
  ca.peer = cb
  cb.peer = ca
  b.onConnection(cb)
  a.onConnection(ca)
  a.beat()
  b.beat()
  return [ca, cb]
}

test('los mensajes de duelo son dirigidos, saneados y no se repiten', (t) => {
  const ana = new Presence({ name: 'ana', offline: true })
  const beto = new Presence({ name: 'beto', offline: true })
  const [, betoConn] = connect(ana, beto)

  const received = []
  beto.on('duel', (message) => received.push(message))
  t.ok(
    ana.sendDuel('challenge', beto.id, {
      duelId: 'duelo-1',
      stats: { hp: 999999, maxHp: 20, atk: -5, items: ['sword', '\u001b[2J', 'extra'] }
    })
  )
  t.is(received.length, 1)
  t.is(received[0].stats.hp, 20, 'la vida queda limitada por su maximo')
  t.is(received[0].stats.atk, 0, 'un ataque negativo no cruza la frontera')
  t.alike(received[0].stats.items, ['sword', '[2J'], 'los controles se eliminan')

  const replay = JSON.stringify(received[0])
  beto.receive(replay)
  t.is(received.length, 1, 'el mismo messageId se procesa una sola vez')

  const forSomeoneElse = normalizeDuelMessage({
    ...received[0],
    messageId: 'otro',
    to: 'tercero'
  })
  beto.receive(JSON.stringify(forSomeoneElse))
  t.is(received.length, 1, 'un paquete dirigido a otro jugador se ignora')

  const forged = { ...received[0], messageId: 'forjado', from: 'intruso' }
  beto.receive(JSON.stringify(forged), betoConn)
  t.is(received.length, 1, 'una conexion no puede fingir la identidad de otro peer')
})

test('la presencia comparte solo estadisticas publicas del ranking', (t) => {
  const ana = new Presence({ name: 'ana', offline: true })
  const beto = new Presence({ name: 'beto', offline: true })
  ana.update('city', 10, 20, { level: 7, wins: 12, losses: 3 })
  connect(ana, beto)
  const profile = beto.others('city').find((peer) => peer.id === ana.id)
  t.is(profile.level, 7)
  t.is(profile.wins, 12)
  t.is(profile.losses, 3)
  t.absent(JSON.stringify(profile).includes('secret'), 'the ranking carries no wallet secrets')
})

test('dos partidas negocian, sincronizan y cierran el mismo duelo', (t) => {
  const ana = new Runa({ presence: false, name: 'Ana' })
  const beto = new Runa({ presence: false, name: 'Beto' })
  ana.title = false
  beto.title = false

  const pa = new Presence({ name: 'Ana', offline: true })
  const pb = new Presence({ name: 'Beto', offline: true })
  ana.attachPresence(pa)
  beto.attachPresence(pb)
  ana.presenceStarted = true
  beto.presenceStarted = true
  pa.update('city', ana.walker.x, ana.walker.y)
  pb.update('city', beto.walker.x + 1, beto.walker.y)
  connect(pa, pb)

  const peer = ana.others('city').find((candidate) => candidate.id === pb.id)
  t.ok(peer, 'Ana ve la identidad P2P de Beto')
  t.ok(ana.challengePlayer(peer))
  beto.onTick()
  t.is(beto.duelInvite.direction, 'in', 'el desafio llega a la otra partida')
  t.ok(beto.answerDuel(true))
  ana.onTick()

  t.ok(ana.duel && ana.duel.active)
  t.ok(beto.duel && beto.duel.active)
  t.not(ana.walker.x, beto.walker.x, 'cada uno ocupa su lado del Coliseo')

  const host = pa.id < pb.id ? ana : beto
  const guest = host === ana ? beto : ana
  const before = guest.duelCombat.fighter(guest.duel.self).x
  guest.sendDuelInput({ dx: guest.walker.x < 64 ? 1 : -1, dy: 0 })
  host.onTick()
  guest.onTick()
  t.not(guest.walker.x, before, 'el host ordena y devuelve el movimiento del invitado')

  guest.sendDuelInput({ surrender: true })
  host.onTick()
  guest.onTick()
  t.absent(host.duel, 'el host sale al resolver')
  t.absent(guest.duel, 'el invitado reproduce el mismo cierre')
  t.is(host.lastDuelResult.winner, guest.lastDuelResult.winner, 'los dos ven el mismo ganador')
  const anaWon = host.lastDuelResult.winner === pa.id
  t.alike(ana.player.snapshot().pvp, anaWon ? { wins: 1, losses: 0 } : { wins: 0, losses: 1 })
  t.alike(beto.player.snapshot().pvp, anaWon ? { wins: 0, losses: 1 } : { wins: 1, losses: 0 })
})
