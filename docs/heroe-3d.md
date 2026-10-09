# Runa en 2.5D

La pagina `/heroe` del visor es Runa en el navegador: el juego entero de la
terminal corre dentro de la pagina y se ve en 3D. Camina el heroe de Tripo, con
esqueleto y animaciones de Higgsfield (ver "El heroe animado"), por la version
3D de los mapas ASCII; el inventario, las tiendas, la pradera y el combate se ven
con la pantalla de texto del juego. La pagina abre con un menu de titulo: el
Coloso de Tripo gira detras del heroe, como en el menu de la terminal.

La misma pagina se publica como sitio estatico en GitHub Pages, en ingles. Ver
"Sitio web" abajo.

Las reglas del juego no cambian: es `lib/` sin tocar, empaquetado para el
navegador. Lo unico nuevo en `lib/` son traducciones en `lib/locales/en.json`.
`bin.mjs` suma una opcion, `--teclas`, para que la pagina siga al juego de la
terminal; sin ella el juego queda igual que antes.

[Video narrado en ingles del recorrido en el navegador (MP4, 78 segundos)](demo/runa-tripo-browser-en.mp4):
los cuatro modelos de Tripo, dos tramos de la terminal ASCII y juego real en la
vista 2.5D (el heroe en la ciudad, el yelmo equipado y el Coloso entre la lava).

## El menu

| Opcion                   | Que hace                                                                        |
| ------------------------ | ------------------------------------------------------------------------------- |
| Continue                 | sigue la ultima partida de este navegador                                       |
| New game                 | nombre y reino (RUNA o NOX); con las tres ranuras llenas, elige cual reemplazar |
| Load game                | las tres ranuras, y en el visor local tambien las partidas de la terminal       |
| Follow the terminal game | solo en el visor local, con el juego abierto con `--teclas`                     |
| Explore the 3D world     | el recorrido libre: el mundo 3D sin reglas, para mirar los modelos de Tripo     |
| Settings                 | idioma, correr o caminar, camara lejos o cerca, sombras                         |
| Controls                 | las teclas                                                                      |

Las opciones se guardan en este navegador. El idioma cambia la pagina, la
pantalla de texto del juego y los carteles, puertas y NPC del mapa 3D.

## Jugar

El juego empaquetado (`juego.js`) es `lib/game.js` con su `SaveStore`, en el
mismo `Program` de bare-tui que usa la terminal. `scripts/build-juego.js` lo arma
con esbuild y cambia solo la plataforma (`scripts/navegador/`):

| Paquete de Bare                       | En el navegador                                                    |
| ------------------------------------- | ------------------------------------------------------------------ |
| `bare-fs`                             | `localStorage`, con prefijo `runa:fs:` (memoria si esta bloqueado) |
| `bare-path`                           | `join` posix                                                       |
| `bare-https`                          | `fetch`: la semilla del dia sigue saliendo de Stellar testnet      |
| `bare-tty`                            | no hay terminal: las teclas llegan como `KeyMsg`                   |
| `net.js`, `hyperswarm`, `bare-crypto` | no cargan: el juego ya sabe jugar solo                             |
| `events`, `Buffer`                    | `bare-events` y un `Buffer` minimo inyectado                       |

`scripts/tripo-juego.js` es el borde: arranca el `Program` con un renderer que le
pasa cada cuadro a la pagina, manda teclas como las decodifica la terminal (Q y
Ctrl+C no se mandan: salir es cosa del menu) y describe el juego en marcha para
la vista 3D con `scripts/tripo-estado.js`, el mismo modulo que usa el visor para
describir un guardado. Las partidas se guardan en cada paso, como en la
terminal, en las tres ranuras de este navegador.

Lo que el mapa 3D no muestra se ve en la pantalla de texto del juego, con sus
colores: el inventario, las tiendas, la wallet, el ranking, la ayuda, un desafio,
el combate y las zonas sin mapa 3D (la pradera, los campamentos y la cripta).
Tab la muestra en cualquier momento. La letra se ajusta para que entren al menos
64 columnas y 18 filas, y el juego se acomoda al tamano que queda.

Esc abre el menu de la partida: volver, la estrategia de combate (el mismo
`script.txt` de la terminal, que el juego relee solo al cambiar), opciones,
controles y guardar y salir al titulo.

En la arena el juego marca en el piso 3D las celdas donde va a pegar el Coloso
(rojo, late) y lo que ya quema (naranja), y arriba va su barra de vida.

En el visor local, Load game ofrece copiar una partida de la terminal
(`/saves.json` y `/saves/slot-N.json`, solo lectura) a la misma ranura de la
pagina. Es una copia: la terminal sigue con la suya.

## Correr y esprintar

Se corre por defecto. Shift sostenido esprinta; si en Settings se elige caminar,
Shift corre. En una pantalla tactil el boton Run cambia entre correr y caminar.

| Paso      | Velocidad | Clip | Velocidad del clip |
| --------- | --------- | ---- | ------------------ |
| caminar   | 1,6 m/s   | Walk | 2,2 x              |
| correr    | 7 m/s     | Run  | 1,9 x              |
| esprintar | 9 m/s     | Run  | 2,25 x             |

Cada paso es una tecla para el juego, al ritmo del paso: una columna mide 0,5 m y
una fila 1 m, asi que corriendo van unas 14 columnas o 7 filas por segundo. En
diagonal van dos columnas por fila, que en el mapa es a 45 grados. Una tecla que
no movio al heroe (una pared, un NPC) no se repite enseguida, asi el registro no
se llena. En combate cada paso contra el monstruo es un golpe, y van de a uno
cada 0,3 s.

La velocidad de cada clip sale de medirlo: en los huesos de `heroe-anim.glb`, el
pie apoyado de `Walk` retrocede a 0,6 m/s y el de `Run` a 3,4 m/s con el heroe de
2,1 m. Con eso el pie no patina al correr; mas alla de 1,9 x el clip parece
adelantado, asi que al esprintar desliza un poco.

## Seguir a la terminal

```powershell
npm.cmd start -- --teclas
npm.cmd run tripo:viewer
```

Con `--teclas`, el juego crea `<carpeta de partidas>/../keys`, escribe ahi
`alive` cada segundo (el latido que el visor reporta como `listening` en
`/state.json`) y revisa la carpeta cada 40 ms. Si la pagina se abre con la
terminal escuchando, la sigue: el heroe camina hacia la celda del ultimo
guardado y la pagina le manda WASD o flechas, E, I, Enter, Esc y cualquier
letra. Cada tecla llega como un archivo y entra al juego por el mismo camino que
la terminal (`program.input`). Las teclas de una sesion anterior se descartan al
arrancar. Dos Esc seguidos vuelven al menu; si la terminal se cierra, la pagina
vuelve sola.

Solo la pagina del visor puede mandar teclas: el pedido lleva un header propio,
que obliga a cualquier otra web a un preflight que el visor no contesta, y su
Origin tiene que ser el del visor. Ctrl+C no esta en la tabla de teclas.

## Correrlo

```powershell
node scripts/tripo-viewer.js --fetch-lib
npm.cmd run tripo:viewer
```

`--fetch-lib` se corre una vez, con wifi. Baja model-viewer 4.3.1 y three.js
0.186.1 a `vendor/`, fuera de git, y rechaza cualquiera cuyo sha256 no coincida.
El visor empaqueta el juego al arrancar (esbuild es dependencia de desarrollo) y
lo vuelve a empaquetar si cambia algo de `lib/`; `node scripts/build-juego.js`
lo hace a mano en `vendor/runa-juego.js`.

## Que se ve

| Hueco         | En 3D                                                         |
| ------------- | ------------------------------------------------------------- |
| `izq` (armas) | daga, espada, lanza, martillo, arco largo o ballesta          |
| `der`         | escudo con runa                                               |
| `pecho`       | cuero, cota de malla o placas con hombreras                   |
| `casco`       | capucha de cuero, o el yelmo de hierro de Tripo (`yelmo.glb`) |
| `botas`       | botas de cuero                                                |

| Escena                        | Fondo                          |
| ----------------------------- | ------------------------------ |
| Menu de titulo                | El Coloso de Tripo y ceniza    |
| Ruinas volcanicas (`boss`)    | Mapa 3D, Coloso de Tripo       |
| Ciudades e interiores (`map`) | Mapa 3D                        |
| Pradera, campamentos, cripta  | La pantalla de texto del juego |

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
Chrome desde la consola con `runaView.tune('iron_helmet', { grow, lift, back })`.

## El heroe animado

`heroe-anim.glb` es el heroe de Tripo con esqueleto humanoide (24 huesos, de
`Hips` a los dedos de los pies) y tres clips: `Idle`, `Walk` y `Run`. Quieto
respira con `Idle`; al moverse pasa a `Run` o `Walk` segun el paso, con un
fundido de 0,18 s, y vuelve a `Idle` 170 ms despues del ultimo paso, asi no
parpadea entre celda y celda. Si el archivo no trae `Run`, corre con `Walk`
acelerado; si no esta, camina `heroe.glb` como antes, con el balanceo.

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
   `3d_rigging` le puso el esqueleto y `Casual_Walk` (8 creditos); otros dos
   `3d_rigging` sobre ese resultado agregaron `Idle` y `Run_02` (8 creditos cada
   uno). `Run_02` es una carrera erguida que va con espada y escudo; `RunFast`
   se inclina demasiado.
5. `glb_merge_anims.py` de las skills de Higgsfield junto los clips en un solo
   GLB de 1,6 MB, mas liviano que el original de 2,2 MB.

Total: 35 creditos de Higgsfield. El heroe original sigue en la estatua de la
plaza, en el ASCII de la terminal y como respaldo.

## El mundo en 3D

En la ciudad, NOX, el castillo, el Coliseo y la arena del Coloso, la pagina arma
ese mapa en 3D con el mismo arte ASCII y la tabla `TILES` del juego
(`scripts/tripo-mundo.js`, servido en `/mundo.js`; los mapas salen de
`/world/<id>.json`):

- Cada edificio cerrado del arte es una casa con techo, ventanas encendidas,
  postigos y puertas, o una fortaleza si es enorme. Todos los edificios de un
  mapa van en una sola malla.
- Lo que queda suelto sube por tramos de una fila: las murallas `#` a 3,4,
  cercos, mamposteria y adornos mas bajos.
- Las letras que el arte pinta en los edificios y carteles quedan como bloques
  con su letra. En ingles salen traducidas con `mapLabels` de `lib/locale.js`,
  que conserva el largo del cartel, asi que "mercado del alba" se lee "dawn
  market" en el mismo lugar.
- El suelo lleva el color y la textura de su caracter: calle, pasto, adoquines,
  grava. Hay arboles, matas, piedras, flores, agua y, en la arena, rios de lava.
- Cada puerta tiene una columna de luz y su nombre. Los NPC son dibujos de su
  tipo hechos con Higgsfield (`assets/npcs/`), con su nombre.
- La estatua de los heroes de la plaza es el heroe de Tripo (`heroe.glb`) y el
  Coloso de Tripo (`coloso.glb`) espera en su arena.

La camara sigue al heroe desde el sur, mirando al norte como la terminal, en una
vista 2.5D: lente cerrada y desde lejos (o mas cerca, en Settings). Con el mouse
se gira y se acerca. Una columna mide 0,5 y una fila 1: la celda de terminal es
el doble de alta que de ancha.

## Sitio web

Para quien no instala nada: https://bitcoindefi.github.io/runa/ abre el mismo
menu, en ingles. New game juega Runa entero en el navegador, con partidas que
quedan en ese navegador; Explore the 3D world es el recorrido libre, donde el
heroe corre por los mapas sin reglas, 1 a 6 cambian de lugar, E habla con los
NPC, I abre una mochila de ejemplo y H pone o saca el yelmo de Tripo.

```powershell
node scripts/tripo-viewer.js --fetch-lib
npm.cmd run web:build
```

`scripts/build-web.js` arma `out/web/` con las piezas que sirve el visor: la
pagina con `data-demo="1"` (sin visor: no hay terminal que seguir) y la
descripcion para la vista previa de un link, el juego empaquetado (`juego.js`),
`mundo.js`, los mapas en `world/`, three.js y model-viewer de `vendor/`, los GLB
de `assets/tripo/`, los dibujos de `assets/npcs/` y `.nojekyll`. Todo va con
rutas relativas, asi anda bajo `/runa/`. Los GLB y three.js se publican solo en
la rama `gh-pages`: `main` los sigue ignorando.

En un Chrome recien abierto el primer pedido puede fallar con "Failed to fetch";
la lista de modelos, los mapas, los GLB y el juego se reintentan antes de
rendirse (salvo una respuesta 4xx, que no va a cambiar).

En un celular la cruceta mueve al heroe (se puede deslizar el dedo de una flecha
a otra) y los botones de la izquierda son E, I, F, Esc, OK, correr o caminar, T,
la pantalla de texto y el menu. En una pantalla del juego, como una tienda, cada
toque de la cruceta mueve el cursor y sostenido se repite.

## Prueba

El 9 de octubre, con el juego en la pagina, en Chrome headless sobre la GPU y
con un visor y un almacenamiento de prueba (ninguna partida real se toco):

- Menu, partida nueva en RUNA y el heroe de Tripo en la ciudad.
- Correr 1,6 s con D: `Run` a 1,9 x y 14 columnas por segundo; con Shift,
  `Run` a 2,25 x y 18 por segundo.
- I abre el inventario en la pantalla de texto (147 x 37) y Esc lo cierra; Esc
  abre el menu de la partida.
- Al norte por el porton K se llega al castillo; por la salida al campo, a la
  pradera en la pantalla de texto, donde el heroe se mueve, y T vuelve.
- Guardar y salir al titulo, y Continue sigue donde quedo.
- En castellano cambian la ficha, el paso y los carteles; de vuelta en ingles.
- En las ruinas, la barra del Coloso, F para golpear: el Coloso bajo de 300 a
  286, su onda runica pego y el heroe desperto en la iglesia.
- El recorrido libre corre con `Run` y Esc vuelve al menu.

En un celular emulado (390 x 844, tactil): partida nueva en NOX, la cruceta corre
19 columnas en un segundo, el boton I abre el inventario (68 x 57, letra de
9 px), Esc lo cierra y el boton de menu abre el menu de la partida. La consola
no mostro errores en ninguna corrida.
