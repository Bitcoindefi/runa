# contracts/

Los contratos Soroban de runa. Rust, no JavaScript, porque corren en la red y no
en la maquina del jugador.

```
medicion/   cuanto cuesta rehacer una pelea adentro de un contrato
jefe/       el jefe del mundo: la unica autoridad sobre su vida
```

## Por que existe esto

`lib/net.js` dice de si mismo, en su primer comentario:

> No hay estado compartido, no hay autoridad, no hay historia.

Eso alcanza para verse caminar el mismo pueblo, y no alcanza para un jefe con
vida compartida ni para apostar. Alguien tiene que decir cuanta vida le queda al
jefe y que todos le crean, y ese alguien no puede ser un jugador.

`docs/world-boss.md` lo pide con esas palabras: _"La vida del jefe debe tener una
sola autoridad por evento"_. Estos contratos son esa autoridad.

## La decision de diseno que ordena todo

**El contrato no le cree a nadie: calcula.**

El problema de un jefe compartido no es guardar un numero, es que el jugador que
dice "le hice 900 de dano" no pueda mentir. Las salidas habituales son creerle
(malo), pedir una prueba de conocimiento cero (caro), o abrir una ventana de
disputa con fianzas (economico, no matematico).

runa permite la salida buena, y por un motivo concreto: **el lenguaje de guiones
no tiene bucles ni recursion**, asi que una pelea tiene un techo de ticks
conocido de antemano y su costo esta acotado. Entonces el contrato puede rehacer
la pelea el mismo.

Que eso entre en el presupuesto no es una suposicion. Esta medido sobre wasm de
verdad, que es lo que corre la red:

```
cada tick                     3.708 de cpu
una pelea de 900 ticks    3.583.664      3% del presupuesto
un duelo, dos peleas      6.917.601      6% del presupuesto
```

Queda margen de catorce veces. El contrato `medicion` es esa medicion, y se
queda en el repositorio como prueba viva: si alguien encarece un tick, su test se
pone rojo.

## La trampa que casi arruina esa medicion

`env.register(Contrato, ())` corre el contrato como Rust nativo, y entonces el
medidor de presupuesto **no ve el bucle**: da el mismo numero para un tick que
para novecientos, porque lo unico que cuenta es el costo de invocar. La primera
medicion dio 17.907 para las dos cosas y parecia buenisima.

Para medir de verdad hay que registrar el wasm con `contractimport!`. El test
`el_costo_crece_con_los_ticks` existe para que eso no vuelva a pasar sin que nos
enteremos.

## La deuda pendiente, dicha de frente

`jefe/src/fight.rs` es la **forma** del combate de runa, no su motor. El motor
vive en `lib/world.js` y `lib/script.js` y son unas quinientas lineas. Mientras
no se porten, el dano que calcula el contrato y el que calcula el juego **no
coinciden**.

Eso no se arregla leyendo los dos archivos y convenciendose: se arregla con un
test cruzado que corra la misma semilla en JavaScript y en Rust y compare. Hasta
que ese test exista y este verde, esto sirve para probar el diseno y no para
repartir premios de verdad.

## Como se corre

```
cargo test -p jefe
cargo test -p medicion -- --nocapture     # imprime la tabla de costos
cargo build --target wasm32v1-none --release
```

`wasm32v1-none` y no `wasm32-unknown-unknown`: soroban-sdk 27 rechaza el segundo
en Rust 1.82 o mayor.
