# Combate: reglas L1 a L7, armas por tamano y barra de carga

Las reglas del combate viven en `lib/combat-rules.js`, cada una detras de una
constante de `COMBAT_RULES`: volver a la regla de antes es cambiar un valor, sin
tocar la logica. Las pruebas estan en `test/reglas.test.js` (cada regla),
`test/balance.test.js` (peleas de verdad con cada arma) y
`test/combate.test.js` (lo que la pagina lee y muestra).

Hay tres relojes y los tres se nombran en segundos:

- La pelea del campo (`lib/world.js`): 30 ticks por segundo. La pradera, la
  cripta y los campamentos pelean con este reloj.
- El juego (`lib/game.js` `TICK_MS`): 15 ticks por segundo. El duelo y el Coloso
  van con este reloj.
- `COMBAT_RULES.gameClock` (0,5) pasa de uno a otro, asi un arma tarda los
  mismos segundos contra un monstruo, en un duelo y contra el Coloso.

## Las reglas

| Regla | Que hace                                                                                                                                                                                                                                                                                                                                                                                             | Constantes                                                                             | Apagarla                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| L1    | El registro de la pelea anota cada golpe, pocion, guardia y retirada como dato: `type` (`hit`, `potion`, `guard`, `retreat`), `by` (`hero`, `foe`), `amount` y un numero corrido `n`. El texto de siempre sigue igual.                                                                                                                                                                               | `logEvents: true`                                                                      | `false`: solo texto; la pagina cuenta por las vidas |
| L2    | `P` toma una pocion a mano. Cura `potionHeal` y usa el turno del heroe: no pega hasta el golpe del monstruo (o el tope). Sin pociones o con la vida llena no pasa el turno. La del guion (`use potion`) sigue igual.                                                                                                                                                                                 | `manualPotion: true`, `potionHeal: 8`                                                  | `manualPotion: false`                               |
| L3    | Una tecla de ataque corre hasta el proximo golpe de cualquiera de los dos (o una pocion), con un tope. Antes era un turno fijo de 6 ticks: hacian falta unas 5 teclas por golpe.                                                                                                                                                                                                                     | `turnUntilBlow: true`, `turnCap: 45` (1,5 s), `turnTicks: 6`                           | `turnUntilBlow: false`                              |
| L4    | `G` es la guardia: ese turno el heroe no pega ni recarga el arma, y el proximo golpe que recibe entra multiplicado por `guardFactor` (redondeado hacia arriba, minimo 1). El turno de guardia espera ese golpe aunque pase del tope, si el monstruo ya alcanza.                                                                                                                                      | `guard: true`, `guardFactor: 0.5`, `guardHoldsCooldown: true`                          | `guard: false`                                      |
| L5    | `B` es la retirada. Si el monstruo no alcanza o le faltan mas de `retreatSafeTicks` para pegar, sale limpia; si no, se lleva ese golpe entero y sale igual (si queda en pie). Sin azar: la barra del monstruo dice si conviene. Despues retrocede `retreatStep` celdas y nada lo ataca por contacto durante `retreatGrace` ticks del campo. La vida y las pociones se guardan, sin premio ni muerte. | `retreat: true`, `retreatSafeTicks: 8`, `retreatStep: 2`, `retreatGrace: 75`           | `retreat: false`                                    |
| L6    | El golpe al Coloso respeta la recarga del arma (en el reloj del juego) y pega `(1 + atk) * bossStrikeScale`, menos la defensa del Coloso. Cada ataque del Coloso se carga `telegraph * bossTelegraphTicks` ticks (nunca menos que sus cuadros) y la pausa siguiente se acorta lo mismo, asi su ritmo no cambia.                                                                                      | `bossCooldown: true`, `bossStrikeScale: 2`, `bossTelegraphTicks: 10`, `bossMinGap: 12` | `bossCooldown: false`, `bossTelegraphTicks: 0`      |
| L7    | El golpe del duelo se prepara `duelWindup` ticks del reloj del juego y cae en el tick ordenado que termina la carga, midiendo la distancia en ese momento: alejarse durante la carga del rival lo esquiva. La recarga empieza al apretar. Los dos lados anuncian la carga en sus stats y solo vale si coinciden; un par que no la conoce no manda nada y el duelo queda con golpe instantaneo.       | `duelWindup: 5` (0,33 s)                                                               | `duelWindup: 0`                                     |

### Teclas y botones

| Accion        | Teclado (pagina y terminal)                         | Celular (grilla de botones)               |
| ------------- | --------------------------------------------------- | ----------------------------------------- |
| Atacar        | `F`, `Espacio`, `Enter` o un paso hacia el monstruo | Atacar (el boton grande)                  |
| Pocion (L2)   | `P`                                                 | Pocion n (donde va Mochila)               |
| Guardia (L4)  | `G`                                                 | Guardia (donde va Usar, arriba de Atacar) |
| Retirada (L5) | `B`                                                 | Retirada (donde va Esc, en rojo)          |

Las tres acciones solo aparecen en una pelea del campo (la pradera, la cripta y
los campamentos), no en el duelo ni contra el Coloso. En la pagina salen en el
proximo turno, antes que el ataque (`tripo-combate.mjs` `CombatPace.order`).
Las teclas estan en `lib/game.js` `COMBAT_KEYS` y en `tripo-combate.mjs`
`ACTION_KEYS` (una prueba las compara).

## L3 en la pagina: un golpe por tecla, de quien pegue primero

La regla es una tecla, un golpe de cualquiera de los dos: si el monstruo pega
antes que el heroe, esa tecla se gasta en su golpe y el heroe pega con la
siguiente (la barra dice "recargando" con los turnos que faltan). No es una
tecla, un golpe del heroe.

La pagina manda una tecla por turno. Cada turno dura en pantalla los ticks que
resolvio el juego a 30 por segundo (`turnLead`, con un tope de 3 s): la barra de
carga se llena en ese tiempo y el golpe cae al final, nunca a menos de 0,22 s
del anterior (`IMPACT_GAP`). La siguiente tecla sale cuando cae el golpe. Asi,
manteniendo el ataque, el tiempo entre golpes del heroe en la pagina es el de su
arma. La vida del heroe en la ficha baja cuando se ve el golpe, no cuando el
juego resolvio el turno (`pradera.js` `heroHp`).

Medido en el navegador manteniendo F contra un slime con mucha vida (escritorio,
1280x720):

| Arma       | Recarga en el juego | Entre golpes en la pagina |
| ---------- | ------------------- | ------------------------- |
| daga       | 0,80 s              | 0,93 s                    |
| espada     | 1,20 s              | 1,39 s                    |
| lanza      | 1,50 s              | 1,55 s                    |
| ballesta   | 1,40 s              | 1,45 s                    |
| martillo   | 1,80 s              | 1,91 s                    |
| arco largo | 1,80 s              | 2,05 s                    |

Lo que sobra sobre la recarga es la pausa del golpe (hit stop) y los golpes del
monstruo que caen en el medio.

## Armas por tamano

El dano de un golpe es el del heroe (1) mas el `atk` del arma; la recarga esta
en ticks de la pelea (30 por segundo). Mas grande, mas dano por golpe y mas
segundos entre golpes; el dano por segundo queda en una banda por papel: cuerpo
a cuerpo y lanza de 3,5 a 4,6, a distancia de 2,5 a 3,5 (pegan gratis mientras
el monstruo se acerca). Ningun golpe pasa de 8, asi el monstruo mas chico (el
slime, 9 de vida) nunca cae de un golpe.

| Arma               | atk | Dano | Recarga (ticks) | Segundos por golpe | Dano por segundo | Alcance | Antes (atk / recarga) |
| ------------------ | --- | ---- | --------------- | ------------------ | ---------------- | ------- | --------------------- |
| daga               | 2   | 3    | 24              | 0,80               | 3,75             | 1       | 2 / 9                 |
| espada             | 4   | 5    | 36              | 1,20               | 4,17             | 2       | 4 / 20                |
| lanza de guerra    | 5   | 6    | 45              | 1,50               | 4,00             | 6       | 3 / 21                |
| martillo de guerra | 7   | 8    | 54              | 1,80               | 4,44             | 2       | 7 / 34                |
| ballesta           | 3   | 4    | 42              | 1,40               | 2,86             | 14      | 2 / 17                |
| arco largo         | 5   | 6    | 54              | 1,80               | 3,33             | 18      | 3 / 23                |
| a mano limpia      | 0   | 1    | 30              | 1,00               | 1,00             | 1       | igual                 |

Los monstruos quedan como estan en `content.js` y van al mismo reloj: la pelea
multiplica su recarga por `foePace` (3). El mosquito pega cada 1,3 s, el
esqueleto cada 2,2 s, el golem cada 3 s. Con `foePace: 1` vuelve la recarga
escrita. Escudos y armaduras no cambian.

En el duelo y contra el Coloso la recarga del arma se pasa al reloj del juego
(`gameClock`): la daga recarga 12 ticks del juego, los mismos 0,8 s.

### La tabla de balance

`test/balance.test.js` corre peleas de verdad de `lib/world.js` como las arma el
campo (contacto a una celda, el equipo de la ficha), con cada arma contra cada
monstruo en los niveles 1, 3 y 5, sin pociones ni armadura, atacando en cada
turno. Imprime esta tabla (G gana, p pierde; segundos de pelea y vida que
queda) y comprueba:

- Con la daga de inicio el nivel 1 le gana al mosquito, al slime, al esqueleto,
  al espectro y al saqueador barbaro. A mano limpia, solo al slime.
- Nada cae de un golpe.
- Las peleas ganadas duran 12 s como mucho (30 s los jefes: el rey esqueleto,
  el caudillo y el esqueleto de elite) y la tipica 4,5 s.
- Atacando siempre, el turno hasta el golpe (L3) termina la pelea igual que el
  turno fijo: solo cambia donde se corta.

```text
nivel 1 (vida 20)
monstruo                 mano     dagger      sword      spear   crossbow  warhammer    longbow
espectro             p 9.6s 0  G 4.0s 12  G 3.6s 12  G 3.0s 12  G 4.2s 12  G 1.8s 16  G 3.6s 12
mosquito             p 3.9s 0   G 3.2s 5  G 2.4s 10   G 3.0s 5   p 4.0s 0  G 1.8s 10   G 3.6s 5
golem                p 9.0s 0   G 7.2s 2   G 6.0s 8   G 6.0s 8   p 9.1s 0   G 5.4s 8  G 7.2s 14
barbarian_raider     p 6.3s 0   G 5.6s 2   G 4.8s 2   G 4.5s 2   p 6.5s 0   G 3.6s 8   G 5.4s 2
barbarian_thrower    p 7.5s 0   G 4.8s 8   G 3.6s 8   G 4.5s 8  G 5.6s 14   G 3.6s 8   G 5.4s 8
barbarian_chief      p 4.8s 0   p 4.8s 0   p 4.8s 0   p 4.9s 0 G 15.4s 11   p 4.8s 0 G 12.6s 11
slime               G 8.0s 12  G 1.6s 18  G 1.2s 18  G 1.5s 18  G 2.8s 18  G 1.8s 18  G 1.8s 18
skeleton             p 8.8s 0  G 4.0s 12  G 3.6s 12  G 3.0s 12   G 5.6s 8  G 3.6s 12  G 3.6s 12
skeleton_knight      p 5.4s 0   p 5.4s 0   p 5.4s 0  G 6.0s 13  G 9.8s 13   G 5.4s 6  G 7.2s 13
skeleton_archer      p 7.5s 0   G 4.8s 8   G 4.8s 8   G 4.5s 8   G 7.0s 2   G 3.6s 8   G 5.4s 8
skeleton_elite       p 4.6s 0   p 4.6s 0   p 4.6s 0   p 4.7s 0 G 14.0s 11   p 4.6s 0   p 4.8s 0
skeleton_king        p 2.4s 0   p 2.4s 0   p 2.4s 0   p 2.4s 0  G 28.0s 9   p 2.4s 0  G 23.4s 9
```

Los niveles 3 y 5 salen al correr `npm test`. A distancia (ballesta, arco largo)
se le gana a los lentos retrocediendo; el mosquito, rapido, castiga a la ballesta
en el nivel 1.

## La barra de carga

Muestra la recarga real del arma, la que dice el estado del juego
(`tripo-estado.js` `fightOf`: `heroCd`, `heroCdMax`, `foeCd`, `foeCdMax`; en el
duelo `arena.self.cooldownLeft` y `winding`; contra el Coloso `boss.strike`).

- En 3D (`tripo-pradera.js` `ChargeBar`): una barra debajo de los pies del heroe
  (dorada) y otra debajo del monstruo (roja), de tamano fijo en pantalla y
  encima de todo. Se llenan durante el turno y caen con el golpe; llenas, laten.
  Los arcos de los aros de la pelea muestran lo mismo. En el duelo, la del rival
  va debajo de su vida y la carga de un golpe (L7) se llena en blanco; cuando el
  rival empieza a cargar aparece un `!` arriba. Contra el Coloso, la del heroe.
  Con la guardia puesta el aro del heroe se pone celeste y el golpe que paro se
  ve en celeste.
- En el boton Atacar del celular: el oro sube desde abajo y un aro se cierra
  alrededor (`--charge`, de 0 a 1), en la pelea, el duelo y el Coloso.
- En la terminal: una barrita de texto en el titulo de la pelea,
  `vos 20/20 [######] listo | mosquito 13/13 [##....]`, y en el del Coliseo
  (`preparando el golpe` mientras carga, L7).
