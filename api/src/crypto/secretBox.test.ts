import { describe, it, expect } from 'vitest'
import {
  encryptSecret,
  decryptSecret,
  looksEncrypted,
  readSecret,
  SecretCryptoError,
} from './secretBox.js'

const KEY = 'a-test-encryption-key-at-least-32-chars-long'
const OTHER_KEY = 'a-different-encryption-key-also-32-chars-long'

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a value', () => {
    const secret = 'sk-ant-api03-abcdef123456'
    expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toBe(secret)
  })

  it('round-trips unicode and empty strings', () => {
    for (const v of ['', 'héllo wörld', '日本語のテキスト', '🔐🔑']) {
      expect(decryptSecret(encryptSecret(v, KEY), KEY)).toBe(v)
    }
  })

  it('produces a different ciphertext each time for the same input', () => {
    const a = encryptSecret('same', KEY)
    const b = encryptSecret('same', KEY)
    expect(a).not.toBe(b)
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY))
  })

  it('fails loudly with the wrong key rather than returning garbage', () => {
    const encrypted = encryptSecret('sensitive', KEY)
    expect(() => decryptSecret(encrypted, OTHER_KEY)).toThrow()
  })

  it('rejects a tampered ciphertext', () => {
    const [iv, tag, body] = encryptSecret('sensitive', KEY).split(':')
    const flipped = Buffer.from(body, 'base64')
    flipped[0] ^= 0xff
    expect(() => decryptSecret([iv, tag, flipped.toString('base64')].join(':'), KEY)).toThrow()
  })

  it('rejects malformed input', () => {
    for (const bad of ['', 'not-encrypted', 'a:b', 'a:b:c:d']) {
      expect(() => decryptSecret(bad, KEY)).toThrow()
    }
  })

  it('requires a key', () => {
    expect(() => encryptSecret('x', '')).toThrow(SecretCryptoError)
    expect(() => decryptSecret(encryptSecret('x', KEY), '')).toThrow(SecretCryptoError)
  })
})

describe('looksEncrypted', () => {
  it('recognises its own output', () => {
    expect(looksEncrypted(encryptSecret('x', KEY))).toBe(true)
  })

  it('rejects plausible plaintext Odoo and Anthropic keys', () => {
    const plaintexts = [
      'sk-ant-api03-abcdef',
      '0123456789abcdef0123456789abcdef',
      'my-odoo-password',
      'has:colons:inside',
      'https://example.odoo.com',
      '',
    ]
    for (const p of plaintexts) expect(looksEncrypted(p)).toBe(false)
  })
})

describe('readSecret', () => {
  it('returns null for empty storage', () => {
    for (const v of [null, undefined, '']) {
      expect(readSecret(v, KEY)).toEqual({ value: null, wasEncrypted: false })
    }
  })

  it('passes through legacy plaintext and reports it needs migrating', () => {
    expect(readSecret('legacy-plaintext-key', KEY)).toEqual({
      value: 'legacy-plaintext-key',
      wasEncrypted: false,
    })
  })

  it('decrypts an encrypted value', () => {
    expect(readSecret(encryptSecret('real-key', KEY), KEY)).toEqual({
      value: 'real-key',
      wasEncrypted: true,
    })
  })

  it('fails closed when the key changed rather than leaking ciphertext', () => {
    // The dangerous failure mode: returning the raw ciphertext to a caller that
    // then hands it to a client as if it were the credential.
    const encrypted = encryptSecret('real-key', KEY)
    expect(() => readSecret(encrypted, OTHER_KEY)).toThrow(SecretCryptoError)
  })
})
