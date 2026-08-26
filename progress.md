Original prompt: arreglar la escala: los NPC y el jugador son gigantes, tapan el mapa y el movimiento no se percibe

- Decisión: conservar el arte maestro de 25x25 como referencia, pero no renderizarlo dentro del mapa.
- Hecho: sprites jugables nativos de 9x7; el maestro de 25x25 se conserva fuera del mapa.
- Hecho: dos poses alternadas de piernas y equipo compacto para el héroe.
- Verificado visualmente: ciudad, portón y pradera en fotogramas de 120x34.
- Verificado automáticamente: movimiento cambia posición y pose; portón y colisiones siguen funcionando.
- Resultado: lint limpio, smoke del mapa OK y 52/52 pruebas (391 aserciones).
- TODO: ninguno para esta corrección de escala.

## Corrección de nitidez del movimiento

- Causa: la segunda pose cambiaba pies densos por apóstrofes finos y parecía difusa al alternar.
- Cambio: cabeza y torso permanecen idénticos; ambas poses de piernas usan el mismo ancho y densidad.
- Revisado: los cuadros consecutivos conservan torso, ancho y densidad; no quedan trazos finos residuales.
- Revisado: movimiento real, ciudad, portón y transición completa a la pradera.
- Resultado final: lint limpio, smoke OK y 52/52 pruebas (393 aserciones).
- TODO: ninguno para la corrección de nitidez.

## Ciudad sin mercado y edificios renovados

- Hecho: el mercado fue sustituido por una plaza cívica abierta con estatua, árboles, bancos y cuatro accesos.
- Hecho: castillo, iglesia, hogar, taberna, alquimista, herrería y armería tienen siluetas y detalles propios.
- Revisión visual: corregidos cruces entre ventanales, ranuras de torre, escudos y puertas.
- Revisión funcional: un rótulo `[RUNA]` creaba accidentalmente otra puerta `A`; se pasó todo texto decorativo a minúsculas.
- Resultado final: siete puertas únicas y alcanzables, smoke TODO OK, lint limpio y 52/52 pruebas (396 aserciones).
- TODO: ninguno para esta renovación urbana.

## Estabilidad de actores móviles

- Diagnóstico: el render diferencial limpia filas correctamente; el arte móvil de 9x7 y 9x5 invadía líneas vecinas y parecía romperlas.
- Decisión: rollback selectivo de escala para actores móviles, conservando ciudad y edificios.
- Hecho: héroe y NPC máximo 7x4; monstruos máximo 5x3; arte maestro detallado conservado fuera del mapa.
- Hecho: héroe y monstruos anclados por los pies para no pintar debajo de su casilla de colisión.
- Verificado: las celdas abandonadas se restauran exactamente y ningún cuadro cambia el ancho o alto de la terminal.
- Resultado final: ciudad, plaza, portón, pradera y combate revisados; smoke TODO OK, lint limpio y 53/53 pruebas (405 aserciones).
- TODO: ninguno para la estabilidad del movimiento.

## Regreso al héroe pequeño original

- Decisión del usuario: recuperar exactamente el dibujo ` O--[=]`, `/T\\`, `/ \\`.
- Hecho: el héroe vuelve a ocupar un máximo fijo de 7x3 caracteres en ciudad, pradera y combate.
- Hecho: eliminadas las poses alternadas y las variaciones visuales por equipo; moverse solo cambia coordenadas.
- Revisado visualmente con Bare: los cuadros 0 y 1 son idénticos y el terreno queda visible alrededor del personaje.
- Revisado funcionalmente: ciudad, portón, teletransporte a la pradera, combate y restauración del terreno siguen funcionando.
- Resultado final: lint limpio, diff limpio y 53/53 pruebas (401 aserciones).
- TODO: ninguno para este rollback puntual.

## Presentación atómica de cuadros

- Causa confirmada: al desplazarse la cámara cambian muchas filas y la terminal alcanzaba a mostrar el repintado mientras lo procesaba.
- Hecho: cada diff de Bare TUI se envía ahora dentro de DECSET 2026 (actualización sincronizada) y en una sola escritura.
- Compatibilidad comprobada: Windows Terminal instalado 1.24; esta versión soporta la presentación sincronizada.
- Hecho sin parchear dependencias: el adaptador vive en `lib/synchronized-renderer.js` y se conecta desde `bin.mjs`.
- Verificado automáticamente: un cuadro completo produce una sola escritura BSU/ESU; 54/54 pruebas (404 aserciones) y lint limpio.
- Verificado en el runtime Bare: inicio, entrada a la ciudad, movimientos consecutivos y salida limpia; cada cuadro lleva BSU/ESU.
- Resultado final: 54/54 pruebas (404 aserciones), lint limpio y diff válido.
- TODO: ninguno para el barrido de actualización; relanzar explícitamente con Windows Terminal 1.24.

## Menú persistente y movimiento de monstruos sin roturas

- Menú: ya no acepta cualquier tecla; solo `Enter` o `Espacio` comienzan y `Q` sale, evitando saltos por entradas residuales.
- Aclaración del usuario: el patrullaje no debía eliminarse. Se conservó íntegro y una prueba de 200 ticks confirma desplazamiento real.
- Causa adicional del barrido en pradera: cada celda coloreada emitía su propio par ANSI, inflando mucho cada fila modificada.
- Hecho: `paintRuns` agrupa celdas contiguas del mismo color; conserva el resultado visible y reduce drásticamente la salida.
- Verificado: filas con monstruos móviles permanecen compactas, restauran terreno y mantienen su ancho exacto.
- Revisión interactiva: una tecla ajena deja la portada visible y `Enter` abre la ciudad; salida limpia con `Q`.
- Revisión visual: ciudad, portón y pradera conservan arte, proporciones y sprites; smoke completo `TODO OK`.
- Resultado final: 56/56 pruebas (411 aserciones), lint limpio y diff válido.
- TODO: ninguno para este ajuste; relanzar la versión revisada.

## Héroe aprobado con escudo

- Elección del usuario: opción 2 exacta, `  O`, ` /T\\ [#]`, ` / \\`.
- Hecho: sprite fijo de 8x3 en ciudad, pradera y combate; no cambia por movimiento ni equipo.
- Hecho: anclaje horizontal por el torso `T`, evitando que el escudo desplace la posición visual.
- Corrección de revisión: separación de combate asimétrica para que el escudo no tape al monstruo contactado.
- Verificado visualmente: ciudad, portón y pradera; poses consecutivas idénticas.
- Resultado final: 56/56 pruebas (411 aserciones), lint limpio y diff válido.
- TODO: rediseñar los edificios con referencias ASCII individuales aprobadas por el usuario.

## Caminata del héroe con escudo

- Pedido del usuario: conservar el héroe elegido, pero mover brazos y piernas al caminar.
- Hecho: dos poses alternadas por cada paso; cabeza y escudo permanecen fijos.
- Estabilidad: ambas poses ocupan exactamente 8x3 y dibujan la misma cantidad de celdas visibles.
- Revisado visualmente: ciudad, portón y pradera mantienen escala, alineación y terreno íntegro.
- Verificado: restauración de terreno, patrullaje, combate y portales siguen funcionando.
- Resultado final: 56/56 pruebas (416 aserciones), lint limpio y diff válido.
- TODO: ninguno para la animación de caminata.

## Fachadas nativas y diferenciadas

- Diagnóstico: iglesia, hogar, taberna, alquimista, herrería y armería todavía compartían el generador `building()`; los adornos no alcanzaban para diferenciarlas.
- Referencias: colección de Genoveva y arquitectura eclesiástica ASCII clásica; la iglesia adapta a la escala del mapa una silueta asociada a Joan G. Stark y conserva el crédito en el código.
- Hecho: seis constructores propios sustituyen el molde común y mantienen las coordenadas originales de todas las puertas.
- Iglesia: nave ancha, campanario, cruz, vitrales, contrafuertes y rosetón.
- Hogar: casa baja de entramado, buhardilla y chimenea lateral.
- Taberna: dos plantas, entramado, barriles y cartel colgante.
- Alquimista: cúpula curva, burbujas, cuatro frascos y ventanales de laboratorio.
- Herrería: cubierta industrial baja, chimenea, fragua abierta y yunque.
- Armería: torres, almenas, sala de armas, escudos y puerta de rastrillo.
- Corrección de revisión: vaciados los interiores de las torres y convertidos los umbrales en mampostería válida.
- Verificado visualmente: los seis recortes tienen siluetas independientes y proporciones compatibles con el mapa 320x200.
- Resultado final: smoke `TODO OK`, 56/56 pruebas (420 aserciones), lint limpio y diff válido.
- TODO: en otra iteración, reemplazar también la base genérica interna del castillo conservando su entrada `V`.

## Sprites transparentes sobre el terreno

- Problema reportado: el héroe parecía envuelto en un rectángulo negro al caminar.
- Causa: los espacios de la caja 8x3 se componían como celdas opacas y reemplazaban pasto, calle y grava.
- Hecho: todos los espacios de héroe, NPC y monstruos son transparentes; solo los caracteres visibles modifican el cuadro.
- Pradera: `Field.render()` puede entregar terreno limpio sin los marcadores lógicos `@` y los glifos de monstruo para que `fieldPane` componga encima.
- Rendimiento: los cambios ANSI de color se encadenan sin cerrar y reabrir cada tramo; la fila de estrés bajó de 237 a 190 bytes.
- Revisión visual: ciudad, portón y pradera muestran sus caracteres dentro de los huecos de cabeza, brazo/escudo y piernas.
- Resultado final: smoke `TODO OK`, 58/58 pruebas (428 aserciones), lint limpio y diff válido.
- TODO: ninguno para la transparencia de actores.

## Nueva partida, nombre y equipo real

- El menu ahora abre `Nueva partida`, pide un nombre y no permite comenzar con el campo vacio.
- La primera letra alfanumerica del nombre aparece en el pecho del heroe en ciudad, pradera y combate.
- Inventario y equipo son estados distintos: arma izquierda y armadura derecha se guardan por ranura.
- Comprar un arma o armadura la equipa; Enter vuelve a equipar un objeto propio y X lo quita sin venderlo.
- El heroe ya no dibuja escudo al comenzar; espada, ballesta, escudo y botas solo aparecen cuando corresponden al equipo activo.
- El equipo activo entra al combate y se conserva en guardados version 2; los guardados anteriores migran sin inventar equipo.
- El escudo ahora es mecanico: reduce en 2 el dano de cada golpe, con un minimo de 1.
- Revision visual: formulario 80x24, ciudad sin equipo y cinco variantes compactas dentro del limite 8x3.
- Verificado: 60 pruebas, lint limpio, smoke del mapa `TODO OK` y diff valido.
- TODO: ninguno para este ajuste.

## README y capturas actuales

- README reescrito en español para reflejar el menú de nueva partida, el combate sobre el mapa y el equipo real.
- Se reemplazaron las capturas antiguas de menú, ciudad, campo y combate.
- Se agregaron capturas de creación del personaje y tienda de armaduras con equipo activo.
- Las seis imágenes son estados producidos por el render actual, no maquetas manuales.
- Se agregó `scripts/readme-screens.js` para volver a generar los estados documentados de forma reproducible.
- Capturas revisadas individualmente a 1280x800: texto legible, marcos completos y colores ANSI conservados.
- TODO: ninguno para la documentación actual.

## Ranuras y autoguardado persistente

- El menú principal ofrece tres ranuras navegables con flechas o `W`/`S`.
- `Enter` carga una ranura ocupada o crea un personaje en una vacía; `N` permite reemplazar la seleccionada.
- El guardado conserva nombre, vida, oro, experiencia, pociones, inventario, equipo, mapa y coordenadas.
- La posición en la pradera se restaura sin reanudar un combate a medio resolver.
- Cada entrada relevante y el cierre del programa escriben la ranura activa mediante `lib/saves.js`.
- Los archivos viven bajo el directorio persistente de RUNA, no en la carpeta temporal usada anteriormente.
- Revisión integrada: se creó un `slot-1.json` real, se comprobó su contenido y se eliminó el fixture aislado.
- Pulido posterior: menú principal y selector de ranuras son pantallas separadas; en `64x16` no se pisan ni cortan controles.
- Resultado final: 62/62 pruebas (473 aserciones), lint limpio y smoke del mapa `TODO OK`.
- Las seis capturas quedaron recortadas al borde real de la terminal, sin el lienzo exterior de `1280x800`.
- TODO: ninguno para este ajuste.

## Mapa del Coliseo preparado para duelos

- Pedido actual: los duelos deben ocurrir en un Coliseo propio, no en la pradera ni en el mapa del jefe mundial.
- Hecho: mapa eliptico de alta resolucion (128x52), con arena de grava, marcas runicas, gradas, publico, muros y tunel sur.
- Integracion: `MAPS.coliseum` publica dos `duelSpawns` simetricos, `refereeSpawn`, `arenaBounds` y `duelReady`.
- Seguridad: la baldosa `Q` permite volver a la ciudad durante pruebas; la futura logica PvP puede bloquearla mientras el duelo este activo.
- Documentado: `docs/coliseum.md` deja el contrato exacto para que el agente de duelos conecte transporte, limites y retorno.
- Revision visual: comprobados el punto de duelo oeste y el recorrido completo del tunel en vistas reales de 100x30 y 120x32.
- Verificado: 65/65 pruebas (515 aserciones) y lint limpio.
- TODO: conectar el desafio multijugador con `walker.placeAt('coliseum', spawn.x, spawn.y)` cuando llegue la logica de duelos.

## Traspaso para Claude

- Agregado `CLAUDE.md` en la raiz para que Claude lea automaticamente el estado canonico antes de trabajar.
- La nota impide duplicar el Coliseo dentro de la ciudad y separa arte/mapas de infraestructura, red y contratos.
- Detalla el flujo pendiente del duelo: conservar retorno, asignar lados, usar `duelSpawns`, bloquear `Q`, aislar PvP del jefe y regresar al finalizar.
- Advierte que `/root/runa-bd` quedo corrupto; la fuente canonica es este repositorio de Windows y el nuevo remoto transferido `Bitcoindefi/runa`.
- Recuperados 13,7 GB al vaciar solamente la cache regenerable de npm; no se borraron fuentes ni dependencias instaladas.

## Segunda formacion del jefe mundial

- Las fases ahora cambian el cuerpo completo: coraza agrietada desde 66 % y nucleo `***` expuesto desde 30 %.
- Todos los ataques y todas las fases conservan exactamente el lienzo 43x13 para no romper el render diferencial.
- Cada ataque fija el objetivo al comenzar; esquivar durante la preparacion funciona y el poder ya no corrige su trayectoria al lanzarse.
- Las trayectorias futuras se dibujan con marcas sin dano antes de convertirse en ondas, barridos, punos o runas reales.
- Las fases avanzadas conservan los ataques anteriores y agregan los nuevos, en vez de reemplazar todo el repertorio.
- Al cruzar 66 % o 30 % se emite el anuncio de fase correspondiente.
- Revision visual real: fase `furia` y preparacion de `colapso` inspeccionadas en una consola 120x32; las advertencias quedan sobre el terreno y no pisan cara, brazos ni nucleo.
- Verificado: 73/73 pruebas (546 aserciones), lint limpio y filas estables.
- TODO: cuando se integre `contrato-jefe`, sincronizar `phase` y `revision` sin replicar cuadros ni advertencias transitorias.

## Primera sesion PvP jugable en el Coliseo

- Integrada la sesion de `origin/duelos-sesion` sin perder las pruebas de Stellar.
- `DuelCombat` resuelve vida, ataque, defensa, alcance, enfriamiento, rendicion y ganador mediante entradas ordenadas y reproducibles.
- El equipo real del personaje alimenta el bloque PvP; espada, ballesta y escudo ya cambian las reglas y tambien se ven en el actor.
- La distancia descuenta el ancho visible de los stickmans para que los cuerpos no tengan que pisarse antes de un golpe corto.
- `Runa.startDuel()` conserva el punto de regreso, asigna los spawns del mapa y abre el Coliseo; `duelInput()` queda como borde para el transporte P2P.
- La vista muestra ambos combatientes, sus iniciales/equipo, vida, direccion del rival, distancia/alcance y recarga.
- `WASD` mueve, `F`/Espacio/Enter ataca y `R`/Escape rinde; la salida `Q` y las gradas quedan bloqueadas durante la pelea.
- Ganar, perder o rendirse devuelve al punto exacto anterior. El autoguardado usa ese punto seguro y el dano PvP nunca contamina la vida persistente de PvE.
- El resultado local queda separado de `contracts/duel-arena`: Soroban sigue encargado de commit-reveal, consenso y pago.
- Revision visual real: duelo con espada y escudo contra un stickman rival inspeccionado en 80x24; ambos cuerpos y el terreno conservan filas estables.
- Verificado: 98/98 pruebas (708 aserciones), render 80x24 y filas de ancho exacto.
- TODO: conectar desafio/aceptacion P2P, transportar inputs ordenados, finalizar por desconexion y publicar el resultado acordado en Soroban.
