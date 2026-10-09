# Demo grabada de RUNA y Tripo

El video muestra 46 segundos del render real de RUNA, dedicados a las
integraciones Tripo. Todos los cuadros muestran un modelo generado o su
uso directo en el juego. No incluye recorridos por ciudad, NOX o pradera.

La version actual es `docs/demo/runa-tripo-focused-en.mp4`. Tanto el juego como
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
