'use strict'

// La version sin wallet (la de Steam): reemplaza a lib/stellar.js cuando se
// arma con RUNA_SIN_WALLET=1 (scripts/build-juego.js). Sin cadena ni la
// criptografia de stellar-base en el paquete; el juego ve `disabled` y deja la
// pantalla de la V solo para el PvP.
module.exports = { disabled: true, Chain: null, isPublicAddress: () => false }
