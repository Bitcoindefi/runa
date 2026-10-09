# Heroe 3D

La pagina `/heroe` del visor muestra al stickman de RUNA en 3D, vestido con el
equipo de la ultima partida guardada. Equipas algo en el inventario de la
terminal y aparece en el heroe 3D, con un aviso. Al entrar a las ruinas
volcanicas aparece el Coloso de Tripo y cae ceniza.

El stickman esta hecho con formas simples: no gasta creditos de Tripo y su mano
sirve de enganche para cualquier arma. El juego no cambia: no se toco `lib/` ni
`bin.mjs`.

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

`/state.json` devuelve el nombre, el nivel, el lugar, la escena y el equipo por
hueco. El visor lee la ranura solo cuando cambia y despues de 250 ms sin
cambios. En Windows, leerla justo cuando el juego la reemplaza puede hacer
fallar ese guardado: el juego avisa una vez en el log y guarda en la tecla
siguiente. Esa espera hace que casi no pase.

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

## Prueba

El 8 de octubre se probo en Chrome headless (SwiftShader) con la partida real y
con una partida de prueba, manejando una sola pagina abierta por CDP mientras
cambiaba el guardado: cambio de arma, casco, pecho y escudo con su aviso, y paso
de la ciudad a las ruinas. La consola no mostro errores.
