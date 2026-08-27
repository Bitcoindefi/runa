const { test } = require('brittle')
const { Chain } = require('../lib/stellar.js')
const { DuelChain, signedXdr } = require('../lib/duel-chain.js')
const { WalletSession } = require('../lib/wallet.js')

test('duel-chain prepara, firma, envia y espera sin recibir una seed', async (t) => {
  const account = new Chain({ secret: new Chain().create() }).address
  const rival = new Chain({ secret: new Chain().create() }).address
  const calls = []
  const chain = {
    net: { passphrase: 'test' },
    prepareInvocation(value) {
      calls.push(['prepare', value])
      return Promise.resolve('unsigned-xdr')
    },
    sendSigned(value) {
      calls.push(['send', value])
      return Promise.resolve({ status: 'PENDING', hash: 'abc' })
    },
    waitForTransaction(value) {
      calls.push(['wait', value])
      return Promise.resolve({ status: 'SUCCESS' })
    }
  }
  const wallet = new WalletSession({
    address: account,
    signer: {
      signTransaction(xdr, options) {
        calls.push(['sign', xdr, options])
        return { signedTxXdr: 'signed-xdr' }
      }
    }
  })
  const duel = new DuelChain({ chain, wallet, contractId: 'CONTRACT' })
  const result = await duel.create({
    nonce: 7,
    opponent: rival,
    stake: 10,
    script: 'equip sword',
    engineVersion: 'runa/1',
    contentHash: Buffer.alloc(32, 1)
  })

  t.is(result.status, 'SUCCESS')
  t.is(calls[0][0], 'prepare')
  t.is(calls[0][1].method, 'create_duel')
  t.is(calls[1][0], 'sign')
  t.is(calls[1][2].address, account)
  t.alike(calls.slice(2), [
    ['send', 'signed-xdr'],
    ['wait', 'abc']
  ])
})

test('duel-chain normaliza respuestas comunes de wallets', (t) => {
  t.is(signedXdr('AAAA'), 'AAAA')
  t.is(signedXdr({ signedTxXdr: 'BBBB' }), 'BBBB')
  t.is(signedXdr({ xdr: 'CCCC' }), 'CCCC')
  t.exception(() => signedXdr({}), /no devolvio XDR/)
})
