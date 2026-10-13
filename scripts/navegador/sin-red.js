'use strict'

// Lo que en el navegador no existe: Hyperswarm y bare-crypto (nativos). Fallar
// al cargar es lo que net.js ya espera de una red que no esta: lo atrapa y su
// presencia queda sin swarm. En la pagina la presencia viaja por WebRTC
// (red-webrtc.js), que no los necesita.
throw new Error('sin Hyperswarm en el navegador: la presencia va por WebRTC')
