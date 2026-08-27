# Diseño de RUNA y la pradera

## Objetivo

RUNA debe contrastar con NOX sin volver a ser una colección de edificios
gigantes. Es una capital humana luminosa y compacta: el castillo domina la
silueta, mientras iglesia, hogar, taberna y talleres mantienen una escala de
calle. La pradera debe leerse como un paisaje habitado, no como ruido aleatorio.

## Referencias investigadas

- El [informe histórico de Newark-on-Trent de Historic
  England](https://historicengland.org.uk/research/results/reports/9067/Newark-on-TrentNottinghamshireHistoricAreaAssessment)
  permite reconocer castillo, iglesia, plaza de mercado y calles como las
  piezas estructurales de la ciudad histórica.
- La [ficha de 43-44 Market Place en
  Boston](https://historicengland.org.uk/listing/the-list/list-entry/1388945)
  describe una calle principal que se abre a un mercado ancho, del que parten
  calles medievales más estrechas hacia la iglesia.
- En [Northallerton](https://historicengland.org.uk/listing/the-list/list-entry/1020719?section=comments-and-photos),
  la aproximación entre mercado, iglesia y residencia de poder se organiza como
  una ruta procesional. De ahí sale la avenida norte-sur de RUNA.
- La [ciudad fortificada de Carcasona según
  UNESCO](https://whc.unesco.org/en/list/345/) combina recinto defensivo,
  castillo, viviendas, calles y catedral. RUNA conserva muralla y portones, pero
  deja respirar los edificios civiles dentro del recinto.
- [Castle Acre](https://www.english-heritage.org.uk/visit/places/castle-acre-castle-and-bailey-gate/history/description/)
  inspira el portón con torres y el castillo orientado hacia la ciudad, sin
  convertir cada comercio en otra fortaleza.
- Los paisajes medievales documentados en
  [Tresibbet](https://historicengland.org.uk/listing/the-list/list-entry/1007775),
  [Flecknoe](https://historicengland.org.uk/listing/the-list/list-entry/1020934)
  y [Priors
  Hardwick](https://historicengland.org.uk/listing/the-list/list-entry/1016567?section=official-list-entry)
  combinan caminos hundidos, lindes, parcelas, estanques y sistemas de cultivo.
  La pradera traduce esas capas a caminos `:`/`%`, setos `"`, surcos `,`, claros
  y pequeños hitos.

## Traducción al mapa ASCII

- Se conserva la grilla `320x200` y las coordenadas de todas las puertas para
  mantener compatibles guardados y referencias de jugadores.
- Los edificios civiles miden entre `31x21` y `45x24`; el castillo se reduce a
  `96x42`, suficiente para dominar el norte sin ocupar todo el distrito.
- La avenida de la corona une castillo, mercado, plaza y portón sur. Calles
  transversales y callejones laterales conectan los servicios sin largos vacíos.
- Los jardines del alba y de la corona forman dos espacios verdes simétricos,
  mientras el mercado del alba ocupa una franja pequeña junto a la plaza.
- Los NPC explican la función de los barrios: pregonero, panadera, cartógrafo,
  comerciantes, clero, guardia y jardinero conectan arquitectura con mundo.
- En el campo, el camino principal une RUNA y NOX y se bifurca hacia cripta y
  portal. Eira, guardabosques del camino real, enseña esas rutas al interactuar.

## Restricciones comprobables

- Cada puerta `C I P A D T K > N` aparece una sola vez y es alcanzable.
- Ningún edificio civil supera `45x24`; el castillo no supera `100x42`.
- Los dos jardines y los cuatro accesos de la plaza permanecen abiertos.
- Los enemigos no aparecen ni patrullan encima de Eira o de los grandes hitos.
- El terreno sigue siendo determinista para una misma semilla.
