/**
 * Storage for external integration credentials.
 *
 * Credentials live in `integration_credentials`, which has RLS enabled and no
 * policies for anon or authenticated. Clients therefore cannot read it at all;
 * only the service-role client can. Every function here MUST be given the
 * service-role client, not `request.supabase` (which carries the user's JWT
 * and would silently return zero rows).
 *
 * @module integrations/credentialStore
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { env } from '../config/env.js'
import { log } from '../infrastructure/logging.js'
import { encryptSecret, looksEncrypted, decryptSecret } from '../crypto/secretBox.js'

export type CredentialOwnerType = 'odoo_saved_config' | 'organization_integration'

const TABLE = 'integration_credentials'

export class CredentialKeyMissingError extends Error {
  constructor() {
    super(
      'EXTENSION_ENCRYPTION_KEY is not configured. Integration credentials cannot be stored ' +
        'without it. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))" ' +
        'and set it on the API. Note that it can never be changed once secrets exist.',
    )
    this.name = 'CredentialKeyMissingError'
  }
}

/** Throws if unset. Only writes need the key; legacy plaintext reads do not. */
export function getEncryptionKey(): string {
  const key = env.EXTENSION_ENCRYPTION_KEY
  if (!key) throw new CredentialKeyMissingError()
  return key
}

export function hasEncryptionKey(): boolean {
  return Boolean(env.EXTENSION_ENCRYPTION_KEY)
}

/**
 * Read a credential, transparently handling values that predate encryption.
 *
 * Legacy plaintext is returned without needing the key, so an API that has not
 * been configured yet keeps working against existing integrations. Such a value
 * is re-encrypted opportunistically when the key is available, which is what
 * lets the store migrate itself without a bulk migration that would need the
 * key at SQL time.
 */
export async function getCredential(
  serviceClient: SupabaseClient,
  ownerType: CredentialOwnerType,
  ownerId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from(TABLE)
    .select('id, org_id, secret')
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .maybeSingle()

  if (error) throw new Error(`Failed to read integration credential: ${error.message}`)
  if (!data?.secret) return null

  const stored = data.secret as string

  if (!looksEncrypted(stored)) {
    if (hasEncryptionKey()) {
      void reEncryptInPlace(serviceClient, data.id as string, stored)
    }
    return stored
  }

  try {
    return decryptSecret(stored, getEncryptionKey())
  } catch (err) {
    if (err instanceof CredentialKeyMissingError) throw err
    // Failing closed matters here: returning the raw ciphertext would hand a
    // caller something it would treat as the credential and send onward.
    throw new Error(
      'Stored integration credential could not be decrypted. EXTENSION_ENCRYPTION_KEY may have ' +
        'changed since it was saved; re-enter the credential to store it under the current key.',
    )
  }
}

async function reEncryptInPlace(
  serviceClient: SupabaseClient,
  id: string,
  plaintext: string,
): Promise<void> {
  try {
    await serviceClient
      .from(TABLE)
      .update({ secret: encryptSecret(plaintext, getEncryptionKey()) })
      .eq('id', id)
  } catch (err) {
    // Best-effort: the caller already has a usable credential, so a failed
    // upgrade must not break the request. It retries on the next read.
    log.warn(`[credentials] Could not re-encrypt legacy credential ${id}: ${String(err)}`)
  }
}

export async function setCredential(
  serviceClient: SupabaseClient,
  orgId: string,
  ownerType: CredentialOwnerType,
  ownerId: string,
  plaintext: string,
  updatedBy?: string | null,
): Promise<void> {
  const encrypted = encryptSecret(plaintext, getEncryptionKey())

  const { error } = await serviceClient.from(TABLE).upsert(
    {
      org_id: orgId,
      owner_type: ownerType,
      owner_id: ownerId,
      secret: encrypted,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    },
    { onConflict: 'owner_type,owner_id' },
  )

  if (error) throw new Error(`Failed to store integration credential: ${error.message}`)
}

export async function deleteCredential(
  serviceClient: SupabaseClient,
  ownerType: CredentialOwnerType,
  ownerId: string,
): Promise<void> {
  const { error } = await serviceClient
    .from(TABLE)
    .delete()
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)

  if (error) throw new Error(`Failed to delete integration credential: ${error.message}`)
}
