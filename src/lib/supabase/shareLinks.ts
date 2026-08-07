import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'

import { getSupabaseClient } from './client'

export interface ShareLinkOptions {
  expiresInDays?: number
}

/** Default life of a link when the caller does not ask for one. */
const DEFAULT_EXPIRY_DAYS = 7

/** Storage will not sign a URL for longer than this, and neither will BluePLM. */
const MAX_EXPIRY_DAYS = 365

const SECONDS_PER_DAY = 24 * 60 * 60

/** How many characters of the content hash name the storage shard. */
const HASH_SHARD_LENGTH = 2

const TOKEN_LENGTH = 12

// Identifies the audit row below and nothing else. It is not the recipient's
// credential and never appears in the URL they receive.
function generateToken(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function expiryFrom(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

/**
 * Create a shareable link for a file - generates a signed URL from Supabase Storage.
 *
 * The recipient's URL is the storage URL itself, so expiry is the only property
 * BluePLM holds over it, and Storage is what enforces that. An issued link cannot
 * be recalled, capped or restricted to signed-in users: each of those would require
 * downloads to travel through a BluePLM-controlled endpoint, which is a deliberate
 * non-goal. Controls that promised any of them are gone rather than left inert.
 *
 * ## Why the audit row is written before the URL is minted
 *
 * The row in `file_share_links` is the only authorization step in this flow. Nothing here asks
 * whether the caller may share the file; the INSERT policy on that table is what answers, and it
 * is the only thing that does. So the order matters, and it used to be the wrong way round: the
 * signed URL was created first, the insert came after inside a `try`/`catch`, and the comment
 * argued that best-effort was correct *because the URL was already valid* - the defect stated as
 * its own justification. A caller the policy refuses walked away with a working seven-day public
 * download and left no trace.
 *
 * Note also what that `try`/`catch` was not doing: `supabase-js` reports a refused insert by
 * returning `{ error }`, not by throwing, so the block caught nothing and the refusal was
 * discarded by never being read rather than by being swallowed.
 *
 * Minting after the insert means a signing failure can leave an audit row for a link nobody
 * received. That is the right way round: a row recording an attempt is harmless, and it is what
 * an audit trail is for.
 */
export async function createShareLink(
  orgId: string,
  fileId: string,
  createdBy: string,
  options?: ShareLinkOptions,
): Promise<{
  link: { id: string; token: string; expiresAt: string | null; downloadUrl: string } | null
  error?: string
}> {
  const client = getSupabaseClient()

  const { data: fileData, error: fileError } = await client
    .from('files')
    .select('content_hash, file_name, org_id')
    .eq('id', fileId)
    .single()

  if (fileError || !fileData) {
    return {
      link: null,
      error: fileError?.message || t('shareLink.fileNotFound'),
    }
  }

  if (!fileData.content_hash) {
    return {
      link: null,
      error: t('shareLink.noContent'),
    }
  }

  const expiresInDays = Math.min(options?.expiresInDays ?? DEFAULT_EXPIRY_DAYS, MAX_EXPIRY_DAYS)
  const expiresAt = expiryFrom(expiresInDays)
  const token = generateToken(TOKEN_LENGTH)

  // `fileData.org_id`, not the `orgId` argument. Schema 95's INSERT policy requires the row's
  // `org_id` to match the file's, and the two are equal today only because the select above was
  // RLS-scoped to the caller. Taking it from the row makes the agreement structural, and a caller
  // that passes the wrong organization gets a mismatch it can see rather than a silent refusal.
  const { error: auditError } = await client.from('file_share_links').insert({
    org_id: fileData.org_id,
    file_id: fileId,
    token,
    created_by: createdBy,
    expires_at: expiresAt,
  })

  if (auditError) {
    log.warn('[ShareLinks]', 'The share was not recorded, so no link was issued', {
      fileId,
      requestedOrgId: orgId,
      code: auditError.code,
      reason: auditError.message,
    })
    return {
      link: null,
      error: t('shareLink.notPermitted'),
    }
  }

  const storagePath = `${fileData.org_id}/${fileData.content_hash.substring(0, HASH_SHARD_LENGTH)}/${fileData.content_hash}`

  const { data: signedUrlData, error: signedUrlError } = await client.storage
    .from('vault')
    .createSignedUrl(storagePath, expiresInDays * SECONDS_PER_DAY, {
      download: fileData.file_name,
    })

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return {
      link: null,
      error:
        signedUrlError?.message || t('shareLink.signingFailed'),
    }
  }

  return {
    link: {
      id: token,
      token,
      expiresAt,
      downloadUrl: signedUrlData.signedUrl,
    },
  }
}
