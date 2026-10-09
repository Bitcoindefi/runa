# Demo grabada de RUNA y Tripo

El video muestra 68 segundos de recorrido por el render real de RUNA:
menu con Coloso girando, creacion de personaje, ciudad, NOX, pradera, compra del
yelmo, inventario y arena del Coloso.

La version actual es `docs/demo/runa-tripo-demo-colossus-en.mp4`. Tanto el juego como
los subtitulos de recorrido estan en ingles. El menu muestra solo el Coloso
en cian, con una vuelta cada 10,8 segundos y un angulo frontal inicial.
Los videos anteriores se conservan como versiones historicas.

Es una grabacion reproducible del render ANSI presentado en un navegador,
no una grabacion de una ventana nativa de terminal. El script ejecuta Runa,
sus entradas de teclado y su reloj a 15 cuadros por segundo. El navegador
solo reproduce esos cuadros para capturarlos; no reemplaza el juego.

La partida de muestra vive en memoria y no lee ni escribe ranuras del jugador.
Los cambios entre zonas y el estado nivel 3 / 100 oro se preparan como fixtures
de demostracion: no representan una subida de nivel obtenida durante el video.
La compra del yelmo se ejecuta con la entrada real Enter y consume oro.

```bash
npx bare scripts/demo-walkthrough.js output/playwright/demo-colossus
python3 -m http.server 4178 --bind 127.0.0.1 --directory output/playwright/demo-colossus
```

Abrir `http://127.0.0.1:4178/`, esperar a `window.demo.ready` y ejecutar
`window.startDemo()` para reproducir. La secuencia termina cuando
`window.demo.done` es true. `chapters.json` registra los tiempos y titulos.
La captura se realiza con Playwright a 1280x900 y 15 FPS, y se convierte a
MP4 H.264 con FFmpeg para compartirla. No se utilizan assets de muestra ajenos
ni se genera un trailer con escenas inventadas.
