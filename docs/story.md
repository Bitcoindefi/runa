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
  queda cumplido por el mismo motivo.
- La mision de sir Cedric sigue aparte. Un mosquito puede contar para las dos,
  pero cada una se acepta, se cobra y se guarda por separado.
- Al empezar, los heroes de RUNA leen `el rey Aldren te espera en el castillo`.
  Los de NOX pueden hacer la historia si llegan al castillo; su reino no los
  manda.

## Datos

`lib/quests.js` define todas las misiones como datos: quien las da (`giver`),
que piden (`kind`, `target`, `count`), que pagan (`reward`), sus textos y la
cadena (`after`). El NPC solo dice donde empieza su cadena, en `lib/map.js`:
`{ kind: 'quest', quest: 'king_trial' }`. Todas las lineas salen de
`questText`, en castellano y ASCII, con su traduccion en `lib/locales/en.json`.

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
  goal: 'elimina 3 mosquitos',
  label: 'mosquitos', // forma corta del objetivo
  status: 'active', // 'available' | 'active' | 'ready' | 'done'
  progress: 1,
  count: 3,
  returnTo: 'el rey Aldren',
  giver: { id: 'aldren', name: 'Aldren', map: 'castle', x: 56, y: 13 }
}
```

- `available`: el rey todavia no entrego el capitulo; hay que hablar con `giver`.
- `active`: en curso; mostrar `progress/count` y `goal`.
- `ready`: objetivo cumplido; volver con `returnTo`.
- `done`: la historia termino; queda el ultimo capitulo.

`session.tr(story.title)` devuelve `the king's trial`, y lo mismo vale para
`goal` y `returnTo`.
