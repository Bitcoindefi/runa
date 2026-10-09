# Heroe 3D

La pagina `/heroe` del visor muestra al stickman de RUNA en 3D, vestido con el
equipo de la ultima partida guardada. Equipas algo en el inventario de la
terminal y aparece en el heroe 3D, con un aviso. Al entrar a las ruinas
volcanicas aparece el Coloso de Tripo y cae ceniza.

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

## Prueba

El 8 de octubre se probo en Chrome headless (SwiftShader) con la partida real y
con una partida de prueba, manejando una sola pagina abierta por CDP mientras
cambiaba el guardado: cambio de arma, casco, pecho y escudo con su aviso; la
plaza de RUNA, doce pasos al este, la arena del Coloso, el salon del trono y la
vuelta a la pradera. La consola no mostro errores.
