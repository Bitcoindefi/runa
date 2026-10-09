# Modelos Tripo en la pantalla de inicio

El juego reproduce 24 vistas de texto precalculadas. No abre GLB, no usa un
motor 3D y no llama a Tripo durante la partida. El reloj existente cambia el
cuadro cada 125 ms: una vuelta tarda tres segundos.

Para convertir un modelo una vez, desde Ubuntu con Python 3 y numpy:

```bash
python3 scripts/glb-to-ascii.py assets/tripo/heroe.glb --output assets/ascii/heroe.json
python3 scripts/glb-to-ascii.py assets/tripo/coloso.glb --output assets/ascii/coloso.json
python3 scripts/glb-to-ascii.py assets/tripo/yelmo.glb --output assets/ascii/yelmo.json
python3 scripts/glb-to-ascii.py assets/tripo/coloso.glb --output assets/ascii/coloso-field.json --sizes 43x13
python3 scripts/glb-to-ascii.py assets/tripo/paisaje.glb --hero assets/tripo/heroe.glb --colossus assets/tripo/coloso.glb --output assets/ascii/paisaje.json
```

El script lee la escena GLB, aplica las transformaciones de sus nodos y
rasteriza sus triangulos con un buffer de profundidad desde 24 angulos.
Usa luz sobre la geometria para elegir caracteres ASCII; no muestrea las
texturas. Produce tres tamanos para adaptar la portada a la terminal.
Los GLB comprimidos con Draco requieren descompresion previa.

Los cuadros JSON se incluyen en el juego y pueden versionarse; los GLB
permanecen fuera de git. El menu muestra una composicion del reino, el heroe y
el Coloso. El paisaje generado no incluyo los combatientes solicitados, por lo
que el conversor los incorpora reutilizando sus GLB, sin otro pedido a Tripo.
El mapa del jefe reutiliza el Coloso sobre el lienzo original 43x13; sus avisos
y poderes siguen siendo los del juego. La creacion muestra el heroe. Al seleccionar el
yelmo de hierro en la armeria o el inventario aparece su vista ASCII, si hay
espacio suficiente. Se compra desde nivel 3 por 75 de oro y se equipa con
Enter en la mochila (I); conserva sus valores de defensa +2 y velocidad -0.04.
Para usar otro modelo, convertirlo y cambiar los imports. En terminales sin
espacio suficiente se mantiene el logo estatico y los controles existentes.

## Pedidos reales usados en esta actualizacion

Los cuatro GLB se generaron con `P1-20260311`, 3000 caras, textura y PBR.
Cada respuesta reporto 40 creditos consumidos. Los prompts fueron:

- Heroe: `a low-poly medieval hero with a round shield and a short sword, single character, game prop`
- Yelmo: `a low-poly iron helmet with a single rune on the brow, game prop`
- Coloso: `a massive ancient stone colossus, full body standing upright, weathered volcanic rock armor with glowing amber rune carvings, broad shoulders, two arms and two legs, single isolated character, low-poly medieval fantasy game boss`
- Paisaje: `a single cohesive low-poly medieval fantasy diorama on a round terrain base, a walled kingdom with castle towers in the background, outside the walls a small hero with sword and round shield facing a giant stone colossus in battle, volcanic rocky ground, amber rune accents, clear readable silhouettes, full scene isolated, game title screen diorama`

El conversor conserva la geometria producida por esos pedidos. La textura
PBR se puede revisar en el visor, pero no interviene en la conversion a ASCII.

La ilustracion `assets/runa-cover.png` se genero con la herramienta integrada
de imagenes como portada grafica independiente. Prompt: portada horizontal
de RUNA, heroe con espada y escudo frente a un coloso de piedra en ruinas
volcanicas, torre central y castillos, runas ambar, titulo RUNA y espacio
oscuro inferior para el menu. El menu de terminal usa los cuadros ASCII.
