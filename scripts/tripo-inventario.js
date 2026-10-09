// El inventario de la partida como un panel de la pagina, en vez de la pantalla
// de texto del juego.
//
// La pagina (tripo-heroe.html) lo arma una vez con createInventory(ctx) y en cada
// cuadro de la partida llama a sync(st, session): si el juego tiene abierta una
// pantalla que el panel sabe mostrar (st.overlay, por ejemplo 'inventory'), el
// panel la muestra, refleja el estado del juego y devuelve true, y la pagina no
// abre la pantalla de texto; si no, lo esconde y devuelve false. Las reglas
// siguen siendo las del juego: el panel lee el modelo (session.runa) y actua con
// las mismas teclas que la terminal (session.press). Devuelve null si no arma
// nada.
//
// Recibe `ctx`: tr(texto) (traduce nombres del juego), L(en, es) (textos de la
// pagina en el idioma elegido) y settings (las opciones de quien juega).

export function createInventory(ctx) {
  void ctx
  return null
}
