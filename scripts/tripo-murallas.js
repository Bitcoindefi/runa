// Las murallas y sus portones en la vista 2.5D.
//
// buildWorld (tripo-mundo.js) llama a buildRamparts con el mapa ya clasificado,
// despues de encontrar los edificios. Lo que este modulo dibuja reemplaza a las
// cajas sueltas de esas clases de celda. Devuelve null si no dibuja nada, y
// entonces quedan las cajas de siempre.
//
// Recibe `world`:
//   data        el mapa (/world/<id>.json): rows, tiles, width, height, kind, id
//   kinds       la clase de cada celda (y * width + x): 'rampart', 'wall',
//               'door', 'tree'... (classify en tripo-mundo.js)
//   inBuilding  1 en las celdas que ya son parte de un edificio
//   doors       las puertas y portones: { x, y, ch, name }
//   toWorld     (x, y) => Vector3 del centro de la celda, en el piso
//   CX, CZ      lo que mide una celda: columna y fila
//   palette     los colores del mapa (PALETTES en tripo-mundo.js)
//   letters     las filas con los carteles en el idioma elegido
//   group       donde se agregan las mallas (se liberan con el mapa)
//   text        traduce un nombre al idioma elegido
//
// Devuelve:
//   skip         Set de clases de celda que ya no suben como cajas
//   gates        Set de 'x,y' de las puertas que este modulo dibujo como porton:
//                no llevan columna de luz ni losa con letra, solo su nombre
//   labelHeight  (door) => a que altura va el nombre de esa puerta (opcional)
//   update       (time) => cada cuadro, para antorchas o banderas (opcional)
//   dispose      () => lo que no cuelgue de `group` (opcional)

export function buildRamparts(world) {
  void world
  return null
}
