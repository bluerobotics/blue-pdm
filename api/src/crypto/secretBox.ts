/**
 * Shared AES-256-GCM encryption for secrets held at rest.
 *
 * Extracted from extensions/secrets.ts so that integration credentials and
 * the extension store share one implementation rather than diverging.
 *
 * Stored format is `iv:authTag:ciphertext`, all base64. GCM's auth tag means a
 * wrong key or tampered value fails loudly on decrypt instead of returning
 * garbage, which is what makes transparent plaintext migration safe below.
 *
 * @module crypto/secretBox
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretCryptoError'
  }
}

export function encryptSecret(plaintext: string, key: string): string {
  if (!key) throw new SecretCryptoError('Encryption key is required')

  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer(key), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':')
}

export function decryptSecret(ciphertext: string, key: string): string {
  if (!key) throw new SecretCryptoError('Encryption key is required')

  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(':')
  if (!ivB64 || !authTagB64 || encryptedB64 === undefined) {
    throw new SecretCryptoError('Invalid encrypted value format')
  }

  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const encrypted = Buffer.from(encryptedB64, 'base64')

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new SecretCryptoError('Invalid encrypted value format')
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer(key), iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

function keyBuffer(key: string): Buffer {
  return crypto.createHash('sha256').update(key).digest()
}

/**
 * Cheap structural check. Says nothing about whether the value decrypts — use
 * it only to avoid attempting decryption on values that obviously predate
 * encryption. `readSecret` is what you actually want in most cases.
 */
export function looksEncrypted(value: string): boolean {
  const parts = value.split(':')
  if (parts.length !== 3) return false
  try {
    return (
      Buffer.from(parts[0], 'base64').length === IV_LENGTH &&
      Buffer.from(parts[1], 'base64').length === AUTH_TAG_LENGTH
    )
  } catch {
    return false
  }
}

/**
 * Read a stored secret that may predate encryption.
 *
 * Columns written before credentials were encrypted hold plaintext, and those
 * rows cannot be bulk-migrated without the key being present at migration
 * time. Returning `wasEncrypted` lets the caller re-encrypt on next write, so
 * stored values migrate themselves as they are used.
 */
export function readSecret(
  stored: string | null | undefined,
  key: string,
): { value: string | null; wasEncrypted: boolean } {
  if (stored === null || stored === undefined || stored === '') {
    return { value: null, wasEncrypted: false }
  }
  if (!looksEncrypted(stored)) {
    return { value: stored, wasEncrypted: false }
  }
  try {
    return { value: decryptSecret(stored, key), wasEncrypted: true }
  } catch {
    // Structurally plausible but did not authenticate. Could be a rotated key
    // or a plaintext value that happens to look like the format. Treating it as
    // plaintext would hand a caller ciphertext and, worse, could leak it to a
    // client, so fail closed instead.
    throw new SecretCryptoError(
      'Stored secret looks encrypted but failed to decrypt. The encryption key may have changed.',
    )
  }
}
