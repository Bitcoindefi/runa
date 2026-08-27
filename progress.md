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

## Duelo P2P conectado e interfaz de wallet

- `E` sobre un jugador cercano envia un desafio; Enter acepta y `N` rechaza.
- El peer con id menor ordena movimientos, ataques, rendicion y ticks; el rival
  reproduce pasos numerados sin prediccion local.
- Los mensajes son dirigidos, saneados, acotados y protegidos contra replay; la
  desconexion libera el Coliseo con un resultado consistente.
- `V` abre `WALLET Y PVP`; permite vincular y persistir una direccion publica
  Stellar validada, o desvincularla con `X`.
- `WalletSession` rechaza seeds secretas y separa la identidad publica del
  firmante externo. La pantalla no llama "conectada" a una cuenta que no puede
  firmar.
- Revision visual real en 80x24: pantalla completa, ficha y log estables; el
  pie expone el acceso desde la ciudad.
- Verificado: 103/103 pruebas (745 aserciones), incluida una simulacion completa
  de dos partidas, y lint limpio tras corregir reglas de estilo.
- TODO: desplegar el contrato, configurar su id y sumar el companion
  Wallets Kit/WalletConnect o SEP-7 que firme y envie el XDR.

## Puente XDR para duel-arena

- Integrado `origin/main` antes de continuar; se conservaron las correcciones
  recientes de mapa/render y el contrato de inventario.
- `Chain.prepareInvocation()` obtiene la secuencia publica, construye la llamada,
  simula contra Soroban RPC y aplica footprint, autorizaciones y tarifa de recursos.
- `DuelChain` expone create, accept, reveal y publish-result, delega la firma a
  `WalletSession` y envia solamente el XDR firmado que devuelve el adaptador.
- Ninguna seed secreta entra a Runa, al cliente del contrato ni al guardado.
- Cerrado un vector de terceros en `publish_result`: el ganador declarado ahora
  debe autorizar la llamada antes de que el contrato acepte el claim.
- Verificado: 109/109 pruebas (801 aserciones), lint limpio y diff valido.
- TODO: desplegar `duel-arena`, configurar su contract id y conectar un companion
  WalletConnect/SEP-7 concreto para completar una transaccion real en testnet.

## Estatua y rankings de heroes

- La estatua decorativa de la plaza se amplio y ahora es un monumento interactivo.
- `E` junto al pedestal abre una pantalla con rankings por nivel y por PvP.
- El ranking combina las tres ranuras locales con los perfiles publicos de los
  jugadores conectados; no transmite direcciones de wallet ni datos secretos.
- Victorias y derrotas PvP se registran al cerrar el duelo y sobreviven en el
  guardado version 3; las partidas anteriores migran con ambos contadores en cero.
- Las pestañas se cambian con izquierda/derecha o Tab y se cierran con E/Escape.
- Verificado: 113/113 pruebas (829 aserciones), lint limpio y diff valido.

## Interior del castillo y salon del trono

- La entrada principal del castillo abre ahora un mapa interior propio, en vez de
  bajar directamente a las ruinas.
- El gran salon incluye alfombra real, tarima, trono, columnas, estandartes,
  bancos y braseros en arte ASCII nativo.
- El rey Aldren espera frente al trono y puede ser consultado como los demas NPC.
- Una escalera lateral conecta con la mazmorra y devuelve al punto exacto del
  salon; la puerta sur regresa al punto exacto de la ciudad.
- El retorno del castillo se conserva en guardados y se reinicia al crear una
  partida nueva.
- Revision visual: corregido un umbral duplicado en la puerta sur; el trono, el
  rey, la alfombra y el mobiliario conservan filas estables en 120x34.
- Aldren usa ahora un sprite real propio de 7x4: corona, emblema y pose sentada
  con brazos y piernas apoyados en el trono, manteniendo la interaccion con E.

## Primera mision de la plaza

- Sir Cedric, con sprite de caballero, espera a la izquierda de la estatua
  sin bloquear ninguno de los accesos de la plaza.
- E acepta la mision `plaga de mosquitos`: eliminar 20 mosquitos en la pradera.
- Solo una victoria real contra el tipo `mosquito` suma progreso; otros enemigos
  y bajas anteriores a la aceptacion no cuentan.
- La ficha muestra el contador o avisa cuando corresponde volver con Cedric.
- Entregarla concede una sola vez 100 de oro y 100 de experiencia, incluyendo
  subidas de nivel, y su estado se conserva al guardar y cargar la ranura.

## Plaza central y agua animada

- La plaza de los heroes tiene ahora rotulo propio, estandartes simetricos,
  jardines, bancos y una fuente monumental integrada a la estatua del ranking.
- Tres fases alternan crestas, ondas y gotas en la fuente de la plaza; la fuente
  de la avenida comparte el mismo sistema de movimiento.
- El agua se compone como una capa visual bajo NPC y heroe. Nunca modifica las
  filas del mapa, por lo que colisiones, caminos y guardados permanecen estables.
- El reloj visual avanza incluso con el jugador quieto y cada fase conserva el
  ancho exacto de todas las filas de la terminal.

## Pradera ampliada y mazmorra de tres niveles

- La pradera dinamica crecio de 120x36 a 160x48 y tiene una cripta de piedra
  visible en el extremo sudeste, con una zona segura alrededor de su entrada X.
- La cripta es una excursion de combate real: nivel 1 con slimes y esqueletos;
  nivel 2 con esqueletos, caballeros y arqueros; nivel 3 con guardia de elite y
  un unico Rey Esqueleto sentado ante su trono funerario.
- Cada nivel tiene plano amplio, camaras conectadas, obstaculos, escaleras ^/v y
  patrullas. La bajada queda sellada hasta derrotar todos los monstruos del piso.
- Los enemigos derrotados, el piso actual, la posicion y la victoria sobre el
  Rey Esqueleto sobreviven al autoguardado y a la carga de ranura.
- Salir por ^ en el nivel 1 devuelve al punto seguro frente a la cripta; T no
  permite saltarse la progresion desde dentro.
- Revision visual real: entrada en la pradera, comienzo con slimes, nivel 2 y
  salon del trono del nivel 3 inspeccionados en renders 100x32.
- Verificado con pruebas de entrada, bloqueo/desbloqueo, tres pisos, victorias,
  persistencia y retorno. TODO: ninguno para esta primera version jugable.

## Portal del yermo y arena volcanica del world boss

- El Coloso Runico fue retirado completamente de la pradera abierta.
- Un portal runico `O` espera en el extremo nordeste del yermo, con espacio
  seguro para que los monstruos normales no tapen su entrada.
- Atravesarlo abre un mapa independiente de 128x44: suelo de ceniza, dos rios
  de lava, tres puentes por rio, edificios derruidos, columnas quebradas y altar.
- La lava y los muros destruidos tienen colision; los puentes conservan varias
  rutas comprobadas hasta el cuerpo del jefe para poder esquivar sus poderes.
- El Coloso conserva sus fases, animaciones, telegraphs, peligros y recompensa.
  Su vida y estado persisten al salir, reingresar, guardar y cargar.
- `O` devuelve al punto seguro frente al portal del yermo; `T` no permite
  saltarse ese regreso desde la arena.
- Revision visual real: portal exterior, llegada a las ruinas y combate junto al
  jefe inspeccionados en renders 100x32. Verificado con 122/122 pruebas y
  934/934 aserciones; lint limpio. TODO: ninguno para esta reubicacion.

## Fachada monumental de la cripta

- La antigua entrada de cinco caracteres fue reemplazada por una fachada de diez
  filas: techo quebrado, mamposteria, torreones, rotulo CRIPTA, calavera,
  antorchas, arco profundo, porton X y escalinata de piedra.
- El arte esta anclado al mismo `X` que activa la entrada; agrandarlo no cambio la
  transicion ni el punto seguro de regreso desde el nivel 1.
- La zona despejada alrededor crecio a quince celdas para que ninguna patrulla
  tape la silueta del edificio.
- Revision visual real en 100x32: fachada completa, rotulo, calavera, porton y
  heroe visibles con el caption de la cripta. Las ocho comprobaciones especificas
  de la entrada pasan y el lint esta limpio.
- Nota de suite: 123/124 pruebas pasan; la unica falla ajena a este cambio es la
  cota de malla, cuyo `hand: right` esta comentado como `roto a proposito` en el
  arbol de trabajo actual. TODO de esta fachada: ninguno.

## Rediseno documentado de los tres niveles de la mazmorra

- Se reemplazo la grilla repetida por tres plantas originales con identidad:
  cisternas del limo, galerias del osario y necropolis de la corona.
- El nivel 1 usa cavidades talladas, un deposito inundado, puentes de piedra y
  una camara de desborde; el nivel 2 combina canteras, cursos de huesos, pilares,
  sarcofagos y una lampara sepulcral; el nivel 3 tiene nave, rotonda, capillas,
  doble acceso ceremonial y salon del trono.
- La inspiracion y su traduccion jugable quedaron documentadas en
  `docs/dungeon-design.md`: deposito subterraneo de UNESCO, Catacumbas de Paris,
  necropolis y Rotonda de los Valois de Saint-Denis, y el principio de rutas con
  bucles de The Alexandrian. Ningun plano historico se copia literalmente.
- Los monstruos tienen posiciones curadas segun el espacio: slimes cerca del
  agua, arqueros en galerias largas y elites guardando la ruta al Rey Esqueleto.
- Una prueba recorre cada planta desde la entrada y exige que destino y todos
  los encuentros sean accesibles; tambien protege sus motivos y planos unicos.
- Verificado con 125/125 pruebas y 1002/1002 aserciones correctas.

## Fuente ceremonial de la plaza

- La fuente plana fue reemplazada por un monumento de diecinueve filas: heroe
  coronado con rostro y emblema, copa superior, segundo plato, cuatro cascadas,
  gran estanque inferior y basamento rotulado `heroes runa`.
- El agua ahora recorre cuatro fases de altura en lugar de tres: cae primero de
  la copa superior, despues del plato intermedio y termina formando crestas en
  dos filas del estanque. Todas las fases conservan una huella de 66 celdas.
- El rotulo `plaza de los heroes` se integro al borde noroeste para que la nueva
  altura del monumento no lo tape; el area de ranking conserva su interaccion.
- Revision visual real de las cuatro fases en terminal y del plano estatico.
  Verificado con 125/125 pruebas, 1005/1005 aserciones, lint y smoke test limpios.
- TODO: ninguno para este rediseno.

## Entrada monumental al world boss

- El marco de 7x6 fue reemplazado por una fachada de 27x13 anclada al mismo
  nucleo `O`: cartel propio, pilonos gemelos quebrados, runas, camara de energia,
  basamento de piedra y grietas corruptas sobre el yermo.
- El portal se reubico unos pasos al sur para mostrar la silueta completa sin
  recortarla contra el borde norte del mapa.
- El nucleo pulsa en tres fases cada cinco ticks sin desplazar el punto de
  entrada ni alterar la persistencia del Coloso.
- El claro sin patrullas crecio de cinco a quince celdas y ahora cubre todo el
  monumento; el retorno desde las ruinas cae dentro de esa zona segura.
- Revision visual real de las tres fases en la pantalla 120x34 del juego.
  Verificado con 125/125 pruebas, 1011/1011 aserciones, lint y smoke test limpios.
- TODO: ninguno para esta entrada.

## Reinos rivales y elección de origen

- La creación de personaje permite elegir con izquierda/derecha entre RUNA,
  reino del alba, y NOX, reino enemigo, sin interferir con la escritura del nombre.
- El reino natal queda en el autoguardado y en el resumen de la ranura; partidas
  anteriores sin ese dato conservan RUNA como origen compatible.
- Un personaje de NOX nace en su plaza y reaparece en su propio templo al morir.
- NOX es un mapa explorable de 180x100 con ciudadela de obsidiana, plaza, templo,
  alquimia, forja, armería y refugio, todos conectados por caminos alcanzables.
- La frontera monumental del este de RUNA usa `N`; la del oeste de NOX usa `R`.
  Ambas son visibles, transitables y el regreso conserva el lado correcto del paso.
- El mensaje de bienvenida indica la dirección de la frontera desde cada origen.
- Revisión visual real en 100x30: selector de reino, nacimiento en NOX y los dos
  lados de la frontera. Verificado con 127/127 pruebas, 1039/1039 aserciones,
  lint limpio y smoke test de rutas `TODO OK`.
- TODO: ninguno para esta primera versión de los reinos rivales.

## Inventario, cinco ranuras y depósito del hogar

- La mochila tiene una pantalla propia accesible con `I` y muestra todos los
  objetos transportados, su ranura y si están equipados.
- El equipo se separó en cinco ranuras reales: mano izquierda, mano derecha,
  pecho, casco y botas. Arma, escudo y las tres protecciones pueden permanecer
  equipados y aportar estadísticas al mismo tiempo en PvE y PvP.
- La tienda de armaduras ahora vende por categoría: escudo para la mano derecha,
  cuero/malla/placas para el pecho, botas para los pies y dos cascos nuevos.
- Interactuar con el hogar `C` abre el cofre personal. Sus pestañas permiten
  depositar desde la mochila o retirar; depositar equipo lo quita sin destruirlo.
- Mochila, equipo y depósito se guardan juntos. La migración v3→v4 mueve las
  armaduras antiguas de la mano derecha a su ranura corporal correspondiente.
- Cascos, armaduras, botas, armas y escudo tienen representación simultánea en
  el héroe compacto sin cambiar su colisión.
- Revisión visual real en 100x30 del inventario completo y del cofre con un arma
  depositada. Verificado en 64x16 y 80x24 para conservar el ancho de la terminal.
- Verificado con 128/128 pruebas y 1067/1067 aserciones; lint y smoke test limpios.
- TODO: ninguno para esta primera versión del inventario y depósito.

## Escaleras ASCII de la mazmorra

- Las transiciones aisladas `^` y `v` ahora forman parte de escalinatas de cinco
  filas, con peldaños en perspectiva y remates propios para cisterna, osario y
  necrópolis real.
- Se conservaron las coordenadas interactivas y se apartaron los enemigos que
  tapaban los accesos en los niveles 1 y 2.
- Las pruebas de conectividad ahora exigen tanto rutas transitables como una
  escalera completa y varios peldaños visibles en cada acceso.
- Revisión visual de los cinco accesos en ventanas reales de 36x12. Verificado
  con 128/128 pruebas, 1077/1077 aserciones, lint y smoke test limpios.
- TODO: ninguno para este rediseño.

## Botón y lista de controles

- El menú principal incorpora una opción seleccionable `CONTROLES` y todas las
  vistas de juego muestran el botón ASCII `[? CONTROLES]` en el pie.
- `?` abre una ayuda superpuesta de dos columnas con exploración, combate,
  interfaces y acciones generales; `Esc`, `?` o `Enter` vuelven al estado previo.
- La ayuda bloquea las acciones del mundo mientras está abierta y cabe completa
  tanto en 80x24 como en el mínimo admitido de 64x16.
- Verificado con 129/129 pruebas, 1095/1095 aserciones, lint y smoke test limpios.
- TODO: ninguno para esta ayuda.

## Portones de los reinos en la pradera

- El símbolo aislado `<` del borde oeste fue integrado en una fachada ASCII de
  trece filas, rotulada `REINO DE RUNA`, con torres, muralla y portón.
- Se añadió la entrada oscura de NOX en la punta opuesta: su celda `N` está
  exactamente en el borde este de la pradera y abre el mapa del reino enemigo.
- Ambos accesos tienen interiores visualmente limpios, caption de proximidad y
  una explanada rectangular donde no pueden aparecer ni patrullar monstruos.
- Al salir de RUNA, el registro indica que RUNA queda al oeste y NOX al este.
- Las pruebas verifican posición extrema, arte completo, áreas seguras y viaje
  real al reino oscuro.
- Revisión visual real de ambos extremos en 100x30. Verificado con 130/130
  pruebas, 1109/1109 aserciones, lint y smoke test limpios.
- TODO: ninguno para estos accesos.

## Acceso visible al inventario

- Ciudad, pradera, dungeon y world boss muestran primero el botón permanente
  `[I INVENTARIO]`, junto al botón de controles.
- `I` abre la mochila y dentro aparece `[I / ESC CERRAR]`; una instrucción fija
  en el panel indica `ENTER equipar` y `X quitar` aunque el pie sea recortado.
- La vista conserva todos los botones y acciones esenciales en el tamaño mínimo
  de terminal de 64x16.
- Revisión visual real de ciudad e inventario en 64x16. Verificado con 130/130
  pruebas, 1117/1117 aserciones, lint y smoke test limpios.
- TODO: ninguno para la visibilidad del inventario.

## Combate con el arma realmente equipada

- La estrategia inicial dejó de sustituir silenciosamente cualquier arma por
  una espada o ballesta: cada pelea comienza y continúa con la pieza elegida en
  `I INVENTARIO`.
- Las instalaciones que todavía conservan exactamente la estrategia inicial
  antigua se migran a la nueva sin sobrescribir estrategias personalizadas.
- Las reglas `equip` siguen permitiendo tácticas avanzadas, pero ahora pasan por
  el inventario real y rechazan cualquier arma que el jugador no posea.
- El registro de daño identifica el arma usada, por ejemplo
  `pegas 4 con lanza de guerra`, para que la elección sea visible al atacar.
- Pruebas de regresión cubren lanza, arco largo, daño propio y el rechazo de una
  espada no poseída. Verificado con 132/132 pruebas, 1134/1134 aserciones,
  lint y smoke test de mapas limpios.
- TODO: ninguno para la selección de arma en combate.

## Coordenadas visibles del mundo

- La ficha incorpora una referencia permanente `X:n Y:n` que se actualiza con cada
  paso del personaje sin ocupar celdas ni dejar marcas sobre el mapa.
- Cada posición incluye una referencia corta del área: RUNA, NOX, castillo,
  ruinas, coliseo, pradera, yermo, nivel de dungeon o world boss.
- Las coordenadas continúan visibles durante combates e interfaces que conservan
  la ficha, de modo que un lugar puede reportarse con precisión en cualquier
  momento.
- La regresión recorre ciudad y pradera y comprueba tanto el cambio de X/Y como
  el nombre de la zona. Verificado con 133/133 pruebas y 1141/1141 aserciones.
- TODO: ninguno para esta primera referencia cartográfica.

## Separación de la cripta, el portal y NOX

- La cripta dejó el borde oriental: su entrada pasó de `X:144 Y:43` a
  `X:88 Y:43`, en el sector sur interior del mapa.
- El portal del Coloso pasó de `X:146 Y:12` a `X:112 Y:12`, en el norte-central
  del yermo.
- El portón de NOX permanece en `X:159 Y:26`; ahora lo separan 71 columnas de
  la cripta y 47 del portal, mientras los dos accesos especiales conservan 24
  columnas entre sí.
- Las áreas sin monstruos, las transiciones, los puntos seguros de retorno y
  las animaciones del portal siguen anclados a sus nuevas coordenadas.
- Las pruebas exigen separación respecto de NOX y entre ambos monumentos.
- Revisión visual de los tres sectores completada. Verificado con 133/133
  pruebas, 1144/1144 aserciones, lint y smoke test de mapas limpios.
- TODO: ninguno para esta reubicación.

## Reino élfico oscuro de NOX

- Investigación previa documentada en `docs/nox-design.md`: arquitectura gótica
  del Met, asentamientos rupestres de Göreme/UNESCO y hongos bioluminiscentes
  descritos por Kew Gardens.
- La explanada de grava se convirtió en una capital excavada con Palacio del
  Eclipse explorable, corte lunar, jardín luminiscente, Mercado Velado, barrio
  de linajes y talleres especializados.
- Agujas, arcos apuntados, pináculos volcánicos, estanques y hongos animados le
  dan una silueta propia sin copiar una ciudad de otra franquicia.
- Se añadieron seis habitantes de NOX con oficio, diálogo y servicios: una
  centinela, un micólogo, un mercader, una sacerdotisa, un forjador y una armera.
- Dos avenidas y caminos de tres celdas mantienen conectadas la frontera y las
  puertas `C`, `I`, `P`, `A` y `D`; el jardín incorpora puentes transitables.
- Revisión visual real en 100x30 del barrio de linajes y del jardín con NPC y
  animación. Verificado con 134/134 pruebas, 1166/1166 aserciones, lint y smoke
  test de mapas limpios.
- TODO: ninguno para esta primera reconstrucción del reino.

## Capital compacta de RUNA y camino real

- Investigación previa documentada en `docs/runa-design.md`: plazas de mercado,
  ejes procesionales, recintos fortificados, caminos hundidos, parcelas y lindes
  tomados de fuentes de Historic England, English Heritage y UNESCO.
- La ciudad mantiene su grilla `320x200` y las coordenadas de cada puerta, pero
  los edificios civiles bajaron a `31x21`–`45x24`; el castillo ahora ocupa
  `96x42` y sigue dominando la avenida sin cubrir todo el distrito.
- RUNA incorpora paseo de la corona, mercado del alba, consejo, archivo y dos
  jardines identificables. Pregonero, panadera y cartógrafo elevan la población
  a trece NPC con oficios y diálogos ligados a cada barrio.
- La pradera se organiza con un camino real entre ambos reinos, ramales a la
  cripta y al portal, parcelas cercadas, surcos, claros y yermo pedregoso.
- Eira, guardabosques del camino real, aparece en un puesto propio, bloquea su
  celda como cualquier NPC y explica las cuatro rutas al interactuar con `E`.
- Capturas de ciudad y campo regeneradas desde el renderer real. Verificado con
  135/135 pruebas y 1180/1180 aserciones.
- Correccion final: los umbrales cierran sobre mamposteria real; el smoke test
  ya no encuentra celdas `nowhere` inmediatamente detras de las puertas.
- TODO: seguir poblando los barrios secundarios sin ampliar las fachadas.

## Escala monumental y fachadas de NOX

- El mapa de NOX pasa de `180x100` a `240x120` para ampliar edificios sin
  solaparlos ni sacrificar calles, mercado o jardín.
- Palacio del Eclipse `128x43`; alquimia, santuario, forja, casa y armería entre
  `48x30` y `64x30`, con agujas, contrafuertes, arcos y relieves por oficio.
- Puertas, NPC, animación bioluminiscente, spawn y caminos fueron reubicados en
  el nuevo plano manteniendo todos los servicios conectados.
- Captura real revisada en el santuario oriental y revisión textual del palacio:
  las fachadas ocupan la escala prevista y el jugador permanece fuera del muro.
- Resultado: 135/135 pruebas, 1193/1193 aserciones, smoke y lint limpios.
- TODO: ninguno para la corrección de escala de NOX.

## Pradera ampliada y asentamientos bárbaros

- Pradera ampliada a `260x72` con tres empalizadas separadas y zonas de
  exclusión para los monstruos errantes.
- Cada `J` abre un mapa interior `108x46` con tiendas, casa del caudillo,
  almacenes, corral, forja, fogata y tres clases de bárbaros.
- Salir antes de limpiar conserva el asentamiento. Limpiarlo y cruzar `U`
  acredita `45`, `70` o `100` de oro, elimina la fachada y persiste el resultado.
- Diseño contrastado con Old Oswestry, High Knowes, Maiden Castle y Bratton Camp;
  fuentes y traducción documentadas en `docs/barbarian-settlements.md`.
- Capturas reales revisadas: la empalizada exterior muestra su puerta `J` y el
  interior enseña casa del caudillo, tiendas, fogata, almacenes y patrullas.
- Resultado final: 139/139 pruebas, 1243/1243 aserciones, smoke y lint limpios.
- TODO: ninguno para los asentamientos bárbaros.

## Fondo de pradera menos invasivo

- La densidad de símbolos del terreno bajó aproximadamente del `38%` al `19%`,
  conservando diferencias regionales sin tapar edificios, monstruos ni portales.
- La hierba secundaria usa verde tenue y las piedras gris; el amarillo queda
  reservado principalmente para los caminos y mantiene clara la navegación.
- El interior de los asentamientos también usa una textura de suelo espaciada,
  por lo que tiendas, fogata, patrullas y salidas dominan visualmente la escena.
- Se añadió una prueba de densidad para evitar que futuras iteraciones vuelvan a
  saturar el fondo y se regeneraron las tres capturas de la pradera.
- Resultado final: 139/139 pruebas, 1245/1245 aserciones, smoke y lint limpios.
- TODO: ninguno para esta mejora de legibilidad.

## Fachadas monumentales de NOX

- Alquimia y santuario pasan a `52x38`; forja, casa del linaje y armería crecen
  a `72x31`–`76x31`, sin solaparse con avenidas ni distritos públicos.
- Las superficies antes vacías ahora contienen motivos completos por oficio:
  portal lunar, laboratorio micelial, hojas y braseros, galería de linajes y
  caparazones de obsidiana.
- Las fachadas orientadas al norte dibujan el motivo principal junto a la
  entrada para que aparezca realmente en la cámara al acercarse desde la calle.
- El Palacio del Eclipse reemplaza el relleno uniforme por cuatro torres largas,
  dos niveles de ventanales, portal central y galerías laterales.
- Se regeneraron e inspeccionaron capturas del santuario, palacio y barrio de
  oficios. Las pruebas exigen ahora escala y al menos 900 marcas arquitectónicas
  dentro de cada fachada.
- Resultado final: 139/139 pruebas, 1255/1255 aserciones, smoke y lint limpios.
- TODO: ninguno para este rediseño de NOX.

## Reconstrucción total de NOX con la modalidad urbana de RUNA

- El plano anterior de `240x120` y sus recintos gigantes dejó de ser el mapa
  activo y se eliminó su generador legado de `lib/map.js`.
- El nuevo `lib/nox.js` construye desde cero una capital exterior de `320x200`,
  igualando a RUNA en escala, avenida central, tres calles transversales,
  callejones, manzanas, jardines, plaza, mercado y edificios a pie de calle.
- Palacio `96x42` y seis servicios de `31x21` a `45x24`: santuario, hogar,
  posada, alquimia, forja y armería. Todos conservan arte y función propios.
- Spawn, frontera `R`, NPC, animación de hongos y rutas fueron reubicados en la
  nueva grilla. Las siete puertas quedan conectadas desde la plaza.
- Se sustituyeron las pruebas de gigantismo por comprobaciones de equivalencia
  urbana con RUNA, escala exterior, tres avenidas completas y accesibilidad.
- Capturas del centro cívico, palacio y forja regeneradas e inspeccionadas.
- Resultado final: 139/139 pruebas, 1258/1258 aserciones, smoke y lint limpios.
- TODO: ninguno para la reconstrucción del mapa de NOX.

## Fondos urbanos menos invasivos

- RUNA y NOX incorporan una celda de suelo caminable que el renderer representa
  vacía; las colisiones conservan terreno real sin llenar la pantalla de signos.
- El adoquín, la hierba y las flores quedan como textura irregular dispersa. La
  densidad visible final es `5.7%` en RUNA y `5.0%` en NOX.
- Patios, jardines, plazas y márgenes de edificios usan el mismo criterio; las
  avenidas continúan dibujadas con puntos para sostener la navegación.
- Se añadió una prueba que exige más de la mitad del fondo silencioso, menos de
  `12%` de textura y confirma que las celdas visualmente vacías son caminables.
- Capturas de RUNA, centro de NOX, palacio y forja regeneradas e inspeccionadas.
- Resultado final: 140/140 pruebas, 1264/1264 aserciones, smoke y lint limpios.
- TODO: ninguno para la limpieza de fondos urbanos.
