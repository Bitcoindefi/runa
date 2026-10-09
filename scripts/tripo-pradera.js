// La pradera en 3D y el combate en el mapa.
//
// La pagina (tripo-heroe.html) la arma una vez con createMeadow(ctx) y la usa en
// la partida y en el recorrido libre. Devuelve null si no dibuja nada: entonces
// la pradera sigue en la pantalla de texto del juego, como hasta ahora.
//
// Recibe `ctx`: scene, camera, hero (el stickman y el heroe de Tripo), CX y CZ
// (lo que mide una celda), session() (la partida en marcha de juego.js, o null
// en el recorrido), bundle() (el modulo juego.js, o null si no cargo), figure(color)
// (una figura simple), label(texto) del mundo y text(nombre) (traduce).
//
// Devuelve:
//   provide(id)       los datos de un mapa que no viene del visor (como
//                     /world/<id>.json: width, height, rows, tiles, npcs...), por
//                     ejemplo 'field'; null si ese mapa no es suyo
//   worldAt(st)       { map, x, y } donde va el heroe cuando la partida esta en
//                     una zona sin mapa fijo (st es runaPage().live); null si no
//                     la dibuja en 3D
//   handlesCombat(st) true si el combate de ese momento se ve en 3D (la pagina no
//                     abre la pantalla de texto)
//   update(time, dt, st, world)  cada cuadro mientras se ve un mapa suyo:
//                     monstruos, golpes, numeros de dano (st es null en el
//                     recorrido; world es { map, built, data } de la pagina)
//   leave(mapId)      la pagina deja de mostrar el mapa mapId (cualquiera): si
//                     era suyo, sacar lo que agrego

export function createMeadow(ctx) {
  void ctx
  return null
}
