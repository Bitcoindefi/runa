'use strict'

// lib/stellar.js solo pide el polyfill si faltan TextEncoder y TextDecoder; el
// navegador los trae, y asi no se empaquetan 100 KB que nunca corren.
module.exports = {
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder
}
