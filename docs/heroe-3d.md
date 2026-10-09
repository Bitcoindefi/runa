# Heroe 3D

La pagina `/heroe` del visor muestra al stickman de RUNA en 3D, vestido con el
equipo de la ultima partida guardada. Equipas algo en el inventario de la
terminal y aparece en el heroe 3D, con un aviso. En los mapas camina el heroe de
Tripo, con esqueleto y animaciones de Higgsfield (ver "El heroe animado"), y
lleva el yelmo de Tripo cuando lo equipas. Al entrar a las ruinas volcanicas
aparece el Coloso de Tripo y cae ceniza.

La misma pagina se publica como sitio estatico en GitHub Pages, en modo demo:
ahi el heroe camina en el navegador, sin el juego. Ver "Sitio web" abajo.

El stickman esta hecho con formas simples: no gasta creditos de Tripo y su mano
sirve de enganche para cualquier arma. Las reglas del juego no cambian: no se
toco `lib/`. `bin.mjs` suma una opcion, `--teclas`, para recibir teclas de la
pagina; sin ella el juego queda igual que antes.

## Jugar desde el navegador

```powershell
npm.cmd start -- --teclas
npm.cmd run tripo:viewer
```

Con `--teclas`, el juego crea `<carpeta de partidas>/../keys` y la revisa cada
40 ms. La pagina manda WASD o flechas, E, I, Enter, Esc y cualquier letra; cada
tecla llega como un archivo y entra al juego por el mismo camino que la
terminal (`program.input`), asi que las reglas no cambian: el navegador solo
aprieta teclas. Las teclas de una sesion anterior se descartan al arrancar.

Solo la pagina del visor puede mandar teclas: el pedido lleva un header propio,
que obliga a cualquier otra web a un preflight que el visor no contesta, y su
Origin tiene que ser el del visor. Ctrl+C no esta en la tabla de teclas. Si el
juego no se arranco con `--teclas`, la pagina lo avisa.

Probado de punta a punta el 8 de octubre con el juego real en Windows: `n` y
Enter desde el visor crearon una partida en la ciudad, y seis `d` la movieron
seis celdas. Sin el header o desde otro Origin el visor responde 403.

## Correrlo

```powershell
node scripts/tripo-viewer.js --fetch-lib
npm.cmd run tripo:viewer
```

`--fetch-lib` se corre una vez, con wifi. Baja model-viewer 4.3.1 y three.js
0.186.1 (7 archivos) a `vendor/`, fuera de git, y rechaza cualquiera cuyo sha256
no coincida. Despues el visor imprime dos URL: `/` con los GLB y `/heroe` con el
stickman. Abrí `/heroe` al lado de la terminal del juego.

## De donde sale el estado

El juego reescribe la ranura en cada tecla (`saveCurrent` en `lib/game.js`). El
visor lee la ranura mas reciente de `%APPDATA%\runa\saves\slot-N.json`, la misma
carpeta que usa `bin.mjs`. En Linux es `~/.local/share/runa/saves` y en macOS
`~/Library/Application Support/runa/saves` (sin probar). Si el juego corre con
`--storage <dir>`, arrancá el visor con `RUNA_STORAGE=<dir>`.

`/state.json` devuelve el nombre, el nivel, el lugar, la escena, la celda del
mapa y el equipo por hueco. El visor lee la ranura cuando cambia, tras 40 ms que
juntan las rafagas: al caminar el juego guarda unas 15 veces por segundo. Leerla
no traba el guardado del juego: medido en Windows, un escritor con bare-fs
(`.tmp` y `renameSync` cada 66 ms, como `SaveStore`) contra lecturas de Node
cada 1 ms no fallo ningun rename en 127 guardados.

Con el guardado llegan el equipo y el mapa. Los golpes, la vida durante una
pelea y el jefe en tiempo real no: eso necesita el puente `--live` que propone
el memo de investigacion.

## Que se ve

| Hueco         | En 3D                                                         |
| ------------- | ------------------------------------------------------------- |
| `izq` (armas) | daga, espada, lanza, martillo, arco largo o ballesta          |
| `der`         | escudo con runa                                               |
| `pecho`       | cuero, cota de malla o placas con hombreras                   |
| `casco`       | capucha de cuero, o el yelmo de hierro de Tripo (`yelmo.glb`) |
| `botas`       | botas de cuero                                                |

| Escena                        | Fondo                       |
| ----------------------------- | --------------------------- |
| Ruinas volcanicas (`boss`)    | Coloso de Tripo y ceniza    |
| Ciudades e interiores (`map`) | Paisaje del reino de Tripo  |
| Pradera, campamentos, cripta  | Solo el suelo, con su color |

Un GLB llamado como el id del item en `assets/tripo/` (por ejemplo `spear.glb`
o `shield.glb`) reemplaza a la forma simple sin tocar codigo. Las armas se paran
sobre su eje mas largo y se toman a un tercio de la base. Los modelos de Tripo
llegan mirando hacia +x y el heroe mira hacia +z: el yelmo se gira 90 grados.
Para otro ajuste, la tabla `SKINS` de `scripts/tripo-heroe.html` recibe tamano,
giro y altura por item.

Lo que va en la cabeza tambien lo lleva el heroe de Tripo que camina. La pagina
mide la tapa de su cabeza en la malla (lo que queda en el 8% mas alto del
cuerpo; con esqueleto, sobre los vertices ya deformados) y la pieza la envuelve;
en el heroe animado la pieza cuelga del hueso `Head`, asi sigue la animacion.
`AVATARS[].fits` dice, por heroe, cuanto la envuelve (`grow`), cuanto sube su
techo (`lift`) y cuanto se corre hacia la nuca (`back`). El yelmo usa 1,5, 0,24
y 0,1 en el heroe animado y 1,55, 0,22 y 0,12 en el original, calibrados en
Chrome desde la consola con `runaView.tune('iron_helmet', { grow, lift, back })`:
asi la cara se ve por la abertura y no asoma la vincha.

## El heroe animado

`heroe-anim.glb` es el heroe de Tripo con esqueleto humanoide (24 huesos, de
`Hips` a los dedos de los pies) y dos clips, `Idle` y `Walk`. Quieto respira con
`Idle`; al caminar pasa a `Walk` con un fundido de 0,2 s, y vuelve a `Idle` un
cuarto de segundo despues del ultimo paso, asi no parpadea entre celda y celda.
Si el archivo no esta, camina `heroe.glb` como antes, con el balanceo.

Como se hizo, el 9 de octubre, con la CLI de Higgsfield:

1. El auto-rig de Higgsfield (`3d_rigging`) rechazo cuatro veces el heroe
   original (`heroe.glb`), incluso girado hacia +z, con su altura real y sin
   animacion: tiene el escudo sobre el torso y la espada pegada al cuerpo, y el
   rig pide los brazos separados. Los intentos fallidos se reintegran.
2. Con una vista del heroe original como referencia, Nano Banana Pro dibujo el
   mismo personaje en pose A, con las manos vacias (2 creditos).
3. Tripo H3.1, desde Higgsfield, la paso a 3D con hasta 10.000 caras y sin PBR
   (9 creditos). La malla sigue siendo de Tripo.
4. `node scripts/glb-orient.js` la dejo mirando hacia +z y parada en y = 0, y
   `3d_rigging` le puso el esqueleto y `Casual_Walk` (8 creditos); un segundo
   `3d_rigging` sobre ese resultado agrego `Idle` (8 creditos).
5. `glb_merge_anims.py` de las skills de Higgsfield junto los dos clips en un
   solo GLB de 1,5 MB, mas liviano que el original de 2,2 MB.

Total: 27 creditos de Higgsfield. El heroe original sigue en la estatua de la
plaza, en el ASCII de la terminal y como respaldo.

## El mundo en 3D

En la ciudad, NOX, el castillo, el Coliseo y la arena del Coloso, la pagina arma
ese mapa en 3D con el mismo arte ASCII y la tabla `TILES` del juego
(`scripts/tripo-mundo.js`, servido en `/mundo.js`; los mapas salen de
`/world/<id>.json`):

- Cada edificio cerrado del arte (un grupo lleno de paredes y relleno que no
  toca el borde) es una caja de 4,5 a 9 de alto, el doble a cuatro veces y media
  el heroe, con techo a dos aguas y ventanas encendidas por piso. Todos los
  edificios de un mapa van en una sola malla.
- Lo que queda suelto sube por tramos de una fila: las murallas `#` a 3,4,
  cercos, mamposteria y adornos mas bajos.
- Las letras que el arte pinta en los edificios y carteles quedan como bloques
  con su letra, asi que "mercado del alba" se lee en 3D. Una `o` o una `t`
  pegada a otras letras es letra, no piedra ni arbol.
- El suelo caminable lleva el color de su caracter: calle, pasto, adoquines,
  grava. Hay arboles, piedras, flores, agua y, en la arena, rios de lava.
- Cada puerta tiene una columna de luz y su nombre. Los NPC son stickmen del
  color que usa la terminal, con su nombre.
- La estatua de los heroes de la plaza es el heroe de Tripo (`heroe.glb`) y el
  Coloso de Tripo (`coloso.glb`) espera en su arena.

El heroe camina hacia la celda del guardado, con las piernas en movimiento, y la
camara lo sigue desde el sur, mirando al norte como la terminal, en una vista
2.5D: lente cerrada y desde lejos. Con el mouse se gira y se acerca. Una columna
mide 0,5 y una fila 1: la celda de terminal es el doble de alta que de ancha.

Medido en la ciudad: 88 llamadas de dibujo y unos 59.000 triangulos por cuadro.
Los NPC son tres mallas compartidas y la resolucion se limita a 1,5x. Mientras un
mapa se arma no se vuelve a pedir, aunque la consulta llegue cada 200 ms.

La pradera, los campamentos y la cripta todavia muestran la vitrina: el terreno
de la pradera sale de la semilla del dia, que el guardado no trae.

## Sitio web

Para quien no instala nada: https://bitcoindefi.github.io/runa/ sirve la misma
pagina en modo demo, en ingles. El heroe de Tripo camina con WASD o flechas
(en pantallas tactiles, con una cruceta por la que se puede deslizar el dedo),
1 a 6 cambian de lugar (ciudad, NOX, castillo, Coliseo, el Coloso y la vitrina
con el reino de Tripo) y H pone o saca el yelmo de Tripo. El link de abajo lleva
a la galeria de los modelos, donde el heroe animado camina.

Los choques son los del juego: en los mapas, la tabla `TILES` (`isSolid` de
`lib/map.js`) y los NPC (`npcAt` de `lib/game.js`); en las ruinas, `isWalkable`
de `lib/boss-zone.js` y el cuerpo del Coloso (`distanceToBody` de
`lib/world-boss-event.js`). Cada tecla es un paso de celda, a unos 5 m/s. Como
la terminal mueve un eje por vez, una diagonal solo pasa si una de las dos
celdas de al lado esta libre, y si choca se desliza por el eje libre. En las
ruinas, lo que el juego deja pisar se dibuja al ras, como escombro, y el heroe
llega a 10 m del Coloso.

En un celular el texto de arriba lleva fondo y los lugares van en una fila que se
desliza, con botones de 44 px; los links quedan a la izquierda de la cruceta y
los avisos por encima. En una pantalla vertical la lente vertical se abre hasta
que el ancho visible vuelve a ser el de la base, para que el Coloso entre en
cuadro.

```powershell
node scripts/tripo-viewer.js --fetch-lib
npm.cmd run web:build
```

`scripts/build-web.js` arma `out/web/` con las piezas que sirve el visor: las
dos paginas con `data-demo="1"` y sus textos fijos ya en ingles (tambien la
descripcion para la vista previa de un link), `mundo.js`, los mapas en `world/`, three.js y
model-viewer de `vendor/`, los GLB de `assets/tripo/` y `.nojekyll`. Todo va con
rutas relativas, asi anda bajo `/runa/`. Los GLB y three.js se publican solo en
la rama `gh-pages`: `main` los sigue ignorando. Para probar el modo demo sin
publicar, abri `/heroe?demo` en el visor local.

En un Chrome recien abierto el primer pedido puede fallar con "Failed to fetch";
la lista de modelos, los mapas y los GLB se reintentan antes de rendirse (salvo
una respuesta 4xx, que no va a cambiar), porque sin la lista no aparece ningun
modelo de Tripo. En el modo en vivo, si la lista llega tarde, el heroe de Tripo
se carga en ese momento y no recien al cambiar de mapa.

## Prueba

El 8 de octubre se probo en Chrome headless (SwiftShader) con la partida real y
con una partida de prueba, manejando una sola pagina abierta por CDP mientras
cambiaba el guardado: cambio de arma, casco, pecho y escudo con su aviso; la
plaza de RUNA, doce pasos al este, la arena del Coloso, el salon del trono y la
vuelta a la pradera. La consola no mostro errores.

El 9 de octubre el sitio se probo servido bajo `/runa/`, como en GitHub Pages,
en Chrome headless sobre la GPU y con un perfil nuevo por corrida: el heroe de
Tripo aparece en la ciudad, H le pone el yelmo, camina diez celdas al este y
cuatro o cinco al sur, carga cada mapa, en las ruinas se frena contra el cuerpo del
Coloso (celda 92) y la galeria carga los cuatro GLB. En dos de tres corridas el
primer pedido de `models.json` fallo y el reintento lo recupero.

Despues, tres verificadores independientes probaron el sitio publicado en un
celular emulado, el modo en vivo con el juego y el codigo. Lo que encontraron
quedo corregido: el heroe ya no atraviesa NPC ni bloques de las ruinas, la
diagonal no se cuela entre paredes, un fondo de la vitrina ya no queda duplicado
al cambiar rapido de lugar, el aviso de equipar no se pierde si el heroe termina
de cargar en ese momento, y en el celular los links y los avisos ya no quedan
bajo la cruceta. Con el heroe animado, en un celular emulado (390 x 844, tactil)
la cruceta lo mueve diez celdas, deslizar el dedo a la flecha de abajo cambia la
direccion, los dos links se pueden tocar y el Coloso se ve al llegar a las ruinas.
