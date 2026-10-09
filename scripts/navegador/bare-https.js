'use strict'

// La parte de bare-https que usa lib/stellar.js (post), sobre fetch: request()
// con write, end, destroy y 'error', y una respuesta con statusCode, 'data' y
// 'end'. Con esto la semilla del dia sale de la cadena tambien en la pagina.

const EventEmitter = require('bare-events')

function request(opts, onResponse) {
  const req = new EventEmitter()
  const body = []
  const controller = new AbortController()
  let done = false

  req.write = (chunk) => {
    body.push(String(chunk))
    return true
  }

  req.destroy = (error) => {
    if (done) return
    done = true
    controller.abort()
    if (error) req.emit('error', error)
  }

  req.end = () => {
    const port = opts.port && Number(opts.port) !== 443 ? ':' + opts.port : ''
    const url = 'https://' + opts.hostname + port + (opts.path || '/')
    const headers = { ...(opts.headers || {}) }
    // El navegador pone el largo: fetch no deja fijarlo.
    delete headers['content-length']
    globalThis
      .fetch(url, {
        method: opts.method || 'GET',
        headers,
        body: body.length ? body.join('') : undefined,
        signal: controller.signal
      })
      .then(async (response) => {
        const res = new EventEmitter()
        res.statusCode = response.status
        if (onResponse) onResponse(res)
        const text = await response.text()
        done = true
        res.emit('data', text)
        res.emit('end')
      })
      .catch((error) => {
        if (done) return
        done = true
        req.emit('error', error)
      })
  }

  return req
}

module.exports = { request }
