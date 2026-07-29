/**
 * Extension Secrets Storage
 *
 * Provides encrypted secrets storage for extensions with audit logging.
 * Secrets are encrypted using AES-256-GCM before storage.
 *
 * Features:
 * - AES-256-GCM encryption for secrets
 * - Secret versioning (keeps last 3 versions)
 * - Access audit logging
 * - Limits: 50 secrets per extension, 10KB per secret
 *
 * @module extensions/secrets
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { log } from '../infrastructure/logging.js'
import { encryptSecret, decryptSecret } from '../crypto/secretBox.js'

// ═══════════════════════════════════════════════════════════════════════════════
// SECRETS LIMITS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Secrets limits per extension.
 */
export const SECRETS_LIMITS = {
  /** Maximum number of secrets per extension */
  MAX_SECRETS: 50,
  /** Maximum secret name length */
  MAX_NAME_LENGTH: 128,
  /** Maximum secret value size in bytes (10KB) */
  MAX_VALUE_SIZE: 10 * 1024,
  /** Number of previous versions to keep */
  VERSION_HISTORY: 3,
  /** Grace period for old versions in hours */
  OLD_VERSION_GRACE_HOURS: 24,
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// ENCRYPTION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

// Delegates to crypto/secretBox so integration credentials and extension
// secrets share one implementation. Wrapped only to preserve SecretsError.
function encrypt(plaintext: string, key: string): string {
  try {
    return encryptSecret(plaintext, key)
  } catch (err) {
    throw new SecretsError(err instanceof Error ? err.message : 'Failed to encrypt secret')
  }
}

function decrypt(ciphertext: string, key: string): string {
  try {
    return decryptSecret(ciphertext, key)
  } catch (err) {
    throw new SecretsError(err instanceof Error ? err.message : 'Invalid encrypted value format')
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENSION SECRETS CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extension encrypted secrets storage with audit logging.
 *
 * All secret access is logged for security auditing.
 * Secrets are encrypted at rest using AES-256-GCM.
 *
 * @example
 * ```typescript
 * const secrets = new ExtensionSecrets(supabase, orgId, extensionId, key, userId);
 *
 * // Store a secret
 * await secrets.set('API_KEY', 'sk-1234567890');
 *
 * // Retrieve a secret
 * const apiKey = await secrets.get('API_KEY');
 *
 * // Delete a secret
 * await secrets.delete('API_KEY');
 * ```
 */
export class ExtensionSecrets {
  private supabase: SupabaseClient
  private orgId: string
  private extensionId: string
  private encryptionKey: string
  private accessedBy: string

  constructor(
    supabase: SupabaseClient,
    orgId: string,
    extensionId: string,
    encryptionKey: string,
    accessedBy: string,
  ) {
    this.supabase = supabase
    this.orgId = orgId
    this.extensionId = extensionId
    this.encryptionKey = encryptionKey
    this.accessedBy = accessedBy
  }

  /**
   * Get a secret value by name.
   *
   * @param name - Secret name
   * @returns Decrypted secret value or undefined if not found
   */
  async get(name: string): Promise<string | undefined> {
    this.validateName(name)

    const { data, error } = await this.supabase
      .from('extension_secrets')
      .select('encrypted_value')
      .eq('org_id', this.orgId)
      .eq('extension_id', this.extensionId)
      .eq('name', name)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return undefined
      }
      throw new SecretsError(`Failed to get secret ${name}: ${error.message}`)
    }

    // Log the access
    await this.logAccess(name, 'read')

    if (!data?.encrypted_value) {
      return undefined
    }

    try {
      return decrypt(data.encrypted_value, this.encryptionKey)
    } catch (error) {
      throw new SecretsError(
        `Failed to decrypt secret ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Set a secret value.
   *
   * Creates a new version, keeping the last 3 versions for rollback.
   * Old versions are accessible for 24 hours after being superseded.
   *
   * @param name - Secret name
   * @param value - Secret value (will be encrypted)
   */
  async set(name: string, value: string): Promise<void> {
    this.validateName(name)
    this.validateValue(value)

    // Check secret count limit
    const count = await this.getSecretCount()
    const existing = await this.exists(name)

    if (!existing && count >= SECRETS_LIMITS.MAX_SECRETS) {
      throw new SecretsError(
        `Secrets limit exceeded: maximum ${SECRETS_LIMITS.MAX_SECRETS} secrets per extension`,
      )
    }

    const encryptedValue = encrypt(value, this.encryptionKey)

    // Archive current version if exists
    if (existing) {
      await this.archiveCurrentVersion(name)
    }

    const { error } = await this.supabase.from('extension_secrets').upsert(
      {
        org_id: this.orgId,
        extension_id: this.extensionId,
        name,
        encrypted_value: encryptedValue,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'org_id,extension_id,name',
      },
    )

    if (error) {
      throw new SecretsError(`Failed to set secret ${name}: ${error.message}`)
    }

    // Log the access
    await this.logAccess(name, 'write')

    // Clean up old versions
    await this.cleanupOldVersions(name)
  }

  /**
   * Delete a secret.
   *
   * @param name - Secret name to delete
   */
  async delete(name: string): Promise<void> {
    this.validateName(name)

    // Log the access before deleting
    await this.logAccess(name, 'delete')

    const { error } = await this.supabase
      .from('extension_secrets')
      .delete()
      .eq('org_id', this.orgId)
      .eq('extension_id', this.extensionId)
      .eq('name', name)

    if (error) {
      throw new SecretsError(`Failed to delete secret ${name}: ${error.message}`)
    }

    // Also delete archived versions
    await this.supabase
      .from('extension_secret_versions')
      .delete()
      .eq('org_id', this.orgId)
      .eq('extension_id', this.extensionId)
      .eq('name', name)
  }

  /**
   * Check if a secret exists.
   */
  async exists(name: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('extension_secrets')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', this.orgId)
      .eq('extension_id', this.extensionId)
      .eq('name', name)

    if (error) {
      throw new SecretsError(`Failed to check secret ${name}: ${error.message}`)
    }

    return (count ?? 0) > 0
  }

  /**
   * Get the number of secrets stored.
   */
  async getSecretCount(): Promise<number> {
    const { count, error } = await this.supabase
      .from('extension_secrets')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', this.orgId)
      .eq('extension_id', this.extensionId)

    if (error) {
      throw new SecretsError(`Failed to get secret count: ${error.message}`)
    }

    return count ?? 0
  }

  /**
   * List all secret names (not values).
   */
  async listNames(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('extension_secrets')
      .select('name')
      .eq('org_id', this.orgId)
      .eq('extension_id', this.extensionId)
      .order('name')

    if (error) {
      throw new SecretsError(`Failed to list secrets: ${error.message}`)
    }

    return data?.map((row) => row.name) ?? []
  }

  /**
   * Archive current secret value as a version.
   */
  private async archiveCurrentVersion(name: string): Promise<void> {
    const { data } = await this.supabase
      .from('extension_secrets')
      .select('encrypted_value')
      .eq('org_id', this.orgId)
      .eq('extension_id', this.extensionId)
      .eq('name', name)
      .single()

    if (data?.encrypted_value) {
      await this.supabase.from('extension_secret_versions').insert({
        org_id: this.orgId,
        extension_id: this.extensionId,
        name,
        encrypted_value: data.encrypted_value,
        archived_at: new Date().toISOString(),
      })
    }
  }

  /**
   * Clean up old archived versions beyond retention limit.
   */
  private async cleanupOldVersions(name: string): Promise<void> {
    // Get all versions ordered by date
    const { data } = await this.supabase
      .from('extension_secret_versions')
      .select('id, archived_at')
      .eq('org_id', this.orgId)
      .eq('extension_id', this.extensionId)
      .eq('name', name)
      .order('archived_at', { ascending: false })

    if (!data || data.length <= SECRETS_LIMITS.VERSION_HISTORY) {
      return
    }

    // Delete versions beyond the retention limit
    const toDelete = data.slice(SECRETS_LIMITS.VERSION_HISTORY)
    const deleteIds = toDelete.map((v) => v.id)

    if (deleteIds.length > 0) {
      await this.supabase.from('extension_secret_versions').delete().in('id', deleteIds)
    }
  }

  /**
   * Log secret access to audit table.
   */
  private async logAccess(secretName: string, action: 'read' | 'write' | 'delete'): Promise<void> {
    // Fire-and-forget audit logging (best-effort)
    this.supabase
      .from('extension_secret_access')
      .insert({
        org_id: this.orgId,
        extension_id: this.extensionId,
        secret_name: secretName,
        action,
        accessed_by: this.accessedBy,
        accessed_at: new Date().toISOString(),
      })
      .then(() => {}, (err) => log.error({ err }, '[Secrets] Failed to log access'))
  }

  /**
   * Validate secret name.
   */
  private validateName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new SecretsError('Secret name must be a non-empty string')
    }

    if (name.length > SECRETS_LIMITS.MAX_NAME_LENGTH) {
      throw new SecretsError(
        `Secret name too long: max ${SECRETS_LIMITS.MAX_NAME_LENGTH} characters`,
      )
    }

    // Only allow uppercase alphanumeric and underscores (env var style)
    if (!/^[A-Z0-9_]+$/.test(name)) {
      throw new SecretsError(
        'Secret name must be uppercase alphanumeric with underscores (e.g., API_KEY)',
      )
    }
  }

  /**
   * Validate secret value.
   */
  private validateValue(value: string): void {
    if (typeof value !== 'string') {
      throw new SecretsError('Secret value must be a string')
    }

    const size = Buffer.byteLength(value, 'utf8')
    if (size > SECRETS_LIMITS.MAX_VALUE_SIZE) {
      throw new SecretsError(
        `Secret value too large: ${size} bytes (max ${SECRETS_LIMITS.MAX_VALUE_SIZE} bytes)`,
      )
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECRETS ERROR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Secrets operation error.
 */
export class SecretsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretsError'
  }
}
