# Diseño del reino élfico oscuro de NOX

NOX no replica una ciudad de una franquicia existente. Su identidad combina
referencias arquitectónicas y naturales reales, traducidas a un mapa ASCII
jugable.

## Referencias investigadas

- [Gothic Art — The Metropolitan Museum of Art](https://www.metmuseum.org/essays/gothic-art):
  los arcos apuntados, bóvedas nervadas, pilares delgados y énfasis vertical
  inspiran las agujas, ventanas estrechas y accesos escalonados del palacio.
- [Göreme National Park and the Rock Sites of Cappadocia — UNESCO](https://whc.unesco.org/en/list/357/):
  sus asentamientos excavados, ciudades subterráneas y pináculos volcánicos
  inspiran una capital tallada dentro de una gran caverna en vez de edificios
  colocados sobre una llanura vacía.
- [Weird and wonderful fungi — Royal Botanic Gardens, Kew](https://www.kew.org/read-and-watch/weird-wonderful-fungi):
  la bioluminiscencia real de ciertos hongos inspira el jardín que pulsa con
  luz cian y magenta sin depender de antorchas.

## Traducción al mapa

- NOX se reconstruye desde cero sobre una grilla exterior de `320x200`, la misma
  escala y modalidad de la capital de RUNA. No hay recintos gigantes que hagan
  parecer que el jugador camina dentro de una fachada.
- El **Palacio del Eclipse** de `96x42` domina el norte como el castillo del reino
  original, pero usa cubierta de obsidiana, cuatro torres, lunas y galerías.
- Una avenida vertical y tres calles transversales dividen manzanas de escala
  normal. El paseo de la luna, el mercado nocturno y la plaza del eclipse forman
  un eje cívico continuo.
- Los **jardines de esporas y amatista** ocupan las esquinas septentrionales con
  estanques, puentes y hongos animados en tres fases.
- Santuario, casa del linaje, posada, alquimia, forja y armería son fachadas
  exteriores de `31x21` a `45x24`, orientadas a las calles como los edificios de
  RUNA. Cada una conserva una silueta y decoración oscura propia.
- Consejo del velo, archivo de sombras, puestos nocturnos, obelisco y portón sur
  completan el tejido urbano sin convertir cada punto de interés en una tienda.
- El pavimento lógico usa una celda caminable invisible y solo muestra cerca de
  `5%` de textura dispersa. Las calles siguen marcadas con puntos, pero desaparece
  la alfombra continua de `;` que interfería con fachadas, arte y habitantes.
- Seis habitantes explican el lugar desde dentro: centinela, micólogo,
  mercader, sacerdotisa, forjador y armera.

## Navegación

El mapa de `320x200` usa la misma jerarquía que RUNA: avenida central de seis
celdas, calles transversales en `Y:58`, `Y:118` y `Y:178`, y callejones que
conectan las manzanas. La frontera occidental `R`, las seis puertas de servicio,
el acceso al palacio, los jardines y el mercado son alcanzables desde el punto
de nacimiento. Las pruebas comparan explícitamente las dimensiones de ambas
capitales y recorren todos esos destinos.
