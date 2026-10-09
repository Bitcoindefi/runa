# Demo grabada de RUNA y Tripo

La edición con motion design es `docs/demo/runa-tripo-motion-part1-en.mp4`:
74 segundos, 1920×1080, 15 FPS, H.264 y audio AAC estéreo a 48 kHz.
Identifica Coloso, héroe y yelmo con títulos animados y una imagen de cada
GLB original tomada del visor de modelos. Conserva 36 segundos de recorrido
y extiende la pelea a 30 segundos continuos; incluye una apertura y un cierre
de 4 segundos, preparado para una segunda parte del navegador 3D.

La edición rasteriza las cadenas HTML de color del render ANSI real con Pillow
y una fuente monoespaciada, y las compone con FFmpeg. No es una nueva captura
del navegador ni modifica sprites o reglas. La pelea usa un fixture de nivel 20
(30000 XP, 134 HP máximos), indicado en pantalla. Termina con 53 HP del jugador
y 300/360 HP del Coloso; no repite ni ralentiza la pelea original de 10 segundos.
La compra y el inventario conservan el fixture de nivel 3 de la captura base.
La voz en inglés es sintética, Microsoft Zira Desktop mediante System.Speech.
La base sonora y los acentos de transición se sintetizan en el script; son
sonido de edición, no audio propio del juego. Esta edición no usa Higgsfield.

Para reproducir la edición en Windows con Python, Pillow, Bare y FFmpeg:

```powershell
npx bare scripts/demo-walkthrough.js output/playwright/demo-tripo-motion --extended
python scripts/demo-motion.py output/playwright/demo-tripo-motion
```

| Tiempo      | Escena de la edición                        |
| ----------- | ------------------------------------------- |
| 00:00–00:04 | Apertura: Imagination takes shape           |
| 00:04–00:16 | Coloso: GLB original y menú ASCII           |
| 00:16–00:24 | Héroe: GLB original y creación de personaje |
| 00:24–00:32 | Yelmo: compra del objeto                    |
| 00:32–00:40 | Yelmo: vista equipado y defensa +2          |
| 00:40–01:10 | Coloso: 30 segundos continuos de combate    |
| 01:10–01:14 | Cierre para enlazar la parte 2              |

La captura base anterior se conserva y se describe a continuación.

El video muestra 46 segundos del render real de RUNA, dedicados a las
integraciones Tripo. Todos los cuadros muestran un modelo generado o su
uso directo en el juego. No incluye recorridos por ciudad, NOX o pradera.

La captura base es `docs/demo/runa-tripo-focused-en.mp4`. Tanto el juego como
los subtitulos de recorrido estan en ingles. El menu muestra solo el Coloso
en cian, con una vuelta cada 10,8 segundos y un angulo frontal inicial.
Los videos anteriores se conservan como versiones historicas.

Es una grabacion reproducible del render ANSI presentado en un navegador,
no una grabacion de una ventana nativa de terminal. El script ejecuta Runa,
sus entradas de teclado y su reloj a 15 cuadros por segundo. El navegador
solo reproduce esos cuadros para capturarlos; no reemplaza el juego.

La partida de muestra vive en memoria y no lee ni escribe ranuras del jugador.
El acceso a tienda y arena, el estado nivel 3 / 100 oro y la espada usada en
el combate se preparan como fixtures de demostracion. No representan una
subida de nivel ni un recorrido de desbloqueo obtenidos durante el video.
La compra del yelmo se ejecuta con Enter y consume 75 de oro. Los ataques
con F reducen de verdad la vida del Coloso; el script rechaza la grabacion
si no hubo dano al jefe o si el jugador abandona la arena.

| Tiempo      | Escena Tripo                                       |
| ----------- | -------------------------------------------------- |
| 00:00-00:12 | Coloso: una vuelta completa en el menu             |
| 00:12-00:20 | Heroe: vista previa al crear personaje             |
| 00:20-00:28 | Yelmo: seleccion y compra en la armeria            |
| 00:28-00:36 | Yelmo: vista animada, equipamiento y defensa       |
| 00:36-00:46 | Coloso: pelea en primer plano con golpes y poderes |

La pelea cambia la terminal real de 120x44 a 80x24. El navegador amplia la
fuente de 13 a 22 px; no inventa ni estira sprites. El lienzo 43x13 del jefe
cabe completo en la camara existente. No se modifican el juego, los ataques,
la vida ni las colisiones para lograr el encuadre.

```bash
npx bare scripts/demo-walkthrough.js output/playwright/demo-tripo-focused
python3 -m http.server 4179 --bind 127.0.0.1 --directory output/playwright/demo-tripo-focused
```

Abrir `http://127.0.0.1:4179/`, esperar a `window.demo.ready` y ejecutar
`window.startDemo()` para reproducir. La secuencia termina cuando
`window.demo.done` es true. `chapters.json` registra los tiempos y titulos.
La captura se realiza con Playwright a 1280x900 y 15 FPS, y se convierte a
MP4 H.264 con FFmpeg para compartirla. No se utilizan assets de muestra ajenos
ni se genera un trailer con escenas inventadas.
Se recortan los segundos de preparacion del grabador y se unen tomas
verificadas del mismo recorrido para conservar los 46 segundos de la demo.
