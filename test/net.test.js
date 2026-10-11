const { test } = require('brittle')
const { Presence, normalizeDuelMessage } = require('../lib/net.js')
const { Runa } = require('../lib/game.js')

function fakeConn() {
  const handlers = {}
  return {
    destroyed: false,
    peer: null,
    // The next line of this kind is lost, like a connection that blinks mid-duel.
    dropKind: null,
    on(event, listener) {
      ;(handlers[event] ||= []).push(listener)
    },
    emit(event, value) {
      for (const listener of handlers[event] || []) listener(value)
    },
    write(value) {
      if (this.dropKind && value.includes('"kind":"' + this.dropKind + '"')) {
        this.dropKind = null
        return
      }
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

/** Two linked games and a pending challenge; the challenger hosts unless asked otherwise. */
function pair({ challengerHosts = true } = {}) {
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
  const [ca, cb] = connect(pa, pb)
  const anaHosts = pa.id < pb.id
  const challenger = anaHosts === challengerHosts ? ana : beto
  const accepter = challenger === ana ? beto : ana
  const peer = challenger.others('city').find((p) => p.id !== challenger.presence.id)
  challenger.challengePlayer(peer)
  accepter.onTick()
  const conn = (game) => (game === ana ? ca : cb)
  const presence = (game) => (game === ana ? pa : pb)
  const home = (game) => ({ mapId: game.walker.mapId, x: game.walker.x, y: game.walker.y })
  return { ana, beto, pa, pb, challenger, accepter, conn, presence, home: [home(ana), home(beto)] }
}

/** Accept the pending challenge and return who orders the steps. */
function fight(s) {
  s.accepter.answerDuel(true)
  s.challenger.onTick()
  const host =
    s.challenger.duelNetwork.hostId === s.challenger.presence.id ? s.challenger : s.accepter
  return { host, guest: host === s.challenger ? s.accepter : s.challenger }
}

/** The peer `game` stops hearing from `other`, as if it went quiet for good. */
function silence(s, game, other) {
  const presence = s.presence(game)
  presence.peers.get(s.presence(other).id).seen = 0
  presence.reap()
}

function sentHome(t, s) {
  for (const [game, home] of [
    [s.ana, s.home[0]],
    [s.beto, s.home[1]]
  ]) {
    t.absent(game.duel, game.name + ' no queda en el Coliseo')
    t.alike({ mapId: game.walker.mapId, x: game.walker.x, y: game.walker.y }, home)
  }
}

for (const leaving of ['host', 'guest']) {
  test(`quien deja la sala en pleno duelo lo pierde y el que se queda lo gana (${leaving})`, (t) => {
    const s = pair()
    const { host, guest } = fight(s)
    host.onTick()
    guest.onTick()
    const leaver = leaving === 'host' ? host : guest
    const stayer = leaver === host ? guest : host
    leaver.stopPresence()
    stayer.onTick()
    // The silence that follows the departure must not score it a second time.
    silence(s, stayer, leaver)
    stayer.onTick()
    sentHome(t, s)
    t.alike(stayer.player.snapshot().pvp, { wins: 1, losses: 0 }, 'el que se queda gana')
    t.alike(leaver.player.snapshot().pvp, { wins: 0, losses: 1 }, 'el que se va pierde')
    t.is(stayer.lastDuelResult.winner, s.presence(stayer).id)
    t.alike(stayer.lastDuelResult.winner, leaver.lastDuelResult.winner, 'un solo ganador')
    t.is(stayer.wallet.pending.winner, leaver.wallet.pending.winner)
  })
}

test('si el rival se calla sin despedirse, nadie se anota la victoria', (t) => {
  const s = pair()
  fight(s)
  // Beto's game dies: no goodbye, only silence.
  silence(s, s.ana, s.beto)
  s.ana.onTick()
  t.absent(s.ana.duel, 'Ana sale del Coliseo')
  t.alike({ mapId: s.ana.walker.mapId, x: s.ana.walker.x, y: s.ana.walker.y }, s.home[0])
  t.alike(s.ana.player.snapshot().pvp, { wins: 0, losses: 0 }, 'el silencio no da la victoria')
  t.absent(s.ana.wallet.pending, 'no queda un resultado para publicar')
  const { withLanguage, t: tr } = require('../lib/locale.js')
  const line = s.ana.log.find((entry) => entry.includes('se desconecto'))
  t.ok(line && line.endsWith('Beto se desconecto: duelo sin resultado'))
  t.ok(withLanguage('en', () => tr(line)).endsWith('disconnected: the duel has no winner'))
})

test('si los dos dejan de oirse, ninguno se anota la victoria', (t) => {
  const s = pair()
  fight(s)
  silence(s, s.ana, s.beto)
  silence(s, s.beto, s.ana)
  s.ana.onTick()
  s.beto.onTick()
  sentHome(t, s)
  t.alike(s.ana.player.snapshot().pvp, { wins: 0, losses: 0 })
  t.alike(s.beto.player.snapshot().pvp, { wins: 0, losses: 0 })
})

test('un invitado con mas de veinte pasos en cola sigue sincronizado', (t) => {
  const s = pair()
  const { host, guest } = fight(s)
  for (let i = 0; i < 40; i++) host.onTick()
  guest.onTick()
  t.ok(guest.duel && guest.duel.active)
  t.is(guest.duelNetwork.expectedOrder, host.duelNetwork.nextOrder + 1, 'no se perdio ningun paso')
  t.is(guest.duelCombat.tickCount, host.duelCombat.tickCount)
  host.sendDuelInput({ surrender: true })
  guest.onTick()
  t.absent(guest.duel, 'el invitado sale con el host')
  t.is(guest.lastDuelResult && guest.lastDuelResult.winner, guest.presence.id)
})

test('un paso perdido anula el duelo en los dos lados', (t) => {
  const s = pair()
  const { host, guest } = fight(s)
  s.conn(host).dropKind = 'step'
  host.onTick()
  host.onTick()
  guest.onTick()
  host.onTick()
  sentHome(t, s)
  t.alike(s.ana.player.snapshot().pvp, { wins: 0, losses: 0 })
  t.alike(s.beto.player.snapshot().pvp, { wins: 0, losses: 0 })
})

test('si el retador entra a una tienda antes del accept, el invitado vuelve', (t) => {
  const s = pair()
  s.challenger.shop = 'potions'
  s.accepter.answerDuel(true)
  t.ok(s.accepter.duel && s.accepter.duel.active, 'el que acepta ya entro')
  s.challenger.onTick()
  s.accepter.onTick()
  t.absent(s.challenger.duel)
  t.absent(s.accepter.duel, 'el invitado no queda encerrado')
  t.is(s.accepter.walker.mapId, 'city')
  t.alike(s.accepter.player.snapshot().pvp, { wins: 0, losses: 0 })
})

test('si el retador es invitado y entra a una tienda, el host tampoco queda solo', (t) => {
  const s = pair({ challengerHosts: false })
  s.challenger.shop = 'potions'
  s.accepter.answerDuel(true)
  s.accepter.onTick()
  s.challenger.onTick()
  s.accepter.onTick()
  t.absent(s.accepter.duel)
  t.alike(
    s.accepter.player.snapshot().pvp,
    { wins: 0, losses: 0 },
    'no gana contra un muneco quieto'
  )
})

test('cancelar mientras viaja el accept libera al que acepto', (t) => {
  const s = pair()
  s.accepter.answerDuel(true)
  s.challenger.onKey({ type: 'key', is: (...keys) => keys.includes('n') })
  s.challenger.onTick()
  s.accepter.onTick()
  sentHome(t, s)
})

test('el veredicto del host cierra a un invitado que perdio el paso final', (t) => {
  const s = pair()
  const { host, guest } = fight(s)
  s.conn(host).dropKind = 'step'
  host.sendDuelInput({ surrender: true })
  guest.onTick()
  t.absent(guest.duel)
  t.alike(guest.lastDuelResult, host.lastDuelResult, 'los dos guardan el mismo ganador')
  t.alike(guest.player.snapshot().pvp, { wins: 1, losses: 0 })
  t.alike(host.player.snapshot().pvp, { wins: 0, losses: 1 })
})

test('un invitado no puede declararse ganador', (t) => {
  const s = pair()
  const { host, guest } = fight(s)
  guest.presence.sendDuel('result', host.presence.id, {
    duelId: guest.duelNetwork.duelId,
    winner: guest.presence.id,
    loser: host.presence.id,
    reason: 'vida'
  })
  host.onTick()
  t.ok(host.duel && host.duel.active, 'el host sigue peleando')
  t.alike(host.player.snapshot().pvp, { wins: 0, losses: 0 })
})

test('el invitado sale solo si el host deja de ordenar pasos', (t) => {
  const s = pair()
  const { host, guest } = fight(s)
  for (let i = 0; i < 45; i++) guest.onTick()
  t.ok(guest.duel && guest.duel.active, 'tres segundos de margen')
  guest.onTick()
  t.absent(guest.duel)
  host.onTick()
  sentHome(t, s)
})

test('sin presencia, un desafio encolado no rompe el tick', (t) => {
  const s = pair()
  s.accepter.shop = 'potions'
  s.accepter.duelMessages.push({ kind: 'challenge', from: 'x', duelId: 'y', fromName: 'z' })
  s.accepter.dropPresence()
  t.execution(() => s.accepter.onTick())
})
