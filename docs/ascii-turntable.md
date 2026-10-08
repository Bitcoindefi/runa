# Modelos Tripo en la pantalla de inicio

El juego reproduce 24 vistas de texto precalculadas. No abre GLB, no usa un
motor 3D y no llama a Tripo durante la partida. El reloj existente cambia el
cuadro cada 125 ms: una vuelta tarda tres segundos.

Para convertir un modelo una vez, desde Ubuntu con Python 3 y numpy:

```bash
python3 scripts/glb-to-ascii.py assets/tripo/heroe.glb --output assets/ascii/heroe.json
python3 scripts/glb-to-ascii.py assets/tripo/coloso.glb --output assets/ascii/coloso.json
```

El script lee la escena GLB, aplica las transformaciones de sus nodos y
rasteriza sus triangulos con un buffer de profundidad desde 24 angulos.
Usa luz sobre la geometria para elegir caracteres ASCII; no muestrea las
texturas. Produce tres tamanos para adaptar la portada a la terminal.
Los GLB comprimidos con Draco requieren descompresion previa.

Los cuadros JSON se incluyen en el juego y pueden versionarse; los GLB
permanecen fuera de git. `lib/render.js` consume `assets/ascii/coloso.json`.
Para usar otro modelo, convertirlo y cambiar ese import. En terminales sin
espacio suficiente se mantiene el logo estatico y los controles existentes.

La ilustracion `assets/runa-cover.png` se genero con la herramienta integrada
de imagenes como portada grafica independiente. Prompt: portada horizontal
de RUNA, heroe con espada y escudo frente a un coloso de piedra en ruinas
volcanicas, torre central y castillos, runas ambar, titulo RUNA y espacio
oscuro inferior para el menu. El menu de terminal usa los cuadros ASCII.
