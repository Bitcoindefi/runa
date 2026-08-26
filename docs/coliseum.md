# Coliseo de Runa

Los duelos entre jugadores tienen un mapa propio: `MAPS.coliseum`. No usan la
pradera, el mapa del jefe mundial ni la arena abstracta del combate contra
monstruos.

## Contrato para integrar los duelos

Cuando ambos jugadores acepten el desafio, la capa de red debe colocarlos en
los puntos publicados por el mapa:

```js
const arena = MAPS.coliseum
const local = arena.duelSpawns[0]
const rival = arena.duelSpawns[1]

game.walker.placeAt('coliseum', local.x, local.y)
```

Cada punto incluye `id`, `x`, `y` y `facing`. Las posiciones oeste y este son
simetricas, transitables y miran hacia el centro. `refereeSpawn` reserva el
lugar del arbitro y `arenaBounds` delimita el campo que la logica de duelo debe
usar para impedir que un combatiente huya a las gradas.

La entrada normal aparece en el tunel sur. La baldosa `Q` es una salida de
seguridad que regresa a la ciudad; el sistema de duelo puede bloquearla mientras
la pelea este activa y devolver a cada jugador a su posicion previa al terminar.

## Arte y colisiones

- Resolucion: 128 por 52 celdas.
- `%`, `;` y `*`: arena transitable y marcas del campo.
- `#` y `+`: muros y portones solidos.
- `:`, `=`, `o` y el publico rotulado: gradas solidas.
- `.`: tunel sur transitable.
- `Q`: salida interactiva a la ciudad.

El mapa no implementa sincronizacion, reglas, apuestas ni dano PvP. Esas
responsabilidades quedan en el modulo de duelos; el Coliseo solo ofrece una
geometria estable y los puntos de integracion.
