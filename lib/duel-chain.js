'use strict'

const crypto = require('bare-crypto')
const { Chain, scVal } = require('./stellar.js')

function bytes32(value, label) {
  const bytes = Buffer.from(value)
  if (bytes.length !== 32) throw new Error(label + ' debe tener 32 bytes')
  return scVal(bytes, 'bytes')
}

function signedXdr(value) {
  if (typeof value === 'string') return value
  if (value && typeof value.signedTxXdr === 'string') return value.signedTxXdr
  if (value && typeof value.xdr === 'string') return value.xdr
  throw new Error('el firmante no devolvio XDR firmado')
}

/** Wallet-safe client for contracts/duel-arena. */
class DuelChain {
  constructor(opts = {}) {
    this.chain = opts.chain || new Chain()
    this.wallet = opts.wallet
    this.contractId = opts.contractId || ''
  }

  get ready() {
    return !!(this.wallet && this.wallet.linked && this.wallet.canSign && this.contractId)
  }

  hashScript(script) {
    return crypto.createHash('sha256').update(String(script)).digest()
  }

  async invoke(method, args) {
    if (!this.ready) throw new Error('falta contrato o firmante externo')
    const xdr = await this.chain.prepareInvocation({
      source: this.wallet.address,
      contractId: this.contractId,
      method,
      args
    })
    const signed = signedXdr(
      await this.wallet.sign(xdr, {
        networkPassphrase: this.chain.net.passphrase,
        address: this.wallet.address
      })
    )
    const sent = await this.chain.sendSigned(signed)
    if (!sent || sent.status !== 'PENDING' || !sent.hash) {
      throw new Error((sent && sent.errorResultXdr) || 'Stellar rechazo la transaccion')
    }
    const result = await this.chain.waitForTransaction(sent.hash)
    if (!result || result.status !== 'SUCCESS') {
      throw new Error((result && result.resultXdr) || 'la transaccion Stellar fallo')
    }
    return result
  }

  create({ nonce, opponent, stake, script, engineVersion, contentHash }) {
    return this.invoke('create_duel', [
      scVal(BigInt(nonce), 'u64'),
      scVal(this.wallet.address, 'address'),
      scVal(opponent, 'address'),
      scVal(BigInt(stake), 'i128'),
      bytes32(this.hashScript(script), 'scriptHash'),
      scVal(String(engineVersion), 'string'),
      bytes32(contentHash, 'contentHash')
    ])
  }

  accept(nonce, script) {
    return this.invoke('accept_duel', [
      scVal(BigInt(nonce), 'u64'),
      bytes32(this.hashScript(script), 'scriptHash'),
      scVal(this.wallet.address, 'address')
    ])
  }

  reveal(nonce, script, challenger) {
    return this.invoke(challenger ? 'reveal_challenger' : 'reveal_opponent', [
      scVal(BigInt(nonce), 'u64'),
      scVal(String(script), 'string')
    ])
  }

  publishResult(nonce, winner) {
    return this.invoke('publish_result', [scVal(BigInt(nonce), 'u64'), scVal(winner, 'address')])
  }
}

module.exports = { DuelChain, signedXdr }
