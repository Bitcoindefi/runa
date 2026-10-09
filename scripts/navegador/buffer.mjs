// El Buffer que piden los modulos empaquetados, inyectado por esbuild: lo usan
// lib/stellar.js (Buffer.byteLength del cuerpo de cada POST) y bare-tui/mouse.js
// (Buffer.from, solo con el mouse activado, que el juego no usa).
const encoder = new TextEncoder()

export const Buffer = {
  byteLength: (value) =>
    typeof value === 'string' ? encoder.encode(value).length : value.byteLength,
  from: (value, encoding) => {
    if (typeof value !== 'string') return Uint8Array.from(value)
    if (encoding === 'latin1' || encoding === 'binary') {
      return Uint8Array.from(value, (c) => c.charCodeAt(0) & 0xff)
    }
    return encoder.encode(value)
  }
}
