# vendor/

`stellar-base.bundle.js` es codigo de terceros. No se edita a mano: se regenera con

    npm run vendor:stellar

## Por que esta empaquetado y no es una dependencia normal

runa corre en Bare, que no es Node. `@stellar/stellar-sdk` no carga ahi: pide
`TextDecoder` y despues `Event`, porque trae su propio cliente HTTP pensado para
navegador o Node. Y `@stellar/stellar-base`, que es la parte que solo sabe de XDR
y firmas, tampoco carga tal cual: una dependencia suya (`@noble/curves`) resuelve
a un archivo que hace `require('node:crypto')`, y Bare no tiene ese modulo.

La bandera que arregla eso es `--conditions=browser`. Con ella, `@noble/curves`
elige su camino de WebCrypto en vez del de Node, y el problema desaparece.

Falta todavia que Bare tenga tres globals que no trae. Los pone `lib/stellar.js`
antes de requerir este archivo: `self`, `TextDecoder` y `crypto.getRandomValues`,
este ultimo apoyado en `bare-crypto`.

## Por que el archivo esta commiteado

Porque `npm run make` empaqueta un binario para seis plataformas, y porque quien
clona el repositorio tiene que poder jugar sin pasos extra. Un artefacto generado
en `postinstall` romperia las dos cosas.
