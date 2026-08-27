# Diseno de la mazmorra

Los tres niveles son interpretaciones originales para la escala ASCII de RUNA.
No reproducen literalmente ningun plano historico: toman tipos de espacio,
materiales y formas de circulacion de las siguientes referencias.

## Fuentes

- [Deposito subterraneo documentado por UNESCO](https://whc.unesco.org/archive/1999/whc-99-conf204-inf7e.pdf):
  descenso tallado en roca, portal ciclopeo, cisterna revestida y accesos ocultos
  al agua. Es la base de las camaras inundadas y puentes del nivel 1.
- [Geologia y canteras de las Catacumbas de Paris](https://www.catacombes.paris.fr/en/history/geology-and-quarries):
  galerias de caliza, pilares girados y muros de piedra seca que contienen el
  relleno y ordenan la circulacion. Inspira la silueta excavada del nivel 2.
- [El osario de las Catacumbas de Paris](https://www.catacombes.paris.fr/en/history/ossuary):
  hileras alternadas de huesos largos y craneos, altares, estelas, columnas y la
  lampara sepulcral. Estos elementos se traducen a `%o`, tumbas y braseros.
- [Necropolis real de Saint-Denis](https://www.saint-denis-basilique.fr/en/discover/history-of-the-monument):
  cripta, arquitectura gotica y decenas de monumentos funerarios de reyes y
  reinas. Define el caracter procesional del nivel final.
- [Rotonda de los Valois en Saint-Denis](https://www.saint-denis-basilique.fr/en/discover/the-tomb-of-henri-ii-and-catherine-de-medici):
  planta centrada con capillas laterales alrededor de un monumento real. Inspira
  la rotonda, las capillas y el doble acceso a la sala del Rey Esqueleto.
- [Jaquaying the Dungeon, The Alexandrian](https://www.thealexandrian.net/archive/archive2010-07c.html):
  los bucles y conexiones alternativas generan decisiones de exploracion y
  tactica. Los tres pisos evitan depender de una unica hilera de habitaciones.

## Traduccion al juego

### Nivel 1: cisternas del limo

Una reserva central de agua estancada parte la gran cavidad. Dos puentes cruzan
el deposito y una camara de desborde al sur completa una ruta alternativa. Los
slimes ocupan primero la zona humeda cercana al acceso; los esqueletos aparecen
en las obras de piedra mas profundas.

### Nivel 2: galerias del osario

El recorrido mezcla tuneles angostos, canteras redondeadas y corredores largos.
Los cursos `%o` representan huesos y craneos; pilares, sarcofagos y una lampara
sepulcral funcionan como hitos. Las lineas largas dan alcance a los arqueros,
mientras las camaras laterales favorecen a caballeros.

### Nivel 3: necropolis de la corona

Una nave procesional desemboca en una rotonda rodeada por capillas funerarias.
Desde ella nacen dos accesos al salon real, custodiados por elites. El trono y el
Rey Esqueleto cierran el eje ceremonial, pero el jugador conserva alternativas
para acercarse y retirarse durante la exploracion.

Cada punto de aparicion y cada destino tiene una prueba de conectividad desde la
escalera de entrada. Otra prueba exige que los tres planos y sus motivos visuales
sean diferentes para impedir que vuelvan a degradarse a una grilla repetida.

## Escaleras monumentales

Las transiciones ya no flotan como un unico `^` o `v`. Cada acceso ocupa cinco
filas ASCII con descansos, peldaños en perspectiva y un remate acorde al piso:
piedra hidraulica en la cisterna, huesos en el osario y ornamentacion real en la
necropolis. Los glifos `^` y `v` siguen incrustados en el peldaño interactivo, de
modo que el dibujo mejora la orientacion sin cambiar el control ni la progresion.
