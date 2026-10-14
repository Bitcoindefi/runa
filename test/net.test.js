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

// --- Lote 2: endurecer la red y publicar la posicion real --------------------

const net = require('../lib/net.js')
const { Field } = require('../lib/field.js')
const { awayMapId, CHALLENGE_COOLDOWN_MS } = require('../lib/game.js')

/** Un reloj que solo avanza cuando la prueba lo pide. */
function clock(start = 1000000) {
  const c = { at: start, now: () => c.at }
  return c
}

/** Una conexion que anota cada linea escrita y no la entrega a nadie. */
function spyConn(peerId = null) {
  const conn = fakeConn()
  conn.peerId = peerId
  conn.lines = []
  conn.write = (value) => conn.lines.push(String(value))
  return conn
}

test('una linea de estado con el id de otro peer se ignora', (t) => {
  const ana = new Presence({ name: 'ana', offline: true })
  const beto = new Presence({ name: 'beto', offline: true })
  const [, betoConn] = connect(ana, beto)
  t.is(betoConn.peerId, ana.id, 'la primera linea ata la conexion a ana')

  ana.update('city', 5, 5)
  ana.beat()
  const spoof = { ...ana.self, id: 'intruso', name: 'intruso', x: 1, y: 1 }
  beto.receive(JSON.stringify(spoof), betoConn)
  t.absent(beto.peers.has('intruso'), 'ana no puede inventar un tercer peer')

  // Un tercero que se hace pasar por ana desde su propia conexion.
  const evil = fakeConn()
  evil.peerId = null
  beto.onConnection(evil)
  beto.receive(JSON.stringify({ ...ana.self, x: 99, y: 99 }), evil)
  t.is(beto.peers.get(ana.id).x, 5, 'la posicion de ana no se mueve desde otra conexion')
  t.is(evil.peerId, null, 'la conexion impostora no queda atada a ana')
})

test('cada conexion tiene un cupo de 30 lineas de estado por segundo', (t) => {
  const c = clock()
  const beto = new Presence({ name: 'beto', offline: true, now: c.now })
  const conn = fakeConn()
  beto.onConnection(conn)
  const line = (x) => JSON.stringify({ id: 'ana1', name: 'ana', mapId: 'city', x, y: 0 })
  for (let i = 0; i < 40; i++) beto.receive(line(i), conn)
  t.is(net.RATE_LINES, 30)
  t.is(beto.peers.get('ana1').x, 29, 'las diez de mas se tiran sin leerlas')

  // Las lineas de duelo tienen su propio cupo: una inundacion de estado no
  // corta un duelo en curso.
  const duels = []
  beto.on('duel', (message) => duels.push(message))
  const duel = {
    type: 'duel',
    kind: 'challenge',
    messageId: 'm1',
    from: 'ana1',
    fromName: 'ana',
    to: beto.id,
    duelId: 'd1'
  }
  beto.receive(JSON.stringify(duel), conn)
  t.is(duels.length, 1, 'el duelo pasa aunque el estado este agotado')

  c.at += net.RATE_WINDOW_MS
  beto.receive(line(77), conn)
  t.is(beto.peers.get('ana1').x, 77, 'al segundo siguiente vuelve a escuchar')
})

test('el cupo de duelo cubre de una vez todo el silencio tolerado', (t) => {
  const c = clock()
  const beto = new Presence({ name: 'beto', offline: true, now: c.now, goneMs: 10000 })
  const conn = fakeConn()
  beto.onConnection(conn)
  const burst = net.duelBurst(10000)
  t.is(burst, net.RATE_DUEL_LINES * 11, 'diez segundos de silencio y uno de margen')
  let admitted = 0
  for (let i = 0; i < burst + 50; i++) if (beto.admit(conn, true)) admitted++
  t.is(admitted, burst, 'la rafaga entera entra y lo que sobra se tira')
  t.absent(beto.admit(conn, true), 'agotado, no entra nada mas')
  c.at += net.RATE_WINDOW_MS / 2
  admitted = 0
  for (let i = 0; i < net.RATE_DUEL_LINES; i++) if (beto.admit(conn, true)) admitted++
  t.is(admitted, net.RATE_DUEL_LINES / 2, 'se recarga al ritmo sostenido')
  c.at -= 5000
  t.absent(beto.admit(conn, true), 'un reloj que vuelve atras no recarga')
})

test('un invitado congelado casi diez segundos recibe todos los pasos y sigue en el duelo', (t) => {
  const c = clock()
  const opts = { offline: true, now: c.now, goneMs: 10000 }
  const ana = new Runa({ presence: false, name: 'Ana', now: c.now })
  const beto = new Runa({ presence: false, name: 'Beto', now: c.now })
  ana.title = false
  beto.title = false
  const pa = new Presence({ name: 'Ana', ...opts })
  const pb = new Presence({ name: 'Beto', ...opts })
  ana.attachPresence(pa)
  beto.attachPresence(pb)
  ana.presenceStarted = true
  beto.presenceStarted = true
  pa.update('city', ana.walker.x, ana.walker.y)
  pb.update('city', beto.walker.x + 1, beto.walker.y)
  connect(pa, pb)
  const challenger = pa.id < pb.id ? ana : beto
  const accepter = challenger === ana ? beto : ana
  challenger.challengePlayer(challenger.others('city').find((p) => p.id !== challenger.presence.id))
  accepter.onTick()
  accepter.answerDuel(true)
  challenger.onTick()
  const host = challenger
  const guest = accepter
  t.is(host.duelNetwork.hostId, host.presence.id)

  // El invitado no corre ni un tick: todo lo que ordena el host llega junto,
  // en el mismo instante del reloj, como al despertar una pagina congelada.
  const ticks = guest.duelSilenceTicks() - 5
  for (let i = 0; i < ticks; i++) {
    if (i % 5 === 0) host.sendDuelInput({ dx: 0, dy: i % 10 === 0 ? 1 : -1 })
    host.onTick()
  }
  t.ok(ticks + ticks / 5 > 150, 'mas de 150 pasos ordenados en una rafaga')
  guest.onTick()
  t.ok(guest.duel && guest.duel.active, 'el duelo sigue')
  t.is(guest.duelNetwork.expectedOrder, host.duelNetwork.nextOrder + 1, 'no se perdio ningun paso')
  t.is(guest.duelCombat.tickCount, host.duelCombat.tickCount)
})

test('un duelo sale solo por la conexion de su destinatario', (t) => {
  const ana = new Presence({ name: 'ana', offline: true })
  const toBeto = spyConn('beto1')
  const toCele = spyConn('cele1')
  ana.conns.add(toBeto)
  ana.conns.add(toCele)
  t.ok(ana.sendDuel('challenge', 'beto1', { duelId: 'd1' }))
  t.is(toBeto.lines.length, 1, 'beto recibe su desafio')
  t.is(toCele.lines.length, 0, 'cele no ve un duelo ajeno')

  t.ok(ana.sendDuel('challenge', 'nadie', { duelId: 'd2' }))
  t.is(toBeto.lines.length, 2, 'un destinatario sin conexion conocida sale por todas')
  t.is(toCele.lines.length, 1)
})

test('others expone mapa, region y posicion de cada peer', (t) => {
  t.is(net.regionOf('city'), 'town')
  t.is(net.regionOf('coliseum'), 'town')
  t.is(net.regionOf('field'), 'field')
  t.is(net.regionOf('crypt2'), 'crypt')
  t.is(net.regionOf('camp-colmillo-rojo'), 'camp')
  t.is(net.regionOf('boss'), 'boss')

  const ana = new Presence({ name: 'ana', offline: true })
  const beto = new Presence({ name: 'beto', offline: true })
  ana.update('camp-colmillo-rojo', 12, 34)
  connect(ana, beto)
  const seen = beto.others().find((peer) => peer.id === ana.id)
  t.is(seen.mapId, 'camp-colmillo-rojo', 'un id de asentamiento largo no se corta')
  t.is(seen.region, 'camp')
  t.is(seen.x, 12)
  t.is(seen.y, 34)
})

/** Dos partidas enlazadas en la ciudad, una al lado de la otra, con un reloj comun. */
function linkedGames() {
  const c = clock()
  const ana = new Runa({ presence: false, name: 'Ana', now: c.now })
  const beto = new Runa({ presence: false, name: 'Beto', now: c.now })
  ana.title = false
  beto.title = false
  const pa = new Presence({ name: 'Ana', offline: true, now: c.now })
  const pb = new Presence({ name: 'Beto', offline: true, now: c.now })
  ana.attachPresence(pa)
  beto.attachPresence(pb)
  ana.presenceStarted = true
  beto.presenceStarted = true
  ana.announce()
  pb.update('city', ana.walker.x + 1, ana.walker.y)
  connect(pa, pb)
  return { c, ana, beto, pa, pb }
}

test('el campo anuncia la region y las coordenadas del campo, a 4 Hz', (t) => {
  const { c, ana, beto, pa, pb } = linkedGames()
  beto.field = new Field({ player: beto.player, seed: 27 })
  beto.field.player.x = 42
  beto.field.player.y = 17
  beto.stepField()
  t.is(pb.self.mapId, 'field')
  t.is(pb.self.x, beto.field.player.x, 'la x es la del campo, no la de la ciudad')
  t.is(pb.self.y, beto.field.player.y)

  const x = beto.field.player.x
  beto.field.player.x = x + 3
  c.at += 100
  beto.stepField()
  t.is(pb.self.x, x, 'dentro de 250 ms no se vuelve a anunciar')
  c.at += 150
  beto.stepField()
  t.is(pb.self.x, beto.field.player.x, 'a los 250 ms sale la posicion nueva')

  pb.beat()
  const seen = ana.others().find((peer) => peer.id === pb.id)
  t.is(seen.region, 'field')
  t.is(seen.mapId, 'field')
  t.is(seen.x, beto.field.player.x)
  t.is(pa.others('city').length, 0, 'en la ciudad ya no se lo dibuja')
})

test('cada zona fuera de la ciudad tiene su mapa anunciado', (t) => {
  t.is(awayMapId({ mode: 'field' }), 'field')
  t.is(awayMapId({ mode: 'dungeon', floor: 2 }), 'crypt2')
  t.is(awayMapId({ mode: 'barbarian-camp', camp: { id: 'hachas-negras' } }), 'camp-hachas-negras')
  t.is(awayMapId({ mode: 'boss' }), 'boss', 'el jefe ya no se anuncia como field')
})

test('a un peer en el campo no se lo puede desafiar desde la ciudad', (t) => {
  const { ana, beto, pb } = linkedGames()
  t.ok(ana.nearbyPlayer(), 'en la ciudad, al lado, si se puede')
  beto.field = new Field({ player: beto.player, seed: 27 })
  // Parado en el campo justo sobre las coordenadas de ana en la ciudad.
  beto.field.player.x = ana.walker.x
  beto.field.player.y = ana.walker.y
  beto.announce()
  pb.beat()
  t.absent(ana.nearbyPlayer(), 'el del campo no esta cerca')
  t.absent(ana.challengePlayer(), 'y no hay a quien desafiar')
  t.absent(beto.duelInvite)
})

test('volver a desafiar al mismo peer espera 20 segundos', (t) => {
  const { c, ana, beto } = linkedGames()
  const peer = () => ana.others('city')[0]
  t.ok(ana.challengePlayer(peer()))
  beto.onTick()
  beto.answerDuel(false)
  ana.onTick()
  t.absent(ana.duelInvite, 'el rechazo libera al retador')

  c.at += CHALLENGE_COOLDOWN_MS - 1000
  t.absent(ana.challengePlayer(peer()), 'antes de los 20 s no sale')
  t.ok(ana.log.some((line) => String(line).includes('para volver a desafiar')))
  c.at += 1000
  t.ok(ana.challengePlayer(peer()), 'a los 20 s ya se puede')
})

test('mas de tres desafios por minuto del mismo peer se rechazan solos', (t) => {
  const { c, ana, pa, pb } = linkedGames()
  const declines = []
  pb.on('duel', (message) => message.kind === 'decline' && declines.push(message.reason))
  for (let i = 1; i <= 4; i++) {
    pb.sendDuel('challenge', pa.id, { duelId: 'spam-' + i, stats: {} })
    ana.onTick()
    if (ana.duelInvite) ana.answerDuel(false)
  }
  t.alike(declines, ['rechazado', 'rechazado', 'rechazado', 'demasiados desafios'])
  t.absent(ana.duelInvite, 'el cuarto no abre cartel')

  c.at += 60000
  pb.sendDuel('challenge', pa.id, { duelId: 'spam-5', stats: {} })
  ana.onTick()
  t.ok(ana.duelInvite, 'pasado el minuto vuelve a llegar')
})

test('pose: una linea vieja sin pose se sigue leyendo y la pose es opcional', (t) => {
  const ana = new Presence({ name: 'ana', offline: true })
  // Una linea como las de antes: sin t, s, px, pz, yaw ni g.
  ana.receive(JSON.stringify({ id: 'viejo1', name: 'viejo', mapId: 'city', x: 4, y: 5 }))
  const old = ana.others().find((peer) => peer.id === 'viejo1')
  t.is(old.x, 4)
  t.is(old.y, 5)
  t.alike(old.pose, {}, 'sin pose, un objeto vacio')

  // Pose a medias y basura: solo pasa lo que esta bien, acotado.
  ana.receive(
    JSON.stringify({
      id: 'nuevo1',
      name: 'nuevo',
      mapId: 'field',
      x: 1,
      y: 2,
      t: 12345.9,
      s: -4,
      px: 1e9,
      pz: 3.14159,
      yaw: Math.PI * 3,
      g: 7
    })
  )
  const pose = ana.others().find((peer) => peer.id === 'nuevo1').pose
  t.is(pose.t, 12345)
  t.is(pose.s, 0, 'un numero de linea negativo queda en cero')
  t.is(pose.px, 9999, 'la posicion queda acotada')
  t.is(pose.pz, 3.14, 'con dos decimales')
  t.ok(Math.abs(Math.abs(pose.yaw) - Math.PI) < 0.01, 'tres vueltas y media es media vuelta')
  t.is(pose.g, 2, 'el paso va de 0 a 2')

  ana.receive(
    JSON.stringify({ id: 'raro1', name: 'raro', x: 0, y: 0, px: 'x', pz: 2, yaw: null, g: '1' })
  )
  t.alike(
    ana.others().find((peer) => peer.id === 'raro1').pose,
    {},
    'una posicion sin las dos partes o un texto no pasan'
  )
  t.alike(net.cleanPose(null), {})
})

test('pose: viaja limpia y con su reloj y su numero de linea', (t) => {
  const c = clock()
  const ana = new Presence({ name: 'ana', offline: true, now: c.now })
  const beto = new Presence({ name: 'beto', offline: true, now: c.now })
  ana.update('field', 10, 20)
  ana.pose({ px: 12.345, pz: -7.5, yaw: 1.2345, g: 1, t: 99, s: 99 })
  t.absent('t' in ana.self && ana.self.t === 99, 'el reloj no lo pone la pagina')
  connect(ana, beto)
  const first = beto.others()[0].pose
  t.is(first.px, 12.35)
  t.is(first.pz, -7.5)
  t.is(first.yaw, 1.235)
  t.is(first.g, 1)
  t.is(first.t, c.at % 0x7fffffff)
  c.at += 100
  ana.beat()
  const second = beto.others()[0].pose
  t.ok(second.s > first.s, 'cada linea lleva un numero mayor')
  t.is(second.t - first.t, 100)

  ana.pose(null)
  ana.beat()
  const cleared = beto.others()[0].pose
  t.absent('px' in cleared, 'sin pose, el otro vuelve a la celda')
  t.ok(Number.isFinite(cleared.s), 'el numero de linea sigue')
})

test('pose: late 10 veces por segundo caminando y 2 quieto', (t) => {
  const c = clock()
  const ana = new Presence({ name: 'ana', offline: true, now: c.now })
  const beto = new Presence({ name: 'beto', offline: true, now: c.now })
  connect(ana, beto)
  let lines = 0
  const count = (from, ms) => {
    lines = 0
    const end = c.at + ms
    while (c.at < end) {
      c.at += net.PULSE_MS
      if (from()) lines++
    }
    return lines
  }
  // Quieto: dos por segundo.
  t.is(
    count(() => ana.pulse(), 2000),
    4
  )
  // Caminando: una pose nueva cada pulso, diez por segundo.
  let x = 0
  t.is(
    count(() => {
      x += 0.7
      ana.pose({ px: x, pz: 0, yaw: 0, g: 2 })
      return ana.pulse()
    }, 1000),
    10
  )
  // Parado otra vez (g = 0): sale la ultima posicion y despues dos por segundo.
  ana.pose({ px: x, pz: 0, yaw: 0, g: 0 })
  t.is(
    count(() => ana.pulse(), 1000),
    2
  )
  // Una terminal que camina por celdas tambien late rapido.
  let y = 0
  t.is(
    count(() => {
      ana.update('city', 3, ++y)
      return ana.pulse()
    }, 500),
    5
  )
  t.ok(net.RATE_LINES >= 1000 / net.POSE_FAST_MS, 'caminar entra en el cupo de lineas')
})

test('pose: si la pagina deja de dibujar, el paso vuelve a quieto', (t) => {
  const c = clock()
  const ana = new Presence({ name: 'ana', offline: true, now: c.now })
  const beto = new Presence({ name: 'beto', offline: true, now: c.now })
  connect(ana, beto)
  const run = (ms) => {
    let lines = 0
    const end = c.at + ms
    while (c.at < end) {
      c.at += net.PULSE_MS
      if (ana.pulse()) lines++
    }
    return lines
  }
  c.at += net.POSE_IDLE_MS
  ana.pose({ px: 71.87, pz: 130.5, yaw: 0, g: 2 })
  t.ok(ana.pulse(), 'corriendo late')
  t.is(beto.others()[0].pose.g, 2)
  // Pestana oculta: nadie vuelve a llamar pose(). Pasado el margen, quieto.
  run(1000)
  t.is(run(3000), 3000 / net.POSE_IDLE_MS, 'late al ritmo de quieto, no a 10 por segundo')
  t.is(ana.self.g, 0, 'el paso viejo queda en cero')
  const wire = beto.others()[0].pose
  t.is(wire.g, 0, 'el otro lo ve quieto')
  t.is(wire.px, 71.87, 'en el mismo lugar')
  // Vuelve a dibujar: el paso nuevo vale otra vez.
  ana.pose({ px: 72, pz: 130.5, yaw: 0, g: 1 })
  c.at += net.PULSE_MS
  t.ok(ana.pulse())
  t.is(beto.others()[0].pose.g, 1)
  t.ok(net.POSE_STALE_MS < net.POSE_IDLE_MS)
})
