'use strict'

// Lo que en el navegador no existe: Hyperswarm (la presencia P2P), bare-crypto
// (nativo) y net.js entero. Fallar al cargar es lo que el juego ya espera de una
// red que no esta: game.js y net.js lo atrapan y se juega solo.
throw new Error('sin red P2P en el navegador: se juega solo')
