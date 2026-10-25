// La vida de los NPC en la pagina 3D (tripo-heroe.html): como se ve cada uno,
// por donde camina alrededor de su celda y a cuales se anima en cada cuadro.
//
//  - Todos son el heroe de Tripo con esqueleto (heroe-anim.glb), con otro color de ropa y a la
//    medida de su oficio y su reino (lookOf): en NOX elfos, elfos oscuros y
//    druidas en violeta y plata; el rey en oro, mas alto y con corona. Llevan
//    un arma o un baculo cuando tiene sentido.
//  - El juego (lib/) deja a cada NPC en su celda: ahi se le habla. El paseo es
//    solo de la pagina y nunca se aleja mas de su radio (roam, como mucho
//    RADIUS): ida y vuelta entre su celda y 2 o 3 puntos caminables cercanos,
//    con pausas en Idle (wanderSpots, stepWander).
//  - Con el heroe a menos de ATTEND de su celda vuelve a ella; a menos de FACE
//    lo mira. Al hablarle se planta en su celda y asiente (greet).
//  - En el telefono se animan como mucho BUDGET.phone.rigs NPC, los mas
//    cercanos y a menos de BUDGET.phone.range metros; el resto queda quieto en
//    Idle (pickActive).
//
// Sin three.js ni el juego: .mjs para que las pruebas lo carguen en Bare.

// Lo mas lejos que se aleja un NPC de su celda, en metros (unas 3 celdas: una
// columna mide 0,5 m y una fila 1 m).
export const RADIUS = 2.5
// A menos de esto (m) del heroe vuelve a su celda; a menos de FACE lo mira.
export const ATTEND = 6
export const FACE = 4
// El paso de paseo y el de volver a la celda, en m/s.
export const STROLL = 0.55
export const BRISK = 1.25
// Lo que dura el gesto de hablar (s).
export const TALK = 1.6
// Cuantos NPC se animan por cuadro y hasta que distancia del heroe (m).
export const BUDGET = {
  phone: { rigs: 8, range: 25 },
  desktop: { rigs: 24, range: 40 }
}
// El paso de Walk del heroe de 2,1 m que no patina, en m/s (tripo-heroe.html
// GAITS.walk.pace), y lo mas que se acelera el clip.
export const WALK_PACE = 0.6
export const WALK_HEIGHT = 2.1
export const WALK_MOST = 2.2

const TURN = Math.PI * 2

// El angulo en [-PI, PI).
export function wrapAngle(a) {
  return ((((a + Math.PI) % TURN) + TURN) % TURN) - Math.PI
}

// Gira `from` hacia `to` por el camino corto, como mucho `step` radianes.
export function turnToward(from, to, step) {
  const delta = wrapAngle(to - from)
  if (Math.abs(delta) <= step) return to
  return from + Math.sign(delta) * step
}

// El giro (rotation.y) que mira de (x, z) hacia (tx, tz): el heroe de Tripo
// mira hacia +z con giro 0.
export function yawTo(x, z, tx, tz) {
  return Math.atan2(tx - x, tz - z)
}

// Un numero del 0 al 1 fijo por texto: el mismo NPC se ve y camina igual cada
// vez que se arma el mapa.
export function hashText(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Azar con semilla (mulberry32): cada NPC lleva el suyo.
export function seeded(seed) {
  let a = Math.floor(seed * 4294967296) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Como se ve cada uno ---------------------------------------------------------

// `tint` es el color de la ropa (la cara y las manos quedan como estan) y `mix`
// cuanto pesa; `cap` el de la gorra del heroe, que asi pasa a ser un yelmo, una
// capucha o un gorro (sin `cap`, la ropa mas oscura); `height` en metros (el
// heroe mide 2,1); `slim` angosta a los elfos; `weapon` va en la mano del arma
// y `shield` en el antebrazo, con los GLB de assets/tripo (en el telefono, una
// version hecha de cajas); `hold` como se lleva el arma ('up' parada, 'rest' al
// costado, 'bow' el arco); `staff` es un baculo hecho a mano con la gema de ese
// color; `crown` una corona de oro; `roam` cuanto se aleja de su celda, en
// metros. La ropa del heroe es naranja: nadie de la ciudad se le parece.
const CITY = {
  guard: {
    tint: 0x4f6ea8,
    mix: 0.8,
    cap: 0xa8b0bc,
    height: 1.98,
    weapon: 'spear',
    hold: 'up',
    roam: 1.5
  },
  smith: {
    tint: 0x5a4234,
    mix: 0.78,
    cap: 0x2e2622,
    height: 1.92,
    weapon: 'warhammer',
    hold: 'rest',
    roam: 2
  },
  armorer: {
    tint: 0x8a8e98,
    mix: 0.78,
    cap: 0x5c6068,
    height: 1.86,
    weapon: 'sword',
    shield: true,
    hold: 'rest'
  },
  priest: { tint: 0xf4eedc, mix: 0.82, cap: 0xf8f0d8, height: 1.84, staff: 0xffe08a },
  alchemist: { tint: 0x4f8f5c, mix: 0.78, cap: 0x6a3f86, height: 1.8 },
  tavern: { tint: 0x8e3a30, mix: 0.76, cap: 0xece4d4, height: 1.82 },
  resident: { tint: 0x8f8a6a, mix: 0.74, height: 1.8 },
  villager: { tint: 0x8f8a6a, mix: 0.74, height: 1.8 },
  // El rey: oro y terciopelo rojo bajo la corona. Da un par de pasos frente al
  // trono y nada mas.
  king: {
    tint: 0xe2b84a,
    mix: 0.8,
    cap: 0x8a1e22,
    height: 2.3,
    staff: 0xe23a3a,
    scepter: true,
    crown: true,
    roam: 1.2
  }
}
// NOX: elfos oscuros armados con yelmos de plata, una elfa de plata en el
// mercado y druidas de violeta con baculos de gema. Mas altos y mas delgados
// que la gente de RUNA.
const NOX = {
  guard: {
    tint: 0x4a3c82,
    mix: 0.84,
    cap: 0xc4c8dc,
    height: 2.02,
    weapon: 'spear',
    hold: 'up',
    roam: 1.5
  },
  smith: {
    tint: 0x3c3454,
    mix: 0.82,
    cap: 0xb0b4c8,
    height: 1.96,
    weapon: 'warhammer',
    hold: 'rest',
    roam: 2
  },
  armorer: {
    tint: 0x7670a6,
    mix: 0.82,
    cap: 0xd0d4e4,
    height: 1.94,
    weapon: 'sword',
    shield: true,
    hold: 'rest'
  },
  tavern: { tint: 0xc8c8e4, mix: 0.8, cap: 0x5a3c8a, height: 1.92 },
  alchemist: { tint: 0x5a4a94, mix: 0.82, cap: 0x2c2848, height: 1.9, staff: 0x9a7aff },
  priest: { tint: 0xcac0f2, mix: 0.84, cap: 0xeceaf8, height: 1.98, staff: 0xc8a8ff }
}
// La pradera: Eira, la guardabosques, de verde con capucha y el arco largo.
const FIELD = {
  resident: {
    tint: 0x4f7f3e,
    mix: 0.8,
    cap: 0x2f4a26,
    height: 1.86,
    weapon: 'longbow',
    hold: 'bow',
    roam: 2
  }
}
// Los que tienen algo propio en su reino. Cedric es caballero: espada, escudo y
// yelmo de acero.
const BY_ID = {
  cedric: { weapon: 'sword', shield: true, hold: 'rest', tint: 0x7d8cb0, cap: 0xb8bcc4 }
}
// Los vecinos llevan el color de su ropa en la terminal, apagado.
const COLORS = {
  red: 0xa0584a,
  green: 0x6a8f58,
  yellow: 0xb8a052,
  blue: 0x5f78a8,
  magenta: 0x9a5f92,
  cyan: 0x5a9a9a,
  white: 0xd8d4c8,
  gray: 0x8a8a84
}
const KINGDOMS = { nox: NOX, field: FIELD }

// Un color mas oscuro, para la gorra de quien no trae una propia.
export function darker(color, k = 0.55) {
  const r = Math.round(((color >> 16) & 255) * k)
  const g = Math.round(((color >> 8) & 255) * k)
  const b = Math.round((color & 255) * k)
  return (r << 16) | (g << 8) | b
}

/**
 * Como se ve un NPC del mapa `mapId`: { tint, mix, cap, height, slim, weapon,
 * shield, hold, staff, scepter, crown, roam, seed }. Siempre devuelve algo: un
 * tipo sin nada propio es un vecino.
 */
export function lookOf(mapId, npc) {
  const kingdom = KINGDOMS[mapId] || CITY
  const kind = npc.kind || 'villager'
  const base = kingdom[kind] || CITY[kind] || CITY.villager
  const seed = hashText((mapId || '') + ':' + (npc.id || npc.name || kind))
  const look = {
    tint: null,
    mix: 0,
    cap: null,
    height: 1.8,
    slim: mapId === 'nox' ? 0.9 : 1,
    weapon: null,
    shield: false,
    hold: 'rest',
    staff: null,
    scepter: false,
    crown: false,
    roam: RADIUS,
    ...base,
    ...(BY_ID[npc.id] || {}),
    seed
  }
  // Un vecino lleva el color de su ropa en la terminal.
  if ((kind === 'villager' || kind === 'resident') && mapId !== 'field' && COLORS[npc.color]) {
    look.tint = COLORS[npc.color]
    look.cap = null
  }
  if (look.cap === null && look.tint !== null) look.cap = darker(look.tint)
  // Dos del mismo oficio no miden exactamente lo mismo.
  look.height = Number((look.height * (0.97 + seed * 0.06)).toFixed(3))
  look.roam = Math.min(RADIUS, look.roam)
  return look
}

// --- Por donde camina --------------------------------------------------------------

// Se puede ir en linea recta del centro de la celda `home` a (dx, dy) celdas de
// ella sin pisar una celda que no se camina. Se miran todas las celdas que cruza
// la recta: cambia de celda donde dx * t o dy * t pasa por un medio (k + 0,5), y
// entre dos cambios seguidos la celda es una sola.
export function clearPath(home, dx, dy, walkable) {
  const cuts = [0, 1]
  for (const d of [Math.abs(dx), Math.abs(dy)]) {
    for (let k = 0; k < d; k++) cuts.push((k + 0.5) / d)
  }
  cuts.sort((a, b) => a - b)
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] === cuts[i - 1]) continue
    const t = (cuts[i] + cuts[i - 1]) / 2
    if (!walkable(home.x + Math.round(dx * t), home.y + Math.round(dy * t))) return false
  }
  return walkable(home.x + dx, home.y + dy)
}

/**
 * Los puntos del paseo alrededor de la celda `home` ({ x, y }): hasta `count`
 * celdas caminables a menos de `radius` metros, con camino recto desde la celda
 * y separadas entre si. Devuelve [{ dx, dy, x, z }]: la celda relativa y su
 * centro en metros desde el centro de home. Puede volver vacia (un NPC
 * encerrado se queda en su celda).
 */
export function wanderSpots(home, walkable, rand, options = {}) {
  const { cx = 0.5, cz = 1, radius = RADIUS, count = 2, avoid = null } = options
  const rx = Math.floor(radius / cx)
  const ry = Math.floor(radius / cz)
  const candidates = []
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const d = Math.hypot(dx * cx, dy * cz)
      if (d < 0.9 || d > radius) continue
      if (avoid && avoid(home.x + dx, home.y + dy)) continue
      if (!walkable(home.x + dx, home.y + dy)) continue
      if (!clearPath(home, dx, dy, walkable)) continue
      candidates.push({ dx, dy, x: dx * cx, z: dy * cz })
    }
  }
  // Barajar con la semilla del NPC y quedarse con los que estan separados.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const swap = candidates[i]
    candidates[i] = candidates[j]
    candidates[j] = swap
  }
  const spots = []
  for (const spot of candidates) {
    if (spots.length >= count) break
    if (spots.some((other) => Math.hypot(other.x - spot.x, other.z - spot.z) < 1.2)) continue
    spots.push(spot)
  }
  return spots
}

/**
 * El paseo de un NPC, en metros desde el centro de su celda. `rest` es hacia
 * donde mira cuando no hace nada (hacia +z, la camara, con un poco de giro).
 */
export function createWander(spots, rand, rest = 0) {
  return {
    spots,
    rand,
    rest,
    x: 0,
    z: 0,
    yaw: rest,
    mode: 'pause',
    wait: 1 + rand() * 4,
    next: 0,
    target: null,
    gait: 'Idle',
    speed: 0,
    talk: 0,
    attending: false
  }
}

const TURN_RATE = 5

function moveTo(w, tx, tz, speed, dt) {
  const dx = tx - w.x
  const dz = tz - w.z
  const d = Math.hypot(dx, dz)
  const step = speed * dt
  if (d <= step || d < 1e-4) {
    w.x = tx
    w.z = tz
    return true
  }
  w.x += (dx / d) * step
  w.z += (dz / d) * step
  w.yaw = turnToward(w.yaw, Math.atan2(dx, dz), TURN_RATE * dt)
  return false
}

/**
 * Un paso del paseo. `hero` es { x, z } en metros desde el centro de la celda
 * del NPC, o null. Deja en `w` la posicion (x, z), el giro (yaw), el clip
 * (gait: 'Idle' o 'Walk') y la velocidad de suelo (speed, m/s).
 */
export function stepWander(w, dt, hero) {
  dt = Math.min(Math.max(dt, 0), 0.25)
  const heroHome = hero ? Math.hypot(hero.x, hero.z) : Infinity
  // Hablando: plantado en su celda, mirando al heroe.
  if (w.talk > 0) {
    w.talk = Math.max(0, w.talk - dt)
    w.x = 0
    w.z = 0
    if (hero) w.yaw = turnToward(w.yaw, yawTo(0, 0, hero.x, hero.z), TURN_RATE * 2 * dt)
    w.gait = 'Idle'
    w.speed = 0
    return w
  }
  // El heroe se acerca: a su celda, y a mirarlo.
  if (heroHome < ATTEND) {
    w.attending = true
    w.mode = 'pause'
    const home = moveTo(w, 0, 0, BRISK, dt)
    w.gait = home ? 'Idle' : 'Walk'
    w.speed = home ? 0 : BRISK
    const heroAt = Math.hypot(hero.x - w.x, hero.z - w.z)
    if (home && heroAt < FACE) {
      w.yaw = turnToward(w.yaw, yawTo(w.x, w.z, hero.x, hero.z), TURN_RATE * dt)
    }
    return w
  }
  if (w.attending) {
    // Se fue: un rato quieto antes de seguir paseando.
    w.attending = false
    w.mode = 'pause'
    w.wait = 1.5 + w.rand() * 2
  }
  if (w.mode === 'walk') {
    const arrived = moveTo(w, w.target.x, w.target.z, STROLL, dt)
    w.gait = 'Walk'
    w.speed = STROLL
    if (arrived) {
      w.mode = 'pause'
      const home = w.x === 0 && w.z === 0
      w.wait = home ? 3 + w.rand() * 4 : 2 + w.rand() * 4
      w.gait = 'Idle'
      w.speed = 0
    }
    return w
  }
  // En pausa: en su celda vuelve a mirar hacia la camara.
  w.gait = 'Idle'
  w.speed = 0
  if (w.x === 0 && w.z === 0) w.yaw = turnToward(w.yaw, w.rest, 1.5 * dt)
  w.wait -= dt
  if (w.wait > 0) return w
  if (!w.spots.length) {
    // Sin lugar para caminar: mira a un costado y al otro.
    w.rest = wrapAngle(w.rest + (w.rand() - 0.5) * 1.2)
    w.rest = Math.max(-0.9, Math.min(0.9, w.rest))
    w.wait = 3 + w.rand() * 4
    return w
  }
  // Ida y vuelta: de la celda a un punto, de vuelta a la celda, al siguiente.
  if (w.x === 0 && w.z === 0) {
    w.target = w.spots[w.next % w.spots.length]
    w.next++
  } else w.target = { x: 0, z: 0 }
  w.mode = 'walk'
  return w
}

// Al hablarle: a su celda de una vez y el gesto.
export function greet(w) {
  w.x = 0
  w.z = 0
  w.mode = 'pause'
  w.wait = 2 + w.rand() * 2
  w.talk = TALK
  w.gait = 'Idle'
  w.speed = 0
  return w
}

/**
 * La velocidad del clip Walk para un NPC de `height` metros que camina a
 * `speed` m/s sin que el pie patine (como mucho WALK_MOST).
 */
export function walkScale(speed, height) {
  const pace = (WALK_PACE * height) / WALK_HEIGHT
  return Math.min(WALK_MOST, Math.max(0.5, speed / pace))
}

// Cuanto asiente y se mece al hablar, para `left` segundos de gesto: dos
// cabeceos que se apagan y un vaiven suave del cuerpo. En radianes.
export function gesture(left) {
  if (left <= 0) return { nod: 0, sway: 0 }
  const t = TALK - left
  const fade = Math.min(1, left / 0.3) * Math.min(1, t / 0.15)
  return {
    nod: Math.max(0, Math.sin(t * Math.PI * 2.5)) * 0.32 * fade,
    sway: Math.sin(t * Math.PI * 1.25) * 0.08 * fade
  }
}

/**
 * Los indices de los NPC que se animan: los `count` mas cercanos a menos de
 * `range` metros. list es [{ i, d }]. Los que ya se animaban (`kept`) cuentan
 * 1,5 m mas cerca, asi no saltan de un cuadro al otro en el borde.
 */
export function pickActive(list, count, range, kept = null) {
  const near = (entry) => (kept && kept.has(entry.i) ? entry.d - 1.5 : entry.d)
  const sorted = list.filter((entry) => near(entry) <= range)
  sorted.sort((a, b) => near(a) - near(b) || a.i - b.i)
  return new Set(sorted.slice(0, Math.max(0, count)).map((entry) => entry.i))
}
