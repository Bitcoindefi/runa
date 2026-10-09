// El postproceso de la vista 2.5D: como se pasa cada cuadro a la pantalla.
//
// La pagina (tripo-heroe.html) arma los efectos una vez, despues del renderer,
// la escena y la camara: createEffects({ renderer, scene, camera, settings }).
// En cada cuadro llama a render(dt, screen) en vez de renderer.render, con la
// pantalla en que esta ('menu', 'play', 'tour' o 'mirror'), y setSize(w, h)
// cuando cambia el tamano del lienzo. `settings` son las opciones de quien juega
// (se guardan en el navegador).
//
// Esta version no hace nada mas que dibujar.

export function createEffects({ renderer, scene, camera }) {
  return {
    render() {
      renderer.render(scene, camera)
    },
    setSize() {}
  }
}
