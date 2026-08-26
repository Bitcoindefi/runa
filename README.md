# RUNA

Un RPG ASCII para terminal donde exploras una ciudad, recorres la pradera y escribes las reglas que usa tu personaje al combatir.

El mundo corre sobre **Bare**, se dibuja con **bare-tui** y mantiene todo el arte dentro de una grilla ASCII estable. El personaje, los NPC y los monstruos se mueven sin borrar el terreno ni romper las líneas de la consola.

![Menú principal de RUNA](docs/screens/menu.png)

## Características actuales

- Ciudad de `320x200` caracteres con barrios, iglesia, taberna, herrería, armería, castillo y entrada a las ruinas.
- Portón funcional que transporta al jugador a la pradera.
- NPC con arte y oficios diferenciados.
- Monstruos que patrullan el mapa sin detener el movimiento del mundo.
- Combate sobre la propia pradera, sin cambiar a una pantalla separada.
- Nueva partida con nombre personalizado e inicial visible en el pecho del héroe.
- Tres ranuras persistentes con carga y autoguardado de progreso.
- Inventario y equipamiento separados, con ranuras para arma y armadura.
- Estrategias de combate escritas en `script.txt` y recargadas mientras juegas.
- Presencia opcional entre jugadores mediante Hyperswarm.

## Nueva partida y personaje

El menú principal separa claramente `Continuar`, `Nueva partida`, `Cargar partida` y `Salir`. `Continuar` abre la partida más reciente; `Nueva partida` usa la primera ranura vacía y `Cargar partida` abre el selector de tres ranuras. Si las tres están ocupadas, `N` permite elegir cuál reemplazar y la pantalla de nombre avisa qué personaje será sustituido.

El juego autoguarda después de cada acción y al salir. Conserva nombre, nivel, vida, oro, experiencia, pociones, inventario, equipo y posición en la ciudad, las ruinas o la pradera. La ranura activa aparece en el pie de la pantalla como `autoguardado R1`, `R2` o `R3`.

La primera letra alfanumérica se convierte en el emblema del pecho. Por ejemplo, **Ayla** aparece como `A`:

![Creación de una nueva partida](docs/screens/nombre.png)

El personaje comienza sin armas ni escudo. Su dibujo cambia únicamente cuando equipa un objeto real:

```text
sin equipo       espada          espada + escudo

    O            / O             / O
   /A\           /|A\            /|A\ [#]
   / \            / \             / \
```

## La ciudad

La ciudad usa una cámara desplazable para mantener edificios grandes y detallados sin reducir al jugador. Cada fachada tiene su propio diseño: la iglesia no comparte el arte de la taberna, la herrería o la armería.

![Ciudad e iglesia](docs/screens/ciudad.png)

Las puertas se activan al pisarlas. El gran portón del sur conecta con la pradera y la entrada `V` del castillo baja a las ruinas.

## La pradera

La pradera combina caminos, vegetación, agua y zonas de distinta dificultad. Mosquitos, espectros y gólems tienen sprites compactos y se mueven por su cuenta.

![Pradera y monstruos](docs/screens/campo.png)

Los espacios internos de todos los sprites son transparentes: el pasto y los caminos siguen visibles entre brazos, piernas y equipo.

## Combate dentro del mapa

El combate empieza cuando la hitbox del jugador toca la de un monstruo. Los dos personajes permanecen visibles sobre el terreno.

![Combate dentro de la pradera](docs/screens/combate.png)

Cada pulsación de `F`, `Espacio` o una dirección contra el enemigo resuelve un intercambio. La estrategia decide qué arma usar; la tecla solamente hace avanzar el turno visible.

El archivo `script.txt` se vuelve a leer durante el combate:

```text
?hp < 8
 use potion
:?foe.dist >= 5
 equip crossbow
:
 equip sword
```

Una estrategia solo puede equipar objetos que el jugador realmente posee.

## Armas, armaduras y tiendas

Inventario y equipo no son lo mismo. Comprar un objeto lo añade al inventario y lo equipa automáticamente en su ranura:

| Ranura    | Objetos          | Efecto                               |
| --------- | ---------------- | ------------------------------------ |
| Izquierda | espada, ballesta | Ataque, alcance y velocidad de golpe |
| Derecha   | escudo, botas    | Defensa o velocidad de movimiento    |

![Tienda de armaduras y equipo](docs/screens/equipo.png)

En una tienda:

- `Enter` compra o equipa el objeto seleccionado.
- `X` lo quita sin venderlo ni eliminarlo del inventario.
- `Esc` o `E` vuelve a la ciudad.

El escudo solo aparece junto al personaje cuando está equipado y reduce en `2` el daño de cada golpe, con un daño mínimo de `1`.

## Controles

| Contexto         | Teclas                       | Acción                              |
| ---------------- | ---------------------------- | ----------------------------------- |
| Menú principal   | flechas / `W` / `S`          | Elegir una opción                   |
| Menú principal   | `Enter` / `Espacio`          | Aceptar la opción                   |
| Menú principal   | `N`                          | Comenzar una partida nueva          |
| Ranuras          | flechas / `W` / `S`          | Elegir una ranura                   |
| Ranuras          | `Enter`, `N`, `Esc`          | Cargar, reemplazar o volver         |
| Nombre           | escribir, `Enter`, `Esc`     | Editar, confirmar o volver          |
| Ciudad y pradera | `WASD` / flechas             | Moverse                             |
| Mundo            | `E` / `Enter` / `Espacio`    | Hablar o interactuar                |
| Jugador cercano  | `E`                          | Enviar un desafío PvP               |
| Invitación PvP   | `Enter` / `N`                | Aceptar o rechazar                  |
| Coliseo PvP      | `WASD`, `F`, `R`             | Moverse, atacar o rendirse          |
| Ciudad           | `V`                          | Abrir Wallet y PvP                  |
| Wallet           | `A` / `Enter`, `X`, `Esc`    | Vincular, desvincular o volver      |
| Pradera          | `T`                          | Volver a la ciudad fuera de combate |
| Combate          | `F` / `Espacio` / `Enter`    | Resolver un intercambio             |
| Tienda           | flechas, `Enter`, `X`, `Esc` | Elegir, equipar, quitar o salir     |
| Juego            | `R`                          | Recargar `script.txt`               |
| Juego            | `?`                          | Mostrar dónde está el script        |
| Juego            | `Q` / `Ctrl+C`               | Salir                               |

La terminal mínima es de **64x16**. Para apreciar el mapa y la ficha lateral se recomienda **120x34** o más.

La pantalla de wallet acepta únicamente una dirección pública Stellar `G...` y
la guarda con la ranura. No acepta ni almacena seeds secretas `S...`. Vincular
una dirección identifica al jugador, pero las apuestas on-chain seguirán
marcadas como pendientes hasta configurar el contrato desplegado y un firmante
externo. Consulta [docs/wallet.md](docs/wallet.md).

## Ejecutar desde el repositorio

Requiere Node.js y npm para instalar las dependencias. El juego se ejecuta con el runtime Bare incluido en el proyecto.

```bash
git clone https://github.com/leocagli/runa.git
cd runa
npm install
npm start -- --solo
```

Para habilitar la presencia entre jugadores, inicia sin `--solo`:

```bash
npm start
```

También puedes elegir un nombre inicial desde la línea de comandos; aparecerá precargado en la pantalla de nueva partida:

```bash
npm start -- --solo --name Ayla
```

## Pruebas y revisión

```bash
npm test
npm run lint
npx bare test/map.smoke.js
```

Estado revisado de esta versión:

- `62/62` pruebas correctas.
- `473/473` aserciones correctas.
- Formato y lint limpios.
- Ciudad, puertas, portón, pradera y dungeon validados por el smoke test.
- Capturas inspeccionadas y recortadas al borde exacto de la terminal.

## Capturas reproducibles

Las imágenes de este README no son maquetas escritas a mano. El script [scripts/readme-screens.js](scripts/readme-screens.js) construye cada estado usando `Runa`, `Field` y el render real del juego, y genera HTML con los colores ANSI listo para capturar.

```bash
npx bare scripts/readme-screens.js .readme-screens
```

Esto evita documentar una ciudad, un héroe o un combate que ya no coincidan con el código.

## Arquitectura

| Archivo                        | Responsabilidad                                       |
| ------------------------------ | ----------------------------------------------------- |
| `lib/game.js`                  | Menús, entrada, transiciones y coordinación general   |
| `lib/map.js`                   | Ciudad, dungeon, colisiones, puertas y NPC            |
| `lib/field.js`                 | Pradera, cámara, patrullaje y encuentros              |
| `lib/world.js`                 | Simulación de combate y estadísticas derivadas        |
| `lib/shop.js`                  | Economía, inventario, equipo, guardados y migraciones |
| `lib/saves.js`                 | Tres ranuras, archivos persistentes y carga segura    |
| `lib/render.js`                | Composición estable de cada cuadro de terminal        |
| `lib/sprites.js`               | Arte ASCII del héroe, NPC y referencias maestras      |
| `lib/synchronized-renderer.js` | Publicación atómica de cuadros en Windows Terminal    |

Los enemigos, objetos, tiendas y mapas son datos. Esto permite ampliar el contenido sin duplicar lógica de combate o de renderizado.

## Bare, Pear y distribución P2P

- **Bare** ejecuta el juego y sus pruebas sin depender de las APIs internas de Node.
- **bare-tui** proporciona el ciclo de actualización, teclado y render de terminal.
- **Pear** permite distribuir builds y actualizaciones entre pares.
- **Hyperswarm** ofrece presencia opcional sin convertir el estado del jugador en una dependencia de red.

La partida funciona completamente en modo solitario cuando la red no está disponible.

## Referencias de arte ASCII

Los diseños compactos fueron adaptados a la escala del mapa a partir de referencias ASCII clásicas. El caballero maestro conserva la firma `hjw` en el código.

- [Colección de caballeros ASCII](https://ascii.genocation.com/ascii/caballeros.html)
- [Colección general de arte ASCII](https://ascii.genocation.com/ascii/coleccion.html)

## Licencia

Apache-2.0.
