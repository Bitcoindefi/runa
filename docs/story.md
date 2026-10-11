# Modo historia: las misiones del rey

El rey Aldren espera en el salon del trono del castillo de RUNA. Al hablarle con
`E` entrega una cadena corta de misiones, una por vez. Volver a hablarle muestra
el progreso, paga la mision cuando el objetivo esta cumplido y entrega la
siguiente en el acto. Despues de la ultima dice un epilogo.

| Capitulo | Titulo                  | Objetivo                           | Recompensa       |
| -------- | ----------------------- | ---------------------------------- | ---------------- |
| 1        | la prueba del rey       | eliminar 3 mosquitos en la pradera | 20 oro, 20 exp   |
| 2        | la horda barbara        | derrotar 2 saqueadores barbaros    | 60 oro, 60 exp   |
| 3        | el despertar del Coloso | asestar 3 golpes al Coloso Runico  | 100 oro, 100 exp |

- Una baja cuenta por el mismo camino que la mision de sir Cedric: una victoria
  real contra el tipo de enemigo pedido, despues de aceptar la mision.
- Los saqueadores viven solo en los campamentos barbaros del este y no
  reaparecen. Si al aceptar el capitulo 2 quedan menos de los que pide, se
  acreditan los que faltan: una partida que ya arraso la frontera no se traba.
- Un golpe es un ataque con `F` que le hace dano al Coloso en las ruinas
  volcanicas. Si el Coloso ya cayo, o cae antes del tercer golpe, el capitulo
  queda cumplido por el mismo motivo. Un `F` que no llega (lejos o fuera de
  alcance) no cuenta.
- La mision de sir Cedric sigue aparte. Un mosquito puede contar para las dos,
  pero cada una se acepta, se cobra y se guarda por separado.
- Los heroes de RUNA leen `el rey Aldren te espera en el castillo` al empezar
  y al cargar una partida que todavia no hablo con el rey, como las guardadas
  antes de que existiera la historia. Los de NOX pueden hacer la historia si
  llegan al castillo; su reino no los manda.

## Una charla con el rey

La pagina 2.5D muestra solo las ultimas cuatro lineas del registro. Por eso una
charla escribe como mucho el saludo del rey, una linea de pago, la de subir de
nivel si corresponde y, despues, la presentacion y el objetivo del capitulo
nuevo o el epilogo. Si el capitulo siguiente ya estaba cumplido al entregarlo
(frontera arrasada o Coloso caido), se paga en el acto sin anunciarlo y su
recompensa se suma a la misma linea: `mision completada: +80 oro, +80 exp`.
La pagina todavia no lee `story`; un rastreador ahi es el paso que falta.

## Datos

`lib/quests.js` define todas las misiones como datos: quien las da (`giver`),
que piden (`kind`, `target`, `count`), que pagan (`reward`), sus textos y la
cadena (`after`). El NPC solo dice donde empieza su cadena, en `lib/map.js`:
`{ kind: 'quest', quest: 'king_trial' }`. Todas las lineas salen de
`questText`, en castellano y ASCII, con su traduccion en `lib/locales/en.json`.

`t()` traduce tramos en cualquier linea, asi que las claves nuevas llevan su
contexto: `mision aceptada: derrota`, nunca `derrota` sola, y una clave entera
por fila de la ficha (`rey: saqueadores`). Un capitulo nuevo necesita la suya;
`test/story.test.js` recorre todos y falla si falta.

## El Coloso de cada partida

El capitulo 3 lee la vida del Coloso guardada en la ranura (`worldBossState`)
o la de las ruinas abiertas, en `worldBossDown()` de `lib/game.js`.
`docs/world-boss.md` saca esa vida de la ranura: una sola autoridad por evento
y la recompensa reclamada una vez por `spawnId`. Cuando eso exista, esa es la
lectura que hay que cambiar por el estado global; hasta entonces cada partida
tiene su propio Coloso.

## Guardado

Cada mision se guarda en `quests` como `{ status, progress }`, igual que la de
los mosquitos, sin cambiar el formato de la ranura. Una partida sin las claves
de la historia carga con la historia sin empezar, y un capitulo cuyo anterior
no esta completo vuelve a empezar.

## Contrato para la pagina

`scripts/tripo-estado.js` agrega `story` al estado en vivo (`session.state()`).
Es `null` en el menu y, durante la partida:

```js
const story = {
  id: 'king_trial', // 'king_trial' | 'barbarian_raid' | 'colossus_awakening'
  chapter: 1, // 1..chapters
  chapters: 3,
  title: 'la prueba del rey', // castellano: traducir con session.tr()
  label: 'mosquitos', // que hay que conseguir: 'saqueadores', 'golpes al Coloso'
  status: 'active', // 'available' | 'active' | 'ready' | 'done'
  progress: 1,
  count: 3,
  returnTo: 'el rey Aldren',
  giver: { id: 'aldren', name: 'Aldren', map: 'castle', x: 56, y: 13 }
}
```

- `available`: el rey todavia no entrego el capitulo; hay que hablar con `giver`.
- `active`: en curso; mostrar `label` con `progress/count`.
- `ready`: objetivo cumplido; volver con `returnTo`.
- `done`: la historia termino; queda el ultimo capitulo.

`session.tr(story.title)` devuelve `the king's trial`, y lo mismo vale para
`label` (`raiders`, `Colossus hits`) y `returnTo` (`King Aldren`). No hay una
frase con el numero adentro: su verbo necesitaria una clave de una sola
palabra, que tambien traduciria pedazos de otras lineas.
