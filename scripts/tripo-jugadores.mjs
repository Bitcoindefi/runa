// Los otros jugadores de la sala en la pagina 3D (tripo-heroe.html): donde
// dibujarlos entre una linea de estado y la siguiente, y a cuales vestir con el
// heroe de Tripo animado.
//
//  - Cada jugador guarda un anillo de RING poses (createTrack). La red trae
//    unas 10 por segundo cuando camina y 2 quieto (lib/net.js pulse), con su
//    reloj (t) y su numero de linea (s). La pagina lo dibuja DELAY_MS atras:
//    asi casi siempre hay dos poses alrededor del momento que se muestra y el
//    paso sale parejo aunque las lineas lleguen a los saltos.
//  - Sin pose nueva se extrapola como mucho un intervalo, y nunca si la ultima
//    dice que esta quieto (g = 0): parar no hace pasarse y volver.
//  - Un salto de mas de SNAP_GAP metros (una puerta, un portal) no se camina:
//    se aparece ahi.
//  - El giro va por el camino corto entre las dos poses (un slerp de un solo
//    eje) y el paso (Idle, Walk, Run) sale de g.
//  - Las celdas (x, y) siguen siendo la verdad del juego: la posicion 3D (px,
//    pz) solo se usa si cae cerca de su celda (POSE_GAP).
//
// Sin three.js ni el juego: .mjs para que las pruebas lo carguen en Bare.

// Cuantas poses guarda cada jugador.
export const RING = 8
// Cuanto atras se dibuja a los demas, en ms.
export const DELAY_MS = 250
// Un salto mas largo que esto, en metros, se aparece en vez de caminarse.
export const SNAP_GAP = 6
// Lo lejos que puede caer la posicion 3D de su celda, en metros, para creerle.
export const POSE_GAP = 3
// Una linea sin numero (una terminal vieja) que repite la posicion cuenta como
// pose nueva cada tanto, para que el anillo siga al dia.
export const STALE_MS = 500
// Cuantos jugadores cercanos llevan el heroe animado; el resto, la figura.
export const RIGS = { phone: 3, desktop: 5 }
// Los clips del heroe por el paso g de la red: 0 quieto, 1 camina, 2 corre.
export const CLIPS = ['Idle', 'Walk', 'Run']

const TURN = Math.PI * 2

// El angulo en [-PI, PI).
export function wrapAngle(a) {
  return ((((a + Math.PI) % TURN) + TURN) % TURN) - Math.PI
}

// De a hacia b por el camino corto, en la fraccion k.
export function lerpAngle(a, b, k) {
  return wrapAngle(a + wrapAngle(b - a) * k)
}

// Donde poner a un jugador: la posicion 3D si la manda y cae cerca de su
// celda, si no el centro de la celda. cell es { x, z } (toWorld de la pagina).
export function placeOf(cell, pose) {
  if (pose && Number.isFinite(pose.px) && Number.isFinite(pose.pz)) {
    if (Math.hypot(pose.px - cell.x, pose.pz - cell.z) <= POSE_GAP) {
      return { x: pose.px, z: pose.pz, exact: true }
    }
  }
  return { x: cell.x, z: cell.z, exact: false }
}

// El paso que se ve: el de la red, o por la velocidad si no lo manda.
export function gaitOf(g, speed) {
  if (g === 0 || g === 1 || g === 2) return g
  if (speed > 3.5) return 2
  if (speed > 0.3) return 1
  return 0
}

/**
 * Las poses de un jugador. push(sample, now) guarda una si es nueva: sample
 * es { x, z, yaw?, g?, t?, s? } (x, z en metros del mapa 3D). at(now) dice
 * donde dibujarlo: { x, z, yaw, g, speed, snapped } o null si no hay ninguna.
 * now es el reloj de la pagina en ms (performance.now).
 */
export function createTrack() {
  const ring = []
  let lastSeq = null
  let offset = null
  // Cada aparicion suma uno: la pagina deja de suavizar el giro ese cuadro.
  let snaps = 0

  function stamp(sample, now) {
    if (!Number.isFinite(sample.t)) return now
    // El reloj del otro corrido al nuestro: el retraso minimo visto, que sube
    // de a poco por si los relojes se separan. Un salto grande (una pagina
    // congelada, un reloj que dio la vuelta) lo vuelve a medir.
    const gap = now - sample.t
    if (offset === null || Math.abs(gap - offset) > 5000) offset = gap
    else if (gap < offset) offset = gap
    else offset += (gap - offset) * 0.02
    return sample.t + offset
  }

  return {
    push(sample, now) {
      if (!sample || !Number.isFinite(sample.x) || !Number.isFinite(sample.z)) return false
      const last = ring[ring.length - 1]
      if (Number.isFinite(sample.s)) {
        // Repetida o vieja (llego tarde, despues de una mas nueva): no cuenta.
        // Una mucho menor es un numero que volvio a empezar (otra sesion).
        if (lastSeq !== null && sample.s <= lastSeq && lastSeq - sample.s < 1000) return false
        lastSeq = sample.s
      } else if (last && last.x === sample.x && last.z === sample.z && now - last.seen < STALE_MS) {
        return false
      }
      let at = stamp(sample, now)
      const moved = last ? Math.hypot(sample.x - last.x, sample.z - last.z) : 0
      if (last && moved > SNAP_GAP) {
        ring.length = 0
        snaps++
      } else if (last && at <= last.at) {
        at = last.at + 1
      }
      let yaw = Number.isFinite(sample.yaw) ? sample.yaw : null
      if (yaw === null) {
        if (last && moved > 0.05 && moved <= SNAP_GAP) {
          yaw = Math.atan2(sample.x - last.x, sample.z - last.z)
        } else yaw = last ? last.yaw : 0
      }
      const g = sample.g === 0 || sample.g === 1 || sample.g === 2 ? sample.g : null
      ring.push({ at, seen: now, x: sample.x, z: sample.z, yaw, g })
      if (ring.length > RING) ring.shift()
      return true
    },

    at(now) {
      if (!ring.length) return null
      const render = now - DELAY_MS
      const first = ring[0]
      const last = ring[ring.length - 1]
      const out = (x, z, yaw, g, speed) => ({
        x,
        z,
        yaw,
        g: gaitOf(g, speed),
        speed,
        snaps
      })
      if (ring.length === 1 || render <= first.at) {
        return out(first.x, first.z, first.yaw, first.g, 0)
      }
      if (render >= last.at) {
        const prev = ring[ring.length - 2]
        const span = last.at - prev.at
        const speed = span > 0 ? (Math.hypot(last.x - prev.x, last.z - prev.z) * 1000) / span : 0
        // Quieto o sin un paso parejo, se queda en la ultima.
        if (last.g === 0 || span <= 0 || speed < 0.05) {
          return out(last.x, last.z, last.yaw, last.g, 0)
        }
        const ahead = Math.min(render - last.at, span) / span
        return out(
          last.x + (last.x - prev.x) * ahead,
          last.z + (last.z - prev.z) * ahead,
          last.yaw,
          last.g,
          speed
        )
      }
      let i = ring.length - 2
      while (i > 0 && ring[i].at > render) i--
      const a = ring[i]
      const b = ring[i + 1]
      const span = b.at - a.at
      const k = span > 0 ? (render - a.at) / span : 1
      const speed = span > 0 ? (Math.hypot(b.x - a.x, b.z - a.z) * 1000) / span : 0
      return out(
        a.x + (b.x - a.x) * k,
        a.z + (b.z - a.z) * k,
        lerpAngle(a.yaw, b.yaw, k),
        k < 0.5 ? a.g : b.g,
        speed
      )
    },

    get size() {
      return ring.length
    }
  }
}

/**
 * Los ids de los `count` jugadores mas cercanos: list es [{ id, d }], con d la
 * distancia al heroe. A igual distancia gana el id menor, asi la eleccion no
 * salta entre dos cuadros iguales.
 */
export function nearest(list, count) {
  const sorted = [...list].sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return new Set(sorted.slice(0, Math.max(0, count)).map((entry) => entry.id))
}
