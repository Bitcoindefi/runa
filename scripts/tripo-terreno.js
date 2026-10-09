// El terreno de la vista 2.5D: lo que buildWorld (tripo-mundo.js) suma despues
// del suelo, los edificios y la vegetacion. Por ejemplo, relieve alrededor del
// mapa, pasto con viento o agua con reflejos. Devuelve null si no suma nada.
//
// Recibe `world`:
//   data        el mapa (/world/<id>.json): rows, tiles, width, height, kind, id
//   kinds       la clase de cada celda (y * width + x)
//   inBuilding  1 en las celdas que ya son parte de un edificio
//   toWorld     (x, y) => Vector3 del centro de la celda, en el piso
//   CX, CZ      lo que mide una celda: columna y fila
//   palette     los colores del mapa
//   ground      la malla del suelo del mapa (y = 0, el heroe camina ahi)
//   clock       { value }: segundos, se actualiza al dibujar el suelo
//   group       donde se agregan las mallas (se liberan con el mapa)
//
// Devuelve { update(time), dispose() } (los dos opcionales) o null.

export function buildTerrain(world) {
  void world
  return null
}
