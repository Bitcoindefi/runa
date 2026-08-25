'use strict'

/**
 * runa: una sesion de duelo.
 *
 * El Coliseo ya existe como mapa propio (`lib/coliseum.js`) y publica todo lo
 * que hace falta para pararse adentro: `duelSpawns`, `arenaBounds` y
 * `refereeSpawn`. Este archivo no dibuja nada. Se ocupa de lo otro: quien va de
 * que lado, donde vuelve cada uno cuando termina, y que nadie se escape a las
 * gradas mientras la pelea esta viva.
 *
 * Tres decisiones que explican el resto.
 *
 *  1. **Los lados se calculan, no se acuerdan.** Dos jugadores sin servidor
 *     tienen que llegar al mismo reparto por su cuenta, y cualquier negociacion
 *     ("vos oeste, yo este") es un mensaje que se puede perder o contradecir.
 *     Comparar las dos identidades y que la menor sea oeste no necesita ningun
 *     mensaje: los dos hacen la misma cuenta y les da lo mismo.
 *
 *  2. **La vuelta se guarda antes de salir.** Un duelo puede terminar porque
 *     alguien gano, porque se rindio, o porque se le corto internet. El ultimo
 *     caso es el que manda el diseno: si el regreso dependiera de un mensaje de
 *     cierre, el que se desconecta quedaria varado en el Coliseo para siempre.
 *     Por eso `from` se guarda al entrar y alcanza con tenerlo para volver.
 *
 *  3. **Este modulo no sabe de daño.** No calcula quien gana, no toca la vida
 *     de nadie y no habla con la cadena. `docs/coliseum.md` pide exactamente
 *     eso del mapa, y vale igual para la sesion: geometria y estado, nada mas.
 *     Los duelos, el jefe mundial y los encuentros con monstruos son sesiones
 *     distintas y mezclarles el estado es el error que hay que no cometer.
 */

/** Los estados posibles. Un duelo no vuelve de `over`. */
const IDLE = 'idle'
const ACTIVE = 'active'
const OVER = 'over'

/**
 * De que lado le toca a cada uno.
 *
 * Se comparan las dos identidades como texto y la menor va al oeste. No importa
 * cual criterio se elija mientras sea total y los dos usen el mismo; lo que
 * importa es que **no haga falta preguntar**. Los dos jugadores corren esta
 * funcion con los mismos dos nombres, en el orden que sea, y les da lo mismo.
 *
 * @param {string} self
 * @param {string} rival
 * @returns {'west'|'east'}
 */
function sideFor(self, rival) {
  const a = String(self)
  const b = String(rival)
  if (a === b) {
    // Dos identidades iguales no son dos jugadores. Se devuelve algo estable en
    // vez de tirar, porque quien llame a esto puede estar dibujando un cuadro.
    return 'west'
  }
  return a < b ? 'west' : 'east'
}

/** El lado contrario. */
function otherSide(side) {
  return side === 'west' ? 'east' : 'west'
}

class Duel {
  /**
   * @param {object} opts
   * @param {object} opts.arena - `MAPS.coliseum`. De aca salen las coordenadas;
   *   este modulo no tiene ninguna escrita, para que mover el arte del Coliseo
   *   no obligue a tocar la logica de duelos.
   * @param {string} opts.self - identidad del jugador local
   * @param {string} opts.rival - identidad del rival
   */
  constructor({ arena, self, rival } = {}) {
    if (!arena || !Array.isArray(arena.duelSpawns) || arena.duelSpawns.length < 2) {
      throw new Error('el duelo necesita un mapa con dos duelSpawns')
    }
    if (!arena.arenaBounds) {
      throw new Error('el duelo necesita arenaBounds para encerrar a los que pelean')
    }

    this.arena = arena
    this.self = String(self)
    this.rival = String(rival)
    this.side = sideFor(this.self, this.rival)
    this.state = IDLE

    /** Donde estaba el jugador antes de entrar. Se llena en `begin`. */
    this.from = null
    /** Por que termino. Lo lee la interfaz para decir algo. */
    this.reason = null
  }

  /** ¿Hay una pelea en curso? */
  get active() {
    return this.state === ACTIVE
  }

  /**
   * El punto donde le toca pararse a un lado.
   *
   * Sale de `arena.duelSpawns` y se devuelve copiado. Devolver el objeto del
   * mapa dejaria que quien lo reciba le mueva las coordenadas al Coliseo sin
   * querer, y el proximo duelo empezaria torcido.
   *
   * @param {'west'|'east'} [side] - por omision, el lado del jugador local
   */
  spawnFor(side = this.side) {
    const found = this.arena.duelSpawns.find((s) => s.id === side)
    if (!found) throw new Error('el mapa no publica el lado ' + side)
    return { ...found }
  }

  /** Donde se para el rival. */
  rivalSpawn() {
    return this.spawnFor(otherSide(this.side))
  }

  /**
   * Donde se para el arbitro, si el protocolo llega a necesitar uno visible.
   *
   * Hoy nadie lo usa, y esta igual porque el mapa lo reserva: si el dia de
   * manana la autoridad tiene cuerpo, el lugar ya esta y no hay que inventarlo
   * en medio de otra cosa.
   */
  refereeSpawn() {
    return this.arena.refereeSpawn ? { ...this.arena.refereeSpawn } : null
  }

  /**
   * Entrar al Coliseo.
   *
   * @param {{mapId: string, x: number, y: number}} from - donde estaba el
   *   jugador. Se guarda tal cual y es lo unico que hace falta para volver.
   * @returns {{mapId: 'coliseum', x: number, y: number, facing: string}}
   */
  begin(from) {
    if (this.state === ACTIVE) throw new Error('el duelo ya empezo')
    if (this.state === OVER) throw new Error('este duelo ya termino')
    if (!from || typeof from.mapId !== 'string') {
      throw new Error('hace falta saber de donde vino para poder devolverlo')
    }

    this.from = { mapId: from.mapId, x: from.x, y: from.y }
    this.state = ACTIVE

    const spawn = this.spawnFor()
    return { mapId: 'coliseum', x: spawn.x, y: spawn.y, facing: spawn.facing }
  }

  /**
   * Encerrar una posicion dentro del campo.
   *
   * `docs/coliseum.md` lo pide con estas palabras: los limites existen "para
   * impedir que un combatiente huya a las gradas". Se recorta en vez de
   * rechazar el movimiento porque el que camina contra el borde tiene que
   * quedar pegado al borde, no rebotar ni quedarse trabado.
   */
  clamp(x, y) {
    const b = this.arena.arenaBounds
    return {
      x: Math.min(Math.max(x, b.x1), b.x2),
      y: Math.min(Math.max(y, b.y1), b.y2)
    }
  }

  /** ¿Esta posicion quedo afuera del campo? */
  inside(x, y) {
    const b = this.arena.arenaBounds
    return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2
  }

  /**
   * ¿Hay que bloquear la salida `Q`?
   *
   * La baldosa `Q` vuelve a la ciudad y existe como salida de seguridad. Con un
   * duelo vivo se bloquea, porque si no el que va perdiendo se va caminando y
   * el duelo no termina nunca ni gana nadie.
   */
  blocksExit() {
    return this.active
  }

  /**
   * Terminar.
   *
   * Sirve para las tres formas de terminar y a proposito no las distingue en el
   * regreso: el que gana, el que se rinde y el que se queda sin internet
   * vuelven todos al mismo lugar del que salieron. La diferencia entre esos
   * casos es de puntaje y de premio, y eso no vive aca.
   *
   * @param {string} [reason]
   * @returns {{mapId: string, x: number, y: number}|null} donde devolverlo
   */
  end(reason = 'termino') {
    if (this.state === OVER) return this.from ? { ...this.from } : null
    this.state = OVER
    this.reason = reason
    return this.from ? { ...this.from } : null
  }
}

module.exports = { Duel, sideFor, otherSide, IDLE, ACTIVE, OVER }
