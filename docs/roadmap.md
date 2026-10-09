# Hoja de ruta

## Nota importante: tu personaje viaja a otros juegos

Recordatorio del autor, para hacerlo como lo sone:

> El juego de la terminal es el modelo de tu personaje. Lo que corre ahi sirve
> para migrar tu personaje a otros juegos, infinitamente: es el concepto de tu
> personaje para que se portee hacia otros juegos.

El heroe de la terminal, con su nombre, su reino, su nivel, su equipo y lo que
vivio, es el original. Cada juego nuevo lo recibe y lo sigue, en vez de empezar
de cero: la vista 2.5D del navegador, un juego en 3D, otros generos, otros
mundos. El personaje es uno solo y pasa de juego en juego.

### Lo que ya existe

- La pagina 2.5D corre el mismo `lib/` que la terminal, con las mismas reglas, y
  en el visor local copia una partida de la terminal (Load game) para seguirla
  en el navegador.
- La partida es un JSON con formato propio (`lib/saves.js`, `format: 1`): nombre,
  reino, ficha, equipo, mochila, ubicacion, misiones y progreso del jefe.
- La wallet guarda una direccion publica de Stellar (`lib/wallet.js`), que puede
  ser la identidad del personaje fuera de este juego.

### Ideas para llegar (propuestas, sin decidir)

- Un formato de personaje portable y versionado, separado de la partida: quien
  es el heroe y que tiene, sin lo que es propio de este mundo (la celda del mapa,
  el estado del Coloso).
- Exportar e importar ese personaje desde la terminal y desde la pagina.
- Una regla por juego para traducir la ficha y el equipo a sus propias reglas.
- Atar el personaje a la direccion de la wallet para que cualquier juego pueda
  reconocerlo.
