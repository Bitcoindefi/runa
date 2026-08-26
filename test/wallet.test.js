const { test } = require('brittle')
const { Chain } = require('../lib/stellar.js')
const { WalletSession } = require('../lib/wallet.js')

test('la wallet guarda solo una direccion publica valida', (t) => {
  const secret = new Chain().create()
  const publicKey = new Chain({ secret }).address
  const wallet = new WalletSession()

  t.absent(wallet.link(secret), 'una clave secreta nunca se acepta como identidad')
  t.ok(wallet.link(publicKey))
  t.is(wallet.address, publicKey)
  t.alike(wallet.toJSON(), { address: publicKey })
  t.absent(JSON.stringify(wallet.toJSON()).includes(secret), 'el guardado no contiene el secreto')
  t.absent(wallet.canSign, 'vincular una direccion no finge que puede firmar')
})

test('un firmante externo se usa sin entrar en el estado persistente', async (t) => {
  const secret = new Chain().create()
  const publicKey = new Chain({ secret }).address
  let signed = null
  const wallet = new WalletSession({
    address: publicKey,
    signer: {
      signTransaction(xdr) {
        signed = xdr
        return Promise.resolve('firmado')
      }
    }
  })

  t.ok(wallet.canSign)
  t.is(await wallet.sign('AAAA'), 'firmado')
  t.is(signed, 'AAAA')
  t.alike(wallet.toJSON(), { address: publicKey }, 'el adaptador tampoco se serializa')
})
