// Local synthetic component benchmark. No sockets, fetch, production data or credentials.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { Buffer } from 'node:buffer'
import { webcryptoCrypto } from '../workers/kinobox-search/vendor-crypto.mjs'
import hpack from '../workers/kinobox-search/vendor-hpack.mjs'
import { isKinoboxResponseValid } from '../workers/kinobox-search/routes.mjs'

async function main() {
  const rows = []
  async function measure(name, operation, iterations = 100, details = {}) {
    for (let i = 0; i < 10; i++) await operation()
    const samples = []
    const cpuStart = process.cpuUsage()
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await operation()
      samples.push(performance.now() - start)
    }
    const cpu = process.cpuUsage(cpuStart)
    samples.sort((a, b) => a - b)
    rows.push({
      name,
      iterations,
      medianWallMs: samples[Math.floor(iterations / 2)],
      p95WallMs: samples[Math.ceil(iterations * 0.95) - 1],
      processCpuMsPerOperation: (cpu.user + cpu.system) / 1000 / iterations,
      ...details
    })
  }
  for (const count of [30, 300]) {
    const items = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      title: { russian: 'Synthetic movie ' + i },
      description: 'synthetic '.repeat(count === 300 ? 250 : 10),
      gallery: { posterUrl: 'https://poster.invalid/fixture' },
      rating: {}
    }))
    const body = Buffer.from(JSON.stringify({ data: { items } }))
    assert.ok(body.length < 1024 * 1024)
    await measure(
      'search-json-roundtrip-' + count,
      () => {
        const parsed = JSON.parse(body.toString('utf8'))
        assert.ok(isKinoboxResponseValid('search', parsed))
        return JSON.stringify(parsed)
      },
      200,
      { bytes: body.length }
    )
  }
  await measure('hpack-request-response', () => {
    const compressor = hpack.compressor.create({ table: { size: 4096 } })
    compressor.write([
      { name: ':status', value: '200' },
      { name: 'content-type', value: 'application/json' },
      { name: 'cache-control', value: 'public, max-age=600' }
    ])
    const decoder = hpack.decompressor.create({ table: { maxSize: 4096 } })
    decoder.write(compressor.read())
    decoder.execute()
    assert.equal(decoder.read().value, '200')
    while (decoder.read()) {
      /* drain this synthetic stream */
    }
    compressor.destroy()
    decoder.destroy()
  })
  const subtle = globalThis.crypto.subtle
  const signer = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify'
  ])
  const data = new Uint8Array(4096)
  const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer.privateKey, data)
  await measure('webcrypto-p256-signature-verify', async () => {
    assert.ok(
      await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, signer.publicKey, signature, data)
    )
  })
  const peer = await webcryptoCrypto.generateKeyPair('P-256')
  await measure('vendor-p256-keygen-and-shared-secret', async () => {
    const pair = await webcryptoCrypto.generateKeyPair('P-256')
    const shared = await webcryptoCrypto.calculateSharedSecret('P-256', pair.privKey, peer.pubKey)
    assert.equal(shared.length, 32)
  })
  await measure('vendor-sha256-16k', () => webcryptoCrypto.hash('SHA-256', new Uint8Array(16384)))
  const aes = await subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, [
    'encrypt',
    'decrypt'
  ])
  let nonce = 0
  await measure('vendor-aes-gcm-16k-roundtrip', async () => {
    const iv = new Uint8Array(12)
    new DataView(iv.buffer).setUint32(8, nonce++)
    const aead = new Uint8Array(5),
      input = new Uint8Array(16384)
    const encrypted = await webcryptoCrypto.authenticatedEncrypt('AES-128-GCM', {
      key: aes,
      iv,
      aead,
      data: input
    })
    const decrypted = await webcryptoCrypto.authenticatedDecrypt('AES-128-GCM', {
      key: aes,
      iv,
      aead,
      data: encrypted.ciphertext,
      authTag: encrypted.authTag
    })
    assert.equal(decrypted.plaintext.length, input.length)
  })
  const result = {
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    synthetic: true,
    limitation:
      'Component timings in Node; not a full TLS handshake or Cloudflare request CPU measurement.',
    rows
  }
  await fs.writeFile(
    process.argv[2] || 'reports-browser/worker-cpu-components.json',
    JSON.stringify(result, null, 2) + '\n'
  )
  console.log(JSON.stringify(result, null, 2))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
