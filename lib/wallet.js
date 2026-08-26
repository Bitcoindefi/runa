'use strict'

let isPublicAddress = () => false
try {
  isPublicAddress = require('./stellar.js').isPublicAddress || isPublicAddress
} catch {}

/**
 * Wallet identity kept by the terminal game.
 *
 * A public address is safe to persist. Signing authority is deliberately an
 * injected adapter: the game never asks for, receives or saves a secret seed.
 */
class WalletSession {
  constructor(opts = {}) {
    this.address = null
    this.signer = opts.signer || null
    this.error = ''
    this.pending = null
    if (opts.address) this.link(opts.address)
  }

  get linked() {
    return this.address !== null
  }

  get canSign() {
    return !!(this.signer && typeof this.signer.signTransaction === 'function')
  }

  get short() {
    return this.address ? this.address.slice(0, 6) + '...' + this.address.slice(-6) : null
  }

  link(value) {
    const address = String(value || '').trim()
    if (!isPublicAddress(address)) {
      this.error = 'la direccion publica no es valida'
      return false
    }
    this.address = address
    this.error = ''
    return true
  }

  disconnect() {
    if (this.signer && typeof this.signer.disconnect === 'function') {
      try {
        this.signer.disconnect()
      } catch {}
    }
    this.address = null
    this.error = ''
    this.pending = null
  }

  /** Queue XDR for the external signer; never signs inside the save layer. */
  sign(xdr, options = {}) {
    if (!this.canSign) return Promise.reject(new Error('no hay un firmante externo conectado'))
    return Promise.resolve(this.signer.signTransaction(xdr, options))
  }

  toJSON() {
    return this.address ? { address: this.address } : null
  }
}

module.exports = { WalletSession }
