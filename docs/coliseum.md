# Coliseo de Runa

Los duelos entre jugadores tienen un mapa propio: `MAPS.coliseum`. No usan la
pradera, el mapa del jefe mundial ni la arena abstracta del combate contra
monstruos.

## Contrato para integrar los duelos

Cuando ambos jugadores acepten el desafio, la capa de red entrega las dos
identidades y el bloque de estadisticas que revelo cada participante:

```js
game.startDuel(rival, {
  selfId: localPeerId,
  rivalId: rivalPeerId,
  rivalStats
})
```

`Duel` calcula los lados sin negociacion y toma las coordenadas directamente de
`MAPS.coliseum.duelSpawns`. Cada punto incluye `id`, `x`, `y` y `facing`. Las
posiciones oeste y este son simetricas, transitables y miran hacia el centro.
`refereeSpawn` reserva el lugar del arbitro y `arenaBounds` encierra a los dos
combatientes en el campo.

La entrada normal aparece en el tunel sur. La baldosa `Q` es una salida de
seguridad que regresa a la ciudad; el sistema de duelo puede bloquearla mientras
la pelea este activa. Rendirse, perder o desconectarse devuelve a cada jugador
a la posicion exacta que se guardo antes de entrar. Un autoguardado hecho en
medio del duelo tambien conserva esa posicion segura, nunca una sesion huerfana.

## Combate PvP local

`DuelCombat` es una maquina de estado determinista. Con la misma secuencia
ordenada de movimiento, ataque y ticks produce el mismo resultado en los dos
peers. Las reglas actuales son:

- `WASD` o flechas mueven dentro de `arenaBounds`.
- `F`, Espacio o Enter atacan.
- `R` o Escape rinden al jugador local.
- La vida, ataque, defensa, alcance y enfriamiento salen del equipo revelado.
- La defensa reduce cada golpe con un minimo de un punto de dano.
- Atacar fuera de alcance falla y consume el enfriamiento.
- La distancia se mide entre los cuerpos ASCII, no entre sus anclas, para que
  dos stickmans no tengan que superponerse antes de que una espada conecte.
- El dano PvP vive solo en la sesion: no reduce la vida persistente usada por
  monstruos y jefe mundial.

La vista muestra vida de ambos, direccion del rival, distancia/alcance y estado
del enfriamiento. Los dos participantes usan el stickman compacto con su
inicial y el equipo que realmente llevan.

## Transporte P2P conectado

Un jugador cercano se desafia con `E`. El receptor acepta con Enter o rechaza
con `N`. Los mensajes son dirigidos por id de sesion, tienen proteccion contra
repeticiones y se descartan si llegan desde otra conexion o para otro peer.

El peer cuyo id es menor actua como reloj y ordena `intent` en pasos numerados.
Solo esa secuencia modifica `DuelCombat`; el invitado no predice dano ni
movimiento. Ticks, desplazamiento, ataque y rendicion cruzan el mismo camino,
por lo que ambos extremos reproducen el mismo resultado. El silencio de un peer
libera al otro del Coliseo y lo devuelve a su posicion anterior.

El resultado local no paga apuestas por si solo. El contrato Soroban de
`contracts/duel-arena` recibe revelaciones y declaraciones de ganador, resuelve
consenso y liquida la apuesta por separado. Para esa etapa falta desplegar el
contrato y conectar un firmante externo; la interfaz actual nunca almacena una
clave secreta. Ver `docs/wallet.md`.

## Arte y colisiones

- Resolucion: 128 por 52 celdas.
- `%`, `;` y `*`: arena transitable y marcas del campo.
- `#` y `+`: muros y portones solidos.
- `:`, `=`, `o` y el publico rotulado: gradas solidas.
- `.`: tunel sur transitable.
- `Q`: salida interactiva a la ciudad.

El mapa no implementa sincronizacion, reglas, apuestas ni dano PvP. Esas
responsabilidades quedan en `lib/duel.js`; el Coliseo solo ofrece una geometria
estable y los puntos de integracion.
