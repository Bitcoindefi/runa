# Primer jefe mundial: Coloso Rúnico

El Coloso Rúnico es una presencia fija del yermo, no otro monstruo de patrulla. Su función es reunir jugadores alrededor de un objetivo compartido sin mezclar el evento con los duelos entre jugadores.

## Silueta de campo

```text
               ___/^^R^^\___
             .-'../_____\..'-.
           /___/|.[#].[#].|\___\
           |....|....^....|....|
   (O)===  |....|..===...|....|  ===(O)
[###]---\_  \____|_\___/_|____/  _/---[###]
            [|.....<.R.>.....|]
             |===============|
            /|===============|\
           /.|...../|.|\.....|.\
        __/..|..../_|.|_\....|..\__
        /___/|.._/./...\.\_..|\___\
       /____/.|_/_/.....\_\_|.\____\
```

Mide 43 × 13 caracteres frente al héroe de 8 × 3. Es una excepción deliberada: tiene escala de monumento, pero permanece sobre el altar quebrado y no recorre el mapa tapando caminos.

## Brazos de ataque

El sprite tiene seis cuadros sobre el mismo lienzo de 43 × 13: reposo, puño izquierdo, puño derecho, barrido, preparación vertical e impacto contra el suelo. Los espacios transparentes y el tamaño fijo permiten cambiar de pose sin empujar columnas ni dejar residuos en el terreno.

- `Puño de piedra` extiende el brazo izquierdo hasta el jugador.
- `Revés de piedra` refleja la misma lectura desde la derecha.
- `Onda rúnica` abre ambos brazos antes de golpear a distancia.
- `Barrido del guardián` recorre izquierda, centro y derecha.
- `Colapso rúnico` levanta un puño de roca y lo descarga contra el suelo.

## Poderes sobre el campo

La pelea no bloquea el desplazamiento del jugador. Mientras el Coloso prepara un ataque, se puede seguir usando WASD para salir de su trayectoria y `F` para golpear cuando el arma tenga alcance.

- La cara, los ojos y la runa del pecho laten entre dos cuadros de reposo.
- `Onda rúnica` crea ocho ondas `~` que viajan en todas las direcciones y quitan 6 de vida al tocar al héroe.
- `Barrido del guardián` lanza cinco líneas `=` paralelas hacia el lado donde se encontraba el jugador y quita 11 de vida.
- Los puños disparan una descarga corta `#` apuntada a la fila del jugador y quitan 9 de vida.
- `Colapso rúnico` libera poderes `*` en ocho direcciones y quita 15 de vida.
- Cada poder ocupa una coordenada real, avanza un paso cada dos ticks y desaparece después de impactar. No existe daño invisible fuera del dibujo.
- Después de recibir daño hay una breve protección de ocho ticks para impedir que varias partes de la misma onda descuenten vida simultáneamente.

Durante el evento, la cámara encuadra al héroe y al jefe juntos siempre que entren en la consola. El terreno y los actores usan el mismo desplazamiento de cámara, evitando que el arte se deslice sobre coordenadas incorrectas.

Si el jugador se aleja del altar, el Coloso deja de lanzar ataques y limpia los poderes que todavía viajaban por el mapa. Conserva la vida restante para poder retomar el evento sin recibir daño fuera de pantalla.

## Lectura del combate

- `Piedra dormida` enseña tres ataques: ambos puños cercanos y una onda lenta de largo alcance.
- `Runa fracturada`, desde 66 % de vida, pierde defensa y agrega un barrido de alcance medio.
- `Núcleo expuesto`, desde 30 %, pega más fuerte y prepara un colapso muy visible de tres turnos.
- Los ataques avanzan con turnos de entrada, no con redibujados temporizados. Esto conserva la solución usada para evitar que el movimiento rompa las líneas de la consola.
- El jefe permanece anclado. Su tamaño es visual; su punto lógico está en el centro de los pies.

## Contrato multijugador

La vida del jefe debe tener una sola autoridad por evento y replicarse como `{spawnId, hp, phase, revision}`. Cada daño aceptado incrementa `revision`; los pares descartan estados anteriores para no curar accidentalmente al jefe por mensajes fuera de orden.

La contribución se registra por jugador, pero el oro y la experiencia se entregan una sola vez por `spawnId`. En el guardado personal sólo queda el identificador de la recompensa reclamada. La vida global del jefe no pertenece a una ranura de partida.

Los duelos y el jefe usan sesiones distintas. Un jugador en duelo no puede infligir daño al jefe; al terminar vuelve a recibir la última revisión global. Abandonar o perder un duelo nunca reinicia el evento mundial.

La definición consumible está en `lib/world-boss.js`. Se mantiene separada de `CONTENT.foes` para impedir que el generador de la pradera lo cree como enemigo aleatorio.
